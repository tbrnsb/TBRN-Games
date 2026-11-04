/**
 * Bluff — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Privacy: the server only sends `answers` at reveal time. This renderer
 * shows nothing but counts during writing and voting.
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

interface BluffAnswer {
  id: string;
  text: string;
  author: string;
  votes: number;
  isReal: boolean;
}

interface BluffScreenState {
  phase: "writing" | "voting" | "reveal" | "finished";
  prompt: string | null;
  category: string | null;
  round: number;
  totalRounds: number;
  submitted: number;
  playerCount: number;
  voted: number;
  answers: BluffAnswer[];
  realAnswer: string | null;
  timeLeft: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface BluffRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastRound: number;
}

const WRITE_MS = 30000;
const VOTE_MS = 20000;
const REVEAL_MS = 6000;

function createBluffRenderState(): BluffRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastRound: 0,
  };
}

const renderState = (globalThis as any)._bluffRenderState ||= createBluffRenderState();

export function renderBluff(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BluffScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: BluffRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.phase !== rs.lastPhase || state.round !== rs.lastRound) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
      rs.lastRound = state.round;
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
    drawPhasePanel(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: BluffScreenState,
  rs: BluffRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "writing" && state.round === 1 && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "BLUFF",
      subtitle: "Write a convincing lie — then spot the truth",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.phase === "reveal") {
    triggerShake(rs.shake, 0.18, now);
    emitScoreBurst(width * 0.45, height * 0.4, 0, scaleForViewport(width, height));
  }

  if (state.finished && state.winner) {
    const entries = buildRankedEntries(state.scores, state.winner.name);
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Bluff",
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
    railW,
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
  state: BluffScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("BLUFF", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("BLUFF").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `Round ${state.round} of ${state.totalRounds}${state.category ? `  ·  ${state.category}` : ""}`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawPrompt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BluffScreenState,
  scale: number,
): void {
  const { main } = layout(width, height, scale);
  const rect = { x: main.x, y: main.y, width: main.width, height: main.height * 0.3 };
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("FILL THE BLANK", rect.x + scaledSize(24, scale), rect.y + scaledSize(26, scale));

  const text = state.prompt ?? "Waiting for the next prompt…";
  const qSize = Math.max(scaledSize(22, scale), Math.min(scaledSize(40, scale), rect.height * 0.24));
  ctx.font = `700 ${qSize}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text, rect.width - scaledSize(56, scale));
  const lh = qSize * 1.2;
  const startY = rect.y + rect.height * 0.58 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.width / 2, startY + i * lh));

  // Phase timer.
  const total = state.phase === "writing" ? WRITE_MS : state.phase === "voting" ? VOTE_MS : REVEAL_MS;
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

function drawPhasePanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BluffScreenState,
  scale: number,
  now: number,
): void {
  const { main, gap } = layout(width, height, scale);
  const top = main.y + main.height * 0.3 + gap;
  const rect = { x: main.x, y: top, width: main.width, height: main.height * 0.7 - gap };

  if (state.phase === "reveal" && state.answers.length > 0) {
    drawAnswers(ctx, rect, state, scale, now);
    return;
  }

  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.86)", stroke: colors.border });

  const writing = state.phase === "writing";
  const count = writing ? state.submitted : state.voted;
  const total = state.playerCount;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(64, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.magenta;
  ctx.fillText(`${count}/${total}`, rect.x + rect.width / 2, rect.y + rect.height * 0.4);

  ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(writing ? "answers submitted" : "votes cast", rect.x + rect.width / 2, rect.y + rect.height * 0.4 + scaledSize(52, scale));

  const progress = total > 0 ? count / total : 0;
  const barW = rect.width * 0.6;
  const barX = rect.x + (rect.width - barW) / 2;
  const barY = rect.y + rect.height * 0.62;
  drawRoundRect(ctx, barX, barY, barW, scaledSize(10, scale), scaledSize(5, scale), "rgba(255,255,255,0.08)");
  drawRoundRect(ctx, barX, barY, Math.max(scaledSize(10, scale), barW * progress), scaledSize(10, scale), scaledSize(5, scale), colors.magenta);

  ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    writing ? "Everyone is typing on their phones…" : "Pick the answer you think is real",
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.62 + scaledSize(34, scale),
  );
}

function drawAnswers(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: BluffScreenState,
  scale: number,
  now: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.97)", stroke: colors.border });

  const answers = [...state.answers].sort((a, b) => Number(b.isReal) - Number(a.isReal) || b.votes - a.votes);
  const gap = scaledSize(10, scale);
  const rowH = Math.min(
    scaledSize(110, scale),
    (rect.height - scaledSize(28, scale) - gap * (answers.length - 1)) / Math.max(1, answers.length),
  );
  const totalH = answers.length * rowH + (answers.length - 1) * gap;
  const startTop = rect.y + Math.max(scaledSize(14, scale), (rect.height - totalH) / 2);

  answers.forEach((answer, i) => {
    const y = startTop + i * (rowH + gap);
    const color = answer.isReal ? colors.success : colors.player[i % colors.player.length];

    ctx.save();
    drawRoundRect(
      ctx,
      rect.x + scaledSize(12, scale),
      y,
      rect.width - scaledSize(24, scale),
      rowH,
      scaledSize(12, scale),
      answer.isReal ? "rgba(61,255,162,0.14)" : "rgba(11,8,32,0.72)",
      answer.isReal ? colors.success : "rgba(255,255,255,0.07)",
      answer.isReal ? Math.max(1, scaledSize(2, scale)) : 1,
    );

    // Vote pips.
    const pipR = Math.max(2, scaledSize(5, scale));
    const votes = Math.min(answer.votes, 10);
    for (let v = 0; v < votes; v++) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rect.x + scaledSize(30, scale) + v * scaledSize(14, scale), y + scaledSize(18, scale), pipR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = answer.isReal ? colors.success : colors.textMuted;
    ctx.fillText(
      answer.isReal
        ? `THE REAL ANSWER  ·  ${answer.votes} ${answer.votes === 1 ? "vote" : "votes"}`
        : `${answer.author}  ·  ${answer.votes} ${answer.votes === 1 ? "vote" : "votes"}`,
      rect.x + scaledSize(30, scale),
      y + scaledSize(38, scale),
    );

    const textSize = Math.max(scaledSize(20, scale), Math.min(scaledSize(30, scale), rowH * 0.34));
    ctx.font = `600 ${textSize}px ${fonts.display.family}`;
    ctx.fillStyle = answer.isReal ? colors.text : "rgba(245,243,255,0.9)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const lines = wrap(ctx, answer.text, rect.width - scaledSize(70, scale));
    const lh = textSize * 1.15;
    const textY = y + rowH * 0.68 - ((lines.length - 1) * lh) / 2;
    lines.slice(0, 2).forEach((line, li) => ctx.fillText(line, rect.x + scaledSize(30, scale), textY + li * lh));

    if (answer.isReal) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.strokeStyle = colors.success;
      ctx.lineWidth = Math.max(1, scaledSize(2, scale));
      drawRoundRect(ctx, rect.x + scaledSize(12, scale), y, rect.width - scaledSize(24, scale), rowH, scaledSize(12, scale));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  });
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BluffScreenState,
  scale: number,
): void {
  const { rail } = layout(width, height, scale);
  const n = Math.max(1, state.scores.length);
  const listH = Math.min(rail.height, scaledSize(80, scale) + n * scaledSize(72, scale));
  const rect = { ...rail, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.magenta });

  const entries = state.scores.map((s, i) => ({
    name: s.name,
    score: s.score,
    playerIndex: i,
    isCurrent: false,
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: s.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "SCORES", scale });

  // Phase label under the rail.
  const labels: Record<string, string> = {
    writing: "Writing",
    voting: "Voting",
    reveal: "Reveal",
    finished: "Final",
  };
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
