/**
 * Darts - Screen Rendering
 * Renders dartboard, scores, throws history
 */

import { theme } from "../../shared/theme.ts";

interface DartsScreenState {
  players: Array<{ name: string; score: number; isCurrent: boolean; turn: number; isWinner: boolean }>;
  throws: Array<{ playerIndex: number; x: number; y: number; score: number; timestamp: number }>;
  finished: boolean;
  winner: string | null;
  gameMode: string;
}

const DARTBOARD_RADIUS = 170;
const SECTOR_VALUES = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

function getSectorAngle(index: number): number {
  return (-90 + index * 18) * Math.PI / 180;
}

export function renderDarts(ctx: CanvasRenderingContext2D, width: number, height: number, state: DartsScreenState): void {
  // Clear
  ctx.fillStyle = theme.colors.background;
  ctx.fillRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2 - 50;
  const scale = Math.min(width, height - 200) / (DARTBOARD_RADIUS * 2.5);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);

  // Draw dartboard
  drawDartboard(ctx);

  // Draw throws
  drawThrows(ctx, state.throws);

  ctx.restore();

  // Draw score panel
  drawScorePanel(ctx, width, height, state);
}

function drawDartboard(ctx: CanvasRenderingContext2D): void {
  // Draw sectors
  for (let i = 0; i < 20; i++) {
    const angle1 = getSectorAngle(i);
    const angle2 = getSectorAngle(i + 1);
    const isEven = i % 2 === 0;

    // Single areas (alternating colors)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 170, angle1, angle2);
    ctx.closePath();
    ctx.fillStyle = isEven ? "#1a1a2e" : "#0f172a";
    ctx.fill();

    // Triple ring
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 107, angle1, angle2);
    ctx.arc(0, 0, 99, angle2, angle1, true);
    ctx.closePath();
    ctx.fillStyle = isEven ? "#ff6b35" : "#e05528";
    ctx.fill();

    // Double ring
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 170, angle1, angle2);
    ctx.arc(0, 0, 162, angle2, angle1, true);
    ctx.closePath();
    ctx.fillStyle = isEven ? "#2e7dff" : "#1a66e0";
    ctx.fill();

    // Sector value text
    const midAngle = (angle1 + angle2) / 2;
    const textRadius = 130;
    ctx.save();
    ctx.translate(Math.cos(midAngle) * textRadius, Math.sin(midAngle) * textRadius);
    ctx.rotate(midAngle + Math.PI / 2);
    ctx.font = "bold 14px Inter";
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.fillText(String(SECTOR_VALUES[i]), 0, 0);
    ctx.restore();
  }

  // Bull rings
  ctx.beginPath();
  ctx.arc(0, 0, 15.9, 0, Math.PI * 2);
  ctx.fillStyle = "#ff6b35";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, 6.35, 0, Math.PI * 2);
  ctx.fillStyle = "#2e7dff";
  ctx.fill();

  // Center dot
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  // Outer border
  ctx.beginPath();
  ctx.arc(0, 0, 170, 0, Math.PI * 2);
  ctx.strokeStyle = theme.colors.border;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawThrows(ctx: CanvasRenderingContext2D, throws: Array<{ x: number; y: number; score: number; playerIndex: number }>): void {
  const playerColors = theme.colors.player;

  throws.forEach((t, _i) => {
    const color = playerColors[t.playerIndex % playerColors.length];
    ctx.beginPath();
    ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Score label
    ctx.font = "bold 12px Inter";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(String(t.score), t.x, t.y - 10);
  });
}

function drawScorePanel(ctx: CanvasRenderingContext2D, width: number, height: number, state: DartsScreenState): void {
  const panelY = height - 180;
  const panelHeight = 170;

  // Panel background
  ctx.fillStyle = theme.colors.surface;
  ctx.fillRect(20, panelY, width - 40, panelHeight);
  ctx.strokeStyle = theme.colors.border;
  ctx.strokeRect(20, panelY, width - 40, panelHeight);

  // Title
  ctx.font = "bold 20px Inter";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.textAlign = "left";
  ctx.fillText(`${state.gameMode} Darts`, 40, panelY + 30);

  // Player scores
  const colWidth = (width - 80) / Math.max(state.players.length, 1);
  state.players.forEach((p, i) => {
    const x = 40 + i * colWidth;
    const isCurrent = p.isCurrent;
    const isWinner = p.isWinner;

    // Highlight current player
    if (isCurrent) {
      ctx.fillStyle = theme.colors.primary + "33";
      ctx.fillRect(30 + i * colWidth, panelY + 40, colWidth - 10, 120);
    }
    if (isWinner) {
      ctx.fillStyle = theme.colors.success + "33";
      ctx.fillRect(30 + i * colWidth, panelY + 40, colWidth - 10, 120);
    }

    // Name
    ctx.font = isWinner ? "bold 16px Inter" : "14px Inter";
    ctx.fillStyle = isWinner ? theme.colors.success : theme.colors.textPrimary;
    ctx.textAlign = "center";
    ctx.fillText(p.name, x + colWidth / 2 - 20, panelY + 70);

    // Score
    ctx.font = "bold 36px Inter";
    ctx.fillStyle = isCurrent ? theme.colors.primary : theme.colors.textPrimary;
    ctx.fillText(String(p.score), x + colWidth / 2 - 20, panelY + 115);

    // Turn indicator
    if (isCurrent && !state.finished) {
      ctx.font = "12px Inter";
      ctx.fillStyle = theme.colors.primary;
      ctx.fillText(`Dart ${p.turn + 1}/3`, x + colWidth / 2 - 20, panelY + 145);
    }

    // Winner
    if (isWinner) {
      ctx.font = "bold 14px Inter";
      ctx.fillStyle = theme.colors.success;
      ctx.fillText("WINNER!", x + colWidth / 2 - 20, panelY + 165);
    }
  });

  // Finished message
  if (state.finished && state.winner) {
    ctx.font = "bold 24px Inter";
    ctx.fillStyle = theme.colors.success;
    ctx.textAlign = "center";
    ctx.fillText(`${state.winner} wins! 🎉`, width / 2, panelY + 30);
  }
}