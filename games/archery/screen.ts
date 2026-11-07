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
  drawBentoCard(ctx, { x: range.x, y: range.y, width: range.width, height: range.height }, { stroke: colors.border });

  const inset = Math.max(3, scaledSize(4, scale));
  const innerX = range.x + inset;
  const innerW = range.width - inset * 2;
  const innerBottom = range.y + range.height - inset;
  const groundY = range.groundY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(innerX, range.y + inset, innerW, range.height - inset * 2);
  ctx.clip();

  // Sky and field, both cut from paper.
  ctx.fillStyle = "#FBF4E2";
  ctx.fillRect(innerX, range.y + inset, innerW, groundY - range.y - inset);
  ctx.fillStyle = "#E6D8B9";
  ctx.fillRect(innerX, groundY, innerW, innerBottom - groundY);
  ctx.fillStyle = "rgba(14,140,140,0.10)";
  ctx.fillRect(innerX, groundY - range.height * 0.12, innerW, range.height * 0.12);

  drawSun(ctx, range, scale);
  drawClouds(ctx, range, scale);
  drawTurnLanes(ctx, range, state, scale);

  // Ground line, range ticks and grass.
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scaledSize(3, scale));
  ctx.beginPath();
  ctx.moveTo(innerX, groundY);
  ctx.lineTo(innerX + innerW, groundY);
  ctx.stroke();
  drawDistanceTicks(ctx, range, scale);
  drawGrass(ctx, range, scale);

  // Target on a tripod stand, low enough to sit in the field.
  const targetX = worldToX(state.targetX, range, scale);
  const targetY = groundY - range.height * 0.30;
  const targetR = Math.max(
    range.width * 0.06,
    (state.targetWidth / (WORLD_MAX - WORLD_MIN)) * range.width * 0.9,
  );
  drawTarget(ctx, targetX, targetY, targetR, groundY, scale);
  drawShotMarkers(ctx, { ...range, targetY }, state, scale);

  // Archer.
  const archerX = range.x + range.width * 0.11;
  const unit = Math.max(96, range.height * 0.20);
  drawArcher(ctx, archerX, groundY, state.drawPower, state.isDrawing, unit, scale);

  // Arrow in flight.
  if (state.arrow) {
    const ax = worldToX(state.arrow.x, range, scale);
    const ay = groundY - state.arrow.y * range.height * 0.55;
    drawArrow(ctx, ax, clamp(ay, range.y + scaledSize(10, scale), groundY), scale);
  }

  if (state.phase === "aiming") {
    drawPowerMeter(ctx, archerX + unit * 0.72, groundY, state, range, scale);
  }

  // Scoring feedback.
  if (state.phase === "scoring" && now - renderState.hitAt < 1600) {
    const age = now - renderState.hitAt;
    const alpha = age < 900 ? 1 : 1 - (age - 900) / 700;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(24, scaledSize(34, scale))}px ${fonts.title.family}`;
    ctx.fillStyle = renderState.lastScore > 0 ? colors.success : colors.danger;
    ctx.fillText(
      renderState.lastScore > 0 ? `+${renderState.lastScore}` : "MISS",
      targetX,
      targetY - targetR - Math.max(24, scaledSize(34, scale)),
    );
    ctx.restore();
  }

  ctx.restore();
}

function drawSun(ctx: CanvasRenderingContext2D, range: ReturnType<typeof rangeRect>, scale: number): void {
  const x = range.x + range.width * 0.86;
  const y = range.y + range.height * 0.20;
  const r = range.height * 0.052;
  ctx.save();
  ctx.fillStyle = colors.amber;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scaledSize(3, scale));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * r * 1.25, y + Math.sin(angle) * r * 1.25);
    ctx.lineTo(x + Math.cos(angle) * r * 1.55, y + Math.sin(angle) * r * 1.55);
    ctx.stroke();
  }
  ctx.restore();
}

function drawClouds(ctx: CanvasRenderingContext2D, range: ReturnType<typeof rangeRect>, scale: number): void {
  const cloud = (cx: number, cy: number, size: number, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#FFFDF5";
    ctx.strokeStyle = "rgba(29,27,38,0.25)";
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    const r = size * 0.32;
    for (const [dx, dy, rr] of [[-size * 0.36, 0, r * 0.9], [0, -size * 0.12, r * 1.15], [size * 0.38, 0, r * 0.8]] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillRect(cx - size * 0.44, cy + r * 0.1, size * 0.88, r * 0.7);
    ctx.strokeRect(cx - size * 0.44, cy + r * 0.1, size * 0.88, r * 0.7);
    ctx.restore();
  };
  cloud(range.x + range.width * 0.24, range.y + range.height * 0.20, range.height * 0.10, 0.9);
  cloud(range.x + range.width * 0.55, range.y + range.height * 0.14, range.height * 0.07, 0.7);
}

function drawDistanceTicks(
  ctx: CanvasRenderingContext2D,
  range: ReturnType<typeof rangeRect>,
  scale: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(29,27,38,0.55)";
  ctx.fillStyle = "rgba(29,27,38,0.62)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${Math.max(11, scaledSize(14, scale))}px ${fonts.body.family}`;
  for (let i = 1; i <= 5; i++) {
    const x = range.x + (range.width * i) / 6;
    ctx.beginPath();
    ctx.moveTo(x, range.groundY);
    ctx.lineTo(x, range.groundY + Math.max(6, scaledSize(9, scale)));
    ctx.stroke();
    ctx.fillText(`${i * 10}m`, x, range.groundY + Math.max(9, scaledSize(13, scale)));
  }
  ctx.restore();
}

function drawGrass(ctx: CanvasRenderingContext2D, range: ReturnType<typeof rangeRect>, scale: number): void {
  const tufts = [0.16, 0.28, 0.37, 0.47, 0.62, 0.73, 0.84, 0.93];
  ctx.save();
  ctx.strokeStyle = "rgba(29,27,38,0.35)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.lineCap = "round";
  const h = Math.max(5, scaledSize(9, scale));
  for (const t of tufts) {
    const x = range.x + range.width * t;
    const y = range.groundY;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - h * 0.5, y - h);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h * 1.3);
    ctx.moveTo(x, y);
    ctx.lineTo(x + h * 0.55, y - h * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

/** One paper ticket per seat, in turn order, with the active archer lit. */
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

  const pad = Math.max(10, scaledSize(14, scale));
  const gap = Math.max(5, scaledSize(7, scale));
  const stripH = Math.max(40, scaledSize(56, scale));
  const stripY = range.y + Math.max(10, scaledSize(14, scale));
  const stripW = range.width - pad * 2;
  const chipH = stripH - Math.max(10, scaledSize(14, scale));

  ctx.save();
  const strip = { x: range.x + pad, y: stripY, width: stripW, height: stripH };
  ctx.shadowColor = colors.border;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  drawRoundRect(ctx, strip.x, strip.y, strip.width, strip.height, scaledSize(7, scale), "#F4EBD9", colors.border, Math.max(2, scaledSize(2.5, scale)));
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  const roundLabel = `ROUND ${state.round}/${state.maxRounds}`;
  ctx.font = `700 ${Math.max(11, scaledSize(14, scale))}px ${fonts.title.family}`;
  const roundW = ctx.measureText(roundLabel).width;
  const usable = stripW - pad * 2 - roundW - gap;
  const chipW = Math.max(44, (usable - gap * (entries.length - 1)) / Math.max(1, entries.length));
  const active = state.phase !== "finished" ? state.currentPlayer : -1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const seat = entry.seat ?? seatForIndex(i);
    const isCurrent = entry.isCurrent ?? (i === active && !state.finished);
    const x = strip.x + pad + i * (chipW + gap);
    const y = strip.y + (stripH - chipH) / 2;

    drawRoundRect(
      ctx,
      x,
      y,
      chipW,
      chipH,
      Math.max(5, chipH * 0.22),
      isCurrent ? "#FFFDF5" : "rgba(255,253,245,0.45)",
      isCurrent ? seat.color : "rgba(29,27,38,0.22)",
      isCurrent ? Math.max(2, scaledSize(3, scale)) : 1,
    );

    const badge = Math.max(18, chipH * 0.62);
    const bx = x + Math.max(6, scaledSize(8, scale));
    const by = y + (chipH - badge) / 2;
    ctx.fillStyle = seat.color;
    ctx.beginPath();
    ctx.arc(bx + badge / 2, by + badge / 2, badge / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(1, scaledSize(1.5, scale));
    ctx.stroke();
    ctx.fillStyle = "#FFFDF5";
    ctx.font = `700 ${Math.max(8, badge * 0.48)}px ${fonts.title.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(seat.emoji, bx + badge / 2, by + badge / 2 + 0.5);

    const nameX = bx + badge + Math.max(5, scaledSize(7, scale));
    const nameMax = x + chipW - Math.max(6, scaledSize(8, scale)) - nameX;
    ctx.font = `700 ${Math.max(11, scaledSize(15, scale))}px ${fonts.body.family}`;
    ctx.fillStyle = isCurrent ? colors.border : colors.textMuted;
    ctx.textAlign = "left";
    ctx.fillText(truncateToWidth(ctx, entry.name, nameMax), nameX, y + chipH / 2);
  }

  ctx.font = `700 ${Math.max(10, scaledSize(13, scale))}px ${fonts.title.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(roundLabel, strip.x + strip.width - pad, strip.y + stripH / 2);
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
      drawShotMarker(ctx, markerX, range.groundY - Math.max(4, scaledSize(6, scale)), seat, shot.playerIndex, alpha * 0.5, scale);
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
  const ring = Math.max(3, scaledSize(4, scale));
  const angle = (playerIndex / 8) * Math.PI * 2;
  const mx = x + Math.cos(angle) * ring;
  const my = y + Math.sin(angle) * ring;
  const markerR = Math.max(6, scaledSize(9, scale));

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = seat.color;
  ctx.beginPath();
  ctx.arc(mx, my, markerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(1, scaledSize(1.5, scale));
  ctx.stroke();
  ctx.fillStyle = "#FFFDF5";
  ctx.font = `700 ${Math.max(8, markerR * 0.95)}px ${fonts.title.family}`;
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
  groundY: number,
  scale: number,
): void {
  // Stand first, so the rings cover the top of the legs.
  ctx.save();
  ctx.fillStyle = "rgba(29,27,38,0.13)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + Math.max(2, scaledSize(3, scale)), r * 0.95, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(3, scaledSize(5, scale));
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - r * 0.36, y + r * 0.84);
  ctx.lineTo(x - r * 0.58, groundY - Math.max(2, scaledSize(3, scale)));
  ctx.moveTo(x + r * 0.36, y + r * 0.84);
  ctx.lineTo(x + r * 0.58, groundY - Math.max(2, scaledSize(3, scale)));
  ctx.moveTo(x - r * 0.58, groundY - Math.max(4, scaledSize(6, scale)));
  ctx.lineTo(x + r * 0.58, groundY - Math.max(4, scaledSize(6, scale)));
  ctx.stroke();

  const rings = [
    { at: 1, fill: "#FFFDF5" },
    { at: 0.8, fill: colors.text },
    { at: 0.6, fill: colors.cyan },
    { at: 0.4, fill: colors.magenta },
    { at: 0.2, fill: colors.amber },
  ];
  for (const ring of rings) {
    ctx.fillStyle = ring.fill;
    ctx.beginPath();
    ctx.arc(x, y, r * ring.at, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scaledSize(3, scale));
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
  unit: number,
  scale: number,
): void {
  const u = unit;
  const hip = groundY - u * 0.46;
  const shoulder = groundY - u * 0.76;
  const headY = groundY - u * 0.88;
  const headR = u * 0.095;
  const bowX = x + u * 0.42;
  const armY = shoulder + u * 0.02;
  const draw = drawing ? clamp(power, 0, 1) : 0;
  const stringX = bowX - draw * u * 0.24;
  const ink = colors.border;
  const line = (width: number): void => { ctx.lineWidth = Math.max(2, width); };
  ctx.save();

  // Shadow.
  ctx.fillStyle = "rgba(29,27,38,0.13)";
  ctx.beginPath();
  ctx.ellipse(x, groundY + Math.max(2, scaledSize(2, scale)), u * 0.30, u * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Quiver on the back.
  ctx.save();
  ctx.translate(x - u * 0.17, hip);
  ctx.rotate(-0.2);
  drawRoundRect(ctx, 0, -u * 0.28, u * 0.10, u * 0.28, u * 0.02, "#C8A26B", ink, Math.max(1, scaledSize(2, scale)));
  ctx.strokeStyle = ink;
  line(Math.max(1, scaledSize(2, scale)));
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(u * 0.02 + i * u * 0.028, -u * 0.28);
    ctx.lineTo(u * 0.02 + i * u * 0.028, -u * 0.40);
    ctx.stroke();
  }
  ctx.restore();

  // Legs and boots.
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  line(u * 0.085);
  ctx.beginPath();
  ctx.moveTo(x, hip);
  ctx.lineTo(x - u * 0.17, groundY - u * 0.045);
  ctx.moveTo(x, hip);
  ctx.lineTo(x + u * 0.17, groundY - u * 0.045);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(x - u * 0.20, groundY - u * 0.025, u * 0.075, u * 0.035, -0.1, 0, Math.PI * 2);
  ctx.ellipse(x + u * 0.20, groundY - u * 0.025, u * 0.075, u * 0.035, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Torso: a tomato paper tunic with an ink outline.
  const torsoW = u * 0.23;
  drawRoundRect(
    ctx,
    x - torsoW / 2,
    shoulder - u * 0.02,
    torsoW,
    hip - shoulder + u * 0.04,
    u * 0.055,
    colors.magenta,
    ink,
    Math.max(2, scaledSize(3, scale)),
  );
  ctx.strokeStyle = ink;
  line(Math.max(2, scaledSize(3, scale)));
  ctx.beginPath();
  ctx.moveTo(x - torsoW / 2, hip - u * 0.02);
  ctx.lineTo(x + torsoW / 2, hip - u * 0.02);
  ctx.stroke();

  // Head: cream paper face, ink outline, red cap.
  ctx.fillStyle = "#FFFDF5";
  ctx.strokeStyle = ink;
  line(Math.max(2, scaledSize(3, scale)));
  ctx.beginPath();
  ctx.arc(x + u * 0.02, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x + u * 0.055, headY - headR * 0.12, headR * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.magenta;
  ctx.beginPath();
  ctx.arc(x + u * 0.02, headY - headR * 0.05, headR * 1.18, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
  ctx.strokeStyle = ink;
  line(Math.max(1, scaledSize(2, scale)));
  ctx.beginPath();
  ctx.moveTo(x + u * 0.02 + headR * 1.05, headY - headR * 0.12);
  ctx.lineTo(x + u * 0.02 + headR * 1.85, headY + headR * 0.02);
  ctx.stroke();

  // Draw arm: shoulder → elbow → string hand.
  const elbowX = x - u * 0.03;
  const elbowY = armY + u * 0.10;
  ctx.strokeStyle = ink;
  line(u * 0.06);
  ctx.beginPath();
  ctx.moveTo(x + u * 0.01, shoulder + u * 0.02);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(stringX, armY);
  ctx.stroke();
  ctx.fillStyle = "#FFFDF5";
  ctx.strokeStyle = ink;
  line(Math.max(1, scaledSize(2, scale)));
  ctx.beginPath();
  ctx.arc(stringX, armY, u * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Bow arm.
  ctx.strokeStyle = ink;
  line(u * 0.065);
  ctx.beginPath();
  ctx.moveTo(x + u * 0.01, shoulder + u * 0.02);
  ctx.lineTo(bowX, armY);
  ctx.stroke();

  // Bow: teal paper arc with an ink grip.
  ctx.strokeStyle = colors.cyan;
  line(u * 0.065);
  ctx.beginPath();
  ctx.arc(bowX, armY, u * 0.28, -Math.PI * 0.42, Math.PI * 0.42);
  ctx.stroke();
  ctx.strokeStyle = ink;
  line(Math.max(2, scaledSize(3, scale)));
  ctx.beginPath();
  ctx.moveTo(bowX + Math.cos(-Math.PI * 0.42) * u * 0.28, armY + Math.sin(-Math.PI * 0.42) * u * 0.28);
  ctx.lineTo(bowX + Math.cos(Math.PI * 0.42) * u * 0.28, armY + Math.sin(Math.PI * 0.42) * u * 0.28);
  ctx.stroke();

  // String, pulled by draw power.
  const topX = bowX + Math.cos(-Math.PI * 0.42) * u * 0.28;
  const topY = armY + Math.sin(-Math.PI * 0.42) * u * 0.28;
  const botX = bowX + Math.cos(Math.PI * 0.42) * u * 0.28;
  const botY = armY + Math.sin(Math.PI * 0.42) * u * 0.28;
  ctx.strokeStyle = "rgba(29,27,38,0.7)";
  line(Math.max(1, scaledSize(2, scale)));
  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.lineTo(stringX, armY);
  ctx.lineTo(botX, botY);
  ctx.stroke();

  // Nocked arrow.
  ctx.strokeStyle = ink;
  line(Math.max(2, scaledSize(3, scale)));
  ctx.beginPath();
  ctx.moveTo(stringX, armY);
  ctx.lineTo(bowX + u * 0.40, armY);
  ctx.stroke();
  ctx.fillStyle = colors.cyan;
  ctx.beginPath();
  ctx.moveTo(stringX, armY);
  ctx.lineTo(stringX - u * 0.08, armY - u * 0.035);
  ctx.lineTo(stringX - u * 0.08, armY + u * 0.035);
  ctx.closePath();
  ctx.fill();

  // Instruction tag above the head.
  const label = drawing ? (draw > 0.8 ? "RELEASE!" : "PULL") : "HOLD";
  const tagColor = drawing && draw > 0.8 ? colors.danger : drawing ? colors.amber : "#FFFDF5";
  const tagText = drawing && draw > 0.8 ? "#FFFDF5" : ink;
  ctx.font = `700 ${Math.max(12, scaledSize(16, scale))}px ${fonts.title.family}`;
  const tw = ctx.measureText(label).width + Math.max(16, scaledSize(20, scale));
  const th = Math.max(24, scaledSize(32, scale));
  const ty = headY - headR - th - Math.max(8, scaledSize(10, scale));
  drawRoundRect(ctx, x - tw / 2, ty, tw, th, scaledSize(5, scale), tagColor, ink, Math.max(2, scaledSize(2.5, scale)));
  ctx.fillStyle = tagText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, ty + th / 2);

  ctx.restore();
}

function drawPowerMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  state: ArcheryScreenState,
  range: ReturnType<typeof rangeRect>,
  scale: number,
): void {
  const barW = Math.max(26, scaledSize(34, scale));
  const barH = range.height * 0.32;
  const bx = x;
  const by = groundY - barH - Math.max(8, scaledSize(12, scale));
  const power = clamp(state.drawPower, 0, 1);
  const fillH = barH * power;

  ctx.save();
  ctx.shadowColor = colors.border;
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  drawRoundRect(ctx, bx, by, barW, barH, barW / 2, "#FFFDF5", colors.border, Math.max(2, scaledSize(3, scale)));
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (fillH > 0) {
    drawRoundRect(ctx, bx + 4, by + barH - fillH, barW - 8, Math.max(4, fillH), (barW - 8) / 2, power > 0.8 ? colors.danger : colors.magenta);
  }

  ctx.strokeStyle = "rgba(29,27,38,0.45)";
  ctx.lineWidth = Math.max(1, scaledSize(1.5, scale));
  for (const t of [0.25, 0.5, 0.75]) {
    const y = by + barH * (1 - t);
    ctx.beginPath();
    ctx.moveTo(bx + 4, y);
    ctx.lineTo(bx + barW - 4, y);
    ctx.stroke();
  }

  ctx.font = `700 ${Math.max(11, scaledSize(14, scale))}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("POWER", bx - Math.max(4, scaledSize(6, scale)), by - Math.max(6, scaledSize(8, scale)));
  ctx.font = `700 ${Math.max(12, scaledSize(16, scale))}px ${fonts.title.family}`;
  ctx.fillStyle = power > 0.8 ? colors.danger : colors.text;
  ctx.textBaseline = "top";
  ctx.fillText(`${Math.round(power * 100)}%`, bx + barW + Math.max(6, scaledSize(8, scale)), by + Math.max(2, scaledSize(4, scale)));
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const len = Math.max(24, scaledSize(32, scale));
  ctx.save();
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = Math.max(2, scaledSize(3, scale));
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
