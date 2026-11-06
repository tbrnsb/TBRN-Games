import { captionFor } from "../../shared/interlude.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { playerStatKey } from "../../shared/results.ts";
import {
  MAX_ROUND_SCORE,
  scalePayout,
  standingsFromScores,
  type GameResult,
} from "../../shared/scoring.ts";
import { secureShuffle } from "../../shared/secure-random.ts";

/**
 * Dumb Inventions - server logic.
 * You get a problem and two random words. Invent a product that uses both, then pitch it.
 *
 * Scoring: `scalePayout(1000, N)` per vote, capped at the shared round bound
 * from five players up (3-4 keep the uncapped total for parity). Skipping a
 * chip only forfeits the chip credit for that pitch; it never costs points, so
 * a player can never finish a round below zero.
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
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  results?(instance: GameInstance): GameResult;
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
  stats: Record<string, number>;
}

interface InventionInstance extends GameInstance { state: InventionState }

/** Flat `<playerId>:<statKey>` counters for the finale awards. */
type InventionStat = "votesReceived" | "chipsUsed";

const INVENT_MS = 90000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_NAME = 30;
const MAX_PITCH = 120;

/** Standalone rounds; the catalog's `scale()` reports the same split. */
const ROUNDS_SMALL_TABLE = 2;
const ROUNDS_LARGE_TABLE = 3;

/** 3-4 players keep the pre-expansion two rounds; five and up run three. */
function roundsFor(playerCount: number): number {
  return playerCount <= 4 ? ROUNDS_SMALL_TABLE : ROUNDS_LARGE_TABLE;
}

/** Per-vote payout before `scalePayout` applies `f(N)`. */
const VOTE_POINTS = 1000;

const manifest: GameManifest = {
  id: "dumbinventions",
  name: "Dumb Inventions",
  minPlayers: 3,
  maxPlayers: 6,
  controllerType: "text",
  description: "You get a problem and two random words. Invent a product that uses both, then pitch it.",
};

/** How many of the dealt chips appear somewhere in the pitch, case-insensitively. */
export function chipsUsed(pitch: string, chips: readonly string[]): number {
  const lower = pitch.toLowerCase();
  return chips.reduce((count, chip) => (lower.includes(chip.toLowerCase()) ? count + 1 : count), 0);
}

/** Both chips must appear somewhere in the pitch, case-insensitively. */
export function usesChips(pitch: string, chips: string[]): boolean {
  return chipsUsed(pitch, chips) === chips.length;
}

/**
 * Points for one round: `scalePayout(1000, N)` per vote. From five players up
 * the gain is capped at the shared round bound; 3 and 4 players keep the
 * uncapped total so their scores stay identical to the pre-change game. A pitch
 * that skips a chip earns no chip credit but loses nothing, so a player with
 * zero votes scores 0.
 */
export function roundPoints(votes: Array<number | null>, playerCount: number): number[] {
  const tally = new Array<number>(playerCount).fill(0);
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= playerCount) continue;
    tally[vote]++;
  }
  const perVote = scalePayout(VOTE_POINTS, playerCount);
  return tally.map((count) => {
    const gain = count * perVote;
    return playerCount >= 5 ? Math.min(gain, MAX_ROUND_SCORE) : gain;
  });
}

function bumpStat(state: InventionState, playerId: string, stat: InventionStat, amount = 1): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + amount;
}

/** Who the TV is waiting on during each timed phase. */
function waitingNames(instance: InventionInstance): string[] {
  const s = instance.state;
  if (s.phase === "invent") {
    return instance.players
      .filter((_, i) => s.names[i] === null || s.pitches[i] === null)
      .map((p) => p.name);
  }
  if (s.phase === "vote") {
    return instance.players.filter((_, i) => s.votes[i] === null).map((p) => p.name);
  }
  return [];
}

/** Reveal line: the most-voted pitch's author. Never carries pitch text. */
function revealCaption(instance: InventionInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;

  let topIndex = -1;
  let topVotes = 0;
  s.reveal.rows.forEach((row, i) => {
    if (row.votes > topVotes) {
      topVotes = row.votes;
      topIndex = i;
    }
  });
  if (topIndex >= 0) {
    return captionFor({
      kind: "favourite",
      name: instance.players[topIndex]?.name,
      count: topVotes,
      seed: s.round,
    });
  }
  return captionFor({ kind: "reveal", seed: s.round });
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
  const usedChips = s.chips.map((chips, i) => chipsUsed(s.pitches[i] ?? "", chips));
  const points = roundPoints(s.votes, instance.players.length);
  points.forEach((p, i) => { s.scores[i] += p; });

  const tally = instance.players.map((_, i) => s.votes.filter((v) => v === i).length);
  instance.players.forEach((player, i) => {
    bumpStat(s, player.id, "votesReceived", tally[i]);
    bumpStat(s, player.id, "chipsUsed", usedChips[i]);
  });

  s.reveal = {
    rows: instance.players.map((p, i) => ({
      name: s.names[i] ?? "Unnamed gadget",
      pitch: s.pitches[i] ?? "",
      votes: tally[i],
      usedBoth: usedChips[i] === s.chips[i].length,
    })),
  };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const problems = secureShuffle(PROBLEMS).map((p) => p.text);
    const words = secureShuffle(WORDS).map((w) => w.text);
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        // A Rumble passes its shorter count; standalone keeps the table rule.
        maxRounds: roundsOption(options) ?? roundsFor(players.length),
        phase: "invent",
        problems: players.map((_, i) => problems[i % problems.length]),
        chips: players.map((_, i) => [words[(i * 2) % words.length], words[(i * 2 + 1) % words.length]] as [string, string]),
        names: players.map(() => null),
        pitches: players.map(() => null),
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: INVENT_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.flatMap((p): Array<[string, number]> => [
            [playerStatKey(p.id, "votesReceived"), 0],
            [playerStatKey(p.id, "chipsUsed"), 0],
          ]),
        ),
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
    // Privacy: product names and pitches stay off the TV until the reveal. The
    // TV shows only the roster, the problem/chip challenge and progress; each
    // phone still gets the names it needs to vote on.
    const options = revealed
      ? inst.players.map((_, i) => ({
          id: `p:${i}`,
          label: s.names[i] ?? "Unnamed gadget",
          text: s.pitches[i] ?? "",
          author: i,
          votes: s.votes.filter((v) => v === i).length,
        }))
      : [];
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      inventions: inst.players.map((p, i) => ({
        author: p.name,
        problem: s.problems[i],
        chips: s.chips[i],
        name: revealed ? s.names[i] : null,
        pitch: revealed ? s.pitches[i] : null,
        usedBoth: revealed && s.pitches[i] !== null && usesChips(s.pitches[i] ?? "", s.chips[i]),
        votes: revealed ? s.votes.filter((v) => v === i).length : null,
      })),
      options,
      optionColumns: options.length >= 6 ? 2 : 1,
      reveal: s.reveal,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
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

  results(instance: GameInstance): GameResult {
    const inst = instance as InventionInstance;
    return {
      standings: standingsFromScores(
        inst.players.map((p, i) => ({ id: p.id, raw: inst.state.scores[i] })),
      ),
      stats: { ...inst.state.stats },
    };
  },
};

export default plugin;
