/**
 * Bluff - Server Logic
 * Fill in the blank with a fake answer. Everyone votes for the answer they
 * think is real. Points for voting real, points for fooling others.
 * Phones switch from a text input (writing) to buttons (voting).
 *
 * Content packs live in `content/*.json` and are loaded once at module init:
 * - facts (default): a trivia prompt with a blank and a fixed real answer.
 * - dictionary: an obscure word; the real answer is its definition.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secureShuffle } from "../../shared/secure-random.ts";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import {
  scalePayout,
  standingsFromScores,
  type GameResult,
} from "../../shared/scoring.ts";

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
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  results?(instance: GameInstance): GameResult;
}

// --- Game types ---
interface Prompt {
  text: string;
  answer: string;
  category: string;
}

type ContentPack = "facts" | "dictionary";

interface FactEntry {
  text: string;
  answer: string;
  category: string;
}

interface DictionaryEntry {
  word: string;
  definition: string;
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
  contentPack: ContentPack;
  prompts: Prompt[];
  currentPrompt: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  submissions: Record<string, string>; // playerId -> answer (current round only)
  voteOrder: string[]; // stable shuffled answer ids: "real" | playerId
  votes: Record<string, string>; // voterId -> answer id
  phaseTimerMs: number;
  scores: number[];
  lastResult: RoundResult | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface BluffInstance extends GameInstance {
  state: BluffState;
}

// --- Content packs ---
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "content");

function loadContent<T>(fileName: string): T[] {
  const raw: unknown = JSON.parse(readFileSync(join(CONTENT_DIR, fileName), "utf8"));
  return Array.isArray(raw) ? (raw as T[]) : [];
}

const FACTS: Prompt[] = loadContent<FactEntry>("facts.json").map((entry) => ({
  text: entry.text,
  answer: entry.answer,
  category: entry.category,
}));

const DICTIONARY: Prompt[] = loadContent<DictionaryEntry>("dictionary.json").map((entry) => ({
  text: entry.word,
  answer: entry.definition,
  category: "Dictionary",
}));

// --- Constants ---
const WRITE_TIME_MS = 30000;
const VOTE_TIME_MS = 20000;
const REVEAL_TIME_MS = 6000;
const ROUNDS = 6;
const MAX_TEXT = 100;
const POINTS_VOTE_REAL = 500;
const POINTS_FOOL_BASE = 200;

const manifest: GameManifest = {
  id: "bluff",
  name: "Bluff",
  minPlayers: 3,
  maxPlayers: 8,
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

/** Awards use the camelCase platform keys; the brief also names the stats in
 * kebab-case, so both are published and stay in lockstep. */
const STAT_ALIASES = {
  votesFooled: "votes-fooled",
  correctVotes: "truth-found",
  fakesWritten: "fakes-written",
} as const;

type PlayerStat = keyof typeof STAT_ALIASES;

function bumpStat(state: BluffState, playerId: string, stat: PlayerStat, amount = 1): void {
  const camelKey = playerStatKey(playerId, stat);
  const displayKey = playerStatKey(playerId, STAT_ALIASES[stat]);
  state.stats[camelKey] = (state.stats[camelKey] ?? 0) + amount;
  state.stats[displayKey] = (state.stats[displayKey] ?? 0) + amount;
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
  const ids = state.voteOrder.length > 0
    ? state.voteOrder
    : ["real", ...Object.keys(state.submissions)];
  const answers: RoundAnswer[] = ids.map((id) => ({
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
  // The per-fool payout scales with the table; 3-4 players stay at 200.
  const foolPayout = scalePayout(POINTS_FOOL_BASE, instance.players.length);

  // +500 to every voter who picked the real answer.
  for (const [voterId, choice] of Object.entries(state.votes)) {
    if (choice === "real") {
      const idx = instance.players.findIndex((p) => p.id === voterId);
      if (idx >= 0) {
        state.scores[idx] += POINTS_VOTE_REAL;
        bumpStat(state, voterId, "correctVotes");
      }
    }
  }
  // Scaled payout to the author of every fake answer that fooled a voter.
  for (const answer of result.answers) {
    if (answer.id === "real" || answer.votes === 0) continue;
    const idx = instance.players.findIndex((p) => p.id === answer.id);
    if (idx >= 0) {
      state.scores[idx] += answer.votes * foolPayout;
      bumpStat(state, answer.id, "votesFooled", answer.votes);
    }
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

function waitingNames(instance: BluffInstance): string[] {
  const state = instance.state;
  if (state.phase === "writing") {
    return instance.players
      .filter((p) => state.submissions[p.id] === undefined)
      .map((p) => p.name);
  }
  if (state.phase === "voting") {
    return instance.players
      .filter((p) => state.votes[p.id] === undefined)
      .map((p) => p.name);
  }
  return [];
}

/** Public, capped caption for the reveal. Never carries the real answer. */
function revealCaption(state: BluffState): string | null {
  if (state.phase !== "reveal" || !state.lastResult) return null;

  let topFooler: RoundAnswer | null = null;
  for (const answer of state.lastResult.answers) {
    if (answer.id === "real" || answer.votes <= 0) continue;
    if (!topFooler || answer.votes > topFooler.votes) topFooler = answer;
  }
  if (topFooler) {
    return captionFor({
      kind: "fooled",
      name: topFooler.author,
      count: topFooler.votes,
      seed: state.currentPrompt,
    });
  }
  return captionFor({ kind: "reveal", seed: state.currentPrompt });
}

// --- Plugin ---
const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): BluffInstance {
    const contentPack: ContentPack =
      options?.contentPack === "dictionary" ? "dictionary" : "facts";
    const source = contentPack === "dictionary" ? DICTIONARY : FACTS;

    return {
      roomId: room.id,
      players,
      state: {
        contentPack,
        prompts: secureShuffle(source).slice(0, ROUNDS),
        currentPrompt: 0,
        phase: "writing",
        submissions: {},
        voteOrder: [],
        votes: {},
        phaseTimerMs: WRITE_TIME_MS,
        scores: players.map(() => 0),
        lastResult: null,
        stats: {},
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
      if (state.submissions[playerId] === undefined) {
        bumpStat(state, playerId, "fakesWritten");
      }
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
      contentPack: state.contentPack,
      prompt: prompt ? prompt.text : null,
      category: prompt ? prompt.category : null,
      round: Math.min(state.currentPrompt + 1, state.prompts.length),
      totalRounds: state.prompts.length,
      submitted: submittedCount(state),
      playerCount: instance.players.length,
      voted: votedCount(state),
      waitingOn: waitingNames(instance),
      answers,
      realAnswer: isReveal && prompt ? prompt.answer : null,
      caption: revealCaption(state),
      sound: isReveal ? "reveal" : null,
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
        placeholder: state.contentPack === "dictionary"
          ? "Your convincing definition..."
          : "Your convincing answer...",
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

  results(instance: BluffInstance): GameResult {
    const state = instance.state;
    return {
      standings: standingsFromScores(
        instance.players.map((p, i) => ({ id: p.id, raw: state.scores[i] })),
      ),
      stats: { ...state.stats },
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
