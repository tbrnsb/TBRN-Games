/**
 * TV spoken announcements (Phase 2, brief 3.8).
 *
 * The TV can read a short turn line ("Jamie, you're up") through the browser's
 * own speech synthesiser. There are no assets and no network calls.
 *
 * Speech is optional and off-limits unless the host turned it on and the game
 * published text. A screen state without `announce` says nothing at all.
 */

import {
  readSetting,
  SPEECH_KEY,
  writeSetting,
  type SettingsStorage,
} from "./settings.ts";

/** True when this browser can speak at all. */
export function speechSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.speechSynthesis !== "undefined"
    && typeof SpeechSynthesisUtterance !== "undefined";
}

/**
 * Announce only when the line actually changed: repeated frames with the same
 * `announce` must not restart the voice, and empty text is never spoken.
 */
export function shouldAnnounce(previous: string, next: string): boolean {
  const text = next.trim();
  return text.length > 0 && text !== previous.trim();
}

/** Load the persisted speech preference. Defaults to on when supported. */
export function loadSpeechEnabled(
  storage: SettingsStorage | null,
  supported: boolean = speechSupported(),
): boolean {
  return supported ? readSetting(storage, SPEECH_KEY) : false;
}

/** Persist the speech preference. */
export function saveSpeechEnabled(storage: SettingsStorage | null, enabled: boolean): void {
  writeSetting(storage, SPEECH_KEY, enabled);
}

/** Stop whatever the screen is saying. Safe when speech is unavailable. */
export function cancelSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Speech is a bonus; silence is an acceptable failure.
  }
}

export interface AnnounceOptions {
  /**
   * The host's "Spoken turn announcements" setting. False cancels the current
   * utterance so flipping the setting off stops the voice immediately.
   */
  enabled: boolean;
}

/**
 * Speak one line, replacing the previous one. Empty text, a disabled setting
 * or a browser without synthesis all resolve to silence.
 */
export function announce(text: string, options: AnnounceOptions): void {
  if (!options.enabled || !speechSupported()) {
    cancelSpeech();
    return;
  }

  const line = text.trim();
  if (!line) {
    cancelSpeech();
    return;
  }

  try {
    const synthesis = window.speechSynthesis;
    // One voice at a time: a new turn line replaces the previous one instead of
    // queueing behind it.
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
    if (lang) utterance.lang = lang;
    synthesis.speak(utterance);
  } catch {
    // Speech is a bonus; the caption and the TV state still carry the turn.
  }
}
