/**
 * Write & Vote — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Privacy: responses are only present in the screen state at reveal time.
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

interface WriteVoteResponse {
  text: string;
  author: string;
  votes: number;
}

interface WriteVoteScreenState {
  phase: "writing" | "voting" | "reveal" | "finished";
  prompt: string | null;
  category: string | null;
  round: number;
  totalRounds: number;
  responded: number;
  playerCount: number;
  voted: number;
  responses: WriteVoteResponse[];
  timeLeft: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface WriteVoteRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastRound: number;
}

const WRITE_MS = 45000;
const VOTE_MS = 20000;
const REVEAL_MS = 6000;

function createWriteVoteRenderState(): WriteVoteRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastRound: 0,
  };
}

const renderState = (globalThis as any)._writeVoteRenderState ||= createWriteVoteRenderState();

export function renderWritevote(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WriteVoteScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: WriteVoteRenderState = renderState;
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
  state: WriteVoteScreenState,
  rs: WriteVoteRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "writing" && state.round === 1 && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "WRITE & VOTE",
      subtitle: "Write something funny — then vote for the best",
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
        gameName: "Write & Vote",
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
  state: WriteVoteScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("WRITE & VOTE", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("WRITE & VOTE").width;

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
  state: WriteVoteScreenState,
  scale: number,
): void {
  const { main } = layout(width, height, scale);
  const rect = { x: main.x, y: main.y, width: main.width, height: main.height * 0.28 };
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("PROMPT", rect.x + scaledSize(24, scale), rect.y + scaledSize(26, scale));

  const text = state.prompt ?? "Waiting for the next prompt…";
  const qSize = Math.max(scaledSize(22, scale), Math.min(scaledSize(42, scale), rect.height * 0.26));
  ctx.font = `700 ${qSize}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text, rect.width - scaledSize(56, scale));
  const lh = qSize * 1.18;
  const startY = rect.y + rect.height * 0.6 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.width / 2, startY + i * lh));

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
  state: WriteVoteScreenState,
  scale: number,
  now: number,
): void {
  const { main, gap } = layout(width, height, scale);
  const top = main.y + main.height * 0.28 + gap;
  const rect = { x: main.x, y: top, width: main.width, height: main.height * 0.72 - gap };

  if (state.phase === "reveal" && state.responses.length > 0) {
    drawResponses(ctx, rect, state, scale, now);
    return;
  }

  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.86)", stroke: colors.border });
  const writing = state.phase === "writing";
  const count = writing ? state.responded : state.voted;
  const total = state.playerCount;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(64, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.cyan;
  ctx.fillText(`${count}/${total}`, rect.x + rect.width / 2, rect.y + rect.height * 0.4);

  ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(writing ? "responses in" : "votes cast", rect.x + rect.width / 2, rect.y + rect.height * 0.4 + scaledSize(52, scale));

  const progress = total > 0 ? count / total : 0;
  const barW = rect.width * 0.6;
  const barX = rect.x + (rect.width - barW) / 2;
  const barY = rect.y + rect.height * 0.62;
  drawRoundRect(ctx, barX, barY, barW, scaledSize(10, scale), scaledSize(5, scale), "rgba(255,255,255,0.08)");
  drawRoundRect(ctx, barX, barY, Math.max(scaledSize(10, scale), barW * progress), scaledSize(10, scale), scaledSize(5, scale), colors.cyan);

  ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    writing ? "Everyone is writing on their phones…" : "Vote for the funniest response",
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.62 + scaledSize(34, scale),
  );
}

function drawResponses(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: WriteVoteScreenState,
  scale: number,
  now: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.97)", stroke: colors.border });

  const responses = [...state.responses].sort((a, b) => b.votes - a.votes);
  const gap = scaledSize(10, scale);
  const rowH = Math.min(
    scaledSize(110, scale),
    (rect.height - scaledSize(28, scale) - gap * (responses.length - 1)) / Math.max(1, responses.length),
  );
  const totalH = responses.length * rowH + (responses.length - 1) * gap;
  const startTop = rect.y + Math.max(scaledSize(14, scale), (rect.height - totalH) / 2);
  const maxVotes = Math.max(1, ...responses.map((r) => r.votes));

  responses.forEach((response, i) => {
    const y = startTop + i * (rowH + gap);
    const color = colors.player[i % colors.player.length];
    const isTop = i === 0 && response.votes > 0;

    ctx.save();
    drawRoundRect(
      ctx,
      rect.x + scaledSize(12, scale),
      y,
      rect.width - scaledSize(24, scale),
      rowH,
      scaledSize(12, scale),
      isTop ? "rgba(0,229,255,0.10)" : "rgba(11,8,32,0.72)",
      isTop ? colors.cyan : "rgba(255,255,255,0.07)",
      isTop ? Math.max(1, scaledSize(2, scale)) : 1,
    );

    // Rank badge.
    const badge = Math.min(scaledSize(34, scale), rowH * 0.5);
    drawRoundRect(ctx, rect.x + scaledSize(22, scale), y + (rowH - badge) / 2, badge, badge, scaledSize(8, scale), isTop ? colors.cyan : color);
    ctx.fillStyle = colors.bg0;
    ctx.font = `700 ${Math.max(scaledSize(12, scale), badge * 0.45)}px ${fonts.display.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), rect.x + scaledSize(22, scale) + badge / 2, y + rowH / 2 + 1);

    // Author + votes.
    ctx.textAlign = "left";
    ctx.font = `600 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(response.author, rect.x + scaledSize(22, scale) + badge + scaledSize(12, scale), y + scaledSize(26, scale));
    ctx.textAlign = "right";
    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = isTop ? colors.cyan : colors.text;
    ctx.fillText(`${response.votes}`, rect.x + rect.width - scaledSize(24, scale), y + scaledSize(28, scale));

    // Response text.
    const textSize = Math.max(scaledSize(20, scale), Math.min(scaledSize(30, scale), rowH * 0.32));
    ctx.font = `600 ${textSize}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    const lines = wrap(ctx, response.text, rect.width - scaledSize(90, scale));
    const lh = textSize * 1.15;
    const textY = y + rowH * 0.64 - ((lines.length - 1) * lh) / 2;
    lines.slice(0, 2).forEach((line, li) => ctx.fillText(line, rect.x + scaledSize(22, scale) + badge + scaledSize(12, scale), textY + li * lh));

    // Vote bar along the bottom.
    const barW = rect.width - scaledSize(48, scale);
    const barY = y + rowH - scaledSize(8, scale);
    drawRoundRect(ctx, rect.x + scaledSize(24, scale), barY, barW, scaledSize(3, scale), scaledSize(1.5, scale), "rgba(255,255,255,0.06)");
    drawRoundRect(ctx, rect.x + scaledSize(24, scale), barY, Math.max(scaledSize(3, scale), barW * (response.votes / maxVotes)), scaledSize(3, scale), scaledSize(1.5, scale), isTop ? colors.cyan : color);

    if (isTop) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.globalAlpha = 0.2 + 0.3 * pulse;
      ctx.strokeStyle = colors.cyan;
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
  state: WriteVoteScreenState,
  scale: number,
): void {
  const { rail } = layout(width, height, scale);
  const n = Math.max(1, state.scores.length);
  const listH = Math.min(rail.height, scaledSize(80, scale) + n * scaledSize(72, scale));
  const rect = { ...rail, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.cyan });

  const entries = state.scores.map((s, i) => ({
    name: s.name,
    score: s.score,
    playerIndex: i,
    isCurrent: false,
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: s.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "SCORES", scale });

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
