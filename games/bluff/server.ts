/**
 * Bluff - Server Logic
 * Fill in the blank with a fake answer. Everyone votes for the answer they
 * think is real. Points for voting real, points for fooling others.
 * Phones switch from a text input (writing) to buttons (voting).
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
  | "card-hand";

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
  answer: string;
  category: string;
}

interface RoundAnswer {
  id: string; // "real" | playerId
  text: string;
  author: string;
  votes: number;
}

interface RoundResult {
  prompt: string;
  realAnswer: string;
  answers: RoundAnswer[];
}

interface BluffState {
  prompts: Prompt[];
  currentPrompt: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  submissions: Record<string, string>; // playerId -> answer (current round only)
  voteOrder: string[]; // stable shuffled answer ids: "real" | playerId
  votes: Record<string, string>; // voterId -> answer id
  phaseTimerMs: number;
  scores: number[];
  lastResult: RoundResult | null;
}

interface BluffInstance extends GameInstance {
  state: BluffState;
}

// --- Constants ---
const WRITE_TIME_MS = 30000;
const VOTE_TIME_MS = 20000;
const REVEAL_TIME_MS = 6000;
const ROUNDS = 6;
const MAX_TEXT = 100;
const POINTS_VOTE_REAL = 500;
const POINTS_FOOL = 200;

const PROMPTS: Prompt[] = [
  { text: "The world's largest _____ weighs as much as 33 elephants.", answer: "blue whale", category: "Nature" },
  { text: "A group of flamingos is called a _____.", answer: "flamboyance", category: "Animals" },
  { text: "_____ was originally marketed as a wallpaper cleaner.", answer: "Play-Doh", category: "Toys" },
  { text: "The shortest war in history lasted _____ minutes.", answer: "38", category: "History" },
  { text: "Bananas are technically _____.", answer: "berries", category: "Food" },
  { text: "Octopuses have _____ hearts.", answer: "three", category: "Animals" },
  { text: "The dot over the letter i is called a _____.", answer: "tittle", category: "Words" },
  { text: "Honey never _____.", answer: "spoils", category: "Food" },
  { text: "A group of crows is called a _____.", answer: "murder", category: "Animals" },
  { text: "The national sport of Japan is _____.", answer: "sumo", category: "World" },
];

const manifest: GameManifest = {
  id: "bluff",
  name: "Bluff",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description:
    "Fill in the blank with a convincing fake answer. Vote for the real one. Fool the table!",
};

// --- Helpers ---
// Use secureShuffle from shared/secure-random.ts

function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length === 0 || t.length > MAX_TEXT) return null;
  return t;
}

function submittedCount(state: BluffState): number {
  return Object.keys(state.submissions).length;
}

function votedCount(state: BluffState): number {
  return Object.keys(state.votes).length;
}

function answerLabel(state: BluffState, prompt: Prompt | null, id: string): string {
  if (id === "real") return prompt ? prompt.answer : "…";
  return state.submissions[id] ?? "…";
}

function enterVoting(instance: BluffInstance): void {
  const state = instance.state;
  state.voteOrder = secureShuffle(["real", ...Object.keys(state.submissions)]);
  state.phase = "voting";
  state.phaseTimerMs = VOTE_TIME_MS;
}

function buildResult(instance: BluffInstance): RoundResult {
  const state = instance.state;
  const prompt = state.prompts[state.currentPrompt];
  const answers: RoundAnswer[] = ["real", ...Object.keys(state.submissions)].map((id) => ({
    id,
    text: answerLabel(state, prompt, id),
    author: id === "real" ? "The real answer" : nameOf(instance, id),
    votes: Object.values(state.votes).filter((v) => v === id).length,
  }));
  return { prompt: prompt.text, realAnswer: prompt.answer, answers };
}

function nameOf(instance: BluffInstance, playerId: string): string {
  const p = instance.players.find((x) => x.id === playerId);
  return p ? p.name : "Unknown";
}

function scoreRound(instance: BluffInstance): void {
  const state = instance.state;
  const result = buildResult(instance);

  // +500 to every voter who picked the real answer.
  for (const [voterId, choice] of Object.entries(state.votes)) {
    if (choice === "real") {
      const idx = instance.players.findIndex((p) => p.id === voterId);
      if (idx >= 0) state.scores[idx] += POINTS_VOTE_REAL;
    }
  }
  // +200 to the author of every fake answer that fooled a voter.
  for (const answer of result.answers) {
    if (answer.id === "real" || answer.votes === 0) continue;
    const idx = instance.players.findIndex((p) => p.id === answer.id);
    if (idx >= 0) state.scores[idx] += answer.votes * POINTS_FOOL;
  }

  state.lastResult = result;
}

function nextRoundOrFinish(instance: BluffInstance): void {
  const state = instance.state;
  state.currentPrompt++;
  state.submissions = {};
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

  onStart(room: RoomState, players: Player[]): BluffInstance {
    return {
      roomId: room.id,
      players,
      state: {
        prompts: secureShuffle(PROMPTS).slice(0, ROUNDS),
        currentPrompt: 0,
        phase: "writing",
        submissions: {},
        voteOrder: [],
        votes: {},
        phaseTimerMs: WRITE_TIME_MS,
        scores: players.map(() => 0),
        lastResult: null,
      } satisfies BluffState,
    } as BluffInstance;
  },

  onInput(instance: BluffInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase === "finished" || state.phase === "reveal") return;
    if (!instance.players.some((p) => p.id === playerId)) return;

    const inp = input as { text?: unknown; choice?: unknown } | null;

    if (state.phase === "writing") {
      const text = cleanText(inp?.text);
      if (text === null) return;
      state.submissions[playerId] = text;
      if (submittedCount(state) >= instance.players.length) enterVoting(instance);
      return;
    }

    if (state.phase === "voting") {
      const choice = inp?.choice;
      if (typeof choice !== "string") return;
      if (!state.voteOrder.includes(choice)) return;
      // You cannot vote for your own submission.
      if (choice === playerId) return;
      if (state.votes[playerId] !== undefined) return; // one vote per player
      state.votes[playerId] = choice;
      // The real answer is always an option, so everyone can vote.
      if (votedCount(state) >= instance.players.length) {
        scoreRound(instance);
        state.phase = "reveal";
        state.phaseTimerMs = REVEAL_TIME_MS;
      }
    }
  },

  onTick(instance: BluffInstance, deltaMs: number): void {
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
      if (submittedCount(state) > 0) enterVoting(instance);
      else nextRoundOrFinish(instance); // nobody answered: skip the round
      return;
    }
    if (state.phase === "voting") {
      scoreRound(instance);
      state.phase = "reveal";
      state.phaseTimerMs = REVEAL_TIME_MS;
    }
  },

  screenState(instance: BluffInstance): unknown {
    const state = instance.state;
    const prompt = state.prompts[state.currentPrompt] ?? null;
    const isReveal = state.phase === "reveal";
    // The real answer is only marked (or even shown) at reveal time; the
    // laptop screen is visible to everyone in the room.
    const answers =
      isReveal && state.lastResult
        ? state.lastResult.answers.map((a) => ({ ...a, isReal: a.id === "real" }))
        : [];

    return {
      phase: state.phase,
      prompt: prompt ? prompt.text : null,
      category: prompt ? prompt.category : null,
      round: Math.min(state.currentPrompt + 1, state.prompts.length),
      totalRounds: state.prompts.length,
      submitted: submittedCount(state),
      playerCount: instance.players.length,
      voted: votedCount(state),
      answers,
      realAnswer: isReveal && prompt ? prompt.answer : null,
      timeLeft: Math.max(0, state.phaseTimerMs),
      scores: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: BluffInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return { phase: state.phase, finished: state.phase === "finished" };

    const prompt = state.prompts[state.currentPrompt] ?? null;
    const scores = instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] }));

    if (state.phase === "writing") {
      const mine = state.submissions[playerId];
      return {
        controllerType: "text",
        phase: "writing",
        prompt: prompt ? prompt.text : null,
        category: prompt ? prompt.category : null,
        placeholder: "Your convincing answer...",
        hasSubmitted: mine !== undefined,
        yourAnswer: mine ?? null,
        timeLeft: Math.max(0, state.phaseTimerMs),
        round: Math.min(state.currentPrompt + 1, state.prompts.length),
        totalRounds: state.prompts.length,
        scores,
        finished: false,
      };
    }

    if (state.phase === "voting") {
      const options = state.voteOrder
        .filter((id) => id !== playerId) // never your own answer
        .map((id) => ({ id, label: answerLabel(state, prompt, id) }));
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
        realAnswer: prompt ? prompt.answer : null,
        youVoted: voted,
        correct: voted === "real",
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

function getWinner(instance: BluffInstance): { name: string; score: number } | null {
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
