import { captionFor } from "../../shared/interlude.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { playerStatKey } from "../../shared/results.ts";
import {
  MAX_ROUND_SCORE,
  standingsFromScores,
  type GameResult,
} from "../../shared/scoring.ts";
import { secureRandomInt, secureShuffle } from "../../shared/secure-random.ts";

/**
 * Bracket Brawl - server logic.
 * Everyone writes one answer, then it is a knockout bracket. Only players not in a duel get to vote.
 *
 * Bracket shape (brief 4): pad the table to the next power of two with byes.
 * Every bye is placed in its own first-round pair, so nobody sits out more than
 * one round. 3 players get a duel plus a bye, 4 get two semis plus a final (both
 * exactly as before), and 5-6 get an extra opening round.
 *
 * Rounds: 3-4 players keep the old two brackets for parity; 5-6 play one full
 * bracket. Scoring stays 500 per non-final duel win, 1000 for the final and a
 * fixed 100 to each voter who backed the winner. From five players up one
 * player's score in a round is capped at the shared `MAX_ROUND_SCORE`; 3 and 4
 * players keep the old uncapped totals.
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

/**
 * A bracket slot. `>= 0` is an entry index; `< 0` means "winner of the earlier
 * match `(-slot - 1)`". Byes are not matches: the entry appears directly in the
 * next round, so it advances without a vote.
 */
export interface BracketMatch {
  a: number;
  b: number;
}

interface BracketDuel extends BracketMatch {
  votes: Array<"a" | "b" | null>;
  winner: number | null;
}

interface BracketReveal {
  /** Player index of the round champion, or null when the bracket is empty. */
  champion: number | null;
  /** Votes cast for the champion's answer in the final duel. */
  votes: number;
}

interface BracketState {
  round: number;
  maxRounds: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  prompt: string;
  entries: Array<{ author: number; text: string } | null>;
  duels: BracketDuel[];
  current: number;
  scores: number[];
  /** Points earned in the current round, so the shared round bound can apply. */
  roundGain: number[];
  timerMs: number;
  reveal: BracketReveal | null;
  stats: Record<string, number>;
}

interface BracketInstance extends GameInstance { state: BracketState }

/** Flat per-player counters for the finale awards. */
type BracketStat = "duelWins" | "votesCorrect";

const PROMPTS = [
  "Best excuse for being late",
  "Worst thing to say on a first date",
  "Best name for a pet rock",
  "Worst superpower",
  "Best thing to find in your pocket",
  "Worst song to play at a wedding",
  "Best way to waste a Sunday",
];

const WRITE_MS = 60000;
const VOTE_MS = 20000;
const REVEAL_MS = 9000;

const DUEL_POINTS = 500;
const FINAL_POINTS = 1000;
const VOTER_POINTS = 100;

/** Two rounds at 3-4 players (today's game); one full bracket from five up. */
const TWO_BRACKET_MAX = 4;

const manifest: GameManifest = {
  id: "bracket",
  name: "Bracket Brawl",
  minPlayers: 3,
  maxPlayers: 6,
  controllerType: "text",
  description: "Everyone writes one answer, then it is a knockout bracket. Only players not in a duel get to vote.",
};

/** Smallest power of two that can hold `playerCount`. */
export function bracketSize(playerCount: number): number {
  if (!Number.isFinite(playerCount)) return 0;
  const count = Math.floor(playerCount);
  if (count < 1) return 0;
  let size = 1;
  while (size < count) size *= 2;
  return size;
}

/**
 * Build a single-elimination bracket for any player count.
 *
 * Pure and deterministic by default, so tests can pin the 3- and 4-player
 * fixtures. `order` maps bracket positions to entry indices; the game passes a
 * secure shuffle here so byes and seeding are random. Byes are placed one per
 * first-round pair, which is the only arrangement where nobody sits out more
 * than one round.
 *
 * Every played match appears once, in play order: opening round first, final
 * last. A single elimination bracket with N players therefore has N - 1
 * matches.
 */
export function buildBracket(playerCount: number, order?: readonly number[]): BracketMatch[] {
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  if (count < 2) return [];

  const size = bracketSize(count);
  const pairCount = size / 2;
  const byePairs = size - count;
  const entries = order && order.length >= count
    ? order.slice(0, count)
    : Array.from({ length: count }, (_, i) => i);

  // Fill first-round pairs in bracket order. The last `byePairs` pairs carry
  // one entry and one bye; every other pair is a duel.
  const slots: number[] = [];
  let cursor = 0;
  for (let pair = 0; pair < pairCount; pair++) {
    if (pair >= pairCount - byePairs) {
      slots.push(entries[cursor++] ?? -1, -1);
    } else {
      slots.push(entries[cursor++] ?? -1, entries[cursor++] ?? -1);
    }
  }

  const matches: BracketMatch[] = [];
  let frontier: number[] = [];
  for (let pair = 0; pair < pairCount; pair++) {
    const a = slots[pair * 2];
    const b = slots[pair * 2 + 1];
    if (a >= 0 && b >= 0) {
      matches.push({ a, b });
      frontier.push(-matches.length);
    } else {
      // A bye advances directly, so it never becomes a match.
      frontier.push(a >= 0 ? a : b);
    }
  }

  while (frontier.length > 1) {
    const next: number[] = [];
    for (let i = 0; i < frontier.length; i += 2) {
      matches.push({ a: frontier[i], b: frontier[i + 1] });
      next.push(-matches.length);
    }
    frontier = next;
  }

  return matches;
}

/**
 * Zero-based bracket round of every match (the opening round is 0, the final
 * is the last round). Rounds are measured from the final backwards, so byes
 * that skip the opening round still line up with the other matches at their
 * level.
 */
export function bracketRounds(matches: readonly BracketMatch[]): number[] {
  if (matches.length === 0) return [];
  const depth: number[] = new Array<number>(matches.length).fill(0);
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    for (const slot of [match.a, match.b]) {
      if (slot >= 0) continue;
      const source = -slot - 1;
      depth[source] = Math.max(depth[source], depth[index] + 1);
    }
  }
  const maxDepth = Math.max(...depth);
  return depth.map((value) => maxDepth - value);
}

/** Majority wins; a tie is broken by the supplied pick (0 = side a, 1 = side b). */
export function decideDuel(votes: Array<"a" | "b" | null>, tiePick: 0 | 1): "a" | "b" {
  let a = 0;
  let b = 0;
  for (const vote of votes) {
    if (vote === "a") a++;
    else if (vote === "b") b++;
  }
  if (a === b) return tiePick === 0 ? "a" : "b";
  return a > b ? "a" : "b";
}

function bracketLeader(instance: BracketInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function resolveSlot(s: BracketState, slot: number): number {
  if (slot >= 0) return slot;
  const duel = s.duels[-slot - 1];
  return duel?.winner ?? -1;
}

function duelSides(s: BracketState, duelIndex: number): { a: number; b: number } {
  const duel = s.duels[duelIndex];
  return { a: resolveSlot(s, duel.a), b: resolveSlot(s, duel.b) };
}

/** Seats that may vote in a duel: everyone whose answer is not in it. */
function eligibleVoters(instance: BracketInstance, duelIndex: number): number[] {
  const s = instance.state;
  const sides = duelSides(s, duelIndex);
  const taken = new Set<number>();
  for (const entryIndex of [sides.a, sides.b]) {
    const entry = entryIndex >= 0 ? s.entries[entryIndex] : null;
    if (entry) taken.add(entry.author);
  }
  return instance.players.map((_, i) => i).filter((i) => !taken.has(i));
}

/**
 * Award points. From five players up the gain is trimmed at the shared
 * per-round bound; 3 and 4 players keep the old uncapped totals so a 4-player
 * semi winner who also backs the other semi still earns the full 1600.
 */
function award(s: BracketState, seat: number, points: number): number {
  if (seat < 0 || seat >= s.scores.length) return 0;
  const gain = Math.max(0, points);
  if (s.scores.length < 5) {
    s.roundGain[seat] += gain;
    s.scores[seat] += gain;
    return gain;
  }
  const room = Math.max(0, MAX_ROUND_SCORE - s.roundGain[seat]);
  const capped = Math.min(gain, room);
  s.roundGain[seat] += capped;
  s.scores[seat] += capped;
  return capped;
}

function bumpStat(s: BracketState, playerId: string, stat: BracketStat, amount = 1): void {
  const key = playerStatKey(playerId, stat);
  s.stats[key] = (s.stats[key] ?? 0) + amount;
}

/** Who the TV is waiting on: writers in the writing phase, voters in a duel. */
function waitingNames(instance: BracketInstance): string[] {
  const s = instance.state;
  if (s.phase === "writing") {
    return instance.players.filter((_, i) => s.entries[i] === null).map((p) => p.name);
  }
  if (s.phase === "voting") {
    const duel = s.duels[s.current];
    if (!duel) return [];
    return eligibleVoters(instance, s.current)
      .filter((seat) => duel.votes[seat] === null)
      .map((seat) => instance.players[seat].name);
  }
  return [];
}

/** Reveal line: the round champion and the final-duel vote count. */
function revealCaption(instance: BracketInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal || s.reveal.champion === null) return null;
  const name = instance.players[s.reveal.champion]?.name;
  if (s.reveal.votes > 0) {
    return captionFor({ kind: "favourite", name, count: s.reveal.votes, seed: s.round });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

function bracketBegin(instance: BracketInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.prompt = PROMPTS[round % PROMPTS.length];
  s.entries = instance.players.map(() => null);
  s.duels = [];
  s.current = 0;
  s.roundGain = instance.players.map(() => 0);
  s.reveal = null;
  s.timerMs = WRITE_MS;
  s.phase = "writing";
}

function bracketStartBracket(instance: BracketInstance): void {
  const s = instance.state;
  // Secure shuffle seeds the bracket and therefore who receives a bye.
  const order = secureShuffle(instance.players.map((_, i) => i));
  s.duels = buildBracket(instance.players.length, order).map((d) => ({
    a: d.a,
    b: d.b,
    votes: instance.players.map(() => null),
    winner: null,
  }));
  s.current = 0;
  s.phase = "voting";
  s.timerMs = VOTE_MS;
}

function bracketResolve(instance: BracketInstance): void {
  const s = instance.state;
  const duel = s.duels[s.current];
  if (!duel) return;
  const sides = duelSides(s, s.current);
  const side = decideDuel(duel.votes, secureRandomInt(0, 2) === 0 ? 0 : 1);
  const entryIndex = side === "a" ? sides.a : sides.b;
  duel.winner = entryIndex;

  const voters = eligibleVoters(instance, s.current);
  for (const seat of voters) {
    if (duel.votes[seat] !== side) continue;
    award(s, seat, VOTER_POINTS);
    bumpStat(s, instance.players[seat].id, "votesCorrect");
  }

  const author = entryIndex >= 0 ? s.entries[entryIndex]?.author ?? -1 : -1;
  const isFinal = s.current === s.duels.length - 1;
  if (author >= 0) {
    award(s, author, isFinal ? FINAL_POINTS : DUEL_POINTS);
    bumpStat(s, instance.players[author].id, "duelWins");
  }

  if (isFinal) {
    s.reveal = {
      champion: author >= 0 ? author : null,
      votes: duel.votes.filter((vote) => vote === side).length,
    };
    s.phase = "reveal";
    s.timerMs = REVEAL_MS;
    return;
  }
  s.current++;
  s.timerMs = VOTE_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        // 3-4 players keep the old two brackets; 5-6 play one full bracket.
        // A preset Rumble passes the catalog's count explicitly.
        maxRounds: roundsOption(options) ?? (players.length <= TWO_BRACKET_MAX ? 2 : 1),
        phase: "writing",
        prompt: PROMPTS[0],
        entries: players.map(() => null),
        duels: [],
        current: 0,
        scores: players.map(() => 0),
        roundGain: players.map(() => 0),
        timerMs: WRITE_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.flatMap((p): Array<[string, number]> => [
            [playerStatKey(p.id, "duelWins"), 0],
            [playerStatKey(p.id, "votesCorrect"), 0],
          ]),
        ),
      } satisfies BracketState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as BracketInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "writing") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.entries[index] === null) {
        s.entries[index] = { author: index, text: raw.text.trim().slice(0, 80) };
        if (s.entries.every((e) => e !== null)) bracketStartBracket(inst);
      }
      return;
    }

    if (s.phase === "voting") {
      const seats = eligibleVoters(inst, s.current);
      if (!seats.includes(index)) return;
      if (raw?.choice !== "a" && raw?.choice !== "b") return;
      s.duels[s.current].votes[index] = raw.choice;
      if (seats.every((seat) => s.duels[s.current].votes[seat] !== null)) bracketResolve(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as BracketInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "writing") {
      inst.players.forEach((_, i) => { if (!s.entries[i]) s.entries[i] = { author: i, text: "no answer" }; });
      bracketStartBracket(inst);
      return;
    }
    if (s.phase === "voting") { bracketResolve(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    bracketBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as BracketInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    const entryText = (idx: number): string => (idx >= 0 ? s.entries[idx]?.text ?? "" : "");
    const entryName = (idx: number): string | null => {
      if (idx < 0) return null;
      const author = s.entries[idx]?.author ?? -1;
      return author >= 0 ? inst.players[author]?.name ?? null : null;
    };
    const rounds = bracketRounds(s.duels);

    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      submitted: s.entries.filter((entry) => entry !== null).length,
      prompt: s.prompt,
      duels: s.duels.map((d, i) => {
        const aEntry = resolveSlot(s, d.a);
        const bEntry = resolveSlot(s, d.b);
        const winnerSide: "a" | "b" | null =
          d.winner === null ? null : d.winner === aEntry ? "a" : d.winner === bEntry ? "b" : null;
        return {
          a: entryText(aEntry),
          b: entryText(bEntry),
          aPlayer: entryName(aEntry),
          bPlayer: entryName(bEntry),
          aEntry: aEntry >= 0 ? aEntry : null,
          bEntry: bEntry >= 0 ? bEntry : null,
          winner: d.winner !== null ? entryText(d.winner) : null,
          winnerSide,
          votesA: d.winner === null ? 0 : d.votes.filter((v) => v === "a").length,
          votesB: d.winner === null ? 0 : d.votes.filter((v) => v === "b").length,
          round: rounds[i] ?? 0,
          isFinal: i === s.duels.length - 1,
          done: d.winner !== null,
          aSlot: d.a,
          bSlot: d.b,
        };
      }),
      currentDuel: s.phase === "voting" ? s.current : null,
      reveal: s.reveal,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? bracketLeader(inst) : null,
      revealed,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as BracketInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && bracketLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "writing") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: s.prompt,
        maxLength: 80,
        hasSubmitted: s.entries[index] !== null,
        info: s.prompt,
      };
    }

    if (s.phase === "voting") {
      const seats = eligibleVoters(inst, s.current);
      if (!seats.includes(index)) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: "You are in this duel. Watch the voting." };
      }
      const sides = duelSides(s, s.current);
      const label = (idx: number): string => (idx >= 0 ? s.entries[idx]?.text ?? "" : "");
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [
          { id: "a", label: label(sides.a) },
          { id: "b", label: label(sides.b) },
        ],
        hasVoted: s.duels[s.current]?.votes[index] !== null,
        info: "Pick the better answer",
      };
    }

    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? "Bracket complete" : "" };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as BracketInstance;
    return {
      standings: standingsFromScores(
        inst.players.map((p, i) => ({ id: p.id, raw: inst.state.scores[i] })),
      ),
      stats: { ...inst.state.stats },
    };
  },
};

export default plugin;
