export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 20;
export const SEAT_TTL_MS = 120_000;

export type ErrorCode =
  | "invalid_name"
  | "room_full"
  | "invalid_token"
  | "seat_connected"
  | "already_joined"
  | "invalid_message";

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface PublicLobbyState {
  phase: "lobby";
  maxPlayers: number;
  players: PublicPlayer[];
}

export interface PrivateControllerState {
  playerId: string;
  name: string;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "resume"; token: string };

export type ServerMessage =
  | { type: "lobby"; state: PublicLobbyState }
  | { type: "joined"; playerId: string; token: string }
  | { type: "controller"; state: PrivateControllerState }
  | { type: "error"; code: ErrorCode; message: string };
