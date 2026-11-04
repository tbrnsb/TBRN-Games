/**
 * Gravity Run — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Side-scrolling spectator view of the server's normalised corridor.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, emitHitBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, clamp,
} from "../../client/screen/kit/index.ts";

interface GravityPlayer {
  x: number;
  y: number;
  gravity: 1 | -1;
  alive: boolean;
  score: number;
  coins: number;
}

interface GravityObstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  type: "block" | "spike";
}

interface GravityScreenState {
  players: GravityPlayer[];
  obstacles: GravityObstacle[];
  coins: Array<{ x: number; y: number }>;
  scrollSpeed: number;
  distance: number;
  timeLeft: number;
  phase: "playing" | "finished";
  scores: Array<{ name: string; score: number; coins: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface GravityRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastAlive: boolean[];
  lastScores: number[];
}

const VIEW_W = 1.1;
const GAME_TIME_MS = 60000;

function createGravityRenderState(): GravityRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastAlive: [],
    lastScores: [],
  };
}

const renderState = (globalThis as any)._gravityRenderState ||= createGravityRenderState();

export function renderGravityrun(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GravityScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: GravityRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    const arena = arenaRect(width, height, scale);
    state.players.forEach((player, i) => {
      const wasAlive = rs.lastAlive[i] ?? true;
      if (wasAlive && !player.alive) {
        triggerShake(rs.shake, 0.35, now);
        emitHitBurst(
          arena.x + (player.x / VIEW_W) * arena.width,
          arena.y + player.y * arena.height,
          colors.danger,
          scale,
        );
      }
      rs.lastAlive[i] = player.alive;

      const prev = rs.lastScores[i];
      if (prev !== undefined && player.score > prev) {
        emitScoreBurst(
          arena.x + (player.x / VIEW_W) * arena.width,
          arena.y + player.y * arena.height,
          i,
          scale,
        );
      }
      rs.lastScores[i] = player.score;
    });

    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
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
    drawCorridor(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: GravityScreenState,
  rs: GravityRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "playing" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "GRAVITY RUN",
      subtitle: "Tap to flip gravity — dodge, collect, survive",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.finished && state.winner) {
    const entries = buildRankedEntries(
      state.scores.map((s) => ({ name: s.name, score: s.score })),
      state.winner.name,
    );
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Gravity Run",
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
    mainW: width - margin * 2 - railW - gap,
    top: margin + headerH,
    rail: { x: width - margin - railW, y: margin, width: railW, height: height - margin * 2 },
  };
}

function arenaRect(
  width: number,
  height: number,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const { margin, mainW, top } = layout(width, height, scale);
  return { x: margin, y: top, width: mainW, height: height - margin * 2 - (top - margin) };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GravityScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("GRAVITY RUN", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("GRAVITY RUN").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${state.distance} m  ·  ${Math.ceil(state.timeLeft / 1000)}s left`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawCorridor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GravityScreenState,
  scale: number,
  now: number,
): void {
  const arena = arenaRect(width, height, scale);
  const mapX = (x: number) => arena.x + (x / VIEW_W) * arena.width;
  const mapY = (y: number) => arena.y + y * arena.height;
  const mapW = (w: number) => (w / VIEW_W) * arena.width;
  const mapH = (h: number) => h * arena.height;

  // Corridor plate.
  drawRoundRect(
    ctx,
    arena.x,
    arena.y,
    arena.width,
    arena.height,
    scaledSize(20, scale),
    "#0B0820",
    "rgba(0,229,255,0.28)",
    Math.max(1, scaledSize(2, scale)),
  );

  ctx.save();
  drawRoundRect(ctx, arena.x, arena.y, arena.width, arena.height, scaledSize(20, scale));
  ctx.clip();

  // Parallax grid.
  const scroll = (state.distance * 0.06) % 1;
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 20; i++) {
    const x = arena.x + ((i / 20 - scroll) % 1) * arena.width;
    ctx.beginPath();
    ctx.moveTo(x, arena.y);
    ctx.lineTo(x, arena.y + arena.height);
    ctx.stroke();
  }
  for (let i = 1; i < 6; i++) {
    const y = arena.y + (i / 6) * arena.height;
    ctx.beginPath();
    ctx.moveTo(arena.x, y);
    ctx.lineTo(arena.x + arena.width, y);
    ctx.stroke();
  }

  // Floor and ceiling.
  ctx.strokeStyle = "rgba(255,46,151,0.5)";
  ctx.lineWidth = Math.max(2, scaledSize(3, scale));
  ctx.beginPath();
  ctx.moveTo(arena.x, arena.y + arena.height);
  ctx.lineTo(arena.x + arena.width, arena.y + arena.height);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,229,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(arena.x, arena.y);
  ctx.lineTo(arena.x + arena.width, arena.y);
  ctx.stroke();

  // Distance ticks on the floor.
  ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = "rgba(245,243,255,0.30)";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (let d = 0; d < 6; d++) {
    const x = arena.x + ((d / 6 - scroll) % 1) * arena.width;
    ctx.fillText(`${state.distance + d * 20}m`, x, arena.y + arena.height - scaledSize(4, scale));
  }

  // Coins.
  state.coins.forEach((coin) => {
    const x = mapX(coin.x);
    const y = mapY(coin.y);
    const r = Math.max(4, scaledSize(9, scale));
    ctx.save();
    ctx.shadowColor = colors.amber;
    ctx.shadowBlur = 12;
    ctx.fillStyle = colors.amber;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Obstacles.
  state.obstacles.forEach((obs) => {
    const x = mapX(obs.x);
    const y = mapY(obs.y);
    const w = Math.max(3, mapW(obs.w));
    const h = Math.max(3, mapH(obs.h));

    ctx.save();
    if (obs.type === "spike") {
      ctx.fillStyle = "rgba(255,77,109,0.30)";
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = Math.max(1, scaledSize(2, scale));
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      drawRoundRect(ctx, x, y, w, h, scaledSize(6, scale), "rgba(255,77,109,0.38)", "rgba(255,77,109,0.9)", Math.max(1, scaledSize(2, scale)));
      ctx.strokeStyle = "rgba(255,77,109,0.45)";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + h * 0.5);
      ctx.lineTo(x + w * 0.8, y + h * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  });

  // Players.
  state.players.forEach((player, i) => {
    const x = mapX(player.x + 0.02);
    const y = mapY(player.y);
    const color = colors.player[i % colors.player.length];
    const r = Math.max(8, scaledSize(16, scale));

    ctx.save();
    ctx.globalAlpha = player.alive ? 1 : 0.3;
    ctx.shadowColor = color;
    ctx.shadowBlur = player.alive ? 16 : 0;
    ctx.fillStyle = player.alive ? color : "rgba(162,155,207,0.5)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Gravity arrow inside the orb.
    ctx.fillStyle = colors.bg0;
    ctx.beginPath();
    const dir = player.gravity === 1 ? 1 : -1;
    ctx.moveTo(x, y + dir * r * 0.5);
    ctx.lineTo(x - r * 0.35, y - dir * r * 0.1);
    ctx.lineTo(x + r * 0.35, y - dir * r * 0.1);
    ctx.closePath();
    ctx.fill();

    if (!player.alive) {
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = Math.max(1, scaledSize(2, scale));
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.6, y + r * 0.6);
      ctx.moveTo(x + r * 0.6, y - r * 0.6);
      ctx.lineTo(x - r * 0.6, y + r * 0.6);
      ctx.stroke();
    }
    ctx.restore();

    // Name above.
    const name = state.scores[i]?.name ?? `P${i + 1}`;
    ctx.font = `700 ${scaledSize(17, scale)}px ${fonts.display.family}`;
    const nw = ctx.measureText(name).width + scaledSize(14, scale);
    drawRoundRect(ctx, x - nw / 2, y - r - scaledSize(26, scale), nw, scaledSize(21, scale), scaledSize(10, scale), "rgba(11,8,32,0.82)");
    ctx.fillStyle = player.alive ? color : colors.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, x, y - r - scaledSize(15, scale));
  });

  // Timer bar along the top of the corridor.
  const progress = clamp(state.timeLeft / GAME_TIME_MS, 0, 1);
  drawRoundRect(ctx, arena.x + scaledSize(14, scale), arena.y + scaledSize(10, scale), arena.width - scaledSize(28, scale), scaledSize(6, scale), scaledSize(3, scale), "rgba(255,255,255,0.08)");
  drawRoundRect(
    ctx,
    arena.x + scaledSize(14, scale),
    arena.y + scaledSize(10, scale),
    Math.max(scaledSize(6, scale), (arena.width - scaledSize(28, scale)) * progress),
    scaledSize(6, scale),
    scaledSize(3, scale),
    progress > 0.25 ? colors.cyan : colors.danger,
  );

  ctx.restore();
  void now;
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GravityScreenState,
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

  // Coins per player.
  const detailTop = rail.y + listH + scaledSize(14, scale);
  state.scores.forEach((s, i) => {
    const y = detailTop + i * scaledSize(22, scale);
    if (y > rail.y + rail.height - scaledSize(10, scale)) return;
    ctx.font = `500 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(s.name, rail.x + scaledSize(6, scale), y);
    ctx.textAlign = "right";
    ctx.fillStyle = colors.amber;
    ctx.fillText(`${s.coins} coins`, rail.x + rail.width - scaledSize(6, scale), y);
  });
}
