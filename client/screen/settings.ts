/**
 * TV preferences (Phase 2, brief 3.8).
 *
 * Sound effects and spoken announcements are host preferences, not game state.
 * They live in localStorage so a refresh keeps them. The helpers take a small
 * storage interface instead of reaching for `window` themselves, so tests can
 * pass a fake and the module stays importable outside a browser.
 */

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One key per preference; values are `"on"` or `"off"`. */
export const SOUND_KEY = "tbrn_screen_sound";
export const SPEECH_KEY = "tbrn_screen_speech";

export type SettingKey = typeof SOUND_KEY | typeof SPEECH_KEY;

export interface TvSettings {
  sound: boolean;
  speech: boolean;
}

/**
 * Both preferences default to on. Speech support is checked separately in
 * `loadTvSettings`, because it is a capability rather than a preference.
 */
export function defaultSetting(): boolean {
  return true;
}

/**
 * Read one preference. Anything other than the two known values (including a
 * blocked storage read) falls back to the default.
 */
export function readSetting(storage: SettingsStorage | null, key: SettingKey): boolean {
  const fallback = defaultSetting();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw === "on") return true;
    if (raw === "off") return false;
  } catch {
    // Private mode and disabled storage can throw; a preference is not worth
    // taking the screen down for.
  }
  return fallback;
}

/** Persist one preference. A blocked storage write is ignored. */
export function writeSetting(
  storage: SettingsStorage | null,
  key: SettingKey,
  enabled: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, enabled ? "on" : "off");
  } catch {
    // See readSetting: preferences are best-effort.
  }
}

/**
 * Load both preferences for the TV. Speech cannot be enabled when the browser
 * has no synthesiser, so the stored value is ignored in that case.
 */
export function loadTvSettings(
  storage: SettingsStorage | null,
  speechSupported: boolean,
): TvSettings {
  return {
    sound: readSetting(storage, SOUND_KEY),
    speech: speechSupported ? readSetting(storage, SPEECH_KEY) : false,
  };
}
