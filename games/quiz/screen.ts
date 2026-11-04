/**
 * Quiz — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 */

import {
  // Theme
  colors, fonts, scaleForViewport, scaledSize,
  // Background
  drawSynthwaveBackground,
  // Bento
  drawBentoCard, drawScoreboard,
  // Scoreboard
  ScoreManager,
  // Particles
  emitScoreBurst, updateParticles, drawParticles,
  // Shake
  createShake, triggerShake, applyShakeTransform,
  // Title Card
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createCountdownCard, startCountdown, updateCountdown, drawCountdown,
  // Victory
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  // Utils
  drawRoundRect,
} from "../../client/screen/kit/index.ts";

interface QuizScreenState {
  phase: "waiting" | "question" | "reveal" | "finished";
  question: { text: string; options: Array<{ id: string; label: string }>; correct: string | null } | null;
  currentQuestion: number;
  totalQuestions: number;
  timeLeft: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface RenderState {
  lastFrameTime: number;
  scoreManager: ScoreManager;
  titleCard: ReturnType<typeof createTitleCard> | null;
  countdownCard: ReturnType<typeof createCountdownCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastPhase: string;
  lastScores: number[];
}

const QUESTION_TIME_MS = 15000;

function createRenderState(): RenderState {
  return {
    lastFrameTime: 0,
    scoreManager: new ScoreManager(),
    titleCard: null,
    countdownCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastPhase: "",
    lastScores: [],
  };
}

const renderState = (globalThis as any)._quizRenderState ||= createRenderState();

export function renderQuiz(ctx: CanvasRenderingContext2D, width: number, height: number, state: QuizScreenState): void {
  const scale = scaleForViewport(width, height);
  const rs: RenderState = renderState;
  const now = performance.now();
  const dt = rs.lastFrameTime ? Math.min(now - rs.lastFrameTime, 100) : 16;
  rs.lastFrameTime = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    updateScores(state, rs, now, dt, width, height, scale);

    // One-time transitions, keyed on phase.
    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
    }
    // A new game after a finished one.
    if (!state.finished && rs.victoryScreen) rs.victoryScreen = null;

    // Always advance the cards; this is what was missing before.
    if (rs.titleCard) updateTitleCard(rs.titleCard, now);
    if (rs.countdownCard) updateCountdown(rs.countdownCard, now);
    if (rs.victoryScreen) updateVictoryScreen(rs.victoryScreen, now, dt);

    if (state.finished && rs.victoryScreen) {
      drawVictoryScreen(ctx, width, height, rs.victoryScreen);
      return;
    }

    if (rs.titleCard && !isTitleCardDone(rs.titleCard)) {
      drawTitleCard(ctx, width, height, rs.titleCard);
      return;
    }

    if (!state.question) {
      drawWaiting(ctx, width, height, scale, now);
      return;
    }

    renderQuestion(ctx, width, height, state, rs, scale, now);
    renderScoreboard(ctx, width, height, state, rs, scale);
    renderTimer(ctx, width, height, state, scale);

    if (rs.countdownCard && rs.countdownCard.state !== "done") {
      drawCountdown(ctx, width, height, rs.countdownCard);
    }

    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function updateScores(
  state: QuizScreenState,
  rs: RenderState,
  now: number,
  dt: number,
  width: number,
  height: number,
  scale: number,
): void {
  state.scores.forEach((s, i) => {
    const prev = rs.lastScores[i];
    if (prev !== s.score) {
      rs.scoreManager.setScore(i, s.score, 600);
      if (prev !== undefined && s.score > prev) {
        emitScoreBurst(width * 0.5, height * 0.35, i, scale);
        triggerShake(rs.shake, 0.25, now);
      }
      rs.lastScores[i] = s.score;
    }
  });
  rs.scoreManager.update(now);
  void dt;
}

function handlePhaseChange(
  state: QuizScreenState,
  rs: RenderState,
  now: number,
  width: number,
  height: number,
): void {
  switch (state.phase) {
    case "waiting":
      rs.titleCard = createTitleCard({
        title: "QUIZ",
        subtitle: "Get ready…",
        duration: 2200,
        fadeInDuration: 450,
        holdDuration: 1200,
        fadeOutDuration: 550,
      });
      showTitleCard(rs.titleCard, now);
      break;
    case "question":
      // Countdown only when coming out of a reveal, not on the very first question.
      if (rs.lastPhase === "reveal") {
        rs.countdownCard = createCountdownCard(3, 420);
        startCountdown(rs.countdownCard, now);
      }
      break;
    case "finished":
      if (state.winner) {
        const rankings = buildRankedEntries(state.scores, state.winner.name);
        const winner = rankings.find((r) => r.isWinner) ?? rankings[0];
        if (winner) {
          rs.victoryScreen = createVictoryScreen({
            winner,
            rankings,
            gameName: "Quiz",
            duration: 0,
          });
          showVictoryScreen(rs.victoryScreen, now, width, height);
          triggerShake(rs.shake, 0.5, now);
        }
      }
      break;
    default:
      break;
  }
}

function renderQuestion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: QuizScreenState,
  rs: RenderState,
  scale: number,
  now: number,
): void {
  const { question, currentQuestion, totalQuestions } = state;
  if (!question) return;

  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const scoreWidth = Math.min(width * 0.28, scaledSize(400, scale));
  const mainWidth = width - margin * 2 - gap - scoreWidth;

  // Eyebrow: game name + question progress. Sentence case, not tracked caps.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(30, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("QUIZ", margin, margin + scaledSize(28, scale));

  ctx.font = `600 ${scaledSize(22, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `Question ${currentQuestion} of ${totalQuestions}`,
    margin + scaledSize(120, scale),
    margin + scaledSize(26, scale),
  );

  // Question card
  const cardY = margin + scaledSize(64, scale);
  const cardH = height * 0.26;
  const cardRect = { x: margin, y: cardY, width: mainWidth, height: cardH };
  drawBentoCard(ctx, cardRect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  const qSize = Math.max(scaledSize(26, scale), Math.min(scaledSize(46, scale), cardH * 0.3));
  ctx.font = `700 ${qSize}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textY = cardY + cardH / 2;
  const wrapped = wrapToWidth(ctx, question.text, mainWidth - scaledSize(64, scale));
  const lineHeight = qSize * 1.18;
  const startY = textY - ((wrapped.length - 1) * lineHeight) / 2;
  wrapped.forEach((line, i) => ctx.fillText(line, margin + mainWidth / 2, startY + i * lineHeight));

  // Options
  renderOptions(
    ctx,
    margin,
    cardY + cardH + gap,
    mainWidth,
    height - margin - (cardY + cardH + gap),
    question,
    state.phase === "reveal" ? question.correct : null,
    scale,
    now,
  );

  void rs;
}

function renderOptions(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  question: { options: Array<{ id: string; label: string }> },
  correctId: string | null,
  scale: number,
  now: number,
): void {
  const cols = 2;
  const gap = scaledSize(20, scale);
  const rows = Math.max(1, Math.ceil(question.options.length / cols));
  const cardW = (width - gap * (cols - 1)) / cols;
  const cardH = Math.min(scaledSize(190, scale), (height - gap * (rows - 1)) / rows);
  const revealed = correctId !== null;

  question.options.forEach((opt, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cardW + gap);
    const cy = y + row * (cardH + gap);

    const isCorrect = opt.id === correctId;
    let fill = "rgba(23,18,56,0.97)";
    let stroke: string = colors.border;
    if (revealed) {
      fill = isCorrect ? "rgba(61,255,162,0.16)" : "rgba(16,12,40,0.94)";
      stroke = isCorrect ? colors.success : "rgba(255,255,255,0.06)";
    }

    // Pop-in on the first 400ms of the question.
    const age = now % 100000;
    const pop = 1 + 0.015 * Math.sin(age * 0.004 + i) * (revealed ? 0 : 1);
    ctx.save();
    ctx.translate(cx + cardW / 2, cy + cardH / 2);
    ctx.scale(pop, pop);
    ctx.translate(-(cx + cardW / 2), -(cy + cardH / 2));

    drawBentoCard(ctx, { x: cx, y: cy, width: cardW, height: cardH }, {
      fill,
      stroke,
      lineWidth: revealed && isCorrect ? 3 : 1,
      glow: revealed && isCorrect ? colors.success : undefined,
    });

    // Letter badge
    const badge = scaledSize(44, scale);
    const badgeX = cx + scaledSize(20, scale);
    const badgeY = cy + cardH / 2 - badge / 2;
    ctx.fillStyle = isCorrect && revealed ? colors.success : colors.surfaceHi;
    drawRoundRect(ctx, badgeX, badgeY, badge, badge, scaledSize(10, scale), ctx.fillStyle as string);

    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = isCorrect && revealed ? colors.bg0 : colors.magenta;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opt.id.toUpperCase(), badgeX + badge / 2, badgeY + badge / 2 + 1);

    // Option label
    const labelX = badgeX + badge + scaledSize(18, scale);
    const labelMax = cx + cardW - labelX - scaledSize(20, scale);
    const labelSize = Math.max(scaledSize(18, scale), Math.min(scaledSize(26, scale), cardH * 0.24));
    ctx.font = `500 ${labelSize}px ${fonts.display.family}`;
    ctx.fillStyle = revealed && !isCorrect ? colors.textMuted : colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const lines = wrapToWidth(ctx, opt.label, labelMax);
    const lh = labelSize * 1.2;
    const start = cy + cardH / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, li) => ctx.fillText(line, labelX, start + li * lh));

    ctx.restore();
  });
}

function renderScoreboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: QuizScreenState,
  rs: RenderState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const scoreWidth = Math.min(width * 0.28, scaledSize(400, scale));
  const rect = {
    x: width - margin - scoreWidth,
    y: margin,
    width: scoreWidth,
    height: Math.min(
      height - margin * 2,
      scaledSize(64, scale) * state.scores.length + scaledSize(92, scale),
    ),
  };
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  const entries = state.scores.map((s, i) => ({
    name: s.name,
    score: s.score,
    playerIndex: i,
    isCurrent: false,
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: rs.scoreManager.getDisplayScore(i),
  }));

  drawScoreboard(ctx, rect, entries, { title: "SCORES", showRank: true, scale });
}

function renderTimer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: QuizScreenState,
  scale: number,
): void {
  if (state.phase !== "question" && state.phase !== "reveal") return;

  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const scoreWidth = Math.min(width * 0.28, scaledSize(400, scale));
  const mainWidth = width - margin * 2 - gap - scoreWidth;

  const barH = scaledSize(8, scale);
  const y = margin + scaledSize(42, scale);
  const progress = Math.max(0, Math.min(1,
    state.phase === "question" ? state.timeLeft / QUESTION_TIME_MS : 0,
  ));

  drawRoundRect(ctx, margin, y, mainWidth, barH, barH / 2, "rgba(255,255,255,0.08)");
  if (progress > 0) {
    const color = progress > 0.35 ? colors.cyan : progress > 0.15 ? colors.amber : colors.danger;
    drawRoundRect(ctx, margin, y, Math.max(barH, mainWidth * progress), barH, barH / 2, color);
  }

  if (state.phase === "question") {
    ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = progress > 0.15 ? colors.text : colors.danger;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${Math.ceil(state.timeLeft / 1000)}`, margin + mainWidth, y - scaledSize(6, scale));
  }
}

function drawWaiting(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  now: number,
): void {
  const pulse = 0.6 + 0.4 * Math.sin(now * 0.002);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(96, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.shadowColor = colors.magenta;
  ctx.shadowBlur = 30 * pulse;
  ctx.fillText("QUIZ", width / 2, height * 0.42);

  ctx.shadowBlur = 0;
  ctx.font = `500 ${scaledSize(28, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("Waiting for the host to start…", width / 2, height * 0.58);
  ctx.restore();
}

/** Greedy wrap that respects the current ctx.font. */
function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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
