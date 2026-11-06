/**
 * Best-effort on-disk copy of a Royal Rumble.
 *
 * The authoritative session lives in memory. This module writes a JSON-safe
 * snapshot after every game start, game end, skip and early end so a refreshed
 * laptop has something to resume from, and reads it when a room with the same
 * code is created again. IO errors are logged and ignored; persistence must
 * never take a party down.
 *
 * The snapshot deliberately contains no rejoin tokens, host tokens or player
 * credentials: only the room code, preset id and `sessionSummary()` data.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUMBLE_PRESETS, type RumblePreset } from "../shared/rumble-presets.ts";
import { restoreSession, sessionSummary, type SessionState, type SessionSummary } from "./session.ts";

export interface RumbleFile {
  code: string;
  presetId: string;
  presetName: string;
  savedAt: number;
  summary: SessionSummary;
}

export interface LoadedRumble {
  preset: RumblePreset;
  presetName: string;
  summary: SessionSummary;
}

/** `TBRN_RUMBLE_DIR` lets tests (and desktop packaging) relocate the folder. */
export function rumbleDirectory(): string {
  const override = process.env.TBRN_RUMBLE_DIR;
  return override && override.trim().length > 0 ? override : join(process.cwd(), "data", "rumble");
}

function fileFor(code: string): string {
  return join(rumbleDirectory(), `${code}.json`);
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<SessionSummary>;
  return (
    typeof summary.presetId === "string" &&
    typeof summary.presetName === "string" &&
    typeof summary.slotIndex === "number" &&
    Array.isArray(summary.slots) &&
    Array.isArray(summary.swaps) &&
    Array.isArray(summary.played) &&
    Array.isArray(summary.rounds) &&
    !!summary.stats &&
    typeof summary.stats === "object" &&
    !!summary.accuracy &&
    typeof summary.accuracy === "object" &&
    !!summary.awardStats &&
    typeof summary.awardStats === "object" &&
    Array.isArray(summary.trophies) &&
    Array.isArray(summary.awards) &&
    typeof summary.lastGameDouble === "boolean" &&
    Array.isArray(summary.enabledGames) &&
    typeof summary.length === "number"
  );
}

/** Write the current session snapshot. Never throws. */
export function saveRumble(roomCode: string, session: SessionState): void {
  const file: RumbleFile = {
    code: roomCode,
    presetId: session.presetId,
    presetName: session.presetName,
    savedAt: Date.now(),
    summary: sessionSummary(session),
  };
  try {
    mkdirSync(rumbleDirectory(), { recursive: true });
    writeFileSync(fileFor(roomCode), JSON.stringify(file), "utf8");
  } catch (error) {
    console.error(`[RumbleStore] Could not save room ${roomCode}:`, error);
  }
}

/** Read a saved snapshot for a room code, or null when absent/unreadable. */
export function loadRumble(roomCode: string): LoadedRumble | null {
  let raw: string;
  try {
    raw = readFileSync(fileFor(roomCode), "utf8");
  } catch {
    return null; // No file is the normal case.
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RumbleFile>;
    if (parsed.code !== roomCode || !isSessionSummary(parsed.summary)) return null;
    const preset = RUMBLE_PRESETS.find((entry) => entry.id === parsed.summary?.presetId);
    if (!preset) return null;
    return {
      preset,
      presetName: typeof parsed.presetName === "string" ? parsed.presetName : preset.name,
      summary: parsed.summary,
    };
  } catch (error) {
    console.error(`[RumbleStore] Could not read room ${roomCode}:`, error);
    return null;
  }
}

/** Rebuild an in-memory session from the saved copy, or null when absent. */
export function restoreRumble(roomCode: string): SessionState | null {
  const loaded = loadRumble(roomCode);
  if (!loaded) return null;
  try {
    return restoreSession(loaded.summary, loaded.preset);
  } catch (error) {
    console.error(`[RumbleStore] Could not restore room ${roomCode}:`, error);
    return null;
  }
}
