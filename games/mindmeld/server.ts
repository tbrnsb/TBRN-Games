/**
 * Mind Meld - server logic.
 * Everyone answers the same category with one word. Matching answers score. Match the whole table for a jackpot.
 *
 * Scoring (brief 4): 300 x f(N) per OTHER player who matches you, where
 * `f(N) = min(1, 3/(N-1))`. That is exactly 300 per match at 2-4 players and
 * `scalePayout(300, N)` per match from five up. A full-table match pays a fixed
 * 1000 to everyone and ends the game. From five players up, a round where
 * exactly one player differs also ends the game: the other N-1 players get 800
 * each. At 2-4 that shape keeps today's 300-per-match parity.
 */

import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { scalePayout, standingsFromScores, type GameResult } from "../../shared/scoring.ts";
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

interface Category { id: string; text: string; tags: string[]; safe: boolean }

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK: Category[] = JSON.parse(readFileSync(join(HERE, "content", "categories.json"), "utf8")) as Category[];

interface MindMeldState {
  mode: MindMeldMode;
  categories: Category[];
  round: number;
  maxRounds: number;
  phase: "collect" | "reveal" | "finished";
  answers: Array<string | null>;
  scores: number[];
  roundPoints: number[];
  allMatched: boolean;
  nearMatch: boolean;
  /** Per-player running count of other players who matched them. */
  matches: number[];
  /** Per-player count of rounds they topped (a tied top counts for each). */
  roundsWon: number[];
  timerMs: number;
}

type MindMeldMode = "standalone" | "rumble";

interface MindMeldInstance extends GameInstance { state: MindMeldState }

const COLLECT_MS = 20000;
const REVEAL_MS = 8000;
const MAX_LENGTH = 20;

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
/** Standalone keeps today's six rounds at 2-4 players. */
const STANDALONE_ROUNDS_SMALL = 6;
/** Five rounds from five players up, where a full table is unlikely. */
const STANDALONE_ROUNDS_LARGE = 5;
const RUMBLE_ROUNDS = 4;
/** Per-other-player match payout before the count scaling. */
const MATCH_POINTS = 300;
/** Fixed jackpot for a full-table match. */
const FULL_TABLE_POINTS = 1000;
/** Fixed payout to each of the N-1 matching players from five up. */
const NEAR_MATCH_POINTS = 800;

/**
 * Round count for a table: six at 2-4 (today's game), five from five up, and
 * four in the Rumble. Exported so the catalog and tests share one rule.
 */
export function mindmeldRounds(
  playerCount: number,
  mode: MindMeldMode = "standalone",
): number {
  if (mode === "rumble") return RUMBLE_ROUNDS;
  return playerCount >= 5 ? STANDALONE_ROUNDS_LARGE : STANDALONE_ROUNDS_SMALL;
}

const manifest: GameManifest = {
  id: "mindmeld",
  name: "Mind Meld",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
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

/** Result of scoring one round. */
export interface RoundScore {
  points: number[];
  /** Every player gave the same non-empty answer: the 1000 jackpot ends the game. */
  allMatched: boolean;
  /**
   * Five or more players, exactly one submitted answer differs: the other N-1
   * players take 800 each and the game ends. Always false at 2-4 players so
   * those totals stay identical to today's game.
   */
  nearMatch: boolean;
  /** How many OTHER players each player matched this round. */
  matches: number[];
}

/**
 * Pure scoring: 300 x f(N) per other player who matches you, a fixed 1000-each
 * jackpot for a full table, and (from five players up) a fixed 800 each for an
 * N-1 match that ends the game.
 *
 * A missing answer is not a "differing" answer for the N-1 rule: a timeout must
 * not end the game, so the rule only fires when the odd player submitted
 * something else.
 */
export function scoreRound(raw: string[]): RoundScore {
  const normalized = raw.map(normalizeAnswer);
  const playerCount = raw.length;
  const valid = normalized.filter((a) => a.length > 0);

  if (playerCount > 1 && valid.length === playerCount && new Set(valid).size === 1) {
    return {
      points: raw.map(() => FULL_TABLE_POINTS),
      allMatched: true,
      nearMatch: false,
      matches: raw.map(() => playerCount - 1),
    };
  }

  if (playerCount >= 5) {
    const counts = new Map<string, number>();
    for (const answer of normalized) {
      if (!answer) continue;
      counts.set(answer, (counts.get(answer) ?? 0) + 1);
    }
    for (const [answer, count] of counts) {
      if (count !== playerCount - 1) continue;
      const oddIndex = normalized.findIndex((other) => other !== answer);
      if (oddIndex === -1 || normalized[oddIndex].length === 0) continue;
      return {
        points: normalized.map((other) => (other === answer ? NEAR_MATCH_POINTS : 0)),
        allMatched: false,
        nearMatch: true,
        matches: normalized.map((other) => (other === answer ? playerCount - 2 : 0)),
      };
    }
  }

  const perMatch = scalePayout(MATCH_POINTS, playerCount);
  const matches = normalized.map((answer, i) => {
    if (!answer) return 0;
    let count = 0;
    for (let j = 0; j < normalized.length; j++) {
      if (j !== i && normalized[j] === answer) count++;
    }
    return count;
  });
  return {
    points: matches.map((count) => count * perMatch),
    allMatched: false,
    nearMatch: false,
    matches,
  };
}

function mindmeldBegin(instance: MindMeldInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.answers = instance.players.map(() => null);
  s.roundPoints = instance.players.map(() => 0);
  s.allMatched = false;
  s.nearMatch = false;
  s.timerMs = COLLECT_MS;
  s.phase = "collect";
}

function mindmeldSettle(instance: MindMeldInstance): void {
  const s = instance.state;
  const raw = s.answers.map((a) => (typeof a === "string" ? a : ""));
  const { points, allMatched, nearMatch, matches } = scoreRound(raw);
  points.forEach((p, i) => { s.scores[i] += p; });
  matches.forEach((count, i) => { s.matches[i] += count; });
  const best = Math.max(...points);
  if (best > 0) {
    points.forEach((p, i) => { if (p === best) s.roundsWon[i] += 1; });
  }
  s.roundPoints = points;
  s.allMatched = allMatched;
  s.nearMatch = nearMatch;
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const mode: MindMeldMode = options?.mode === "rumble" ? "rumble" : "standalone";
    const maxRounds = mindmeldRounds(players.length, mode);
    return {
      roomId: room.id,
      players,
      state: {
        mode,
        categories: secureShuffle(PACK.filter((c) => c.safe)).slice(0, maxRounds),
        round: 0,
        maxRounds,
        phase: "collect",
        answers: players.map(() => null),
        scores: players.map(() => 0),
        roundPoints: players.map(() => 0),
        allMatched: false,
        nearMatch: false,
        matches: players.map(() => 0),
        roundsWon: players.map(() => 0),
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
    // A full table or an N-1 match (from five players up) ends the game here.
    if (s.allMatched || s.nearMatch) { s.phase = "finished"; return; }
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
      mode: s.mode,
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      category: category?.text ?? "",
      submitted: s.answers.filter((a) => a !== null).length,
      playerCount: inst.players.length,
      waitingOn: mindmeldWaitingOn(inst),
      // Answers stay hidden until the reveal. The reveal publishes one row per
      // player, so the TV grid has all eight cells at the eight-seat table.
      answers: revealed
        ? inst.players.map((p, i) => ({
            name: p.name,
            answer: s.answers[i] ?? "",
            points: s.roundPoints[i],
            seat: i,
          }))
        : [],
      allMatched: s.phase === "reveal" && s.allMatched,
      nearMatch: s.phase === "reveal" && s.nearMatch,
      caption: mindmeldCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
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
        // One short word: the server caps the input and scores the normalised text.
        maxLength: MAX_LENGTH,
        hasSubmitted: s.answers[index] !== null,
        info: category?.text ?? "",
      };
    }
    const result = s.allMatched
      ? "Full mind meld! +1000 each"
      : s.nearMatch
        ? "So close! +800 each"
        : "No jackpot this round";
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      roundPoints: s.roundPoints[index] ?? 0,
      info: result,
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as MindMeldInstance;
    const s = inst.state;
    const stats: Record<string, number> = {};
    inst.players.forEach((player, index) => {
      stats[playerStatKey(player.id, "matches")] = s.matches[index] ?? 0;
      stats[playerStatKey(player.id, "roundsWon")] = s.roundsWon[index] ?? 0;
    });
    return {
      standings: standingsFromScores(
        inst.players.map((player, index) => ({ id: player.id, raw: s.scores[index] })),
      ),
      stats,
    };
  },
};

/** Names the TV is waiting on during collection. */
function mindmeldWaitingOn(instance: MindMeldInstance): string[] {
  const s = instance.state;
  if (s.phase !== "collect") return [];
  return instance.players
    .filter((_, index) => s.answers[index] === null)
    .map((player) => player.name);
}

/** Reveal caption from the fixed bank; it never names an answer. */
function mindmeldCaption(instance: MindMeldInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal") return null;
  return captionFor({ kind: "reveal", seed: s.round });
}

function mindmeldLeader(instance: MindMeldInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

export default plugin;
