/**
 * Most Likely To — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Privacy: the server only sends vote counts during the reveal phase.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, clamp,
} from "../../client/screen/kit/index.ts";
import { paperTitle, paperMeta } from "../../client/screen/kit/header.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";

interface MostLikelyScreenState {
  prompt: string;
  currentPrompt: number;
  totalPrompts: number;
  phase: "voting" | "tally" | "reveal" | "finished";
  timeLeft: number;
  players: Array<{ name: string; score: number }>;
  votes: Array<{ name: string; count: number; seat: number; won: boolean }> | null;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface MostLikelyRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastPrompt: number;
}

const VOTE_MS = 15000;
const TALLY_MS = 2000;
const REVEAL_MS = 4000;

function createMostLikelyRenderState(): MostLikelyRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastPrompt: 0,
  };
}

const renderState = (globalThis as any)._mostLikelyRenderState ||= createMostLikelyRenderState();

/** This renderer draws its own score rail; the platform ticker stays off. */
export const showsScores = true;

export function renderMostlikely(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MostLikelyScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: MostLikelyRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.phase !== rs.lastPhase || state.currentPrompt !== rs.lastPrompt) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
      rs.lastPrompt = state.currentPrompt;
    }
    if (!state.finished && rs.victoryScreen) rs.victoryScreen = null;
    // The title card belongs to one game: drop it when the game ends so the
    // next game in the same room gets its own.
    if (state.finished) rs.titleCard = null;

    if (rs.titleCard) updateTitleCard(rs.titleCard, now);
    if (rs.victoryScreen) updateVictoryScreen(rs.victoryScreen, now, dt);

    if (state.finished && rs.victoryScreen) {
      drawVictoryScreen(ctx, width, height, rs.victoryScreen);
      return;
    }
    if (rs.titleCard && !isTitleCardDone(rs.titleCard)) {
      drawTitleCard(ctx, width, height, rs.titleCard);
      return;
    }

    drawHeader(ctx, width, height, state, scale);
    drawPrompt(ctx, width, height, state, scale);
    drawBody(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: MostLikelyScreenState,
  rs: MostLikelyRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "voting" && state.currentPrompt === 1 && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "MOST LIKELY TO",
      subtitle: "Vote anonymously — the table decides",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.phase === "reveal") {
    emitScoreBurst(width * 0.45, height * 0.45, 0, scaleForViewport(width, height));
    triggerShake(rs.shake, 0.15, now);
  }

  if (state.finished && state.winner) {
    const entries = buildRankedEntries(state.players, state.winner.name);
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Most Likely To",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function layout(width: number, height: number, scale: number) {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const headerH = scaledSize(56, scale);
  return {
    margin,
    gap,
    main: {
      x: margin,
      y: margin + headerH,
      width: width - margin * 2 - railW - gap,
      height: height - margin * 2 - headerH,
    },
    rail: { x: width - margin - railW, y: margin, width: railW, height: height - margin * 2 },
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MostLikelyScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  paperTitle(ctx, scale);
  ctx.fillText("MOST LIKELY TO", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("MOST LIKELY TO").width;

  paperMeta(ctx, scale);
  ctx.fillText(
    `Prompt ${state.currentPrompt} of ${state.totalPrompts}`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawPrompt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MostLikelyScreenState,
  scale: number,
): void {
  const { main } = layout(width, height, scale);
  const rect = { x: main.x, y: main.y, width: main.width, height: main.height * 0.34 };
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(13, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.magenta;
  ctx.fillText("WHO IS…", rect.x + rect.width / 2, rect.y + scaledSize(28, scale));

  const size = Math.max(scaledSize(24, scale), Math.min(scaledSize(44, scale), rect.height * 0.3));
  ctx.font = `700 ${size}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  const lines = wrap(ctx, state.prompt, rect.width - scaledSize(60, scale));
  const lh = size * 1.15;
  const startY = rect.y + rect.height * 0.56 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.width / 2, startY + i * lh));

  const total = state.phase === "voting" ? VOTE_MS : state.phase === "tally" ? TALLY_MS : REVEAL_MS;
  const progress = clamp(state.timeLeft / total, 0, 1);
  const barY = rect.y + rect.height - scaledSize(18, scale);
  drawRoundRect(ctx, rect.x + scaledSize(24, scale), barY, rect.width - scaledSize(48, scale), scaledSize(6, scale), scaledSize(3, scale), "rgba(255,255,255,0.08)");
  drawRoundRect(
    ctx,
    rect.x + scaledSize(24, scale),
    barY,
    Math.max(scaledSize(6, scale), (rect.width - scaledSize(48, scale)) * progress),
    scaledSize(6, scale),
    scaledSize(3, scale),
    progress > 0.3 ? colors.cyan : colors.danger,
  );
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MostLikelyScreenState,
  scale: number,
  now: number,
): void {
  const { main, gap } = layout(width, height, scale);
  const top = main.y + main.height * 0.34 + gap;
  const rect = { x: main.x, y: top, width: main.width, height: main.height * 0.66 - gap };
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.97)", stroke: colors.border });

  if (state.phase === "tally") {
    drawTally(ctx, rect, state, scale, now);
    return;
  }

  if (state.phase === "reveal" && state.votes) {
    drawVoteChart(ctx, rect, state, scale);
    return;
  }

  // Voting: no per-player progress is exposed, so keep it atmospheric.
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(34, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("Voting is open", rect.x + rect.width / 2, rect.y + rect.height * 0.36);

  ctx.globalAlpha = 0.4 + 0.6 * pulse;
  ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("Pick a name on your phone", rect.x + rect.width / 2, rect.y + rect.height * 0.36 + scaledSize(34, scale));
  ctx.globalAlpha = 1;

  // Player chips. Every seat keeps its platform colour and glyph.
  const chips = state.players;
  const chipLabels = chips.map((p, i) => `${seatForIndex(i).emoji} ${p.name}`);
  const chipH = scaledSize(34, scale);
  const gapChip = scaledSize(10, scale);
  ctx.font = `600 ${scaledSize(14, scale)}px ${fonts.display.family}`;
  const widths = chipLabels.map((label) => ctx.measureText(label).width + scaledSize(28, scale));
  const totalW = widths.reduce((a, b) => a + b, 0) + gapChip * Math.max(0, chips.length - 1);
  let x = rect.x + rect.width / 2 - totalW / 2;
  const y = rect.y + rect.height * 0.58;
  chips.forEach((_p, i) => {
    const seat = seatForIndex(i);
    const w = widths[i];
    drawRoundRect(ctx, x, y, w, chipH, chipH / 2, "rgba(11,8,32,0.65)", seat.color, 1);
    ctx.fillStyle = seat.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chipLabels[i], x + w / 2, y + chipH / 2);
    x += w + gapChip;
  });
}

/** Drum-roll beat: every seat badge pulses while the votes are being counted. */
function drawTally(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: MostLikelyScreenState,
  scale: number,
  now: number,
): void {
  const centreX = rect.x + rect.width / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(42, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("Tallying the votes…", centreX, rect.y + rect.height * 0.4);

  const dots = ".".repeat(1 + (Math.floor(now / 240) % 3));
  ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.magenta;
  ctx.fillText(`Drum roll${dots}`, centreX, rect.y + rect.height * 0.4 + scaledSize(46, scale));

  // All seat badges, lit in sequence like a drum roll across the table.
  const count = state.players.length;
  const badge = scaledSize(58, scale);
  const gap = scaledSize(16, scale);
  const totalW = count * badge + Math.max(0, count - 1) * gap;
  let x = centreX - totalW / 2;
  const y = rect.y + rect.height * 0.66;
  const lit = Math.floor(now / 170) % Math.max(1, count);
  state.players.forEach((_player, i) => {
    const seat = seatForIndex(i);
    const active = i === lit;
    ctx.globalAlpha = active ? 1 : 0.35;
    drawRoundRect(
      ctx,
      x,
      y,
      badge,
      badge,
      scaledSize(14, scale),
      seat.color,
      active ? colors.text : undefined,
      active ? 3 : 1,
    );
    ctx.fillStyle = colors.bg0;
    ctx.font = `700 ${scaledSize(24, scale)}px ${fonts.display.family}`;
    ctx.fillText(seat.emoji, x + badge / 2, y + badge / 2 + 1);
    ctx.globalAlpha = 1;
    x += badge + gap;
  });
}

function drawVoteChart(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: MostLikelyScreenState,
  scale: number,
): void {
  // Every seat stays on the board, including zero-vote seats, so all eight
  // badges are visible when the room is full.
  const votes = state.votes ?? [];
  if (votes.length === 0) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("No votes this round", rect.x + rect.width / 2, rect.y + rect.height / 2);
    return;
  }
  if (votes.every((vote) => vote.count === 0)) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("Nobody voted this round", rect.x + rect.width / 2, rect.y + rect.height / 2);
    return;
  }

  const max = Math.max(1, ...votes.map((v) => v.count));
  const gap = scaledSize(10, scale);
  const rowH = Math.min(
    scaledSize(88, scale),
    (rect.height - scaledSize(64, scale) - gap * (votes.length - 1)) / votes.length,
  );
  const totalH = votes.length * rowH + (votes.length - 1) * gap;
  const startTop = rect.y + scaledSize(48, scale) + Math.max(0, (rect.height - scaledSize(64, scale) - totalH) / 2);
  const elapsed = Math.max(0, REVEAL_MS - state.timeLeft);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${scaledSize(14, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("VOTES", rect.x + scaledSize(24, scale), rect.y + scaledSize(24, scale));

  const badgeSize = Math.min(rowH * 0.62, scaledSize(44, scale));
  votes.forEach((vote, i) => {
    // Rows flip in one at a time: the drum roll resolves into the result.
    const revealAt = i * 140;
    if (elapsed < revealAt) return;
    const grow = clamp((elapsed - revealAt) / 260, 0, 1);

    const y = startTop + i * (rowH + gap);
    const seat = seatForIndex(vote.seat);
    const color = vote.won ? colors.success : seat.color;
    const badgeY = y + rowH * 0.28 - badgeSize / 2;
    const badgeX = rect.x + scaledSize(24, scale);

    ctx.fillStyle = seat.color;
    drawRoundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, scaledSize(9, scale), seat.color);
    ctx.fillStyle = colors.bg0;
    ctx.font = `700 ${Math.max(10, Math.floor(badgeSize * 0.52))}px ${fonts.display.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(seat.emoji, badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 1);

    const nameX = badgeX + badgeSize + scaledSize(12, scale);
    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(vote.name, nameX, y + rowH * 0.28);

    ctx.textAlign = "right";
    ctx.fillStyle = color;
    ctx.fillText(vote.won ? `${vote.count}  WIN` : `${vote.count}`, rect.x + rect.width - scaledSize(24, scale), y + rowH * 0.28);

    const barY = y + rowH * 0.58;
    const barW = rect.width - scaledSize(48, scale);
    const bh = scaledSize(12, scale);
    drawRoundRect(ctx, rect.x + scaledSize(24, scale), barY, barW, bh, bh / 2, "rgba(255,255,255,0.06)");
    const fillW = vote.count === 0 ? 0 : Math.max(bh, barW * (vote.count / max) * grow);
    if (fillW > 0) {
      drawRoundRect(
        ctx,
        rect.x + scaledSize(24, scale),
        barY,
        fillW,
        bh,
        bh / 2,
        color,
      );
    }
  });
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MostLikelyScreenState,
  scale: number,
): void {
  const { rail } = layout(width, height, scale);
  const n = Math.max(1, state.players.length);
  const listH = Math.min(rail.height, scaledSize(80, scale) + n * scaledSize(72, scale));
  const rect = { ...rail, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.magenta });

  const entries = state.players.map((p, i) => ({
    name: p.name,
    score: p.score,
    playerIndex: i,
    isCurrent: false,
    isWinner: state.finished && state.winner?.name === p.name,
    animatedScore: p.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "SCORES", scale });

  const labels: Record<string, string> = { voting: "Voting", tally: "Tally", reveal: "Reveal", finished: "Final" };
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(labels[state.phase] ?? "", rail.x + scaledSize(4, scale), rect.y + rect.height + scaledSize(18, scale));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
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
