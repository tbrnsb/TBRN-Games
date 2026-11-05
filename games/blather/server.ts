/**
 * Blather Round - server logic.
 * Describe a secret thing in one sentence without naming it. Everyone else races to guess.
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

const CLUE_MS = 40000;
const GUESS_MS = 45000;
const REVEAL_MS = 8000;

const manifest: GameManifest = {
  id: "blather",
  name: "Blather Round",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "Describe a secret thing in one sentence without naming it. Everyone else races to guess the word.",
};

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

function blatherLeader(instance: BlatherInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function blatherBegin(instance: BlatherInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.presenter = round % instance.players.length;
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
  return instance.players.every((_, i) => i === s.presenter || s.guesses[i] !== null);
}

function blatherSettle(instance: BlatherInstance): void {
  const s = instance.state;
  const correct: number[] = [];
  for (let i = 0; i < instance.players.length; i++) {
    if (i === s.presenter) continue;
    const guess = s.guesses[i];
    if (!guess) continue;
    if (editDistance(guess, s.target) <= 1) {
      correct.push(i);
      const seconds = Math.floor(s.guessMs[i] / 1000);
      s.scores[i] += Math.max(300, 1000 - seconds * 100);
    }
  }
  s.scores[s.presenter] += correct.length * 300;
  s.reveal = { correct };
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
        round: 0,
        maxRounds: 3,
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
      } satisfies BlatherState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const text = (input as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || text.trim().length === 0) return;

    if (s.phase === "clue" && index === s.presenter) {
      s.clue = text.trim().slice(0, 140);
      s.phase = "guessing";
      s.timerMs = GUESS_MS;
      return;
    }

    if (s.phase === "guessing" && index !== s.presenter && s.guesses[index] === null) {
      s.guesses[index] = text.trim().slice(0, 60);
      s.guessMs[index] = s.elapsedMs;
      if (allGuessed(inst)) blatherSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);
    s.timerMs -= dt;
    if (s.phase === "guessing") s.elapsedMs += dt;
    if (s.timerMs > 0) return;

    if (s.phase === "clue") {
      s.clue = "It is a thing that exists";
      s.phase = "guessing";
      s.timerMs = GUESS_MS;
      return;
    }
    if (s.phase === "guessing") { blatherSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    blatherBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      presenterName: inst.players[s.presenter]?.name ?? "",
      clue: s.clue,
      target: s.phase === "reveal" || s.phase === "finished" ? s.target : null,
      guesses: s.phase === "guessing" || s.phase === "reveal"
        ? inst.players.map((p, i) => ({ name: p.name, guess: s.guesses[i], correct: (s.reveal?.correct ?? []).includes(i) }))
        : [],
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? blatherLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as BlatherInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
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
};

export default plugin;
