/**
 * Guess Who — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Privacy: the server sends only public character ids/names, turn history and
 * per-player counts — never secrets or personal boards. Tiles are abstract
 * avatars so nothing can be inferred from the screen.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, clamp,
} from "../../client/screen/kit/index.ts";

interface GuessWhoPlayer {
  name: string;
  lives: number;
  out: boolean;
  remaining: number;
  score: number;
  connected: boolean;
}

interface GuessWhoHistory {
  asker: string;
  target: string;
  label: string;
  answer: boolean;
}

interface GuessWhoScreenState {
  phase: "playing" | "finished";
  characters: Array<{ id: number; name: string }>;
  turnName: string | null;
  timeLeft: number;
  history: GuessWhoHistory[];
  lastEvent: string | null;
  players: GuessWhoPlayer[];
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface GuessWhoRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastHistory: number;
}

const TURN_MS = 45000;

function createGuessWhoRenderState(): GuessWhoRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastHistory: 0,
  };
}

const renderState = (globalThis as any)._guessWhoRenderState ||= createGuessWhoRenderState();

export function renderGuesswho(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GuessWhoScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: GuessWhoRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.history.length > rs.lastHistory) {
      triggerShake(rs.shake, 0.06, now);
      emitScoreBurst(width * 0.85, height * 0.18, 0, scale);
    }
    rs.lastHistory = state.history.length;

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
    drawBoard(ctx, width, height, state, scale, now);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: GuessWhoScreenState,
  rs: GuessWhoRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "playing" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "GUESS WHO",
      subtitle: "Ask, narrow the board, then guess",
      duration: 2200,
      fadeInDuration: 450,
      holdDuration: 1100,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.finished && state.winner) {
    const entries = buildRankedEntries(
      state.players.map((p) => ({ name: p.name, score: p.score })),
      state.winner.name,
    );
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Guess Who",
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
    gap,
    main: {
      x: margin,
      y: margin + headerH,
      width: width - margin * 2 - railW - gap,
      height: height - margin * 2 - headerH,
    },
    rail: { x: width - margin - railW, y: margin, width: railW, height: height - margin * 2 },
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GuessWhoScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("GUESS WHO", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("GUESS WHO").width;

  const alive = state.players.filter((p) => !p.out).length;
  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${alive} of ${state.players.length} still in`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GuessWhoScreenState,
  scale: number,
  now: number,
): void {
  const { main } = layout(width, height, scale);
  const cols = 6;
  const rows = 4;
  const historyH = scaledSize(64, scale);
  const boardH = main.height - historyH;
  const gap = scaledSize(6, scale);
  const tileW = (main.width - gap * (cols - 1)) / cols;
  const tileH = (boardH - gap * (rows - 1)) / rows;

  drawBentoCard(
    ctx,
    { x: main.x, y: main.y, width: main.width, height: boardH },
    { fill: "rgba(18,13,46,0.86)", stroke: colors.border },
  );

  state.characters.slice(0, cols * rows).forEach((char, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = main.x + col * (tileW + gap);
    const y = main.y + row * (tileH + gap);
    drawCharacterTile(ctx, x, y, tileW, tileH, char.id, scale, now, i);
  });

  // Recent questions.
  const historyY = main.y + boardH + gap;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    state.lastEvent ?? "Waiting for the first question…",
    main.x + scaledSize(4, scale),
    historyY + scaledSize(20, scale),
  );

  const last = state.history[state.history.length - 1];
  if (last) {
    const text = `${last.asker} → ${last.target}: ${last.label} — ${last.answer ? "Yes" : "No"}`;
    ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(text, main.x + scaledSize(4, scale), historyY + scaledSize(44, scale));
  }
}

function drawCharacterTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  id: number,
  scale: number,
  now: number,
  index: number,
): void {
  // Deterministic abstract avatar; not the real attributes (those are secret).
  const hue = (id * 47) % 360;
  const accent = `hsl(${hue}, 70%, 62%)`;
  const bob = Math.sin(now * 0.002 + index) * 1.2;

  ctx.save();
  drawRoundRect(ctx, x, y, w, h, scaledSize(10, scale), "rgba(11,8,32,0.72)", "rgba(255,255,255,0.07)", 1);

  const cx = x + w / 2;
  const cy = y + h * 0.48 + bob;
  const r = Math.min(w, h) * 0.22;

  // Shoulders.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 1.8, r * 1.5, r * 1.05, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // Head.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Hair / hat depending on bits of the id (decorative only).
  ctx.fillStyle = "rgba(11,8,32,0.65)";
  if (id % 3 === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.24, r * 1.02, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (id % 5 === 0) {
    drawRoundRect(ctx, cx - r * 1.1, cy - r * 1.05, r * 2.2, r * 0.42, r * 0.2, "rgba(11,8,32,0.75)");
  }

  // Glasses.
  if (id % 4 === 0) {
    ctx.strokeStyle = "rgba(11,8,32,0.8)";
    ctx.lineWidth = Math.max(1, r * 0.13);
    ctx.beginPath();
    ctx.arc(cx - r * 0.38, cy - r * 0.05, r * 0.26, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.38, cy - r * 0.05, r * 0.26, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Number badge.
  ctx.fillStyle = "rgba(11,8,32,0.7)";
  ctx.beginPath();
  ctx.arc(x + w * 0.16, y + h * 0.16, Math.max(8, r * 0.42), 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 ${Math.max(scaledSize(10, scale), r * 0.5)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(id + 1), x + w * 0.16, y + h * 0.16 + 1);

  ctx.restore();
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GuessWhoScreenState,
  scale: number,
): void {
  const { rail } = layout(width, height, scale);
  const n = Math.max(1, state.players.length);
  const listH = Math.min(rail.height, scaledSize(80, scale) + n * scaledSize(76, scale));
  const rect = { ...rail, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.magenta });

  const entries = state.players.map((p, i) => ({
    name: p.name,
    score: p.score,
    playerIndex: i,
    isCurrent: state.turnName === p.name && state.phase === "playing",
    isWinner: state.finished && state.winner?.name === p.name,
    animatedScore: p.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "PLAYERS", scale });

  // Lives + remaining board, one line per player.
  const detailTop = rail.y + listH + scaledSize(20, scale);
  state.players.forEach((p, i) => {
    const y = detailTop + i * scaledSize(26, scale);
    if (y > rail.y + listH + scaledSize(120, scale)) return;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = p.out ? colors.danger : colors.textMuted;
    ctx.fillText(p.out ? `${p.name} — out` : `${p.name}`, rail.x + scaledSize(6, scale), y);

    // Hearts for lives.
    const baseX = rail.x + rail.width - scaledSize(6, scale);
    ctx.textAlign = "right";
    ctx.fillStyle = p.out ? colors.danger : colors.success;
    const lives = Math.max(0, Math.min(3, p.lives));
    ctx.font = `700 ${scaledSize(18, scale)}px ${fonts.body.family}`;
    ctx.fillText(`${"♥".repeat(lives)}${"·".repeat(Math.max(0, 3 - lives))}`, baseX, y);

    ctx.textAlign = "right";
    ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(`${p.remaining} left`, baseX - scaledSize(56, scale), y);
  });

  // Turn timer directly under the detail lines.
  if (state.turnName && state.phase === "playing") {
    const progress = clamp(state.timeLeft / TURN_MS, 0, 1);
    const barY = detailTop + state.players.length * scaledSize(26, scale) + scaledSize(10, scale);
    drawRoundRect(ctx, rail.x + scaledSize(6, scale), barY, rail.width - scaledSize(12, scale), scaledSize(6, scale), scaledSize(3, scale), "rgba(255,255,255,0.08)");
    drawRoundRect(
      ctx,
      rail.x + scaledSize(6, scale),
      barY,
      Math.max(scaledSize(6, scale), (rail.width - scaledSize(12, scale)) * progress),
      scaledSize(6, scale),
      scaledSize(3, scale),
      progress > 0.25 ? colors.cyan : colors.danger,
    );
  }
}
