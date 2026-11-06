/**
 * Guess the Imposter host settings (brief section 5).
 *
 * These are lobby choices, not game state: the TV remembers them in
 * localStorage and sends them as `options` when the host starts the game. The
 * module is pure and takes a small storage interface, so tests can pass a fake
 * and the server-side clamps in `games/guessimposter/server.ts` stay the only
 * authority on what a game actually runs.
 */

import type { SettingsStorage } from "./settings.ts";

/** One JSON blob, because a 14-field preference set is not worth 14 keys. */
export const IMPOSTER_SETTINGS_KEY = "tbrn_imposter_settings";

export type ImposterClueMode = "spoken" | "typed";

export interface ImposterHostSettings {
  /** Words per game, 1-5. */
  rounds: number;
  clueMode: ImposterClueMode;
  /** Clue rounds before each vote, 1-3. */
  clueRounds: number;
  /** 10, 20, 30 seconds, or 0 for no turn timer. */
  turnTimerSec: number;
  discussionSec: number;
  imposterNotFirst: boolean;
  imposterNotLast: boolean;
  rerandomiseOrder: boolean;
  includeLarper: boolean;
  announceLarper: boolean;
  imposterSeesCategory: boolean;
  imposters: 1 | 2;
  allowSkipVotes: boolean;
  spokenAnnouncements: boolean;
}

/** Offered turn timers; 0 is the "off" entry. */
export const TURN_TIMER_CHOICES: readonly number[] = [10, 20, 30, 0];

/** Role rules the brief pins to the player count. */
export const LARPER_MIN_PLAYERS = 5;
export const TWO_IMPOSTERS_MIN_PLAYERS = 7;

/** The brief's table defaults, at the standalone word count. */
export function defaultImposterSettings(): ImposterHostSettings {
  return {
    rounds: 3,
    clueMode: "spoken",
    clueRounds: 2,
    turnTimerSec: 20,
    discussionSec: 90,
    imposterNotFirst: true,
    imposterNotLast: false,
    rerandomiseOrder: true,
    includeLarper: false,
    announceLarper: false,
    imposterSeesCategory: true,
    imposters: 1,
    allowSkipVotes: false,
    spokenAnnouncements: true,
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function whole(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Accept seconds or milliseconds; anything else is the default timer. */
function turnTimer(value: unknown, fallback: number): number {
  if (value === false || value === "off" || value === "none") return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number <= 0) return 0;
  const seconds = number > 60 ? Math.round(number / 1000) : Math.round(number);
  return TURN_TIMER_CHOICES.includes(seconds) ? seconds : fallback;
}

/**
 * Merge a stored/partial value over the defaults field by field. Unknown keys
 * are dropped and anything out of range falls back, so a hand-edited
 * localStorage entry cannot start a game with a negative timer.
 */
export function normaliseImposterSettings(raw: unknown): ImposterHostSettings {
  const defaults = defaultImposterSettings();
  if (!raw || typeof raw !== "object") return defaults;
  const value = raw as Record<string, unknown>;

  return {
    rounds: whole(value.rounds, defaults.rounds, 1, 5),
    clueMode: value.clueMode === "typed" ? "typed" : "spoken",
    clueRounds: whole(value.clueRounds, defaults.clueRounds, 1, 3),
    turnTimerSec: turnTimer(value.turnTimerSec, defaults.turnTimerSec),
    discussionSec: whole(value.discussionSec, defaults.discussionSec, 30, 180),
    imposterNotFirst: bool(value.imposterNotFirst, defaults.imposterNotFirst),
    imposterNotLast: bool(value.imposterNotLast, defaults.imposterNotLast),
    rerandomiseOrder: bool(value.rerandomiseOrder, defaults.rerandomiseOrder),
    includeLarper: bool(value.includeLarper, defaults.includeLarper),
    announceLarper: bool(value.announceLarper, defaults.announceLarper),
    imposterSeesCategory: bool(value.imposterSeesCategory, defaults.imposterSeesCategory),
    imposters: value.imposters === 2 || value.imposters === "2" ? 2 : 1,
    allowSkipVotes: bool(value.allowSkipVotes, defaults.allowSkipVotes),
    spokenAnnouncements: bool(value.spokenAnnouncements, defaults.spokenAnnouncements),
  };
}

/** Preferences survive a refresh; a blocked or corrupt store falls back. */
export function readImposterSettings(storage: SettingsStorage | null): ImposterHostSettings {
  if (!storage) return defaultImposterSettings();
  try {
    const raw = storage.getItem(IMPOSTER_SETTINGS_KEY);
    if (!raw) return defaultImposterSettings();
    return normaliseImposterSettings(JSON.parse(raw));
  } catch {
    return defaultImposterSettings();
  }
}

export function writeImposterSettings(
  storage: SettingsStorage | null,
  settings: ImposterHostSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(IMPOSTER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are best-effort; never take the lobby down for one.
  }
}

export interface ImposterAvailability {
  /** The Larper needs five players. */
  larper: boolean;
  /** A second Imposter needs seven. */
  twoImposters: boolean;
}

export function imposterAvailability(playerCount: number): ImposterAvailability {
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  return {
    larper: count >= LARPER_MIN_PLAYERS,
    twoImposters: count >= TWO_IMPOSTERS_MIN_PLAYERS,
  };
}

/**
 * Merge a panel read with the saved intent.
 *
 * The two role controls are disabled while the table is too small, so a panel
 * read reports them as off/1. Keeping the saved value means a host who picked a
 * Larper at eight players still has that choice when the room shrinks and grows
 * again; the server clamps both by player count either way.
 */
export function keepUnavailableChoices(
  saved: ImposterHostSettings,
  panel: ImposterHostSettings,
  playerCount: number,
): ImposterHostSettings {
  const availability = imposterAvailability(playerCount);
  return {
    ...panel,
    includeLarper: availability.larper ? panel.includeLarper : saved.includeLarper,
    imposters: availability.twoImposters ? panel.imposters : saved.imposters,
  };
}

/**
 * The `options` payload for `POST /api/rooms/:id/start`.
 *
 * A Rumble always runs its own word count, so `rounds` is omitted there and
 * the server's `mode: "rumble"` default (two words) applies.
 */
export function imposterStartOptions(
  settings: ImposterHostSettings,
  scope: { rumble?: boolean } = {},
): Record<string, unknown> {
  const rumble = scope.rumble === true;
  const options: Record<string, unknown> = {
    mode: rumble ? "rumble" : "standalone",
    clueMode: settings.clueMode,
    clueRounds: settings.clueRounds,
    turnTimerSec: settings.turnTimerSec,
    discussionSec: settings.discussionSec,
    imposterNotFirst: settings.imposterNotFirst,
    imposterNotLast: settings.imposterNotLast,
    rerandomiseOrder: settings.rerandomiseOrder,
    includeLarper: settings.includeLarper,
    announceLarper: settings.announceLarper,
    imposterSeesCategory: settings.imposterSeesCategory,
    imposters: settings.imposters,
    allowSkipVotes: settings.allowSkipVotes,
    spokenAnnouncements: settings.spokenAnnouncements,
  };
  if (!rumble) options.rounds = settings.rounds;
  return options;
}
