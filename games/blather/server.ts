/**
 * Blather Round - server logic.
 * Describe a secret thing in one sentence without naming it. Everyone else races to guess.
 */

import { captionFor } from "../../shared/interlude.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { playerStatKey } from "../../shared/results.ts";
import { scalePayout, standingsFromScores, type GameResult } from "../../shared/scoring.ts";

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

interface BlatherState {
  round: number;
  maxRounds: number;
  phase: "clue" | "guessing" | "reveal" | "finished";
  presenter: number;
  target: string;
  clue: string | null;
  guesses: Array<string | null>;
  guessMs: number[];
  elapsedMs: number;
  scores: number[];
  timerMs: number;
  reveal: { correct: number[] } | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
  /** Private per-seat answer-time accumulation, for `averageAnswerMs`. */
  answerMsTotal: number[];
  answerCount: number[];
}

interface BlatherInstance extends GameInstance { state: BlatherState }

const TARGETS = [
  "bicycle pump",
  "escalator",
  "iceberg",
  "hair dryer",
  "traffic cone",
  "vending machine",
  "piano",
  "umbrella",
  "lighthouse",
  "stapler",
  "trampoline",
  "fire extinguisher",
];

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** Standalone rounds cap at six; the Rumble runs four (brief 4). */
const MAX_ROUNDS = 6;
const MAX_CLUE = 140;
const MAX_GUESS = 60;
const CLUE_MS = 45000;
const GUESS_MS = 45000;
const REVEAL_MS = 8000;
/** A correct guess is worth this much at 0 seconds, decaying 20 per second. */
const GUESS_BASE = 1000;
const GUESS_DECAY_PER_SECOND = 20;
const GUESS_FLOOR = 100;
/** Presenter base payout per correct guesser, scaled by f(N), capped per round. */
const PRESENTER_BASE = 100;
const PRESENTER_CAP = 600;

const manifest: GameManifest = {
  id: "blather",
  name: "Blather Round",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "text",
  description: "Describe a secret thing in one sentence without naming it. Everyone else races to guess the word.",
};

/** Standalone rounds: one per player, capped at six. */
function standaloneRounds(playerCount: number): number {
  return Math.min(Math.max(playerCount, 1), MAX_ROUNDS);
}

/** The presenter rotates through the seat order: `round % N`. */
function presenterFor(round: number, playerCount: number): number {
  return playerCount > 0 ? round % playerCount : 0;
}

/** Lower-case and turn every punctuation run into a single space. */
function normaliseGuess(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Levenshtein distance with a two-row buffer: small, allocation-light, safe. */
function editDistance(a: string, b: string): number {
  const A = a.toLowerCase().trim();
  const B = b.toLowerCase().trim();
  if (A === B) return 0;
  const prev = new Array<number>(B.length + 1);
  for (let j = 0; j <= B.length; j++) prev[j] = j;
  for (let i = 1; i <= A.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= B.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (A[i - 1] === B[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[B.length];
}

/** Replace C0/DEL control characters (newlines, tabs, escape codes) with spaces. */
function stripControlCharacters(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out;
}

/** Server-side free-text sanitiser: strip control characters, collapse space, cap length. */
function cleanText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const text = stripControlCharacters(raw).replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.slice(0, maxLength);
}

/**
 * Speed-decayed score for a correct guess: `max(100, 1000 - seconds * 20)`.
 *
 * `seconds` is the whole number of seconds on the server guessing clock when
 * the guess arrived, so a 45-second limit is worth exactly the floor.
 */
export function guessScore(seconds: number): number {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return Math.max(GUESS_FLOOR, GUESS_BASE - safe * GUESS_DECAY_PER_SECOND);
}

/**
 * The presenter's round payout: `scalePayout(100, N)` per correct guesser,
 * capped at 600. At 3-4 players that is exactly 100 per correct guesser.
 */
export function presenterScore(correctGuesses: number, playerCount: number): number {
  const correct = Number.isFinite(correctGuesses)
    ? Math.max(0, Math.floor(correctGuesses))
    : 0;
  return Math.min(PRESENTER_CAP, scalePayout(PRESENTER_BASE, playerCount) * correct);
}

function blatherLeader(instance: BlatherInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((value, index) => {
    if (value > best) {
      best = value;
      idx = index;
    }
  });
  return idx >= 0 ? instance.players[idx].name : null;
}

function bumpCorrectGuesses(state: BlatherState, playerId: string): void {
  const key = playerStatKey(playerId, "correctGuesses");
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}

function blatherBegin(instance: BlatherInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.presenter = presenterFor(round, instance.players.length);
  s.target = TARGETS[round % TARGETS.length];
  s.clue = null;
  s.guesses = instance.players.map(() => null);
  s.guessMs = instance.players.map(() => 0);
  s.elapsedMs = 0;
  s.reveal = null;
  s.timerMs = CLUE_MS;
  s.phase = "clue";
}

function allGuessed(instance: BlatherInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, index) => index === s.presenter || s.guesses[index] !== null);
}

function blatherSettle(instance: BlatherInstance): void {
  const s = instance.state;
  const correct: number[] = [];

  for (let index = 0; index < instance.players.length; index++) {
    if (index === s.presenter) continue;
    const guess = s.guesses[index];
    if (guess === null) continue;

    const answerMs = s.guessMs[index];
    s.answerMsTotal[index] += answerMs;
    s.answerCount[index] += 1;

    if (editDistance(normaliseGuess(guess), normaliseGuess(s.target)) <= 1) {
      correct.push(index);
      const seconds = Math.floor(answerMs / 1000);
      s.scores[index] += guessScore(seconds);
      bumpCorrectGuesses(s, instance.players[index].id);
    }
  }

  s.scores[s.presenter] += presenterScore(correct.length, instance.players.length);
  s.reveal = { correct };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/** Who the TV is waiting on: the presenter while writing, then the silent guessers. */
function waitingNames(instance: BlatherInstance): string[] {
  const s = instance.state;
  if (s.phase === "clue") {
    const name = instance.players[s.presenter]?.name;
    return name ? [name] : [];
  }
  if (s.phase === "guessing") {
    return instance.players
      .filter((_, index) => index !== s.presenter && s.guesses[index] === null)
      .map((player) => player.name);
  }
  return [];
}

/** Public reveal line from the fixed caption bank; never carries the secret word. */
function revealCaption(instance: BlatherInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  if (s.reveal.correct.length === 0) {
    return captionFor({ kind: "reveal", seed: s.round });
  }
  const fastest = s.reveal.correct.reduce((best, index) =>
    s.guessMs[index] < s.guessMs[best] ? index : best,
  );
  return captionFor({
    kind: "fastest",
    name: instance.players[fastest]?.name,
    seed: s.round,
  });
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    // A Rumble passes four rounds; standalone keeps one per player, capped six.
    const rounds = roundsOption(options) ?? standaloneRounds(players.length);
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: rounds,
        phase: "clue",
        presenter: 0,
        target: TARGETS[0],
        clue: null,
        guesses: players.map(() => null),
        guessMs: players.map(() => 0),
        elapsedMs: 0,
        scores: players.map(() => 0),
        timerMs: CLUE_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.map((player): [string, number] => [
            playerStatKey(player.id, "correctGuesses"),
            0,
          ]),
        ),
        answerMsTotal: players.map(() => 0),
        answerCount: players.map(() => 0),
      } satisfies BlatherState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((player) => player.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown } | null;

    if (s.phase === "clue" && index === s.presenter) {
      const clue = cleanText(raw?.text, MAX_CLUE);
      if (clue !== null) {
        s.clue = clue;
        s.phase = "guessing";
        s.timerMs = GUESS_MS;
      }
      return;
    }

    if (s.phase === "guessing" && index !== s.presenter && s.guesses[index] === null) {
      const guess = cleanText(raw?.text, MAX_GUESS);
      if (guess === null) return;
      s.guesses[index] = guess;
      s.guessMs[index] = s.elapsedMs;
      if (allGuessed(inst)) blatherSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const delta = Math.min(Math.max(deltaMs, 0), 2000);
    s.timerMs -= delta;
    if (s.phase === "guessing") s.elapsedMs += delta;
    if (s.timerMs > 0) return;

    if (s.phase === "clue") {
      s.clue = "It is a thing that exists";
      s.phase = "guessing";
      s.timerMs = GUESS_MS;
      return;
    }
    if (s.phase === "guessing") {
      blatherSettle(inst);
      return;
    }
    const next = s.round + 1;
    if (next >= s.maxRounds) {
      s.phase = "finished";
      return;
    }
    blatherBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    const guesserCount = inst.players.length - 1;
    const guessCount = inst.players.filter(
      (_, index) => index !== s.presenter && s.guesses[index] !== null,
    ).length;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      presenterName: inst.players[s.presenter]?.name ?? "",
      clue: s.clue,
      // The secret word only reaches the TV once the round has been revealed.
      target: revealed ? s.target : null,
      guessCount,
      guesserCount,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
      guesses: revealed
        ? inst.players.map((player, index) => ({
          name: player.name,
          guess: s.guesses[index],
          correct: (s.reveal?.correct ?? []).includes(index),
        }))
        : [],
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((player, index) => ({ name: player.name, score: s.scores[index] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? blatherLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    const index = inst.players.findIndex((player) => player.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && blatherLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "clue") {
      if (index === s.presenter) {
        return {
          ...base,
          mode: "text",
          controllerType: "text",
          placeholder: "Describe it without naming it",
          maxLength: MAX_CLUE,
          hasSubmitted: s.clue !== null,
          info: `Secret word: ${s.target}`,
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: `${inst.players[s.presenter].name} is writing a clue...`,
      };
    }

    if (s.phase === "guessing") {
      if (index === s.presenter) {
        return {
          ...base,
          mode: "wait",
          controllerType: "choice",
          options: [],
          info: `Your clue: "${s.clue ?? ""}"`,
        };
      }
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "Your guess",
        maxLength: MAX_GUESS,
        hasSubmitted: s.guesses[index] !== null,
        info: s.clue ?? "",
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: `It was: ${s.target}`,
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    const stats: Record<string, number> = { ...s.stats };
    inst.players.forEach((player, index) => {
      const average = s.answerCount[index] > 0
        ? Math.round(s.answerMsTotal[index] / s.answerCount[index])
        : 0;
      stats[playerStatKey(player.id, "averageAnswerMs")] = average;
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
