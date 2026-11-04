/**
 * Racing — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: a top-down neon track with a camera window around the
 * leader, so distant obstacles do not turn the road into noise.
 */

import {
  // Theme
  colors, fonts, scaleForViewport, scaledSize,
  // Background
  drawSynthwaveBackground,
  // Bento
  drawBentoCard, drawScoreboard,
  // Particles
  emitScoreBurst, emitHitBurst, updateParticles, drawParticles,
  // Shake
  createShake, triggerShake, applyShakeTransform,
  // Title Card
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  // Victory
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  // Utils
  drawRoundRect, clamp, easeOutCubic,
} from "../../client/screen/kit/index.ts";

interface RacingScreenState {
  phase: "countdown" | "racing" | "finished";
  countdown: number | null;
  lanes: number;
  finishDistance: number;
  racers: Array<{
    name: string;
    lane: number;
    progress: number;
    speed: number;
    crashed: boolean;
  }>;
  obstacles: Array<{ lane: number; distance: number }>;
  finished: boolean;
  winner: { name: string; progress: number } | null;
}

interface RacingRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastCrashed: boolean[];
  countdownNumber: number | null;
  countdownChangedAt: number;
}

function createRacingRenderState(): RacingRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastCrashed: [],
    countdownNumber: null,
    countdownChangedAt: 0,
  };
}

const renderState = (globalThis as any)._racingRenderState ||= createRacingRenderState();

/** How many metres of road the camera shows at once. */
const CAMERA_WINDOW_M = 230;

export function renderRacing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RacingScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: RacingRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    detectCrashes(state, rs, now, width, height, scale);

    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
    }
    if (!state.finished && rs.victoryScreen) rs.victoryScreen = null;

    if (state.phase === "countdown" && state.countdown !== rs.countdownNumber) {
      rs.countdownNumber = state.countdown;
      rs.countdownChangedAt = now;
    }

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

    renderTrack(ctx, width, height, state, scale, now);
    renderScoreboard(ctx, width, height, state, scale);

    if (state.phase === "countdown" && state.countdown !== null) {
      drawCountdownNumber(ctx, width, height, state.countdown, rs, now, scale);
    }

    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function detectCrashes(
  state: RacingScreenState,
  rs: RacingRenderState,
  now: number,
  width: number,
  height: number,
  scale: number,
): void {
  state.racers.forEach((racer, i) => {
    const was = rs.lastCrashed[i] ?? false;
    if (racer.crashed && !was) {
      triggerShake(rs.shake, 0.35, now);
      emitHitBurst(width * 0.5, height * 0.5, colors.danger, scale);
    }
    rs.lastCrashed[i] = racer.crashed;
  });
}

function handlePhaseChange(
  state: RacingScreenState,
  rs: RacingRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "countdown") {
    rs.titleCard = createTitleCard({
      title: "RACING",
      subtitle: "First to the finish line wins",
      duration: 1700,
      fadeInDuration: 400,
      holdDuration: 900,
      fadeOutDuration: 400,
    });
    showTitleCard(rs.titleCard, now);
    rs.countdownNumber = null;
  }

  if (state.phase === "racing") {
    emitScoreBurst(width * 0.5, height * 0.4, 0, scaleForViewport(width, height));
  }

  if (state.phase === "finished" && state.winner) {
    const entries = buildRankedEntries(
      state.racers.map((r) => ({ name: r.name, score: Math.round(r.progress * state.finishDistance) })),
      state.winner.name,
    );
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Racing",
        duration: 0,
        scoreSuffix: "m",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function layout(width: number, height: number, scale: number) {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const scoreWidth = Math.min(width * 0.26, scaledSize(380, scale));
  const headerH = scaledSize(52, scale);
  return {
    margin,
    gap,
    scoreWidth,
    headerH,
    track: {
      x: margin + scoreWidth + gap,
      y: margin + headerH,
      width: width - margin * 2 - scoreWidth - gap,
      height: height - margin * 2 - headerH,
    },
  };
}

function renderTrack(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RacingScreenState,
  scale: number,
  now: number,
): void {
  const { margin, track } = layout(width, height, scale);

  // Header
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("RACE", track.x, margin + scaledSize(26, scale));
  const raceW = ctx.measureText("RACE").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `First to ${state.finishDistance} m`,
    track.x + raceW + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );

  // Track surface
  ctx.save();
  const asphalt = ctx.createLinearGradient(track.x, track.y, track.x, track.y + track.height);
  asphalt.addColorStop(0, "rgba(24,18,60,0.99)");
  asphalt.addColorStop(0.5, "rgba(12,10,32,0.995)");
  asphalt.addColorStop(1, "rgba(8,6,22,0.995)");
  drawRoundRect(
    ctx,
    track.x,
    track.y,
    track.width,
    track.height,
    scaledSize(20, scale),
    asphalt,
    "rgba(255,46,151,0.35)",
    Math.max(1, scaledSize(2, scale)),
  );

  drawRoundRect(ctx, track.x, track.y, track.width, track.height, scaledSize(20, scale));
  ctx.clip();

  // Camera follows the leader; the road is a window, not the whole race.
  const distances = state.racers.map((r) => r.progress * state.finishDistance);
  const leaderDistance = distances.length ? Math.max(...distances) : 0;
  const camStart = clamp(leaderDistance - 70, 0, Math.max(0, state.finishDistance - CAMERA_WINDOW_M));
  const camEnd = camStart + CAMERA_WINDOW_M;

  const laneWidth = track.width / state.lanes;
  const laneX = (lane: number) => track.x + laneWidth * (lane + 0.5);
  const usableH = track.height - scaledSize(24, scale);
  const yFor = (distance: number) =>
    clamp(
      track.y + usableH - ((distance - camStart) / CAMERA_WINDOW_M) * usableH + scaledSize(8, scale),
      track.y + scaledSize(6, scale),
      track.y + track.height - scaledSize(10, scale),
    );

  // Rolling speed lines.
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  const lineScroll = (now * 0.05) % 70;
  for (let y = track.y - 70 + lineScroll; y < track.y + track.height; y += 70) {
    ctx.beginPath();
    ctx.moveTo(track.x, y);
    ctx.lineTo(track.x + track.width, y);
    ctx.stroke();
  }

  // Lane separators.
  for (let i = 1; i < state.lanes; i++) {
    const x = track.x + laneWidth * i;
    ctx.strokeStyle = "rgba(0,229,255,0.12)";
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.setLineDash([scaledSize(14, scale), scaledSize(20, scale)]);
    ctx.beginPath();
    ctx.moveTo(x, track.y);
    ctx.lineTo(x, track.y + track.height);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Distance ticks every 50 m inside the camera window.
  ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let d = Math.ceil(camStart / 50) * 50; d <= camEnd; d += 50) {
    const y = yFor(d);
    ctx.strokeStyle = "rgba(245,243,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(track.x + track.width - scaledSize(16, scale), y);
    ctx.lineTo(track.x + track.width, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,243,255,0.52)";
    ctx.fillText(`${d}`, track.x + track.width - scaledSize(22, scale), y);
  }

  // Finish line, only when it enters the camera window.
  if (state.finishDistance >= camStart && state.finishDistance <= camEnd) {
    const finishY = yFor(state.finishDistance);
    const square = scaledSize(12, scale);
    for (let i = 0; i * square < track.width; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(245,243,255,0.92)" : "rgba(11,8,32,0.92)";
      ctx.fillRect(track.x + i * square, finishY - square, square, square);
    }
    ctx.fillStyle = colors.success;
    ctx.font = `700 ${scaledSize(11, scale)}px ${fonts.title.family}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("FINISH", track.x + track.width - scaledSize(6, scale), finishY - square - scaledSize(4, scale));
  }

  // Obstacles inside the camera window.
  for (const obs of state.obstacles) {
    if (obs.distance < camStart - 5 || obs.distance > camEnd + 5) continue;
    const x = laneX(obs.lane);
    const y = yFor(obs.distance);
    const size = Math.min(laneWidth * 0.28, scaledSize(30, scale));

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(255,77,109,0.18)";
    ctx.strokeStyle = "rgba(255,77,109,0.8)";
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.55);
    ctx.lineTo(size * 0.62, size * 0.45);
    ctx.lineTo(-size * 0.62, size * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,77,109,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.18);
    ctx.lineTo(size * 0.3, size * 0.22);
    ctx.lineTo(-size * 0.3, size * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  // Cars, slowest first so leaders sit on top.
  const order = state.racers
    .map((r, i) => ({ r, i, d: r.progress * state.finishDistance }))
    .sort((a, b) => a.d - b.d);

  for (const { r, i, d } of order) {
    const behindCamera = d < camStart - 8;
    const stagger = (i - (state.racers.length - 1) / 2) * laneWidth * 0.2;
    const x = laneX(r.lane) + stagger;
    const y = yFor(d);

    ctx.save();
    if (behindCamera) ctx.globalAlpha = 0.35;
    drawCar(ctx, x, y, laneWidth, i, r.crashed, scale);

    // Name label above the car.
    ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    const nameW = ctx.measureText(r.name).width + scaledSize(18, scale);
    drawRoundRect(
      ctx,
      x - nameW / 2,
      y - scaledSize(42, scale),
      nameW,
      scaledSize(25, scale),
      scaledSize(8, scale),
      "rgba(11,8,32,0.82)",
    );
    ctx.fillStyle = colors.player[i % colors.player.length];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(r.name, x, y - scaledSize(29, scale));

    if (r.speed > 0 && !r.crashed && !behindCamera) {
      ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
      ctx.fillStyle = "rgba(245,243,255,0.5)";
      ctx.textBaseline = "top";
      ctx.fillText(`${Math.round(r.speed)} m/s`, x, y + scaledSize(20, scale));
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  laneWidth: number,
  playerIndex: number,
  crashed: boolean,
  scale: number,
): void {
  const color = colors.player[playerIndex % colors.player.length];
  const w = Math.min(laneWidth * 0.4, scaledSize(46, scale));
  const h = w * 1.7;

  ctx.save();
  ctx.translate(x, y);
  if (crashed) ctx.rotate(Math.sin(performance.now() * 0.05) * 0.07);

  // Wheels
  ctx.fillStyle = "rgba(5,4,14,0.98)";
  drawRoundRect(ctx, -w / 2 - w * 0.08, -h * 0.3, w * 0.18, h * 0.2, w * 0.05, ctx.fillStyle as string);
  drawRoundRect(ctx, w / 2 - w * 0.1, -h * 0.3, w * 0.18, h * 0.2, w * 0.05, ctx.fillStyle as string);
  drawRoundRect(ctx, -w / 2 - w * 0.08, h * 0.1, w * 0.18, h * 0.22, w * 0.05, ctx.fillStyle as string);
  drawRoundRect(ctx, w / 2 - w * 0.1, h * 0.1, w * 0.18, h * 0.22, w * 0.05, ctx.fillStyle as string);

  // Body: pointed nose, wide rear.
  ctx.shadowColor = crashed ? colors.danger : color;
  ctx.shadowBlur = crashed ? 26 : 18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.quadraticCurveTo(w / 2, -h * 0.28, w / 2, 0);
  ctx.lineTo(w * 0.44, h / 2);
  ctx.lineTo(-w * 0.44, h / 2);
  ctx.lineTo(-w / 2, 0);
  ctx.quadraticCurveTo(-w / 2, -h * 0.28, 0, -h / 2);
  ctx.closePath();
  ctx.fill();

  // Cockpit
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(8,6,22,0.62)";
  drawRoundRect(ctx, -w * 0.24, -h * 0.12, w * 0.48, h * 0.34, w * 0.18, ctx.fillStyle as string);

  // Nose light
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  drawRoundRect(ctx, -w * 0.14, -h * 0.47, w * 0.28, h * 0.06, w * 0.03, ctx.fillStyle as string);

  if (crashed) {
    ctx.strokeStyle = colors.danger;
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    for (let a = 0; a < 4; a++) {
      const angle = (Math.PI / 2) * a + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * w * 0.55, Math.sin(angle) * h * 0.35);
      ctx.lineTo(Math.cos(angle) * w * 0.95, Math.sin(angle) * h * 0.6);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawCountdownNumber(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number,
  rs: RacingRenderState,
  now: number,
  scale: number,
): void {
  const t = clamp((now - rs.countdownChangedAt) / 420, 0, 1);
  const eased = easeOutCubic(t);
  const scaleUp = 0.72 + 0.28 * eased;

  ctx.save();
  ctx.translate(width / 2, height * 0.44);
  ctx.scale(scaleUp, scaleUp);
  ctx.globalAlpha = 0.4 + 0.6 * (1 - t * 0.35);

  ctx.font = `700 ${scaledSize(150, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = colors.magenta;
  ctx.shadowBlur = 40;
  ctx.fillText(String(count), 0, 0);
  ctx.restore();

  ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Get ready", width / 2, height * 0.44 + scaledSize(104, scale));
}

function renderScoreboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RacingScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(16, scale);
  const scoreWidth = Math.min(width * 0.26, scaledSize(380, scale));
  const x = margin;
  const y = margin;
  const w = scoreWidth;
  const maxH = height - margin * 2;

  const ranked = state.racers
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.progress - a.r.progress);

  const entries = ranked.map(({ r, i }, rank) => ({
    name: r.name,
    score: Math.round(r.progress * state.finishDistance),
    playerIndex: i,
    isCurrent: rank === 0 && state.phase === "racing",
    isWinner: state.finished && state.winner?.name === r.name,
    animatedScore: Math.round(r.progress * state.finishDistance),
  }));

  // Card 1: standings.
  const standingsH = Math.min(maxH, scaledSize(64, scale) * entries.length + scaledSize(80, scale));
  const standingsRect = { x, y, width: w, height: standingsH };
  drawBentoCard(ctx, standingsRect, { glow: colors.magenta });
  drawScoreboard(ctx, standingsRect, entries, { title: "STANDINGS", scale });

  // Card 2: overall race progress.
  const progressTop = y + standingsH + gap;
  const progressH = Math.min(
    maxH - standingsH - gap,
    scaledSize(46, scale) * ranked.length + scaledSize(112, scale),
  );
  if (progressH <= 0) return;

  const progressRect = { x, y: progressTop, width: w, height: progressH };
  drawBentoCard(ctx, progressRect, { fill: "rgba(18,13,46,0.76)", stroke: colors.border });

  const pad = scaledSize(20, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${scaledSize(12, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("RACE PROGRESS", x + pad, progressTop + scaledSize(22, scale));

  const barW = w - pad * 2 - scaledSize(66, scale);
  const barTop = progressTop + scaledSize(52, scale);
  const rowH = Math.min(scaledSize(40, scale), (progressH - scaledSize(104, scale)) / Math.max(1, ranked.length));

  ranked.forEach(({ r, i }, idx) => {
    const rowY = barTop + idx * rowH + rowH / 2;
    const color = colors.player[i % colors.player.length];

    ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "left";
    ctx.fillText(r.name.slice(0, 7), x + pad, rowY);

    const bx = x + pad + scaledSize(66, scale);
    const bh = scaledSize(6, scale);
    drawRoundRect(ctx, bx, rowY - bh / 2, barW, bh, bh / 2, "rgba(255,255,255,0.08)");
    drawRoundRect(ctx, bx, rowY - bh / 2, Math.max(bh, barW * clamp(r.progress, 0, 1)), bh, bh / 2, color);
  });

  // Leader callout inside the progress card.
  if (state.phase !== "countdown" && ranked.length > 0 && progressH > scaledSize(96, scale)) {
    const leader = ranked[0];
    const ly = progressTop + progressH - scaledSize(22, scale);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("LEADER", x + pad, ly);
    ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.player[leader.i % colors.player.length];
    ctx.fillText(leader.r.name, x + pad + scaledSize(66, scale), ly);
  }
}
