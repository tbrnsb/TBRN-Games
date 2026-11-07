/**
 * Percentile — Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Privacy: the server sends `guess`, `actual`, `delta`, `source` and `year` as
 * null until the reveal phase. This renderer only prints the fields it is
 * given, so it cannot derive an answer from the prompt.
 *
 * The right rail is the shared scoreboard, which shrinks its rows to fit all
 * eight seats without dropping anyone from the table.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground, drawBentoCard, drawScoreboard, wrapText,
} from "../../client/screen/kit/index.ts";
import { paperTitle, paperMeta } from "../../client/screen/kit/header.ts";

interface PercentileReveal {
  guess?: number;
  actual?: number;
  delta?: number;
  points?: number;
  unit?: string;
  source?: string;
  year?: number;
}

interface PercentileScreenState {
  phase: "guessing" | "betting" | "reveal" | "finished";
  round: number;
  maxRounds: number;
  question: string;
  unit: string;
  guesserName: string;
  guesserSeat?: number;
  guess: number | null;
  actual: number | null;
  delta: number | null;
  reveal: PercentileReveal | null;
  source: string | null;
  year: number | null;
  waitingOn?: string[];
  scores: Array<{ name: string; score: number; seat?: number }>;
  timerMs?: number;
  finished: boolean;
  winner: string | null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_QUESTION_LINES = 3;

/** This renderer draws its own score rail; the platform ticker stays off. */
export const showsScores = true;

export function renderPercentile(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PercentileScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const now = performance.now();

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const margin = scaledSize(48, scale);
    const headerHeight = scaledSize(64, scale);
    const gap = scaledSize(24, scale);
    const railWidth = Math.min(width * 0.26, scaledSize(360, scale));

    drawHeader(ctx, width, margin, scale, state);

    const main: Rect = {
      x: margin,
      y: margin + headerHeight,
      width: width - margin * 2 - railWidth - gap,
      height: height - margin * 2 - headerHeight,
    };
    const rail: Rect = {
      x: width - margin - railWidth,
      y: margin + headerHeight,
      width: railWidth,
      height: height - margin * 2 - headerHeight,
    };

    drawMain(ctx, main, scale, state);
    drawScores(ctx, rail, scale, state);
  } finally {
    ctx.restore();
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  margin: number,
  scale: number,
  state: PercentileScreenState,
): void {
  ctx.textBaseline = "alphabetic";
  paperTitle(ctx, scale);
  ctx.fillText("PERCENTILE", margin, margin + scaledSize(26, scale));

  ctx.textAlign = "right";
  paperMeta(ctx, scale);
  const round = Number.isFinite(state.round) ? Math.max(1, state.round) : 1;
  const total = Number.isFinite(state.maxRounds) ? Math.max(round, state.maxRounds) : round;
  ctx.fillText(`Round ${round}/${total}`, width - margin, margin + scaledSize(16, scale));
  ctx.textAlign = "left";
}

function drawMain(
  ctx: CanvasRenderingContext2D,
  main: Rect,
  scale: number,
  state: PercentileScreenState,
): void {
  const questionHeight = state.phase === "reveal"
    ? main.height * 0.36
    : main.height * 0.46;
  const questionRect = { x: main.x, y: main.y, width: main.width, height: questionHeight };
  drawQuestion(ctx, questionRect, scale, state);

  const panel: Rect = {
    x: main.x,
    y: questionRect.y + questionRect.height + scaledSize(20, scale),
    width: main.width,
    height: main.height - questionRect.height - scaledSize(20, scale),
  };

  if (state.phase === "reveal") {
    drawReveal(ctx, panel, scale, state);
    return;
  }
  if (state.phase === "finished") {
    drawFinished(ctx, panel, scale, state);
    return;
  }
  drawWaiting(ctx, panel, scale, state);
}

function drawQuestion(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  state: PercentileScreenState,
): void {
  drawBentoCard(ctx, rect, { fill: colors.surface, stroke: colors.border, glow: colors.magenta });

  const innerX = rect.x + scaledSize(28, scale);
  const innerWidth = rect.width - scaledSize(56, scale);
  const unit = typeof state.unit === "string" && state.unit.trim() ? state.unit.trim() : "";

  ctx.fillStyle = colors.cardText;
  ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.title.family}`;
  ctx.fillText(unit ? `ESTIMATE IN ${unit.toUpperCase()}` : "ESTIMATE THE STATISTIC", innerX, rect.y + scaledSize(24, scale));

  const text = typeof state.question === "string" && state.question.trim() ? state.question.trim() : "…";
  const maxSize = scaledSize(54, scale);
  const minSize = scaledSize(30, scale);
  const size = Math.max(minSize, Math.min(maxSize, rect.height * 0.16));
  ctx.fillStyle = colors.cardText;
  ctx.font = `700 ${size}px ${fonts.display.family}`;
  const lines = wrapText(ctx, text, innerWidth).slice(0, MAX_QUESTION_LINES);
  const lineHeight = size * 1.15;
  const totalHeight = lines.length * lineHeight;
  let y = rect.y + Math.max(scaledSize(62, scale), (rect.height - totalHeight) / 2);
  for (const line of lines) {
    ctx.fillText(line, innerX, y);
    y += lineHeight;
  }
}

function drawWaiting(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  state: PercentileScreenState,
): void {
  drawBentoCard(ctx, rect, { fill: colors.surfaceHi, stroke: colors.border });
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  ctx.textAlign = "center";
  if (state.phase === "guessing") {
    ctx.fillStyle = colors.cyan;
    ctx.font = `700 ${scaledSize(64, scale)}px ${fonts.display.family}`;
    ctx.fillText(state.guesserName || "Someone", centerX, centerY - scaledSize(56, scale));
    ctx.fillStyle = colors.cardMuted;
    ctx.font = `600 ${scaledSize(30, scale)}px ${fonts.body.family}`;
    ctx.fillText("is estimating...", centerX, centerY + scaledSize(24, scale));
    drawWaitingNames(ctx, rect, scale, state.waitingOn ?? []);
    return;
  }

  ctx.fillStyle = colors.amber;
  ctx.font = `700 ${scaledSize(52, scale)}px ${fonts.display.family}`;
  ctx.fillText("HIGHER OR LOWER?", centerX, centerY - scaledSize(52, scale));
  ctx.fillStyle = colors.cardMuted;
  ctx.font = `600 ${scaledSize(26, scale)}px ${fonts.body.family}`;
  ctx.fillText("The guess stays hidden until the reveal.", centerX, centerY + scaledSize(16, scale));
  drawWaitingNames(ctx, rect, scale, state.waitingOn ?? []);
}

function drawWaitingNames(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  names: readonly string[],
): void {
  const waiting = names.filter((name) => typeof name === "string" && name.trim());
  if (waiting.length === 0) return;
  const label = `Waiting on: ${waiting.join(", ")}`;
  ctx.fillStyle = colors.cardText;
  ctx.font = `600 ${scaledSize(24, scale)}px ${fonts.body.family}`;
  const maxWidth = rect.width - scaledSize(56, scale);
  ctx.fillText(trimToWidth(ctx, label, maxWidth), rect.x + rect.width / 2, rect.y + rect.height - scaledSize(44, scale));
}

function drawReveal(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  state: PercentileScreenState,
): void {
  drawBentoCard(ctx, rect, { fill: colors.surface, stroke: colors.success, glow: colors.success });
  const unit = typeof state.unit === "string" ? state.unit : "";
  const reveal = state.reveal ?? {};
  const guess = state.guess ?? reveal.guess ?? null;
  const actual = state.actual ?? reveal.actual ?? null;
  const delta = state.delta ?? reveal.delta ?? null;
  const points = typeof reveal.points === "number" ? reveal.points : null;

  const columns: Array<{ label: string; value: string; color: string }> = [
    { label: "GUESS", value: formatValue(guess, unit), color: colors.cyan },
    { label: "ACTUAL", value: formatValue(actual, unit), color: colors.success },
    { label: "OFF BY", value: formatValue(delta, unit), color: colors.amber },
  ];

  const padding = scaledSize(26, scale);
  const gap = scaledSize(18, scale);
  const columnWidth = (rect.width - padding * 2 - gap * 2) / 3;
  const boxHeight = Math.min(rect.height * 0.52, scaledSize(220, scale));

  columns.forEach((column, index) => {
    const box: Rect = {
      x: rect.x + padding + index * (columnWidth + gap),
      y: rect.y + padding,
      width: columnWidth,
      height: boxHeight,
    };
    drawBentoCard(ctx, box, { fill: colors.bg1, stroke: column.color });
    ctx.textAlign = "center";
    ctx.fillStyle = colors.cardMuted;
    ctx.font = `600 ${scaledSize(22, scale)}px ${fonts.body.family}`;
    ctx.fillText(column.label, box.x + box.width / 2, box.y + scaledSize(24, scale));
    ctx.fillStyle = column.color;
    ctx.font = `700 ${scaledSize(66, scale)}px ${fonts.display.family}`;
    ctx.fillText(column.value, box.x + box.width / 2, box.y + box.height * 0.46);
  });

  const footerY = rect.y + padding + boxHeight + scaledSize(22, scale);
  ctx.textAlign = "left";
  ctx.fillStyle = colors.cardMuted;
  ctx.font = `500 ${scaledSize(22, scale)}px ${fonts.body.family}`;
  const source = typeof reveal.source === "string" ? reveal.source : state.source;
  const year = typeof reveal.year === "number" ? reveal.year : state.year;
  const credit = source ? `${source}${year ? `, ${year}` : ""}` : "Source unavailable";
  ctx.fillText(trimToWidth(ctx, `Source: ${credit}`, rect.width - padding * 2), rect.x + padding, footerY);

  if (points !== null) {
    ctx.fillStyle = points > 0 ? colors.success : colors.cardMuted;
    ctx.font = `700 ${scaledSize(34, scale)}px ${fonts.display.family}`;
    const label = points > 0 ? `Guesser +${points}` : "Guesser scored 0";
    ctx.fillText(label, rect.x + padding, footerY + scaledSize(34, scale));
  }
  ctx.textAlign = "left";
}

function drawFinished(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  state: PercentileScreenState,
): void {
  drawBentoCard(ctx, rect, { fill: colors.surface, stroke: colors.amber, glow: colors.amber });
  ctx.textAlign = "center";
  ctx.fillStyle = colors.cardMuted;
  ctx.font = `600 ${scaledSize(28, scale)}px ${fonts.body.family}`;
  ctx.fillText("WINNER", rect.x + rect.width / 2, rect.y + rect.height * 0.24);
  ctx.fillStyle = colors.amber;
  ctx.font = `700 ${scaledSize(72, scale)}px ${fonts.display.family}`;
  ctx.fillText(
    trimToWidth(ctx, state.winner || "Nobody", rect.width - scaledSize(56, scale)),
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.4,
  );
  ctx.fillStyle = colors.cardMuted;
  ctx.font = `600 ${scaledSize(26, scale)}px ${fonts.body.family}`;
  ctx.fillText("Final scores", rect.x + rect.width / 2, rect.y + rect.height * 0.66);
  ctx.textAlign = "left";
}

function drawScores(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  state: PercentileScreenState,
): void {
  const rows = Array.isArray(state.scores) ? state.scores.filter((row) => row && typeof row.name === "string") : [];
  const entries = rows.map((row, index) => ({
    name: row.name,
    score: Number.isFinite(row.score) ? row.score : 0,
    playerIndex: index,
    isWinner: state.finished && state.winner === row.name,
  }));
  drawScoreboard(ctx, rect, entries, {
    title: "SCORES",
    scale,
    showRank: true,
  });
}

function formatValue(value: number | null, unit: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}${unit}`;
}

function trimToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}
