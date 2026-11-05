import { secureShuffle } from "../../shared/secure-random.ts";

/**
 * Split the Room - server logic.
 * Fill a blank to split the room down the middle.
 */

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
  | "role"
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





import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBLEMS: Array<{ text: string }> = JSON.parse(readFileSync(join(HERE, "content", "problems.json"), "utf8")) as Array<{ text: string }>;
const WORDS: Array<{ text: string }> = JSON.parse(readFileSync(join(HERE, "content", "words.json"), "utf8")) as Array<{ text: string }>;

interface InventionState {
  round: number;
  maxRounds: number;
  phase: "invent" | "vote" | "reveal" | "finished";
  problems: string[];
  chips: Array<[string, string]>;
  names: Array<string | null>;
  pitches: Array<string | null>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { rows: Array<{ name: string; pitch: string; votes: number; usedBoth: boolean }> } | null;
}

interface InventionInstance extends GameInstance { state: InventionState }

const INVENT_MS = 90000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_NAME = 30;
const MAX_PITCH = 120;

const manifest: GameManifest = {
  id: "dumbinventions",
  name: "Dumb Inventions",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "You get a problem and two random words. Invent a product that uses both, then pitch it.",
};

/** Both chips must appear somewhere in the pitch, case-insensitively. */
export function usesChips(pitch: string, chips: string[]): boolean {
  const lower = pitch.toLowerCase();
  return chips.every((chip) => lower.includes(chip.toLowerCase()));
}

/** 1000 per vote, minus 200 when the pitch did not use both chips. */
export function roundPoints(votes: Array<number | null>, usedBoth: boolean[], playerCount: number): number[] {
  const tally = new Array<number>(playerCount).fill(0);
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= playerCount) continue;
    tally[vote]++;
  }
  return tally.map((count, i) => count * 1000 - (usedBoth[i] ? 0 : 200));
}

function invLeader(instance: InventionInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function invBegin(instance: InventionInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  const problems = secureShuffle(PROBLEMS).map((p) => p.text);
  const words = secureShuffle(WORDS).map((w) => w.text);
  s.problems = instance.players.map((_, i) => problems[i % problems.length]);
  s.chips = instance.players.map((_, i) => [words[(i * 2) % words.length], words[(i * 2 + 1) % words.length]] as [string, string]);
  s.names = instance.players.map(() => null);
  s.pitches = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = INVENT_MS;
  s.phase = "invent";
}

function invSettle(instance: InventionInstance): void {
  const s = instance.state;
  const usedBoth = s.chips.map((chips, i) => usesChips(s.pitches[i] ?? "", chips));
  const points = roundPoints(s.votes, usedBoth, instance.players.length);
  points.forEach((p, i) => { s.scores[i] += p; });
  s.reveal = {
    rows: instance.players.map((p, i) => ({
      name: s.names[i] ?? "Unnamed gadget",
      pitch: s.pitches[i] ?? "",
      votes: s.votes.filter((v) => v === i).length,
      usedBoth: usedBoth[i],
    })),
  };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    const problems = secureShuffle(PROBLEMS).map((p) => p.text);
    const words = secureShuffle(WORDS).map((w) => w.text);
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: 2,
        phase: "invent",
        problems: players.map((_, i) => problems[i % problems.length]),
        chips: players.map((_, i) => [words[(i * 2) % words.length], words[(i * 2 + 1) % words.length]] as [string, string]),
        names: players.map(() => null),
        pitches: players.map(() => null),
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: INVENT_MS,
        reveal: null,
      } satisfies InventionState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as InventionInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "invent") {
      if (typeof raw?.text !== "string") return;
      const text = raw.text.trim();
      if (!text) return;
      if (s.names[index] === null) {
        s.names[index] = text.slice(0, MAX_NAME);
        return;
      }
      if (s.pitches[index] === null) {
        s.pitches[index] = text.slice(0, MAX_PITCH);
        if (s.pitches.every((p) => p !== null)) { s.phase = "vote"; s.timerMs = VOTE_MS; }
      }
      return;
    }

    if (s.phase === "vote") {
      if (typeof raw?.choice !== "string" || !raw.choice.startsWith("p:")) return;
      const target = Number(raw.choice.slice(2));
      if (!Number.isInteger(target) || target < 0 || target >= inst.players.length || target === index) return;
      s.votes[index] = target;
      if (s.votes.every((v) => v !== null)) invSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as InventionInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "invent") {
      inst.players.forEach((_, i) => {
        if (s.names[i] === null) s.names[i] = "Unnamed gadget";
        if (s.pitches[i] === null) s.pitches[i] = "It solves nothing at all.";
      });
      s.phase = "vote";
      s.timerMs = VOTE_MS;
      return;
    }
    if (s.phase === "vote") { invSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    invBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as InventionInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      inventions: inst.players.map((p, i) => ({
        author: p.name,
        problem: s.problems[i],
        chips: s.chips[i],
        name: s.names[i],
        pitch: s.pitches[i],
        usedBoth: s.pitches[i] !== null && usesChips(s.pitches[i] ?? "", s.chips[i]),
        votes: revealed ? s.votes.filter((v) => v === i).length : null,
      })),
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? invLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as InventionInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && invLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "invent") {
      const naming = s.names[index] === null;
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: naming ? "Product name" : "One-line pitch",
        maxLength: naming ? MAX_NAME : MAX_PITCH,
        hasSubmitted: naming ? false : s.pitches[index] !== null,
        info: `${s.problems[index]} - use "${s.chips[index][0]}" and "${s.chips[index][1]}"`,
      };
    }

    if (s.phase === "vote") {
      const options = inst.players
        .map((_, i) => ({ id: `p:${i}`, label: s.names[i] ?? "Unnamed gadget" }))
        .filter((_, i) => i !== index);
      return { ...base, mode: "choice", controllerType: "choice", options, hasVoted: s.votes[index] !== null, info: "Best invention?" };
    }

    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? "Round complete" : "" };
  },
};

export default plugin;
