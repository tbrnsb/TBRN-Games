/**
 * Easing functions for TBRN-Games visual overhaul.
 * All animations use delta-time from the frame loop, never Date.now().
 */

// --- Standard Easings ---
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// --- Stagger Helpers ---
export function staggerDelay(index: number, baseDelay: number = 40): number {
  return index * baseDelay;
}

export function staggerEaseOutCubic(index: number, total: number, baseDelay: number = 40): (t: number) => number {
  const delay = staggerDelay(index, baseDelay);
  return (t: number) => {
    if (t < delay) return 0;
    const adjusted = Math.min(1, (t - delay) / (1 - delay));
    return easeOutCubic(adjusted);
  };
}

// --- Animation Controllers ---
export interface Animation {
  startTime: number;
  duration: number;
  easing: (t: number) => number;
  onUpdate: (progress: number) => void;
  onComplete?: () => void;
  finished: boolean;
}

export function createAnimation(
  duration: number,
  easing: (t: number) => number,
  onUpdate: (progress: number) => void,
  onComplete?: () => void
): Animation {
  return {
    startTime: 0,
    duration,
    easing,
    onUpdate,
    onComplete,
    finished: false,
  };
}

export function startAnimation(anim: Animation, now: number): void {
  anim.startTime = now;
  anim.finished = false;
}

export function updateAnimation(anim: Animation, now: number): void {
  if (anim.finished) return;
  const elapsed = now - anim.startTime;
  const progress = Math.min(1, elapsed / anim.duration);
  const eased = anim.easing(progress);
  anim.onUpdate(eased);
  if (progress >= 1) {
    anim.finished = true;
    anim.onComplete?.();
  }
}

// --- Spring (for pop effects) ---
export interface SpringConfig {
  tension: number; // 100-300
  friction: number; // 10-30
  mass?: number;
}

export function spring(
  config: SpringConfig,
  onUpdate: (value: number, velocity: number) => void,
  onComplete?: () => void
): { update: (dt: number) => boolean; value: number; velocity: number } {
  const tension = config.tension;
  const friction = config.friction;
  const mass = config.mass ?? 1;
  let value = 0;
  let velocity = 0;
  const target = 1;
  let finished = false;

  return {
    value: 0,
    velocity: 0,
    update(dt: number): boolean {
      if (finished) return false;
      const dtSeconds = dt / 1000;
      const displacement = value - target;
      const springForce = -tension * displacement;
      const dampingForce = -friction * velocity;
      const acceleration = (springForce + dampingForce) / mass;
      velocity += acceleration * dtSeconds;
      value += velocity * dtSeconds;
      onUpdate(value, velocity);
      if (Math.abs(value - target) < 0.001 && Math.abs(velocity) < 0.001) {
        value = target;
        velocity = 0;
        finished = true;
        onComplete?.();
        return false;
      }
      return true;
    },
  };
}

// --- Reduced Motion Check ---
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getMotionSettings(): { enabled: boolean; durationMultiplier: number } {
  const reduced = prefersReducedMotion();
  return {
    enabled: !reduced,
    durationMultiplier: reduced ? 0 : 1,
  };
}