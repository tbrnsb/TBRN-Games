/**
 * Shared message types and constants for TBRN-Games - Runtime version.
 * This file contains only runtime values. Types are in types.ts for TypeScript checking.
 */

// --- Constants ---
export const MESSAGE_TYPES = {
  JOIN: "join",
  LEAVE: "leave",
  INPUT: "input",
  PING: "ping",
  JOINED: "joined",
  ROOM_STATE: "roomState",
  GAME_STATE: "gameState",
  SESSION: "session",
  SESSION_VOTE: "session-vote",
  REACTION: "reaction",
  ERROR: "error",
  PONG: "pong",
};

export const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
export const REJOIN_TOKEN_BYTES = 16;
export const PING_INTERVAL_MS = 10000;
// How long a disconnected seat stays reserved before it is reaped. Overridable
// so tests can exercise the reap path without waiting half a minute.
// This module is also served to browsers, where `process` does not exist.
const envPlayerTimeout =
  typeof process !== "undefined" && process.env
    ? Number(process.env.PLAYER_TIMEOUT_MS)
    : NaN;
export const PLAYER_TIMEOUT_MS = Number.isFinite(envPlayerTimeout) ? envPlayerTimeout : 30000;

// --- LAN Utilities ---
export async function getLanUrls(port, scheme = "http") {
  const os = await import("node:os");
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        urls.push(`${scheme}://${addr.address}:${port}`);
      }
    }
  }
  return urls;
}