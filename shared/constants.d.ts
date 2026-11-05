/**
 * Type declarations for constants.js.
 * Keeps MESSAGE_TYPES values as string literals so ServerMessage and
 * ClientMessage discriminated unions narrow correctly under TypeScript.
 * Runtime values stay in constants.js (plain JavaScript, no build step).
 */
export declare const MESSAGE_TYPES: {
  readonly JOIN: "join";
  readonly LEAVE: "leave";
  readonly INPUT: "input";
  readonly PING: "ping";
  readonly JOINED: "joined";
  readonly ROOM_STATE: "roomState";
  readonly GAME_STATE: "gameState";
  readonly SESSION: "session";
  readonly SESSION_VOTE: "session-vote";
  readonly REACTION: "reaction";
  readonly ERROR: "error";
  readonly PONG: "pong";
};

export declare const ROOM_CODE_CHARS: string;
export declare const ROOM_CODE_LENGTH: number;
export declare const REJOIN_TOKEN_BYTES: number;
export declare const PING_INTERVAL_MS: number;
export declare const PLAYER_TIMEOUT_MS: number;

export declare function getLanUrls(port: number, scheme?: string): Promise<string[]>;
