/**
 * Darts Game - Server Logic
 * Timing-lock aim: a horizontal marker sweeps the board and one press locks X,
 * then a vertical marker sweeps and the next press locks Y, which throws.
 * 3 darts a turn, 501 down to zero.
 */

import { roundsOption } from "../../shared/game-options.ts";

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
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance;
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
  // Timing-lock aim: markers sweep 0..1 and bounce; a press freezes one axis.
  phase: "aimX" | "aimY";
  markerX: number;
  markerY: number;
  dirX: 1 | -1;
  dirY: 1 | -1;
  lockedX: number | null;
  lockedY: number | null;
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
export const DARTBOARD_RADIUS = 170;
const BULL_RADIUS = 6.35;
const OUTER_BULL_RADIUS = 15.9;
const TRIPLE_INNER = 99;
const TRIPLE_OUTER = 107;
const DOUBLE_INNER = 162;
const DOUBLE_OUTER = 170;

/**
 * One full 0 → 1 traverse of an aiming marker, in milliseconds. Both markers
 * sweep at this constant speed (so one ms moves 1/1200 of the board) and
 * reflect off the 0 and 1 edges, which is the whole aiming difficulty.
 */
export const AIM_SWEEP_MS = 1200;

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

/** Arm a fresh dart: both markers at 0 and sweeping outward. */
function resetAim(state: DartsState): void {
  state.phase = "aimX";
  state.markerX = 0;
  state.markerY = 0;
  state.dirX = 1;
  state.dirY = 1;
  state.lockedX = null;
  state.lockedY = null;
}

/**
 * Move one marker by `step` at constant speed, reflecting it off 0 and 1.
 * A 2000 ms delta can carry the marker past both walls in one tick, so keep
 * reflecting until the value is back inside the board.
 */
function sweep(marker: number, dir: 1 | -1, step: number): { marker: number; dir: 1 | -1 } {
  let next = marker + dir * step;
  while (next > 1 || next < 0) {
    if (next > 1) {
      next = 2 - next;
      dir = -1;
    } else {
      next = -next;
      dir = 1;
    }
  }
  return { marker: next, dir };
}

const manifest: GameManifest = {
  id: "darts",
  name: "Darts",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "dual-slider",
  description: "Stop the sweeping horizontal marker, then the vertical one, to throw. Real darts scoring, 3 darts a turn, 501 down to zero."
};

const MAX_ROUNDS = 20;

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): DartsInstance {
    const state: DartsState = {
      currentPlayer: 0,
      turn: 0,
      scores: players.map(() => 501),
      throws: [],
      gameMode: "501",
      finished: false,
      winner: null,
      phase: "aimX",
      markerX: 0,
      markerY: 0,
      dirX: 1,
      dirY: 1,
      lockedX: null,
      lockedY: null,
      round: 0,
      maxRounds: roundsOption(options) ?? MAX_ROUNDS,
    };
    return {
      roomId: room.id,
      players,
      state
    };
  },

  onInput(instance: DartsInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.finished) return;

    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    if (playerIndex !== state.currentPlayer) return;
    if (state.turn >= 3) return;

    // The phone only sends one button. Slider drags and anything else are
    // ignored so the server stays the sole owner of the aim.
    const raw = input as { action?: unknown } | null;
    if (raw?.action !== "action") return;

    if (state.phase === "aimX") {
      state.lockedX = state.markerX;
      state.phase = "aimY";
      return;
    }

    state.lockedY = state.markerY;
    resolveThrow(state, instance.players.length, playerIndex);
    // A checkout keeps the final aim on screen; otherwise arm the next dart.
    if (!state.finished) resetAim(state);
  },

  onTick(instance: DartsInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.finished) return;

    const delta = Number.isFinite(deltaMs) ? Math.min(Math.max(deltaMs, 0), 2000) : 0;
    if (delta <= 0) return;
    const step = delta / AIM_SWEEP_MS;

    // Only the axis being aimed moves; the locked axis stays where it was.
    if (state.phase === "aimX") {
      const moved = sweep(state.markerX, state.dirX, step);
      state.markerX = moved.marker;
      state.dirX = moved.dir;
    } else {
      const moved = sweep(state.markerY, state.dirY, step);
      state.markerY = moved.marker;
      state.dirY = moved.dir;
    }
  },

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
      aim: {
        x: state.phase === "aimX" ? state.markerX : (state.lockedX ?? 0.5),
        y: state.phase === "aimY" ? state.markerY : (state.lockedY ?? 0.5),
        phase: state.phase,
        lockedX: state.lockedX,
        lockedY: state.lockedY,
        active: !state.finished
      },
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
    const aimX = state.phase === "aimX" ? state.markerX : (state.lockedX ?? 0.5);
    const aimY = state.phase === "aimY" ? state.markerY : (state.lockedY ?? 0.5);
    const readout = (value: number): string => `${Math.round(value * 100)}`;

    return {
      // The dual-slider layout is reused read-only: the server streams the
      // marker positions and the phone only presses the action button.
      sliders: {
        x: { value: aimX, label: "HORIZONTAL", readout: readout(aimX), locked: state.lockedX !== null },
        y: { value: aimY, label: "VERTICAL", readout: readout(aimY), locked: state.lockedY !== null },
        actionLabel: state.phase === "aimX" ? "LOCK HORIZONTAL" : "LOCK VERTICAL",
        disabled: !isCurrent,
        readOnly: true,
        hint: isCurrent
          ? `${3 - state.turn} darts left · ${state.phase === "aimX" ? "lock the X marker" : "lock the Y marker"}`
          : `Waiting for ${turnName}`,
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

/**
 * Land one dart at the two locked markers: turn it into board coordinates,
 * score it, and apply the existing checkout / turn / round / winner rules.
 */
function resolveThrow(state: DartsState, playerCount: number, playerIndex: number): void {
  const lockedX = state.lockedX ?? 0.5;
  const lockedY = state.lockedY ?? 0.5;
  const x = (lockedX * 2 - 1) * DARTBOARD_RADIUS;
  const y = (lockedY * 2 - 1) * DARTBOARD_RADIUS;
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
    state.currentPlayer = (state.currentPlayer + 1) % playerCount;
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
}

export default plugin;
