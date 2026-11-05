/**
 * Percentile - server logic.
 * One player estimates a real statistic on a slider. Everyone else bets higher or lower. Close guess, big score.
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


interface Prompt { q: string; answer: number }

interface PercentileState {
  prompts: Prompt[];
  round: number;
  maxRounds: number;
  phase: "guessing" | "betting" | "reveal" | "finished";
  guesser: number;
  guess: number | null;
  bets: Array<"higher" | "lower" | null>;
  scores: number[];
  timerMs: number;
  reveal: { actual: number; delta: number; points: number } | null;
}

interface PercentileInstance extends GameInstance { state: PercentileState }

const PROMPTS: Prompt[] = [
  { q: "What % of adults admit to eating food that fell on the floor?", answer: 52 },
  { q: "What % of people sing in the shower?", answer: 71 },
  { q: "What % of drivers admit to talking to other cars?", answer: 34 },
  { q: "What % of people have cried at a movie in the last year?", answer: 46 },
  { q: "What % of adults still sleep with a childhood toy?", answer: 28 },
  { q: "What % of people have pretended to laugh at a joke they did not get?", answer: 83 },
  { q: "What % of workers have cried in a bathroom at work?", answer: 19 },
  { q: "What % of people check their phone within a minute of waking?", answer: 62 },
  { q: "What % of adults cannot swim 25 metres?", answer: 41 },
  { q: "What % of people have lied on a dating profile?", answer: 57 },
  { q: "What % of households own a hammer they have never used?", answer: 66 },
  { q: "What % of people have fallen asleep on public transport and missed their stop?", answer: 37 },
];

const GUESS_MS = 30000;
const BET_MS = 15000;
const REVEAL_MS = 7000;

const manifest: GameManifest = {
  id: "percentile",
  name: "Percentile",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "slider",
  description: "One player estimates a real statistic on a slider. Everyone else bets higher or lower. Closer guess, bigger score.",
};

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
  const actual = s.prompts[s.round % s.prompts.length].answer;
  const guess = s.guess ?? 50;
  s.guess = guess;
  const delta = Math.abs(guess - actual);
  const points = delta === 0 ? 1000 : delta <= 15 ? Math.max(0, 1000 - delta * 50) : 0;
  s.scores[s.guesser] += points;
  for (let i = 0; i < instance.players.length; i++) {
    if (i === s.guesser) continue;
    const bet = s.bets[i];
    if (!bet) continue;
    const correct = (actual > guess && bet === "higher") || (actual < guess && bet === "lower");
    if (correct) s.scores[i] += delta > 20 ? 700 : 500;
  }
  s.reveal = { actual, delta, points };
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
        prompts: secureShuffle(PROMPTS).slice(0, 5),
        round: 0,
        maxRounds: 5,
        phase: "guessing",
        guesser: 0,
        guess: null,
        bets: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: GUESS_MS,
        reveal: null,
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
      if (raw?.slider && typeof raw.slider.value === "number") {
        s.guess = Math.round(Math.max(0, Math.min(1, raw.slider.value)) * 100);
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
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
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
    const prompt = s.prompts[s.round % s.prompts.length];
    const shown = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      question: prompt.q,
      guesserName: inst.players[s.guesser]?.name ?? "",
      guess: shown ? s.guess : null,
      actual: shown ? prompt.answer : null,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as PercentileInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const prompt = s.prompts[s.round % s.prompts.length];
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
            readout: `${s.guess ?? 50}%`,
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
          info: `You guessed ${s.guess}%. Everyone else is betting.`,
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
        info: `${inst.players[s.guesser].name} guessed ${s.guess}%`,
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: `The answer was ${prompt.answer}%`,
    };
  },
};

export default plugin;
