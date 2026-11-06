/**
 * TV sound effects (Phase 2, brief 3.8).
 *
 * Every cue is synthesised with a handful of WebAudio oscillators, so the
 * project ships no audio assets and there is nothing to license or load. The
 * cues are deliberately short and quiet: they punctuate a reveal, they are not
 * the show.
 *
 * Audio is optional. No browser API here may throw at the screen: a missing or
 * gesture-blocked `AudioContext` just means silence.
 */

import {
  readSetting,
  SOUND_KEY,
  writeSetting,
  type SettingsStorage,
} from "./settings.ts";

export const SOUND_CUES = ["reveal", "vote", "win", "tick", "whoosh"] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

const SOUND_CUE_SET: ReadonlySet<string> = new Set(SOUND_CUES);

export interface PlayCueOptions {
  /** Defaults to on; the TV settings panel passes its own state. */
  enabled?: boolean;
}

/** True when a game published a real cue id rather than arbitrary text. */
export function isSoundCue(value: unknown): value is SoundCue {
  return typeof value === "string" && SOUND_CUE_SET.has(value);
}

/**
 * Normalise a screen state's `sound` field: one cue id or an array of them.
 * Unknown ids are dropped and a repeated id in the same list plays once.
 */
export function cuesFromScreen(state: unknown): SoundCue[] {
  if (!state || typeof state !== "object") return [];
  const sound = (state as Record<string, unknown>).sound;
  const raw: unknown[] = typeof sound === "string" ? [sound] : Array.isArray(sound) ? sound : [];

  const cues: SoundCue[] = [];
  for (const value of raw) {
    if (!isSoundCue(value) || cues.includes(value)) continue;
    cues.push(value);
  }
  return cues;
}

/** Stable JSON signature for a cue list; the frame loop dedupes on this. */
export function cueSignature(cues: readonly SoundCue[]): string {
  return JSON.stringify(cues);
}

/**
 * Cues to play for a state change. A frame that republishes the same cue list
 * returns nothing, so a game can keep `sound` on screen without replaying it
 * every animation frame.
 */
export function cuesToPlay(previousSignature: string, cues: readonly SoundCue[]): SoundCue[] {
  return cueSignature(cues) === previousSignature ? [] : [...cues];
}

/** Load the persisted mute preference. Defaults to on. */
export function loadSoundEnabled(storage: SettingsStorage | null): boolean {
  return readSetting(storage, SOUND_KEY);
}

/** Persist the mute preference. */
export function saveSoundEnabled(storage: SettingsStorage | null, enabled: boolean): void {
  writeSetting(storage, SOUND_KEY, enabled);
}

// --- Synthesis ------------------------------------------------------------

interface CueNote {
  frequency: number;
  /** Seconds. */
  duration: number;
  /** Peak gain; the cues stay under a quiet conversation. */
  gain: number;
  slideTo?: number;
}

/** Short motifs, not music: two notes at most for a reveal. */
const CUE_NOTES: Record<SoundCue, readonly CueNote[]> = {
  reveal: [
    { frequency: 660, duration: 0.09, gain: 0.05 },
    { frequency: 990, duration: 0.14, gain: 0.05 },
  ],
  vote: [{ frequency: 440, duration: 0.07, gain: 0.05 }],
  win: [
    { frequency: 523.25, duration: 0.12, gain: 0.05 },
    { frequency: 659.25, duration: 0.12, gain: 0.05 },
    { frequency: 783.99, duration: 0.2, gain: 0.05 },
  ],
  tick: [{ frequency: 880, duration: 0.035, gain: 0.03 }],
  whoosh: [{ frequency: 880, duration: 0.18, gain: 0.03, slideTo: 220 }],
};

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** True when this browser exposes a WebAudio constructor at all. */
export function soundSupported(): boolean {
  return audioContextCtor() !== null;
}

let audioContext: AudioContext | null = null;
let audioUnavailable = false;

/** Create the context on first use; never let a constructor failure escape. */
function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  if (audioUnavailable) return null;

  const Ctor = audioContextCtor();
  if (!Ctor) {
    audioUnavailable = true;
    return null;
  }
  try {
    audioContext = new Ctor();
    return audioContext;
  } catch {
    audioUnavailable = true;
    return null;
  }
}

function playNotes(context: AudioContext, notes: readonly CueNote[], startAt: number): void {
  for (const note of notes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, startAt);
    if (note.slideTo !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(note.slideTo, startAt + note.duration);
    }

    // Never ramp from exactly zero: exponential ramps reject it.
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(note.gain, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + note.duration + 0.02);
  }
}

/** Play one cue. Silent (never throwing) when audio is muted or unavailable. */
export function playCue(kind: SoundCue, options: PlayCueOptions = {}): void {
  if (options.enabled === false) return;

  const notes = CUE_NOTES[kind];
  if (!notes) return;

  const context = getAudioContext();
  if (!context) return;

  try {
    // A context created before the first gesture starts suspended; the browser
    // releases it on the next gesture. Starting nodes now is harmless.
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    playNotes(context, notes, context.currentTime + 0.01);
  } catch {
    // Audio must never break the show.
  }
}

/**
 * Resume audio after the first host gesture. Browsers block playback until a
 * gesture, so the screen calls this from its first click or key press.
 */
export function unlockAudio(): void {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    void context.resume().catch(() => undefined);
  }
}
