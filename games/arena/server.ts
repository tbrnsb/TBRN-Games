/**
 * Slogan Shirts - server logic.
 * Draw a design, write a slogan, then everyone gets someone else's slogan on their shirt and you vote for the best.
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
  | "chat"
  | "role"
  | "rank";

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








interface Puck { x: number; y: number; vx: number; vy: number; alive: boolean }

interface ArenaState {
  round: number;
  rounds: number;
  phase: "aiming" | "moving" | "finished";
  pucks: Puck[];
  hazards: Array<{ x: number; y: number; r: number }>;
  turn: number;
  aimX: number;
  aimY: number;
  power: number;
  timerMs: number;
  simMs: number;
  scores: number[];
  roundWinner: number | null;
}

interface ArenaInstance extends GameInstance { state: ArenaState }

const PUCK_R = 0.055;
const HAZARD_R = 0.07;
const FRICTION_PER_SEC = 0.35;
const MIN_SPEED = 0.7;
const MAX_SPEED = 2.4;
const STOP_SPEED = 0.03;
const SIM_LIMIT_MS = 6000;
const ROUND_MS = 60000;
const SHOT_MS = 20000;
const ROUNDS = 3;

const manifest: GameManifest = {
  id: "arena",
  name: "Slingshot Arena",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "aim",
  description: "Flip your puck around a shrinking arena, hit the others off the edge, and stay alive. Best of three.",
};

/** Unit direction scaled by power. Power below 0.15 is nudged up so every shot moves. */
export function impulseFor(aimX: number, aimY: number, power: number): { vx: number; vy: number } {
  const length = Math.hypot(aimX, aimY);
  if (length < 0.01) return { vx: 0, vy: 0 };
  const clampedPower = Math.max(0.15, Math.min(1, power));
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * clampedPower;
  return { vx: (aimX / length) * speed, vy: (aimY / length) * speed };
}

/** A puck is out once its centre leaves the arena circle. */
export function outOfBounds(p: { x: number; y: number }): boolean {
  return Math.hypot(p.x, p.y) > 1 - PUCK_R * 0.5;
}

function arenaLeader(instance: ArenaInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function resetRound(instance: ArenaInstance): void {
  const s = instance.state;
  const n = instance.players.length;
  s.pucks = instance.players.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * 0.55, y: Math.sin(angle) * 0.55, vx: 0, vy: 0, alive: true };
  });
  s.hazards = [
    { x: 0.25, y: 0.2, r: HAZARD_R },
    { x: -0.3, y: -0.15, r: HAZARD_R },
  ];
  s.turn = 0;
  s.aimX = 0;
  s.aimY = 1;
  s.power = 0.5;
  s.timerMs = ROUND_MS;
  s.simMs = 0;
  s.roundWinner = null;
  s.phase = "aiming";
}

function nearestToCentre(instance: ArenaInstance): number {
  const s = instance.state;
  let best = Infinity;
  let idx = -1;
  s.pucks.forEach((p, i) => {
    if (!p.alive) return;
    const d = Math.hypot(p.x, p.y);
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

function endRound(instance: ArenaInstance, winner: number): void {
  const s = instance.state;
  s.roundWinner = winner >= 0 ? winner : null;
  if (winner >= 0) s.scores[winner]++;
  s.round++;
  if (s.round >= s.rounds) { s.phase = "finished"; return; }
  resetRound(instance);
}

function nextTurn(instance: ArenaInstance): void {
  const s = instance.state;
  const alive = s.pucks.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
  if (alive.length <= 1) { endRound(instance, alive[0] ?? -1); return; }
  let next = s.turn;
  for (let step = 1; step <= s.pucks.length; step++) {
    const i = (s.turn + step) % s.pucks.length;
    if (s.pucks[i].alive) { next = i; break; }
  }
  s.turn = next;
  s.phase = "aiming";
  s.timerMs = SHOT_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    const inst: ArenaInstance = {
      roomId: room.id,
      players,
      state: {
        round: 0,
        rounds: ROUNDS,
        phase: "aiming",
        pucks: [],
        hazards: [],
        turn: 0,
        aimX: 0,
        aimY: 1,
        power: 0.5,
        timerMs: ROUND_MS,
        simMs: 0,
        scores: players.map(() => 0),
        roundWinner: null,
      } satisfies ArenaState,
    };
    resetRound(inst);
    return inst;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as ArenaInstance;
    const s = inst.state;
    if (s.phase !== "aiming") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1 || index !== s.turn) return;
    const raw = input as { pad?: { x?: unknown; y?: unknown }; slider?: { value?: unknown }; action?: unknown } | null;

    if (raw?.pad) {
      const x = Number(raw.pad.x ?? 0);
      const y = Number(raw.pad.y ?? 0);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > 0.15) {
        s.aimX = x;
        s.aimY = y;
      }
      return;
    }
    if (raw?.slider && typeof raw.slider.value === "number") {
      s.power = Math.max(0, Math.min(1, raw.slider.value));
      return;
    }
    if (raw?.action === "action") {
      const puck = s.pucks[index];
      if (!puck || !puck.alive) return;
      const impulse = impulseFor(s.aimX, s.aimY, s.power);
      puck.vx += impulse.vx;
      puck.vy += impulse.vy;
      s.simMs = 0;
      s.phase = "moving";
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as ArenaInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 100) / 1000;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);

    if (s.timerMs <= 0) { endRound(inst, nearestToCentre(inst)); return; }

    if (s.phase === "moving") {
      s.simMs += deltaMs;
      const friction = Math.pow(FRICTION_PER_SEC, dt);
      for (const puck of s.pucks) {
        if (!puck.alive) continue;
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;
        puck.vx *= friction;
        puck.vy *= friction;
        if (outOfBounds(puck)) { puck.alive = false; puck.vx = 0; puck.vy = 0; }
        for (const hazard of s.hazards) {
          if (Math.hypot(puck.x - hazard.x, puck.y - hazard.y) < PUCK_R + hazard.r) {
            puck.alive = false;
            puck.vx = 0;
            puck.vy = 0;
          }
        }
      }

      // Equal-mass elastic collisions.
      for (let i = 0; i < s.pucks.length; i++) {
        const a = s.pucks[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < s.pucks.length; j++) {
          const b = s.pucks[j];
          if (!b.alive) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist === 0 || dist >= PUCK_R * 2) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          const p = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (p <= 0) continue;
          a.vx -= p * nx;
          a.vy -= p * ny;
          b.vx += p * nx;
          b.vy += p * ny;
          const overlap = (PUCK_R * 2 - dist) / 2 + 0.001;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }

      const moving = s.pucks.some((p) => p.alive && Math.hypot(p.vx, p.vy) > STOP_SPEED);
      if (!moving || s.simMs > SIM_LIMIT_MS) {
        for (const puck of s.pucks) { puck.vx = 0; puck.vy = 0; }
        nextTurn(inst);
      }
    }
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as ArenaInstance;
    const s = inst.state;
    return {
      phase: s.phase,
      round: s.round + 1,
      rounds: s.rounds,
      pucks: inst.players.map((p, i) => ({
        name: p.name,
        x: s.pucks[i]?.x ?? 0,
        y: s.pucks[i]?.y ?? 0,
        alive: s.pucks[i]?.alive ?? false,
        isTurn: i === s.turn && s.phase === "aiming",
      })),
      hazards: s.hazards,
      roundWinner: s.roundWinner !== null ? inst.players[s.roundWinner]?.name : null,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? arenaLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as ArenaInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const yourTurn = s.phase === "aiming" && index === s.turn;
    const base = {
      round: s.round + 1,
      rounds: s.rounds,
      yourScore: s.scores[index],
      alive: s.pucks[index]?.alive ?? false,
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && arenaLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "finished") {
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Match over" };
    }
    if (!yourTurn) {
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: s.phase === "moving" ? "Pucks moving..." : `Waiting for ${inst.players[s.turn]?.name ?? ""}`,
      };
    }
    return {
      ...base,
      mode: "aim",
      controllerType: "aim",
      aim: {
        x: s.aimX,
        y: s.aimY,
        power: s.power,
        actionLabel: "FIRE",
        hint: `Round ${s.round + 1} of ${s.rounds}`,
        disabled: false,
      },
    };
  },
};

export default plugin;
