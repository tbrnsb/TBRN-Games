/**
 * Spin War - Server Logic
 * Tap to launch yourself outward from the arena center. Knock opponents
 * across the boundary; last spinner standing wins.
 */

import { secureRandom } from "../../shared/secure-random.ts";

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

interface Spinner {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  alive: boolean;
  score: number;
  color: string;
  kickedBy: number; // seat index of the last player who knocked this spinner, -1 = self
}

interface SpinWarState {
  spinners: Spinner[];
  phase: "playing" | "finished";
  arenaR: number;
  elapsedMs: number;
}

interface SpinWarInstance extends GameInstance {
  state: SpinWarState;
}

const ARENA_R = 0.4;
const SPINNER_R = 0.03;
const COLLISION_R = SPINNER_R * 2;
const TAP_IMPULSE = 0.14; // velocity kick away from center per tap
const MAX_SPEED = 0.9;
const DRAG_PER_SEC = 0.5; // velocity halves every second
const ATTRACT = 0.12; // pull back toward center (keeps idle players colliding)
const ELASTIC_BOOST = 1.6; // knockback multiplier on collision
const KNOCKOUT_SCORE = 50;
const COLORS = ["#ff6b6b", "#4ecdc4", "#ffe66d", "#95e1d3"];

const manifest: GameManifest = {
  id: "spinwar",
  name: "Spin War",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "one-button",
  description: "Tap to spin your blade. Hit opponents to knock them out. Last one spinning wins!",
};

function speedOf(s: Spinner): number {
  return Math.hypot(s.vx, s.vy);
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): SpinWarInstance {
    const spinners: Spinner[] = players.map((_, i) => {
      const angle = (i / players.length) * Math.PI * 2;
      const r = ARENA_R * 0.4;
      return {
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        angle: 0,
        alive: true,
        score: 0,
        color: COLORS[i % COLORS.length],
        kickedBy: -1,
      };
    });
    return {
      roomId: room.id,
      players,
      state: { spinners, phase: "playing", arenaR: ARENA_R, elapsedMs: 0 },
    };
  },

  onInput(instance: SpinWarInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "playing") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return;
    const s = state.spinners[playerIndex];
    if (!s.alive) return;

    const tap = input as { tap?: boolean } | null;
    if (!tap?.tap) return;

    // Kick away from the arena center (random direction if sitting on it).
    let dx: number;
    let dy: number;
    const d = Math.hypot(s.x, s.y);
    if (d < 0.001) {
      const a = secureRandom() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx = s.x / d;
      dy = s.y / d;
    }
    s.vx = Math.min(MAX_SPEED, s.vx + dx * TAP_IMPULSE);
    s.vy = Math.min(MAX_SPEED, s.vy + dy * TAP_IMPULSE);
    // Clamp overall speed
    const sp = speedOf(s);
    if (sp > MAX_SPEED) {
      s.vx = (s.vx / sp) * MAX_SPEED;
      s.vy = (s.vy / sp) * MAX_SPEED;
    }
    s.kickedBy = -1;
  },

  onTick(instance: SpinWarInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase !== "playing") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000) / 1000;
    state.elapsedMs += deltaMs;

    const drag = Math.pow(DRAG_PER_SEC, dt);

    for (const s of state.spinners) {
      if (!s.alive) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= drag;
      s.vy *= drag;

      // Pull idle spinners toward the center so collisions keep happening.
      const d = Math.hypot(s.x, s.y);
      if (d > 0.001) {
        s.vx -= (s.x / d) * ATTRACT * dt;
        s.vy -= (s.y / d) * ATTRACT * dt;
      }

      s.angle = (s.angle + speedOf(s) * dt * 25) % (Math.PI * 2);

      // Out of the arena: eliminated.
      if (d > state.arenaR) {
        s.alive = false;
        s.vx = 0;
        s.vy = 0;
        if (s.kickedBy >= 0 && state.spinners[s.kickedBy]?.alive) {
          state.spinners[s.kickedBy].score += KNOCKOUT_SCORE;
        }
      }
    }

    // Collisions: separate + exchange normal velocity (with a knockout boost).
    for (let i = 0; i < state.spinners.length; i++) {
      const a = state.spinners[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < state.spinners.length; j++) {
        const b = state.spinners[j];
        if (!b.alive) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= COLLISION_R) continue;
        if (d < 0.0001) {
          dx = 0.0001;
          dy = 0;
          d = 0.0001;
        }
        const nx = dx / d;
        const ny = dy / d;
        const overlap = COLLISION_R - d;

        // Separate.
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        // Relative velocity along the normal.
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const impulse = -rel * ELASTIC_BOOST;
          a.vx -= nx * impulse * 0.5;
          a.vy -= ny * impulse * 0.5;
          b.vx += nx * impulse * 0.5;
          b.vy += ny * impulse * 0.5;
          // Each names the other as the last player who knocked them.
          a.kickedBy = j;
          b.kickedBy = i;
        }
      }
    }

    const alive = state.spinners.filter((s) => s.alive);
    if (alive.length <= 1) {
      state.phase = "finished";
      if (alive.length === 1) alive[0].score += 100; // survival bonus
    }
  },

  screenState(instance: SpinWarInstance): unknown {
    const state = instance.state;
    return {
      spinners: state.spinners.map((s, i) => ({
        name: instance.players[i].name,
        x: s.x,
        y: s.y,
        angle: s.angle,
        speed: speedOf(s),
        alive: s.alive,
        color: s.color,
      })),
      arenaR: state.arenaR,
      phase: state.phase,
      scores: instance.players.map((p, i) => ({
        name: p.name,
        score: state.spinners[i].score,
        alive: state.spinners[i].alive,
      })),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: SpinWarInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const s = state.spinners[playerIndex];
    return {
      x: s.x,
      y: s.y,
      angle: s.angle,
      speed: speedOf(s),
      alive: s.alive,
      color: s.color,
      arenaR: state.arenaR,
      yourScore: s.score,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false,
    };
  },
};

function getWinner(instance: SpinWarInstance): { name: string; score: number } | null {
  const state = instance.state;
  // Last spinner standing is the winner — score is ranking only. Picking the
  // highest score here would hand the match to an eliminated player who
  // racked up knockouts (3 x 50 > the 100 survival bonus).
  const alive = state.spinners
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.alive);
  if (state.phase === "finished" && alive.length === 1) {
    const winner = alive[0];
    return { name: instance.players[winner.i].name, score: winner.s.score };
  }
  let best = -1;
  let idx = -1;
  state.spinners.forEach((s, i) => {
    if (s.score > best) {
      best = s.score;
      idx = i;
    }
  });
  if (idx >= 0) return { name: instance.players[idx].name, score: best };
  return null;
}

export default plugin;
