/**
 * Golf — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: the current hole, the ball, aim and power, and the stroke
 * leaderboard. Coordinates are normalised 0..1 on the server; y grows downward,
 * so they map straight onto the canvas.
 */

import {
  // Theme
  colors, fonts, scaleForViewport, scaledSize,
  // Background
  drawSynthwaveBackground,
  // Bento
  drawBentoCard, drawScoreboard,
  // Particles
  emitScoreBurst, updateParticles, drawParticles,
  // Shake
  createShake, triggerShake, applyShakeTransform,
  // Title Card
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  // Victory
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen,
  type RankedEntry,
  // Utils
  drawRoundRect, drawPill, clamp,
} from "../../client/screen/kit/index.ts";

interface GolfScreenState {
  phase: "aiming" | "moving" | "hole-done" | "finished";
  ball: { x: number; y: number; vx: number; vy: number };
  hole: { x: number; y: number; r: number };
  obstacles: Array<{ x: number; y: number; r: number }>;
  power: number;
  angle: number;
  currentPlayer: number;
  holeNumber: number;
  maxHoles: number;
  par: number;
  holeStrokes: number[];
  scores: Array<{
    name: string;
    totalStrokes: number;
    holeStrokes: number;
    holesCompleted: number;
  }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface GolfRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastHole: number;
  holeChangedAt: number;
}

function createGolfRenderState(): GolfRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastHole: 0,
    holeChangedAt: 0,
  };
}

const renderState = (globalThis as any)._golfRenderState ||= createGolfRenderState();

export function renderGolf(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GolfScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: GolfRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.holeNumber !== rs.lastHole) {
      rs.lastHole = state.holeNumber;
      rs.holeChangedAt = now;
    }

    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height, scale);
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

    drawCourse(ctx, width, height, state, scale);
    drawHeader(ctx, width, height, state, scale);
    drawRail(ctx, width, height, state, scale);
    drawHoleBanner(ctx, width, height, state, rs, now, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: GolfScreenState,
  rs: GolfRenderState,
  now: number,
  width: number,
  height: number,
  scale: number,
): void {
  if (state.phase === "aiming" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "MINI GOLF",
      subtitle: "Aim, charge, putt — lowest strokes wins",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.phase === "hole-done") {
    const arena = courseRect(width, height, scale);
    emitScoreBurst(
      arena.x + state.hole.x * arena.size,
      arena.y + state.hole.y * arena.size,
      0,
      scale,
    );
    triggerShake(rs.shake, 0.3, now);
  }

  if (state.phase === "finished" && state.winner) {
    // Lower is better in golf, so build the ranking explicitly.
    const ranked = state.scores
      .map((s, i) => ({ ...s, playerIndex: i }))
      .sort((a, b) => a.totalStrokes - b.totalStrokes)
      .map<RankedEntry>((s, i) => ({
        rank: i + 1,
        name: s.name,
        score: s.totalStrokes,
        playerIndex: s.playerIndex,
        isWinner: s.name === state.winner!.name,
      }));
    const winner = ranked.find((r) => r.isWinner) ?? ranked[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: ranked,
        gameName: "Golf",
        duration: 0,
        scoreSuffix: "strokes",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function courseRect(
  width: number,
  height: number,
  scale: number,
): { x: number; y: number; size: number } {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const headerH = scaledSize(60, scale);
  const availableW = width - margin * 2 - railW - gap;
  const availableH = height - margin * 2 - headerH;
  const size = Math.min(availableW, availableH);
  return {
    x: margin + Math.max(0, (availableW - size) / 2),
    y: margin + headerH + Math.max(0, (availableH - size) / 2),
    size,
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GolfScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("GOLF", margin, margin + scaledSize(26, scale));
  const titleW = ctx.measureText("GOLF").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `Hole ${state.holeNumber} of ${state.maxHoles}  ·  Par ${state.par}`,
    margin + titleW + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
}

function drawCourse(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GolfScreenState,
  scale: number,
): void {
  const arena = courseRect(width, height, scale);
  const { x, y, size } = arena;
  const unit = size; // 0..1 → pixels

  ctx.save();

  // Frame
  drawRoundRect(
    ctx,
    x - scaledSize(8, scale),
    y - scaledSize(8, scale),
    size + scaledSize(16, scale),
    size + scaledSize(16, scale),
    scaledSize(22, scale),
    "rgba(10,12,34,0.92)",
    "rgba(61,255,162,0.30)",
    Math.max(1, scaledSize(2, scale)),
  );

  // Putting surface
  const green = ctx.createLinearGradient(x, y, x + size, y + size);
  green.addColorStop(0, "#0E3B34");
  green.addColorStop(0.55, "#0B2F2B");
  green.addColorStop(1, "#092523");
  ctx.fillStyle = green;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, scaledSize(16, scale));
  ctx.fill();

  // Mowing stripes
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, scaledSize(16, scale));
  ctx.clip();
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) continue;
    ctx.fillStyle = "rgba(255,255,255,0.022)";
    ctx.fillRect(x, y + (i / 8) * size, size, size / 8);
  }
  // Faint distance rings around the cup.
  ctx.strokeStyle = "rgba(0,229,255,0.06)";
  ctx.lineWidth = 1;
  for (let r = 0.2; r <= 0.8; r += 0.2) {
    ctx.beginPath();
    ctx.arc(x + state.hole.x * unit, y + state.hole.y * unit, r * unit, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Obstacles (rocks)
  for (const obs of state.obstacles ?? []) {
    const ox = x + obs.x * unit;
    const oy = y + obs.y * unit;
    const or = Math.max(scaledSize(8, scale), obs.r * unit);
    ctx.save();
    ctx.shadowColor = "rgba(139,92,246,0.55)";
    ctx.shadowBlur = scaledSize(14, scale);
    ctx.fillStyle = "#3B3462";
    ctx.beginPath();
    ctx.arc(ox, oy, or, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(245,243,255,0.16)";
    ctx.beginPath();
    ctx.arc(ox - or * 0.22, oy - or * 0.22, or * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(139,92,246,0.8)";
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.beginPath();
    ctx.arc(ox, oy, or, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Cup + flag
  const cupX = x + state.hole.x * unit;
  const cupY = y + state.hole.y * unit;
  const cupR = Math.max(scaledSize(7, scale), state.hole.r * unit);
  ctx.fillStyle = "#05040F";
  ctx.beginPath();
  ctx.arc(cupX, cupY, cupR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.cyan;
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.arc(cupX, cupY, cupR, 0, Math.PI * 2);
  ctx.stroke();

  // Flag pole, slightly right of the cup so the ball stays visible.
  const poleH = scaledSize(58, scale);
  ctx.strokeStyle = "rgba(245,243,255,0.7)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.moveTo(cupX + cupR * 0.5, cupY);
  ctx.lineTo(cupX + cupR * 0.5, cupY - poleH);
  ctx.stroke();
  ctx.fillStyle = colors.magenta;
  ctx.beginPath();
  ctx.moveTo(cupX + cupR * 0.5, cupY - poleH);
  ctx.lineTo(cupX + cupR * 0.5 + scaledSize(26, scale), cupY - poleH + scaledSize(9, scale));
  ctx.lineTo(cupX + cupR * 0.5, cupY - poleH + scaledSize(18, scale));
  ctx.closePath();
  ctx.fill();

  // Ball trail
  const bx = x + state.ball.x * unit;
  const by = y + state.ball.y * unit;
  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  if (speed > 0.02) {
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const tx = x + (state.ball.x - state.ball.vx * t * 0.06) * unit;
      const ty = y + (state.ball.y - state.ball.vy * t * 0.06) * unit;
      ctx.fillStyle = `rgba(0,229,255,${(0.28 * (1 - t)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(1.5, scaledSize(7, scale) * (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Aim guide while aiming.
  if (state.phase === "aiming") {
    const reach = unit * (0.18 + state.power * 0.42);
    const endX = bx + Math.cos(state.angle) * reach;
    const endY = by + Math.sin(state.angle) * reach;

    ctx.save();
    ctx.setLineDash([scaledSize(10, scale), scaledSize(10, scale)]);
    ctx.strokeStyle = "rgba(255,179,71,0.75)";
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow head
    const head = scaledSize(10, scale);
    ctx.fillStyle = colors.amber;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - Math.cos(state.angle) * head + Math.cos(state.angle + Math.PI / 2) * head * 0.5,
      endY - Math.sin(state.angle) * head + Math.sin(state.angle + Math.PI / 2) * head * 0.5,
    );
    ctx.lineTo(
      endX - Math.cos(state.angle) * head - Math.cos(state.angle + Math.PI / 2) * head * 0.5,
      endY - Math.sin(state.angle) * head - Math.sin(state.angle + Math.PI / 2) * head * 0.5,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Ball
  ctx.save();
  ctx.shadowColor = colors.cyan;
  ctx.shadowBlur = scaledSize(16, scale);
  ctx.fillStyle = "#F5F3FF";
  ctx.beginPath();
  ctx.arc(bx, by, Math.max(scaledSize(6, scale), scaledSize(9, scale)), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(11,8,32,0.18)";
  ctx.beginPath();
  ctx.arc(bx - 2, by - 2, Math.max(1.5, scaledSize(2.4, scale)), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Power meter on the inner right edge.
  drawPowerMeter(ctx, x + size - scaledSize(26, scale), y + size * 0.5, scaledSize(14, scale), size * 0.5, state.power, scale, state.phase === "aiming");

  // Whose turn it is, inside the course so it does not collide with the rail.
  const player = state.scores[state.currentPlayer];
  if (player && state.phase !== "finished") {
    ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
    const label = `${player.name} to putt`;
    const labelW = ctx.measureText(label).width + scaledSize(24, scale);
    drawPill(
      ctx,
      x + scaledSize(14, scale),
      y + scaledSize(14, scale),
      labelW,
      scaledSize(28, scale),
      "rgba(11,8,32,0.72)",
      "rgba(255,255,255,0.12)",
      1,
    );
    ctx.fillStyle = colors.player[state.currentPlayer % colors.player.length];
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + scaledSize(26, scale), y + scaledSize(14, scale) + scaledSize(14, scale));
  }

  ctx.restore();
}

function drawPowerMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  w: number,
  h: number,
  power: number,
  scale: number,
  active: boolean,
): void {
  const top = cy - h / 2;
  ctx.save();
  drawRoundRect(ctx, x, top, w, h, w / 2, "rgba(11,8,32,0.6)", "rgba(255,255,255,0.12)", 1);

  const p = clamp(power, 0, 1);
  const fillH = Math.max(0, h * p);
  if (fillH > 2) {
    const color = p > 0.75 ? colors.danger : p > 0.45 ? colors.amber : colors.cyan;
    drawRoundRect(ctx, x, top + (h - fillH), w, fillH, w / 2, color);
  }

  // Tick marks
  ctx.strokeStyle = "rgba(11,8,32,0.7)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const ty = top + (h * i) / 5;
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x + w, ty);
    ctx.stroke();
  }

  ctx.font = `700 ${scaledSize(11, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = active ? colors.text : colors.textMuted;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${Math.round(p * 100)}%`, x + w / 2, top - scaledSize(8, scale));
  ctx.restore();
}

function drawHoleBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GolfScreenState,
  rs: GolfRenderState,
  now: number,
  scale: number,
): void {
  const age = now - rs.holeChangedAt;
  if (age > 1600 || state.phase === "finished") return;
  const alpha = age < 900 ? 1 : 1 - (age - 900) / 700;
  const arena = courseRect(width, height, scale);

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  const text = `HOLE ${state.holeNumber}  ·  PAR ${state.par}`;
  ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.title.family}`;
  const textW = ctx.measureText(text).width + scaledSize(44, scale);
  const bw = textW;
  const bh = scaledSize(44, scale);
  const bx = arena.x + arena.size / 2 - bw / 2;
  const by = arena.y + scaledSize(18, scale);
  drawPill(ctx, bx, by, bw, bh, "rgba(11,8,32,0.78)", "rgba(255,46,151,0.5)", Math.max(1, scaledSize(2, scale)));
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
  ctx.restore();
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GolfScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const n = Math.max(1, state.scores.length);
  const listH = scaledSize(80, scale) + n * scaledSize(70, scale);
  const railH = Math.min(height - margin * 2, listH + n * scaledSize(22, scale) + scaledSize(32, scale));
  const rect = { x: width - margin - railW, y: margin, width: railW, height: railH };
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.86)", stroke: colors.border });

  const ranked = state.scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.totalStrokes - b.s.totalStrokes);

  const entries = ranked.map(({ s, i }) => ({
    name: s.name,
    score: s.totalStrokes,
    playerIndex: i,
    isCurrent: state.currentPlayer === i && state.phase !== "finished",
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: s.totalStrokes,
  }));

  drawScoreboard(ctx, { ...rect, height: listH }, entries, { title: "STROKES", scale });

  // This-hole detail, directly under the standings rather than pinned to the
  // bottom of a mostly empty rail.
  const detailTop = rect.y + listH + scaledSize(8, scale);

  if (detailTop + entries.length * scaledSize(22, scale) < rect.y + rect.height - scaledSize(10, scale)) {
    ranked.forEach(({ s, i }, idx) => {
      const py = detailTop + idx * scaledSize(22, scale);
      ctx.font = `500 ${scaledSize(12, scale)}px ${fonts.body.family}`;
      ctx.fillStyle = state.currentPlayer === i ? colors.text : colors.textMuted;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`Hole ${s.holeStrokes}`, rect.x + scaledSize(22, scale), py);
      ctx.textAlign = "right";
      ctx.fillText(
        `${s.holesCompleted}/${state.maxHoles} done`,
        rect.x + rect.width - scaledSize(22, scale),
        py,
      );
    });
  }
}
