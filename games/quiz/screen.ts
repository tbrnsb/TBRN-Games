/**
 * Quiz - Screen Rendering
 * Shows question, options, scores, timer
 */

import { theme } from "../../shared/theme.ts";

interface QuizScreenState {
  phase: string;
  question: { text: string; options: Array<{ id: string; label: string }>; correct: string } | null;
  currentQuestion: number;
  totalQuestions: number;
  timeLeft: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

export function renderQuiz(ctx: CanvasRenderingContext2D, width: number, height: number, state: QuizScreenState): void {
  // Clear
  ctx.fillStyle = theme.colors.background;
  ctx.fillRect(0, 0, width, height);

  if (state.finished) {
    drawFinished(ctx, width, height, state);
    return;
  }

  if (!state.question) {
    drawWaiting(ctx, width, height);
    return;
  }

  // Question number
  ctx.font = "bold 20px Inter";
  ctx.fillStyle = theme.colors.textSecondary;
  ctx.textAlign = "center";
  ctx.fillText(`Question ${state.currentQuestion} / ${state.totalQuestions}`, width / 2, 50);

  // Timer bar
  drawTimerBar(ctx, width, height, state.timeLeft, 15000);

  // Question text
  ctx.font = "bold 36px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "center";
  wrapText(ctx, state.question.text, width / 2, 140, width - 100, 50);

  // Options grid
  drawOptions(ctx, width, height, state.question, state.phase === "reveal" ? state.question.correct : null);
}

function drawTimerBar(ctx: CanvasRenderingContext2D, width: number, height: number, timeLeft: number, maxTime: number): void {
  const barWidth = width * 0.8;
  const barHeight = 12;
  const x = (width - barWidth) / 2;
  const y = 80;
  const progress = Math.max(0, timeLeft) / maxTime;

  // Background
  ctx.fillStyle = theme.colors.surface;
  ctx.fillRect(x, y, barWidth, barHeight);

  // Progress
  const progressColor = progress > 0.3 ? theme.colors.success : progress > 0.1 ? theme.colors.warning : theme.colors.error;
  ctx.fillStyle = progressColor;
  ctx.fillRect(x, y, barWidth * progress, barHeight);

  // Time text
  ctx.font = "bold 20px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "center";
  ctx.fillText(`${Math.ceil(timeLeft / 1000)}s`, width / 2, y + 30);
}

function drawOptions(ctx: CanvasRenderingContext2D, width: number, height: number, question: { options: Array<{ id: string; label: string }> }, correctId: string | null): void {
  const cols = 2;
  const optWidth = 350;
  const optHeight = 100;
  const gap = 30;
  const startX = (width - (cols * optWidth + (cols - 1) * gap)) / 2;
  const startY = 220;

  question.options.forEach((opt, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (optWidth + gap);
    const y = startY + row * (optHeight + gap);

    const isCorrect = opt.id === correctId;
    const isRevealed = correctId !== null;

    // Button background
    ctx.fillStyle = isRevealed
      ? (isCorrect ? theme.colors.success + "33" : theme.colors.error + "33")
      : theme.colors.surface;
    ctx.strokeStyle = isRevealed
      ? (isCorrect ? theme.colors.success : theme.colors.error)
      : theme.colors.border;
    ctx.lineWidth = isRevealed ? 3 : 2;
    roundRect(ctx, x, y, optWidth, optHeight, 12);
    ctx.fill();
    ctx.stroke();

    // Option letter
    ctx.font = "bold 24px Inter";
    ctx.fillStyle = isRevealed && isCorrect ? theme.colors.success : isRevealed && !isCorrect ? theme.colors.error : theme.colors.primary;
    ctx.textAlign = "center";
    ctx.fillText(opt.id.toUpperCase(), x + 40, y + 65);

    // Option text
    ctx.font = "20px Inter";
    ctx.fillStyle = theme.colors.textPrimary;
    ctx.textAlign = "left";
    wrapText(ctx, opt.label, x + 70, y + 50, optWidth - 90, 30);
  });
}

function drawWaiting(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.font = "bold 48px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "center";
  ctx.fillText("Waiting for host to start...", width / 2, height / 2);
}

function drawFinished(ctx: CanvasRenderingContext2D, width: number, height: number, state: QuizScreenState): void {
  ctx.font = "bold 60px Inter";
  ctx.fillStyle = theme.colors.success;
  ctx.textAlign = "center";
  ctx.fillText("🎉 Quiz Complete!", width / 2, height / 2 - 80);

  if (state.winner) {
    ctx.font = "bold 36px Inter";
    ctx.fillStyle = theme.colors.primary;
    ctx.fillText(`${state.winner.name} Wins!`, width / 2, height / 2 - 20);
    ctx.font = "24px Inter";
    ctx.fillStyle = theme.colors.textSecondary;
    ctx.fillText(`${state.winner.score} points`, width / 2, height / 2 + 20);
  }

  // Final scores
  ctx.font = "20px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "left";
  const startY = height / 2 + 60;
  state.scores
    .sort((a, b) => b.score - a.score)
    .forEach((s, i) => {
      ctx.fillText(`${i + 1}. ${s.name} — ${s.score}`, width / 2 - 150, startY + i * 35);
    });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(" ");
  let line = "";
  let testY = y;

  for (const word of words) {
    const testLine = line + word + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line !== "") {
      ctx.fillText(line, x, testY);
      line = word + " ";
      testY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, testY);
}