/**
 * Knife Throw — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * The server compares absolute throw angles, so knives are drawn at their
 * recorded angles and a rotating marker shows where the next throw lands.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, emitHitBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect,
} from "../../client/screen/kit/index.ts";

interface Knife {
  playerIndex: number;
  angle: number;
  round: number;
}

interface KnifeThrowScreenState {
  angle: number;
  knives: Knife[];
  currentPlayer: number;
  round: number;
  maxRounds: number;
  knivesLeft: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface KnifeThrowRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastScores: number[];
  lastKnifeCount: number;
}

function createKnifeThrowRenderState(): KnifeThrowRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastScores: [],
    lastKnifeCount: 0,
  };
}

const renderState = (globalThis as any)._knifeThrowRenderState ||= createKnifeThrowRenderState();

export function renderKnifethrow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: KnifeThrowScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: KnifeThrowRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    const target = targetRect(width, height, scale);
    if (state.knives.length > rs.lastKnifeCount) {
      // Burst at the rim, not the centre, so the HUD stays readable.
      emitScoreBurst(
        target.cx + Math.cos(state.angle) * target.r * 0.8,
        target.cy + Math.sin(state.angle) * target.r * 0.8,
        state.currentPlayer,
        scale,
      );
      triggerShake(rs.shake, 0.15, now);
    }
    rs.lastKnifeCount = state.knives.length;
    state.scores.forEach((p, i) => {
      const prev = rs.lastScores[i];
      if (prev !== undefined && p.score < prev) {
        emitHitBurst(target.cx, target.cy, colors.danger, scale);
        triggerShake(rs.shake, 0.3, now);
      }
      rs.lastScores[i] = p.score;
    });

    if (state.finished && !rs.victoryScreen && state.winner) {
      const entries = buildRankedEntries(state.scores, state.winner.name);
      const winner = entries.find((e) => e.isWinner) ?? entries[0];
      if (winner) {
        rs.victoryScreen = createVictoryScreen({
          winner,
          rankings: entries,
          gameName: "Knife Throw",
          duration: 0,
          scoreSuffix: "pts",
        });
        showVictoryScreen(rs.victoryScreen, now, width, height);
        triggerShake(rs.shake, 0.5, now);
      }
    }

    const phase = state.finished ? "finished" : "playing";
    if (phase !== rs.lastPhase && !state.finished) {
      rs.titleCard = createTitleCard({
        title: "KNIFE THROW",
        subtitle: "Tap — don't hit a knife",
        duration: 2200,
        fadeInDuration: 450,
        holdDuration: 1100,
        fadeOutDuration: 500,
      });
      showTitleCard(rs.titleCard, now);
    }
    rs.lastPhase = phase;
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
    drawTarget(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function targetRect(
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
    r: Math.min(availableW, availableH) * 0.4,
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: KnifeThrowScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("KNIFE THROW", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("KNIFE THROW").width;

  const player = state.scores[state.currentPlayer];
  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `Round ${state.round} of ${state.maxRounds}${player ? `  ·  ${player.name} throwing` : ""}`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: KnifeThrowScreenState,
  scale: number,
  now: number,
): void {
  const { cx, cy, r } = targetRect(width, height, scale);

  // Target body.
  ctx.save();
  const disc = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
  disc.addColorStop(0, "rgba(40,26,92,0.95)");
  disc.addColorStop(0.7, "rgba(20,14,52,0.98)");
  disc.addColorStop(1, "rgba(10,8,28,1)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Concentric rings.
  const rings = [
    { at: 0.92, color: "rgba(255,46,151,0.30)" },
    { at: 0.72, color: "rgba(0,229,255,0.22)" },
    { at: 0.52, color: "rgba(255,46,151,0.30)" },
    { at: 0.32, color: "rgba(0,229,255,0.22)" },
  ];
  for (const ring of rings) {
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = Math.max(1, scaledSize(3, scale));
    ctx.beginPath();
    ctx.arc(cx, cy, r * ring.at, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Bullseye.
  ctx.fillStyle = "rgba(61,255,162,0.16)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
  ctx.fill();

  // Rotating tick marks show the target's rotation.
  ctx.strokeStyle = "rgba(245,243,255,0.18)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  for (let i = 0; i < 24; i++) {
    const a = state.angle + (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.restore();

  // Knives at their recorded absolute angles.
  state.knives.forEach((knife) => {
    const a = knife.angle;
    const px = cx + Math.cos(a) * r * 0.62;
    const py = cy + Math.sin(a) * r * 0.62;
    const color = colors.player[knife.playerIndex % colors.player.length];

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI / 2);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    const bladeL = r * 0.24;
    const bladeW = r * 0.05;
    ctx.fillStyle = "#F5F3FF";
    ctx.beginPath();
    ctx.moveTo(0, -bladeL * 0.5);
    ctx.lineTo(bladeW, bladeL * 0.2);
    ctx.lineTo(-bladeW, bladeL * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    drawRoundRect(ctx, -bladeW * 0.7, bladeL * 0.18, bladeW * 1.4, bladeL * 0.7, bladeW * 0.4, ctx.fillStyle as string);
    ctx.restore();
  });

  // Launch marker at the current throw angle.
  const mx = cx + Math.cos(state.angle) * r * 1.06;
  const my = cy + Math.sin(state.angle) * r * 1.06;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(state.angle + Math.PI);
  ctx.fillStyle = colors.amber;
  ctx.shadowColor = colors.amber;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(scaledSize(12, scale), 0);
  ctx.lineTo(-scaledSize(6, scale), scaledSize(8, scale));
  ctx.lineTo(-scaledSize(6, scale), -scaledSize(8, scale));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Centre HUD: round and throws left.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(44, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(String(state.knivesLeft), cx, cy - scaledSize(4, scale));
  ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("KNIVES LEFT", cx, cy + scaledSize(22, scale));

  // Rotating marker pulse.
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
  ctx.globalAlpha = 0.25 + 0.35 * pulse;
  ctx.strokeStyle = colors.amber;
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.06, state.angle - 0.06, state.angle + 0.06);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: KnifeThrowScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const n = Math.max(1, state.scores.length);
  const listH = Math.min(height - margin * 2, scaledSize(80, scale) + n * scaledSize(72, scale));
  const rect = { x: width - margin - railW, y: margin, width: railW, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.magenta });

  const entries = state.scores.map((s, i) => ({
    name: s.name,
    score: s.score,
    playerIndex: i,
    isCurrent: i === state.currentPlayer && !state.finished,
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: s.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "SCORES", scale });

  // Round progress: one pip per round.
  const pipY = rect.y + rect.height + scaledSize(18, scale);
  for (let i = 0; i < state.maxRounds; i++) {
    const px = rect.x + scaledSize(6, scale) + i * scaledSize(18, scale);
    ctx.fillStyle = i < state.round - 1 ? colors.magenta : i === state.round - 1 ? colors.cyan : "rgba(245,243,255,0.16)";
    ctx.beginPath();
    ctx.arc(px, pipY, scaledSize(4, scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `600 ${scaledSize(12, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`Round ${state.round}/${state.maxRounds}`, rect.x + scaledSize(6 + state.maxRounds * 18, scale), pipY);
}
