/**
 * Write & Vote - Server Logic
 * Write the funniest response to a prompt, then vote for everyone else's.
 * Most votes wins. Phones switch from a text input (writing) to buttons
 * (voting).
 */

import { secureShuffle } from "../../shared/secure-random.ts";

// Types defined inline to avoid import issues with Node type stripping
interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
}

type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand"
  | "slider"
  | "dual-slider"
  | "pad"
  | "aim"
  | "tap-race"
  | "board"
  | "numpad"
  | "canvas"
  | "chat";

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
}

interface RoomState {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: unknown;
}

interface GamePlugin {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}

// --- Game types ---
interface Prompt {
  text: string;
  category: string;
}

interface RoundResponse {
  id: string; // playerId
  text: string;
  author: string;
  votes: number;
}

interface RoundResult {
  prompt: string;
  responses: RoundResponse[];
}

interface WriteVoteState {
  prompts: Prompt[];
  currentPrompt: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  responses: Record<string, string>; // playerId -> response (current round only)
  voteOrder: string[]; // stable shuffled response ids
  votes: Record<string, string>; // voterId -> response id
  phaseTimerMs: number;
  scores: number[];
  lastResult: RoundResult | null;
}

interface WriteVoteInstance extends GameInstance {
  state: WriteVoteState;
}

// --- Constants ---
const WRITE_TIME_MS = 45000;
const VOTE_TIME_MS = 20000;
const REVEAL_TIME_MS = 6000;
const ROUNDS = 5;
const MAX_TEXT = 120;
const POINTS_PER_VOTE = 100;

const PROMPTS: Prompt[] = [
  { text: "A rejected superhero name:", category: "Heroes" },
  { text: "Worst thing to say at a funeral:", category: "Dark" },
  { text: "A terrible name for a law firm:", category: "Business" },
  { text: "What your pet thinks about you:", category: "Pets" },
  { text: "A terrible pizza topping:", category: "Food" },
  { text: "Worst first date idea:", category: "Dating" },
  { text: "A rejected Olympic sport:", category: "Sports" },
  { text: "Bad advice from a fortune cookie:", category: "Wisdom" },
  { text: "A terrible name for a band:", category: "Music" },
  { text: "The worst possible slogan for a hospital:", category: "Words" },
];

const manifest: GameManifest = {
  id: "writevote",
  name: "Write & Vote",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description:
    "Write your funniest response to the prompt. Everyone votes. Most votes wins!",
};

// --- Helpers ---
// Use secureShuffle from shared/secure-random.ts

function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length === 0 || t.length > MAX_TEXT) return null;
  return t;
}

function respondedCount(state: WriteVoteState): number {
  return Object.keys(state.responses).length;
}

function votedCount(state: WriteVoteState): number {
  return Object.keys(state.votes).length;
}

function nameOf(instance: WriteVoteInstance, playerId: string): string {
  const p = instance.players.find((x) => x.id === playerId);
  return p ? p.name : "Unknown";
}

function enterVoting(instance: WriteVoteInstance): void {
  const state = instance.state;
  state.voteOrder = secureShuffle(Object.keys(state.responses));
  state.phase = "voting";
  state.phaseTimerMs = VOTE_TIME_MS;
}

function buildResult(instance: WriteVoteInstance): RoundResult {
  const state = instance.state;
  const prompt = state.prompts[state.currentPrompt];
  const responses: RoundResponse[] = Object.keys(state.responses).map((id) => ({
    id,
    text: state.responses[id],
    author: nameOf(instance, id),
    votes: Object.values(state.votes).filter((v) => v === id).length,
  }));
  responses.sort((a, b) => b.votes - a.votes);
  return { prompt: prompt.text, responses };
}

function scoreRound(instance: WriteVoteInstance): void {
  const state = instance.state;
  const result = buildResult(instance);
  for (const r of result.responses) {
    if (r.votes > 0) {
      const idx = instance.players.findIndex((p) => p.id === r.id);
      if (idx >= 0) state.scores[idx] += r.votes * POINTS_PER_VOTE;
    }
  }
  state.lastResult = result;
}

function nextRoundOrFinish(instance: WriteVoteInstance): void {
  const state = instance.state;
  state.currentPrompt++;
  state.responses = {};
  state.votes = {};
  state.voteOrder = [];
  state.lastResult = null;
  if (state.currentPrompt >= state.prompts.length) {
    state.phase = "finished";
  } else {
    state.phase = "writing";
    state.phaseTimerMs = WRITE_TIME_MS;
  }
}

// --- Plugin ---
const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): WriteVoteInstance {
    return {
      roomId: room.id,
      players,
      state: {
        prompts: secureShuffle(PROMPTS).slice(0, ROUNDS),
        currentPrompt: 0,
        phase: "writing",
        responses: {},
        voteOrder: [],
        votes: {},
        phaseTimerMs: WRITE_TIME_MS,
        scores: players.map(() => 0),
        lastResult: null,
      } satisfies WriteVoteState,
    } as WriteVoteInstance;
  },

  onInput(instance: WriteVoteInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase === "finished" || state.phase === "reveal") return;
    if (!instance.players.some((p) => p.id === playerId)) return;

    const inp = input as { text?: unknown; choice?: unknown } | null;

    if (state.phase === "writing") {
      const text = cleanText(inp?.text);
      if (text === null) return;
      state.responses[playerId] = text;
      if (respondedCount(state) >= instance.players.length) enterVoting(instance);
      return;
    }

    if (state.phase === "voting") {
      const choice = inp?.choice;
      if (typeof choice !== "string") return;
      if (!state.voteOrder.includes(choice)) return;
      // You cannot vote for your own response.
      if (choice === playerId) return;
      if (state.votes[playerId] !== undefined) return; // one vote per player
      state.votes[playerId] = choice;
      // Everyone has at least two options (min 3 players), so all can vote.
      if (votedCount(state) >= instance.players.length) {
        scoreRound(instance);
        state.phase = "reveal";
        state.phaseTimerMs = REVEAL_TIME_MS;
      }
    }
  },

  onTick(instance: WriteVoteInstance, deltaMs: number): void {
    const state = instance.state;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);

    if (state.phase === "reveal") {
      state.phaseTimerMs -= dt;
      if (state.phaseTimerMs <= 0) nextRoundOrFinish(instance);
      return;
    }
    if (state.phase === "finished") return;

    state.phaseTimerMs -= dt;
    if (state.phaseTimerMs > 0) return;

    if (state.phase === "writing") {
      if (respondedCount(state) > 0) enterVoting(instance);
      else nextRoundOrFinish(instance); // nobody answered: skip the round
      return;
    }
    if (state.phase === "voting") {
      scoreRound(instance);
      state.phase = "reveal";
      state.phaseTimerMs = REVEAL_TIME_MS;
    }
  },

  screenState(instance: WriteVoteInstance): unknown {
    const state = instance.state;
    const prompt = state.prompts[state.currentPrompt] ?? null;
    const isReveal = state.phase === "reveal";
    // Responses stay hidden until reveal; the laptop screen is public.
    const responses =
      isReveal && state.lastResult
        ? state.lastResult.responses.map((r) => ({
            text: r.text,
            author: r.author,
            votes: r.votes,
          }))
        : [];

    return {
      phase: state.phase,
      prompt: prompt ? prompt.text : null,
      category: prompt ? prompt.category : null,
      round: Math.min(state.currentPrompt + 1, state.prompts.length),
      totalRounds: state.prompts.length,
      responded: respondedCount(state),
      playerCount: instance.players.length,
      voted: votedCount(state),
      responses,
      timeLeft: Math.max(0, state.phaseTimerMs),
      scores: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: WriteVoteInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return { phase: state.phase, finished: state.phase === "finished" };

    const prompt = state.prompts[state.currentPrompt] ?? null;
    const scores = instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] }));

    if (state.phase === "writing") {
      const mine = state.responses[playerId];
      return {
        controllerType: "text",
        phase: "writing",
        prompt: prompt ? prompt.text : null,
        category: prompt ? prompt.category : null,
        placeholder: "Your funniest response...",
        hasSubmitted: mine !== undefined,
        yourResponse: mine ?? null,
        timeLeft: Math.max(0, state.phaseTimerMs),
        round: Math.min(state.currentPrompt + 1, state.prompts.length),
        totalRounds: state.prompts.length,
        scores,
        finished: false,
      };
    }

    if (state.phase === "voting") {
      const options = state.voteOrder
        .filter((id) => id !== playerId) // never your own response
        .map((id) => ({ id, label: state.responses[id] ?? "…" }));
      return {
        controllerType: "choice",
        phase: "voting",
        prompt: prompt ? prompt.text : null,
        options,
        hasVoted: state.votes[playerId] !== undefined,
        timeLeft: Math.max(0, state.phaseTimerMs),
        round: Math.min(state.currentPrompt + 1, state.prompts.length),
        totalRounds: state.prompts.length,
        scores,
        finished: false,
      };
    }

    if (state.phase === "reveal") {
      const voted = state.votes[playerId] ?? null;
      return {
        controllerType: "choice",
        phase: "reveal",
        prompt: prompt ? prompt.text : null,
        options: [],
        youVoted: voted,
        result: state.lastResult,
        timeLeft: Math.max(0, state.phaseTimerMs),
        scores,
        finished: false,
      };
    }

    return {
      controllerType: "choice",
      phase: "finished",
      options: [],
      scores,
      winner: getWinner(instance),
      finished: true,
      youWon: getWinner(instance)?.name === instance.players[playerIndex].name,
    };
  },
};

function getWinner(instance: WriteVoteInstance): { name: string; score: number } | null {
  const state = instance.state;
  let best = -1;
  let idx = -1;
  state.scores.forEach((s, i) => {
    if (s > best) {
      best = s;
      idx = i;
    }
  });
  if (idx >= 0) return { name: instance.players[idx].name, score: best };
  return null;
}

export default plugin;
