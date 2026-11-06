/**
 * Percentile - server logic.
 * One player estimates a real statistic on a slider. Everyone else bets higher
 * or lower. Close guess, big score.
 *
 * Flow (brief 4): the guesser estimates before the others bet, and the bettors
 * never see the guess until the reveal. The guesser rotates by seat each round.
 *
 * Scoring keeps today's rule exactly: an exact guess pays 1000, a guess within
 * 15 pays `1000 - 50 * distance`, and anything further scores 0. A correct
 * directional bet pays 500, plus 200 more when the guesser missed by more than
 * 20. Nothing here scales by table size, because the payouts are fixed and the
 * 3-4 player totals must stay identical.
 *
 * Rounds: five standalone (today's count) and four in the Rumble. The host
 * option `guessOnce: true` runs `N` standalone rounds so every player guesses
 * exactly once at the eight-seat table.
 */

import { readFileSync } from "node:fs";
import { captionFor } from "../../shared/interlude.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores, type GameResult } from "../../shared/scoring.ts";
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

/** One statistic from the content pack. */
export interface PercentilePrompt {
  id: string;
  text: string;
  /** The true value on the slider's 0-100 scale. */
  value: number;
  /** Display unit for the value and the slider readout. */
  unit: string;
  source: string;
  year: number;
}

export type PercentileMode = "standalone" | "rumble";
export type PercentileBet = "higher" | "lower";

interface PackFile {
  stats?: unknown;
}

interface PromptSource {
  id?: unknown;
  text?: unknown;
  value?: unknown;
  unit?: unknown;
  source?: unknown;
  year?: unknown;
}

const PACK_URL = new URL("../../packs/percentile-stats.json", import.meta.url);
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
/** Today's standalone count, kept for 2-4 parity. */
const STANDALONE_ROUNDS = 5;
const RUMBLE_ROUNDS = 4;

const GUESS_MS = 30000;
const BET_MS = 15000;
const REVEAL_MS = 7000;

/** Exact guess. */
export const EXACT_POINTS = 1000;
/** A guess inside this distance still scores. */
export const CLOSE_WINDOW = 15;
/** Points lost per unit of distance inside the window. */
export const CLOSE_STEP = 50;
/** A correct directional bet. */
export const BET_POINTS = 500;
/** Extra for a correct bet when the guess was far enough away. */
export const BET_BONUS = 200;
/** The miss distance that unlocks the bet bonus. */
export const BET_BONUS_DISTANCE = 20;

/** Read a pack entry, dropping anything without the required metadata. */
function toPrompt(raw: unknown, index: number): PercentilePrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as PromptSource;
  const text = typeof entry.text === "string" ? entry.text.trim() : "";
  const unit = typeof entry.unit === "string" ? entry.unit.trim() : "";
  const source = typeof entry.source === "string" ? entry.source.trim() : "";
  const value = typeof entry.value === "number" ? entry.value : Number(entry.value);
  const year = typeof entry.year === "number" ? entry.year : Number(entry.year);
  if (!text || !unit || !source || !Number.isFinite(value) || !Number.isInteger(year)) return null;
  return {
    id: typeof entry.id === "string" && entry.id.length > 0 ? entry.id : `stat-${index + 1}`,
    text,
    value,
    unit,
    source,
    year,
  };
}

function loadPrompts(): PercentilePrompt[] {
  const pack = JSON.parse(readFileSync(PACK_URL, "utf8")) as PackFile;
  const stats = Array.isArray(pack.stats) ? pack.stats : [];
  const prompts = stats
    .map((entry, index) => toPrompt(entry, index))
    .filter((entry): entry is PercentilePrompt => entry !== null);
  if (prompts.length === 0) throw new Error("percentile-stats content pack has no usable statistics");
  return prompts;
}

/** The authored statistics, loaded once at module init. */
export const PROMPT_PACK: readonly PercentilePrompt[] = loadPrompts();

interface PercentileReveal {
  guess: number;
  actual: number;
  delta: number;
  points: number;
  unit: string;
  source: string;
  year: number;
}

interface PercentileState {
  prompts: PercentilePrompt[];
  round: number;
  maxRounds: number;
  phase: "guessing" | "betting" | "reveal" | "finished";
  guesser: number;
  guess: number | null;
  bets: Array<PercentileBet | null>;
  scores: number[];
  timerMs: number;
  reveal: PercentileReveal | null;
  /** Per-player running totals for `results()`. */
  betsMade: number[];
  betsCorrect: number[];
  guessesMade: number[];
  guessesWithinWindow: number[];
}

interface PercentileInstance extends GameInstance { state: PercentileState }

const manifest: GameManifest = {
  id: "percentile",
  name: "Percentile",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "slider",
  description: "One player estimates a real statistic on a slider. Everyone else bets higher or lower. Closer guess, bigger score.",
};

/**
 * Rounds for a table: four in the Rumble, otherwise five (today's count) or,
 * with the host's "Everyone guesses once" setting, one per player.
 *
 * Exported so the catalog and tests share one rule.
 */
export function percentileRounds(
  playerCount: number,
  mode: PercentileMode = "standalone",
  guessOnce = false,
): number {
  if (mode === "rumble") return RUMBLE_ROUNDS;
  if (guessOnce) return Math.max(1, Math.floor(Number.isFinite(playerCount) ? playerCount : 1));
  return STANDALONE_ROUNDS;
}

/** Round a slider reading to the integer 0-100 scale. */
export function normaliseGuess(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** Points for a guess: 1000 exact, then `1000 - 50 * distance` inside 15. */
export function guessPoints(guess: number, actual: number): number {
  const delta = Math.abs(normaliseGuess(guess) - actual);
  if (delta === 0) return EXACT_POINTS;
  if (delta > CLOSE_WINDOW) return 0;
  return Math.max(0, EXACT_POINTS - CLOSE_STEP * delta);
}

/** Points for one directional bet: 0 wrong, 500 right, 700 on a miss over 20. */
export function betScore(guess: number, actual: number, bet: PercentileBet): number {
  const safeGuess = normaliseGuess(guess);
  const delta = Math.abs(safeGuess - actual);
  const correct = (actual > safeGuess && bet === "higher") || (actual < safeGuess && bet === "lower");
  if (!correct) return 0;
  return delta > BET_BONUS_DISTANCE ? BET_POINTS + BET_BONUS : BET_POINTS;
}

/** The applied result of one round, before it is written into the scores. */
export interface RoundSettlement {
  guess: number;
  actual: number;
  delta: number;
  guessPoints: number;
  /** Per-seat bet payout; 0 for the guesser, a missing bet or a wrong bet. */
  betPoints: number[];
  /** Per-seat flag for a correct directional bet. */
  correctBets: boolean[];
}

/** Pure round scoring, shared by the game and the tests. */
export function settleRound(
  guess: number,
  actual: number,
  bets: readonly (PercentileBet | null)[],
): RoundSettlement {
  const safeGuess = normaliseGuess(guess);
  const betPoints = bets.map((bet) => (bet === null ? 0 : betScore(safeGuess, actual, bet)));
  return {
    guess: safeGuess,
    actual,
    delta: Math.abs(safeGuess - actual),
    guessPoints: guessPoints(safeGuess, actual),
    betPoints,
    correctBets: betPoints.map((points) => points > 0),
  };
}

function promptFor(instance: PercentileInstance): PercentilePrompt {
  const s = instance.state;
  return s.prompts[s.round % s.prompts.length] ?? s.prompts[0];
}

function leaderName(instance: PercentileInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function beginRound(instance: PercentileInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.guesser = round % instance.players.length;
  s.guess = null;
  s.bets = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = GUESS_MS;
  s.phase = "guessing";
}

function everyoneBet(instance: PercentileInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => i === s.guesser || s.bets[i] !== null);
}

function settle(instance: PercentileInstance): void {
  const s = instance.state;
  const prompt = promptFor(instance);
  const guess = s.guess ?? 50;
  const round = settleRound(guess, prompt.value, s.bets);

  s.guess = round.guess;
  s.scores[s.guesser] += round.guessPoints;
  s.guessesMade[s.guesser] += 1;
  if (round.delta <= CLOSE_WINDOW) s.guessesWithinWindow[s.guesser] += 1;

  for (let i = 0; i < instance.players.length; i++) {
    if (i === s.guesser) continue;
    if (s.bets[i] === null) continue;
    s.betsMade[i] += 1;
    if (round.correctBets[i]) {
      s.scores[i] += round.betPoints[i];
      s.betsCorrect[i] += 1;
    }
  }

  s.reveal = {
    guess: round.guess,
    actual: round.actual,
    delta: round.delta,
    points: round.guessPoints,
    unit: prompt.unit,
    source: prompt.source,
    year: prompt.year,
  };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/** Names the TV is waiting on for the current phase. */
function waitingOn(instance: PercentileInstance): string[] {
  const s = instance.state;
  if (s.phase === "guessing") {
    const guesser = instance.players[s.guesser];
    return guesser ? [guesser.name] : [];
  }
  if (s.phase === "betting") {
    return instance.players
      .filter((_, index) => index !== s.guesser && s.bets[index] === null)
      .map((player) => player.name);
  }
  return [];
}

/** Reveal caption from the fixed bank; it can never carry the answer. */
function revealCaption(instance: PercentileInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal") return null;
  return captionFor({ kind: "reveal", seed: s.round });
}

function ratio(correct: number, total: number): number {
  return total > 0 ? correct / total : 0;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const mode: PercentileMode = options?.mode === "rumble" ? "rumble" : "standalone";
    const guessOnce = options?.guessOnce === true;
    // A preset Rumble passes four rounds; standalone keeps five (or N when the
    // host asks everyone to guess once).
    const maxRounds = roundsOption(options) ?? percentileRounds(players.length, mode, guessOnce);
    return {
      roomId: room.id,
      players,
      state: {
        prompts: secureShuffle([...PROMPT_PACK]).slice(0, maxRounds),
        round: 0,
        maxRounds,
        phase: "guessing",
        guesser: 0,
        guess: null,
        bets: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: GUESS_MS,
        reveal: null,
        betsMade: players.map(() => 0),
        betsCorrect: players.map(() => 0),
        guessesMade: players.map(() => 0),
        guessesWithinWindow: players.map(() => 0),
      } satisfies PercentileState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as PercentileInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;

    const raw = input as { slider?: { value?: unknown }; action?: unknown; choice?: unknown } | null;

    if (s.phase === "guessing" && index === s.guesser) {
      if (raw?.slider && typeof raw.slider.value === "number" && Number.isFinite(raw.slider.value)) {
        s.guess = normaliseGuess(raw.slider.value * 100);
        return;
      }
      if (raw?.action === "action" && s.guess !== null) {
        s.phase = "betting";
        s.timerMs = BET_MS;
      }
      return;
    }

    if (s.phase === "betting" && index !== s.guesser) {
      if (raw?.choice === "higher" || raw?.choice === "lower") {
        if (s.bets[index] === null) s.bets[index] = raw.choice;
        if (everyoneBet(inst)) settle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as PercentileInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const step = Number.isFinite(deltaMs) ? Math.min(Math.max(deltaMs, 0), 2000) : 0;
    s.timerMs -= step;
    if (s.timerMs > 0) return;

    if (s.phase === "guessing") {
      if (s.guess === null) s.guess = 50;
      s.phase = "betting";
      s.timerMs = BET_MS;
      return;
    }
    if (s.phase === "betting") {
      settle(inst);
      return;
    }
    if (s.phase === "reveal") {
      const next = s.round + 1;
      if (next >= s.maxRounds) {
        s.phase = "finished";
        return;
      }
      beginRound(inst, next);
    }
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as PercentileInstance;
    const s = inst.state;
    const prompt = promptFor(inst);
    const shown = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      question: prompt.text,
      unit: prompt.unit,
      guesserName: inst.players[s.guesser]?.name ?? "",
      guesserSeat: s.guesser,
      // The guess and the answer stay off the shared screen until the reveal.
      guess: shown ? s.guess : null,
      actual: shown ? prompt.value : null,
      delta: shown ? s.reveal?.delta ?? null : null,
      reveal: s.reveal,
      source: shown ? prompt.source : null,
      year: shown ? prompt.year : null,
      waitingOn: waitingOn(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i], seat: i })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as PercentileInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const prompt = promptFor(inst);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && leaderName(inst) === inst.players[index].name,
    };

    if (s.phase === "guessing") {
      if (index === s.guesser) {
        return {
          ...base,
          mode: "slider",
          controllerType: "slider",
          slider: {
            axis: "x",
            value: (s.guess ?? 50) / 100,
            label: "Your estimate",
            unit: prompt.unit,
            readout: `${s.guess ?? 50}${prompt.unit}`,
            min: 0,
            max: 100,
          },
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        unit: prompt.unit,
        info: `${inst.players[s.guesser].name} is estimating...`,
      };
    }

    if (s.phase === "betting") {
      if (index === s.guesser) {
        return {
          ...base,
          mode: "wait",
          controllerType: "choice",
          options: [],
          unit: prompt.unit,
          info: `You guessed ${s.guess}${prompt.unit}. Everyone else is betting.`,
        };
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [
          { id: "higher", label: "HIGHER" },
          { id: "lower", label: "LOWER" },
        ],
        hasVoted: s.bets[index] !== null,
        unit: prompt.unit,
        // The guess is withheld from the betting phone until the reveal.
        info: "Bet before the guess is revealed.",
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      unit: prompt.unit,
      guess: s.reveal?.guess ?? null,
      actual: s.reveal?.actual ?? null,
      delta: s.reveal?.delta ?? null,
      source: s.reveal?.source ?? null,
      year: s.reveal?.year ?? null,
      info: `The answer was ${s.reveal?.actual ?? prompt.value}${prompt.unit}`,
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as PercentileInstance;
    const s = inst.state;
    const stats: Record<string, number> = {};
    inst.players.forEach((player, index) => {
      // Both are 0..1 fractions; a player who never held that role reports 0.
      stats[playerStatKey(player.id, "betAccuracy")] = ratio(s.betsCorrect[index] ?? 0, s.betsMade[index] ?? 0);
      stats[playerStatKey(player.id, "guessAccuracy")] = ratio(
        s.guessesWithinWindow[index] ?? 0,
        s.guessesMade[index] ?? 0,
      );
    });
    return {
      standings: standingsFromScores(
        inst.players.map((player, index) => ({ id: player.id, raw: s.scores[index] })),
      ),
      stats,
    };
  },
};

export default plugin;
