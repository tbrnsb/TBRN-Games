/**
 * Animated Score Counter — count-up animation with easing
 * Used for scores, points, and numeric displays.
 */

import { fonts, colors, scaledSize } from "./theme.ts";
import { easeOutExpo } from "./easing.ts";

export interface AnimatedCounter {
  value: number;
  target: number;
  startTime: number;
  duration: number;
  easing: (t: number) => number;
  started: boolean;
}

export function createCounter(initialValue: number = 0): AnimatedCounter {
  return {
    value: initialValue,
    target: initialValue,
    startTime: 0,
    duration: 800,
    easing: easeOutExpo,
    started: false,
  };
}

export function setCounterTarget(counter: AnimatedCounter, target: number, now: number, duration?: number): void {
  counter.target = target;
  counter.startTime = now;
  counter.duration = duration ?? 800;
  counter.started = true;
}

export function updateCounter(counter: AnimatedCounter, now: number): number {
  if (!counter.started) return counter.value;

  const elapsed = now - counter.startTime;
  const progress = Math.min(1, elapsed / counter.duration);
  const eased = counter.easing(progress);
  counter.value = counter.value + (counter.target - counter.value) * eased;

  if (progress >= 1) {
    counter.value = counter.target;
    counter.started = false;
  }

  return counter.value;
}

export function getCounterValue(counter: AnimatedCounter): number {
  return Math.round(counter.value);
}

// --- Score Display Helper ---
export interface ScoreDisplayOptions {
  font?: string;
  color?: string;
  prefix?: string;
  suffix?: string;
  tabular?: boolean;
}

export function drawScore(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  counter: AnimatedCounter,
  options: ScoreDisplayOptions = {}
): void {
  const {
    font = `bold ${scaledSize(64, 1)}px ${fonts.display.family}`,
    color = colors.text,
    prefix = "",
    suffix = "",
    tabular = true,
  } = options;

  const value = getCounterValue(counter);
  const text = `${prefix}${value}${suffix}`;

  ctx.font = font;
  if (tabular) {
    ctx.font = `tabular-nums ${font}`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

// --- Multi-Counter Manager (for multiple player scores) ---
export class ScoreManager {
  private counters: Map<number, AnimatedCounter> = new Map();
  private now: number = 0;

  update(now: number): void {
    this.now = now;
    for (const counter of this.counters.values()) {
      updateCounter(counter, now);
    }
  }

  getCounter(playerIndex: number): AnimatedCounter {
    if (!this.counters.has(playerIndex)) {
      this.counters.set(playerIndex, createCounter(0));
    }
    return this.counters.get(playerIndex)!;
  }

  setScore(playerIndex: number, score: number, duration?: number): void {
    const counter = this.getCounter(playerIndex);
    setCounterTarget(counter, score, this.now, duration);
  }

  getDisplayScore(playerIndex: number): number {
    return getCounterValue(this.getCounter(playerIndex));
  }

  reset(): void {
    this.counters.clear();
  }
}