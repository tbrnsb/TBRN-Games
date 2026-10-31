/**
 * Archery - Screen Rendering
 */

import { theme } from "../../shared/theme.ts";

interface ArcheryScreenState {
  phase: string;
  targetX: number;
  targetWidth: number;
  drawPower: number;
  isDrawing: boolean;
  arrow: { x: number; y: number } | null;
  currentPlayer: number;
  round: number;
  maxRounds: number;
  scores: Array<{ name: string; score: number }>;
  shots: Array<{ playerIndex: number; x: number; y: number; score: number; round: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

export function renderArchery(ctx: CanvasRenderingContext2D, width: number, height: number, state: ArcheryScreenState): void {
  ctx.fillStyle = theme.colors.background;
  ctx.fillRect(0, 0, width, height);

  if (state.finished) {
    drawFinished(ctx, width, height, state);
    return;
  }

  const centerX = width / 2;
  const groundY = height * 0.85;
  const scale = width * 0.8;

  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, groundY);
  grad.addColorStop(0, "#1e3a5f");
  grad.addColorStop(1, "#2e5a8a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, groundY);

  // Ground
  ctx.fillStyle = "#2d5a3d";
  ctx.fillRect(0, groundY, width, height - groundY);

  // Target
  drawTarget(ctx, centerX + state.targetX * scale * 0.4, groundY - 100, scale * 0.15);

  // Archer
  drawArcher(ctx, 80, groundY - 30, state.drawPower, state.isDrawing);

  // Arrow in flight
  if (state.arrow) {
    drawArrow(ctx, centerX + state.arrow.x * scale * 0.8, groundY - 30 - state.arrow.y * scale * 0.8);
  }

  // Power meter
  if (state.phase === "aiming" && state.isDrawing) {
    drawPowerMeter(ctx, width, height, state.drawPower);
  }

  // UI
  drawScorePanel(ctx, width, height, state);
  drawRoundInfo(ctx, width, height, state);
}

function drawTarget(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  // Rings
  const rings = [
    { r: radius, color: "#fff" },
    { r: radius * 0.8, color: "#000" },
    { r: radius * 0.6, color: "#0066ff" },
    { r: radius * 0.4, color: "#ff0000" },
    { r: radius * 0.2, color: "#ffd700" },
  ];

  rings.forEach(ring => {
    ctx.beginPath();
    ctx.arc(x, y, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = ring.color;
    ctx.fill();
  });

  // Target post
  ctx.fillStyle = "#8b4513";
  ctx.fillRect(x - 4, y + radius, 8, 50);
}

function drawArcher(ctx: CanvasRenderingContext2D, x: number, y: number, power: number, drawing: boolean): void {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  // Body
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 40);
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.moveTo(x, y + 40);
  ctx.lineTo(x - 15, y + 80);
  ctx.moveTo(x, y + 40);
  ctx.lineTo(x + 15, y + 80);
  ctx.stroke();

  // Bow arm
  const armAngle = drawing ? -Math.PI / 6 : -Math.PI / 4;
  const bowX = x + Math.cos(armAngle) * 35;
  const bowY = y + 15 + Math.sin(armAngle) * 35;

  ctx.beginPath();
  ctx.moveTo(x, y + 15);
  ctx.lineTo(bowX, bowY);
  ctx.stroke();

  // Bow
  if (drawing) {
    ctx.strokeStyle = "#8b7355";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x + 15, y + 15, 30 * power, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // String
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 15 - 30 * power, y - 15);
    ctx.lineTo(x + 15 - 30 * power, y + 45);
    ctx.stroke();
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#ffd700";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 20, y - 5);
  ctx.lineTo(x - 20, y + 5);
  ctx.closePath();
  ctx.fill();
}

function drawPowerMeter(ctx: CanvasRenderingContext2D, width: number, height: number, power: number): void {
  const meterW = 200, meterH = 30;
  const x = (width - meterW) / 2;
  const y = height - 150;

  ctx.fillStyle = theme.colors.surface;
  ctx.fillRect(x, y, meterW, meterH);
  ctx.strokeStyle = theme.colors.border;
  ctx.strokeRect(x, y, meterW, meterH);

  const fillW = meterW * power;
  const grad = ctx.createLinearGradient(x, y, x + meterW, y);
  grad.addColorStop(0, theme.colors.success);
  grad.addColorStop(0.7, theme.colors.warning);
  grad.addColorStop(1, theme.colors.error);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, fillW, meterH);

  ctx.font = "bold 16px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "center";
  ctx.fillText(`POWER: ${Math.round(power * 100)}%`, width / 2, y - 10);
}

function drawScorePanel(ctx: CanvasRenderingContext2D, width: number, height: number, state: ArcheryScreenState): void {
  const panelY = 20;
  ctx.fillStyle = theme.colors.surface + "CC";
  ctx.fillRect(20, panelY, width - 40, 80);
  ctx.strokeStyle = theme.colors.border;
  ctx.strokeRect(20, panelY, width - 40, 80);

  ctx.font = "bold 18px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "left";

  const colWidth = (width - 80) / Math.max(state.scores.length, 1);
  state.scores.forEach((s, i) => {
    const x = 40 + i * colWidth;
    if (i === state.currentPlayer && !state.finished) {
      ctx.fillStyle = theme.colors.primary + "33";
      ctx.fillRect(30 + i * colWidth, panelY + 10, colWidth - 10, 60);
    }
    ctx.fillStyle = i === state.currentPlayer && !state.finished ? theme.colors.primary : theme.colors.textPrimary;
    ctx.fillText(s.name, x, panelY + 30);
    ctx.font = "bold 28px Inter";
    ctx.fillText(String(s.score), x, panelY + 65);
    ctx.font = "bold 18px Inter";
  });
}

function drawRoundInfo(ctx: CanvasRenderingContext2D, width: number, height: number, state: ArcheryScreenState): void {
  ctx.font = "bold 20px Inter";
  ctx.fillStyle = theme.colors.textSecondary;
  ctx.textAlign = "center";
  ctx.fillText(`Round ${state.round} / ${state.maxRounds}`, width / 2, height - 30);
}

function drawFinished(ctx: CanvasRenderingContext2D, width: number, height: number, state: ArcheryScreenState): void {
  ctx.font = "bold 60px Inter";
  ctx.fillStyle = theme.colors.success;
  ctx.textAlign = "center";
  ctx.fillText("🏹 Tournament Complete!", width / 2, height / 2 - 80);

  if (state.winner) {
    ctx.font = "bold 36px Inter";
    ctx.fillStyle = theme.colors.primary;
    ctx.fillText(`${state.winner.name} Wins!`, width / 2, height / 2 - 20);
    ctx.font = "24px Inter";
    ctx.fillStyle = theme.colors.textSecondary;
    ctx.fillText(`${state.winner.score} points`, width / 2, height / 2 + 20);
  }

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