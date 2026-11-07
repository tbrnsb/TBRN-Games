/**
 * Bracket Brawl — TV screen renderer.
 *
 * Draws the whole knockout bracket as columns of head-to-head cards, so a
 * 3-6 player table always shows every match at once. Positions are computed
 * from the bracket's own round depth; each card occupies its own cell, so the
 * layout cannot overlap at 1080p or 720p.
 *
 * Privacy: answers are only present in the screen state during voting and after
 * the duel resolves. The writing phase shows progress, never submitted text.
 */

import {
  colors,
  fonts,
  scaleForViewport,
  scaledSize,
  drawSynthwaveBackground,
  drawBentoCard,
  drawRoundRect,
  clamp,
  drawFinishVictory,
} from "../../client/screen/kit/index.ts";
import { paperTitle, paperMeta } from "../../client/screen/kit/header.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";

interface BracketScreenDuel {
  a: string;
  b: string;
  aPlayer: string | null;
  bPlayer: string | null;
  aEntry: number | null;
  bEntry: number | null;
  winner: string | null;
  winnerSide: "a" | "b" | null;
  votesA: number;
  votesB: number;
  round: number;
  isFinal: boolean;
  done: boolean;
  aSlot: number;
  bSlot: number;
}

interface BracketScreenState {
  phase: "writing" | "voting" | "reveal" | "finished";
  round: number;
  maxRounds: number;
  playerCount: number;
  submitted: number;
  prompt: string;
  duels: BracketScreenDuel[];
  currentDuel: number | null;
  reveal: { champion: number | null; votes: number } | null;
  timerMs: number;
  scores: Array<{ name: string; score: number }>;
  waitingOn?: string[];
  caption?: string | null;
  sound?: string | null;
  finished: boolean;
  winner: string | null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PHASE_MS: Record<string, number> = {
  writing: 60000,
  voting: 20000,
  reveal: 9000,
};

function layout(width: number, height: number, scale: number) {
  const margin = scaledSize(48, scale);
  const headerH = scaledSize(52, scale);
  const gap = scaledSize(18, scale);
  const promptH = scaledSize(118, scale);
  const promptY = margin + headerH;
  const bracketY = promptY + promptH + gap;
  // The shared watch overlay keeps a score ticker in the bottom-right corner.
  const reserve = scaledSize(300, scale);
  return {
    margin,
    headerH,
    gap,
    promptH,
    promptY,
    bracketY,
    bracket: {
      x: margin,
      y: bracketY,
      width: width - margin * 2,
      height: Math.max(scaledSize(160, scale), height - bracketY - reserve),
    },
  };
}

export function renderBracket(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BracketScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const now = performance.now();
  const frame = layout(width, height, scale);

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    if (drawFinishVictory(ctx, width, height, state, "Bracket Brawl", "wins")) return;
    drawHeader(ctx, width, frame, state, scale);
    drawPrompt(ctx, frame, state, scale);
    if (state.duels.length === 0) {
      drawWritingPanel(ctx, frame, state, scale, now);
    } else {
      drawBracket(ctx, width, height, state, scale, now);
    }
    drawStatus(ctx, frame, state, scale);
  } finally {
    ctx.restore();
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  frame: ReturnType<typeof layout>,
  state: BracketScreenState,
  scale: number,
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  paperTitle(ctx, scale);
  ctx.fillText("BRACKET BRAWL", frame.margin, frame.margin + scaledSize(26, scale));
  const titleWidth = ctx.measureText("BRACKET BRAWL").width;

  const rounds = state.maxRounds <= 1
    ? "One bracket"
    : `Bracket ${state.round} of ${state.maxRounds}`;
  paperMeta(ctx, scale);
  ctx.fillText(
    `${rounds}  ·  ${state.playerCount} players`,
    frame.margin + titleWidth + scaledSize(18, scale),
    frame.margin + scaledSize(25, scale),
  );

  const seconds = Math.ceil(Math.max(0, state.timerMs) / 1000);
  if (seconds > 0) {
    // A paper timer chip anchored in the header, not loose text over the page.
    const label = `${seconds}s`;
    ctx.font = `700 ${Math.max(14, scaledSize(18, scale))}px ${fonts.title.family}`;
    const tw = ctx.measureText(label).width + Math.max(22, scaledSize(28, scale));
    const th = Math.max(28, scaledSize(34, scale));
    const tx = width - frame.margin - tw;
    const ty = frame.margin + Math.max(4, scaledSize(6, scale));
    drawRoundRect(ctx, tx, ty, tw, th, th / 2, "#FBE7A1", colors.border, Math.max(2, scaledSize(2.5, scale)));
    ctx.fillStyle = seconds <= 10 ? colors.danger : colors.border;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, tx + tw / 2, ty + th / 2 + 1);
  }
}

function drawPrompt(
  ctx: CanvasRenderingContext2D,
  frame: ReturnType<typeof layout>,
  state: BracketScreenState,
  scale: number,
): void {
  const rect: Rect = {
    x: frame.margin,
    y: frame.promptY,
    width: frame.bracket.width,
    height: frame.promptH,
  };
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("PROMPT", rect.x + scaledSize(24, scale), rect.y + scaledSize(26, scale));

  const qSize = Math.max(scaledSize(24, scale), Math.min(scaledSize(40, scale), rect.height * 0.3));
  ctx.font = `700 ${qSize}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, state.prompt, rect.width - scaledSize(56, scale)).slice(0, 2);
  const lineHeight = qSize * 1.12;
  const startY = rect.y + rect.height * 0.54 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, rect.x + scaledSize(24, scale), startY + i * lineHeight));

  const total = PHASE_MS[state.phase] ?? 1;
  const progress = clamp(state.timerMs / total, 0, 1);
  const barX = rect.x + scaledSize(24, scale);
  const barY = rect.y + rect.height - scaledSize(16, scale);
  const barW = rect.width - scaledSize(48, scale);
  drawRoundRect(ctx, barX, barY, barW, scaledSize(6, scale), scaledSize(3, scale), "rgba(255,255,255,0.08)");
  drawRoundRect(
    ctx,
    barX,
    barY,
    Math.max(scaledSize(6, scale), barW * progress),
    scaledSize(6, scale),
    scaledSize(3, scale),
    progress > 0.25 ? colors.cyan : colors.danger,
  );
}

function drawWritingPanel(
  ctx: CanvasRenderingContext2D,
  frame: ReturnType<typeof layout>,
  state: BracketScreenState,
  scale: number,
  now: number,
): void {
  const rect = frame.bracket;
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.86)", stroke: colors.border });

  const total = Math.max(1, state.playerCount);
  const done = clamp(state.submitted, 0, total);
  const progress = done / total;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(62, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.cyan;
  ctx.fillText(`${done}/${total}`, rect.x + rect.width / 2, rect.y + rect.height * 0.38);

  ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("answers written", rect.x + rect.width / 2, rect.y + rect.height * 0.38 + scaledSize(50, scale));

  const barW = rect.width * 0.58;
  const barX = rect.x + (rect.width - barW) / 2;
  const barY = rect.y + rect.height * 0.62;
  drawRoundRect(ctx, barX, barY, barW, scaledSize(10, scale), scaledSize(5, scale), "rgba(255,255,255,0.08)");
  if (progress > 0) {
    drawRoundRect(ctx, barX, barY, Math.max(scaledSize(10, scale), barW * progress), scaledSize(10, scale), scaledSize(5, scale), colors.cyan);
  }

  const waiting = state.waitingOn ?? [];
  const hint = waiting.length > 0 ? `Waiting on: ${waiting.join(", ")}` : "Everyone is in — building the bracket…";
  ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  const hintLines = wrap(ctx, hint, rect.width - scaledSize(80, scale)).slice(0, 2);
  const hintY = barY + scaledSize(40, scale);
  hintLines.forEach((line, i) => ctx.fillText(line, rect.x + rect.width / 2, hintY + i * scaledSize(20, scale)));

  // A slow pulse keeps the writing screen from looking frozen.
  const pulse = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(now / 500));
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = colors.cyan;
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  drawRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, scaledSize(16, scale));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export interface BracketCardRect extends Rect {
  index: number;
  round: number;
}

/**
 * Pure card layout for the bracket display. Exported so a test can prove no two
 * match cards overlap at 1080p or 720p without a browser canvas.
 *
 * Every match gets one cell inside its round's column. Cells are equal height
 * and stacked, so overlap is impossible by construction.
 */
export function bracketCardLayout(
  width: number,
  height: number,
  duels: ReadonlyArray<Pick<BracketScreenDuel, "round">>,
): BracketCardRect[] {
  if (duels.length === 0) return [];
  const scale = scaleForViewport(width, height);
  const frame = layout(width, height, scale);
  const area = frame.bracket;
  const gap = scaledSize(16, scale);
  const statusH = scaledSize(52, scale);
  const cardsH = Math.max(scaledSize(120, scale), area.height - statusH - gap);

  const columns = Math.max(...duels.map((duel) => duel.round)) + 1;
  const colW = Math.max(
    scaledSize(120, scale),
    (area.width - gap * (columns - 1)) / Math.max(1, columns),
  );

  const rects: BracketCardRect[] = [];
  for (let round = 0; round < columns; round++) {
    const indices = duels
      .map((duel, index) => ({ duel, index }))
      .filter((entry) => entry.duel.round === round)
      .map((entry) => entry.index);
    if (indices.length === 0) continue;

    const rows = indices.length;
    const cellH = (cardsH - gap * (rows - 1)) / rows;
    const cardH = Math.max(scaledSize(64, scale), Math.min(scaledSize(170, scale), cellH));
    const totalH = rows * cardH + (rows - 1) * gap;
    const startY = area.y + Math.max(0, (cardsH - totalH) / 2);
    const x = area.x + round * (colW + gap);

    indices.forEach((index, row) => {
      rects.push({
        index,
        round,
        x,
        y: startY + row * (cardH + gap),
        width: colW,
        height: cardH,
      });
    });
  }

  return rects;
}

function drawBracket(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BracketScreenState,
  scale: number,
  now: number,
): void {
  const rects = bracketCardLayout(width, height, state.duels);
  const positions = new Map<number, Rect>();
  for (const rect of rects) positions.set(rect.index, rect);

  drawConnectors(ctx, state, positions, scale);

  state.duels.forEach((duel, index) => {
    const rect = positions.get(index);
    if (!rect) return;
    drawMatch(ctx, rect, duel, scale, now, index === state.currentDuel);
  });
}

function drawConnectors(
  ctx: CanvasRenderingContext2D,
  state: BracketScreenState,
  positions: Map<number, Rect>,
  scale: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));

  state.duels.forEach((duel, index) => {
    const target = positions.get(index);
    if (!target) return;
    for (const slot of [duel.aSlot, duel.bSlot]) {
      if (slot >= 0) continue;
      const source = positions.get(-slot - 1);
      if (!source) continue;

      const startX = source.x + source.width;
      const startY = source.y + source.height / 2;
      const endX = target.x;
      const endY = target.y + target.height / 2;
      const midX = startX + Math.max(6, (endX - startX) / 2);

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(midX, startY);
      ctx.lineTo(midX, endY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function drawMatch(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  duel: BracketScreenDuel,
  scale: number,
  now: number,
  isCurrent: boolean,
): void {
  const active = isCurrent && !duel.done;
  drawBentoCard(ctx, rect, {
    fill: active ? "rgba(0,229,255,0.12)" : "rgba(18,13,46,0.93)",
    stroke: active ? colors.cyan : colors.border,
    lineWidth: active ? Math.max(2, scaledSize(2, scale)) : 1,
  });

  const rowH = rect.height / 2;
  drawSide(ctx, rect, 0, rowH, "a", duel, scale);
  drawSide(ctx, rect, 1, rowH, "b", duel, scale);

  // Divider between the two answers.
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x + scaledSize(12, scale), rect.y + rowH);
  ctx.lineTo(rect.x + rect.width - scaledSize(12, scale), rect.y + rowH);
  ctx.stroke();

  if (active) {
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now / 260));
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = colors.cyan;
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    drawRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, scaledSize(16, scale));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawSide(
  ctx: CanvasRenderingContext2D,
  card: Rect,
  row: number,
  rowH: number,
  side: "a" | "b",
  duel: BracketScreenDuel,
  scale: number,
): void {
  const padding = scaledSize(12, scale);
  const x = card.x;
  const y = card.y + row * rowH;
  const entry = side === "a" ? duel.aEntry : duel.bEntry;
  const name = side === "a" ? duel.aPlayer : duel.bPlayer;
  const text = side === "a" ? duel.a : duel.b;
  const votes = side === "a" ? duel.votesA : duel.votesB;
  const isWinner = duel.done && duel.winnerSide === side;
  const seat = entry !== null ? seatForIndex(entry) : null;

  if (isWinner) {
    ctx.fillStyle = "rgba(61,255,162,0.10)";
    drawRoundRect(
      ctx,
      x + scaledSize(4, scale),
      y + scaledSize(4, scale),
      card.width - scaledSize(8, scale),
      rowH - scaledSize(8, scale),
      scaledSize(10, scale),
    );
    ctx.fill();
  }

  const badge = Math.max(scaledSize(20, scale), Math.min(scaledSize(32, scale), rowH * 0.46));
  const badgeX = x + padding;
  const badgeY = y + (rowH - badge) / 2;
  ctx.fillStyle = seat?.color ?? "rgba(255,255,255,0.18)";
  drawRoundRect(ctx, badgeX, badgeY, badge, badge, scaledSize(7, scale));
  ctx.fill();
  ctx.fillStyle = colors.bg0;
  ctx.font = `700 ${Math.max(scaledSize(10, scale), Math.floor(badge * 0.52))}px ${fonts.display.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(seat?.emoji ?? "?", badgeX + badge / 2, badgeY + badge / 2 + 1);

  const votesWidth = duel.done ? scaledSize(38, scale) : 0;
  const textX = badgeX + badge + scaledSize(10, scale);
  const textW = Math.max(scaledSize(24, scale), card.width - (textX - x) - padding - votesWidth);

  const nameSize = Math.max(scaledSize(12, scale), Math.min(scaledSize(18, scale), rowH * 0.24));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${nameSize}px ${fonts.display.family}`;
  ctx.fillStyle = isWinner ? colors.success : name ? colors.text : colors.textMuted;
  ctx.fillText(ellipsize(ctx, name ?? "TBD", textW), textX, y + rowH * 0.32);

  const answerSize = Math.max(scaledSize(13, scale), Math.min(scaledSize(21, scale), rowH * 0.28));
  ctx.font = `500 ${answerSize}px ${fonts.body.family}`;
  ctx.fillStyle = name ? colors.text : colors.textMuted;
  const answer = text || "Winner to be decided";
  const lines = wrap(ctx, ellipsize(ctx, answer, textW * 1.8), textW).slice(0, 2);
  const lineH = answerSize * 1.12;
  const answerY = y + rowH * 0.62 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, textX, answerY + i * lineH));

  if (duel.done) {
    ctx.textAlign = "right";
    ctx.font = `700 ${Math.max(scaledSize(12, scale), Math.min(scaledSize(18, scale), rowH * 0.24))}px ${fonts.display.family}`;
    ctx.fillStyle = isWinner ? colors.success : colors.textMuted;
    ctx.fillText(`${votes}`, card.x + card.width - padding, y + rowH / 2);
    if (isWinner) {
      ctx.font = `700 ${Math.max(scaledSize(12, scale), Math.min(scaledSize(18, scale), rowH * 0.24))}px ${fonts.display.family}`;
      ctx.fillText("✓", card.x + card.width - padding - scaledSize(22, scale), y + rowH / 2);
    }
  }
}

function drawStatus(
  ctx: CanvasRenderingContext2D,
  frame: ReturnType<typeof layout>,
  state: BracketScreenState,
  scale: number,
): void {
  const area = frame.bracket;
  const statusH = scaledSize(52, scale);
  const rect: Rect = {
    x: area.x,
    y: area.y + area.height - statusH,
    width: area.width,
    height: statusH,
  };

  let line = "";
  if (state.finished && state.winner) {
    line = `${state.winner} wins Bracket Brawl!`;
  } else if (state.phase === "reveal" && state.reveal?.champion !== null && state.reveal) {
    const champion = state.scores[state.reveal.champion]?.name;
    line = champion ? `${champion} takes the bracket!` : "";
  } else if (state.phase === "voting") {
    const current = state.currentDuel !== null ? state.duels[state.currentDuel] : null;
    line = current?.isFinal ? "The final — everybody vote!" : "Only players not in the duel vote";
  }

  if (!line) return;

  drawBentoCard(ctx, rect, {
    fill: state.finished ? "rgba(61,255,162,0.12)" : "rgba(18,13,46,0.86)",
    stroke: state.finished ? colors.success : colors.border,
  });
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(24, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = state.finished ? colors.success : colors.text;
  ctx.fillText(ellipsize(ctx, line, rect.width - scaledSize(40, scale)), rect.x + rect.width / 2, rect.y + rect.height / 2);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
