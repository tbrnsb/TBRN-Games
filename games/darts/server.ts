/**
 * Darts Game - Server Logic
 * Classic darts: 3 darts per turn, score 501/301, closest to center wins
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

// --- Darts Types ---
interface DartsState {
  currentPlayer: number;
  turn: number;
  scores: number[];
  throws: DartThrow[];
  gameMode: "501" | "301";
  finished: boolean;
  winner: number | null;
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
  controllerType: "one-button",
  description: "Classic darts - tap to throw, closest to center wins. 3 darts per turn, 501/301 scoring."
};

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
        winner: null
      }
    };
  },

  onInput(instance: DartsInstance, playerId: string, _input: unknown): void {
    const state = instance.state;
    if (state.finished) return;

    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    if (playerIndex !== state.currentPlayer) return;
    if (state.turn >= 3) return;

    const angle = Math.random() * Math.PI * 2;
    const power = 0.3 + Math.random() * 0.7;
    const distance = power * DARTBOARD_RADIUS * 0.95;

    const x = distance * Math.cos(angle);
    const y = distance * Math.sin(angle);
    const score = calculateScore(x, y);

    const throwData: DartThrow = { playerIndex, x, y, score, timestamp: Date.now() };
    state.throws.push(throwData);
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
      finished: state.finished,
      winner: state.winner !== null ? instance.players[state.winner].name : null,
      gameMode: state.gameMode
    };
  },

  controllerState(instance: DartsInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    const isCurrent = playerIndex === state.currentPlayer && !state.finished;

    return {
      yourScore: state.scores[playerIndex],
      yourTurn: isCurrent,
      dartsLeft: isCurrent ? 3 - state.turn : 0,
      finished: state.finished,
      youWon: state.winner === playerIndex,
      currentPlayer: instance.players[state.currentPlayer].name
    };
  }
};

export default plugin;