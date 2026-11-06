/**
 * Golf Game - Server Logic
 * Mini golf: dpad to aim/charge/shoot. 5 holes, obstacles, lowest strokes wins.
 * Controls: left/right rotate aim, up charges power, down shoots.
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

interface Obstacle {
  x: number;
  y: number;
  r: number;
}

interface Course {
  tee: { x: number; y: number };
  hole: { x: number; y: number; r: number };
  obstacles: Obstacle[];
  par: number;
}

interface GolfState {
  currentPlayer: number;
  phase: "aiming" | "moving" | "hole-done" | "finished";
  ball: { x: number; y: number; vx: number; vy: number };
  power: number; // 0..1 charge
  angle: number; // radians
  holeIndex: number;
  holeDoneTimerMs: number;
  holeStrokes: number[]; // strokes this hole, per player
  totalStrokes: number[]; // strokes all holes, per player
  holesCompletedBy: number[]; // holes finished, per player
}

interface GolfInstance extends GameInstance {
  state: GolfState;
}

// Five holes: tee, cup, rocks (obstacles), par.
const COURSES: Course[] = [
  { tee: { x: 0.1, y: 0.5 }, hole: { x: 0.9, y: 0.5, r: 0.035 }, obstacles: [], par: 2 },
  { tee: { x: 0.1, y: 0.2 }, hole: { x: 0.9, y: 0.8, r: 0.035 }, obstacles: [{ x: 0.5, y: 0.5, r: 0.09 }], par: 3 },
  { tee: { x: 0.5, y: 0.1 }, hole: { x: 0.5, y: 0.9, r: 0.035 }, obstacles: [{ x: 0.3, y: 0.5, r: 0.07 }, { x: 0.7, y: 0.5, r: 0.07 }], par: 3 },
  { tee: { x: 0.1, y: 0.8 }, hole: { x: 0.9, y: 0.2, r: 0.035 }, obstacles: [{ x: 0.45, y: 0.65, r: 0.07 }, { x: 0.6, y: 0.35, r: 0.07 }], par: 4 },
  { tee: { x: 0.2, y: 0.2 }, hole: { x: 0.8, y: 0.8, r: 0.035 }, obstacles: [{ x: 0.5, y: 0.5, r: 0.1 }], par: 4 },
];

const TURN_STEP = 0.08; // aim rotation per press (radians)
const POWER_STEP = 0.12; // charge per press
const MIN_POWER = 0.15;
const MAX_BALL_SPEED = 3.2; // units/sec at full power (about one field of roll)
const FRICTION_PER_SEC = 0.05; // velocity multiplies by this each second
const WALL_BOUNCE = 0.55;
const STOP_SPEED = 0.04;
const HOLE_DONE_MS = 1500;
const MAX_EXTRA_STROKES = 4; // pick up at par + 4 so a hole always ends

const manifest: GameManifest = {
  id: "golf",
  name: "Golf",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "aim",
  description: "Mini golf - aim with left/right, charge with up, shoot with down. 5 holes, obstacles, lowest strokes wins.",
};

function loadCourse(state: GolfState, holeIndex: number): void {
  const c = COURSES[holeIndex];
  state.ball = { x: c.tee.x, y: c.tee.y, vx: 0, vy: 0 };
  // Aim at the cup by default.
  state.angle = Math.atan2(c.hole.y - c.tee.y, c.hole.x - c.tee.x);
  state.power = 0;
  state.phase = "aiming";
}

function shoot(instance: GolfInstance): void {
  const state = instance.state;
  if (state.phase !== "aiming") return;
  if (state.power < MIN_POWER) return;
  const course = COURSES[state.holeIndex];
  const playerIndex = state.currentPlayer;
  state.holeStrokes[playerIndex]++;
  state.totalStrokes[playerIndex]++;
  // Safety valve: a hole can never run forever. Pick up at par + 4.
  if (state.holeStrokes[playerIndex] >= course.par + MAX_EXTRA_STROKES) {
    state.power = 0;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.phase = "hole-done";
    state.holeDoneTimerMs = HOLE_DONE_MS;
    return;
  }
  state.phase = "moving";
  state.ball.vx = Math.cos(state.angle) * state.power * MAX_BALL_SPEED;
  state.ball.vy = Math.sin(state.angle) * state.power * MAX_BALL_SPEED;
  state.power = 0;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GolfInstance {
    const instance: GolfInstance = {
      roomId: room.id,
      players,
      state: {
        currentPlayer: 0,
        phase: "aiming",
        ball: { x: 0, y: 0, vx: 0, vy: 0 },
        power: 0,
        angle: 0,
        holeIndex: 0,
        holeDoneTimerMs: 0,
        holeStrokes: players.map(() => 0),
        totalStrokes: players.map(() => 0),
        holesCompletedBy: players.map(() => 0),
      },
    };
    loadCourse(instance.state, 0);
    return instance;
  },

  onInput(instance: GolfInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase === "finished") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex !== state.currentPlayer) return;
    if (state.phase !== "aiming") return;

    const raw = input as {
      pad?: { x?: number; y?: number };
      slider?: { axis?: string; value?: number };
      action?: string;
      move?: string;
    } | null;

    // Joystick: the stick points where the ball should go. Screen y grows
    // downward, so the stick's "up" is negative in board space.
    if (raw?.pad) {
      const px = Number(raw.pad.x ?? 0);
      const py = Number(raw.pad.y ?? 0);
      if (Number.isFinite(px) && Number.isFinite(py) && Math.hypot(px, py) > 0.15) {
        state.angle = Math.atan2(-py, px);
      }
      return;
    }

    // Power slider: sets shot strength directly, 0..1.
    if (raw?.slider && typeof raw.slider.value === "number") {
      state.power = Math.max(0, Math.min(1, raw.slider.value));
      return;
    }

    if (raw?.action === "action") {
      shoot(instance);
      return;
    }

    // Legacy d-pad mapping, kept so an older controller build still plays.
    const move = raw?.move;
    if (typeof move !== "string") return;
    switch (move) {
      case "left":
        state.angle -= TURN_STEP;
        break;
      case "right":
        state.angle += TURN_STEP;
        break;
      case "up":
        state.power = Math.min(1, state.power + POWER_STEP);
        break;
      case "down":
        shoot(instance);
        break;
      default:
        break;
    }
  },

  onTick(instance: GolfInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000) / 1000;

    if (state.phase === "hole-done") {
      state.holeDoneTimerMs -= deltaMs;
      if (state.holeDoneTimerMs <= 0) advance(instance);
      return;
    }

    if (state.phase !== "moving") return;

    const course = COURSES[state.holeIndex];
    const ball = state.ball;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Friction (exponential decay, frame-rate independent).
    const friction = Math.pow(FRICTION_PER_SEC, dt);
    ball.vx *= friction;
    ball.vy *= friction;

    // Walls.
    if (ball.x < 0) { ball.x = 0; ball.vx = Math.abs(ball.vx) * WALL_BOUNCE; }
    if (ball.x > 1) { ball.x = 1; ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE; }
    if (ball.y < 0) { ball.y = 0; ball.vy = Math.abs(ball.vy) * WALL_BOUNCE; }
    if (ball.y > 1) { ball.y = 1; ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE; }

    // Rock obstacles.
    for (const obs of course.obstacles) {
      const dx = ball.x - obs.x;
      const dy = ball.y - obs.y;
      const dist = Math.hypot(dx, dy);
      if (dist < obs.r + 0.015 && dist > 0.0001) {
        const nx = dx / dist;
        const ny = dy / dist;
        ball.x = obs.x + nx * (obs.r + 0.015);
        ball.y = obs.y + ny * (obs.r + 0.015);
        const dot = ball.vx * nx + ball.vy * ny;
        ball.vx = (ball.vx - 2 * dot * nx) * WALL_BOUNCE;
        ball.vy = (ball.vy - 2 * dot * ny) * WALL_BOUNCE;
      }
    }

    // Cup.
    const hd = Math.hypot(ball.x - course.hole.x, ball.y - course.hole.y);
    if (hd < course.hole.r) {
      ball.vx = 0;
      ball.vy = 0;
      ball.x = course.hole.x;
      ball.y = course.hole.y;
      state.phase = "hole-done";
      state.holeDoneTimerMs = HOLE_DONE_MS;
      return;
    }

    // Stopped short of the cup: play the next stroke from here.
    if (Math.hypot(ball.vx, ball.vy) < STOP_SPEED) {
      ball.vx = 0;
      ball.vy = 0;
      state.phase = "aiming";
      state.power = 0;
      state.angle = Math.atan2(course.hole.y - ball.y, course.hole.x - ball.x);
    }
  },

  screenState(instance: GolfInstance): unknown {
    const state = instance.state;
    const course = COURSES[state.holeIndex];
    return {
      phase: state.phase,
      ball: state.ball,
      hole: course.hole,
      obstacles: course.obstacles,
      power: state.power,
      angle: state.angle,
      currentPlayer: state.currentPlayer,
      holeNumber: state.holeIndex + 1,
      maxHoles: COURSES.length,
      par: course.par,
      holeStrokes: state.holeStrokes,
      scores: instance.players.map((p, i) => ({
        name: p.name,
        totalStrokes: state.totalStrokes[i],
        holeStrokes: state.holeStrokes[i],
        holesCompleted: state.holesCompletedBy[i],
      })),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: GolfInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const course = COURSES[state.holeIndex];
    return {
      phase: state.phase,
      isYourTurn: playerIndex === state.currentPlayer && state.phase !== "finished",
      // Joystick + power slider + shoot button.
      aim: {
        x: Math.cos(state.angle),
        y: -Math.sin(state.angle), // pad y is up-positive, board y is down
        power: state.power,
        actionLabel: "SHOOT",
        hint: state.phase === "aiming"
          ? `Hole ${state.holeIndex + 1} · par ${course.par}`
          : "Ball rolling…",
        disabled: !(playerIndex === state.currentPlayer && state.phase === "aiming"),
      },
      power: state.power,
      angle: state.angle,
      holeNumber: state.holeIndex + 1,
      maxHoles: COURSES.length,
      par: course.par,
      yourHoleStrokes: state.holeStrokes[playerIndex],
      yourTotalStrokes: state.totalStrokes[playerIndex],
      labels: { up: "+ Power", down: "Shoot" },
      finished: state.phase === "finished",
      youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false,
    };
  },
};

function advance(instance: GolfInstance): void {
  const state = instance.state;
  state.holesCompletedBy[state.currentPlayer]++;

  // Next player on the same hole, then the next hole for everyone.
  if (state.currentPlayer < instance.players.length - 1) {
    state.currentPlayer++;
    loadCourse(state, state.holeIndex);
    return;
  }

  if (state.holeIndex >= COURSES.length - 1) {
    state.phase = "finished";
    return;
  }

  state.currentPlayer = 0;
  state.holeIndex++;
  state.holeStrokes = instance.players.map(() => 0);
  loadCourse(state, state.holeIndex);
}

function getWinner(instance: GolfInstance): { name: string; score: number } | null {
  const state = instance.state;
  let best = Infinity;
  let idx = -1;
  state.totalStrokes.forEach((s, i) => {
    if (s < best) {
      best = s;
      idx = i;
    }
  });
  if (idx >= 0) return { name: instance.players[idx].name, score: best };
  return null;
}

export default plugin;
