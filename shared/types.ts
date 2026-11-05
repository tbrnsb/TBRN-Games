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

export type ClientMessage = JoinMessage | InputMessage | PingMessage | SessionVoteMessage;

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
  | SessionMessage;

// --- Room & Player ---
export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
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
}

export interface GameInstance<TState extends object = object> {
  roomId: string;
  players: Player[];
  state: TState;
}