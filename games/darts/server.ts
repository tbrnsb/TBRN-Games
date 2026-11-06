/**
 * Darts Game - Server Logic
 * Aim with two sliders, throw, score 501 down to zero. 3 darts per turn.
 */


// Types defined inline to avoid import issues with Node type stripping
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

// --- Darts Types ---
interface DartsState {
  currentPlayer: number;
  turn: number;
  scores: number[];
  throws: DartThrow[];
  gameMode: "501" | "301";
  finished: boolean;
  winner: number | null;
  aimX: number; // 0..1 across the board, 0.5 is dead centre
  aimY: number; // 0..1 down the board
  round: number;
  maxRounds: number;
}

interface DartThrow {
  playerIndex: number;
  x: number;
  y: number;
  score: number;
  timestamp: number;
}

interface DartsInstance extends GameInstance {
  state: DartsState;
}

// --- Constants ---
const DARTBOARD_RADIUS = 170;
const BULL_RADIUS = 6.35;
const OUTER_BULL_RADIUS = 15.9;
const TRIPLE_INNER = 99;
const TRIPLE_OUTER = 107;
const DOUBLE_INNER = 162;
const DOUBLE_OUTER = 170;

const SECTOR_VALUES = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

function _getSectorAngle(index: number): number {
  return (-90 + index * 18) * Math.PI / 180;
}

function calculateScore(x: number, y: number): number {
  const dist = Math.sqrt(x * x + y * y);

  if (dist > DARTBOARD_RADIUS) return 0;
  if (dist <= BULL_RADIUS) return 50;
  if (dist <= OUTER_BULL_RADIUS) return 25;

  const angle = Math.atan2(y, x) * 180 / Math.PI;
  const normalizedAngle = (angle + 360) % 360;
  const sectorIndex = Math.floor((normalizedAngle + 9) / 18) % 20;
  const baseScore = SECTOR_VALUES[sectorIndex];

  if (dist >= TRIPLE_INNER && dist <= TRIPLE_OUTER) return baseScore * 3;
  if (dist >= DOUBLE_INNER && dist <= DOUBLE_OUTER) return baseScore * 2;
  return baseScore;
}

// --- Plugin ---
const manifest: GameManifest = {
  id: "darts",
  name: "Darts",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "dual-slider",
  description: "Aim with a horizontal and a vertical slider, then throw. Real darts scoring, 3 darts a turn, 501 down to zero."
};

const MAX_ROUNDS = 20;

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): DartsInstance {
    return {
      roomId: room.id,
      players,
      state: {
        currentPlayer: 0,
        turn: 0,
        scores: players.map(() => 501),
        throws: [],
        gameMode: "501",
        finished: false,
        winner: null,
        aimX: 0.5,
        aimY: 0.5,
        round: 0,
        maxRounds: MAX_ROUNDS,
      }
    };
  },

  onInput(instance: DartsInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.finished) return;

    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    if (playerIndex !== state.currentPlayer) return;
    if (state.turn >= 3) return;

    const raw = input as { slider?: { axis?: string; value?: number }; action?: string } | null;

    // Aiming: the phone streams slider positions while the player drags.
    if (raw?.slider && typeof raw.slider.value === "number") {
      const value = Math.max(0, Math.min(1, raw.slider.value));
      if (raw.slider.axis === "y") state.aimY = value;
      else state.aimX = value;
      return;
    }

    // Throwing: fire at the current aim.
    if (raw?.action !== "action") return;

    const x = (state.aimX * 2 - 1) * DARTBOARD_RADIUS;
    const y = (state.aimY * 2 - 1) * DARTBOARD_RADIUS;
    const score = calculateScore(x, y);

    // No wall clock in game state: the throw index is enough for animation.
    state.throws.push({ playerIndex, x, y, score, timestamp: state.throws.length });
    state.scores[playerIndex] = Math.max(0, state.scores[playerIndex] - score);
    state.turn++;

    if (state.scores[playerIndex] === 0) {
      state.finished = true;
      state.winner = playerIndex;
      return;
    }

    if (state.turn >= 3) {
      state.turn = 0;
      state.currentPlayer = (state.currentPlayer + 1) % instance.players.length;
      if (state.currentPlayer === 0) {
        state.round++;
        if (state.round >= state.maxRounds) {
          // Nobody checked out in time: lowest score wins, so a cold game ends.
          state.finished = true;
          let best = Infinity;
          let winnerIndex = 0;
          state.scores.forEach((s, i) => { if (s < best) { best = s; winnerIndex = i; } });
          state.winner = winnerIndex;
        }
      }
    }
  },

  onTick(_instance: DartsInstance, _deltaMs: number): void {},

  screenState(instance: DartsInstance): unknown {
    const state = instance.state;
    return {
      players: instance.players.map((p, i) => ({
        name: p.name,
        score: state.scores[i],
        isCurrent: i === state.currentPlayer,
        turn: state.turn,
        isWinner: i === state.winner
      })),
      throws: state.throws.slice(-12),
      aim: { x: state.aimX, y: state.aimY, active: !state.finished },
      round: state.round,
      maxRounds: state.maxRounds,
      finished: state.finished,
      winner: state.winner !== null ? instance.players[state.winner].name : null,
      gameMode: state.gameMode
    };
  },

  controllerState(instance: DartsInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    const isCurrent = playerIndex === state.currentPlayer && !state.finished;
    const turnName = instance.players[state.currentPlayer]?.name ?? "";

    return {
      // Dual sliders: horizontal aim, vertical aim. Both are 0..1.
      sliders: {
        x: { value: state.aimX, label: "Left / Right", readout: `${Math.round((state.aimX * 2 - 1) * 100)}` },
        y: { value: state.aimY, label: "Up / Down", readout: `${Math.round((state.aimY * 2 - 1) * 100)}` },
        actionLabel: "THROW",
        disabled: !isCurrent,
        hint: isCurrent ? `${3 - state.turn} darts left` : `Waiting for ${turnName}`,
      },
      yourScore: state.scores[playerIndex] ?? 0,
      yourTurn: isCurrent,
      dartsLeft: isCurrent ? 3 - state.turn : 0,
      finished: state.finished,
      youWon: state.winner === playerIndex,
      currentPlayer: turnName
    };
  }
};

export default plugin;