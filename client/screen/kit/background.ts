/**
 * Paper background for the legacy canvas renderers.
 * Flat paper texture + a few handmade details; no gradient, sun or grid.
 */

import { colors, scaleForViewport } from "./theme.ts";

interface BackgroundConfig {
  width: number;
  height: number;
  time: number;
}

interface PaperCache {
  image: HTMLImageElement;
  pattern: CanvasPattern | null;
}

const paperCache = new Map<string, PaperCache>();
const halftoneCache: { image: HTMLImageElement | null } = { image: null };

function paper(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (typeof Image === "undefined") return null;
  const src = colors.paperTexture;
  let entry = paperCache.get(src);
  if (!entry) {
    const image = new Image();
    image.src = src;
    entry = { image, pattern: null };
    paperCache.set(src, entry);
  }
  if (entry.pattern) return entry.pattern;
  if (entry.image.complete && entry.image.naturalWidth > 0) {
    entry.pattern = ctx.createPattern(entry.image, "repeat");
  }
  return entry.pattern;
}

function halftone(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (typeof Image === "undefined") return null;
  if (!halftoneCache.image) {
    const image = new Image();
    image.src = "/assets/paper/halftone.svg";
    halftoneCache.image = image;
  }
  const img = halftoneCache.image;
  if (!img.complete || img.naturalWidth === 0) return null;
  return ctx.createPattern(img, "repeat");
}

export function drawSynthwaveBackground(ctx: CanvasRenderingContext2D, config: BackgroundConfig): void {
  const { width, height } = config;
  const scale = scaleForViewport(width, height);

  ctx.save();
  ctx.fillStyle = colors.bg0;
  ctx.fillRect(0, 0, width, height);
  const texture = paper(ctx);
  if (texture) {
    ctx.fillStyle = texture;
    ctx.fillRect(0, 0, width, height);
  }

  // Halftone patch, bottom-right, very low contrast.
  const dots = halftone(ctx);
  if (dots) {
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = dots;
    ctx.fillRect(width * 0.62, height * 0.56, width * 0.38, height * 0.44);
    ctx.restore();
  }

  // A quiet fold line and a crease, not a vignette.
  ctx.strokeStyle = colors.textMuted;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = Math.max(1, scale * 1.2);
  ctx.beginPath();
  ctx.moveTo(width * 0.06, 0);
  ctx.lineTo(width * 0.045, height);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Tape strip, pin and coffee ring: three handmade details on every game.
  drawTape(ctx, width * 0.06, height * 0.045, scale);
  drawPin(ctx, width - scale * 54, height * 0.075, scale);
  drawCoffeeRing(ctx, width * 0.09, height * 0.86, scale);

  ctx.restore();
}

export function drawMinimalBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = colors.bg0;
  ctx.fillRect(0, 0, width, height);
  const texture = paper(ctx);
  if (texture) {
    ctx.fillStyle = texture;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function drawTape(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.06);
  ctx.fillStyle = "#E9D7A8";
  ctx.globalAlpha = 0.88;
  ctx.fillRect(0, 0, 120 * scale, 28 * scale);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(29,27,38,0.3)";
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(0, 0, 120 * scale, 28 * scale);
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.fillStyle = colors.magenta;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scale * 2.5);
  ctx.beginPath();
  ctx.arc(x, y, 10 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 5 * scale, y + 6 * scale);
  ctx.lineTo(x + 16 * scale, y + 22 * scale);
  ctx.stroke();
  ctx.restore();
}

function drawCoffeeRing(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#9B6A3E";
  ctx.lineWidth = Math.max(2, scale * 4);
  ctx.beginPath();
  ctx.arc(x, y, 54 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
