/**
 * Victory Screen — winner celebration with confetti, ranked scores
 * Full-screen overlay shown when game finishes.
 */

import { fonts, colors, scaledSize, scaleForViewport, getPlayerColor } from "./theme.ts";
import { easeOutCubic, easeOutBack, staggerDelay } from "./easing.ts";
import { emitConfetti, drawParticles } from "./particles.ts";

export interface RankedEntry {
  rank: number;
  name: string;
  score: number;
  playerIndex: number;
  isWinner: boolean;
}

export interface VictoryConfig {
  winner: RankedEntry;
  rankings: RankedEntry[];
  gameName: string;
  duration?: number; // auto-advance after this ms, 0 = manual
  scoreSuffix?: string; // e.g. "pts", "chips", "strokes" — omitted by default
}

export interface VictoryScreen {
  config: VictoryConfig;
  state: "entering" | "celebrating" | "idle" | "exiting";
  startTime: number;
  confettiEmitted: boolean;
  animations: {
    background: { alpha: number };
    winnerCard: { y: number; scale: number; alpha: number };
    rankings: Array<{ y: number; alpha: number; delay: number }>;
    gameName: { alpha: number };
  };
  shake: { x: number; y: number; active: boolean };
}

export function createVictoryScreen(config: VictoryConfig): VictoryScreen {
  const rankings = config.rankings.map((r, i) => ({
    y: 100,
    alpha: 0,
    delay: staggerDelay(i, 80),
  }));

  return {
    config,
    state: "entering",
    startTime: 0,
    confettiEmitted: false,
    animations: {
      background: { alpha: 0 },
      winnerCard: { y: 100, scale: 0.8, alpha: 0 },
      rankings,
      gameName: { alpha: 0 },
    },
    shake: { x: 0, y: 0, active: false },
  };
}

export function showVictoryScreen(screen: VictoryScreen, now: number, width: number, height: number): void {
  screen.state = "entering";
  screen.startTime = now;
  screen.confettiEmitted = false;

  // Emit confetti from winner's color
  const winnerColor = getPlayerColor(screen.config.winner.playerIndex);
  emitConfetti(width / 2, height * 0.2, width, [winnerColor, "#fff", colors.magenta, colors.cyan], scaleForViewport(width, height));
}

export function updateVictoryScreen(screen: VictoryScreen, now: number, _dt: number): void {
  if (screen.state === "idle" || screen.state === "exiting") return;

  if (screen.state === "entering") {
    const elapsed = now - screen.startTime;
    const enterDuration = 1200;

    if (elapsed < enterDuration) {
      const eased = easeOutCubic(elapsed / enterDuration);

      // Background fade
      screen.animations.background.alpha = eased * 0.85;

      // Winner card
      const winnerT = Math.max(0, (elapsed - 100) / 600);
      const winnerEased = easeOutBack(Math.min(1, winnerT));
      screen.animations.winnerCard.y = (1 - winnerEased) * 100;
      screen.animations.winnerCard.scale = 0.8 + 0.2 * winnerEased;
      screen.animations.winnerCard.alpha = Math.min(1, winnerEased);

      // Game name
      const nameT = Math.max(0, (elapsed - 300) / 500);
      screen.animations.gameName.alpha = easeOutCubic(Math.min(1, nameT));

      // Rankings (staggered)
      for (const rank of screen.animations.rankings) {
        const rankStart = 700 + rank.delay;
        const rankT = Math.max(0, (elapsed - rankStart) / 400);
        const rankEased = easeOutCubic(Math.min(1, rankT));
        rank.y = (1 - rankEased) * 60;
        rank.alpha = rankEased;
      }
      return;
    }

    // Settle every animation at its final value, then start celebrating.
    screen.state = "celebrating";
    screen.startTime = now;
    screen.animations.background.alpha = 0.85;
    screen.animations.winnerCard = { y: 0, scale: 1, alpha: 1 };
    screen.animations.gameName.alpha = 1;
    for (const rank of screen.animations.rankings) {
      rank.y = 0;
      rank.alpha = 1;
    }
    return;
  }

  // Celebrating: subtle pulse on the winner card.
  const celebrateElapsed = now - screen.startTime;
  screen.animations.winnerCard.scale = 1 + 0.025 * Math.sin(celebrateElapsed * 0.004);

  // Auto-exit if a duration was set (0 keeps the result up until the client moves on).
  if (screen.config.duration && celebrateElapsed >= screen.config.duration) {
    screen.state = "exiting";
    screen.startTime = now;
  }
}

export function drawVictoryScreen(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  screen: VictoryScreen
): void {
  const scale = scaleForViewport(width, height);
  const centerX = width / 2;
  const { winner, rankings, gameName } = screen.config;
  const { winnerCard, rankings: rankAnims, gameName: nameAnim } = screen.animations;

  if (screen.animations.background.alpha > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(29, 27, 38, ${Math.min(0.9, screen.animations.background.alpha)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  drawParticles(ctx);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (nameAnim.alpha > 0) {
    ctx.globalAlpha = nameAnim.alpha;
    ctx.font = `700 ${scaledSize(24, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = "#FFF7E8";
    ctx.fillText(gameName.toUpperCase(), centerX, scaledSize(52, scale));
  }

  const cardWidth = Math.min(width * 0.72, scaledSize(760, scale));
  const cardHeight = scaledSize(190, scale);
  const cardX = centerX - cardWidth / 2;

  if (winnerCard.alpha > 0) {
    const cardY = height * 0.25 + winnerCard.y;
    const winnerColor = getPlayerColor(winner.playerIndex);
    ctx.globalAlpha = winnerCard.alpha;
    ctx.save();
    ctx.translate(centerX, cardY + cardHeight / 2);
    ctx.scale(winnerCard.scale, winnerCard.scale);
    ctx.translate(-centerX, -(cardY + cardHeight / 2));

    ctx.shadowColor = colors.border;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 10;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = colors.bg0;
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(3, scaledSize(4, scale));
    ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);

    // Winner ink bar, not a gradient.
    ctx.fillStyle = winnerColor;
    ctx.fillRect(cardX, cardY, cardWidth, scaledSize(12, scale));

    ctx.textAlign = "center";
    ctx.font = `800 ${scaledSize(18, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText("WINNER", centerX, cardY + scaledSize(38, scale));

    ctx.font = `800 ${scaledSize(56, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(winner.name, centerX, cardY + scaledSize(96, scale));

    const suffix = screen.config.scoreSuffix ? ` ${screen.config.scoreSuffix}` : "";
    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.danger;
    ctx.fillText(`${winner.score}${suffix}`, centerX, cardY + scaledSize(142, scale));
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  const panelTop = Math.min(height * 0.56, height * 0.25 + cardHeight + scaledSize(28, scale));
  const rowH = Math.min(scaledSize(48, scale), (height - panelTop - scaledSize(30, scale)) / Math.max(1, rankings.length));
  const panelW = Math.min(width * 0.58, scaledSize(620, scale));
  const panelX = centerX - panelW / 2;

  rankings.forEach((entry, i) => {
    const anim = rankAnims[i];
    if (!anim || anim.alpha <= 0) return;
    const y = panelTop + i * rowH + anim.y;
    ctx.globalAlpha = anim.alpha;
    ctx.fillStyle = "rgba(244,235,217,0.94)";
    ctx.fillRect(panelX, y, panelW, rowH - scaledSize(5, scale));
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.strokeRect(panelX, y, panelW, rowH - scaledSize(5, scale));

    ctx.fillStyle = getPlayerColor(entry.playerIndex);
    ctx.fillRect(panelX + scaledSize(10, scale), y + scaledSize(7, scale), scaledSize(28, scale), rowH - scaledSize(19, scale));
    ctx.strokeStyle = colors.border;
    ctx.strokeRect(panelX + scaledSize(10, scale), y + scaledSize(7, scale), scaledSize(28, scale), rowH - scaledSize(19, scale));

    ctx.textAlign = "left";
    ctx.font = `700 ${scaledSize(18, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.cardText;
    ctx.fillText(`${entry.rank}. ${entry.name}`, panelX + scaledSize(50, scale), y + (rowH - scaledSize(5, scale)) / 2);

    ctx.textAlign = "right";
    ctx.font = `800 ${scaledSize(22, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.danger;
    ctx.fillText(String(entry.score), panelX + panelW - scaledSize(14, scale), y + (rowH - scaledSize(5, scale)) / 2);
  });

  ctx.restore();
}

export function buildRankedEntries(
  players: Array<{ name: string; score: number }>,
  winnerName: string | null
): RankedEntry[] {
  // The winner always takes rank 1. Several games decide the winner on
  // something other than the score (last survivor, first across the line),
  // so sorting by score alone can list the actual winner below an opponent.
  const ranked = players
    .map((p, playerIndex) => ({ ...p, playerIndex }))
    .sort((a, b) => {
      const aWinner = winnerName !== null && a.name === winnerName ? 1 : 0;
      const bWinner = winnerName !== null && b.name === winnerName ? 1 : 0;
      return bWinner - aWinner || b.score - a.score;
    });
  return ranked.map((p, i) => ({
    rank: i + 1,
    name: p.name,
    score: p.score,
    playerIndex: p.playerIndex,
    isWinner: winnerName !== null && p.name === winnerName,
  }));
}
