/**
 * Slot Car - Server Logic
 * Tap to toggle the throttle. Full speed through a curve spins you out.
 * Three laps; first player to finish wins.
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

interface Car {
  throttle: boolean;
  speed: number; // m/s
  progress: number; // metres around the loop
  lap: number;
  spinOutMs: number; // stuck in a spin (throttle ignored)
  finished: boolean;
}

interface CurveZone {
  from: number; // metres
  to: number; // metres
  limit: number; // max safe speed m/s
}

interface SlotCarState {
  cars: Car[];
  phase: "countdown" | "racing" | "finished";
  countdownMs: number;
  winnerIndex: number | null;
}

interface SlotCarInstance extends GameInstance {
  state: SlotCarState;
}

const TRACK_LENGTH = 900; // metres per lap
const MAX_LAPS = 3;
const MAX_SPEED = 48; // m/s
const ACCEL = 30; // m/s^2
const BRAKE = 45; // m/s^2
const DRAG = 3; // passive slow-down m/s^2
const SPIN_OUT_MS = 1300;
const COUNTDOWN_MS = 2000;

// Curve zones: carry more speed than the limit here and you spin.
const CURVES: CurveZone[] = [
  { from: 140, to: 260, limit: 26 },
  { from: 430, to: 560, limit: 22 },
  { from: 690, to: 790, limit: 30 },
];

const manifest: GameManifest = {
  id: "slotcar",
  name: "Slot Car",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "one-button",
  description: "Tap to toggle the throttle. Ease off before curves or you spin out. 3 laps!",
};

function inCurve(progress: number): CurveZone | null {
  const p = progress % TRACK_LENGTH;
  for (const c of CURVES) {
    if (p >= c.from && p < c.to) return c;
  }
  return null;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): SlotCarInstance {
    return {
      roomId: room.id,
      players,
      state: {
        cars: players.map(() => ({
          throttle: false,
          speed: 0,
          progress: 0,
          lap: 0,
          spinOutMs: 0,
          finished: false,
        })),
        phase: "countdown",
        countdownMs: COUNTDOWN_MS,
        winnerIndex: null,
      },
    };
  },

  onInput(instance: SlotCarInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "racing") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return;
    const car = state.cars[playerIndex];
    if (car.finished) return;

    const tap = (input as { tap?: boolean } | null)?.tap;
    if (!tap) return;
    car.throttle = !car.throttle;
  },

  onTick(instance: SlotCarInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000) / 1000;

    if (state.phase === "countdown") {
      state.countdownMs -= deltaMs;
      if (state.countdownMs <= 0) state.phase = "racing";
      return;
    }

    for (let i = 0; i < state.cars.length; i++) {
      const car = state.cars[i];
      if (car.finished) continue;

      if (car.spinOutMs > 0) {
        car.spinOutMs -= deltaMs;
        car.speed = 0;
        car.throttle = false;
      } else {
        if (car.throttle) {
          car.speed = Math.min(MAX_SPEED, car.speed + ACCEL * dt);
        } else {
          car.speed = Math.max(0, car.speed - BRAKE * dt);
        }
        car.speed = Math.max(0, car.speed - DRAG * dt);

        // Spin out if carrying too much speed through a curve.
        const curve = inCurve(car.progress);
        if (curve && car.speed > curve.limit) {
          car.spinOutMs = SPIN_OUT_MS;
          car.speed = 0;
          car.throttle = false;
          continue;
        }

        car.progress += car.speed * dt;
        car.lap = Math.floor(car.progress / TRACK_LENGTH);
        if (car.lap >= MAX_LAPS) {
          car.progress = MAX_LAPS * TRACK_LENGTH;
          car.finished = true;
          if (state.winnerIndex === null) {
            state.winnerIndex = i;
            state.phase = "finished";
          }
        }
      }
    }

    // Everyone still in the race but nobody can finish (all spun): nothing to
    // do, spin timers are handled above. Safety: if every car finished, end.
    if (state.cars.every((c) => c.finished) && state.phase !== "finished") {
      state.phase = "finished";
      if (state.winnerIndex === null) state.winnerIndex = 0;
    }
  },

  screenState(instance: SlotCarInstance): unknown {
    const state = instance.state;
    return {
      phase: state.phase,
      countdown: state.phase === "countdown" ? Math.ceil(state.countdownMs / 1000) : null,
      trackLength: TRACK_LENGTH,
      curves: CURVES,
      maxLaps: MAX_LAPS,
      cars: state.cars.map((c, i) => ({
        name: instance.players[i].name,
        progress: c.progress % TRACK_LENGTH,
        lap: Math.min(c.lap + 1, MAX_LAPS),
        speed: Math.round(c.speed),
        throttle: c.throttle,
        spunOut: c.spinOutMs > 0,
        finished: c.finished,
      })),
      finished: state.phase === "finished",
      winner:
        state.phase === "finished" && state.winnerIndex !== null
          ? { name: instance.players[state.winnerIndex].name, lap: MAX_LAPS }
          : null,
    };
  },

  controllerState(instance: SlotCarInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const car = state.cars[playerIndex];
    const curve = inCurve(car.progress);
    return {
      phase: state.phase,
      throttle: car.throttle,
      speed: Math.round(car.speed),
      maxSpeed: MAX_SPEED,
      lap: Math.min(car.lap + 1, MAX_LAPS),
      maxLaps: MAX_LAPS,
      progress: (car.progress % TRACK_LENGTH) / TRACK_LENGTH,
      inCurve: curve !== null,
      curveLimit: curve ? curve.limit : null,
      spunOut: car.spinOutMs > 0,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" && state.winnerIndex === playerIndex,
    };
  },
};

export default plugin;
