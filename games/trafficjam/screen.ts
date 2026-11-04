/**
 * Traffic Jam — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * The server sends a 6×6 label grid; contiguous runs of the same label are one
 * car. The target car T must reach the exit on row 2 (right edge).
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, drawPill, clamp,
} from "../../client/screen/kit/index.ts";

interface TrafficScreenState {
  phase: "playing" | "solved" | "finished";
  cells: string[][];
  level: number;
  totalLevels: number;
  timeLeft: number;
  moves: number;
  currentPlayer: number;
  lastMessage: string | null;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface TrafficRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastLevel: number;
  lastMoves: number;
}

const GRID = 6;
const EXIT_ROW = 2;
const LEVEL_TIME_MS = 180000;

function createTrafficRenderState(): TrafficRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastLevel: 0,
    lastMoves: 0,
  };
}

const renderState = (globalThis as any)._trafficRenderState ||= createTrafficRenderState();

export function renderTrafficjam(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TrafficScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: TrafficRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.moves > rs.lastMoves) {
      emitScoreBurst(width * 0.45, height * 0.45, state.currentPlayer, scale);
      triggerShake(rs.shake, 0.08, now);
    }
    rs.lastMoves = state.moves;

    if (state.phase !== rs.lastPhase || state.level !== rs.lastLevel) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
      rs.lastLevel = state.level;
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

function handlePhaseChange(
  state: TrafficScreenState,
  rs: TrafficRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.level === 1 && state.phase === "playing" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "TRAFFIC JAM",
      subtitle: "Slide the T car to the right-hand exit",
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
        gameName: "Traffic Jam",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function boardRect(
  width: number,
  height: number,
  scale: number,
): { x: number; y: number; size: number } {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const headerH = scaledSize(56, scale);
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
  state: TrafficScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("TRAFFIC JAM", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("TRAFFIC JAM").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `Level ${state.level} of ${state.totalLevels}  ·  ${state.moves} moves`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

interface ParsedCar {
  label: string;
  row: number;
  col: number;
  len: number;
  horizontal: boolean;
  selected: boolean;
}

function parseCars(cells: string[][]): ParsedCar[] {
  const boxes = new Map<string, { minR: number; maxR: number; minC: number; maxC: number; selected: boolean }>();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const raw = cells[r]?.[c] ?? "";
      if (!raw) continue;
      const selected = raw.startsWith("[");
      const label = raw.replace(/[[\]]/g, "");
      const box = boxes.get(label);
      if (!box) {
        boxes.set(label, { minR: r, maxR: r, minC: c, maxC: c, selected });
      } else {
        box.minR = Math.min(box.minR, r);
        box.maxR = Math.max(box.maxR, r);
        box.minC = Math.min(box.minC, c);
        box.maxC = Math.max(box.maxC, c);
        box.selected = box.selected || selected;
      }
    }
  }
  return [...boxes.entries()].map(([label, b]) => ({
    label,
    row: b.minR,
    col: b.minC,
    len: b.minR === b.maxR ? b.maxC - b.minC + 1 : b.maxR - b.minR + 1,
    horizontal: b.minR === b.maxR,
    selected: b.selected,
  }));
}

function carColor(label: string, index: number): string {
  if (label === "T") return colors.magenta;
  const palette = [colors.cyan, colors.amber, colors.success, colors.violet, "#FF8A5C", "#5CB8FF", "#C084FC", "#F472B6"];
  return palette[index % palette.length];
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TrafficScreenState,
  scale: number,
  now: number,
): void {
  const board = boardRect(width, height, scale);
  const cell = board.size / GRID;
  const pad = scaledSize(10, scale);

  // Board plate.
  drawRoundRect(
    ctx,
    board.x - pad,
    board.y - pad,
    board.size + pad * 2,
    board.size + pad * 2,
    scaledSize(20, scale),
    "#0B0820",
    "rgba(0,229,255,0.28)",
    Math.max(1, scaledSize(2, scale)),
  );

  // Cells.
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const x = board.x + c * cell;
      const y = board.y + r * cell;
      ctx.fillStyle = (r + c) % 2 === 0 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.012)";
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cell, cell);
    }
  }

  // Exit marker on the target row.
  const exitY = board.y + EXIT_ROW * cell;
  ctx.save();
  ctx.fillStyle = "rgba(61,255,162,0.12)";
  ctx.fillRect(board.x + board.size - pad * 0.6, exitY, pad * 1.8, cell);
  ctx.fillStyle = colors.success;
  ctx.beginPath();
  ctx.moveTo(board.x + board.size + scaledSize(26, scale), exitY + cell / 2);
  ctx.lineTo(board.x + board.size + scaledSize(8, scale), exitY + cell * 0.2);
  ctx.lineTo(board.x + board.size + scaledSize(8, scale), exitY + cell * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 ${scaledSize(10, scale)}px ${fonts.title.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("EXIT", board.x + board.size + scaledSize(17, scale), exitY - scaledSize(2, scale));
  ctx.restore();

  // Cars.
  const cars = parseCars(state.cells);
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
  cars.forEach((car, i) => {
    const color = carColor(car.label, i);
    const inset = cell * 0.08;
    const w = car.horizontal ? car.len * cell - inset * 2 : cell - inset * 2;
    const h = car.horizontal ? cell - inset * 2 : car.len * cell - inset * 2;
    const x = board.x + car.col * cell + inset;
    const y = board.y + car.row * cell + inset;
    const isTarget = car.label === "T";

    ctx.save();
    if (car.selected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 20 * (0.6 + 0.4 * pulse);
    } else if (isTarget) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = isTarget ? color : color + "CC";
    drawRoundRect(ctx, x, y, w, h, Math.min(cell * 0.22, w * 0.3), ctx.fillStyle as string);

    // Windscreen / detail.
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(11,8,32,0.45)";
    if (car.horizontal) {
      drawRoundRect(ctx, x + w * 0.72, y + h * 0.26, w * 0.17, h * 0.48, cell * 0.06, ctx.fillStyle as string);
    } else {
      drawRoundRect(ctx, x + w * 0.26, y + h * 0.72, w * 0.48, h * 0.17, cell * 0.06, ctx.fillStyle as string);
    }

    // Label.
    ctx.fillStyle = isTarget ? colors.bg0 : "rgba(11,8,32,0.85)";
    ctx.font = `700 ${Math.max(scaledSize(14, scale), cell * 0.28)}px ${fonts.display.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(car.label, x + w / 2, y + h / 2 + 1);
    ctx.restore();

    if (car.selected) {
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = Math.max(1, scaledSize(2, scale));
      drawRoundRect(ctx, x - 2, y - 2, w + 4, h + 4, Math.min(cell * 0.26, w * 0.32));
      ctx.stroke();
    }
  });

  // Last message banner.
  if (state.lastMessage) {
    ctx.font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    const textW = ctx.measureText(state.lastMessage).width + scaledSize(32, scale);
    const bx = board.x + board.size / 2 - textW / 2;
    const by = board.y + board.size + scaledSize(14, scale);
    drawPill(ctx, bx, by, textW, scaledSize(30, scale), "rgba(11,8,32,0.8)", "rgba(255,255,255,0.12)", 1);
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.lastMessage, bx + textW / 2, by + scaledSize(16, scale));
  }

  // Solved overlay.
  if (state.phase === "solved") {
    ctx.save();
    ctx.fillStyle = "rgba(11,8,32,0.72)";
    ctx.fillRect(board.x - pad, board.y - pad, board.size + pad * 2, board.size + pad * 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${scaledSize(44, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = colors.success;
    ctx.shadowColor = colors.success;
    ctx.shadowBlur = 30;
    ctx.fillText("CLEARED", board.x + board.size / 2, board.y + board.size / 2);
    ctx.restore();
  }
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TrafficScreenState,
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

  // Level timer.
  const barY = rect.y + rect.height + scaledSize(16, scale);
  const progress = clamp(state.timeLeft / LEVEL_TIME_MS, 0, 1);
  ctx.font = `600 ${scaledSize(12, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("LEVEL TIME", rect.x + scaledSize(4, scale), barY);
  ctx.textAlign = "right";
  ctx.fillStyle = progress > 0.2 ? colors.text : colors.danger;
  ctx.fillText(`${Math.ceil(state.timeLeft / 1000)}s`, rect.x + rect.width - scaledSize(4, scale), barY);

  const bh = scaledSize(6, scale);
  drawRoundRect(ctx, rect.x + scaledSize(4, scale), barY + scaledSize(12, scale), rect.width - scaledSize(8, scale), bh, bh / 2, "rgba(255,255,255,0.08)");
  drawRoundRect(
    ctx,
    rect.x + scaledSize(4, scale),
    barY + scaledSize(12, scale),
    Math.max(bh, (rect.width - scaledSize(8, scale)) * progress),
    bh,
    bh / 2,
    progress > 0.35 ? colors.cyan : progress > 0.15 ? colors.amber : colors.danger,
  );

  // Turn line.
  const player = state.scores[state.currentPlayer];
  if (player && !state.finished) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("MOVING", rect.x + scaledSize(4, scale), barY + scaledSize(42, scale));
    ctx.font = `700 ${scaledSize(18, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.player[state.currentPlayer % colors.player.length];
    ctx.fillText(player.name, rect.x + scaledSize(78, scale), barY + scaledSize(42, scale));
  }
}
