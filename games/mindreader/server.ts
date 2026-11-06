/**
 * Mind Reader - server logic.
 * Everyone ranks four things, then you guess how one chosen player ranked them. Closer = more points.
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
  | "chat"
  | "rank";

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



interface RankItem { id: string; label: string }
interface RankPrompt { id: string; items: RankItem[] }

const PROMPTS: RankPrompt[] = [
  { id: "p1", items: [{ id: "a", label: "Pizza" }, { id: "b", label: "Tacos" }, { id: "c", label: "Sushi" }, { id: "d", label: "Burgers" }] },
  { id: "p2", items: [{ id: "a", label: "Beach" }, { id: "b", label: "Mountains" }, { id: "c", label: "City break" }, { id: "d", label: "Stay home" }] },
  { id: "p3", items: [{ id: "a", label: "Netflix" }, { id: "b", label: "Spotify" }, { id: "c", label: "Maps" }, { id: "d", label: "Camera" }] },
  { id: "p4", items: [{ id: "a", label: "Summer" }, { id: "b", label: "Autumn" }, { id: "c", label: "Winter" }, { id: "d", label: "Spring" }] },
  { id: "p5", items: [{ id: "a", label: "Dogs" }, { id: "b", label: "Cats" }, { id: "c", label: "Birds" }, { id: "d", label: "Fish" }] },
  { id: "p6", items: [{ id: "a", label: "Tea" }, { id: "b", label: "Coffee" }, { id: "c", label: "Juice" }, { id: "d", label: "Water" }] },
  { id: "p7", items: [{ id: "a", label: "Comedy" }, { id: "b", label: "Horror" }, { id: "c", label: "Action" }, { id: "d", label: "Documentary" }] },
  { id: "p8", items: [{ id: "a", label: "Morning" }, { id: "b", label: "Afternoon" }, { id: "c", label: "Evening" }, { id: "d", label: "Night" }] },
];

interface MindReaderState {
  prompts: RankPrompt[];
  round: number;
  maxRounds: number;
  phase: "ranking" | "guessing" | "reveal" | "finished";
  spotlight: number;
  ranking: Array<string[] | null>;
  guesses: Array<string[] | null>;
  scores: number[];
  timerMs: number;
  reveal: { spotlightName: string; rows: Array<{ name: string; score: number }> } | null;
}

interface MindReaderInstance extends GameInstance { state: MindReaderState }

const RANK_MS = 25000;
const GUESS_MS = 25000;
const REVEAL_MS = 9000;

const manifest: GameManifest = {
  id: "mindreader",
  name: "Mind Reader",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "rank",
  description: "Everyone ranks four things. Then guess how one chosen player ranked them. Closer = more points.",
};

/** Sum of |position differences| between two orderings of the same items. */
export function footruleDistance(a: string[], b: string[]): number {
  let total = 0;
  for (const id of a) {
    const ia = a.indexOf(id);
    const ib = b.indexOf(id);
    if (ib === -1) continue;
    total += Math.abs(ia - ib);
  }
  return total;
}

/** 1000 for an identical ordering, 0 for the worst possible one. */
export function scoreGuess(actual: string[], guess: string[]): number {
  const n = actual.length;
  if (n < 2 || guess.length !== n) return 0;
  // A guess must be a true permutation of the prompt's items.
  const seen = new Set(guess);
  if (seen.size !== n || !actual.every((id) => seen.has(id))) return 0;
  const maxDistance = Math.floor((n * n) / 2);
  const distance = footruleDistance(actual, guess);
  const ratio = Math.min(1, distance / maxDistance);
  return Math.max(0, Math.round(1000 * (1 - ratio)));
}

function mindReaderLeader(instance: MindReaderInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function promptFor(instance: MindReaderInstance, round: number): RankPrompt {
  return instance.state.prompts[round % instance.state.prompts.length];
}

function mindReaderBegin(instance: MindReaderInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.spotlight = round % instance.players.length;
  s.ranking = instance.players.map(() => null);
  s.guesses = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = RANK_MS;
  s.phase = "ranking";
}

function allRanked(instance: MindReaderInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => s.ranking[i] !== null);
}

function allGuessed(instance: MindReaderInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => i === s.spotlight || s.guesses[i] !== null);
}

function mindReaderSettle(instance: MindReaderInstance): void {
  const s = instance.state;
  const prompt = promptFor(instance, s.round);
  const fallback = prompt.items.map((i) => i.id);
  const actual = s.ranking[s.spotlight] ?? fallback;

  const rows: Array<{ name: string; score: number }> = [];
  for (let i = 0; i < instance.players.length; i++) {
    if (i === s.spotlight) continue;
    const guess = s.guesses[i];
    const score = guess ? scoreGuess(actual, guess) : 0;
    s.scores[i] += score;
    if (score >= 700) s.scores[s.spotlight] += 100;
    rows.push({ name: instance.players[i].name, score });
  }

  s.reveal = { spotlightName: instance.players[s.spotlight].name, rows };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

function validOrder(order: unknown, prompt: RankPrompt): string[] | null {
  if (!Array.isArray(order)) return null;
  const ids = order.map(String);
  if (ids.length !== prompt.items.length) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (!ids.every((id) => prompt.items.some((i) => i.id === id))) return null;
  return ids;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        prompts: secureShuffle(PROMPTS),
        round: 0,
        maxRounds: players.length,
        phase: "ranking",
        spotlight: 0,
        ranking: players.map(() => null),
        guesses: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: RANK_MS,
        reveal: null,
      } satisfies MindReaderState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as MindReaderInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { rank?: { order?: unknown } } | null;
    const prompt = promptFor(inst, s.round);

    if (s.phase === "ranking") {
      const order = validOrder(raw?.rank?.order, prompt);
      if (!order || s.ranking[index] !== null) return;
      s.ranking[index] = order;
      if (allRanked(inst)) {
        s.phase = "guessing";
        s.timerMs = GUESS_MS;
      }
      return;
    }

    if (s.phase === "guessing" && index !== s.spotlight) {
      const order = validOrder(raw?.rank?.order, prompt);
      if (!order || s.guesses[index] !== null) return;
      s.guesses[index] = order;
      if (allGuessed(inst)) mindReaderSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as MindReaderInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    if (s.phase === "ranking") {
      const prompt = promptFor(inst, s.round);
      inst.players.forEach((_, i) => { if (!s.ranking[i]) s.ranking[i] = prompt.items.map((x) => x.id); });
      s.phase = "guessing";
      s.timerMs = GUESS_MS;
      return;
    }
    if (s.phase === "guessing") { mindReaderSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    mindReaderBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as MindReaderInstance;
    const s = inst.state;
    const prompt = promptFor(inst, s.round);
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      prompt: prompt.items.map((i) => i.label),
      spotlightName: inst.players[s.spotlight]?.name ?? "",
      // The true ranking is only public at the reveal.
      trueRanking: s.phase === "reveal" || s.phase === "finished"
        ? (s.ranking[s.spotlight] ?? []).map((id) => prompt.items.find((i) => i.id === id)?.label ?? id)
        : null,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? mindReaderLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as MindReaderInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const prompt = promptFor(inst, s.round);
    const items = prompt.items.map((i) => ({ id: i.id, label: i.label }));
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && mindReaderLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "ranking") {
      return {
        ...base,
        mode: "rank",
        controllerType: "rank",
        rank: { items, order: [], submitLabel: "Lock in", disabled: false, hasSubmitted: s.ranking[index] !== null },
      };
    }
    if (s.phase === "guessing") {
      if (index === s.spotlight) {
        return {
          ...base,
          mode: "wait",
          controllerType: "choice",
          options: [],
          info: "You are the Spotlight. Everyone is guessing your ranking.",
        };
      }
      return {
        ...base,
        mode: "rank",
        controllerType: "rank",
        rank: { items, order: [], submitLabel: "Lock guess", disabled: false, hasSubmitted: s.guesses[index] !== null },
        info: `Guess how ${inst.players[s.spotlight].name} ranked them`,
      };
    }
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal ? `${s.reveal.spotlightName}'s order is on the screen` : "",
    };
  },
};

export default plugin;
