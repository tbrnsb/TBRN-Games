/**
 * Mind Meld — Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * The TV shows the category while phones answer, then a reveal grid with one
 * cell per player. The grid is 2 columns at 2-4 players and 4 columns from five
 * up, so the eight-seat table gets a readable 4x2 board. Answers never reach the
 * screen before the reveal: the server only publishes `answers` in that phase.
 */

import {
  colors, fonts, scaleForViewport, scaledSize, getPlayerColor,
  drawSynthwaveBackground, drawBentoCard, wrapText,
} from "../../client/screen/kit/index.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";

interface MindMeldAnswer {
  name: string;
  answer: string;
  points: number;
  seat?: number;
}

interface MindMeldScreenState {
  phase: "collect" | "reveal" | "finished";
  round: number;
  maxRounds: number;
  category: string;
  submitted: number;
  playerCount: number;
  waitingOn?: string[];
  answers: MindMeldAnswer[];
  allMatched?: boolean;
  nearMatch?: boolean;
  scores: Array<{ name: string; score: number }>;
  timerMs?: number;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

const MAX_GRID_ROWS = 4;

/** Columns for the reveal grid: 2 up to four players, 4 from five up. */
export function mindmeldGridColumns(playerCount: number): number {
  if (!Number.isFinite(playerCount) || playerCount <= 4) return 2;
  return 4;
}

export function renderMindmeld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MindMeldScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const now = performance.now();

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const margin = scaledSize(48, scale);
    drawHeader(ctx, width, margin, scale, state);

    if (state.phase === "finished") {
      drawFinished(ctx, width, height, scale, state);
      return;
    }

    const categoryTop = margin + scaledSize(112, scale);
    drawCategory(ctx, width, categoryTop, scale, state);

    if (state.phase === "reveal") {
      drawRevealGrid(ctx, width, height, scale, state);
    } else {
      drawCollectStatus(ctx, width, height, scale, state);
    }
  } finally {
    ctx.restore();
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  margin: number,
  scale: number,
  state: MindMeldScreenState,
): void {
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${scaledSize(58, scale)}px ${fonts.display.family}`;
  ctx.fillText("Mind Meld", margin, margin);

  ctx.textAlign = "right";
  ctx.fillStyle = colors.textMuted;
  ctx.font = `600 ${scaledSize(30, scale)}px ${fonts.body.family}`;
  const round = Number.isFinite(state.round) ? Math.max(1, state.round) : 1;
  const total = Number.isFinite(state.maxRounds) ? Math.max(round, state.maxRounds) : round;
  ctx.fillText(`Round ${round}/${total}`, width - margin, margin + scaledSize(14, scale));
  ctx.textAlign = "left";
}

function drawCategory(
  ctx: CanvasRenderingContext2D,
  width: number,
  top: number,
  scale: number,
  state: MindMeldScreenState,
): void {
  const margin = scaledSize(48, scale);
  const card = { x: margin, y: top, width: width - margin * 2, height: scaledSize(150, scale) };
  drawBentoCard(ctx, card, { fill: colors.surface, stroke: colors.border, glow: colors.magenta });

  ctx.fillStyle = colors.textMuted;
  ctx.font = `600 ${scaledSize(24, scale)}px ${fonts.body.family}`;
  ctx.fillText("ONE WORD EACH", card.x + scaledSize(28, scale), card.y + scaledSize(22, scale));

  const text = state.category || "…";
  ctx.fillStyle = colors.text;
  ctx.font = `700 ${scaledSize(56, scale)}px ${fonts.display.family}`;
  const lines = wrapText(ctx, text, card.width - scaledSize(56, scale)).slice(0, 2);
  lines.forEach((line, index) => {
    ctx.fillText(line, card.x + scaledSize(28, scale), card.y + scaledSize(58, scale) + index * scaledSize(60, scale));
  });
}

function drawCollectStatus(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  state: MindMeldScreenState,
): void {
  const total = Math.max(1, state.playerCount || 0);
  const submitted = Math.min(total, Math.max(0, state.submitted || 0));
  const centerX = width / 2;
  const top = height * 0.48;

  ctx.textAlign = "center";
  ctx.fillStyle = colors.cyan;
  ctx.font = `700 ${scaledSize(120, scale)}px ${fonts.display.family}`;
  ctx.fillText(`${submitted}/${total}`, centerX, top);

  ctx.fillStyle = colors.textMuted;
  ctx.font = `600 ${scaledSize(30, scale)}px ${fonts.body.family}`;
  const waiting = (state.waitingOn ?? []).filter((name) => typeof name === "string" && name.trim());
  const label = waiting.length > 0 ? `Waiting on ${waiting.join(", ")}` : "Everyone is in — reveal!";
  ctx.fillText(trim(ctx, label, width - scaledSize(96, scale)), centerX, top + scaledSize(140, scale));

  if (typeof state.timerMs === "number" && state.timerMs > 0) {
    ctx.fillStyle = colors.amber;
    ctx.font = `600 ${scaledSize(28, scale)}px ${fonts.body.family}`;
    ctx.fillText(`${Math.ceil(state.timerMs / 1000)}s`, centerX, top + scaledSize(190, scale));
  }
  ctx.textAlign = "left";
}

function drawRevealGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  state: MindMeldScreenState,
): void {
  const rows = Array.isArray(state.answers) ? state.answers.filter(Boolean) : [];
  if (rows.length === 0) return;

  const margin = scaledSize(48, scale);
  const columns = mindmeldGridColumns(rows.length);
  const stateRows = Math.min(MAX_GRID_ROWS, Math.ceil(rows.length / columns));
  const gap = scaledSize(16, scale);
  const gridTop = margin + scaledSize(294, scale);
  const cellWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (height - gridTop - margin - gap * (stateRows - 1)) / stateRows;

  rows.forEach((row, index) => {
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    if (rowIndex >= MAX_GRID_ROWS) return;
    const x = margin + column * (cellWidth + gap);
    const y = gridTop + rowIndex * (cellHeight + gap);
    drawAnswerCard(ctx, { x, y, width: cellWidth, height: cellHeight }, scale, row, index);
  });
}

function drawAnswerCard(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  scale: number,
  row: MindMeldAnswer,
  index: number,
): void {
  const seat = seatForIndex(Number.isFinite(row.seat) ? Number(row.seat) : index);
  const color = getPlayerColor(index);
  const scored = Number.isFinite(row.points) && row.points > 0;
  drawBentoCard(ctx, rect, {
    fill: scored ? colors.surfaceHi : colors.surface,
    stroke: scored ? colors.success : colors.border,
    glow: scored ? colors.success : undefined,
  });

  // Seat badge: colour + glyph, never colour alone.
  const badge = scaledSize(30, scale);
  ctx.fillStyle = seat.color;
  ctx.fillRect(rect.x + scaledSize(18, scale), rect.y + scaledSize(18, scale), badge, badge);
  ctx.fillStyle = colors.bg0;
  ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillText(seat.emoji, rect.x + scaledSize(20, scale), rect.y + scaledSize(20, scale));

  const innerX = rect.x + scaledSize(18, scale);
  const innerWidth = rect.width - scaledSize(36, scale);

  ctx.fillStyle = colors.textMuted;
  ctx.font = `600 ${scaledSize(22, scale)}px ${fonts.body.family}`;
  ctx.fillText(trim(ctx, row.name || `Player ${index + 1}`, innerWidth), innerX, rect.y + scaledSize(58, scale));

  const answer = (row.answer || "—").trim();
  ctx.fillStyle = scored ? color : colors.text;
  ctx.font = `700 ${scaledSize(40, scale)}px ${fonts.display.family}`;
  const lines = wrapText(ctx, answer, innerWidth).slice(0, 2);
  const answerTop = rect.y + rect.height * 0.42;
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, innerX, answerTop + lineIndex * scaledSize(44, scale));
  });

  if (scored) {
    ctx.fillStyle = colors.success;
    ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.display.family}`;
    ctx.fillText(`+${Math.round(row.points)}`, innerX, rect.y + rect.height - scaledSize(48, scale));
  }
}

function drawFinished(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  state: MindMeldScreenState,
): void {
  const scores = Array.isArray(state.scores) ? state.scores.filter((row) => row && typeof row.name === "string") : [];
  const winner = state.winner;
  const centerX = width / 2;
  const panelWidth = Math.min(width - scaledSize(160, scale), scaledSize(1000, scale));
  const rowTop = scaledSize(130, scale);
  const panelHeight = Math.min(
    height * 0.62,
    rowTop + scores.length * scaledSize(46, scale),
  );
  const panel = {
    x: centerX - panelWidth / 2,
    y: height * 0.3,
    width: panelWidth,
    height: panelHeight,
  };
  drawBentoCard(ctx, panel, { fill: colors.surface, stroke: colors.amber, glow: colors.amber });

  ctx.textAlign = "center";
  ctx.fillStyle = colors.amber;
  ctx.font = `700 ${scaledSize(64, scale)}px ${fonts.display.family}`;
  ctx.fillText(winner?.name ? `${winner.name} wins!` : "Game over!", centerX, panel.y + scaledSize(28, scale));

  ctx.fillStyle = colors.text;
  ctx.font = `600 ${scaledSize(30, scale)}px ${fonts.body.family}`;
  const top = panel.y + rowTop;
  const ranked = [...scores].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 8);
  const rowHeight = Math.min(
    scaledSize(46, scale),
    (panel.height - rowTop) / Math.max(1, ranked.length),
  );
  ranked.forEach((row, index) => {
    const score = Number.isFinite(row.score) ? row.score : 0;
    ctx.textAlign = "left";
    ctx.fillText(trim(ctx, row.name, panel.width - scaledSize(220, scale)), panel.x + scaledSize(40, scale), top + index * rowHeight);
    ctx.textAlign = "right";
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(`${score}`, panel.x + panel.width - scaledSize(40, scale), top + index * rowHeight);
    ctx.fillStyle = colors.text;
  });
  ctx.textAlign = "left";
}

/** Clip one line to the available width with an ellipsis. */
function trim(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}
