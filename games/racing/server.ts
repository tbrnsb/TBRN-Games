/**
 * Racing - Server Logic
 * Pure mash race: every tap shoves your racer forward. First across the line wins.
 *
 * Range is 1-8. Every seat gets its own lane and keeps its seat identity
 * (colour + glyph) on the TV: the race is simultaneous, so nobody is ever
 * "waited on" and there is no turn order to rotate.
 */

import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores } from "../../shared/scoring.ts";
import type { GameResult } from "../../shared/scoring.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";
import type { SeatIdentity } from "../../shared/seat-identity.ts";

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
  seat?: SeatIdentity;
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
  results?(instance: GameInstance): GameResult;
}

// --- Types ---
interface RacerState {
  lane: number;
  distance: number;
  speed: number;
  taps: number;
  /** Peak speed reached, kept for the awards stats. */
  topSpeed: number;
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
  maxPlayers: 8,
  controllerType: "tap-race",
  description: "Mash the button. Every tap shoves your racer forward and speed bleeds off fast. First across the line wins.",
};

/** Progress in 0..1 for a racer (0 when the seat is missing). */
function progressOf(racer: RacerState | undefined): number {
  if (!racer || !Number.isFinite(racer.distance)) return 0;
  return Math.min(1, Math.max(0, racer.distance / FINISH_DISTANCE));
}

/** Seat identity for a player index, falling back to the index for old players. */
function seatAt(instance: RacingInstance, index: number): SeatIdentity {
  return instance.players[index]?.seat ?? seatForIndex(index);
}

/**
 * The TV is never waiting on anyone during a race: every phone can tap at the
 * same time, and the countdown and buzzer are server-driven.
 */
function waitingNames(): string[] {
  return [];
}

/** Public finish line for the winning racer, never a hidden value. */
function finishCaption(instance: RacingInstance): string | null {
  const state = instance.state;
  if (state.phase !== "finished" || state.winnerIndex === null) return null;
  const winner = instance.players[state.winnerIndex];
  const racer = state.racers[state.winnerIndex];
  if (!winner) return null;
  return captionFor({ kind: "fastest", name: winner.name, seed: winner.name.length + (racer?.taps ?? 0) });
}

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
        racers: players.map((_, i) => ({ lane: i, distance: 0, speed: 0, taps: 0, topSpeed: 0, finished: false })),
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
    if (racer.speed > racer.topSpeed) racer.topSpeed = racer.speed;
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
    const seats = instance.players.map((_, i) => seatAt(instance, i));
    return {
      phase: state.phase,
      countdown: state.phase === "countdown" ? Math.max(1, Math.ceil(state.countdownMs / 1000)) : null,
      lanes: instance.players.length,
      racers: instance.players.map((p, i) => ({
        name: p.name,
        lane: state.racers[i].lane,
        progress: progressOf(state.racers[i]),
        taps: state.racers[i].taps,
        speed: state.racers[i].speed,
        topSpeed: state.racers[i].topSpeed,
        finished: state.racers[i].finished,
        seat: seats[i],
      })),
      obstacles: [],
      finishDistance: FINISH_DISTANCE,
      elapsedMs: state.elapsedMs,
      finished: state.phase === "finished",
      waitingOn: waitingNames(),
      caption: finishCaption(instance),
      sound: state.phase === "finished" ? "win" : null,
      winner:
        state.phase === "finished" && state.winnerIndex !== null
          ? {
              name: instance.players[state.winnerIndex].name,
              progress: progressOf(state.racers[state.winnerIndex]),
            }
          : null,
    };
  },

  controllerState(instance: RacingInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const racer = state.racers[playerIndex];
    if (!racer) return { race: { disabled: true, label: "TAP!" } };

    // Show the nearest rival by race progress so the phone has someone to beat.
    let rivalIndex = -1;
    let rivalGap = Number.POSITIVE_INFINITY;
    state.racers.forEach((r, i) => {
      if (i === playerIndex) return;
      const gap = Math.abs(r.distance - racer.distance);
      if (gap < rivalGap) {
        rivalGap = gap;
        rivalIndex = i;
      }
    });

    return {
      race: {
        taps: racer.taps,
        progress: progressOf(racer),
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

  results(instance: RacingInstance): GameResult {
    const state = instance.state;
    const stats: Record<string, number> = {};
    instance.players.forEach((player, index) => {
      const racer = state.racers[index];
      stats[playerStatKey(player.id, "taps")] = racer?.taps ?? 0;
      stats[playerStatKey(player.id, "topSpeed")] = racer?.topSpeed ?? 0;
    });
    return {
      standings: standingsFromScores(
        instance.players.map((player, index) => ({
          id: player.id,
          // Rank-only game: raw is the same 0..1 progress the TV shows, so a
          // 3-4 player result matches what the screen fallback used to report.
          raw: progressOf(state.racers[index]),
        })),
      ),
      stats,
    };
  },
};

export default plugin;
