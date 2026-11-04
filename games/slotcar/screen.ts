/**
 * Slot Car — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: an oval circuit with the three server-defined curve zones.
 * Cars are dots on the loop; the rail shows total distance and laps.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, emitHitBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, drawPill, clamp, easeOutCubic,
} from "../../client/screen/kit/index.ts";

interface SlotCar {
  name: string;
  progress: number;
  lap: number;
  speed: number;
  throttle: boolean;
  spunOut: boolean;
  finished: boolean;
}

interface SlotCarScreenState {
  phase: "countdown" | "racing" | "finished";
  countdown: number | null;
  trackLength: number;
  curves: Array<{ from: number; to: number; limit: number }>;
  maxLaps: number;
  cars: SlotCar[];
  finished: boolean;
  winner: { name: string; lap: number } | null;
}

/**
 * Metres driven so far.
 *
 * The server clamps a finished car's lap counter and wraps its progress back
 * to zero (the car sits on the start/finish line), so the distance of a
 * finished car has to be rebuilt from the lap count — otherwise the winner
 * appears to have driven less than the runner-up.
 */
function totalDistance(state: SlotCarScreenState, car: SlotCar): number {
  if (car.finished) return state.maxLaps * state.trackLength;
  return (car.lap - 1) * state.trackLength + car.progress;
}

interface SlotCarRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastCrashed: boolean[];
  countdownNumber: number | null;
  countdownChangedAt: number;
}

function createSlotCarRenderState(): SlotCarRenderState {
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

const renderState = (globalThis as any)._slotCarRenderState ||= createSlotCarRenderState();

export function renderSlotcar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SlotCarScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: SlotCarRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    state.cars.forEach((car, i) => {
      const was = rs.lastCrashed[i] ?? false;
      if (car.spunOut && !was) {
        triggerShake(rs.shake, 0.35, now);
        emitHitBurst(width * 0.45, height * 0.5, colors.danger, scale);
      }
      rs.lastCrashed[i] = car.spunOut;
    });

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

    drawHeader(ctx, width, height, state, scale);
    drawTrack(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);

    if (state.phase === "countdown" && state.countdown !== null) {
      drawCountdown(ctx, width, height, state.countdown, rs, now, scale);
    }
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: SlotCarScreenState,
  rs: SlotCarRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "countdown") {
    rs.titleCard = createTitleCard({
      title: "SLOT CAR",
      subtitle: "Hold the throttle — ease off in the curves",
      duration: 2000,
      fadeInDuration: 400,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
    rs.countdownNumber = null;
  }

  if (state.phase === "racing") {
    emitScoreBurst(width * 0.4, height * 0.4, 0, scaleForViewport(width, height));
  }

  if (state.phase === "finished" && state.winner) {
    const entries = buildRankedEntries(
      state.cars.map((c) => ({ name: c.name, score: totalDistance(state, c) })),
      state.winner.name,
    );
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Slot Car",
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
  const railW = Math.min(width * 0.26, scaledSize(380, scale));
  const headerH = scaledSize(52, scale);
  return {
    margin,
    headerH,
    railW,
    track: {
      x: margin,
      y: margin + headerH,
      width: width - margin * 2 - railW - gap,
      height: height - margin * 2 - headerH,
    },
    rail: {
      x: width - margin - railW,
      y: margin,
      width: railW,
      height: height - margin * 2,
    },
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SlotCarScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("SLOT CAR", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("SLOT CAR").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${state.maxLaps} laps  ·  ${state.trackLength} m`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SlotCarScreenState,
  scale: number,
  now: number,
): void {
  const { track } = layout(width, height, scale);
  const cx = track.x + track.width / 2;
  const cy = track.y + track.height / 2;
  const rx = track.width * 0.36;
  const ry = track.height * 0.33;
  const startAngle = -Math.PI / 2;

  // Track surface (thick ring).
  ctx.save();
  ctx.lineWidth = Math.max(18, scaledSize(30, scale));
  ctx.strokeStyle = "rgba(12,10,32,0.98)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.strokeStyle = "rgba(255,46,151,0.32)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Curve zones: the section of the loop where excess speed spins you out.
  for (const curve of state.curves) {
    const a0 = startAngle + (curve.from / state.trackLength) * Math.PI * 2;
    const a1 = startAngle + (curve.to / state.trackLength) * Math.PI * 2;
    ctx.lineWidth = Math.max(10, scaledSize(18, scale));
    ctx.strokeStyle = "rgba(255,77,109,0.30)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a0, a1);
    ctx.stroke();
  }

  // Dashed centre line.
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.strokeStyle = "rgba(0,229,255,0.13)";
  ctx.setLineDash([scaledSize(8, scale), scaledSize(12, scale)]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Start / finish line.
  const sx = cx + Math.cos(startAngle) * rx;
  const sy = cy + Math.sin(startAngle) * ry;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = Math.max(2, scaledSize(4, scale));
  ctx.beginPath();
  ctx.moveTo(sx - scaledSize(16, scale), sy);
  ctx.lineTo(sx + scaledSize(16, scale), sy);
  ctx.stroke();

  ctx.restore();

  // Cars.
  state.cars.forEach((car, i) => {
    const total = totalDistance(state, car);
    // A small angular offset keeps cars readable when they are level.
    const spread = (i - (state.cars.length - 1) / 2) * 0.035;
    const angle = startAngle + clamp(car.progress / state.trackLength, 0, 1) * Math.PI * 2 + spread;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    const color = colors.player[i % colors.player.length];
    const finished = car.finished;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.globalAlpha = finished ? 0.5 : 1;
    ctx.shadowColor = car.spunOut ? colors.danger : color;
    ctx.shadowBlur = car.spunOut ? 22 : 14;

    const cw = Math.min(scaledSize(26, scale), rx * 0.12);
    const ch = cw * 1.5;
    ctx.fillStyle = car.spunOut ? colors.danger : color;
    drawRoundRect(ctx, -cw / 2, -ch / 2, cw, ch, cw * 0.3, ctx.fillStyle as string);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(11,8,32,0.6)";
    drawRoundRect(ctx, -cw * 0.24, -ch * 0.18, cw * 0.48, ch * 0.34, cw * 0.12, ctx.fillStyle as string);
    ctx.restore();

    // Name plate outside the loop.
    const labelX = cx + Math.cos(angle) * (rx + scaledSize(34, scale));
    const labelY = cy + Math.sin(angle) * (ry + scaledSize(34, scale));
    ctx.font = `700 ${scaledSize(12, scale)}px ${fonts.display.family}`;
    const labelW = ctx.measureText(car.name).width + scaledSize(12, scale);
    drawRoundRect(ctx, labelX - labelW / 2, labelY - scaledSize(9, scale), labelW, scaledSize(18, scale), scaledSize(9, scale), "rgba(11,8,32,0.78)");
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(car.name, labelX, labelY);

    // Lap pips next to each name.
    const pipR = Math.max(1.5, scaledSize(2.4, scale));
    for (let l = 0; l < state.maxLaps; l++) {
      ctx.fillStyle = l < car.lap - 1 || car.finished ? color : "rgba(245,243,255,0.18)";
      ctx.beginPath();
      ctx.arc(labelX - (state.maxLaps - 1) * scaledSize(5, scale) + l * scaledSize(10, scale), labelY + scaledSize(14, scale), pipR, 0, Math.PI * 2);
      ctx.fill();
    }

    void total;
  });

  // Centre HUD plate keeps text readable over the synthwave sun.
  const plateW = Math.min(track.width * 0.42, scaledSize(300, scale));
  const plateH = scaledSize(150, scale);
  drawRoundRect(
    ctx,
    cx - plateW / 2,
    cy - plateH / 2,
    plateW,
    plateH,
    scaledSize(18, scale),
    "rgba(11,8,32,0.82)",
    "rgba(255,255,255,0.06)",
    1,
  );

  // Centre HUD.
  const leader = [...state.cars].sort(
    (a, b) => totalDistance(state, b) - totalDistance(state, a),
  )[0];
  if (leader) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${scaledSize(13, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("LAP", cx, cy - scaledSize(44, scale));

    ctx.font = `700 ${scaledSize(54, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(`${Math.min(leader.lap, state.maxLaps)}/${state.maxLaps}`, cx, cy - scaledSize(4, scale));

    ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.player[state.cars.indexOf(leader) % colors.player.length];
    ctx.fillText(`${leader.name}  ·  ${leader.speed} m/s`, cx, cy + scaledSize(34, scale));

    const curve = state.curves.find((c) => leader.progress >= c.from && leader.progress < c.to);
    if (curve) {
      const risky = leader.speed > curve.limit;
      const text = risky ? `TOO FAST — limit ${curve.limit}` : `Curve — limit ${curve.limit}`;
      const pillW = scaledSize(190, scale);
      drawPill(ctx, cx - pillW / 2, cy + scaledSize(50, scale), pillW, scaledSize(28, scale), risky ? "rgba(255,77,109,0.22)" : "rgba(255,179,71,0.16)", risky ? colors.danger : colors.amber, 1);
      ctx.font = `600 ${scaledSize(12, scale)}px ${fonts.body.family}`;
      ctx.fillStyle = risky ? colors.danger : colors.amber;
      ctx.fillText(text, cx, cy + scaledSize(64, scale));
    }
  }

  // Ambient speed ticks along the loop.
  if (state.phase === "racing") {
    ctx.strokeStyle = "rgba(0,229,255,0.10)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const a = (now * 0.0004 + i / 24) % 1 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rx + scaledSize(14, scale)), cy + Math.sin(a) * (ry + scaledSize(14, scale)));
      ctx.lineTo(cx + Math.cos(a) * (rx + scaledSize(22, scale)), cy + Math.sin(a) * (ry + scaledSize(22, scale)));
      ctx.stroke();
    }
  }
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number,
  rs: SlotCarRenderState,
  now: number,
  scale: number,
): void {
  const t = clamp((now - rs.countdownChangedAt) / 420, 0, 1);
  const pop = 0.72 + 0.28 * easeOutCubic(t);

  ctx.save();
  ctx.translate(width * 0.42, height * 0.46);
  ctx.scale(pop, pop);
  ctx.globalAlpha = 0.4 + 0.6 * (1 - t * 0.35);
  ctx.font = `700 ${scaledSize(150, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = colors.magenta;
  ctx.shadowBlur = 40;
  ctx.fillText(String(count), 0, 0);
  ctx.restore();
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SlotCarScreenState,
  scale: number,
): void {
  const { rail } = layout(width, height, scale);
  const n = Math.max(1, state.cars.length);
  const listH = Math.min(rail.height, scaledSize(80, scale) + n * scaledSize(70, scale));
  drawBentoCard(ctx, { ...rail, height: listH }, { glow: colors.magenta });

  const ranked = state.cars
    .map((c, i) => ({ c, i, total: totalDistance(state, c) }))
    .sort((a, b) => b.total - a.total);

  const entries = ranked.map(({ c, i }, rank) => ({
    name: c.name,
    score: Math.round(totalDistance(state, c)),
    playerIndex: i,
    isCurrent: rank === 0 && state.phase === "racing",
    isWinner: state.finished && state.winner?.name === c.name,
    animatedScore: Math.round(totalDistance(state, c)),
  }));

  drawScoreboard(ctx, { ...rail, height: listH }, entries, { title: "POSITIONS", scale });

  // Per-car lap line under the standings.
  const detailTop = rail.y + listH + scaledSize(12, scale);
  ranked.forEach(({ c, i }, idx) => {
    const y = detailTop + idx * scaledSize(28, scale);
    if (y > rail.y + rail.height - scaledSize(12, scale)) return;
    ctx.font = `500 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = c.spunOut ? colors.danger : colors.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(c.spunOut ? `${c.name} — spun out` : `${c.name} — lap ${Math.min(c.lap, state.maxLaps)}`, rail.x + scaledSize(6, scale), y);
    ctx.textAlign = "right";
    ctx.fillStyle = colors.player[i % colors.player.length];
    ctx.fillText(`${c.speed} m/s`, rail.x + rail.width - scaledSize(6, scale), y);
  });
}
