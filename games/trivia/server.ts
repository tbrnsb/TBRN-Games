/**
 * Quick Trivia - server logic.
 * Rapid-fire trivia. Faster answers score more.
 */

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
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}



interface TriviaQuestion { q: string; options: Array<{ id: string; label: string }>; answer: string }

interface TriviaState {
  questions: TriviaQuestion[];
  round: number;
  maxRounds: number;
  phase: "question" | "reveal" | "finished";
  answers: Array<string | null>;
  answerMs: number[];
  elapsedMs: number;
  correctId: string | null;
  scores: number[];
  timerMs: number;
}

interface TriviaInstance extends GameInstance { state: TriviaState }

const QUESTIONS: TriviaQuestion[] = [
  { q: "Which planet has the most moons?", options: [{ id: "a", label: "Jupiter" }, { id: "b", label: "Saturn" }, { id: "c", label: "Neptune" }, { id: "d", label: "Uranus" }], answer: "b" },
  { q: "What is the only mammal that cannot jump?", options: [{ id: "a", label: "Elephant" }, { id: "b", label: "Sloth" }, { id: "c", label: "Hippo" }, { id: "d", label: "Rhino" }], answer: "a" },
  { q: "How many bones does a shark have?", options: [{ id: "a", label: "0" }, { id: "b", label: "206" }, { id: "c", label: "94" }, { id: "d", label: "412" }], answer: "a" },
  { q: "Which country invented paper?", options: [{ id: "a", label: "Egypt" }, { id: "b", label: "China" }, { id: "c", label: "India" }, { id: "d", label: "Greece" }], answer: "b" },
  { q: "What is the loudest animal on Earth?", options: [{ id: "a", label: "Blue whale" }, { id: "b", label: "Sperm whale" }, { id: "c", label: "Howler monkey" }, { id: "d", label: "Elephant" }], answer: "b" },
  { q: "How long is a day on Venus?", options: [{ id: "a", label: "24 hours" }, { id: "b", label: "243 Earth days" }, { id: "c", label: "9 hours" }, { id: "d", label: "1 Earth year" }], answer: "b" },
  { q: "Which food never spoils?", options: [{ id: "a", label: "Honey" }, { id: "b", label: "Rice" }, { id: "c", label: "Salt" }, { id: "d", label: "Dried beans" }], answer: "a" },
  { q: "What colour is a polar bear's skin?", options: [{ id: "a", label: "White" }, { id: "b", label: "Pink" }, { id: "c", label: "Black" }, { id: "d", label: "Grey" }], answer: "c" },
];

const QUESTION_MS = 10000;
const REVEAL_MS = 5000;

const manifest: GameManifest = {
  id: "trivia",
  name: "Quick Trivia",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "choice",
  description: "Rapid-fire trivia. Answer fast - the quicker you lock in, the more points you get.",
};

function triviaLeader(instance: TriviaInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function triviaBegin(instance: TriviaInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.answers = instance.players.map(() => null);
  s.answerMs = instance.players.map(() => 0);
  s.elapsedMs = 0;
  s.correctId = null;
  s.timerMs = QUESTION_MS;
  s.phase = "question";
}

function triviaSettle(instance: TriviaInstance): void {
  const s = instance.state;
  const question = s.questions[s.round % s.questions.length];
  s.correctId = question.answer;
  for (let i = 0; i < instance.players.length; i++) {
    if (s.answers[i] !== question.answer) continue;
    const seconds = Math.floor(s.answerMs[i] / 1000);
    s.scores[i] += Math.max(100, 1000 - seconds * 90);
  }
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        questions: secureShuffle(QUESTIONS).slice(0, 6),
        round: 0,
        maxRounds: 6,
        phase: "question",
        answers: players.map(() => null),
        answerMs: players.map(() => 0),
        elapsedMs: 0,
        correctId: null,
        scores: players.map(() => 0),
        timerMs: QUESTION_MS,
      } satisfies TriviaState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as TriviaInstance;
    const s = inst.state;
    if (s.phase !== "question") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1 || s.answers[index] !== null) return;
    const choice = (input as { choice?: unknown } | null)?.choice;
    const question = s.questions[s.round % s.questions.length];
    if (typeof choice !== "string" || !question.options.some((o) => o.id === choice)) return;
    s.answers[index] = choice;
    s.answerMs[index] = s.elapsedMs;
    if (s.answers.every((a) => a !== null)) triviaSettle(inst);
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as TriviaInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);
    s.timerMs -= dt;
    if (s.phase === "question") s.elapsedMs += dt;
    if (s.timerMs > 0) return;
    if (s.phase === "question") { triviaSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    triviaBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as TriviaInstance;
    const s = inst.state;
    const question = s.questions[s.round % s.questions.length];
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      question: question.q,
      options: question.options,
      correctId: s.phase === "reveal" ? question.answer : null,
      answeredCount: s.answers.filter((a) => a !== null).length,
      playerCount: inst.players.length,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? triviaLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as TriviaInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const question = s.questions[s.round % s.questions.length];
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && triviaLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "question") {
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: question.options,
        hasVoted: s.answers[index] !== null,
        info: question.q,
      };
    }
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: `Answer: ${question.options.find((o) => o.id === question.answer)?.label ?? ""}`,
    };
  },
};

export default plugin;
