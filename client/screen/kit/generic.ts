/**
 * Geometry and drawing for the generic fallback TV renderer.
 *
 * Games without `games/<id>/screen.ts` are drawn from their standard screen
 * state. Two payload-specific pieces live here so they can be unit-tested in
 * Node without a browser:
 *
 * - a large `slide` caption with the presenter above it and a "slides left"
 *   counter, and
 * - a stroke canvas for games that publish `strokes` (Drawful style).
 *
 * `genericSlideLayout` and `genericStrokeLayout` are pure; the `draw*` helpers
 * take a 2D context and never read module state.
 */

import { colors, fonts, scaleForViewport } from "./theme.ts";

export interface GenericRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GenericTextLine {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface GenericSlideLayout {
  /** Presenter line above the slide; null when the state has no name. */
  presenter: GenericTextLine | null;
  /** Right-aligned "N slides left" counter; null when the state has no count. */
  counter: GenericTextLine | null;
  slide: GenericRect & { size: number; lineHeight: number };
  /** Where the next generic section (votes, scores) may start. */
  nextY: number;
}

export interface GenericStroke {
  points: Array<[number, number]>;
  color: string;
}

const DEFAULT_TEXT = "#F8FAFC";
const SLIDE_SURFACE = "#1B1545";

function dimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Layout for a `slide` screen state.
 *
 * Returns null when there is no non-empty slide string, which keeps every
 * existing game on today's prompt/info path. The slide takes the big-text slot
 * and is sized from the viewport, with the eight-player score table in mind.
 */
export function genericSlideLayout(
  width: number,
  height: number,
  top: number,
  state: Record<string, unknown> | null | undefined,
): GenericSlideLayout | null {
  const text = typeof state?.slide === "string" ? state.slide.trim() : "";
  if (!state || !text) return null;

  const w = dimension(width);
  const h = dimension(height);
  if (w < 2 || h < 2) return null;

  const scale = scaleForViewport(w, h);
  const margin = Math.round(w * 0.025);
  const startY = Math.max(0, Number.isFinite(top) ? top : 0);

  const presenterName = typeof state.presenterName === "string" ? state.presenterName.trim() : "";
  const presenterSize = Math.max(20, Math.round(32 * scale));
  const counterSize = Math.max(16, Math.round(26 * scale));

  const rawLeft = typeof state.slidesLeft === "number" && Number.isFinite(state.slidesLeft)
    ? Math.max(0, Math.trunc(state.slidesLeft))
    : null;

  const slideTop = startY + (presenterName ? presenterSize + 14 : 0);
  const available = Math.max(1, h - slideTop - 24);
  const slideHeight = Math.min(available, Math.max(140, Math.round(h * 0.42)));
  const size = Math.max(40, Math.round(64 * scale));
  const lineHeight = Math.round(size * 1.2);

  return {
    presenter: presenterName
      ? { text: presenterName, x: margin, y: startY, size: presenterSize }
      : null,
    counter: rawLeft === null
      ? null
      : {
        text: rawLeft === 1 ? "1 slide left" : `${rawLeft} slides left`,
        x: w - margin,
        y: startY,
        size: counterSize,
      },
    slide: {
      x: margin,
      y: slideTop,
      width: Math.max(1, w - margin * 2),
      height: slideHeight,
      size,
      lineHeight,
    },
    nextY: slideTop + slideHeight + 16,
  };
}

/** Word-wrap `text` for the given context and width. */
export function wrapTextLines(
  ctx: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || !Number.isFinite(maxWidth) || maxWidth < 1) return [];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw the presenter, counter and large wrapped slide text. */
export function drawGenericSlide(
  ctx: CanvasRenderingContext2D,
  layout: GenericSlideLayout,
  slideText: string,
): void {
  const text = typeof slideText === "string" ? slideText.trim() : "";
  const { slide } = layout;

  ctx.save();
  ctx.fillStyle = SLIDE_SURFACE;
  ctx.fillRect(slide.x, slide.y, slide.width, slide.height);

  ctx.textBaseline = "top";
  if (layout.presenter) {
    ctx.textAlign = "left";
    ctx.fillStyle = colors.textMuted;
    ctx.font = `600 ${layout.presenter.size}px ${fonts.display.family}`;
    ctx.fillText(layout.presenter.text, layout.presenter.x, layout.presenter.y);
  }
  if (layout.counter) {
    ctx.textAlign = "right";
    ctx.fillStyle = colors.amber;
    ctx.font = `600 ${layout.counter.size}px ${fonts.body.family}`;
    ctx.fillText(layout.counter.text, layout.counter.x, layout.counter.y);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = DEFAULT_TEXT;
  ctx.font = `600 ${slide.size}px ${fonts.display.family}`;
  const lines = wrapTextLines(ctx, text, slide.width - 32);
  const textHeight = lines.length * slide.lineHeight;
  let y = slide.y + Math.max(8, (slide.height - textHeight) / 2);
  for (const line of lines) {
    ctx.fillText(line, slide.x + slide.width / 2, y);
    y += slide.lineHeight;
  }
  ctx.restore();
}

/**
 * Accept either a list of `{ points, color }` strokes (Drawful) or a list of
 * point arrays. Points are clamped to the 0..1 design space.
 */
export function normaliseStrokes(value: unknown): GenericStroke[] {
  if (!Array.isArray(value)) return [];

  const strokes: GenericStroke[] = [];
  for (const entry of value) {
    let rawPoints: unknown;
    let color = DEFAULT_TEXT;

    if (Array.isArray(entry)) {
      rawPoints = entry;
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      rawPoints = record.points;
      if (typeof record.color === "string" && record.color.trim()) color = record.color;
    }
    if (!Array.isArray(rawPoints)) continue;

    const points: Array<[number, number]> = [];
    for (const point of rawPoints) {
      if (
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number"
      ) {
        points.push([clamp01(point[0]), clamp01(point[1])]);
      }
    }
    if (points.length > 0) strokes.push({ points, color });
  }
  return strokes;
}

/** Rect for the fallback stroke canvas, leaving room for the score table. */
export function genericStrokeLayout(width: number, height: number, top: number): GenericRect {
  const w = dimension(width);
  const h = dimension(height);
  const margin = Math.round(w * 0.025);
  const y = Math.max(0, Number.isFinite(top) ? top : 0);
  const available = Math.max(1, h - y - 24);
  const boxHeight = Math.min(available, Math.max(140, Math.round(h * 0.46)));
  return {
    x: margin,
    y,
    width: Math.max(1, w - margin * 2),
    height: boxHeight,
  };
}

/** Map a 0..1 design-space point into the drawn canvas rect. */
export function projectStrokePoint(
  rect: GenericRect,
  point: readonly [number, number],
): [number, number] {
  return [
    rect.x + clamp01(point[0]) * rect.width,
    rect.y + clamp01(point[1]) * rect.height,
  ];
}

/** Draw the 0..1 stroke set into `rect`, scaled to the render area. */
export function drawGenericStrokes(
  ctx: CanvasRenderingContext2D,
  rect: GenericRect,
  strokes: readonly GenericStroke[],
): void {
  ctx.save();
  ctx.fillStyle = DEFAULT_TEXT;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, Math.round(rect.width / 240));

  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    if (stroke.points.length === 1) {
      const [x, y] = projectStrokePoint(rect, stroke.points[0]);
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const [x, y] = projectStrokePoint(rect, point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(15,23,42,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}
