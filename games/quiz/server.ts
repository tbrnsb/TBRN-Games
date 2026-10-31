/**
 * Quiz Game - Server Logic
 * Trivia quiz with content packs, timed answers, speed scoring
 */

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
  | "card-hand";

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

// --- Quiz Types ---
interface Question {
  id: string;
  text: string;
  options: Array<{ id: string; label: string }>;
  correct: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
}

interface QuizState {
  questions: Question[];
  currentQuestion: number;
  timeLeft: number;
  phase: "waiting" | "question" | "reveal" | "finished";
  scores: number[];
  answers: Map<number, Map<string, { optionId: string; timeMs: number }>>; // questionIndex -> playerId -> answer
  answerOrder: Array<{ playerId: string; timeMs: number }>; // who answered first
  questionStartTime: number;
  packId: string;
}

interface QuizInstance extends GameInstance {
  state: QuizState;
}

// Default question pack (embedded)
const DEFAULT_PACK: Question[] = [
  { id: "q1", text: "What is the capital of France?", options: [{ id: "a", label: "London" }, { id: "b", label: "Paris" }, { id: "c", label: "Berlin" }, { id: "d", label: "Madrid" }], correct: "b", category: "Geography", difficulty: "easy" },
  { id: "q2", text: "Which planet is known as the Red Planet?", options: [{ id: "a", label: "Venus" }, { id: "b", label: "Mars" }, { id: "c", label: "Jupiter" }, { id: "d", label: "Saturn" }], correct: "b", category: "Science", difficulty: "easy" },
  { id: "q3", text: "Who wrote 'Romeo and Juliet'?", options: [{ id: "a", label: "Charles Dickens" }, { id: "b", label: "William Shakespeare" }, { id: "c", label: "Jane Austen" }, { id: "d", label: "Mark Twain" }], correct: "b", category: "Literature", difficulty: "easy" },
  { id: "q4", text: "What is the largest mammal?", options: [{ id: "a", label: "African Elephant" }, { id: "b", label: "Blue Whale" }, { id: "c", label: "Giraffe" }, { id: "d", label: "Hippopotamus" }], correct: "b", category: "Science", difficulty: "easy" },
  { id: "q5", text: "In which year did WWII end?", options: [{ id: "a", label: "1943" }, { id: "b", label: "1945" }, { id: "c", label: "1947" }, { id: "d", label: "1950" }], correct: "b", category: "History", difficulty: "medium" },
  { id: "q6", text: "What is the chemical symbol for gold?", options: [{ id: "a", label: "Go" }, { id: "b", label: "Gd" }, { id: "c", label: "Au" }, { id: "d", label: "Ag" }], correct: "c", category: "Science", difficulty: "medium" },
  { id: "q7", text: "Which country has the most islands?", options: [{ id: "a", label: "Indonesia" }, { id: "b", label: "Philippines" }, { id: "c", label: "Sweden" }, { id: "d", label: "Canada" }], correct: "c", category: "Geography", difficulty: "medium" },
  { id: "q8", text: "What is the smallest prime number?", options: [{ id: "a", label: "0" }, { id: "b", label: "1" }, { id: "c", label: "2" }, { id: "d", label: "3" }], correct: "c", category: "Math", difficulty: "easy" },
  { id: "q9", text: "Who painted the Mona Lisa?", options: [{ id: "a", label: "Vincent van Gogh" }, { id: "b", label: "Pablo Picasso" }, { id: "c", label: "Leonardo da Vinci" }, { id: "d", label: "Michelangelo" }], correct: "c", category: "Art", difficulty: "easy" },
  { id: "q10", text: "What is the speed of light?", options: [{ id: "a", label: "300,000 km/s" }, { id: "b", label: "150,000 km/s" }, { id: "c", label: "450,000 km/s" }, { id: "d", label: "600,000 km/s" }], correct: "a", category: "Science", difficulty: "medium" },
];

const QUESTION_TIME_MS = 15000;
const REVEAL_TIME_MS = 3000;
const BASE_POINTS = 1000;
const SPEED_BONUS_MAX = 500;

const manifest: GameManifest = {
  id: "quiz",
  name: "Quiz",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "choice",
  description: "Trivia quiz - pick the right answer. Fastest correct answer gets most points. Content packs included."
};

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): QuizInstance {
    const questions = [...DEFAULT_PACK].sort(() => Math.random() - 0.5).slice(0, 10);
    return {
      roomId: room.id,
      players,
      state: {
        questions,
        currentQuestion: 0,
        timeLeft: QUESTION_TIME_MS,
        phase: "waiting",
        scores: players.map(() => 0),
        answers: new Map(),
        answerOrder: [],
        questionStartTime: 0,
        packId: "default"
      }
    };
  },

  onInput(instance: QuizInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "question") return;

    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    // Check if already answered
    const qAnswers = state.answers.get(state.currentQuestion);
    if (qAnswers?.has(playerId)) return;

    const choice = input as { choice?: string };
    if (!choice?.choice) return;

    const now = Date.now();
    const timeMs = now - state.questionStartTime;

    if (!qAnswers) {
      state.answers.set(state.currentQuestion, new Map());
    }
    state.answers.get(state.currentQuestion)!.set(playerId, { optionId: choice.choice, timeMs });
    state.answerOrder.push({ playerId, timeMs });
  },

  onTick(instance: QuizInstance, deltaMs: number): void {
    const state = instance.state;

    if (state.phase === "waiting") {
      // Start first question
      state.phase = "question";
      state.timeLeft = QUESTION_TIME_MS;
      state.questionStartTime = Date.now();
      state.answers.set(0, new Map());
    } else if (state.phase === "question") {
      state.timeLeft -= deltaMs;
      if (state.timeLeft <= 0) {
        // Time's up - reveal
        state.phase = "reveal";
        state.timeLeft = REVEAL_TIME_MS;
        scoreQuestion(state, instance.players);
      }
    } else if (state.phase === "reveal") {
      state.timeLeft -= deltaMs;
      if (state.timeLeft <= 0) {
        // Next question or finish
        state.currentQuestion++;
        if (state.currentQuestion >= state.questions.length) {
          state.phase = "finished";
        } else {
          state.phase = "question";
          state.timeLeft = QUESTION_TIME_MS;
          state.questionStartTime = Date.now();
          state.answers.set(state.currentQuestion, new Map());
          state.answerOrder = [];
        }
      }
    }
  },

  screenState(instance: QuizInstance): unknown {
    const state = instance.state;
    const q = state.questions[state.currentQuestion];

    return {
      phase: state.phase,
      question: q ? { text: q.text, options: q.options, correct: q.correct } : null,
      currentQuestion: state.currentQuestion + 1,
      totalQuestions: state.questions.length,
      timeLeft: Math.max(0, state.timeLeft),
      scores: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null
    };
  },

  controllerState(instance: QuizInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    const q = state.questions[state.currentQuestion];
    const hasAnswered = state.answers.get(state.currentQuestion)?.has(playerId) ?? false;
    const playerAnswer = state.answers.get(state.currentQuestion)?.get(playerId);

    return {
      question: q ? { text: q.text, options: q.options } : null,
      hasAnswered,
      yourAnswer: playerAnswer?.optionId,
      correctAnswer: state.phase === "reveal" || state.phase === "finished" ? q?.correct : null,
      yourScore: state.scores[playerIndex],
      timeLeft: Math.max(0, state.timeLeft),
      phase: state.phase,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false
    };
  }
};

function scoreQuestion(state: QuizState, players: Player[]): void {
  const q = state.questions[state.currentQuestion];
  const qAnswers = state.answers.get(state.currentQuestion);
  if (!q) return;

  // Sort answerOrder by time
  const sorted = [...state.answerOrder].sort((a, b) => a.timeMs - b.timeMs);

  qAnswers?.forEach((answer, playerId) => {
    const playerIndex = players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    const isCorrect = answer.optionId === q.correct;
    if (!isCorrect) return;

    // Base points
    let points = BASE_POINTS;

    // Speed bonus: max for 1st correct, decreasing
    const correctOrder = sorted.filter(a => {
      const ans = qAnswers.get(a.playerId);
      return ans?.optionId === q.correct;
    });
    const rank = correctOrder.findIndex(a => a.playerId === playerId);
    if (rank >= 0) {
      const bonus = Math.max(0, SPEED_BONUS_MAX - rank * 100);
      points += bonus;
    }

    state.scores[playerIndex] += points;
  });
}

function getWinner(instance: QuizInstance): { name: string; score: number } | null {
  const state = instance.state;
  let bestScore = -1;
  let bestIndex = -1;
  state.scores.forEach((score, i) => {
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });
  if (bestIndex >= 0) return { name: instance.players[bestIndex].name, score: bestScore };
  return null;
}

export default plugin;