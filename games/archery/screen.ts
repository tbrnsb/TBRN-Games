/**
 * Archery — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Side-on range. The server works in normalised units: targetX ∈ [-1, 1],
 * arrow.x starts at -1 and flies right, y is height above the ground.
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
import { paperTitle, paperMeta } from "../../client/screen/kit/header.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";
import type { SeatIdentity } from "../../shared/seat-identity.ts";

interface ArcheryShot {
  playerIndex: number;
  x: number;
  y: number;
  score: number;
  round: number;
  /** Target centre when the arrow landed, so the marker stays on it as it slides. */
  targetX?: number;
  seat?: SeatIdentity;
}

interface ArcheryScreenState {
  phase: "aiming" | "flying" | "scoring" | "finished";
  targetX: number;
  targetWidth: number;
  drawPower: number;
  isDrawing: boolean;
  arrow: { x: number; y: number } | null;
  currentPlayer: number;
  currentPlayerName?: string | null;
  round: number;
  maxRounds: number;
  scores: Array<{ name: string; score: number; seat?: SeatIdentity }>;
  shots: ArcheryShot[];
  turnOrder?: Array<{ name: string; seat?: SeatIdentity; isCurrent?: boolean }>;
  waitingOn?: string[];
  caption?: string | null;
  sound?: string | null;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface ArcheryRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastRound: number;
  lastShotKey: string;
  lastScore: number;
  hitAt: number;
}

function createArcheryRenderState(): ArcheryRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastRound: 0,
    lastShotKey: "",
    lastScore: 0,
    hitAt: 0,
  };
}

const renderState = (globalThis as any)._archeryRenderState ||= createArcheryRenderState();

const WORLD_MIN = -1;
const WORLD_MAX = 1.5;

/** This renderer draws its own score rail; the platform ticker stays off. */
export const showsScores = true;

export function renderArchery(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: ArcheryScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: ArcheryRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    const range = rangeRect(width, height, scale);
    // The server sends only the last five shots, so the list length stops
    // growing after the fifth arrow. Compare the newest shot itself instead
    // of counting, or every shot after the fifth would go unnoticed.
    const newest = state.shots[state.shots.length - 1];
    const shotKey = newest
      ? `${newest.playerIndex}:${newest.x.toFixed(3)}:${newest.y.toFixed(3)}:${newest.score}:${newest.round}`
      : "";
    if (shotKey && shotKey !== rs.lastShotKey) {
      const shot = newest!;
      rs.lastScore = shot.score;
      rs.hitAt = now;
      if (shot.score > 0) {
        emitScoreBurst(worldToX(shot.x, range, scale), range.targetY, state.currentPlayer, scale);
        triggerShake(rs.shake, 0.18, now);
      } else {
        emitHitBurst(worldToX(shot.x, range, scale), range.groundY, colors.danger, scale);
      }
    }
    rs.lastShotKey = shotKey;

    if (state.phase !== rs.lastPhase || state.round !== rs.lastRound) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
      rs.lastRound = state.round;
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
    drawRange(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: ArcheryScreenState,
  rs: ArcheryRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "aiming" && state.round === 1 && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "ARCHERY",
      subtitle: "Hold, aim, release — closest to the bull",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.finished && state.winner) {
    const entries = buildRankedEntries(state.scores, state.winner.name);
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Archery",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function rangeRect(
  width: number,
  height: number,
  scale: number,
): { x: number; y: number; width: number; height: number; groundY: number; targetY: number } {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const headerH = scaledSize(56, scale);
  const widthAvail = width - margin * 2 - railW - gap;
  const heightAvail = height - margin * 2 - headerH;
  return {
    x: margin,
    y: margin + headerH,
    width: widthAvail,
    height: heightAvail,
    groundY: margin + headerH + heightAvail * 0.78,
    targetY: margin + headerH + heightAvail * 0.36,
  };
}

function worldToX(worldX: number, range: { x: number; width: number }, scale: number): number {
  const left = range.x + scaledSize(70, scale);
  const span = range.width - scaledSize(100, scale);
  const t = (worldX - WORLD_MIN) / (WORLD_MAX - WORLD_MIN);
  return left + clamp(t, 0, 1) * span;
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: ArcheryScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  paperTitle(ctx, scale);
  ctx.fillText("ARCHERY", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("ARCHERY").width;

  const player = state.scores[state.currentPlayer];
  paperMeta(ctx, scale);
  ctx.fillText(
    `Round ${state.round} of ${state.maxRounds}${player ? `  ·  ${player.name}` : ""}`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawRange(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: ArcheryScreenState,
  scale: number,
  now: number,
): void {
  const range = rangeRect(width, height, scale);

  // Range card.
  drawBentoCard(
    ctx,
    { x: range.x, y: range.y, width: range.width, height: range.height },
    { fill: "rgba(18,13,46,0.97)", stroke: colors.border },
  );

  // One lane per seat, in turn order, above the target rail.
  drawTurnLanes(ctx, range, state, scale);

  // Ground.
  ctx.strokeStyle = "rgba(255,46,151,0.45)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.moveTo(range.x + scaledSize(16, scale), range.groundY);
  ctx.lineTo(range.x + range.width - scaledSize(16, scale), range.groundY);
  ctx.stroke();

  // Distance ticks.
  ctx.font = `500 ${scaledSize(11, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = "rgba(29,27,38,0.18)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 1; i <= 4; i++) {
    const x = range.x + (range.width * i) / 5;
    ctx.fillRect(x, range.groundY, 1, scaledSize(6, scale));
    ctx.fillText(`${i * 10}m`, x, range.groundY + scaledSize(10, scale));
  }

  // Target, sliding along its rail.
  const targetX = worldToX(state.targetX, range, scale);
  const targetR = Math.max(scaledSize(30, scale), (state.targetWidth / (WORLD_MAX - WORLD_MIN)) * range.width);
  drawTarget(ctx, targetX, range.targetY, targetR, scale);

  // Every arrow stays on the shared target, coloured by its owner's seat, so
  // eight lanes read as one round rather than eight separate boards.
  drawShotMarkers(ctx, range, state, scale);

  // Archer at the left edge.
  const archerX = range.x + scaledSize(54, scale);
  ctx.save();
  ctx.translate(archerX, range.groundY);
  ctx.scale(1.35, 1.35);
  ctx.translate(-archerX, -range.groundY);
  drawArcher(ctx, archerX, range.groundY, state.drawPower, state.isDrawing, scale);
  ctx.restore();

  // Arrow in flight.
  if (state.arrow) {
    const ax = worldToX(state.arrow.x, range, scale);
    const ay = range.groundY - state.arrow.y * range.height * 0.55;
    drawArrow(ctx, ax, clamp(ay, range.y + scaledSize(10, scale), range.groundY), scale);
  }

  // Power meter next to the archer.
  if (state.phase === "aiming") {
    const barW = Math.max(scaledSize(10, scale), scaledSize(12, scale));
    const barH = range.height * 0.34;
    const bx = archerX + scaledSize(46, scale);
    const by = range.groundY - barH - scaledSize(4, scale);
    drawRoundRect(ctx, bx, by, barW, barH, barW / 2, "#FFFDF5", "rgba(29,27,38,0.25)", 1);
    if (state.drawPower > 0) {
      const fillH = barH * clamp(state.drawPower, 0, 1);
      drawRoundRect(ctx, bx, by + barH - fillH, barW, fillH, barW / 2, state.drawPower > 0.8 ? colors.danger : colors.amber);
    }
    ctx.font = `700 ${scaledSize(12, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = state.isDrawing ? colors.amber : colors.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(state.drawPower * 100)}%`, bx + barW + scaledSize(8, scale), by + barH / 2);
  }

  // Scoring feedback.
  if (state.phase === "scoring" && now - renderState.hitAt < 1600) {
    const age = now - renderState.hitAt;
    const alpha = age < 900 ? 1 : 1 - (age - 900) / 700;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${scaledSize(30, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = renderState.lastScore > 0 ? colors.success : colors.danger;
    ctx.fillText(
      renderState.lastScore > 0 ? `+${renderState.lastScore}` : "MISS",
      targetX,
      range.targetY - targetR - scaledSize(24, scale),
    );
    ctx.restore();
  }
}

/** One chip per seat: the full turn order, with the active archer lit. */
function drawTurnLanes(
  ctx: CanvasRenderingContext2D,
  range: ReturnType<typeof rangeRect>,
  state: ArcheryScreenState,
  scale: number,
): void {
  const entries = state.turnOrder && state.turnOrder.length > 0
    ? state.turnOrder
    : state.scores.map((score, index) => ({
        name: score.name,
        seat: score.seat ?? seatForIndex(index),
        isCurrent: index === state.currentPlayer && !state.finished,
      }));
  if (entries.length === 0) return;

  const pad = scaledSize(12, scale);
  const gap = scaledSize(5, scale);
  const chipH = scaledSize(24, scale);
  const y = range.y + pad;

  ctx.save();
  ctx.font = `700 ${scaledSize(10, scale)}px ${fonts.title.family}`;
  const roundLabel = `ROUND ${state.round}/${state.maxRounds}`;
  const roundW = ctx.measureText(roundLabel).width;
  const usable = range.width - pad * 2 - roundW - gap * 2;
  const chipW = Math.max(scaledSize(28, scale), (usable - gap * (entries.length - 1)) / entries.length);
  const active = state.phase !== "finished" ? state.currentPlayer : -1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const seat = entry.seat ?? seatForIndex(i);
    const isCurrent = entry.isCurrent ?? (i === active && !state.finished);
    const x = range.x + pad + i * (chipW + gap);

    drawRoundRect(
      ctx,
      x,
      y,
      chipW,
      chipH,
      chipH / 2,
      isCurrent ? `${seat.color}33` : "rgba(29,27,38,0.06)",
      isCurrent ? seat.color : "rgba(29,27,38,0.22)",
      1,
    );

    ctx.fillStyle = seat.color;
    ctx.beginPath();
    ctx.arc(x + chipH * 0.45, y + chipH / 2, scaledSize(4.4, scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.bg0;
    ctx.font = `700 ${scaledSize(8, scale)}px ${fonts.title.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(seat.emoji, x + chipH * 0.45, y + chipH / 2 + 0.5);

    ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = isCurrent ? colors.text : colors.textMuted;
    ctx.textAlign = "left";
    const nameX = x + chipH * 0.9;
    const nameMax = x + chipW - scaledSize(6, scale) - nameX;
    ctx.fillText(truncateToWidth(ctx, entry.name, nameMax), nameX, y + chipH / 2);
  }

  ctx.font = `700 ${scaledSize(10, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(roundLabel, range.x + range.width - pad, y + chipH / 2);
  ctx.restore();
}

/** Shrink a label with an ellipsis until it fits the chip. */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/** Every arrow in the game, pinned to the shared target by seat colour/glyph. */
function drawShotMarkers(
  ctx: CanvasRenderingContext2D,
  range: ReturnType<typeof rangeRect>,
  state: ArcheryScreenState,
  scale: number,
): void {
  const currentRound = state.round - 1;
  for (const shot of state.shots) {
    const seat = shot.seat ?? seatForIndex(shot.playerIndex);
    const age = currentRound - shot.round;
    const alpha = age <= 0 ? 1 : Math.max(0.25, 1 - age * 0.3);

    if (shot.score > 0) {
      const anchor = shot.targetX ?? state.targetX;
      const markerX = worldToX(state.targetX + (shot.x - anchor), range, scale);
      drawShotMarker(ctx, markerX, range.targetY, seat, shot.playerIndex, alpha, scale);
    } else {
      const markerX = worldToX(shot.x, range, scale);
      drawShotMarker(ctx, markerX, range.groundY - scaledSize(4, scale), seat, shot.playerIndex, alpha * 0.5, scale);
    }
  }
}

function drawShotMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seat: SeatIdentity,
  playerIndex: number,
  alpha: number,
  scale: number,
): void {
  // Fan overlapping arrows around a tiny ring so eight bullseyes stay visible.
  const ring = scaledSize(2.6, scale);
  const angle = (playerIndex / 8) * Math.PI * 2;
  const mx = x + Math.cos(angle) * ring;
  const my = y + Math.sin(angle) * ring;

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = seat.color;
  ctx.beginPath();
  ctx.arc(mx, my, scaledSize(5.4, scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(11,8,32,0.78)";
  ctx.lineWidth = Math.max(1, scaledSize(1, scale));
  ctx.stroke();
  ctx.fillStyle = colors.bg0;
  ctx.font = `700 ${scaledSize(7, scale)}px ${fonts.title.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(seat.emoji, mx, my + 0.5);
  ctx.restore();
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  scale: number,
): void {
  const rings = [
    { at: 1, fill: "#FFFDF5" },
    { at: 0.8, fill: colors.text },
    { at: 0.6, fill: colors.cyan },
    { at: 0.4, fill: colors.magenta },
    { at: 0.2, fill: colors.amber },
  ];
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  for (const ring of rings) {
    ctx.fillStyle = ring.fill;
    ctx.beginPath();
    ctx.arc(x, y, r * ring.at, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawArcher(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  power: number,
  drawing: boolean,
  scale: number,
): void {
  const ink = colors.text;
  const lw = Math.max(2, scaledSize(3, scale));
  const headR = scaledSize(7, scale);

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";

  // Legs + body.
  ctx.beginPath();
  ctx.moveTo(x, groundY - scaledSize(36, scale));
  ctx.lineTo(x, groundY);
  ctx.moveTo(x, groundY - scaledSize(4, scale));
  ctx.lineTo(x - scaledSize(12, scale), groundY);
  ctx.moveTo(x, groundY - scaledSize(4, scale));
  ctx.lineTo(x + scaledSize(12, scale), groundY);
  ctx.stroke();

  // Head.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x, groundY - scaledSize(46, scale), headR, 0, Math.PI * 2);
  ctx.fill();

  // Bow arm.
  const armY = groundY - scaledSize(32, scale);
  const bowX = x + scaledSize(34, scale);
  ctx.beginPath();
  ctx.moveTo(x, armY);
  ctx.lineTo(bowX, armY);
  ctx.stroke();

  // Bow arc.
  const draw = drawing ? clamp(power, 0, 1) : 0;
  ctx.strokeStyle = colors.amber;
  ctx.lineWidth = Math.max(2, scaledSize(3, scale));
  ctx.beginPath();
  ctx.arc(bowX, armY, scaledSize(24, scale), -Math.PI * 0.42, Math.PI * 0.42);
  ctx.stroke();

  // Bow string, pulled by draw power.
  const stringX = bowX - draw * scaledSize(12, scale);
  ctx.strokeStyle = "rgba(29,27,38,0.55)";
  ctx.lineWidth = Math.max(1, scaledSize(1.5, scale));
  ctx.beginPath();
  ctx.moveTo(bowX + Math.cos(-Math.PI * 0.42) * scaledSize(24, scale), armY + Math.sin(-Math.PI * 0.42) * scaledSize(24, scale));
  ctx.lineTo(stringX, armY);
  ctx.lineTo(bowX + Math.cos(Math.PI * 0.42) * scaledSize(24, scale), armY + Math.sin(Math.PI * 0.42) * scaledSize(24, scale));
  ctx.stroke();

  // Nocked arrow.
  if (!drawing || draw < 0.02) {
    ctx.strokeStyle = "rgba(29,27,38,0.5)";
    ctx.beginPath();
    ctx.moveTo(stringX, armY);
    ctx.lineTo(bowX + scaledSize(12, scale), armY);
    ctx.stroke();
  }

  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const len = scaledSize(22, scale);
  ctx.save();
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.moveTo(x - len, y + len * 0.35);
  ctx.lineTo(x, y);
  ctx.stroke();

  ctx.fillStyle = colors.cyan;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - len * 0.28, y - len * 0.08);
  ctx.lineTo(x - len * 0.16, y + len * 0.2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = colors.magenta;
  ctx.beginPath();
  ctx.moveTo(x - len, y + len * 0.35);
  ctx.lineTo(x - len * 0.78, y + len * 0.16);
  ctx.moveTo(x - len, y + len * 0.35);
  ctx.lineTo(x - len * 0.84, y + len * 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: ArcheryScreenState,
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

  // Round pips.
  const pipY = rect.y + rect.height + scaledSize(18, scale);
  for (let i = 0; i < state.maxRounds; i++) {
    const px = rect.x + scaledSize(6, scale) + i * scaledSize(18, scale);
    ctx.fillStyle = i < state.round - 1 ? colors.magenta : i === state.round - 1 ? colors.cyan : "rgba(29,27,38,0.16)";
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
