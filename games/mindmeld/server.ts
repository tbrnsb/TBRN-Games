/**
 * Split the Room - server logic.
 * Fill a blank to split the room down the middle.
 */

import { secureShuffle } from "../../shared/secure-random.ts";

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



import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Category { id: string; text: string; tags: string[]; safe: boolean }

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK: Category[] = JSON.parse(readFileSync(join(HERE, "content", "categories.json"), "utf8")) as Category[];

interface MindMeldState {
  categories: Category[];
  round: number;
  maxRounds: number;
  phase: "collect" | "reveal" | "finished";
  answers: Array<string | null>;
  scores: number[];
  roundPoints: number[];
  allMatched: boolean;
  timerMs: number;
}

interface MindMeldInstance extends GameInstance { state: MindMeldState }

const COLLECT_MS = 20000;
const REVEAL_MS = 8000;
const MAX_LENGTH = 20;

const manifest: GameManifest = {
  id: "mindmeld",
  name: "Mind Meld",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "text",
  description: "Everyone answers the same category with one word. Match the table and score.",
};

/** Lowercase, strip punctuation, collapse spaces, and take a simple singular. */
export function normalizeAnswer(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ").map((word) => {
    if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && /(?:ches|shes|xes|zes|ses)$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  });
  return words.join(" ");
}

/** Pure scoring: 300 per person who matched you, or a 1000-each jackpot if the whole table matches. */
export function scoreRound(raw: string[]): { points: number[]; allMatched: boolean } {
  const normalized = raw.map(normalizeAnswer);
  const valid = normalized.filter((a) => a.length > 0);
  if (raw.length > 1 && valid.length === raw.length && new Set(valid).size === 1) {
    return { points: raw.map(() => 1000), allMatched: true };
  }
  const points = normalized.map((answer, i) => {
    if (!answer) return 0;
    let matches = 0;
    for (let j = 0; j < normalized.length; j++) {
      if (j !== i && normalized[j] === answer) matches++;
    }
    return matches * 300;
  });
  return { points, allMatched: false };
}

function mindmeldBegin(instance: MindMeldInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.answers = instance.players.map(() => null);
  s.roundPoints = instance.players.map(() => 0);
  s.allMatched = false;
  s.timerMs = COLLECT_MS;
  s.phase = "collect";
}

function mindmeldSettle(instance: MindMeldInstance): void {
  const s = instance.state;
  const raw = s.answers.map((a) => (typeof a === "string" ? a : ""));
  const { points, allMatched } = scoreRound(raw);
  points.forEach((p, i) => { s.scores[i] += p; });
  s.roundPoints = points;
  s.allMatched = allMatched;
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        categories: secureShuffle(PACK.filter((c) => c.safe)).slice(0, 6),
        round: 0,
        maxRounds: 6,
        phase: "collect",
        answers: players.map(() => null),
        scores: players.map(() => 0),
        roundPoints: players.map(() => 0),
        allMatched: false,
        timerMs: COLLECT_MS,
      } satisfies MindMeldState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as MindMeldInstance;
    const s = inst.state;
    if (s.phase !== "collect") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1 || s.answers[index] !== null) return;
    const text = (input as { text?: unknown } | null)?.text;
    if (typeof text !== "string") return;
    const trimmed = text.trim().slice(0, MAX_LENGTH);
    if (!trimmed) return;
    s.answers[index] = trimmed;
    if (s.answers.every((a) => a !== null)) mindmeldSettle(inst);
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as MindMeldInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    if (s.phase === "collect") { mindmeldSettle(inst); return; }
    if (s.allMatched) { s.phase = "finished"; return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    mindmeldBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as MindMeldInstance;
    const s = inst.state;
    const category = s.categories[Math.min(s.round, s.categories.length - 1)];
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      category: category?.text ?? "",
      submitted: s.answers.filter((a) => a !== null).length,
      playerCount: inst.players.length,
      // Answers stay hidden until the reveal.
      answers: revealed
        ? inst.players.map((p, i) => ({ name: p.name, answer: s.answers[i] ?? "", points: s.roundPoints[i] }))
        : [],
      allMatched: s.phase === "reveal" ? s.allMatched : false,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? mindmeldLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as MindMeldInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const category = s.categories[Math.min(s.round, s.categories.length - 1)];
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && mindmeldLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "collect") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: category?.text ?? "",
        maxLength: MAX_LENGTH,
        hasSubmitted: s.answers[index] !== null,
        info: category?.text ?? "",
      };
    }
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.allMatched ? "Full mind meld! +1000 each" : "No jackpot this round",
    };
  },
};

function mindmeldLeader(instance: MindMeldInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

export default plugin;
