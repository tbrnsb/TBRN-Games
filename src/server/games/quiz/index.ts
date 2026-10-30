import { defineGame, type GameContext } from "../types.js";
import fs from "node:fs";
import path from "node:path";

export const QUIZ_ID = "quiz";
export const ANSWER_WINDOW_MS = 20_000;
export const BASE_SCORE = 1000;
export const SPEED_BONUS_MAX = 1000;

export type QuizPhase = "question" | "reveal" | "finished";

export interface QuizQuestion {
  readonly id: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly answer: number;
  readonly explanation: string;
}

export interface QuizPack {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly questions: readonly QuizQuestion[];
}

export interface QuizPlayerAction {
  readonly type: "answer";
  readonly optionIndex: number;
}

export interface QuizHostAction {
  readonly type: "next_question";
}

export interface QuizQuestionView {
  readonly id: string;
  readonly text: string;
  readonly options: readonly string[];
}

export interface QuizScore {
  readonly playerId: string;
  readonly name: string;
  readonly score: number;
}

export interface QuizQuestionScreen {
  readonly phase: "question";
  readonly questionIndex: number;
  readonly totalQuestions: number;
  readonly question: QuizQuestionView;
  readonly deadline: number;
  readonly answeredCount: number;
  readonly playerCount: number;
}

export interface QuizRevealScreen {
  readonly phase: "reveal";
  readonly questionIndex: number;
  readonly totalQuestions: number;
  readonly question: QuizQuestionView;
  readonly correctIndex: number;
  readonly explanation: string;
  readonly scores: readonly QuizScore[];
}

export interface QuizFinishedScreen {
  readonly phase: "finished";
  readonly questionIndex: number;
  readonly totalQuestions: number;
  readonly scores: readonly QuizScore[];
  readonly winners: readonly QuizScore[];
}

export type QuizScreen = QuizQuestionScreen | QuizRevealScreen | QuizFinishedScreen;

export interface QuizQuestionController {
  readonly phase: "question";
  readonly questionIndex: number;
  readonly totalQuestions: number;
  readonly question: QuizQuestionView;
  readonly deadline: number;
  readonly myAnswer: number | null;
}

export interface QuizRevealController {
  readonly phase: "reveal";
  readonly questionIndex: number;
  readonly totalQuestions: number;
  readonly question: QuizQuestionView;
  readonly correctIndex: number;
  readonly explanation: string;
  readonly myAnswer: number | null;
  readonly myScore: number;
  readonly scores: readonly QuizScore[];
}

export interface QuizFinishedController {
  readonly phase: "finished";
  readonly questionIndex: number;
  readonly totalQuestions: number;
  readonly myScore: number;
  readonly scores: readonly QuizScore[];
  readonly winners: readonly QuizScore[];
}

export type QuizController = QuizQuestionController | QuizRevealController | QuizFinishedController;

interface QuizAnswerRecord {
  readonly optionIndex: number;
  readonly answeredAt: number;
}

interface QuizState {
  phase: QuizPhase;
  questionIndex: number;
  questions: readonly QuizQuestion[];
  answers: Readonly<Record<string, QuizAnswerRecord>>;
  deadline: number | null;
  scores: Readonly<Record<string, number>>;
  lastRevealed: QuizQuestion | null;
}

export interface QuizOptions {
  readonly packId?: string;
  readonly questionCount?: number;
  readonly answerWindowMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlayerAction(action: unknown): QuizPlayerAction | null {
  if (!isRecord(action) || action.type !== "answer") {
    return null;
  }

  const optionIndex = action.optionIndex;
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    return null;
  }

  return { type: "answer", optionIndex };
}

function parseHostAction(action: unknown): QuizHostAction | null {
  if (!isRecord(action) || action.type !== "next_question") {
    return null;
  }

  return { type: "next_question" };
}

function loadPack(packId: string): QuizPack {
  const packPath = path.join(process.cwd(), "packs", `${packId}.json`);
  const content = fs.readFileSync(packPath, "utf-8");
  return JSON.parse(content) as QuizPack;
}

function selectQuestions(pack: QuizPack, count: number, random: () => number): readonly QuizQuestion[] {
  const shuffled = [...pack.questions].sort(() => random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function questionView(question: QuizQuestion): QuizQuestionView {
  return {
    id: question.id,
    text: question.text,
    options: question.options,
  };
}

function scoresView(
  context: GameContext,
  scores: Readonly<Record<string, number>>,
): QuizScore[] {
  return context.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    score: scores[player.id] ?? 0,
  }));
}

function winnersView(
  context: GameContext,
  scores: Readonly<Record<string, number>>,
): QuizScore[] {
  const view = scoresView(context, scores);
  const best = Math.max(...view.map((entry) => entry.score));
  return view.filter((entry) => entry.score === best);
}

function calculateScore(deltaMs: number, windowMs: number): number {
  if (deltaMs < 0 || deltaMs > windowMs) {
    return 0;
  }
  const speedRatio = 1 - deltaMs / windowMs;
  return Math.round(BASE_SCORE + SPEED_BONUS_MAX * speedRatio);
}

function reveal(
  context: GameContext,
  state: QuizState,
  answers: Readonly<Record<string, QuizAnswerRecord>>,
  windowMs: number,
): QuizState {
  const currentQuestion = state.questions[state.questionIndex];
  const correctIndex = currentQuestion.answer;
  const questionStartTime = state.deadline - windowMs;

  const scores: Record<string, number> = { ...state.scores };

  for (const player of context.players) {
    const playerAnswer = answers[player.id];
    if (playerAnswer?.optionIndex === correctIndex) {
      const deltaMs = playerAnswer.answeredAt - questionStartTime;
      scores[player.id] = (scores[player.id] ?? 0) + calculateScore(deltaMs, windowMs);
    }
  }

  return {
    ...state,
    phase: "reveal",
    answers,
    deadline: null,
    scores,
    lastRevealed: currentQuestion,
  };
}

function advanceQuestion(
  context: GameContext,
  state: QuizState,
  windowMs: number,
): QuizState {
  const nextIndex = state.questionIndex + 1;

  if (nextIndex >= state.questions.length) {
    return {
      ...state,
      phase: "finished",
      questionIndex: state.questions.length - 1,
      answers: {},
      deadline: null,
      lastRevealed: null,
    };
  }

  return {
    ...state,
    phase: "question",
    questionIndex: nextIndex,
    answers: {},
    deadline: context.now() + windowMs,
    lastRevealed: null,
  };
}

export function createQuizGame(options: QuizOptions = {}) {
  const packId = options.packId ?? "quiz-questions";
  const questionCount = options.questionCount ?? 15;
  const answerWindowMs = options.answerWindowMs ?? ANSWER_WINDOW_MS;

  if (!Number.isFinite(answerWindowMs) || answerWindowMs <= 0) {
    throw new Error("Quiz answerWindowMs must be a positive number.");
  }
  if (!Number.isInteger(questionCount) || questionCount < 1) {
    throw new Error("Quiz questionCount must be a positive integer.");
  }

  const pack = loadPack(packId);
  const maxQuestions = Math.min(questionCount, pack.questions.length);

  return defineGame<
    QuizState,
    QuizPlayerAction,
    QuizScreen,
    QuizController,
    QuizHostAction
  >({
    id: QUIZ_ID,
    name: "Quiz",
    description: "Answer questions fast. Speed earns bonus points.",
    minPlayers: 1,
    maxPlayers: 4,
    createState(context) {
      const questions = selectQuestions(pack, maxQuestions, context.random);

      return {
        phase: "question",
        questionIndex: 0,
        questions,
        answers: {} as Record<string, QuizAnswerRecord>,
        deadline: context.now() + answerWindowMs,
        scores: Object.fromEntries(
          context.players.map((player) => [player.id, 0]),
        ),
        lastRevealed: null,
      };
    },
    applyAction(context, state, playerId, action) {
      const parsed = parsePlayerAction(action);

      if (!parsed) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Select an answer option.",
        };
      }

      if (state.phase !== "question") {
        return {
          ok: false,
          code: "invalid_action",
          message: "Answer window is closed.",
        };
      }

      if (state.answers[playerId] !== undefined) {
        return {
          ok: false,
          code: "invalid_action",
          message: "You have already answered this question.",
        };
      }

      const currentQuestion = state.questions[state.questionIndex];
      if (parsed.optionIndex >= currentQuestion.options.length) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Invalid answer option.",
        };
      }

      const now = context.now();
      const answers = {
        ...state.answers,
        [playerId]: { optionIndex: parsed.optionIndex, answeredAt: now },
      };

      if (Object.keys(answers).length === context.players.length) {
        return { ok: true, state: reveal(context, state, answers, answerWindowMs) };
      }

      return { ok: true, state: { ...state, answers } };
    },
    applyHostAction(context, state, action) {
      const parsed = parseHostAction(action);

      if (!parsed) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Unknown host action.",
        };
      }

      if (state.phase !== "reveal") {
        return {
          ok: false,
          code: "invalid_action",
          message: "Wait for the question to be revealed.",
        };
      }

      return { ok: true, state: advanceQuestion(context, state, answerWindowMs) };
    },
    onDeadline(context, state) {
      if (state.phase !== "question") {
        return {
          ok: false,
          code: "invalid_action",
          message: "Answer window is already closed.",
        };
      }

      if (state.deadline === null || context.now() < state.deadline) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Answer window is still open.",
        };
      }

      return { ok: true, state: reveal(context, state, state.answers, answerWindowMs) };
    },
    screenView(context, state) {
      const currentQuestion = state.questions[state.questionIndex];
      const scores = scoresView(context, state.scores);

      if (state.phase === "question") {
        return {
          phase: "question",
          questionIndex: state.questionIndex,
          totalQuestions: state.questions.length,
          question: questionView(currentQuestion),
          deadline: state.deadline ?? context.now() + answerWindowMs,
          answeredCount: Object.keys(state.answers).length,
          playerCount: context.players.length,
        };
      }

      if (state.phase === "finished") {
        return {
          phase: "finished",
          questionIndex: state.questions.length - 1,
          totalQuestions: state.questions.length,
          scores,
          winners: winnersView(context, state.scores),
        };
      }

      // reveal phase
      const revealed = state.lastRevealed ?? currentQuestion;
      return {
        phase: "reveal",
        questionIndex: state.questionIndex,
        totalQuestions: state.questions.length,
        question: questionView(revealed),
        correctIndex: revealed.answer,
        explanation: revealed.explanation,
        scores,
      };
    },
    controllerView(context, state, playerId) {
      const currentQuestion = state.questions[state.questionIndex];
      const myAnswerRecord = state.answers[playerId];
      const myAnswer = myAnswerRecord?.optionIndex ?? null;
      const myScore = state.scores[playerId] ?? 0;
      const scores = scoresView(context, state.scores);

      if (state.phase === "question") {
        return {
          phase: "question",
          questionIndex: state.questionIndex,
          totalQuestions: state.questions.length,
          question: questionView(currentQuestion),
          deadline: state.deadline ?? context.now() + answerWindowMs,
          myAnswer,
        };
      }

      if (state.phase === "finished") {
        return {
          phase: "finished",
          questionIndex: state.questions.length - 1,
          totalQuestions: state.questions.length,
          myScore,
          scores,
          winners: winnersView(context, state.scores),
        };
      }

      // reveal phase
      const revealed = state.lastRevealed ?? currentQuestion;
      return {
        phase: "reveal",
        questionIndex: state.questionIndex,
        totalQuestions: state.questions.length,
        question: questionView(revealed),
        correctIndex: revealed.answer,
        explanation: revealed.explanation,
        myAnswer,
        myScore,
        scores,
      };
    },
    isFinished(_context, state) {
      return state.phase === "finished";
    },
    deadline(_context, state) {
      return state.phase === "question" ? state.deadline : null;
    },
  });
}