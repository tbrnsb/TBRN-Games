/**
 * Darts — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Board coordinates from the server are in board units (±170), so throws map
 * straight onto the drawn board. Scores count down from 501/301.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitHitBurst, emitScoreBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen,
  type RankedEntry,
  clamp,
} from "../../client/screen/kit/index.ts";

interface DartPlayer {
  name: string;
  score: number;
  isCurrent: boolean;
  turn: number;
  isWinner: boolean;
}

interface DartThrow {
  playerIndex: number;
  x: number;
  y: number;
  score: number;
  timestamp: number;
}

interface DartsAim {
  x: number;
  y: number;
  phase: "aimX" | "aimY";
  lockedX: number | null;
  lockedY: number | null;
  active: boolean;
}

interface DartsScreenState {
  players: DartPlayer[];
  throws: DartThrow[];
  aim?: DartsAim;
  finished: boolean;
  winner: string | null;
  gameMode: string;
}

interface DartsRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastThrowKey: string;
  lastScore: number;
  hitAt: number;
}

function createDartsRenderState(): DartsRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastThrowKey: "",
    lastScore: 0,
    hitAt: 0,
  };
}

const renderState = (globalThis as any)._dartsRenderState ||= createDartsRenderState();

const BOARD_R = 170;
const SECTOR_VALUES = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export function renderDarts(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: DartsScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: DartsRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    // The server sends only the last twelve darts, so the list length stops
    // growing after twelve throws. Compare the newest dart itself instead
    // of counting, or every dart after the twelfth would go unnoticed.
    const newest = state.throws[state.throws.length - 1];
    const throwKey = newest ? `${newest.playerIndex}:${newest.timestamp}:${newest.x.toFixed(3)}` : "";
    if (throwKey && throwKey !== rs.lastThrowKey) {
      const dart = newest!;
      rs.lastScore = dart.score;
      rs.hitAt = now;
      const board = boardRect(width, height, scale);
      const px = board.cx + (dart.x / BOARD_R) * board.r;
      const py = board.cy + (dart.y / BOARD_R) * board.r;
      if (dart.score > 0) {
        emitScoreBurst(px, py, dart.playerIndex, scale);
        triggerShake(rs.shake, 0.14, now);
      } else {
        emitHitBurst(px, py, colors.danger, scale);
      }
    }
    rs.lastThrowKey = throwKey;

    if (!rs.titleCard && !state.finished) {
      rs.titleCard = createTitleCard({
        title: "DARTS",
        subtitle: `${state.gameMode}  ·  three darts a turn`,
        duration: 2000,
        fadeInDuration: 400,
        holdDuration: 1000,
        fadeOutDuration: 500,
      });
      showTitleCard(rs.titleCard, now);
    }

    if (state.finished && !rs.victoryScreen) {
      const winnerName = state.winner ?? state.players.find((p) => p.isWinner)?.name ?? null;
      if (winnerName) {
        rs.victoryScreen = createVictoryScreen({
          winner: buildWinner(state, winnerName),
          rankings: buildRankings(state, winnerName),
          gameName: "Darts",
          duration: 0,
          scoreSuffix: "left",
        });
        showVictoryScreen(rs.victoryScreen, now, width, height);
        triggerShake(rs.shake, 0.5, now);
      }
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
    drawBoard(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function buildRankings(state: DartsScreenState, winnerName: string): RankedEntry[] {
  return state.players
    .map((p, i) => ({ ...p, playerIndex: i }))
    .sort((a, b) => Number(b.name === winnerName) - Number(a.name === winnerName) || a.score - b.score)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      score: p.score,
      playerIndex: p.playerIndex,
      isWinner: p.name === winnerName,
    }));
}

function buildWinner(state: DartsScreenState, winnerName: string): RankedEntry {
  return buildRankings(state, winnerName)[0] ?? {
    rank: 1,
    name: winnerName,
    score: 0,
    playerIndex: 0,
    isWinner: true,
  };
}

function boardRect(
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
  state: DartsScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("DARTS", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("DARTS").width;

  const current = state.players.find((p) => p.isCurrent);
  const aimHint = !state.finished && state.aim?.active
    ? state.aim.phase === "aimX" ? "lock the horizontal marker" : "lock the vertical marker"
    : "";
  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${state.gameMode}${current ? `  ·  ${current.name} to throw` : ""}${aimHint ? `  ·  ${aimHint}` : ""}`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: DartsScreenState,
  scale: number,
  now: number,
): void {
  const { cx, cy, r } = boardRect(width, height, scale);

  // Spotlight behind the board instead of a big empty card.
  const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.45);
  halo.addColorStop(0, "rgba(255,46,151,0.14)");
  halo.addColorStop(0.65, "rgba(255,46,151,0.05)");
  halo.addColorStop(1, "rgba(255,46,151,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,229,255,0.16)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);

  // Sectors.
  for (let i = 0; i < 20; i++) {
    const start = ((-90 - 9 + i * 18) * Math.PI) / 180;
    const end = start + (18 * Math.PI) / 180;
    const even = i % 2 === 0;

    // Single bed.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, end);
    ctx.closePath();
    ctx.fillStyle = even ? "#1B1545" : "#120D2E";
    ctx.fill();

    // Triple band.
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.63, start, end);
    ctx.arc(0, 0, r * 0.58, end, start, true);
    ctx.closePath();
    ctx.fillStyle = even ? colors.magenta : colors.cyan;
    ctx.fill();

    // Double band.
    ctx.beginPath();
    ctx.arc(0, 0, r, start, end);
    ctx.arc(0, 0, r * 0.95, end, start, true);
    ctx.closePath();
    ctx.fillStyle = even ? colors.magenta : colors.cyan;
    ctx.fill();

    // Sector number on the rim, kept upright for readability.
    const mid = (start + end) / 2;
    ctx.font = `700 ${Math.max(scaledSize(12, scale), r * 0.075)}px ${fonts.display.family}`;
    ctx.fillStyle = "rgba(245,243,255,0.82)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(SECTOR_VALUES[i]), Math.cos(mid) * r * 0.87, Math.sin(mid) * r * 0.87);
  }

  // Outer bull + bull.
  ctx.fillStyle = colors.cyan;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.095, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.amber;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.04, 0, Math.PI * 2);
  ctx.fill();

  // Rim.
  ctx.strokeStyle = "rgba(245,243,255,0.28)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  drawAim(ctx, cx, cy, r, state.aim, scale);

  // Throws.
  state.throws.slice(-12).forEach((dart, idx, list) => {
    const px = cx + (dart.x / BOARD_R) * r;
    const py = cy + (dart.y / BOARD_R) * r;
    const color = colors.player[dart.playerIndex % colors.player.length];
    const fresh = idx === list.length - 1 && now - renderState.hitAt < 1600;

    ctx.save();
    ctx.globalAlpha = fresh ? 1 : 0.82;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, scaledSize(2.5, scale));
    ctx.beginPath();
    ctx.moveTo(cx + ((dart.x - 36) / BOARD_R) * r, cy + ((dart.y - 36) / BOARD_R) * r);
    ctx.lineTo(px, py);
    ctx.stroke();

    // Fletching.
    const fx = cx + ((dart.x - 36) / BOARD_R) * r;
    const fy = cy + ((dart.y - 36) / BOARD_R) * r;
    const angle = Math.atan2(py - fy, px - fx);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx - Math.cos(angle + 0.5) * scaledSize(9, scale), fy - Math.sin(angle + 0.5) * scaledSize(9, scale));
    ctx.lineTo(fx - Math.cos(angle - 0.5) * scaledSize(9, scale), fy - Math.sin(angle - 0.5) * scaledSize(9, scale));
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, Math.max(2, scaledSize(3.5, scale)), 0, Math.PI * 2);
    ctx.fill();

    if (fresh && dart.score > 0) {
      ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.display.family}`;
      ctx.fillStyle = colors.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.shadowColor = color;
      ctx.shadowBlur = scaledSize(10, scale);
      ctx.fillText(`+${dart.score}`, px + scaledSize(8, scale), py - scaledSize(8, scale));
    }
    ctx.restore();
  });

  // Latest-throw popup.
  if (state.throws.length > 0 && now - renderState.hitAt < 1600) {
    const age = now - renderState.hitAt;
    const alpha = age < 700 ? 1 : 1 - (age - 700) / 900;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = renderState.lastScore > 0 ? colors.success : colors.danger;
    ctx.fillText(
      renderState.lastScore > 0 ? `${renderState.lastScore}` : "MISS",
      cx,
      cy - r - scaledSize(18, scale),
    );
    ctx.restore();
  }
}

/**
 * Timing-lock crosshair. The active axis is a bright guide plus a dot at the
 * live intersection; every locked axis stays as an amber dashed guide under
 * the next sweep. Aim coordinates arrive as 0..1 with 0.5 at dead centre.
 */
function drawAim(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  aim: DartsAim | undefined,
  scale: number,
): void {
  if (!aim || !aim.active) return;

  const px = cx + (clamp(aim.x, 0, 1) * 2 - 1) * r;
  const py = cy + (clamp(aim.y, 0, 1) * 2 - 1) * r;
  const aimingX = aim.phase === "aimX";

  ctx.save();
  if (aim.lockedX !== null) {
    drawGuide(ctx, true, cx + (clamp(aim.lockedX, 0, 1) * 2 - 1) * r, cx, cy, r, scale, colors.amber, true);
  }
  if (aim.lockedY !== null) {
    drawGuide(ctx, false, cy + (clamp(aim.lockedY, 0, 1) * 2 - 1) * r, cx, cy, r, scale, colors.amber, true);
  }

  if (aimingX) drawGuide(ctx, true, px, cx, cy, r, scale, colors.cyan, false);
  else drawGuide(ctx, false, py, cx, cy, r, scale, colors.cyan, false);

  // Dot at the live aim: the moving guide crosses the board's centre on the
  // first sweep, then the locked X guide on the second.
  const dotY = aimingX ? cy : py;
  ctx.beginPath();
  ctx.arc(px, dotY, Math.max(4, scaledSize(7, scale)), 0, Math.PI * 2);
  ctx.fillStyle = colors.text;
  ctx.fill();
  ctx.strokeStyle = colors.cyan;
  ctx.lineWidth = Math.max(2, scaledSize(2, scale));
  ctx.stroke();
  ctx.restore();
}

function drawGuide(
  ctx: CanvasRenderingContext2D,
  vertical: boolean,
  position: number,
  cx: number,
  cy: number,
  r: number,
  scale: number,
  color: string,
  dashed: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = dashed ? 0.7 : 0.95;
  ctx.lineWidth = Math.max(dashed ? 2 : 2.5, scaledSize(dashed ? 2 : 3, scale));
  if (dashed) ctx.setLineDash([scaledSize(10, scale), scaledSize(8, scale)]);
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(position, cy - r);
    ctx.lineTo(position, cy + r);
  } else {
    ctx.moveTo(cx - r, position);
    ctx.lineTo(cx + r, position);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: DartsScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const n = Math.max(1, state.players.length);
  const listH = Math.min(height - margin * 2, scaledSize(80, scale) + n * scaledSize(72, scale));
  const rect = { x: width - margin - railW, y: margin, width: railW, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.magenta });

  const entries = state.players.map((p, i) => ({
    name: p.name,
    score: p.score,
    playerIndex: i,
    isCurrent: p.isCurrent,
    isWinner: p.isWinner,
    animatedScore: p.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "TO FINISH", scale });

  // Recent throw scores.
  const recent = state.throws.slice(-5).reverse();
  const startY = rect.y + rect.height + scaledSize(20, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("RECENT", rect.x + scaledSize(6, scale), startY);

  recent.forEach((dart, i) => {
    const y = startY + scaledSize(24, scale) + i * scaledSize(24, scale);
    const player = state.players[dart.playerIndex];
    ctx.fillStyle = colors.player[dart.playerIndex % colors.player.length];
    ctx.beginPath();
    ctx.arc(rect.x + scaledSize(10, scale), y, scaledSize(3.5, scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(player?.name ?? `P${dart.playerIndex + 1}`, rect.x + scaledSize(22, scale), y);
    ctx.textAlign = "right";
    ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = dart.score > 0 ? colors.text : colors.danger;
    ctx.fillText(dart.score > 0 ? String(dart.score) : "miss", rect.x + rect.width - scaledSize(6, scale), y);
    ctx.textAlign = "left";
  });
}
