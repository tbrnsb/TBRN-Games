/**
 * Quiz - server logic.
 *
 * One game, two modes:
 * - standard (standalone): 10 questions, 15 seconds each.
 * - fast (Rumble, or the host toggle): 6 questions, 10 seconds each.
 *
 * Scoring is fixed, so it never passes through `f(N)`:
 * - standard at 3-4 players: the original rank bonus,
 *   `1000 + max(0, 500 - rank * 100)` with rank by answer time.
 * - standard at 5+ players: `1000 + up to 500`, linear on the remaining
 *   server clock.
 * - fast: `max(100, 1000 - floor(seconds) * 90)` on the server clock.
 * Wrong or missing answers score 0 in both modes.
 */

import { readFileSync } from "node:fs";
import { captionFor } from "../../shared/interlude.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores, type GameResult } from "../../shared/scoring.ts";
import { secureShuffle } from "../../shared/secure-random.ts";

// Types defined inline
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

// --- Quiz Types ---
export type QuizMode = "standard" | "fast";

interface Question {
  id: string;
  text: string;
  options: Array<{ id: string; label: string }>;
  correct: string;
  explanation: string;
}

interface AnswerRecord {
  optionId: string;
  timeMs: number;
}

interface QuizState {
  mode: QuizMode;
  questions: Question[];
  currentQuestion: number;
  timeLeft: number;
  phase: "waiting" | "question" | "reveal" | "finished";
  scores: number[];
  answers: Map<number, Map<string, AnswerRecord>>;
  questionElapsedMs: number;
  questionTimeMs: number;
  stats: Record<string, number>;
  packId: string;
}

interface QuizInstance extends GameInstance {
  state: QuizState;
}

interface OptionDistribution {
  id: string;
  count: number;
}

// --- Content pack ---------------------------------------------------------

interface PackQuestion {
  id: string;
  text: string;
  options: string[];
  answer: number;
  explanation?: string;
}

interface PackFile {
  questions: PackQuestion[];
}

const OPTION_IDS = ["a", "b", "c", "d", "e", "f"];
const PACK_ID = "quiz-questions";

/**
 * Convert the shared quiz pack from its on-disk shape (string options and an
 * answer index) into the option-id shape the plugin uses.
 */
function toQuestion(source: PackQuestion): Question | null {
  if (!source || typeof source.text !== "string") return null;
  const labels = Array.isArray(source.options)
    ? source.options.filter((label): label is string => typeof label === "string")
    : [];
  if (labels.length < 2) return null;

  const answer = Number(source.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer >= labels.length) return null;

  const options = labels.map((label, index) => ({
    id: OPTION_IDS[index] ?? String(index),
    label,
  }));

  return {
    id: typeof source.id === "string" ? source.id : `q${options.length}`,
    text: source.text,
    options,
    correct: options[answer].id,
    explanation: typeof source.explanation === "string" ? source.explanation : "",
  };
}

function loadQuestions(): Question[] {
  const path = new URL("../../packs/quiz-questions.json", import.meta.url);
  const pack = JSON.parse(readFileSync(path, "utf8")) as PackFile;
  return (Array.isArray(pack.questions) ? pack.questions : [])
    .map(toQuestion)
    .filter((question): question is Question => question !== null);
}

const QUESTION_PACK = loadQuestions();

// --- Timing and scoring ---------------------------------------------------

const STANDARD_QUESTIONS = 10;
const FAST_QUESTIONS = 6;
const STANDARD_QUESTION_MS = 15000;
const FAST_QUESTION_MS = 10000;
const REVEAL_TIME_MS = 3000;
const BASE_POINTS = 1000;
const SPEED_BONUS_MAX = 500;
const FAST_POINTS_FLOOR = 100;
const FAST_POINTS_PER_SECOND = 90;

/**
 * Standard score for a correct answer from five players up: 1000 plus up to
 * 500 for the remaining server game-clock time. 0 when the answer is outside
 * the window.
 */
export function standardPoints(elapsedMs: number, windowMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(windowMs) || windowMs <= 0) return 0;
  if (elapsedMs < 0 || elapsedMs > windowMs) return 0;
  const remaining = Math.max(0, windowMs - elapsedMs);
  return BASE_POINTS + Math.round((SPEED_BONUS_MAX * remaining) / windowMs);
}

/**
 * Fast-mode score for a correct answer, using whole seconds on the server
 * clock and a floor of 100. 0 for a negative or non-finite time.
 */
export function fastPoints(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  const seconds = Math.floor(elapsedMs / 1000);
  return Math.max(FAST_POINTS_FLOOR, BASE_POINTS - seconds * FAST_POINTS_PER_SECOND);
}

function parseMode(options: Record<string, unknown> | undefined): QuizMode {
  return options?.mode === "fast" ? "fast" : "standard";
}

function questionTimeFor(mode: QuizMode): number {
  return mode === "fast" ? FAST_QUESTION_MS : STANDARD_QUESTION_MS;
}

function questionCountFor(mode: QuizMode): number {
  return mode === "fast" ? FAST_QUESTIONS : STANDARD_QUESTIONS;
}

function selectQuestions(mode: QuizMode, countOverride?: number): Question[] {
  // Fast mode promises four options; keep the pool honest if a future pack
  // entry adds a different option count.
  const pool = mode === "fast"
    ? QUESTION_PACK.filter((question) => question.options.length === 4)
    : QUESTION_PACK;
  const count = Math.min(countOverride ?? questionCountFor(mode), pool.length);
  return secureShuffle(pool).slice(0, count);
}

const manifest: GameManifest = {
  id: "quiz",
  name: "Quiz",
  minPlayers: 1,
  maxPlayers: 8,
  controllerType: "choice",
  description:
    "Trivia quiz - pick the right answer. Standard is ten questions; Fast mode is six quick ones. Content packs included.",
};

function bumpStat(state: QuizState, playerId: string, stat: "correct" | "answered"): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}

function startQuestion(state: QuizState, index: number): void {
  state.currentQuestion = index;
  state.phase = "question";
  state.timeLeft = state.questionTimeMs;
  state.questionElapsedMs = 0;
  state.answers.set(index, new Map());
}

/** Who the TV is waiting on: every player without an answer in this question. */
function waitingNames(instance: QuizInstance): string[] {
  const state = instance.state;
  if (state.phase !== "question") return [];
  const answers = state.answers.get(state.currentQuestion);
  return instance.players
    .filter((player) => !answers?.has(player.id))
    .map((player) => player.name);
}

/** Counts per option, only ever published during the reveal. */
function optionDistribution(state: QuizState, question: Question): OptionDistribution[] {
  const counts = new Map<string, number>(question.options.map((option) => [option.id, 0]));
  state.answers.get(state.currentQuestion)?.forEach((answer) => {
    if (!counts.has(answer.optionId)) return;
    counts.set(answer.optionId, (counts.get(answer.optionId) ?? 0) + 1);
  });
  return question.options.map((option) => ({
    id: option.id,
    count: counts.get(option.id) ?? 0,
  }));
}

/** Fastest correct answer on the current question, for the reveal caption. */
function fastestCorrectName(instance: QuizInstance): string | null {
  const state = instance.state;
  const question = state.questions[state.currentQuestion];
  const answers = state.answers.get(state.currentQuestion);
  if (!question || !answers) return null;

  let fastest: { name: string; timeMs: number } | null = null;
  for (const player of instance.players) {
    const answer = answers.get(player.id);
    if (!answer || answer.optionId !== question.correct) continue;
    if (!fastest || answer.timeMs < fastest.timeMs) {
      fastest = { name: player.name, timeMs: answer.timeMs };
    }
  }
  return fastest?.name ?? null;
}

function revealCaption(instance: QuizInstance): string | null {
  const state = instance.state;
  if (state.phase !== "reveal") return null;
  const fastest = fastestCorrectName(instance);
  if (fastest) {
    return captionFor({ kind: "fastest", name: fastest, seed: state.currentQuestion });
  }
  return captionFor({ kind: "reveal", seed: state.currentQuestion });
}

/**
 * Correct answers on the current question, fastest first. Insertion order is
 * the answer order, so equal timestamps keep the original tie behaviour.
 */
function correctAnswersByTime(state: QuizState, question: Question): Array<{ playerId: string; timeMs: number }> {
  const answers = state.answers.get(state.currentQuestion);
  if (!answers) return [];
  return [...answers.entries()]
    .filter(([, answer]) => answer.optionId === question.correct)
    .map(([playerId, answer]) => ({ playerId, timeMs: answer.timeMs }))
    .sort((a, b) => a.timeMs - b.timeMs);
}

function scoreQuestion(state: QuizState, players: Player[]): void {
  const question = state.questions[state.currentQuestion];
  const answers = state.answers.get(state.currentQuestion);
  if (!question || !answers) return;

  // The human's hard rule: 3- and 4-player standard scores must stay identical
  // to the old rank-based game. From five players the brief's clock formula
  // takes over. Fast mode is always the clock formula.
  const rankByPlayer = new Map<string, number>();
  if (state.mode === "standard" && players.length <= 4) {
    correctAnswersByTime(state, question).forEach((answer, rank) => {
      rankByPlayer.set(answer.playerId, rank);
    });
  }

  answers.forEach((answer, playerId) => {
    if (answer.optionId !== question.correct) return;
    const playerIndex = players.findIndex((player) => player.id === playerId);
    if (playerIndex === -1) return;

    let points: number;
    if (state.mode === "fast") {
      points = fastPoints(answer.timeMs);
    } else if (rankByPlayer.has(playerId)) {
      const rank = rankByPlayer.get(playerId) ?? 0;
      points = BASE_POINTS + Math.max(0, SPEED_BONUS_MAX - rank * 100);
    } else {
      points = standardPoints(answer.timeMs, state.questionTimeMs);
    }
    state.scores[playerIndex] += points;

    bumpStat(state, playerId, "correct");
    const fastestKey = playerStatKey(playerId, "fastestMs");
    state.stats[fastestKey] = Math.min(state.stats[fastestKey] ?? Number.POSITIVE_INFINITY, answer.timeMs);
  });
}

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): QuizInstance {
    const mode = parseMode(options);
    const questionTimeMs = questionTimeFor(mode);
    // A preset Rumble passes the catalog question count while keeping the
    // slot's own mode ("fast" in Friday Night at Mo's, "standard" in Big Brain
    // Sunday, both six questions at Rumble length).
    const rounds = roundsOption(options);

    return {
      roomId: room.id,
      players,
      state: {
        mode,
        questions: selectQuestions(mode, rounds),
        currentQuestion: 0,
        timeLeft: questionTimeMs,
        phase: "waiting",
        scores: players.map(() => 0),
        answers: new Map(),
        questionElapsedMs: 0,
        questionTimeMs,
        stats: Object.fromEntries(
          players.flatMap((player): Array<[string, number]> => [
            [playerStatKey(player.id, "correct"), 0],
            [playerStatKey(player.id, "answered"), 0],
          ]),
        ),
        packId: PACK_ID,
      } satisfies QuizState,
    };
  },

  onInput(instance: QuizInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "question" || state.timeLeft <= 0) return;

    const playerIndex = instance.players.findIndex((player) => player.id === playerId);
    if (playerIndex === -1) return;

    const currentAnswers = state.answers.get(state.currentQuestion);
    if (currentAnswers?.has(playerId)) return;

    const choice = input as { choice?: unknown } | null;
    const optionId = typeof choice?.choice === "string" ? choice.choice : null;
    if (!optionId) return;

    const question = state.questions[state.currentQuestion];
    if (!question.options.some((option) => option.id === optionId)) return;

    // Game-clock time, not wall clock: keeps answers deterministic and
    // correct even if the server stalls between ticks.
    const timeMs = Math.max(0, Math.min(state.questionElapsedMs, state.questionTimeMs));

    if (!currentAnswers) state.answers.set(state.currentQuestion, new Map());
    state.answers.get(state.currentQuestion)!.set(playerId, { optionId, timeMs });
    bumpStat(state, playerId, "answered");
  },

  onTick(instance: QuizInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;

    if (state.phase === "waiting") {
      startQuestion(state, 0);
      return;
    }

    const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;

    if (state.phase === "question") {
      state.timeLeft -= delta;
      state.questionElapsedMs = Math.min(
        state.questionTimeMs,
        state.questionElapsedMs + delta,
      );
      if (state.timeLeft <= 0) {
        state.phase = "reveal";
        state.timeLeft = REVEAL_TIME_MS;
        scoreQuestion(state, instance.players);
      }
      return;
    }

    // Reveal
    state.timeLeft -= delta;
    if (state.timeLeft > 0) return;

    const next = state.currentQuestion + 1;
    if (next >= state.questions.length) {
      state.phase = "finished";
    } else {
      startQuestion(state, next);
    }
  },

  screenState(instance: QuizInstance): unknown {
    const state = instance.state;
    const question = state.questions[state.currentQuestion];
    const revealed = state.phase === "reveal" || state.phase === "finished";
    const answeredCount = state.answers.get(state.currentQuestion)?.size ?? 0;

    return {
      mode: state.mode,
      phase: state.phase,
      question: question
        ? {
            text: question.text,
            options: question.options,
            // Do not ship the answer to the shared screen before the reveal.
            correct: revealed ? question.correct : null,
          }
        : null,
      currentQuestion: state.currentQuestion + 1,
      totalQuestions: state.questions.length,
      timeLeft: Math.max(0, state.timeLeft),
      questionTimeMs: state.questionTimeMs,
      scores: instance.players.map((player, index) => ({
        name: player.name,
        score: state.scores[index],
      })),
      // The distribution only exists once the question is closed; whose answer
      // it was never appears until the reveal, and even then it stays private.
      distribution: state.phase === "reveal" && question
        ? optionDistribution(state, question)
        : null,
      answeredCount,
      playerCount: instance.players.length,
      waitingOn: waitingNames(instance),
      caption: revealCaption(instance),
      sound: state.phase === "reveal" ? "reveal" : null,
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: QuizInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((player) => player.id === playerId);
    if (playerIndex === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const question = state.questions[state.currentQuestion];
    const hasAnswered = state.answers.get(state.currentQuestion)?.has(playerId) ?? false;
    const playerAnswer = state.answers.get(state.currentQuestion)?.get(playerId);
    const revealed = state.phase === "reveal" || state.phase === "finished";

    return {
      question: question ? { text: question.text, options: question.options } : null,
      // The choice controller reads a flat `options` list; without it the
      // phone renders no answer buttons at all. `selected` keeps the
      // player's own pick highlighted.
      options: question
        ? question.options.map((option) => ({
            ...option,
            selected: option.id === playerAnswer?.optionId,
          }))
        : [],
      hasAnswered,
      // `hasVoted` is the field the choice layout uses to lock the buttons.
      hasVoted: hasAnswered,
      yourAnswer: playerAnswer?.optionId ?? null,
      correctAnswer: revealed ? question?.correct ?? null : null,
      yourScore: state.scores[playerIndex],
      timeLeft: Math.max(0, state.timeLeft),
      questionTimeMs: state.questionTimeMs,
      phase: state.phase,
      finished: state.phase === "finished",
      youWon:
        state.phase === "finished"
          ? getWinner(instance)?.name === instance.players[playerIndex].name
          : false,
    };
  },

  results(instance: QuizInstance): GameResult {
    const state = instance.state;
    return {
      standings: standingsFromScores(
        instance.players.map((player, index) => ({
          id: player.id,
          raw: state.scores[index],
        })),
      ),
      stats: { ...state.stats },
    };
  },
};

function getWinner(instance: QuizInstance): { name: string; score: number } | null {
  const state = instance.state;
  let bestScore = -1;
  let bestIndex = -1;
  state.scores.forEach((score, index) => {
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex >= 0) return { name: instance.players[bestIndex].name, score: bestScore };
  return null;
}

export default plugin;
