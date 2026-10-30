/**
 * Shared message types and constants for TBRN-Games - Runtime version.
 * This file contains only runtime values. Types are in types.ts for TypeScript checking.
 */

// --- Constants ---
export const MESSAGE_TYPES = {
  JOIN: "join",
  INPUT: "input",
  PING: "ping",
  JOINED: "joined",
  ROOM_STATE: "roomState",
  GAME_STATE: "gameState",
  ERROR: "error",
  PONG: "pong",
};

export const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
export const REJOIN_TOKEN_BYTES = 16;
export const PING_INTERVAL_MS = 15000;
export const PLAYER_TIMEOUT_MS = 30000;

// --- LAN Utilities ---
export async function getLanUrls(port) {
  const os = await import("node:os");
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        urls.push(`http://${addr.address}:${port}`);
      }
    }
  }
  return urls;
}