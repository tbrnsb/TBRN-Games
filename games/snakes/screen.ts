/**
 * Snakes — Premium Screen Renderer
 * Synthwave + Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: the full arena, every snake, food and live scores.
 * Bodies arrive from the server exactly as simulated; this file only draws them.
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
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  // Utils
  drawRoundRect, clamp,
} from "../../client/screen/kit/index.ts";

interface Segment { x: number; y: number; }

interface SnakeDisplay {
  body: Segment[];
  color: string;
  alive: boolean;
  score: number;
}

interface SnakesScreenState {
  snakes: SnakeDisplay[];
  food: Segment[];
  gridSize: number;
  phase: "playing" | "finished";
  scores: Array<{ name: string; score: number; alive: boolean }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface SnakesRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastScores: number[];
  lastAlive: boolean[];
}

function createSnakesRenderState(): SnakesRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastScores: [],
    lastAlive: [],
  };
}

const renderState = (globalThis as any)._snakesRenderState ||= createSnakesRenderState();

export function renderSnakes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SnakesScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: SnakesRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    reactToEvents(state, rs, now, width, height, scale);

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

    drawArena(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function reactToEvents(
  state: SnakesScreenState,
  rs: SnakesRenderState,
  now: number,
  width: number,
  height: number,
  scale: number,
): void {
  state.snakes.forEach((snake, i) => {
    const prevScore = rs.lastScores[i];
    const wasAlive = rs.lastAlive[i] ?? true;

    if (prevScore !== undefined && snake.score > prevScore) {
      const head = snake.body[0];
      const arena = arenaRect(width, height, state.gridSize, scale);
      emitScoreBurst(
        arena.x + (head.x + 0.5) * (arena.size / state.gridSize),
        arena.y + (head.y + 0.5) * (arena.size / state.gridSize),
        i,
        scale,
      );
      triggerShake(rs.shake, 0.18, now);
    }

    if (wasAlive && !snake.alive) {
      triggerShake(rs.shake, 0.35, now);
    }

    rs.lastScores[i] = snake.score;
    rs.lastAlive[i] = snake.alive;
  });
}

function handlePhaseChange(
  state: SnakesScreenState,
  rs: SnakesRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "playing" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "SNAKES",
      subtitle: "Eat. Grow. Don't crash.",
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
        gameName: "Snakes",
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
  _gridSize: number,
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

function drawArena(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SnakesScreenState,
  scale: number,
  now: number,
): void {
  const grid = state.gridSize;
  const arena = arenaRect(width, height, grid, scale);
  const cell = arena.size / grid;

  // Header
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("SNAKES", margin, margin + scaledSize(26, scale));
  const titleW = ctx.measureText("SNAKES").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(`${grid} × ${grid} arena`, margin + titleW + scaledSize(18, scale), margin + scaledSize(25, scale));

  // Arena plate
  ctx.save();
  drawRoundRect(
    ctx,
    arena.x - scaledSize(8, scale),
    arena.y - scaledSize(8, scale),
    arena.size + scaledSize(16, scale),
    arena.size + scaledSize(16, scale),
    scaledSize(20, scale),
    "#0B0820",
    "rgba(0,229,255,0.28)",
    Math.max(1, scaledSize(2, scale)),
  );

  ctx.beginPath();
  ctx.rect(arena.x, arena.y, arena.size, arena.size);
  ctx.clip();

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= grid; i++) {
    const p = i * cell;
    ctx.beginPath();
    ctx.moveTo(arena.x + p, arena.y);
    ctx.lineTo(arena.x + p, arena.y + arena.size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(arena.x, arena.y + p);
    ctx.lineTo(arena.x + arena.size, arena.y + p);
    ctx.stroke();
  }

  // Food
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
  state.food.forEach((f) => {
    const x = arena.x + (f.x + 0.5) * cell;
    const y = arena.y + (f.y + 0.5) * cell;
    const r = cell * (0.28 + 0.05 * pulse);

    ctx.save();
    ctx.shadowColor = colors.amber;
    ctx.shadowBlur = scaledSize(18, scale);
    ctx.fillStyle = colors.amber;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Snakes
  state.snakes.forEach((snake, i) => {
    if (snake.body.length === 0) return;
    const color = snake.color || colors.player[i % colors.player.length];
    const dead = !snake.alive;
    const total = snake.body.length;

    ctx.save();
    ctx.globalAlpha = dead ? 0.28 : 1;

    // Body, tail first so the head lands on top.
    for (let j = total - 1; j >= 0; j--) {
      const seg = snake.body[j];
      const x = arena.x + seg.x * cell;
      const y = arena.y + seg.y * cell;
      const isHead = j === 0;
      const inset = cell * (isHead ? 0.08 : 0.13);
      const alpha = isHead ? 1 : clamp(1 - (j / Math.max(1, total)) * 0.55, 0.35, 1);

      ctx.globalAlpha = (dead ? 0.28 : 1) * alpha;
      ctx.fillStyle = color;
      if (isHead && !dead) {
        ctx.shadowColor = color;
        ctx.shadowBlur = scaledSize(16, scale);
      } else {
        ctx.shadowBlur = 0;
      }
      drawRoundRect(
        ctx,
        x + inset,
        y + inset,
        cell - inset * 2,
        cell - inset * 2,
        isHead ? cell * 0.32 : cell * 0.24,
        color,
      );
    }

    // Head detail: eyes oriented along the direction of travel.
    const head = snake.body[0];
    const neck = snake.body[1] ?? head;
    const dx = head.x - neck.x;
    const dy = head.y - neck.y;
    const hx = arena.x + (head.x + 0.5) * cell;
    const hy = arena.y + (head.y + 0.5) * cell;
    const eyeOffset = cell * 0.2;
    const eyeR = Math.max(1.5, cell * 0.075);

    ctx.shadowBlur = 0;
    if (dead) {
      // Dead heads get a cross so the outcome is readable without colour.
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = Math.max(2, cell * 0.12);
      const s = cell * 0.24;
      ctx.beginPath();
      ctx.moveTo(hx - s, hy - s);
      ctx.lineTo(hx + s, hy + s);
      ctx.moveTo(hx + s, hy - s);
      ctx.lineTo(hx - s, hy + s);
      ctx.stroke();
    } else {
      ctx.fillStyle = colors.bg0;
      const front = cell * 0.16;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Horizontal
        ctx.beginPath();
        ctx.arc(hx + Math.sign(dx || 1) * front, hy - eyeOffset, eyeR, 0, Math.PI * 2);
        ctx.arc(hx + Math.sign(dx || 1) * front, hy + eyeOffset, eyeR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(hx - eyeOffset, hy + Math.sign(dy || 1) * front, eyeR, 0, Math.PI * 2);
        ctx.arc(hx + eyeOffset, hy + Math.sign(dy || 1) * front, eyeR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  });

  ctx.restore();
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SnakesScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const railH = Math.min(
    height - margin * 2,
    scaledSize(64, scale) * state.scores.length + scaledSize(104, scale),
  );
  const rect = {
    x: width - margin - railW,
    y: margin,
    width: railW,
    height: railH,
  };
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.86)", stroke: colors.border });

  const entries = state.scores.map((s, i) => ({
    name: s.name,
    score: s.score,
    playerIndex: i,
    isCurrent: false,
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: s.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "SCORES", scale });

  // Alive summary below the card.
  const alive = state.scores.filter((s) => s.alive).length;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${alive} of ${state.scores.length} still alive`,
    rect.x + scaledSize(4, scale),
    rect.y + rect.height + scaledSize(18, scale),
  );
}
