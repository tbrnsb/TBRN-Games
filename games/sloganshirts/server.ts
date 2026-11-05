/**
 * Slogan Shirts - server logic.
 * Draw a design, write a slogan, then everyone gets someone else's slogan on their shirt and you vote for the best.
 *
 * Player range is 3-8. At 3 and 4 players the original two rounds are kept
 * exactly (the same cyclic slogan shift and the same 1000 / 100 scoring), so
 * those totals stay identical to the pre-expansion game. From five players the
 * game is one full cycle: every player makes one design and writes one slogan,
 * and one round shows N shirts. A Rumble at 5-8 still runs one round but caps
 * the TV at four shirts: four design seats are chosen by secure random while
 * everyone writes a slogan, so every player can still score as an author.
 *
 * Slogans rotate with a cyclic shift (design i carries slogan i + 1), so nobody
 * ever votes for a shirt built from their own design and no design carries its
 * own slogan at any N >= 3.
 *
 * Scoring: the winning shirt pays each of its two authors a fixed 1000. Every
 * other shirt pays each author `scalePayout(100, N)` per vote. From five
 * players up one player's round gain is capped at `MAX_ROUND_SCORE`, because a
 * player can author two winning shirts (design one, carry another's slogan).
 */

import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import {
  MAX_ROUND_SCORE,
  scalePayout,
  standingsFromScores,
  type GameResult,
} from "../../shared/scoring.ts";
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

interface ShirtStroke { points: Array<[number, number]>; color: string }

type ShirtMode = "standalone" | "rumble";

interface ShirtState {
  mode: ShirtMode;
  round: number;
  maxRounds: number;
  /** Seats whose design is used this game. All seats outside a 5-8 Rumble. */
  designers: number[];
  phase: "draw" | "slogan" | "vote" | "reveal" | "finished";
  designs: Array<ShirtStroke[] | null>;
  slogans: Array<string | null>;
  /** Design seats that have tapped "done" in the current round. */
  done: boolean[];
  shirts: Array<{ design: number; slogan: number }>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { winners: number[]; rows: Array<{ text: string; votes: number }> } | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface ShirtInstance extends GameInstance { state: ShirtState }

const DRAW_MS = 60000;
const SLOGAN_MS = 30000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_SLOGAN = 40;

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** The original game: two rounds at 3-4 players, kept for parity. */
const LEGACY_ROUNDS = 2;
/** Brief 4: a Rumble shows at most four shirts. */
const RUMBLE_SHIRT_CAP = 4;
/** The cap only applies from this many players; 3-4 totals stay identical. */
const CAP_MIN_PLAYERS = 5;

const WIN_SHIRT_POINTS = 1000;
const PER_VOTE_POINTS = 100;

const manifest: GameManifest = {
  id: "sloganshirts",
  name: "Slogan Shirts",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "canvas",
  description: "Draw a design, write a slogan, then everyone gets someone else's slogan on their shirt and you vote for the best.",
};

function clampPlayerCount(playerCount: number): number {
  if (!Number.isFinite(playerCount)) return 0;
  return Math.max(0, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
}

export interface ShirtPlan {
  rounds: number;
  /** Seats whose designs are used, in ascending seat order. */
  designers: number[];
}

/**
 * Round plan for a table of `playerCount`.
 *
 * 3-4 keep the original two rounds. From five players the game is one full
 * cycle (one round with N shirts). A Rumble at 5-8 also runs one round but uses
 * four design seats chosen by secure random, per brief 4's "max 4 shirts".
 */
export function shirtPlan(playerCount: number, mode: ShirtMode = "standalone"): ShirtPlan {
  const count = clampPlayerCount(playerCount);
  const seats = Array.from({ length: count }, (_, index) => index);
  const rounds = Math.max(1, count <= 4 ? Math.min(LEGACY_ROUNDS, count) : 1);

  if (mode === "rumble" && count > 4) {
    const designers = secureShuffle(seats).slice(0, RUMBLE_SHIRT_CAP).sort((a, b) => a - b);
    return { rounds, designers };
  }
  return { rounds, designers: seats };
}

/**
 * Pair designs with slogans by a cyclic shift.
 *
 * `designerSeats` defaults to every seat, which is the standalone plan. The
 * "+1 seat" shift means no design carries its own slogan and every slogan in
 * the design set is used exactly once.
 */
export function buildShirts(
  playerCount: number,
  designerSeats?: readonly number[],
): Array<{ design: number; slogan: number }> {
  const count = Math.max(0, Math.floor(playerCount));
  if (count < 2) return [];
  const seats = designerSeats
    ? [...new Set(designerSeats)].filter((seat) => Number.isInteger(seat) && seat >= 0 && seat < count)
    : Array.from({ length: count }, (_, index) => index);
  return seats
    .sort((a, b) => a - b)
    .map((design) => ({ design, slogan: (design + 1) % count }));
}

/**
 * TV grid for the shirts: one row up to four, then four columns and as many
 * rows as needed. Eight shirts are the brief's 4x2 grid.
 */
export function shirtLayout(shirtCount: number): { columns: number; rows: number } {
  const count = Number.isFinite(shirtCount) ? Math.max(0, Math.floor(shirtCount)) : 0;
  if (count === 0) return { columns: 0, rows: 0 };
  if (count <= 4) return { columns: count, rows: 1 };
  return { columns: 4, rows: Math.ceil(count / 4) };
}

/**
 * Apply a round's votes.
 *
 * A top shirt pays each author a fixed 1000; every other shirt pays each author
 * `scalePayout(100, N)` per vote. Ties at the top pay 1000 to every tied shirt,
 * exactly as before. From five players up each player's round gain is capped at
 * `MAX_ROUND_SCORE`; at 3-4 there is no cap, so old totals stay identical.
 */
export function scoreShirts(
  votes: Array<number | null>,
  shirts: Array<{ design: number; slogan: number }>,
  playerCount: number,
): number[] {
  const count = Math.max(0, Math.floor(playerCount));
  const tally = new Array<number>(shirts.length).fill(0);
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= shirts.length) continue;
    tally[vote]++;
  }
  const max = tally.length ? Math.max(...tally) : 0;
  const points = new Array<number>(count).fill(0);
  const perVote = scalePayout(PER_VOTE_POINTS, count);

  tally.forEach((voteCount, shirtIndex) => {
    if (voteCount <= 0) return;
    const shirt = shirts[shirtIndex];
    if (!shirt) return;
    if (
      !Number.isInteger(shirt.design) || shirt.design < 0 || shirt.design >= count ||
      !Number.isInteger(shirt.slogan) || shirt.slogan < 0 || shirt.slogan >= count
    ) {
      return;
    }
    const per = voteCount === max && max > 0 ? WIN_SHIRT_POINTS : perVote * voteCount;
    points[shirt.design] += per;
    points[shirt.slogan] += per;
  });

  if (count >= CAP_MIN_PLAYERS) {
    for (let i = 0; i < points.length; i++) {
      points[i] = Math.min(points[i], MAX_ROUND_SCORE);
    }
  }
  return points;
}

function leaderName(instance: ShirtInstance): string | null {
  const s = instance.state;
  let best = -1;
  let index = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; index = i; } });
  return index >= 0 ? instance.players[index]?.name ?? null : null;
}

function bumpStat(state: ShirtState, playerId: string | undefined, stat: "votesReceived" | "shirtsWon", amount: number): void {
  if (!playerId) return;
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + amount;
}

function beginRound(instance: ShirtInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.designs = instance.players.map(() => null);
  s.slogans = instance.players.map(() => null);
  s.done = instance.players.map(() => false);
  s.shirts = [];
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = DRAW_MS;
  s.phase = "draw";
}

function enterVote(instance: ShirtInstance): void {
  const s = instance.state;
  s.shirts = buildShirts(instance.players.length, s.designers);
  s.phase = "vote";
  s.timerMs = VOTE_MS;
}

function settle(instance: ShirtInstance): void {
  const s = instance.state;
  const points = scoreShirts(s.votes, s.shirts, instance.players.length);
  points.forEach((p, i) => { s.scores[i] += p; });

  const tally = s.shirts.map((_, i) => s.votes.filter((vote) => vote === i).length);
  const max = tally.length ? Math.max(...tally) : 0;

  tally.forEach((voteCount, shirtIndex) => {
    if (voteCount <= 0) return;
    const shirt = s.shirts[shirtIndex];
    if (!shirt) return;
    bumpStat(s, instance.players[shirt.design]?.id, "votesReceived", voteCount);
    bumpStat(s, instance.players[shirt.slogan]?.id, "votesReceived", voteCount);
  });
  if (max > 0) {
    tally.forEach((voteCount, shirtIndex) => {
      if (voteCount !== max) return;
      const shirt = s.shirts[shirtIndex];
      if (!shirt) return;
      bumpStat(s, instance.players[shirt.design]?.id, "shirtsWon", 1);
      bumpStat(s, instance.players[shirt.slogan]?.id, "shirtsWon", 1);
    });
  }

  const winners = max > 0
    ? tally.map((voteCount, i) => (voteCount === max ? i : -1)).filter((i) => i >= 0)
    : [];
  s.reveal = {
    winners,
    rows: s.shirts.map((shirt, i) => ({ text: s.slogans[shirt.slogan] ?? "", votes: tally[i] })),
  };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

function isDesigner(state: ShirtState, seat: number): boolean {
  return state.designers.includes(seat);
}

/** Who the TV is waiting on in the current phase. */
function waitingNames(instance: ShirtInstance): string[] {
  const s = instance.state;
  if (s.phase === "draw") {
    return s.designers
      .filter((seat) => !s.done[seat])
      .map((seat) => instance.players[seat]?.name ?? "");
  }
  if (s.phase === "slogan") {
    return instance.players
      .filter((_, i) => s.slogans[i] === null)
      .map((player) => player.name);
  }
  if (s.phase === "vote") {
    return instance.players
      .filter((_, i) => s.votes[i] === null)
      .map((player) => player.name);
  }
  return [];
}

/** A public reveal line naming the top shirt's design author. */
function revealCaption(instance: ShirtInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  const winner = s.reveal.winners[0];
  if (winner === undefined) return captionFor({ kind: "reveal", seed: s.round });
  const row = s.reveal.rows[winner];
  const design = s.shirts[winner]?.design;
  if (!row || row.votes <= 0 || design === undefined) {
    return captionFor({ kind: "reveal", seed: s.round });
  }
  return captionFor({
    kind: "favourite",
    name: instance.players[design]?.name,
    count: row.votes,
    seed: s.round,
  });
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const mode: ShirtMode = options?.mode === "rumble" ? "rumble" : "standalone";
    const plan = shirtPlan(players.length, mode);
    const instance: ShirtInstance = {
      roomId: room.id,
      players,
      state: {
        mode,
        round: 0,
        maxRounds: plan.rounds,
        designers: plan.designers,
        phase: "draw",
        designs: players.map(() => null),
        slogans: players.map(() => null),
        done: players.map(() => false),
        shirts: [],
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: DRAW_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.flatMap((player): Array<[string, number]> => [
            [playerStatKey(player.id, "votesReceived"), 0],
            [playerStatKey(player.id, "shirtsWon"), 0],
          ]),
        ),
      } satisfies ShirtState,
    };
    // Round 1 goes through the same path as every later round.
    beginRound(instance, 0);
    return instance;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { stroke?: { points?: unknown; color?: unknown }; action?: unknown; text?: unknown; choice?: unknown } | null;

    if (s.phase === "draw") {
      if (!isDesigner(s, index)) return;
      if (raw?.stroke && Array.isArray(raw.stroke.points)) {
        const points = (raw.stroke.points as unknown[])
          .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number")
          .slice(0, 300)
          .map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [number, number]);
        if (points.length < 2) return;
        if (!s.designs[index]) s.designs[index] = [];
        s.designs[index].push({ points, color: typeof raw.stroke.color === "string" ? raw.stroke.color : "#111111" });
        if (s.designs[index].length > 200) s.designs[index].shift();
        return;
      }
      if (raw?.action === "action") {
        if (!s.designs[index] || s.designs[index].length === 0) {
          s.designs[index] = [{ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" }];
        }
        s.done[index] = true;
        if (s.designers.every((seat) => s.done[seat])) {
          s.phase = "slogan";
          s.timerMs = SLOGAN_MS;
        }
      }
      return;
    }

    if (s.phase === "slogan") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.slogans[index] === null) {
        s.slogans[index] = raw.text.trim().slice(0, MAX_SLOGAN);
        if (s.slogans.every((text) => text !== null)) enterVote(inst);
      }
      return;
    }

    if (s.phase === "vote") {
      if (typeof raw?.choice !== "string" || !raw.choice.startsWith("s:")) return;
      const target = Number(raw.choice.slice(2));
      if (!Number.isInteger(target) || target < 0 || target >= s.shirts.length) return;
      const shirt = s.shirts[target];
      // Only the design's owner is barred: with three players, excluding the
      // slogan author too would leave every voter exactly one option.
      if (shirt.design === index) return;
      s.votes[index] = target;
      if (s.votes.every((vote) => vote !== null)) settle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "draw") {
      s.designers.forEach((seat) => {
        if (!s.designs[seat] || s.designs[seat]!.length === 0) {
          s.designs[seat] = [{ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" }];
        }
        s.done[seat] = true;
      });
      s.phase = "slogan";
      s.timerMs = SLOGAN_MS;
      return;
    }
    if (s.phase === "slogan") {
      inst.players.forEach((_, i) => { if (!s.slogans[i]) s.slogans[i] = "no slogan"; });
      enterVote(inst);
      return;
    }
    if (s.phase === "vote") { settle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    beginRound(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    const plannedShirts = s.mode === "rumble" && instance.players.length > 4
      ? RUMBLE_SHIRT_CAP
      : instance.players.length;
    const layout = shirtLayout(s.shirts.length || plannedShirts);
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      // Explicit "shirt X of N" fields for the TV header.
      shirtNumber: s.round + 1,
      totalShirts: s.maxRounds,
      // Eight shirts are the 4x2 grid from brief 4; four or fewer are one row.
      columns: layout.columns,
      rows: layout.rows,
      shirts: s.shirts.map((shirt, i) => ({
        id: `s:${i}`,
        design: s.designs[shirt.design] ?? [],
        slogan: s.slogans[shirt.slogan] ?? "",
        votes: revealed ? (s.reveal?.rows[i]?.votes ?? 0) : null,
        author: revealed ? inst.players[shirt.design]?.name ?? null : null,
        sloganAuthor: revealed ? inst.players[shirt.slogan]?.name ?? null : null,
      })),
      reveal: s.reveal,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      shirtNumber: s.round + 1,
      totalShirts: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && leaderName(inst) === inst.players[index].name,
    };

    if (s.phase === "draw") {
      if (!isDesigner(s, index)) {
        return {
          ...base,
          mode: "wait",
          controllerType: "choice",
          options: [],
          info: "Four shirts this round. Watch the TV.",
        };
      }
      if (s.done[index]) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Design sent." };
      }
      return { ...base, mode: "canvas", controllerType: "canvas", canvas: { prompt: "Design a t-shirt", color: "#111111", disabled: false } };
    }
    if (s.phase === "slogan") {
      return { ...base, mode: "text", controllerType: "text", placeholder: "The slogan", maxLength: MAX_SLOGAN, hasSubmitted: s.slogans[index] !== null, info: "Write a short slogan" };
    }
    if (s.phase === "vote") {
      const options = s.shirts
        .map((shirt, i) => ({ id: `s:${i}`, label: s.slogans[shirt.slogan] ?? "" }))
        .filter((_, i) => s.shirts[i].design !== index);
      return { ...base, mode: "choice", controllerType: "choice", options, hasVoted: s.votes[index] !== null, info: "Best shirt?" };
    }
    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? "Round complete" : "" };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as ShirtInstance;
    return {
      standings: standingsFromScores(
        inst.players.map((player, i) => ({ id: player.id, raw: inst.state.scores[i] })),
      ),
      stats: { ...inst.state.stats },
    };
  },
};

export default plugin;
