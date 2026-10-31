/**
 * Racing - Server Logic
 * Steer left/right between lanes, dodge obstacles. First across the finish wins.
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

interface RacerState {
  lane: number;
  distance: number;
  speed: number;
  finished: boolean;
  hitStunMs: number; // brief slow-down after a crash
}

interface Obstacle {
  lane: number;
  distance: number; // absolute race distance of the obstacle
  hit: boolean;
}

interface RacingState {
  racers: RacerState[];
  obstacles: Obstacle[];
  nextObstacleDistance: number;
  phase: "countdown" | "racing" | "finished";
  countdownMs: number;
  elapsedMs: number;
  winnerIndex: number | null;
}

interface RacingInstance extends GameInstance {
  state: RacingState;
}

const LANES = 5;
const FINISH_DISTANCE = 600; // metres
const MAX_SPEED = 42; // m/s
const ACCEL = 18; // m/s^2
const CRASH_SPEED_FACTOR = 0.35;
const CRASH_STUN_MS = 700;
const COUNTDOWN_MS = 3000;
const RACE_TIMEOUT_MS = 120000; // safety: race ends after 2 minutes
const OBSTACLE_SPACING = 60; // metres between obstacle batches
const FIRST_OBSTACLE_AT = 150;

const manifest: GameManifest = {
  id: "racing",
  name: "Racing",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "left-right",
  description: "Steer left/right, avoid obstacles, overtake opponents. First to the finish wins!",
};

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): RacingInstance {
    return {
      roomId: room.id,
      players,
      state: {
        racers: players.map(() => ({ lane: 0, distance: 0, speed: 0, finished: false, hitStunMs: 0 })),
        obstacles: [],
        nextObstacleDistance: FIRST_OBSTACLE_AT,
        phase: "countdown",
        countdownMs: COUNTDOWN_MS,
        elapsedMs: 0,
        winnerIndex: null,
      },
    };
  },

  onInput(instance: RacingInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "racing") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return;
    const racer = state.racers[playerIndex];
    if (racer.finished) return;

    const move = (input as { move?: string } | null)?.move;
    if (move === "left") {
      racer.lane = Math.max(0, racer.lane - 1);
    } else if (move === "right") {
      racer.lane = Math.min(LANES - 1, racer.lane + 1);
    }
  },

  onTick(instance: RacingInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000) / 1000;

    if (state.phase === "countdown") {
      state.countdownMs -= deltaMs;
      if (state.countdownMs <= 0) state.phase = "racing";
      return;
    }

    state.elapsedMs += deltaMs;

    // Spawn obstacle rows ahead of the leader.
    const leader = Math.max(0, ...state.racers.map((r) => r.distance));
    while (state.nextObstacleDistance < leader + FINISH_DISTANCE) {
      const rows = 1 + Math.floor(Math.random() * (LANES - 1)); // leave at least one gap
      const lanes = shuffle([0, 1, 2, 3, 4]).slice(0, rows);
      for (const lane of lanes) {
        state.obstacles.push({ lane, distance: state.nextObstacleDistance, hit: false });
      }
      state.nextObstacleDistance += OBSTACLE_SPACING;
      if (state.nextObstacleDistance > FINISH_DISTANCE + 200) break;
    }

    // Move racers.
    for (const racer of state.racers) {
      if (racer.hitStunMs > 0) {
        racer.hitStunMs -= deltaMs;
      } else if (racer.speed < MAX_SPEED) {
        racer.speed = Math.min(MAX_SPEED, racer.speed + ACCEL * dt);
      }
      racer.distance += racer.speed * dt;
    }

    // Collisions: same lane, obstacle at close range, not yet hit.
    for (const racer of state.racers) {
      if (racer.hitStunMs > 0) continue;
      for (const obs of state.obstacles) {
        if (obs.hit || obs.lane !== racer.lane) continue;
        if (Math.abs(obs.distance - racer.distance) < 4) {
          obs.hit = true;
          racer.speed *= CRASH_SPEED_FACTOR;
          racer.hitStunMs = CRASH_STUN_MS;
          break;
        }
      }
    }

    // Finish check: first across wins.
    for (let i = 0; i < state.racers.length; i++) {
      if (state.racers[i].distance >= FINISH_DISTANCE) {
        state.racers[i].finished = true;
        state.winnerIndex = i;
        state.phase = "finished";
        return;
      }
    }

    // Safety timeout: furthest along wins.
    if (state.elapsedMs >= RACE_TIMEOUT_MS) {
      let best = 0;
      for (let i = 1; i < state.racers.length; i++) {
        if (state.racers[i].distance > state.racers[best].distance) best = i;
      }
      state.winnerIndex = best;
      state.phase = "finished";
    }
  },

  screenState(instance: RacingInstance): unknown {
    const state = instance.state;
    return {
      phase: state.phase,
      countdown: state.phase === "countdown" ? Math.ceil(state.countdownMs / 1000) : null,
      lanes: LANES,
      finishDistance: FINISH_DISTANCE,
      racers: state.racers.map((r, i) => ({
        name: instance.players[i].name,
        lane: r.lane,
        progress: Math.min(1, r.distance / FINISH_DISTANCE),
        speed: Math.round(r.speed),
        crashed: r.hitStunMs > 0,
      })),
      obstacles: state.obstacles.filter((o) => !o.hit),
      finished: state.phase === "finished",
      winner:
        state.phase === "finished" && state.winnerIndex !== null
          ? { name: instance.players[state.winnerIndex].name, progress: Math.min(1, state.racers[state.winnerIndex].distance / FINISH_DISTANCE) }
          : null,
    };
  },

  controllerState(instance: RacingInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const racer = state.racers[playerIndex];
    return {
      phase: state.phase,
      lane: racer.lane,
      lanes: LANES,
      progress: Math.min(1, racer.distance / FINISH_DISTANCE),
      speed: Math.round(racer.speed),
      crashed: racer.hitStunMs > 0,
      distance: Math.round(racer.distance),
      finishDistance: FINISH_DISTANCE,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" && state.winnerIndex === playerIndex,
    };
  },
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default plugin;
