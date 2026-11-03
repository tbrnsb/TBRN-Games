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

  // Darken the playfield so the result reads instantly from across a room.
  if (screen.animations.background.alpha > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(11, 8, 32, ${Math.min(0.94, screen.animations.background.alpha)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // Draw confetti particles
  drawParticles(ctx);

  const { winner, rankings, gameName } = screen.config;
  const { winnerCard, rankings: rankAnims, gameName: nameAnim } = screen.animations;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Game name
  if (nameAnim.alpha > 0) {
    const size = scaledSize(24, scale);
    ctx.font = `700 ${size}px ${fonts.title.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.globalAlpha = nameAnim.alpha;
    ctx.fillText(gameName.toUpperCase(), centerX, scaledSize(64, scale));
  }

  // Winner card
  const cardWidth = Math.min(width * 0.74, scaledSize(720, scale));
  const cardHeight = scaledSize(196, scale);
  const cardX = centerX - cardWidth / 2;

  if (winnerCard.alpha > 0) {
    const cardY = height * 0.28 + winnerCard.y;
    const winnerColor = getPlayerColor(winner.playerIndex);

    ctx.globalAlpha = winnerCard.alpha;
    ctx.save();
    ctx.translate(centerX, cardY + cardHeight / 2);
    ctx.scale(winnerCard.scale, winnerCard.scale);
    ctx.translate(-centerX, -(cardY + cardHeight / 2));

    const grad = ctx.createLinearGradient(cardX, cardY, cardX + cardWidth, cardY + cardHeight);
    grad.addColorStop(0, winnerColor + "3D");
    grad.addColorStop(1, winnerColor + "0D");
    ctx.fillStyle = grad;
    ctx.strokeStyle = winnerColor;
    ctx.lineWidth = Math.max(2, scaledSize(3, scale));
    roundRect(ctx, cardX, cardY, cardWidth, cardHeight, scaledSize(20, scale));
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = winnerColor;
    ctx.shadowBlur = scaledSize(28, scale);

    ctx.font = `700 ${scaledSize(18, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = winnerColor;
    ctx.textAlign = "center";
    ctx.fillText("WINNER", centerX, cardY + scaledSize(38, scale));

    ctx.font = `700 ${scaledSize(56, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(winner.name, centerX, cardY + scaledSize(96, scale));
    ctx.shadowBlur = 0;

    const suffix = screen.config.scoreSuffix ? ` ${screen.config.scoreSuffix}` : "";
    ctx.font = `500 ${scaledSize(22, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(`${winner.score}${suffix}`, centerX, cardY + scaledSize(146, scale));

    ctx.restore();
  }

  // Rankings panel — sized to its content so it never looks half empty.
  const panelTop = Math.min(height * 0.56, height * 0.28 + cardHeight + scaledSize(24, scale));
  const panelBottom = height - scaledSize(44, scale);
  const pad = scaledSize(20, scale);
  const maxRowH = scaledSize(58, scale);
  const contentRowH = Math.min(maxRowH, (panelBottom - panelTop - pad * 2) / Math.max(1, rankings.length));
  const panelHeight = Math.min(panelBottom - panelTop, pad * 2 + contentRowH * rankings.length);

  ctx.globalAlpha = nameAnim.alpha;
  ctx.fillStyle = "rgba(18,13,46,0.86)";
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  roundRect(ctx, cardX, panelTop, cardWidth, panelHeight, scaledSize(18, scale));
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;

  const rowH = contentRowH;

  for (let i = 0; i < rankings.length; i++) {
    const entry = rankings[i];
    const anim = rankAnims[i];
    if (anim.alpha === 0) continue;

    const y = panelTop + pad + rowH * i + rowH / 2 + anim.y;
    const color = getPlayerColor(entry.playerIndex);

    ctx.globalAlpha = anim.alpha;
    ctx.save();

    if (entry.isWinner) {
      ctx.fillStyle = colors.success + "1F";
      roundRect(ctx, cardX + pad * 0.5, y - rowH / 2 + scaledSize(2, scale), cardWidth - pad, rowH - scaledSize(4, scale), scaledSize(10, scale));
      ctx.fill();
    }

    // Rank badge
    const badgeSize = Math.min(scaledSize(32, scale), rowH * 0.62);
    const badgeX = cardX + pad;
    ctx.fillStyle = entry.isWinner ? colors.success : color;
    roundRect(ctx, badgeX, y - badgeSize / 2, badgeSize, badgeSize, scaledSize(8, scale));
    ctx.fill();
    ctx.font = `700 ${Math.max(scaledSize(11, scale), badgeSize * 0.46)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.bg0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(entry.rank), badgeX + badgeSize / 2, y + 1);

    // Name
    const nameX = badgeX + badgeSize + scaledSize(16, scale);
    ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = entry.isWinner ? colors.success : colors.text;
    ctx.textAlign = "left";
    ctx.fillText(entry.name, nameX, y);

    // Score
    const suffix = screen.config.scoreSuffix ? ` ${screen.config.scoreSuffix}` : "";
    ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = entry.isWinner ? colors.success : colors.textMuted;
    ctx.textAlign = "right";
    ctx.fillText(`${entry.score}${suffix}`, cardX + cardWidth - pad, y);

    ctx.restore();
  }

  ctx.restore();
}

export function isVictoryScreenDone(screen: VictoryScreen): boolean {
  return screen.state === "exiting";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// --- Helper to build ranked entries from game state ---
export function buildRankedEntries(
  players: Array<{ name: string; score: number }>,
  winnerName: string | null
): RankedEntry[] {
  return players
    .map((p, playerIndex) => ({ ...p, playerIndex }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      score: p.score,
      playerIndex: p.playerIndex,
      isWinner: winnerName !== null && p.name === winnerName,
    }));
}