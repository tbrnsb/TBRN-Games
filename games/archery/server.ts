/**
 * Archery Game - Server Logic
 * Hold to draw, release to shoot. Moving target.
 *
 * Turn-based at every player count: one archer fires at a time, in seat order,
 * so 3- and 4-player games keep the original flow. Seats 5-8 share the same
 * target, and the TV colours every arrow with its owner's seat identity.
 */

import { captionFor } from "../../shared/interlude.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores } from "../../shared/scoring.ts";
import type { GameResult } from "../../shared/scoring.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";
import type { SeatIdentity } from "../../shared/seat-identity.ts";

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

interface Player { id: string; name: string; joinedAt: number; rejoinToken: string; connected: boolean; controllerType?: string; seat?: SeatIdentity; }
interface RoomState { id: string; code: string; hostPlayerId: string | null; players: Player[]; gameId: string | null; gameState: unknown | null; createdAt: number; status: "lobby" | "playing" | "finished"; }
interface GameInstance { roomId: string; players: Player[]; state: unknown; }
interface GamePlugin { manifest: GameManifest; onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance; onInput(instance: GameInstance, playerId: string, input: unknown): void; onTick(instance: GameInstance, deltaMs: number): void; screenState(instance: GameInstance): unknown; controllerState(instance: GameInstance, playerId: string): unknown; results?(instance: GameInstance): GameResult; }

interface ArcheryState {
  currentPlayer: number;
  phase: "aiming" | "flying" | "scoring" | "finished";
  targetX: number;      // -1 to 1
  targetSpeed: number;
  targetDirection: 1 | -1;
  shots: Shot[];
  scores: number[];
  round: number;
  maxRounds: number;
  drawPower: number;    // 0-1
  isDrawing: boolean;
  arrowX: number;
  arrowY: number;
  arrowVX: number;
  arrowVY: number;
  scoringTimerMs: number;
}

interface Shot { playerIndex: number; x: number; y: number; score: number; round: number; targetX: number; }

interface ArcheryInstance extends GameInstance { state: ArcheryState; }

export const TARGET_WIDTH = 0.15;
const TARGET_SPEED = 0.3;
const MAX_POWER = 1.0;
const DRAW_RATE = 0.5; // power per second while drawing
const GRAVITY = 1.2;
const ARROW_SPEED = 1.6;
const ROUNDS = 5;


const manifest: GameManifest = {
  id: "archery",
  name: "Archery",
  minPlayers: 1,
  maxPlayers: 8,
  controllerType: "one-button",
  description: "Hold to draw bow, release to shoot. Moving target. Closest to center wins."
};

/** Proximity score for one arrow: 100 at the centre, 0 outside the target. */
export function archeryScore(hitX: number, targetX: number, targetWidth = TARGET_WIDTH): number {
  const distance = Math.abs(hitX - targetX);
  if (distance >= targetWidth / 2) return 0;
  return Math.round((1 - distance / (targetWidth / 2)) * 100);
}

/** Seat identity for a player index, falling back to the index for old players. */
function seatAt(instance: ArcheryInstance, index: number): SeatIdentity {
  return instance.players[index]?.seat ?? seatForIndex(index);
}

/** The active player, or nobody once the game is finished. */
function waitingNames(instance: ArcheryInstance): string[] {
  const state = instance.state;
  if (state.phase === "finished") return [];
  const name = instance.players[state.currentPlayer]?.name;
  return name ? [name] : [];
}

/** Public reveal line for the arrow that just landed, never a hidden value. */
function revealCaption(instance: ArcheryInstance): string | null {
  const state = instance.state;
  if (state.phase !== "scoring") return null;
  const shot = state.shots[state.shots.length - 1];
  if (!shot) return captionFor({ kind: "reveal", seed: state.round });
  const name = instance.players[shot.playerIndex]?.name;
  if (name && shot.score >= 100) {
    return captionFor({ kind: "perfect", name, seed: shot.round });
  }
  return captionFor({ kind: "reveal", seed: shot.round + shot.playerIndex });
}

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): ArcheryInstance {
    return {
      roomId: room.id,
      players,
      state: {
        currentPlayer: 0,
        phase: "aiming",
        targetX: 0,
        targetSpeed: TARGET_SPEED,
        targetDirection: 1,
        shots: [],
        scores: players.map(() => 0),
        round: 0,
        // A Rumble passes three shot rounds; standalone keeps five.
        maxRounds: roundsOption(options) ?? ROUNDS,
        drawPower: 0,
        isDrawing: false,
        arrowX: 0,
        arrowY: 0,
        arrowVX: 0,
        arrowVY: 0,
        scoringTimerMs: 0
      }
    };
  },

  onInput(instance: ArcheryInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase === "finished") return;

    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    if (playerIndex !== state.currentPlayer) return;

    const gone = (input as { tap?: unknown } | null)?.tap === true;
    if (state.phase === "aiming" && gone) {
      if (!state.isDrawing) {
        // First tap: start drawing; power builds in onTick.
        state.isDrawing = true;
        state.drawPower = 0;
      } else if (state.drawPower >= 0.15) {
        // Second tap: release and shoot.
        state.isDrawing = false;
        state.phase = "flying";
        const angle = Math.PI / 4; // 45 degrees
        const speed = ARROW_SPEED * state.drawPower;
        state.arrowX = -1;
        state.arrowY = 0;
        state.arrowVX = speed * Math.cos(angle);
        state.arrowVY = speed * Math.sin(angle);
        state.drawPower = 0;
      } else {
        // Tapped too early: cancel the draw instead of lobbing a dud.
        state.isDrawing = false;
        state.drawPower = 0;
      }
    }
  },

  onTick(instance: ArcheryInstance, deltaMs: number): void {
    const state = instance.state;
    const dt = deltaMs / 1000;

    // Draw power builds while the archer is drawing the bow.
    if (state.phase === "aiming" && state.isDrawing) {
      state.drawPower = Math.min(MAX_POWER, state.drawPower + DRAW_RATE * dt);
    }

    // Move target
    if (state.phase === "aiming" || state.phase === "flying") {
      state.targetX += state.targetDirection * state.targetSpeed * dt;
      if (state.targetX >= 1 - TARGET_WIDTH/2) { state.targetX = 1 - TARGET_WIDTH/2; state.targetDirection = -1; }
      if (state.targetX <= -1 + TARGET_WIDTH/2) { state.targetX = -1 + TARGET_WIDTH/2; state.targetDirection = 1; }
    }

    // Arrow physics
    if (state.phase === "flying") {
      state.arrowX += state.arrowVX * dt;
      state.arrowY += state.arrowVY * dt;
      state.arrowVY -= GRAVITY * dt;

      // Check hit on descent
      if (state.arrowY <= 0 && state.arrowVY <= 0) {
        const hitX = state.arrowX;
        const score = archeryScore(hitX, state.targetX);
        state.shots.push({ playerIndex: state.currentPlayer, x: hitX, y: 0, score, round: state.round, targetX: state.targetX });
        state.scores[state.currentPlayer] += score;
        state.phase = "scoring";
        state.scoringTimerMs = 1500;
        return;
      }

      // Out of bounds
      if (state.arrowX > 1.5 || state.arrowY < -1) {
        state.phase = "scoring";
        state.scoringTimerMs = 1500;
        state.shots.push({ playerIndex: state.currentPlayer, x: state.arrowX, y: state.arrowY, score: 0, round: state.round, targetX: state.targetX });
      }
    }

    // Scoring pause, then advance to the next throw or round.
    if (state.phase === "scoring") {
      state.scoringTimerMs -= deltaMs;
      if (state.scoringTimerMs <= 0) advanceTurn(state, instance.players.length);
    }
  },

  screenState(instance: ArcheryInstance): unknown {
    const state = instance.state;
    const seats = instance.players.map((_, index) => seatAt(instance, index));
    return {
      phase: state.phase,
      targetX: state.targetX,
      targetWidth: TARGET_WIDTH,
      drawPower: state.drawPower,
      isDrawing: state.isDrawing,
      arrow: state.phase === "flying" ? { x: state.arrowX, y: state.arrowY } : null,
      currentPlayer: state.currentPlayer,
      currentPlayerName: instance.players[state.currentPlayer]?.name ?? null,
      round: state.round + 1,
      maxRounds: state.maxRounds,
      scores: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i], seat: seats[i] })),
      // Every arrow stays on the shared target; the renderer colours each by
      // the owner's seat and never drops older shots behind a fixed cap.
      shots: state.shots.map((shot) => ({ ...shot, seat: seats[shot.playerIndex] ?? seatForIndex(shot.playerIndex) })),
      turnOrder: instance.players.map((p, i) => ({
        name: p.name,
        seat: seats[i],
        isCurrent: i === state.currentPlayer && state.phase !== "finished",
      })),
      waitingOn: waitingNames(instance),
      caption: revealCaption(instance),
      sound: state.phase === "scoring" ? "reveal" : null,
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null
    };
  },

  controllerState(instance: ArcheryInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex(p => p.id === playerId);
    const isCurrent = playerIndex === state.currentPlayer && state.phase !== "finished";

    return {
      phase: state.phase,
      isYourTurn: isCurrent,
      drawPower: isCurrent ? state.drawPower : 0,
      targetX: state.targetX,
      targetWidth: TARGET_WIDTH,
      yourScore: state.scores[playerIndex],
      round: state.round + 1,
      maxRounds: state.maxRounds,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false
    };
  },

  results(instance: ArcheryInstance): GameResult {
    const state = instance.state;
    const bullseyes = instance.players.map(() => 0);
    for (const shot of state.shots) {
      if (shot.score >= 100 && bullseyes[shot.playerIndex] !== undefined) bullseyes[shot.playerIndex] += 1;
    }
    const stats: Record<string, number> = {};
    instance.players.forEach((player, index) => {
      stats[playerStatKey(player.id, "bullseyes")] = bullseyes[index];
      stats[playerStatKey(player.id, "totalScore")] = state.scores[index];
    });
    return {
      standings: standingsFromScores(
        instance.players.map((player, index) => ({ id: player.id, raw: state.scores[index] })),
      ),
      stats,
    };
  }
};

function advanceTurn(state: ArcheryState, playerCount: number): void {
  state.currentPlayer++;
  if (state.currentPlayer >= playerCount) {
    state.currentPlayer = 0;
    state.round++;
    if (state.round >= state.maxRounds) {
      state.phase = "finished";
      return;
    }
  }
  state.phase = "aiming";
  state.drawPower = 0;
  state.isDrawing = false;
}

function getWinner(instance: ArcheryInstance): { name: string; score: number } | null {
  const state = instance.state;
  let bestScore = -1, bestIndex = -1;
  state.scores.forEach((score, i) => { if (score > bestScore) { bestScore = score; bestIndex = i; } });
  if (bestIndex >= 0) return { name: instance.players[bestIndex].name, score: bestScore };
  return null;
}

export default plugin;