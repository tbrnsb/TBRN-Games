/**
 * Racing - Server Logic
 * Pure mash race: every tap shoves your racer forward. First across the line wins.
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

// --- Types ---
interface RacerState {
  lane: number;
  distance: number;
  speed: number;
  taps: number;
  finished: boolean;
}

interface RacingState {
  racers: RacerState[];
  phase: "countdown" | "racing" | "finished";
  countdownMs: number;
  elapsedMs: number;
  winnerIndex: number | null;
}

interface RacingInstance extends GameInstance {
  state: RacingState;
}

// --- Tuning ---
const COUNTDOWN_MS = 3000;
const FINISH_DISTANCE = 100;
const TAP_BOOST = 0.9;        // speed added per tap
const MAX_SPEED = 16;         // ceiling so mashing cannot teleport
const FRICTION_PER_SEC = 0.55; // speed multiplier per second when not tapping
const RACE_TIMEOUT_MS = 60000;

const manifest: GameManifest = {
  id: "racing",
  name: "Tap Race",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "tap-race",
  description: "Mash the button. Every tap shoves your racer forward and speed bleeds off fast. First across the line wins.",
};

function winnerFromProgress(state: RacingState): number {
  let best = -1;
  let idx = 0;
  state.racers.forEach((r, i) => { if (r.distance > best) { best = r.distance; idx = i; } });
  return idx;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): RacingInstance {
    return {
      roomId: room.id,
      players,
      state: {
        racers: players.map((_, i) => ({ lane: i, distance: 0, speed: 0, taps: 0, finished: false })),
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
    const tap = (input as { tap?: unknown } | null)?.tap;
    if (tap !== true) return;

    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return;
    const racer = state.racers[playerIndex];
    if (!racer || racer.finished) return;

    racer.taps++;
    racer.speed = Math.min(MAX_SPEED, racer.speed + TAP_BOOST);
  },

  onTick(instance: RacingInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;

    if (state.phase === "countdown") {
      state.countdownMs -= deltaMs;
      if (state.countdownMs <= 0) {
        state.countdownMs = 0;
        state.phase = "racing";
      }
      return;
    }

    const dt = Math.min(Math.max(deltaMs, 0), 2000) / 1000;
    state.elapsedMs += deltaMs;

    for (const racer of state.racers) {
      if (racer.finished) continue;
      racer.distance += racer.speed * dt;
      racer.speed *= Math.pow(FRICTION_PER_SEC, dt);
      if (racer.distance >= FINISH_DISTANCE) {
        racer.distance = FINISH_DISTANCE;
        racer.finished = true;
        if (state.winnerIndex === null) {
          state.winnerIndex = state.racers.indexOf(racer);
          state.phase = "finished";
        }
      }
    }

    // Nobody mashed enough: whoever is furthest along takes it at the buzzer.
    if (state.phase !== "finished" && state.elapsedMs >= RACE_TIMEOUT_MS) {
      state.winnerIndex = winnerFromProgress(state);
      state.phase = "finished";
    }
  },

  screenState(instance: RacingInstance): unknown {
    const state = instance.state;
    return {
      phase: state.phase,
      countdown: state.phase === "countdown" ? Math.max(1, Math.ceil(state.countdownMs / 1000)) : null,
      lanes: instance.players.length,
      racers: instance.players.map((p, i) => ({
        name: p.name,
        lane: state.racers[i].lane,
        progress: Math.min(1, state.racers[i].distance / FINISH_DISTANCE),
        taps: state.racers[i].taps,
        speed: state.racers[i].speed,
        finished: state.racers[i].finished,
      })),
      obstacles: [],
      finishDistance: FINISH_DISTANCE,
      elapsedMs: state.elapsedMs,
      finished: state.phase === "finished",
      winner:
        state.phase === "finished" && state.winnerIndex !== null
          ? {
              name: instance.players[state.winnerIndex].name,
              progress: Math.min(1, state.racers[state.winnerIndex].distance / FINISH_DISTANCE),
            }
          : null,
    };
  },

  controllerState(instance: RacingInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const racer = state.racers[playerIndex];
    if (!racer) return { race: { disabled: true, label: "TAP!" } };

    // Show the closest rival by tap count so the phone has someone to beat.
    let rivalIndex = -1;
    let rivalTaps = -1;
    state.racers.forEach((r, i) => {
      if (i !== playerIndex && r.taps > rivalTaps) {
        rivalTaps = r.taps;
        rivalIndex = i;
      }
    });

    return {
      race: {
        taps: racer.taps,
        progress: Math.min(1, racer.distance / FINISH_DISTANCE),
        label: state.phase === "countdown" ? "READY" : "TAP!",
        opponentName: rivalIndex >= 0 ? instance.players[rivalIndex].name : "",
        opponentTaps: rivalIndex >= 0 ? state.racers[rivalIndex].taps : 0,
        finished: state.phase === "finished",
        disabled: state.phase !== "racing",
      },
      distance: Math.round(racer.distance),
      taps: racer.taps,
      phase: state.phase,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" && state.winnerIndex === playerIndex,
    };
  },
};

export default plugin;
