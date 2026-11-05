/**
 * Shared message types and constants for TBRN-Games - TypeScript types only.
 * Used for type checking. Runtime values are in constants.js.
 */

import type { DropoutPolicy, GameKind, GameScale, ScaleMode } from "./game-catalog.ts";
import type { GameResult } from "./scoring.ts";
import type { ReactionId } from "./reactions.ts";
import type { SeatIdentity } from "./seat-identity.ts";

// --- Base message envelope ---
export interface BaseMessage {
  type: string;
  roomId: string;
  playerId?: string;
  timestamp: number;
}

// --- Client -> Server messages ---
export interface JoinMessage extends BaseMessage {
  type: "join";
  payload: { name: string; rejoinToken?: string; role?: "screen" | "player" };
}

export interface InputMessage extends BaseMessage {
  type: "input";
  payload: unknown;
}

export interface PingMessage extends BaseMessage {
  type: "ping";
}

export interface SessionVoteMessage extends BaseMessage {
  type: "session-vote";
  payload: { gameId: string };
}

export interface LeaveMessage extends BaseMessage {
  type: "leave";
}

export interface ReactionMessage extends BaseMessage {
  type: "reaction";
  payload: { id: string };
}

export type ClientMessage =
  | JoinMessage
  | InputMessage
  | PingMessage
  | SessionVoteMessage
  | LeaveMessage
  | ReactionMessage;

// --- Server -> Client messages ---
export interface JoinedMessage extends BaseMessage {
  type: "joined";
  payload: { playerId: string; rejoinToken: string; roomState: RoomStateAny; hostToken?: string };
}

export interface RoomStateMessage extends BaseMessage {
  type: "roomState";
  payload: RoomStateAny;
}

export interface GameStateMessage extends BaseMessage {
  type: "gameState";
  payload: {
    screen: unknown;
    controller: unknown;
    gameId?: string | null;
    gameName?: string;
    howTo?: string;
  };
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  payload: { code: string; message: string };
}

export interface PongMessage extends BaseMessage {
  type: "pong";
}

/** Broadcast when a phone sends an audience reaction; reaches TV and phones. */
export interface ReactionBroadcastMessage extends BaseMessage {
  type: "reaction";
  payload: {
    playerId: string;
    name: string;
    /** Seat identity so the TV can colour the float; null for a legacy seat. */
    seat: SeatIdentity | null;
    id: ReactionId;
    emoji: string;
  };
}

// --- Royal Rumble session ---
export interface SessionGameView {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface SessionStanding {
  playerId: string;
  name: string;
  points: number;
  wins: number;
  podiums: number;
  lastPlaces: number;
  bestSingle: number;
}

export interface SessionTrophyView {
  id: string;
  name: string;
  playerName: string;
  detail: string;
}

export interface SessionAwardView {
  id: string;
  name: string;
  playerId: string;
  playerName: string;
  detail: string;
}

export interface SessionView {
  length: number;
  selection: "vote" | "random";
  status: "voting" | "playing" | "finished";
  round: number;
  played: string[];
  currentGameId: string | null;
  leadingGameId: string | null;
  candidates: SessionGameView[];
  votes: Array<{ gameId: string; name: string; count: number }>;
  voted: number;
  standings: SessionStanding[];
  champion: { name: string; points: number } | null;
  trophies: SessionTrophyView[];
  /** Aggregated per-player stat totals that feed the finale awards. */
  awardStats: Record<string, Record<string, number>>;
  /** Awards computed when the session finishes; empty before the finale. */
  awards: SessionAwardView[];
}

export interface SessionMessage extends BaseMessage {
  type: "session";
  payload: {
    session: SessionView | null;
    yourVote: string | null;
    canVote: boolean;
    yourPoints: number;
  };
}

export type ServerMessage =
  | JoinedMessage
  | RoomStateMessage
  | GameStateMessage
  | ErrorMessage
  | PongMessage
  | SessionMessage
  | ReactionBroadcastMessage;

// --- Room & Player ---
/**
 * Presence is the authoritative table status. `connected` is kept for
 * compatibility with older clients and games; `presence` is what the TV and
 * phones render.
 *
 * - `active`: holding a live seat.
 * - `away`: socket closed, inside the rejoin grace window.
 * - `left`: explicitly left; keeps the room row and score for this game.
 */
export type PlayerPresence = "active" | "away" | "left";

/**
 * Why a running game is paused. Only "players" exists today: connected
 * non-spectator players fell below the running game's minimum.
 */
export type PauseReason = "players";

/**
 * A below-minimum pause, on the server clock. `until` is the point where the
 * host is offered Wait / End game; the game stays paused after it passes.
 */
export interface RoomPause {
  reason: PauseReason;
  startedAt: number;
  until: number;
}

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  presence: PlayerPresence;
  /** True for a phone that joined mid-game: sees the TV, sends no game input. */
  spectator?: boolean;
  controllerType?: string;
  /** Stable seat identity, assigned on join and kept for the room's lifetime. */
  seat?: SeatIdentity;
}

// Type-safe room state with generic game state
export interface RoomState<TGameState extends object = object> {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: TGameState | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
  /** Set while a running game waits for players to come back. */
  pause: RoomPause | null;
}

// Non-generic alias for backward compatibility
export type RoomStateAny = RoomState<any>;

// --- Game Plugin Interface ---
export interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
  // Platform metadata, merged from shared/game-catalog.ts at load time.
  // Optional so a manifest.json without them still loads.
  displayName?: string;
  enabled?: boolean;
  kind?: GameKind;
  idealMin?: number;
  idealMax?: number;
  minutes?: { standalone: number; rumble: number };
  dropoutPolicy?: DropoutPolicy;
  contentPacks?: string[];
  scale?: (playerCount: number, mode: ScaleMode) => GameScale;
}

export type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand";

// Generic plugin interface for type-safe game implementations
export interface GamePlugin<
  TState extends object = object,
  TInput = unknown,
  TScreenState = unknown,
  TControllerState = unknown
> {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance<TState>;
  onInput(instance: GameInstance<TState>, playerId: string, input: TInput): void;
  onTick(instance: GameInstance<TState>, deltaMs: number): void;
  screenState(instance: GameInstance<TState>): TScreenState;
  controllerState(instance: GameInstance<TState>, playerId: string): TControllerState;
  /**
   * Optional host-token control (skip, hide) for the running game. Returns true
   * when the action was understood. Host authentication happens in the server;
   * a game never sees an unauthenticated action.
   */
  onHostAction?(instance: GameInstance<TState>, action: string): boolean;
  /**
   * Optional per-game standings and stats. Games that do not implement it fall
   * back to the platform's screen-state extraction.
   */
  results?(instance: GameInstance<TState>): GameResult;
}

export interface GameInstance<TState extends object = object> {
  roomId: string;
  players: Player[];
  state: TState;
}