/**
 * Synthwave Background — deep gradient, starfield, banded sun, perspective grid.
 * Designed for 1920x1080 logical and scaled to the actual viewport.
 *
 * Keep it subtle: gameplay content is drawn on top, so the background must
 * never compete with it for contrast.
 */

import { colors, scaleForViewport } from "./theme.ts";
import { prefersReducedMotion } from "./easing.ts";

interface BackgroundConfig {
  width: number;
  height: number;
  time: number; // animation time in ms
}

/** Deterministic hash → 0..1, so stars do not jump between frames. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function drawSynthwaveBackground(ctx: CanvasRenderingContext2D, config: BackgroundConfig): void {
  const { width, height, time } = config;
  const scale = scaleForViewport(width, height);
  const horizonY = height * 0.62;

  ctx.save();

  // 1. Vertical gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, colors.gradient.bgStart);
  grad.addColorStop(0.55, colors.bg1);
  grad.addColorStop(1, colors.gradient.bgEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. Starfield in the sky only.
  drawStars(ctx, width, horizonY, time, scale);

  // 3. Sun sitting on the horizon.
  drawSun(ctx, width, horizonY, scale);

  // 4. Horizon glow.
  const glow = ctx.createLinearGradient(0, horizonY - height * 0.08, 0, horizonY + height * 0.04);
  glow.addColorStop(0, "rgba(255,46,151,0)");
  glow.addColorStop(0.55, "rgba(255,46,151,0.18)");
  glow.addColorStop(1, "rgba(255,46,151,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizonY - height * 0.08, width, height * 0.12);

  // 5. Perspective floor grid.
  if (!prefersReducedMotion()) {
    drawPerspectiveGrid(ctx, width, height, horizonY, scale, time);
  }

  ctx.restore();
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  width: number,
  horizonY: number,
  time: number,
  scale: number,
): void {
  const count = 70;
  for (let i = 0; i < count; i++) {
    const x = hash01(i * 3.1) * width;
    const y = hash01(i * 7.7) * horizonY * 0.9;
    const base = hash01(i * 11.3);
    const twinkle = 0.55 + 0.45 * Math.sin(time * 0.0012 + base * Math.PI * 2);
    const alpha = 0.15 + base * 0.45 * twinkle;
    const size = (0.6 + base * 1.4) * Math.max(0.7, scale);
    ctx.fillStyle = `rgba(245,243,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSun(ctx: CanvasRenderingContext2D, width: number, horizonY: number, scale: number): void {
  const radius = Math.min(width, horizonY) * 0.22;
  const cx = width / 2;
  const cy = horizonY;

  ctx.save();

  // Soft outer halo.
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 1.9);
  halo.addColorStop(0, "rgba(255,179,71,0.20)");
  halo.addColorStop(0.5, "rgba(255,46,151,0.08)");
  halo.addColorStop(1, "rgba(255,46,151,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
  ctx.fill();

  // Sun disc, clipped to its own bounds so the stripes stay inside.
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  const disc = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
  disc.addColorStop(0, colors.gradient.sunStart);
  disc.addColorStop(0.6, "#FF7A59");
  disc.addColorStop(1, colors.gradient.sunEnd);
  ctx.fillStyle = disc;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  // Horizontal cut bands — thicker toward the bottom of the disc.
  ctx.fillStyle = colors.gradient.bgEnd;
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    const y = cy - radius * 0.05 + t * radius * 1.05;
    const h = radius * (0.012 + t * 0.05);
    ctx.fillRect(cx - radius, y, radius * 2, h);
  }

  ctx.restore();

  // Thin ring to separate sun from sky.
  ctx.strokeStyle = "rgba(255,179,71,0.18)";
  ctx.lineWidth = Math.max(1, scale);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI * 2);
  ctx.stroke();
}

function drawPerspectiveGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  horizonY: number,
  scale: number,
  time: number,
): void {
  const cx = width / 2;
  const bottom = height + 2;
  const lineAlpha = 0.16;

  ctx.save();
  ctx.strokeStyle = `rgba(255,46,151,${lineAlpha})`;
  ctx.lineWidth = Math.max(1, 1.2 * scale);

  // Vertical lines converging on the vanishing point.
  const spread = 14;
  for (let i = -spread; i <= spread; i++) {
    const bx = cx + (i / spread) * width * 1.15;
    ctx.beginPath();
    ctx.moveTo(cx, horizonY);
    ctx.lineTo(bx, bottom);
    ctx.stroke();
  }

  // Horizontal lines, quadratically spaced, scrolling toward the viewer.
  const rows = 12;
  const scroll = prefersReducedMotion() ? 0 : (time * 0.00006) % 1;
  for (let i = 0; i < rows; i++) {
    const t = (i + scroll) / rows;
    const y = horizonY + t * t * (height - horizonY);
    if (y < horizonY + 1 || y > height) continue;
    ctx.globalAlpha = 0.35 + t * 0.65;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.restore();
}

// --- Alternative: minimal background for games that need a cleaner canvas ---
export function drawMinimalBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, colors.bg0);
  grad.addColorStop(1, colors.bg1);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}
