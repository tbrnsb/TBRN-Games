/**
 * Tiny Web Audio sound manager. All shared sounds are synthesized; there are no
 * audio files to download. The first click unlocks the context.
 */

type SoundName =
  | "join"
  | "stamp"
  | "slide"
  | "peel"
  | "tick"
  | "tickFast"
  | "correct"
  | "wrong"
  | "reveal"
  | "win"
  | "disconnect"
  | "click";

const BANK_WAVE: Record<string, OscillatorType> = {
  wood: "triangle", brass: "sawtooth", chalk: "square", plop: "sine",
  comic: "square", typewriter: "square", pencil: "triangle", circus: "sawtooth",
  yearbook: "sine", chips: "triangle", buzzer: "square", engine: "sawtooth",
  sonar: "sine", slot: "square", dice: "triangle", whirr: "sawtooth",
  horns: "sawtooth", marker: "triangle", paper: "triangle",
};

const STORAGE_MUTE = "tbrn_muted";
const STORAGE_VOLUME = "tbrn_volume";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _muted = false;
  private _volume = 0.6;

  constructor() {
    try {
      this._muted = localStorage.getItem(STORAGE_MUTE) === "1";
      const v = Number(localStorage.getItem(STORAGE_VOLUME));
      if (Number.isFinite(v)) this._volume = clamp(v, 0, 1);
    } catch {
      /* storage unavailable */
    }
  }

  get muted() {
    return this._muted;
  }

  get volume() {
    return this._volume;
  }

  setMuted(value: boolean) {
    this._muted = value;
    try { localStorage.setItem(STORAGE_MUTE, value ? "1" : "0"); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = value ? 0 : this._volume;
  }

  setVolume(value: number) {
    this._volume = clamp(value, 0, 1);
    try { localStorage.setItem(STORAGE_VOLUME, String(this._volume)); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this._muted ? 0 : this._volume;
  }

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : this._volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  private env(duration: number, peak = 0.3) {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(this.master!);
    return gain;
  }

  private tone(freq: number, duration: number, type: OscillatorType = "sine", peak = 0.25, slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = this.env(duration, peak);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + duration);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  private noise(duration: number, peak = 0.2, lowpass = 2400) {
    const ctx = this.ensure();
    if (!ctx) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    const gain = this.env(duration, peak);
    source.connect(filter).connect(gain);
    source.start();
  }

  play(name: SoundName, options: { pitch?: number; bank?: string } = {}) {
    if (this._muted) return;
    const p = options.pitch ?? 1;
    const wave = BANK_WAVE[options.bank ?? ""] ?? "triangle";
    switch (name) {
      case "click":
        this.tone(520 * p, 0.045, "square", 0.08);
        break;
      case "join":
        this.tone(420 * p, 0.08, wave, 0.16);
        this.tone(680 * p, 0.12, wave, 0.12, 760 * p);
        break;
      case "stamp":
        this.noise(0.12, 0.26, 900);
        this.tone(92 * p, 0.14, "sine", 0.28, 48);
        break;
      case "slide":
        this.noise(0.16, 0.12, 3200);
        break;
      case "peel":
        this.noise(0.18, 0.1, 5200);
        this.tone(900 * p, 0.08, "triangle", 0.05, 1400 * p);
        break;
      case "tick":
        this.tone(1200 * p, 0.03, "square", 0.05);
        break;
      case "tickFast":
        this.tone(1600 * p, 0.03, "square", 0.08);
        break;
      case "correct":
        this.tone(660 * p, 0.1, wave, 0.16);
        this.tone(990 * p, 0.18, wave, 0.14, 1100 * p);
        break;
      case "wrong":
        this.tone(180 * p, 0.2, "sawtooth", 0.18, 120);
        break;
      case "reveal":
        for (let i = 0; i < 6; i++) window.setTimeout(() => this.tone((300 + i * 80) * p, 0.05, "square", 0.06), i * 55);
        break;
      case "win":
        [523, 659, 784, 1046].forEach((f, i) => window.setTimeout(() => this.tone(f * p, 0.22, wave, 0.18), i * 110));
        break;
      case "disconnect":
        this.tone(300 * p, 0.25, "sine", 0.12, 140);
        break;
    }
  }

  hostBlip(pitch: number, bank = "") {
    if (this._muted) return;
    const base = 260 * pitch;
    this.tone(base + Math.random() * 50, 0.035, BANK_WAVE[bank] ?? "square", 0.04);
  }

  haptic(pattern: number | number[] = 12) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate(pattern); } catch { /* ignore */ }
    }
  }
}

export const sound = new SoundManager();
