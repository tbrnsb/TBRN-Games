import { secureRandomInt } from "../../shared/secure-random.ts";

/**
 * Slogan Shirts - server logic.
 * Draw a design, write a slogan, then everyone gets someone else's slogan on their shirt and you vote for the best.
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
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}









import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const QUESTIONS: Array<{ id: string; text: string; options: string[]; answer: number }> = JSON.parse(
  readFileSync(join(HERE, "content", "questions.json"), "utf8"),
) as Array<{ id: string; text: string; options: string[]; answer: number }>;

interface LastState {
  phase: "trivia" | "minigame" | "finale" | "finished";
  round: number;
  maxRounds: number;
  questionIndex: number;
  answers: Array<number | null>;
  correct: number[];
  out: boolean[];
  scores: number[];
  danger: number[];
  minigame: "reflex" | "memory" | "trapdoors";
  mg: {
    targetMs: number;
    elapsedMs: number;
    taps: Array<number | null>;
    sequence: number[];
    entries: number[][];
    rigged: number;
    picks: Array<number | null>;
  };
  finaleCorrect: number[];
  timerMs: number;
  reveal: { loser: number | null; minigame: string | null } | null;
  winnerIndex: number | null;
}

interface LastInstance extends GameInstance { state: LastState }

const TRIVIA_MS = 20000;
const REFLEX_MS = 9000;
const MEMORY_MS = 16000;
const TRAP_MS = 8000;
const FINALE_TARGET = 3;
const MAX_ROUNDS = 8;

const manifest: GameManifest = {
  id: "lastseat",
  name: "Last Seat",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "choice",
  description: "Answer trivia. Get it wrong and you play a minigame for your seat. The last two settle it.",
};

/** Latest valid reflex tap loses; anyone who tapped early is a loser too. */
export function reflexLoser(taps: Array<number | null>, targetMs: number, danger: number[]): number {
  let worst = -1;
  let worstAt = -1;
  for (const seat of danger) {
    const tap = taps[seat];
    if (tap === null) return seat; // never tapped
    const at = tap <= targetMs ? -1 : tap;
    if (at === -1) return seat; // tapped early
    if (at > worstAt) { worstAt = at; worst = seat; }
  }
  return worst;
}

/** The most wrong entries loses; a full correct sequence survives. */
export function memoryLoser(entries: number[][], sequence: number[], danger: number[]): number {
  let worst = -1;
  let worstMisses = 0;
  for (const seat of danger) {
    const entry = entries[seat] ?? [];
    let misses = 0;
    for (let i = 0; i < sequence.length; i++) if (entry[i] !== sequence[i]) misses++;
    // A short entry is incomplete, which counts as at least one miss.
    if (entry.length < sequence.length) misses = Math.max(misses, 1);
    if (misses > worstMisses) { worstMisses = misses; worst = seat; }
  }
  return worstMisses > 0 ? worst : -1;
}

/** Picking the rigged door loses; if nobody did, nobody loses. */
export function trapdoorLoser(picks: Array<number | null>, rigged: number, danger: number[]): number {
  for (const seat of danger) {
    if (picks[seat] === rigged) return seat;
  }
  return -1;
}

function lastLeader(instance: LastInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function alive(instance: LastInstance): number[] {
  return instance.state.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
}

function computeScores(instance: LastInstance): void {
  const s = instance.state;
  const winner = s.winnerIndex;
  s.scores = instance.players.map((_, i) => {
    let total = s.correct[i] * 100 + s.finaleCorrect[i] * 200;
    if (i === winner) total += 1000;
    return total;
  });
}

function finish(instance: LastInstance, winner: number): void {
  const s = instance.state;
  s.winnerIndex = winner >= 0 ? winner : null;
  s.phase = "finished";
  computeScores(instance);
}

function beginTrivia(instance: LastInstance): void {
  const s = instance.state;
  s.answers = instance.players.map(() => null);
  s.danger = [];
  s.reveal = null;
  s.timerMs = TRIVIA_MS;
  s.phase = "trivia";
}

function beginMinigame(instance: LastInstance): void {
  const s = instance.state;
  const kinds = ["reflex", "memory", "trapdoors"] as const;
  // s.round has already advanced for this question, so offset it to keep
  // the first minigame of the match a reflex test.
  s.minigame = kinds[(s.round - 1 + kinds.length) % kinds.length];
  s.mg = {
    targetMs: secureRandomInt(1500, 4000),
    elapsedMs: 0,
    taps: instance.players.map(() => null),
    sequence: [secureRandomInt(0, 4), secureRandomInt(0, 4), secureRandomInt(0, 4), secureRandomInt(0, 4)],
    entries: instance.players.map(() => []),
    rigged: secureRandomInt(0, 4),
    picks: instance.players.map(() => null),
  };
  s.timerMs = s.minigame === "reflex" ? REFLEX_MS : s.minigame === "memory" ? MEMORY_MS : TRAP_MS;
  s.phase = "minigame";
}

function settleMinigame(instance: LastInstance): void {
  const s = instance.state;
  let loser = -1;
  if (s.minigame === "reflex") loser = reflexLoser(s.mg.taps, s.mg.targetMs, s.danger);
  else if (s.minigame === "memory") loser = memoryLoser(s.mg.entries, s.mg.sequence, s.danger);
  else loser = trapdoorLoser(s.mg.picks, s.mg.rigged, s.danger);

  if (loser === -1 && s.danger.length > 0) loser = s.danger[secureRandomInt(0, s.danger.length)];
  if (loser >= 0) {
    s.out[loser] = true;
    s.reveal = { loser, minigame: s.minigame };
  }
  s.round++;

  const left = alive(instance);
  if (left.length <= 1) { finish(instance, left[0] ?? -1); return; }
  if (left.length === 2) {
    s.phase = "finale";
    s.finaleCorrect = instance.players.map(() => 0);
    s.answers = instance.players.map(() => null);
    s.timerMs = TRIVIA_MS;
    return;
  }
  beginTrivia(instance);
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        phase: "trivia",
        round: 0,
        maxRounds: MAX_ROUNDS,
        questionIndex: 0,
        answers: players.map(() => null),
        correct: players.map(() => 0),
        out: players.map(() => false),
        scores: players.map(() => 0),
        danger: [],
        minigame: "reflex",
        mg: { targetMs: 0, elapsedMs: 0, taps: players.map(() => null), sequence: [], entries: players.map(() => []), rigged: 0, picks: players.map(() => null) },
        finaleCorrect: players.map(() => 0),
        timerMs: TRIVIA_MS,
        reveal: null,
        winnerIndex: null,
      } satisfies LastState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as LastInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1 || s.out[index]) return;
    const raw = input as { choice?: unknown } | null;
    const question = QUESTIONS[s.questionIndex % QUESTIONS.length];

    if (s.phase === "trivia") {
      if (typeof raw?.choice !== "string" || s.answers[index] !== null) return;
      const pick = Number(raw.choice);
      if (!Number.isInteger(pick) || pick < 0 || pick >= question.options.length) return;
      s.answers[index] = pick;
      const active = instance.players.map((_, i) => i).filter((i) => !s.out[i]);
      if (active.every((seat) => s.answers[seat] !== null)) settleTrivia(inst);
      return;
    }

    if (s.phase === "finale") {
      if (typeof raw?.choice !== "string" || s.answers[index] !== null) return;
      const pick = Number(raw.choice);
      if (!Number.isInteger(pick) || pick < 0 || pick >= question.options.length) return;
      s.answers[index] = pick;
      const left = alive(inst);
      if (left.every((seat) => s.answers[seat] !== null)) {
        for (const seat of left) if (s.answers[seat] === question.answer) s.finaleCorrect[seat]++;
        const champion = left.find((seat) => s.finaleCorrect[seat] >= FINALE_TARGET);
        if (champion !== undefined) { finish(inst, champion); return; }
        s.questionIndex++;
        s.answers = instance.players.map(() => null);
        s.timerMs = TRIVIA_MS;
      }
      return;
    }

    if (s.phase === "minigame" && s.danger.includes(index)) {
      if (s.minigame === "reflex" && raw?.choice === "tap" && s.mg.taps[index] === null) {
        s.mg.taps[index] = s.mg.elapsedMs;
      } else if (s.minigame === "trapdoors" && typeof raw?.choice === "string") {
        const door = Number(raw.choice);
        if (Number.isInteger(door) && door >= 0 && door < 4 && s.mg.picks[index] === null) s.mg.picks[index] = door;
      } else if (s.minigame === "memory" && typeof raw?.choice === "string") {
        const symbol = Number(raw.choice);
        if (Number.isInteger(symbol) && symbol >= 0 && symbol < 4 && s.mg.entries[index].length < s.mg.sequence.length) {
          s.mg.entries[index].push(symbol);
        }
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as LastInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);
    s.timerMs -= dt;
    if (s.phase === "minigame") s.mg.elapsedMs += dt;

    if (s.phase === "minigame") {
      const done = s.danger.every((seat) => {
        if (s.minigame === "reflex") return s.mg.taps[seat] !== null;
        if (s.minigame === "trapdoors") return s.mg.picks[seat] !== null;
        return s.mg.entries[seat].length >= s.mg.sequence.length;
      });
      if (done || s.timerMs <= 0) settleMinigame(inst);
      return;
    }

    if (s.timerMs > 0) return;

    if (s.phase === "trivia") { settleTrivia(inst); return; }
    if (s.phase === "finale") {
      const left = alive(inst);
      for (const seat of left) if (s.answers[seat] === QUESTIONS[s.questionIndex % QUESTIONS.length].answer) s.finaleCorrect[seat]++;
      s.questionIndex++;
      s.answers = instance.players.map(() => null);
      s.timerMs = TRIVIA_MS;
      const champion = left.find((seat) => s.finaleCorrect[seat] >= FINALE_TARGET);
      if (champion !== undefined) finish(inst, champion);
    }
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as LastInstance;
    const s = inst.state;
    const question = QUESTIONS[s.questionIndex % QUESTIONS.length];
    return {
      phase: s.phase,
      round: s.round,
      question: question.text,
      options: question.options,
      minigame: s.phase === "minigame" ? s.minigame : null,
      sequence: s.phase === "minigame" && s.minigame === "memory" ? s.mg.sequence : null,
      reveal: s.reveal,
      players: inst.players.map((p, i) => ({ name: p.name, out: s.out[i], correct: s.correct[i], finale: s.finaleCorrect[i] })),
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? lastLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as LastInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const question = QUESTIONS[s.questionIndex % QUESTIONS.length];
    const base = {
      yourScore: s.scores[index],
      out: s.out[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && lastLeader(inst) === inst.players[index].name,
    };

    if (s.out[index] && s.phase !== "finished") {
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "You lost your seat - watching" };
    }
    if (s.phase === "finished") {
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Game over" };
    }

    if (s.phase === "trivia" || s.phase === "finale") {
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: question.options.map((label, i) => ({ id: String(i), label })),
        hasVoted: s.answers[index] !== null,
        info: s.phase === "finale" ? `Finale: first to ${FINALE_TARGET}` : question.text,
      };
    }

    if (s.phase === "minigame") {
      if (!s.danger.includes(index)) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Safe this round" };
      }
      if (s.minigame === "reflex") {
        return { ...base, mode: "choice", controllerType: "choice", options: [{ id: "tap", label: "TAP" }], hasVoted: s.mg.taps[index] !== null, info: "Tap when the light turns green" };
      }
      if (s.minigame === "trapdoors") {
        return { ...base, mode: "choice", controllerType: "choice", options: [0, 1, 2, 3].map((d) => ({ id: String(d), label: `Door ${d + 1}` })), hasVoted: s.mg.picks[index] !== null, info: "One door is rigged" };
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [0, 1, 2, 3].map((sym) => ({ id: String(sym), label: ["◆", "●", "▲", "■"][sym] })),
        hasVoted: s.mg.entries[index].length >= s.mg.sequence.length,
        info: "Repeat the sequence on the screen",
      };
    }

    return { ...base, mode: "wait", controllerType: "choice", options: [], info: "" };
  },
};

function settleTrivia(instance: LastInstance): void {
  const s = instance.state;
  const question = QUESTIONS[s.questionIndex % QUESTIONS.length];
  const active = instance.players.map((_, i) => i).filter((i) => !s.out[i]);
  s.danger = [];
  for (const seat of active) {
    if (s.answers[seat] === question.answer) s.correct[seat]++;
    else s.danger.push(seat);
  }
  s.questionIndex++;
  s.round++;
  if (s.round >= s.maxRounds) {
    const best = active.reduce((a, b) => (s.correct[b] > s.correct[a] ? b : a), active[0] ?? -1);
    finish(instance, best);
    return;
  }
  if (s.danger.length === 0) { beginTrivia(instance); return; }
  beginMinigame(instance);
}

export default plugin;
