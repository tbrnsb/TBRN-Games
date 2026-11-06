/**
 * Bento Grid Layout — 12-column grid with 24px gap, 48px outer margin
 * Helpers for laying out cards, scoreboard, and play area.
 */

import { bento, radius, colors, scaleForViewport, scaledSize, getPlayerColor } from "./theme.ts";

export interface BentoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BentoGrid {
  cols: number;
  gap: number;
  margin: number;
  contentWidth: number;
  contentHeight: number;
  colWidth: number;
  rowHeight: number; // set by caller based on content
}

export function createBentoGrid(width: number, height: number, rowHeight?: number): BentoGrid {
  const scale = scaleForViewport(width, height);
  const margin = scaledSize(bento.outerMargin, scale);
  const gap = scaledSize(bento.gap, scale);
  const contentWidth = width - margin * 2;
  const contentHeight = height - margin * 2;
  const colWidth = (contentWidth - gap * (bento.columns - 1)) / bento.columns;
  const rowHeightFinal = rowHeight ?? scaledSize(120, scale); // default row height

  return {
    cols: bento.columns,
    gap,
    margin,
    contentWidth,
    contentHeight,
    colWidth,
    rowHeight: rowHeightFinal,
  };
}

export function gridRect(grid: BentoGrid, colStart: number, colSpan: number, rowStart: number, rowSpan: number): BentoRect {
  const x = grid.margin + colStart * (grid.colWidth + grid.gap);
  const y = grid.margin + rowStart * (grid.rowHeight + grid.gap);
  const width = colSpan * grid.colWidth + (colSpan - 1) * grid.gap;
  const height = rowSpan * grid.rowHeight + (rowSpan - 1) * grid.gap;
  return { x, y, width, height };
}

// --- Card Rendering ---
export interface CardOptions {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  radius?: number;
  glow?: string; // accent color for active glow
  padding?: number;
}

export function drawBentoCard(
  ctx: CanvasRenderingContext2D,
  rect: BentoRect,
  options: CardOptions = {}
): void {
  const {
    lineWidth = 3,
    radius: r = radius.card,
    padding = 0,
  } = options;

  const x = rect.x + padding;
  const y = rect.y + padding;
  const w = rect.width - padding * 2;
  const h = rect.height - padding * 2;

  ctx.save();

  // Hard offset shadow; no blur, no glow.
  ctx.shadowColor = colors.border;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 6;

  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = colors.bg0;
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Tape corner, one of the three handmade details on every game screen.
  ctx.save();
  ctx.translate(x + 18, y - 8);
  ctx.rotate(-0.05);
  ctx.fillStyle = "#E9D7A8";
  ctx.globalAlpha = 0.9;
  ctx.fillRect(0, 0, Math.min(120, w * 0.28), 20);
  ctx.restore();

  ctx.restore();
}

export function drawBentoCardContent(
  ctx: CanvasRenderingContext2D,
  rect: BentoRect,
  render: (innerRect: BentoRect) => void,
  padding: number = scaledSize(16, 1) // default 16px, caller should scale
): void {
  const innerRect: BentoRect = {
    x: rect.x + padding,
    y: rect.y + padding,
    width: rect.width - padding * 2,
    height: rect.height - padding * 2,
  };
  render(innerRect);
}

// --- Scoreboard Helpers ---
export interface ScoreEntry {
  name: string;
  score: number;
  playerIndex: number;
  isCurrent?: boolean;
  isWinner?: boolean;
  animatedScore?: number; // for count-up animation
}

export interface ScoreboardOptions {
  title?: string;
  titleFont?: string;
  entryFont?: string;
  scoreFont?: string;
  showRank?: boolean;
  /** Viewport scale from scaleForViewport(); keeps padding and rows proportional. */
  scale?: number;
}

export function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  rect: BentoRect,
  entries: ScoreEntry[],
  options: ScoreboardOptions = {}
): void {
  const { title, titleFont, entryFont, scoreFont, showRank = true, scale = 1 } = options;
  const padding = scaledSize(20, scale);

  ctx.save();
  ctx.fillStyle = "#FFFDF5";
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scale * 3);
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius.card);
  ctx.fill();
  ctx.stroke();
  ctx.clip();

  let y = rect.y + padding;

  // Title
  if (title) {
    ctx.font = titleFont ?? `700 ${scaledSize(22, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = colors.cardText;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, rect.x + padding, y + scaledSize(20, scale));
    y += scaledSize(40, scale);
  }

  if (entries.length === 0) {
    ctx.restore();
    return;
  }

  // Fit every entry into the remaining space instead of overflowing the card.
  const gap = scaledSize(8, scale);
  const available = rect.y + rect.height - padding - y;
  const maxEntry = scaledSize(76, scale);
  const minEntry = scaledSize(36, scale);
  const entryHeight = Math.max(
    minEntry,
    Math.min(maxEntry, (available - gap * (entries.length - 1)) / entries.length),
  );

  const nameSize = Math.max(scaledSize(16, scale), Math.min(scaledSize(26, scale), entryHeight * 0.34));
  const scoreSize = Math.max(scaledSize(26, scale), Math.min(scaledSize(42, scale), entryHeight * 0.56));
  const badgeSize = Math.max(scaledSize(24, scale), Math.min(scaledSize(34, scale), entryHeight * 0.64));

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const color = getPlayerColor(entry.playerIndex);
    const entryY = y + i * (entryHeight + gap);
    const entryRect = {
      x: rect.x + padding,
      y: entryY,
      width: rect.width - padding * 2,
      height: entryHeight,
    };

    // Highlight current player / winner.
    if (entry.isCurrent || entry.isWinner) {
      roundRect(ctx, entryRect.x, entryRect.y, entryRect.width, entryRect.height, radius.chip);
      ctx.fillStyle = entry.isWinner ? colors.amber : "#FBE7A1";
      ctx.fill();
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Rank badge (number, not colour alone).
    const badgeX = entryRect.x + scaledSize(4, scale);
    const badgeY = entryRect.y + (entryRect.height - badgeSize) / 2;
    if (showRank) {
      ctx.fillStyle = color;
      roundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, radius.chip);
      ctx.fill();
      ctx.font = `700 ${Math.max(scaledSize(10, scale), badgeSize * 0.44)}px ${fonts.display.family}`;
      ctx.fillStyle = "#FFF7E8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 1);
    }

    // Name, truncated to the space left before the score.
    const nameX = showRank ? entryRect.x + badgeSize + scaledSize(14, scale) : entryRect.x + scaledSize(4, scale);
    const scoreText = String(entry.animatedScore ?? entry.score);
    ctx.font = scoreFont ?? `700 ${scoreSize}px ${fonts.display.family}`;
    const scoreWidth = ctx.measureText(scoreText).width;
    const nameMax = entryRect.x + entryRect.width - scaledSize(8, scale) - scoreWidth - scaledSize(12, scale);

    ctx.font = entryFont ?? `500 ${nameSize}px ${fonts.display.family}`;
    ctx.fillStyle = colors.cardText;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      ellipsize(ctx, entry.name, Math.max(scaledSize(20, scale), nameMax - nameX)),
      nameX,
      entryRect.y + entryRect.height / 2,
    );

    // Score (animated).
    ctx.font = scoreFont ?? `700 ${scoreSize}px ${fonts.display.family}`;
    ctx.fillStyle = entry.isWinner ? colors.danger : colors.cardText;
    ctx.textAlign = "right";
    ctx.fillText(scoreText, entryRect.x + entryRect.width - scaledSize(6, scale), entryRect.y + entryRect.height / 2);
  }

  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

// --- Round Rect Helper ---
export function roundRect(
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

// Re-export fonts for convenience
import { fonts } from "./theme.ts";