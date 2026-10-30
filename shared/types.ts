/**
 * Shared message types and constants for TBRN-Games - TypeScript types only.
 * Used for type checking. Runtime values are in constants.js.
 */

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
  payload: { name: string; rejoinToken?: string };
}

export interface InputMessage extends BaseMessage {
  type: "input";
  payload: unknown;
}

export interface PingMessage extends BaseMessage {
  type: "ping";
}

export type ClientMessage = JoinMessage | InputMessage | PingMessage;

// --- Server -> Client messages ---
export interface JoinedMessage extends BaseMessage {
  type: "joined";
  payload: { playerId: string; rejoinToken: string; roomState: RoomState };
}

export interface RoomStateMessage extends BaseMessage {
  type: "roomState";
  payload: RoomState;
}

export interface GameStateMessage extends BaseMessage {
  type: "gameState";
  payload: { screen: unknown; controller: unknown };
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  payload: { code: string; message: string };
}

export interface PongMessage extends BaseMessage {
  type: "pong";
}

export type ServerMessage = JoinedMessage | RoomStateMessage | GameStateMessage | ErrorMessage | PongMessage;

// --- Room & Player ---
export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
}

export interface RoomState {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

// --- Game Plugin Interface ---
export interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
}

export type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand";

export interface GamePlugin {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}

export interface GameInstance {
  roomId: string;
  players: Player[];
  state: unknown;
}