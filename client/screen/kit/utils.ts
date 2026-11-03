/**
 * Utility functions for text rendering, shapes, colors
 * Shared across all renderers.
 */

/**
 * Wrap text to fit within maxWidth, returns array of lines
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font?: string
): string[] {
  if (font) ctx.font = font;

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Draw wrapped text at position, returns final Y position
 */
export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font?: string,
  color?: string,
  align: CanvasTextAlign = "left",
  baseline: CanvasTextBaseline = "top"
): number {
  if (font) ctx.font = font;
  if (color) ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;

  const lines = wrapText(ctx, text, maxWidth);
  let currentY = y;

  for (const line of lines) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }

  return currentY;
}

/**
 * Round rectangle path (doesn't fill/stroke)
 */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draw rounded rectangle with fill and/or stroke
 */
export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill?: string | CanvasGradient | CanvasPattern,
  stroke?: string,
  lineWidth: number = 1
): void {
  roundRectPath(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Draw a pill shape (rounded ends)
 */
export function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill?: string | CanvasGradient | CanvasPattern,
  stroke?: string,
  lineWidth: number = 1
): void {
  const r = height / 2;
  roundRectPath(ctx, x, y, width, height, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Draw a circle
 */
export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill?: string,
  stroke?: string,
  lineWidth: number = 1
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Draw a triangle
 */
export function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number = 0,
  fill?: string,
  stroke?: string,
  lineWidth: number = 1
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.866, size * 0.5);
  ctx.lineTo(-size * 0.866, size * 0.5);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Hex color to RGBA with alpha
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Interpolate between two hex colors
 */
export function lerpColor(color1: string, color2: string, t: number): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  if (!c1 || !c2) return color1;

  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Get contrast color (black or white) for a background color
 */
export function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#000000";
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? "#0B0820" : "#F5F3FF";
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format time in ms as MM:SS or SS.s
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${seconds}s`;
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth step interpolation
 */
export function smoothstep(a: number, b: number, t: number): number {
  const clamped = clamp((t - a) / (b - a), 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Get font string with tabular figures for numbers
 */
export function getTabularFont(baseFont: string): string {
  if (baseFont.includes("tabular-nums")) return baseFont;
  return `tabular-nums ${baseFont}`;
}

/**
 * Measure text width with current font
 */
export function measureText(ctx: CanvasRenderingContext2D, text: string): number {
  return ctx.measureText(text).width;
}

/**
 * Check if point is in rectangle
 */
export function pointInRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * Get distance between two points
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get angle between two points
 */
export function angle(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * Deep clone (for state snapshots)
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate unique ID
 */
export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}