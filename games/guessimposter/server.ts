/**
 * Guess the Imposter - server logic (brief section 5).
 *
 * Everyone gets the same secret word except the Imposter(s), who are told they
 * are the Imposter. Clue turns, discussion, then a simultaneous vote. An
 * ejected Imposter gets one multiple-choice final guess. The optional Larper
 * is on the crew side but sees a lookalike word; their phone payload is built
 * by exactly the same code path as a crew member's, so it has the same shape.
 *
 * Privacy: the current word, the lookalike, the decoys and every role stay out
 * of `screenState()` until the word reaches its reveal phase. Votes and who
 * voted for whom are withheld until the vote reveal. Phones only ever receive
 * their own card/word.
 *
 * All randomness (roles, word order, clue order, decoys, final-guess options)
 * uses `shared/secure-random.ts`. Timers use the server clock (`onTick`).
 */

import { readFileSync } from "node:fs";
import { captionFor } from "../../shared/interlude.ts";
import { secureChoice, secureShuffle } from "../../shared/secure-random.ts";
import { playerStatKey } from "../../shared/results.ts";
import {
  MAX_ROUND_SCORE,
  standingsFromScores,
  type GameResult,
} from "../../shared/scoring.ts";

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
  | "role";

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  presence?: "active" | "away" | "left";
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

// --- Content --------------------------------------------------------------

/** One entry from `content/words.json`. */
export interface ImposterEntry {
  category: string;
  word: string;
  lookalike: string;
  decoys: string[];
}

const PACK_URL = new URL("./content/words.json", import.meta.url);

function isEntry(value: unknown): value is ImposterEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.category === "string" &&
    typeof entry.word === "string" &&
    typeof entry.lookalike === "string" &&
    Array.isArray(entry.decoys) &&
    entry.decoys.length >= 1 &&
    entry.decoys.every((decoy) => typeof decoy === "string")
  );
}

function loadContent(): ImposterEntry[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(PACK_URL, "utf8"));
    const entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    return entries.length > 0 ? entries : [FALLBACK_ENTRY];
  } catch {
    return [FALLBACK_ENTRY];
  }
}

/** Keeps the server alive if the pack is missing; the pack ships validated. */
const FALLBACK_ENTRY: ImposterEntry = {
  category: "Foods",
  word: "Pizza",
  lookalike: "Flatbread",
  decoys: ["Burger", "Pasta", "Soup", "Toast", "Salad"],
};

const CONTENT: ImposterEntry[] = loadContent();

// --- Rules and timings ----------------------------------------------------

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export const COUNTDOWN_MS = 3000;
/** Hold-to-peek window; the private card leaves the payload after this. */
export const PEEK_MS = 5000;
export const DEFAULT_TURN_MS = 20000;
export const VOTE_MS = 20000;
export const REVOTE_MS = 20000;
export const VOTE_REVEAL_MS = 6000;
export const FINAL_GUESS_MS = 15000;
export const REVEAL_MS = 8000;
/** Platform rejoin grace before a disconnect changes the word. */
export const DISCONNECT_GRACE_MS = 30000;

/** Typed clue length cap, in characters (brief section 5). */
export const MAX_CLUE_CHARS = 20;
/** Final-guess options: the real word plus five decoys. */
export const FINAL_GUESS_OPTIONS = 6;

/** A word is capped at N-1 ejection attempts so it always terminates. */
export const maxEjectionsFor = (playerCount: number): number => Math.max(1, playerCount - 1);

const CREW_SURVIVAL_POINTS = 400;
const CREW_WRONG_EJECT_POINTS = 200;
const LARPER_SURVIVAL_POINTS = 200;
const IMPOSTER_SURVIVAL_POINTS = 1000;
const IMPOSTER_GUESS_POINTS = 700;
const CORRECT_VOTE_POINTS = 100;
/**
 * Vote bonuses are capped per word so the 1500 round-sanity bound holds even
 * when a pathological run of revotes lets one player cast many ballots.
 * Normal play never reaches the cap (see docs/DECISIONS.md).
 */
export const VOTE_BONUS_CAP =
  Math.floor((MAX_ROUND_SCORE - IMPOSTER_SURVIVAL_POINTS) / CORRECT_VOTE_POINTS);

const DEFAULT_DISCUSSION_MS = 90000;
const DEFAULT_CLUE_ROUNDS = 2;
const DEFAULT_ROUNDS_STANDALONE = 3;
const DEFAULT_ROUNDS_RUMBLE = 2;

export type ClueMode = "spoken" | "typed";
export type ScaleMode = "standalone" | "rumble";
export type Side = "crew" | "imposter" | "larper";
export type WordWinner = "crew" | "imposters";
export type WordEndReason =
  | "caught"
  | "finalGuess"
  | "numbers"
  | "cap"
  | "disconnect";
export type Phase =
  | "countdown"
  | "peek"
  | "clue"
  | "discussion"
  | "vote"
  | "voteReveal"
  | "finalGuess"
  | "reveal"
  | "finished";

/** Host settings, resolved once at start and clamped to the legal range. */
export interface ImposterSettings {
  mode: ScaleMode;
  rounds: number;
  clueMode: ClueMode;
  clueRounds: number;
  turnTimerMs: number;
  discussionMs: number;
  imposterNotFirst: boolean;
  imposterNotLast: boolean;
  rerandomiseOrder: boolean;
  includeLarper: boolean;
  announceLarper: boolean;
  imposterSeesCategory: boolean;
  imposters: number;
  allowSkipVotes: boolean;
  spokenAnnouncements: boolean;
}

function boolOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function intOption(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseTurnTimerMs(options: Record<string, unknown> | undefined): number {
  const raw = options?.turnTimerMs ?? options?.turnTimerSec ?? options?.turnTimer;
  if (raw === undefined) return DEFAULT_TURN_MS;
  if (raw === false || raw === "off" || raw === "none") return 0;
  const number = Number(raw);
  if (!Number.isFinite(number)) return DEFAULT_TURN_MS;
  if (number <= 0) return 0;
  // Values below a minute are seconds; larger values are already milliseconds.
  const ms = number <= 60 ? number * 1000 : number;
  const clamped = Math.min(30000, Math.max(10000, ms));
  return Math.round(clamped / 1000) * 1000;
}

function parseDiscussionMs(options: Record<string, unknown> | undefined): number {
  const raw = options?.discussionMs ?? options?.discussionSec;
  if (raw === undefined) return DEFAULT_DISCUSSION_MS;
  const number = Number(raw);
  if (!Number.isFinite(number)) return DEFAULT_DISCUSSION_MS;
  const ms = number > 0 && number < 1000 ? number * 1000 : number;
  return intOption(ms, DEFAULT_DISCUSSION_MS, 30000, 180000);
}

/**
 * Resolve the host options. Everything the brief defaults is here; the two
 * role-count rules (Larper at 5+, two Imposters at 7+) are clamped by N rather
 * than trusted from the phone.
 */
export function settingsFromOptions(
  options: Record<string, unknown> | undefined,
  playerCount: number,
): ImposterSettings {
  const count = Number.isFinite(playerCount) ? Math.max(1, Math.floor(playerCount)) : 1;
  const mode: ScaleMode = options?.mode === "rumble" ? "rumble" : "standalone";
  const includeLarper = boolOption(options?.includeLarper, false) && count >= 5;
  const imposters = intOption(options?.imposters, 1, 1, 2) === 2 && count >= 7 ? 2 : 1;

  return {
    mode,
    rounds: intOption(options?.rounds ?? options?.words, mode === "rumble" ? DEFAULT_ROUNDS_RUMBLE : DEFAULT_ROUNDS_STANDALONE, 1, 5),
    clueMode: options?.clueMode === "typed" ? "typed" : "spoken",
    clueRounds: intOption(options?.clueRounds, DEFAULT_CLUE_ROUNDS, 1, 3),
    turnTimerMs: parseTurnTimerMs(options),
    discussionMs: parseDiscussionMs(options),
    imposterNotFirst: boolOption(options?.imposterNotFirst, true),
    imposterNotLast: boolOption(options?.imposterNotLast, false),
    rerandomiseOrder: boolOption(options?.rerandomiseOrder, true),
    includeLarper,
    announceLarper: boolOption(options?.announceLarper, false) && includeLarper,
    imposterSeesCategory: boolOption(options?.imposterSeesCategory, true),
    imposters,
    allowSkipVotes: boolOption(options?.allowSkipVotes, false),
    spokenAnnouncements: boolOption(options?.spokenAnnouncements, true),
  };
}

// --- Turn order ------------------------------------------------------------

export interface OrderRules {
  imposterNotFirst: boolean;
  imposterNotLast: boolean;
}

/**
 * Repair a given seat order so the first/last seat are not Imposters.
 *
 * Only swaps are used, so the result is always a permutation of the input.
 * When every candidate for a slot is an Imposter (possible only at the end of
 * a word, when numbers would already have ended it) the order is left as is.
 */
export function applyOrderRules(
  order: readonly number[],
  imposterSeats: readonly number[],
  rules: OrderRules,
): number[] {
  const result = [...order];
  const imposters = new Set(imposterSeats);
  const length = result.length;
  if (length === 0) return result;

  if (rules.imposterNotFirst && imposters.has(result[0])) {
    const candidates: number[] = [];
    for (let index = 1; index < length; index++) {
      if (!imposters.has(result[index])) candidates.push(index);
    }
    if (candidates.length > 0) {
      const swap = secureChoice(candidates);
      [result[0], result[swap]] = [result[swap], result[0]];
    }
  }

  if (rules.imposterNotLast && imposters.has(result[length - 1])) {
    const candidates: number[] = [];
    for (let index = 1; index < length - 1; index++) {
      if (!imposters.has(result[index])) candidates.push(index);
    }
    // Index 0 is a legal swap only when the first-seat rule is off.
    if (candidates.length === 0 && !rules.imposterNotFirst && length > 1 && !imposters.has(result[0])) {
      candidates.push(0);
    }
    if (candidates.length > 0) {
      const swap = secureChoice(candidates);
      [result[length - 1], result[swap]] = [result[swap], result[length - 1]];
    }
  }

  return result;
}

/** Secure-random seat order with the Imposter first/last rules repaired. */
export function buildTurnOrder(
  seats: readonly number[],
  imposterSeats: readonly number[],
  rules: OrderRules,
): number[] {
  return applyOrderRules(secureShuffle([...seats]), imposterSeats, rules);
}

// --- Clue text -------------------------------------------------------------

/** Strip control characters (newlines, tabs, escapes) to spaces. */
function stripControlCharacters(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out;
}

/**
 * Typed clue sanitiser: one word, at most 20 characters, control characters
 * and extra whitespace removed. Returns null when nothing usable is left.
 */
export function cleanClueWord(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = stripControlCharacters(raw)
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return null;
  const first = text.split(" ")[0] ?? "";
  const word = first.slice(0, MAX_CLUE_CHARS);
  if (word.length === 0) return null;
  if (!/[\p{L}\p{N}]/u.test(word)) return null;
  return word;
}

// --- State -----------------------------------------------------------------

export interface WordRoles {
  entry: ImposterEntry;
  imposters: number[];
  larper: number | null;
}

export interface Ejection {
  seat: number;
  side: Side;
}

export interface FinalGuessState {
  seat: number;
  options: string[];
  choice: string | null;
  correct: boolean | null;
  resolved: boolean;
}

export interface WordOutcome {
  round: number;
  winner: WordWinner;
  reason: WordEndReason;
  word: string;
  category: string;
  lookalike: string;
  imposters: number[];
  larper: number | null;
  ejected: Ejection[];
  guesses: FinalGuessState[];
  roundScores: number[];
  voteBonus: number[];
}

export interface VoteRevealState {
  attempt: number;
  revote: boolean;
  secondTie: boolean;
  tiedSeats: number[];
  tally: number[];
  ballots: Array<{ seat: number; target: number | null; skipped: boolean }>;
  ejectedSeat: number | null;
  ejectedSide: Side | null;
}

export interface ImposterState {
  settings: ImposterSettings;
  deck: ImposterEntry[];
  deckCursor: number;
  round: number;
  maxRounds: number;
  phase: Phase;
  phaseMs: number;
  phaseTotalMs: number;

  roles: WordRoles;
  previousImposters: number[];

  active: boolean[];
  removed: boolean[];
  ejected: Ejection[];
  voteAttempts: number;
  maxVoteAttempts: number;

  clueRound: number;
  order: number[];
  wordBaseOrder: number[];
  orderBuilds: number;
  turnIndex: number;
  clueHistory: Array<{ cycle: number; clueRound: number; seat: number; text: string }>;

  votes: Array<number | null>;
  revote: boolean;
  tiedSeats: number[];
  voteReveal: VoteRevealState | null;
  pendingEjection: Ejection | null;

  finalGuess: FinalGuessState | null;
  finalGuesses: FinalGuessState[];
  wordResult: WordOutcome | null;

  scores: number[];
  roundScores: number[];
  voteBonus: number[];
  awayMs: number[];
  stats: Record<string, number>;
  finished: boolean;
}

interface ImposterInstance extends GameInstance {
  state: ImposterState;
}

const manifest: GameManifest = {
  id: "guessimposter",
  name: "Guess the Imposter",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "choice",
  description:
    "Everyone shares a secret word except the Imposter. Give clues, discuss, vote someone off, then catch the Imposter in a final guess.",
};

function seatsFor(count: number): number[] {
  return Array.from({ length: count }, (_, seat) => seat);
}

function sideOf(state: ImposterState, seat: number): Side {
  if (state.roles.imposters.includes(seat)) return "imposter";
  if (state.roles.larper === seat) return "larper";
  return "crew";
}

function isConnected(player: Player | undefined): boolean {
  if (!player) return false;
  if (player.presence === "away" || player.presence === "left") return false;
  return player.connected !== false;
}

function activeSeats(state: ImposterState): number[] {
  return seatsFor(state.active.length).filter((seat) => state.active[seat] && !state.removed[seat]);
}

function connectedActiveSeats(instance: ImposterInstance): number[] {
  const state = instance.state;
  return activeSeats(state).filter((seat) => isConnected(instance.players[seat]));
}

function activeImposters(state: ImposterState): number[] {
  return activeSeats(state).filter((seat) => sideOf(state, seat) === "imposter");
}

function leaderSeat(scores: readonly number[]): number {
  let best = -1;
  let seat = -1;
  scores.forEach((score, index) => {
    if (score > best) {
      best = score;
      seat = index;
    }
  });
  return seat;
}

function bumpStat(state: ImposterState, playerId: string, stat: "correctAccusations" | "roundsUndetected"): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}

/** Draw the next content entry, reshuffling when the deck is spent. */
function nextEntry(state: ImposterState): ImposterEntry {
  if (state.deckCursor >= state.deck.length) {
    state.deck = secureShuffle(CONTENT);
    state.deckCursor = 0;
  }
  const entry = state.deck[state.deckCursor] ?? CONTENT[0];
  state.deckCursor += 1;
  return entry;
}

/**
 * Assign this word's roles: secure-random Imposters (never the same seat as
 * the previous word), an optional Larper on the crew side at N >= 5, and the
 * next content entry.
 */
function drawRoles(instance: ImposterInstance): WordRoles {
  const state = instance.state;
  const count = instance.players.length;
  const entry = nextEntry(state);
  const wanted = Math.min(state.settings.imposters, Math.max(1, Math.floor(count / 2)));

  const allSeats = seatsFor(count);
  const eligible = allSeats.filter((seat) => !state.previousImposters.includes(seat));
  const pool = eligible.length >= wanted ? eligible : allSeats;
  const imposters = secureShuffle(pool).slice(0, wanted).sort((a, b) => a - b);

  let larper: number | null = null;
  if (state.settings.includeLarper && count >= 5) {
    const crewSeats = allSeats.filter((seat) => !imposters.includes(seat));
    if (crewSeats.length > 0) larper = secureChoice(crewSeats);
  }

  state.previousImposters = [...imposters];
  return { entry, imposters, larper };
}

/** Shuffle six distinct final-guess choices: the word plus five decoys. */
export function buildFinalGuessOptions(entry: ImposterEntry): string[] {
  const choices = [entry.word];
  for (const decoy of entry.decoys) {
    if (choices.length >= FINAL_GUESS_OPTIONS) break;
    if (decoy !== entry.word && !choices.includes(decoy)) choices.push(decoy);
  }
  let filler = 1;
  while (choices.length < FINAL_GUESS_OPTIONS) {
    const candidate = `${entry.category} ${filler}`;
    if (!choices.includes(candidate)) choices.push(candidate);
    filler += 1;
  }
  return secureShuffle(choices);
}

// --- Phase transitions -----------------------------------------------------

function beginWord(instance: ImposterInstance, round: number): void {
  const state = instance.state;
  const count = instance.players.length;

  state.round = round;
  state.phase = "countdown";
  state.phaseMs = COUNTDOWN_MS;
  state.phaseTotalMs = COUNTDOWN_MS;
  state.roles = drawRoles(instance);
  state.active = instance.players.map(() => true);
  state.removed = instance.players.map(() => false);
  state.ejected = [];
  state.voteAttempts = 0;
  state.maxVoteAttempts = maxEjectionsFor(count);
  state.clueRound = 0;
  state.order = [];
  state.wordBaseOrder = buildTurnOrder(seatsFor(count), state.roles.imposters, {
    imposterNotFirst: state.settings.imposterNotFirst,
    imposterNotLast: state.settings.imposterNotLast,
  });
  state.orderBuilds = 1;
  state.turnIndex = 0;
  state.clueHistory = [];
  state.votes = instance.players.map(() => null);
  state.revote = false;
  state.tiedSeats = [];
  state.voteReveal = null;
  state.pendingEjection = null;
  state.finalGuess = null;
  state.finalGuesses = [];
  state.wordResult = null;
  state.roundScores = instance.players.map(() => 0);
  state.voteBonus = instance.players.map(() => 0);
  state.awayMs = instance.players.map(() => 0);
  state.finished = false;
}

function beginPeek(instance: ImposterInstance): void {
  const state = instance.state;
  state.phase = "peek";
  state.phaseMs = PEEK_MS;
  state.phaseTotalMs = PEEK_MS;
}

/**
 * Build one clue-round order. `rerandomiseOrder` rebuilds (and bumps
 * `orderBuilds`); otherwise the word's base order is filtered to live seats.
 */
function nextClueOrder(instance: ImposterInstance): number[] {
  const state = instance.state;
  if (state.settings.rerandomiseOrder) {
    state.orderBuilds += 1;
    return buildTurnOrder(activeSeats(state), activeImposters(state), {
      imposterNotFirst: state.settings.imposterNotFirst,
      imposterNotLast: state.settings.imposterNotLast,
    });
  }
  return applyOrderRules(
    state.wordBaseOrder.filter((seat) => state.active[seat] && !state.removed[seat]),
    activeImposters(state),
    {
      imposterNotFirst: state.settings.imposterNotFirst,
      imposterNotLast: state.settings.imposterNotLast,
    },
  );
}

function beginClueCycle(instance: ImposterInstance): void {
  const state = instance.state;
  state.clueRound = 0;
  state.order = nextClueOrder(instance);
  state.turnIndex = 0;
  startClueTurn(instance);
}

function startClueRound(instance: ImposterInstance, index: number): void {
  const state = instance.state;
  if (index >= state.settings.clueRounds) {
    beginDiscussion(instance);
    return;
  }
  state.clueRound = index;
  if (index > 0) {
    state.order = nextClueOrder(instance);
    state.turnIndex = 0;
  }
  startClueTurn(instance);
}

function startClueTurn(instance: ImposterInstance): void {
  const state = instance.state;
  // Skip seats that left the word or whose phone is away.
  while (state.turnIndex < state.order.length) {
    const seat = state.order[state.turnIndex];
    if (!state.active[seat] || state.removed[seat]) {
      state.turnIndex += 1;
      continue;
    }
    if (!isConnected(instance.players[seat])) {
      state.turnIndex += 1;
      continue;
    }
    break;
  }

  if (state.turnIndex >= state.order.length) {
    finishClueRound(instance);
    return;
  }

  state.phase = "clue";
  state.phaseMs = state.settings.turnTimerMs;
  state.phaseTotalMs = state.settings.turnTimerMs;
}

function finishClueRound(instance: ImposterInstance): void {
  const state = instance.state;
  const next = state.clueRound + 1;
  if (next >= state.settings.clueRounds) {
    beginDiscussion(instance);
    return;
  }
  startClueRound(instance, next);
}

function advanceClueTurn(instance: ImposterInstance): void {
  const state = instance.state;
  state.turnIndex += 1;
  startClueTurn(instance);
}

function beginDiscussion(instance: ImposterInstance): void {
  const state = instance.state;
  state.phase = "discussion";
  state.phaseMs = state.settings.discussionMs;
  state.phaseTotalMs = state.settings.discussionMs;
}

function eligibleVoters(instance: ImposterInstance): number[] {
  return connectedActiveSeats(instance);
}

function allEligibleVoted(instance: ImposterInstance): boolean {
  const state = instance.state;
  return eligibleVoters(instance).every((seat) => state.votes[seat] !== null);
}

function beginVote(instance: ImposterInstance): void {
  const state = instance.state;
  state.phase = "vote";
  state.revote = false;
  state.tiedSeats = [];
  state.votes = instance.players.map(() => null);
  state.phaseMs = VOTE_MS;
  state.phaseTotalMs = VOTE_MS;
  if (eligibleVoters(instance).length === 0) resolveVote(instance);
}

function beginRevote(instance: ImposterInstance, tiedSeats: number[]): void {
  const state = instance.state;
  state.phase = "vote";
  state.revote = true;
  state.tiedSeats = [...tiedSeats];
  state.votes = instance.players.map(() => null);
  state.phaseMs = REVOTE_MS;
  state.phaseTotalMs = REVOTE_MS;
  if (eligibleVoters(instance).length === 0) resolveVote(instance);
}

/**
 * Tally the ballots. A unique top seat is ejected; a tie starts one revote
 * among the tied seats, and a second tie means nobody is ejected.
 */
function resolveVote(instance: ImposterInstance): void {
  const state = instance.state;
  const counts = state.votes.map(() => 0);
  for (const seat of seatsFor(instance.players.length)) {
    const target = state.votes[seat];
    if (target === null || target < 0) continue;
    if (target === seat || !state.active[target] || state.removed[target]) continue;
    counts[target] += 1;
  }

  let best = 0;
  for (const seat of activeSeats(state)) best = Math.max(best, counts[seat]);
  const top = activeSeats(state).filter((seat) => counts[seat] === best && best > 0);

  if (top.length > 1) {
    if (!state.revote) {
      beginRevote(instance, top);
      return;
    }
    concludeVote(instance, null, top, true);
    return;
  }

  concludeVote(instance, top.length === 1 ? top[0] : null, [], false);
}

/** Award correct-accusation stats/bonuses for the ballot that just resolved. */
function scoreCorrectVotes(instance: ImposterInstance): void {
  const state = instance.state;
  for (const seat of seatsFor(instance.players.length)) {
    if (!state.active[seat] || state.removed[seat]) continue;
    const target = state.votes[seat];
    if (target === null || target < 0) continue;
    if (sideOf(state, target) !== "imposter") continue;
    state.voteBonus[seat] += 1;
    bumpStat(state, instance.players[seat].id, "correctAccusations");
  }
}

function concludeVote(
  instance: ImposterInstance,
  ejectedSeat: number | null,
  tiedSeats: number[],
  secondTie: boolean,
): void {
  const state = instance.state;
  const wasRevote = state.revote;
  scoreCorrectVotes(instance);
  state.voteAttempts += 1;

  let ejectedSide: Side | null = null;
  if (ejectedSeat !== null) {
    ejectedSide = sideOf(state, ejectedSeat);
    state.active[ejectedSeat] = false;
    state.ejected.push({ seat: ejectedSeat, side: ejectedSide });
    state.pendingEjection = { seat: ejectedSeat, side: ejectedSide };
  } else {
    state.pendingEjection = null;
  }

  state.voteReveal = {
    attempt: state.voteAttempts,
    revote: wasRevote,
    secondTie,
    tiedSeats: [...tiedSeats],
    tally: state.votes.map(() => 0),
    ballots: instance.players.map((player, seat) => ({
      seat,
      target: state.votes[seat] !== null && state.votes[seat]! >= 0 ? state.votes[seat] : null,
      skipped: state.votes[seat] === -1,
    })),
    ejectedSeat,
    ejectedSide,
  };
  for (const seat of seatsFor(instance.players.length)) {
    const target = state.votes[seat];
    if (target !== null && target >= 0) state.voteReveal.tally[target] += 1;
  }

  state.phase = "voteReveal";
  state.phaseMs = VOTE_REVEAL_MS;
  state.phaseTotalMs = VOTE_REVEAL_MS;
}

/** True when no further play can change the word's outcome. */
function wordEndReason(state: ImposterState): { winner: WordWinner; reason: WordEndReason } | null {
  const imposters = activeImposters(state).length;
  const others = activeSeats(state).filter((seat) => sideOf(state, seat) !== "imposter").length;
  if (imposters === 0) return { winner: "crew", reason: "caught" };
  if (imposters >= others) return { winner: "imposters", reason: "numbers" };
  if (state.ejected.length >= maxEjectionsFor(state.active.length)) {
    return { winner: "imposters", reason: "cap" };
  }
  return null;
}

function finishVoteCycle(instance: ImposterInstance): void {
  const state = instance.state;
  const ending = wordEndReason(state);
  if (ending) {
    endWord(instance, ending.winner, ending.reason);
    return;
  }
  if (state.voteAttempts >= state.maxVoteAttempts) {
    endWord(instance, "imposters", "cap");
    return;
  }
  beginClueCycle(instance);
}

function finishVoteReveal(instance: ImposterInstance): void {
  const state = instance.state;
  const pending = state.pendingEjection;
  if (pending && pending.side === "imposter") {
    beginFinalGuess(instance, pending.seat);
    return;
  }
  finishVoteCycle(instance);
}

function beginFinalGuess(instance: ImposterInstance, seat: number): void {
  const state = instance.state;
  state.finalGuess = {
    seat,
    options: buildFinalGuessOptions(state.roles.entry),
    choice: null,
    correct: null,
    resolved: false,
  };
  state.phase = "finalGuess";
  state.phaseMs = FINAL_GUESS_MS;
  state.phaseTotalMs = FINAL_GUESS_MS;
}

function resolveFinalGuess(instance: ImposterInstance, correct: boolean): void {
  const state = instance.state;
  const guess = state.finalGuess;
  if (!guess || guess.resolved) return;
  guess.resolved = true;
  guess.correct = correct;
  state.finalGuesses.push({ ...guess, options: [...guess.options] });

  if (correct) {
    endWord(instance, "imposters", "finalGuess");
    return;
  }
  if (activeImposters(state).length === 0) {
    endWord(instance, "crew", "caught");
    return;
  }
  finishVoteCycle(instance);
}

/**
 * Score the word and move to the reveal. Payouts are fixed except the per-vote
 * bonus, which is capped per word (see docs/DECISIONS.md).
 */
function endWord(instance: ImposterInstance, winner: WordWinner, reason: WordEndReason): void {
  const state = instance.state;
  // A word scores exactly once; a second disconnect or timeout cannot replay it.
  if (state.wordResult) return;
  const count = instance.players.length;
  const roundScores = instance.players.map(() => 0);
  const ejectedSeats = new Set(state.ejected.map((entry) => entry.seat));

  if (winner === "crew") {
    for (const seat of seatsFor(count)) {
      if (sideOf(state, seat) === "imposter") continue;
      if (state.removed[seat]) continue;
      if (ejectedSeats.has(seat)) {
        roundScores[seat] += CREW_WRONG_EJECT_POINTS;
      } else {
        roundScores[seat] += CREW_SURVIVAL_POINTS;
        if (sideOf(state, seat) === "larper") roundScores[seat] += LARPER_SURVIVAL_POINTS;
      }
    }
  } else if (reason === "finalGuess") {
    // Only the Imposter who read the word right steals the 700; the rest of
    // the table (including a still-hidden partner) gets no win payout.
    const winningGuess = state.finalGuesses.find((guess) => guess.correct === true);
    if (winningGuess) roundScores[winningGuess.seat] += IMPOSTER_GUESS_POINTS;
  } else {
    for (const seat of activeImposters(state)) {
      roundScores[seat] += IMPOSTER_SURVIVAL_POINTS;
    }
  }

  for (const seat of seatsFor(count)) {
    const bonus = Math.min(state.voteBonus[seat], VOTE_BONUS_CAP) * CORRECT_VOTE_POINTS;
    roundScores[seat] += bonus;
    state.scores[seat] += roundScores[seat];
  }

  // A role holder who was never ejected survives the word, whatever the result.
  // A disconnect win means the away role holder did not survive it.
  for (const seat of seatsFor(count)) {
    const side = sideOf(state, seat);
    if (side === "crew") continue;
    if (ejectedSeats.has(seat) || state.removed[seat]) continue;
    if (reason === "disconnect" && !isConnected(instance.players[seat])) continue;
    bumpStat(state, instance.players[seat].id, "roundsUndetected");
  }

  state.roundScores = roundScores;
  state.wordResult = {
    round: state.round,
    winner,
    reason,
    word: state.roles.entry.word,
    category: state.roles.entry.category,
    lookalike: state.roles.entry.lookalike,
    imposters: [...state.roles.imposters],
    larper: state.roles.larper,
    ejected: state.ejected.map((entry) => ({ ...entry })),
    guesses: state.finalGuesses.map((guess) => ({ ...guess, options: [...guess.options] })),
    roundScores: [...roundScores],
    voteBonus: [...state.voteBonus],
  };
  state.phase = "reveal";
  state.phaseMs = REVEAL_MS;
  state.phaseTotalMs = REVEAL_MS;
}

function nextWordOrFinish(instance: ImposterInstance): void {
  const state = instance.state;
  const next = state.round + 1;
  if (next >= state.maxRounds) {
    state.finished = true;
    state.phase = "finished";
    state.phaseMs = 0;
    state.phaseTotalMs = 0;
    return;
  }
  beginWord(instance, next);
}

function advancePhase(instance: ImposterInstance): void {
  const state = instance.state;
  switch (state.phase) {
    case "countdown":
      beginPeek(instance);
      return;
    case "peek":
      beginClueCycle(instance);
      return;
    case "discussion":
      beginVote(instance);
      return;
    case "vote":
      resolveVote(instance);
      return;
    case "voteReveal":
      finishVoteReveal(instance);
      return;
    case "finalGuess":
      resolveFinalGuess(instance, false);
      return;
    case "reveal":
      nextWordOrFinish(instance);
      return;
    default:
      return;
  }
}

/**
 * Track away phones. An Imposter absent for the full grace period hands the
 * word to the crew; a Larper is removed quietly at the same threshold.
 */
function trackDisconnects(instance: ImposterInstance, deltaMs: number): void {
  const state = instance.state;
  if (state.phase === "reveal" || state.phase === "finished" || state.wordResult) return;
  for (const seat of seatsFor(instance.players.length)) {
    if (!state.active[seat] || state.removed[seat]) continue;
    if (isConnected(instance.players[seat])) {
      state.awayMs[seat] = 0;
      continue;
    }
    state.awayMs[seat] = Math.min(state.awayMs[seat] + deltaMs, DISCONNECT_GRACE_MS + 1);
    if (state.awayMs[seat] < DISCONNECT_GRACE_MS) continue;

    const side = sideOf(state, seat);
    if (side === "imposter") {
      endWord(instance, "crew", "disconnect");
      return;
    }
    if (side === "larper") {
      state.removed[seat] = true;
      state.active[seat] = false;
    }
  }
}

// --- Screen payload --------------------------------------------------------

function publicReveal(instance: ImposterInstance): unknown {
  const state = instance.state;
  const result = state.wordResult;
  if (!result) return null;
  return {
    round: result.round + 1,
    word: result.word,
    category: result.category,
    lookalike: result.lookalike,
    winner: result.winner,
    reason: result.reason,
    imposters: result.imposters.map((seat) => ({
      seat,
      id: instance.players[seat].id,
      name: instance.players[seat].name,
    })),
    larper: result.larper === null
      ? null
      : {
          seat: result.larper,
          id: instance.players[result.larper].id,
          name: instance.players[result.larper].name,
          word: result.lookalike,
        },
    ejected: result.ejected.map((entry) => ({
      seat: entry.seat,
      id: instance.players[entry.seat].id,
      name: instance.players[entry.seat].name,
      side: entry.side,
    })),
    guesses: result.guesses.map((guess) => ({
      seat: guess.seat,
      name: instance.players[guess.seat].name,
      correct: guess.correct === true,
      choice: guess.choice,
      // Safe here: the word is already public at the reveal, and the TV shows
      // the six options with the guesser's pick and the real answer marked.
      options: [...guess.options],
    })),
    roundScores: instance.players.map((player, seat) => ({
      id: player.id,
      name: player.name,
      score: result.roundScores[seat],
    })),
    scores: instance.players.map((player, seat) => ({
      id: player.id,
      name: player.name,
      score: state.scores[seat],
    })),
  };
}

function screenVoteReveal(instance: ImposterInstance): unknown {
  const state = instance.state;
  const reveal = state.voteReveal;
  if (!reveal) return null;
  return {
    attempt: reveal.attempt,
    revote: reveal.revote,
    secondTie: reveal.secondTie,
    nobodyOut: reveal.ejectedSeat === null,
    tiedSeats: reveal.tiedSeats.map((seat) => ({
      seat,
      id: instance.players[seat].id,
      name: instance.players[seat].name,
    })),
    tally: instance.players.map((player, seat) => ({
      seat,
      id: player.id,
      name: player.name,
      votes: reveal.tally[seat] ?? 0,
    })),
    ballots: reveal.ballots.map((ballot) => ({
      seat: ballot.seat,
      id: instance.players[ballot.seat].id,
      name: instance.players[ballot.seat].name,
      target: ballot.target === null ? null : {
        seat: ballot.target,
        id: instance.players[ballot.target].id,
        name: instance.players[ballot.target].name,
      },
      skipped: ballot.skipped,
    })),
    // An Imposter's side is withheld until the final reveal.
    ejected: reveal.ejectedSeat === null
      ? null
      : {
          seat: reveal.ejectedSeat,
          id: instance.players[reveal.ejectedSeat].id,
          name: instance.players[reveal.ejectedSeat].name,
          side: reveal.ejectedSide === "imposter" ? null : "crew",
        },
  };
}

function waitingOn(instance: ImposterInstance): string[] {
  const state = instance.state;
  if (state.phase === "clue") {
    const seat = state.order[state.turnIndex];
    return seat === undefined ? [] : [instance.players[seat].name];
  }
  if (state.phase === "vote") {
    return eligibleVoters(instance)
      .filter((seat) => state.votes[seat] === null)
      .map((seat) => instance.players[seat].name);
  }
  if (state.phase === "finalGuess" && state.finalGuess) {
    return [instance.players[state.finalGuess.seat].name];
  }
  return [];
}

function isRevealed(phase: Phase): boolean {
  return phase === "reveal" || phase === "finished";
}

/**
 * One sound cue per beat. The screen plays a cue list only when its signature
 * changes, so a phase can hold the same cue without replaying it every frame.
 */
function screenSound(state: ImposterState): string | null {
  switch (state.phase) {
    case "countdown":
      return "whoosh";
    case "voteReveal":
      return "vote";
    case "reveal":
      return "reveal";
    case "finished":
      return "win";
    default:
      return null;
  }
}

/**
 * A short public caption after the word is out. It comes from the fixed
 * `shared/interlude.ts` bank, which only interpolates a public name and count,
 * so no word, lookalike or role can ride the caption to the TV.
 */
function screenCaption(state: ImposterState): string | null {
  if (state.phase !== "reveal" || !state.wordResult) return null;
  return captionFor({ kind: "reveal", seed: state.round });
}

function publicEjections(instance: ImposterInstance, revealed: boolean): unknown[] {
  const state = instance.state;
  return state.ejected.map((entry) => ({
    seat: entry.seat,
    id: instance.players[entry.seat].id,
    name: instance.players[entry.seat].name,
    // Crew/larper ejections may be named as crew; an Imposter stays hidden.
    side: revealed ? entry.side : entry.side === "imposter" ? null : "crew",
  }));
}

// --- Plugin ----------------------------------------------------------------

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const settings = settingsFromOptions(options, players.length);
    const instance: ImposterInstance = {
      roomId: room.id,
      players,
      state: {
        settings,
        deck: secureShuffle(CONTENT),
        deckCursor: 0,
        round: 0,
        maxRounds: settings.rounds,
        phase: "countdown",
        phaseMs: COUNTDOWN_MS,
        phaseTotalMs: COUNTDOWN_MS,
        roles: { entry: CONTENT[0], imposters: [], larper: null },
        previousImposters: [],
        active: players.map(() => true),
        removed: players.map(() => false),
        ejected: [],
        voteAttempts: 0,
        maxVoteAttempts: maxEjectionsFor(players.length),
        clueRound: 0,
        order: [],
        wordBaseOrder: [],
        orderBuilds: 0,
        turnIndex: 0,
        clueHistory: [],
        votes: players.map(() => null),
        revote: false,
        tiedSeats: [],
        voteReveal: null,
        pendingEjection: null,
        finalGuess: null,
        finalGuesses: [],
        wordResult: null,
        scores: players.map(() => 0),
        roundScores: players.map(() => 0),
        voteBonus: players.map(() => 0),
        awayMs: players.map(() => 0),
        stats: Object.fromEntries(
          players.flatMap((player): Array<[string, number]> => [
            [playerStatKey(player.id, "correctAccusations"), 0],
            [playerStatKey(player.id, "roundsUndetected"), 0],
          ]),
        ),
        finished: false,
      },
    };
    beginWord(instance, 0);
    return instance;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as ImposterInstance;
    const state = inst.state;
    if (state.phase === "finished") return;
    const seat = inst.players.findIndex((player) => player.id === playerId);
    if (seat === -1) return;
    const raw = input as { text?: unknown; choice?: unknown; action?: unknown; tap?: unknown } | null;

    if (state.phase === "clue") {
      if (!state.active[seat] || state.removed[seat]) return;
      if (state.order[state.turnIndex] !== seat) return;

      if (state.settings.clueMode === "spoken") {
        if (raw?.action !== "done" && raw?.tap !== true) return;
      } else {
        const word = cleanClueWord(raw?.text);
        if (word === null) return;
        state.clueHistory.push({
          cycle: state.voteAttempts,
          clueRound: state.clueRound,
          seat,
          text: word,
        });
      }
      advanceClueTurn(inst);
      return;
    }

    if (state.phase === "vote") {
      if (!state.active[seat] || state.removed[seat]) return;
      if (!isConnected(inst.players[seat])) return;
      const choice = raw?.choice;
      if (typeof choice !== "string") return;

      if (choice === "skip") {
        if (!state.settings.allowSkipVotes) return;
        state.votes[seat] = -1;
      } else if (choice.startsWith("p:")) {
        const target = Number(choice.slice(2));
        if (!Number.isInteger(target)) return;
        if (target < 0 || target >= inst.players.length || target === seat) return;
        if (!state.active[target] || state.removed[target]) return;
        if (state.revote && !state.tiedSeats.includes(target)) return;
        state.votes[seat] = target;
      } else {
        return;
      }

      if (allEligibleVoted(inst)) resolveVote(inst);
      return;
    }

    if (state.phase === "finalGuess") {
      const guess = state.finalGuess;
      if (!guess || guess.resolved || guess.seat !== seat) return;
      const choice = raw?.choice;
      if (typeof choice !== "string" || !choice.startsWith("o:")) return;
      const index = Number(choice.slice(2));
      if (!Number.isInteger(index) || index < 0 || index >= guess.options.length) return;
      guess.choice = guess.options[index];
      resolveFinalGuess(inst, guess.choice === state.roles.entry.word);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as ImposterInstance;
    const state = inst.state;
    if (state.phase === "finished") return;

    const delta = Math.min(Math.max(deltaMs, 0), 2000);
    trackDisconnects(inst, delta);
    // `trackDisconnects` can end the word, so re-read the phase.
    if ((state.phase as Phase) === "finished") return;

    if (state.phase === "clue") {
      // A player who disconnects mid-turn loses it immediately, with or
      // without a turn timer.
      const active = state.order[state.turnIndex];
      if (active !== undefined && !isConnected(inst.players[active])) {
        advanceClueTurn(inst);
        return;
      }
      if (state.settings.turnTimerMs <= 0) return;
      state.phaseMs -= delta;
      if (state.phaseMs <= 0) advanceClueTurn(inst);
      return;
    }

    state.phaseMs -= delta;
    if (state.phaseMs > 0) return;
    advancePhase(inst);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as ImposterInstance;
    const state = inst.state;
    const revealed = isRevealed(state.phase);
    const order = state.order.map((seat, index) => ({
      seat,
      id: inst.players[seat].id,
      name: inst.players[seat].name,
      done: index < state.turnIndex,
      active: state.phase === "clue" && index === state.turnIndex,
    }));
    const activeSeat = state.phase === "clue" ? state.order[state.turnIndex] : undefined;
    const voteTargets = activeSeats(state).filter(
      (seat) => state.phase !== "vote" || !state.revote || state.tiedSeats.includes(seat),
    );
    const options = state.phase === "vote"
      ? voteTargets.map((seat) => ({
          id: `p:${seat}`,
          label: inst.players[seat].name,
          votes: 0,
          selected: false,
        }))
      : [];
    // Counts only: who voted for whom stays off the TV until the reveal.
    const voters = state.phase === "vote" ? eligibleVoters(inst) : [];
    const votesCast = voters.filter((seat) => state.votes[seat] !== null).length;
    const finalReveal = revealed ? publicReveal(inst) : null;

    return {
      phase: state.phase,
      round: state.round + 1,
      maxRounds: state.maxRounds,
      playerCount: inst.players.length,
      // Pacing settings only; role counts are not needed to render the TV.
      settings: {
        clueMode: state.settings.clueMode,
        clueRounds: state.settings.clueRounds,
        turnTimerMs: state.settings.turnTimerMs,
        discussionMs: state.settings.discussionMs,
        allowSkipVotes: state.settings.allowSkipVotes,
        spokenAnnouncements: state.settings.spokenAnnouncements,
      },
      countdownMs: state.phase === "countdown" ? Math.max(0, state.phaseMs) : null,
      announcement: state.phase === "countdown" && state.settings.announceLarper
        ? "A Larper is in play."
        : null,
      // The screen's speech synthesiser reads this on a change; null is silent.
      announce: state.phase === "clue" && state.settings.spokenAnnouncements && activeSeat !== undefined
        ? `${inst.players[activeSeat].name}, you're up`
        : null,
      clueRound: state.phase === "clue" || state.phase === "discussion" || state.phase === "vote" || state.phase === "voteReveal"
        ? state.clueRound + 1
        : null,
      clueRounds: state.settings.clueRounds,
      order,
      activePlayer: activeSeat === undefined
        ? null
        : { seat: activeSeat, id: inst.players[activeSeat].id, name: inst.players[activeSeat].name },
      // The generic TV ballot reads these top-level fields; counts stay zero.
      options,
      optionColumns: options.length >= 7 ? 2 : 1,
      clues: state.clueHistory.map((clue) => ({
        seat: clue.seat,
        id: inst.players[clue.seat].id,
        name: inst.players[clue.seat].name,
        clueRound: clue.clueRound + 1,
        cycle: clue.cycle + 1,
        text: clue.text,
      })),
      timerMs: state.phaseMs > 0 ? Math.max(0, state.phaseMs) : null,
      timerTotalMs: state.phaseTotalMs > 0 ? state.phaseTotalMs : null,
      timerOff: state.phase === "clue" && state.settings.turnTimerMs <= 0,
      waitingOn: waitingOn(inst),
      // The ballot itself has no counts; only the reveal carries them.
      vote: state.phase === "vote"
        ? {
            revote: state.revote,
            tied: state.tiedSeats.map((seat) => ({
              seat,
              id: inst.players[seat].id,
              name: inst.players[seat].name,
            })),
            options,
            optionColumns: options.length >= 7 ? 2 : 1,
            showVoteCounts: false,
            // A progress count for the TV, never a per-candidate tally.
            cast: votesCast,
            total: voters.length,
          }
        : null,
      voteReveal: state.phase === "voteReveal" || state.phase === "finalGuess" || revealed
        ? screenVoteReveal(inst)
        : null,
      finalGuess: state.phase === "finalGuess" && state.finalGuess
        ? {
            seat: state.finalGuess.seat,
            id: inst.players[state.finalGuess.seat].id,
            name: inst.players[state.finalGuess.seat].name,
          }
        : null,
      ejected: publicEjections(inst, revealed),
      finalReveal,
      players: inst.players.map((player, seat) => ({
        id: player.id,
        name: player.name,
        seat,
        score: state.scores[seat],
      })),
      scores: inst.players.map((player, seat) => ({
        id: player.id,
        name: player.name,
        score: state.scores[seat],
      })),
      // Generic screen hooks (brief 3.8); both stay public in every phase.
      caption: screenCaption(state),
      sound: screenSound(state),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? inst.players[leaderSeat(state.scores)]?.name ?? null : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as ImposterInstance;
    const state = inst.state;
    const seat = inst.players.findIndex((player) => player.id === playerId);
    if (seat === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const revealed = isRevealed(state.phase);
    const showReveal = revealed ? publicReveal(inst) : null;
    const maxScore = Math.max(...state.scores);
    const base = {
      round: state.round + 1,
      maxRounds: state.maxRounds,
      yourScore: state.scores[seat],
      finished: state.phase === "finished",
      youWon: state.phase === "finished" && state.scores[seat] === maxScore,
    };

    const ejected = state.ejected.some((entry) => entry.seat === seat);
    const removed = state.removed[seat];
    const isFinalGuesser =
      state.phase === "finalGuess" &&
      state.finalGuess !== null &&
      state.finalGuess.seat === seat &&
      !state.finalGuess.resolved;

    if ((ejected || removed) && !isFinalGuesser) {
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        spectator: true,
        info: ejected ? "You're out. Watch and react." : "You're spectating. Watch and react.",
        reveal: showReveal,
      };
    }

    if (state.phase === "countdown") {
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Get ready — your card is coming." };
    }

    if (state.phase === "peek") {
      const entry = state.roles.entry;
      const isImposter = sideOf(state, seat) === "imposter";
      const isLarper = state.roles.larper === seat;
      const word = isLarper ? entry.lookalike : entry.word;
      // The shared `role` layout shows title + body, so the body carries the
      // word and the category. Crew and Larper use identical keys and wording.
      const card = {
        title: isImposter ? "YOU ARE THE IMPOSTER" : "Your secret word",
        body: isImposter
          ? state.settings.imposterSeesCategory
            ? `Category: ${entry.category}`
            : "You do not know the word. Blend in."
          : `${word} (${entry.category})`,
        category: isImposter
          ? state.settings.imposterSeesCategory
            ? entry.category
            : null
          : entry.category,
        holdLabel: "HOLD TO PEEK",
        secret: isImposter,
      };
      return { ...base, mode: "wait", controllerType: "role", role: card };
    }

    if (state.phase === "clue") {
      const activeSeat = state.order[state.turnIndex];
      if (activeSeat === seat) {
        if (state.settings.clueMode === "typed") {
          return {
            ...base,
            mode: "text",
            controllerType: "text",
            placeholder: "One word",
            maxLength: MAX_CLUE_CHARS,
            isYourTurn: true,
            timerMs: state.settings.turnTimerMs > 0 ? Math.max(0, state.phaseMs) : null,
            info: "Type one clue word.",
          };
        }
        return {
          ...base,
          mode: "one-button",
          controllerType: "one-button",
          labels: { button: "DONE" },
          options: [],
          isYourTurn: true,
          timerMs: state.settings.turnTimerMs > 0 ? Math.max(0, state.phaseMs) : null,
          info: "Say one clue out loud, then tap DONE.",
        };
      }
      const waitingName = activeSeat === undefined ? "the table" : inst.players[activeSeat].name;
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        isYourTurn: false,
        info: `Waiting on ${waitingName}.`,
      };
    }

    if (state.phase === "discussion") {
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: "Talk it out. Then vote.",
      };
    }

    if (state.phase === "vote") {
      const targets = activeSeats(state)
        .filter((target) => target !== seat)
        .filter((target) => !state.revote || state.tiedSeats.includes(target));
      const options = targets.map((target) => ({
        id: `p:${target}`,
        label: inst.players[target].name,
        selected: state.votes[seat] === target,
      }));
      if (state.settings.allowSkipVotes) {
        options.push({ id: "skip", label: "Skip", selected: state.votes[seat] === -1 });
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options,
        hasVoted: state.votes[seat] !== null,
        // Brief 3.5: a vote may change until every phone has voted or time ends.
        canChangeVote: true,
        timerMs: Math.max(0, state.phaseMs),
        info: state.revote ? "Revote: tied players only." : "Who is the Imposter?",
      };
    }

    if (state.phase === "voteReveal") {
      const reveal = state.voteReveal;
      const info = reveal?.ejectedSeat === null || reveal === null
        ? "Nobody was ejected."
        : `${inst.players[reveal.ejectedSeat].name} is out.`;
      return { ...base, mode: "wait", controllerType: "choice", options: [], info };
    }

    if (state.phase === "finalGuess") {
      const guess = state.finalGuess;
      if (!guess) return { ...base, mode: "wait", controllerType: "choice", options: [], info: "" };
      if (guess.seat === seat) {
        return {
          ...base,
          mode: "choice",
          controllerType: "choice",
          options: guess.options.map((label, index) => ({
            id: `o:${index}`,
            label,
            selected: guess.choice === label,
          })),
          hasVoted: guess.choice !== null,
          timerMs: Math.max(0, state.phaseMs),
          info: "Name the real word to steal the win.",
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: `${inst.players[guess.seat].name} is making a final guess.`,
      };
    }

    const result = state.wordResult;
    const info = !result
      ? ""
      : result.winner === "crew"
        ? `The crew caught every Imposter. The word was ${result.word}.`
        : `The Imposters win. The word was ${result.word}.`;
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info,
      reveal: showReveal,
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as ImposterInstance;
    const state = inst.state;
    return {
      standings: standingsFromScores(
        inst.players.map((player, seat) => ({ id: player.id, raw: state.scores[seat] })),
      ),
      stats: { ...state.stats },
    };
  },
};

export default plugin;
