/**
 * Spin War — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: a top-down circular arena. Positions arrive normalised to
 * the server's arena radius; blades spin with their own server angle.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitHitBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, clamp,
} from "../../client/screen/kit/index.ts";

interface SpinWarSpinner {
  name: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  alive: boolean;
  color: string;
}

interface SpinWarScreenState {
  spinners: SpinWarSpinner[];
  arenaR: number;
  phase: "playing" | "finished";
  scores: Array<{ name: string; score: number; alive: boolean }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface SpinWarRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastAlive: boolean[];
}

function createSpinWarRenderState(): SpinWarRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastAlive: [],
  };
}

const renderState = (globalThis as any)._spinWarRenderState ||= createSpinWarRenderState();

export function renderSpinwar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SpinWarScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: SpinWarRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    const arena = arenaRect(width, height, scale);
    state.spinners.forEach((spinner, i) => {
      const wasAlive = rs.lastAlive[i] ?? true;
      if (wasAlive && !spinner.alive) {
        triggerShake(rs.shake, 0.4, now);
        emitHitBurst(
          arena.cx + (spinner.x / state.arenaR) * arena.r,
          arena.cy + (spinner.y / state.arenaR) * arena.r,
          colors.danger,
          scale,
        );
      }
      rs.lastAlive[i] = spinner.alive;
    });

    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
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
    drawArena(ctx, width, height, state, scale);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: SpinWarScreenState,
  rs: SpinWarRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "playing" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "SPIN WAR",
      subtitle: "Tap to spin — knock the others out",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.phase === "finished" && state.winner) {
    const entries = buildRankedEntries(state.scores, state.winner.name);
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Spin War",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function arenaRect(
  width: number,
  height: number,
  scale: number,
): { cx: number; cy: number; r: number } {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const headerH = scaledSize(56, scale);
  const availableW = width - margin * 2 - railW - gap;
  const availableH = height - margin * 2 - headerH;
  return {
    cx: margin + availableW / 2,
    cy: margin + headerH + availableH / 2,
    r: Math.min(availableW, availableH) * 0.44,
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SpinWarScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("SPIN WAR", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("SPIN WAR").width;

  const alive = state.spinners.filter((s) => s.alive).length;
  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${alive} of ${state.spinners.length} spinning`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawArena(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SpinWarScreenState,
  scale: number,
): void {
  const { cx, cy, r } = arenaRect(width, height, scale);

  // Arena floor.
  ctx.save();
  const disc = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
  disc.addColorStop(0, "rgba(40,26,92,0.95)");
  disc.addColorStop(0.7, "rgba(20,14,52,0.98)");
  disc.addColorStop(1, "rgba(10,8,28,1)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,229,255,0.35)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.stroke();

  // Danger ring.
  ctx.strokeStyle = "rgba(255,77,109,0.18)";
  ctx.lineWidth = Math.max(4, scaledSize(7, scale));
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Spinners.
  state.spinners.forEach((spinner, i) => {
    const x = cx + clamp(spinner.x / state.arenaR, -1, 1) * r;
    const y = cy + clamp(spinner.y / state.arenaR, -1, 1) * r;
    const color = spinner.color || colors.player[i % colors.player.length];
    const size = Math.max(10, r * 0.085);

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = spinner.alive ? 1 : 0.3;

    if (spinner.speed > 0.15 && spinner.alive) {
      ctx.strokeStyle = color + "55";
      ctx.lineWidth = Math.max(2, size * 0.28);
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.25, spinner.angle + Math.PI, spinner.angle + Math.PI * 1.7);
      ctx.stroke();
    }

    ctx.rotate(spinner.angle);
    ctx.shadowColor = color;
    ctx.shadowBlur = spinner.alive ? 20 : 0;
    ctx.fillStyle = spinner.alive ? color : "rgba(162,155,207,0.5)";

    // Four-point blade.
    ctx.beginPath();
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * Math.PI * 2;
      const rad = p % 2 === 0 ? size * 1.25 : size * 0.42;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(11,8,32,0.75)";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.fill();

    if (!spinner.alive) {
      ctx.rotate(-spinner.angle);
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, -size * 0.5);
      ctx.lineTo(size * 0.5, size * 0.5);
      ctx.moveTo(size * 0.5, -size * 0.5);
      ctx.lineTo(-size * 0.5, size * 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Name label.
    const labelY = y - size * 1.9;
    ctx.font = `700 ${scaledSize(14, scale)}px ${fonts.display.family}`;
    const labelW = ctx.measureText(spinner.name).width + scaledSize(14, scale);
    drawRoundRect(ctx, x - labelW / 2, labelY - scaledSize(10, scale), labelW, scaledSize(20, scale), scaledSize(10, scale), "rgba(11,8,32,0.82)");
    ctx.fillStyle = spinner.alive ? color : colors.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(spinner.name, x, labelY);
  });
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SpinWarScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const n = Math.max(1, state.scores.length);
  const listH = Math.min(
    height - margin * 2,
    scaledSize(80, scale) + n * scaledSize(72, scale),
  );
  const rect = { x: width - margin - railW, y: margin, width: railW, height: listH };
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

  // Alive / out below the card.
  const alive = state.scores.filter((s) => s.alive).length;
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`${alive} alive`, rect.x + scaledSize(4, scale), rect.y + rect.height + scaledSize(18, scale));
}
