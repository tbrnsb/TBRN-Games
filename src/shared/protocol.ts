export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 20;
/** How long a disconnected seat is held before it can be reused. */
export const SEAT_TTL_MS = 300_000;
/** How long players have to cast a private game-selection ballot. */
export const SELECTION_WINDOW_MS = 30_000;

export type ErrorCode =
  | "invalid_name"
  | "room_full"
  | "invalid_token"
  | "seat_replaced"
  | "already_joined"
  | "invalid_message"
  | "not_joined"
  | "not_host"
  | "game_in_progress"
  | "selection_in_progress"
  | "not_enough_players"
  | "too_many_players"
  | "unknown_game"
  | "not_eligible"
  | "already_voted"
  | "wrong_phase"
  | "not_in_game"
  | "invalid_action"
  | "game_over";

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface PublicGameSummary {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface PublicSelectionState {
  phase: "voting";
  deadline: number;
  games: PublicGameSummary[];
  ballotsCast: number;
  voterCount: number;
}

export interface RoomLobbyState {
  phase: "lobby";
  maxPlayers: number;
  hostId: string | null;
  players: PublicPlayer[];
}

export interface PublicLobbyState extends RoomLobbyState {
  games: PublicGameSummary[];
  selection: PublicSelectionState | null;
  notice: string | null;
}

export interface ControllerSelectionState {
  phase: "voting";
  deadline: number;
  games: PublicGameSummary[];
  myBallot: string | null;
}

export interface LobbyControllerState {
  phase: "lobby";
  playerId: string;
  name: string;
  isHost: boolean;
  canStart: boolean;
  selection: ControllerSelectionState | null;
}

export interface GameControllerState {
  phase: "game";
  playerId: string;
  name: string;
  isHost: boolean;
  gameId: string;
  view: unknown;
}

export interface SpectatorControllerState {
  phase: "spectating";
  playerId: string;
  name: string;
  isHost: boolean;
  gameId: string;
}

export type PrivateControllerState =
  | LobbyControllerState
  | GameControllerState
  | SpectatorControllerState;

export interface GameScreenState {
  phase: "game";
  gameId: string;
  hostId: string | null;
  view: unknown;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "resume"; token: string }
  | { type: "leave_room" }
  | { type: "start_game"; gameId: string }
  | { type: "select_random" }
  | { type: "start_game_vote" }
  | { type: "cast_ballot"; gameId: string }
  | { type: "game_action"; action: unknown }
  | { type: "host_action"; action: unknown }
  | { type: "return_to_lobby" };

export type ServerMessage =
  | { type: "lobby"; state: PublicLobbyState }
  | { type: "joined"; playerId: string; token: string }
  | { type: "left" }
  | { type: "time"; now: number }
  | { type: "controller"; state: PrivateControllerState }
  | { type: "screen"; state: GameScreenState }
  | { type: "error"; code: ErrorCode; message: string };
