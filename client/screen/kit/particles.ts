/**
 * Particle Emitter — bursts, confetti, ambient particles
 * Lightweight, pooled, under 300 live particles max.
 */

import { prefersReducedMotion } from "./easing.ts";
import { colors, getPlayerColor, scaledSize } from "./theme.ts";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: "circle" | "square" | "triangle" | "confetti";
  rotation: number;
  rotationSpeed: number;
  gravity: number;
  fade: boolean;
}

export interface EmitterConfig {
  x: number;
  y: number;
  count: number;
  colors: string[];
  shapes?: Particle["shape"][];
  speedRange: [number, number];
  angleRange?: [number, number];
  sizeRange: [number, number];
  lifeRange: [number, number];
  gravity?: number;
  fade?: boolean;
}

const PARTICLE_POOL: Particle[] = [];
const MAX_PARTICLES = 300;
let poolInitialized = false;

function initPool(): void {
  if (poolInitialized) return;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    PARTICLE_POOL.push({
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 0, size: 0,
      color: "#fff", shape: "circle",
      rotation: 0, rotationSpeed: 0, gravity: 0, fade: true,
    });
  }
  poolInitialized = true;
}

function getParticle(): Particle | null {
  initPool();
  for (const p of PARTICLE_POOL) {
    if (p.life <= 0) return p;
  }
  return null; // pool exhausted
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function emitBurst(config: EmitterConfig): number {
  if (prefersReducedMotion()) return 0;

  let emitted = 0;
  const shapes = config.shapes ?? ["circle", "square"];

  for (let i = 0; i < config.count; i++) {
    const p = getParticle();
    if (!p) break;

    const angle = config.angleRange
      ? randomRange(config.angleRange[0], config.angleRange[1])
      : Math.random() * Math.PI * 2;
    const speed = randomRange(config.speedRange[0], config.speedRange[1]);

    p.x = config.x;
    p.y = config.y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.maxLife = randomRange(config.lifeRange[0], config.lifeRange[1]);
    p.life = p.maxLife;
    p.size = randomRange(config.sizeRange[0], config.sizeRange[1]);
    p.color = randomChoice(config.colors);
    p.shape = randomChoice(shapes);
    p.rotation = Math.random() * Math.PI * 2;
    p.rotationSpeed = randomRange(-0.1, 0.1);
    p.gravity = config.gravity ?? 0;
    p.fade = config.fade ?? true;

    emitted++;
  }

  return emitted;
}

export function emitScoreBurst(x: number, y: number, playerIndex: number, scale: number = 1): void {
  // Seat palette (8 seats) so a burst matches the player's colour everywhere.
  const color = getPlayerColor(playerIndex);

  emitBurst({
    x, y,
    count: 20,
    colors: [color, "#fff", color + "80"],
    shapes: ["circle", "triangle"],
    speedRange: [100, 300],
    angleRange: [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5], // upward
    sizeRange: [scaledSize(4, scale), scaledSize(10, scale)],
    lifeRange: [600, 1200],
    gravity: 200,
    fade: true,
  });
}

export function emitHitBurst(x: number, y: number, color: string, scale: number = 1): void {
  emitBurst({
    x, y,
    count: 15,
    colors: [color, "#fff", colors.danger],
    shapes: ["square", "triangle"],
    speedRange: [150, 400],
    angleRange: [0, Math.PI * 2],
    sizeRange: [scaledSize(3, scale), scaledSize(8, scale)],
    lifeRange: [300, 800],
    gravity: 100,
    fade: true,
  });
}

export function emitConfetti(x: number, y: number, width: number, colors: string[], scale: number = 1): void {
  emitBurst({
    x, y,
    count: 50,
    colors,
    shapes: ["confetti", "square"],
    speedRange: [50, 200],
    angleRange: [-Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8],
    sizeRange: [scaledSize(6, scale), scaledSize(14, scale)],
    lifeRange: [2000, 4000],
    gravity: 150,
    fade: false,
  });
}

export function updateParticles(dt: number): void {
  const dtSec = dt / 1000;

  for (const p of PARTICLE_POOL) {
    if (p.life <= 0) continue;

    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.vy += p.gravity * dtSec;
    p.rotation += p.rotationSpeed * dtSec;
    p.life -= dt;

    if (p.life <= 0) {
      p.life = 0;
    }
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D): void {
  for (const p of PARTICLE_POOL) {
    if (p.life <= 0) continue;

    const alpha = p.fade ? p.life / p.maxLife : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);

    const color = p.color;
    ctx.fillStyle = color;

    switch (p.shape) {
      case "circle": {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "square": {
        const hs = p.size / 2;
        ctx.fillRect(-hs, -hs, p.size, p.size);
        break;
      }
      case "triangle": {
        const ts = p.size / 2;
        ctx.beginPath();
        ctx.moveTo(0, -ts);
        ctx.lineTo(ts, ts);
        ctx.lineTo(-ts, ts);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "confetti": {
        const cs = p.size / 2;
        ctx.fillRect(-cs, -cs, p.size * 0.6, p.size);
        break;
      }
    }

    ctx.restore();
  }
}

export function getActiveParticleCount(): number {
  let count = 0;
  for (const p of PARTICLE_POOL) {
    if (p.life > 0) count++;
  }
  return count;
}

export function clearParticles(): void {
  for (const p of PARTICLE_POOL) {
    p.life = 0;
  }
}