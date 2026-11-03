/**
 * Screen Shake — max 6px offset, 250ms decay
 * Returns offset to apply to canvas transform.
 */

import { prefersReducedMotion, easeOutExpo } from "./easing.ts";

export interface ScreenShake {
  intensity: number; // 0-1
  duration: number; // ms
  startTime: number;
  active: boolean;
  maxOffset: number; // pixels at 1920x1080
  decayMs: number;
}

export function createShake(maxOffset: number = 6, decayMs: number = 250): ScreenShake {
  return {
    intensity: 0,
    duration: 0,
    startTime: 0,
    active: false,
    maxOffset,
    decayMs,
  };
}

export function triggerShake(shake: ScreenShake, intensity: number, now: number): void {
  if (prefersReducedMotion()) return;

  shake.intensity = Math.min(1, Math.max(0, intensity));
  shake.startTime = now;
  shake.active = true;
}

export function updateShake(shake: ScreenShake, now: number): { x: number; y: number } {
  if (!shake.active || prefersReducedMotion()) {
    return { x: 0, y: 0 };
  }

  const elapsed = now - shake.startTime;
  if (elapsed >= shake.decayMs) {
    shake.active = false;
    shake.intensity = 0;
    return { x: 0, y: 0 };
  }

  const progress = elapsed / shake.decayMs;
  const decay = easeOutExpo(1 - progress); // starts at 1, decays to 0
  const currentIntensity = shake.intensity * decay;

  // Random direction each frame for shake effect
  const angle = Math.random() * Math.PI * 2;
  const offset = currentIntensity * shake.maxOffset;

  return {
    x: Math.cos(angle) * offset,
    y: Math.sin(angle) * offset,
  };
}

export function applyShakeTransform(ctx: CanvasRenderingContext2D, shake: ScreenShake, now: number): void {
  const offset = updateShake(shake, now);
  if (offset.x !== 0 || offset.y !== 0) {
    ctx.translate(offset.x, offset.y);
  }
}

export function isShaking(shake: ScreenShake): boolean {
  return shake.active;
}