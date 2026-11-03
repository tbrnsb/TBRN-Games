/**
 * Sea Battle — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Privacy: the server only exposes the last shot to the screen — never ship
 * positions. The battle map is therefore built from public shot results only,
 * and ship positions stay on the controllers.
 */

import {
  // Theme
  colors, fonts, scaleForViewport, scaledSize,
  // Background
  drawSynthwaveBackground,
  // Bento
  drawBentoCard,
  // Particles
  emitHitBurst, updateParticles, drawParticles,
  // Shake
  createShake, triggerShake, applyShakeTransform,
  // Title Card
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  // Victory
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  // Utils
  drawRoundRect, clamp, easeOutCubic,
} from "../../client/screen/kit/index.ts";

interface SeaBattlePlayer {
  name: string;
  shipsLeft: number;
  totalShips: number;
  eliminated: boolean;
  score: number;
}

interface LastShot {
  shooter: string;
  target: string;
  row: number;
  col: number;
  hit: boolean;
}

interface SeaBattleScreenState {
  phase: "placing" | "playing" | "finished";
  grid: number;
  rows: number;
  turnName: string | null;
  placingName: string | null;
  targetName: string | null;
  players: SeaBattlePlayer[];
  lastShot: LastShot | null;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface SeaBattleRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  shots: Map<string, Map<string, boolean>>;
  lastShotKey: string;
  signature: string;
  lastShotAt: number;
}

function createSeaBattleRenderState(): SeaBattleRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    shots: new Map(),
    lastShotKey: "",
    signature: "",
    lastShotAt: 0,
  };
}

const renderState = (globalThis as any)._seaBattleRenderState ||= createSeaBattleRenderState();

export function renderSeaBattle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SeaBattleScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: SeaBattleRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    const signature = state.players.map((p) => p.name).join("|");
    if (signature !== rs.signature) {
      rs.signature = signature;
      rs.shots.clear();
      rs.lastShotKey = "";
      rs.lastShotAt = 0;
    }

    recordShot(state, rs, now, width, height, scale);

    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
    }
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
    drawBattleMap(ctx, width, height, state, rs, scale, now);
    drawSidePanels(ctx, width, height, state, rs, scale, now);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function recordShot(
  state: SeaBattleScreenState,
  rs: SeaBattleRenderState,
  now: number,
  width: number,
  height: number,
  scale: number,
): void {
  const shot = state.lastShot;
  if (!shot) return;
  const key = `${shot.shooter}>${shot.target}:${shot.row},${shot.col}:${shot.hit ? 1 : 0}`;
  if (key === rs.lastShotKey) return;

  rs.lastShotKey = key;
  rs.lastShotAt = now;
  if (!rs.shots.has(shot.target)) rs.shots.set(shot.target, new Map());
  rs.shots.get(shot.target)!.set(`${shot.row},${shot.col}`, shot.hit);

  if (shot.hit) {
    const map = battleMapRect(width, height, scale);
    const cell = map.size / state.grid;
    emitHitBurst(
      map.x + (shot.col + 0.5) * cell,
      map.y + (shot.row + 0.5) * cell,
      colors.danger,
      scale,
    );
    triggerShake(rs.shake, 0.3, now);
  }
}

function handlePhaseChange(
  state: SeaBattleScreenState,
  rs: SeaBattleRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "placing") {
    rs.shots.clear();
    rs.lastShotKey = "";
    rs.titleCard = createTitleCard({
      title: "SEA BATTLE",
      subtitle: "Place your fleet on your phone — it stays hidden",
      duration: 2400,
      fadeInDuration: 450,
      holdDuration: 1300,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.phase === "finished" && state.winner) {
    const entries = buildRankedEntries(
      state.players.map((p) => ({ name: p.name, score: p.score })),
      state.winner.name,
    );
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Sea Battle",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function battleMapRect(
  width: number,
  height: number,
  scale: number,
): { x: number; y: number; size: number } {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const rightW = Math.min(width * 0.28, scaledSize(400, scale));
  const headerH = scaledSize(60, scale);
  const availableW = width - margin * 2 - rightW - gap;
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
  state: SeaBattleScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("SEA BATTLE", margin, margin + scaledSize(26, scale));
  const titleW = ctx.measureText("SEA BATTLE").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  const status =
    state.phase === "placing"
      ? `${state.placingName ?? "A player"} is placing their fleet`
      : state.phase === "playing"
        ? `${state.turnName ?? "?"} firing at ${state.targetName ?? "?"}`
        : "Battle over";
  ctx.fillText(status, margin + titleW + scaledSize(18, scale), margin + scaledSize(25, scale));

  if (state.phase === "playing" && state.targetName) {
    ctx.textAlign = "right";
    ctx.font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("TARGET", width - margin, margin + scaledSize(12, scale));
    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.magenta;
    ctx.fillText(state.targetName, width - margin, margin + scaledSize(34, scale));
  }
}

function drawBattleMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SeaBattleScreenState,
  rs: SeaBattleRenderState,
  scale: number,
  now: number,
): void {
  const map = battleMapRect(width, height, scale);
  const grid = state.grid;
  const cell = map.size / grid;
  const target = state.targetName ?? state.players[0]?.name ?? "";
  const shots = rs.shots.get(target) ?? new Map<string, boolean>();

  ctx.save();

  // Plate
  drawRoundRect(
    ctx,
    map.x - scaledSize(10, scale),
    map.y - scaledSize(10, scale),
    map.size + scaledSize(20, scale),
    map.size + scaledSize(20, scale),
    scaledSize(22, scale),
    "#080E24",
    "rgba(0,229,255,0.30)",
    Math.max(1, scaledSize(2, scale)),
  );

  ctx.beginPath();
  ctx.rect(map.x, map.y, map.size, map.size);
  ctx.clip();

  // Radar rings behind the grid.
  const cx = map.x + map.size / 2;
  const cy = map.y + map.size / 2;
  ctx.strokeStyle = "rgba(0,229,255,0.07)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (map.size / 2) * (i / 4), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Sweep line
  if (state.phase === "playing") {
    const angle = (now * 0.0006) % (Math.PI * 2);
    ctx.strokeStyle = "rgba(0,229,255,0.28)";
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * map.size * 0.62, cy + Math.sin(angle) * map.size * 0.62);
    ctx.stroke();

    // Fading trail behind the sweep.
    ctx.strokeStyle = "rgba(0,229,255,0.08)";
    for (let i = 1; i <= 4; i++) {
      const a = angle - i * 0.06;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * map.size * 0.62, cy + Math.sin(a) * map.size * 0.62);
      ctx.stroke();
    }
  }

  // Grid
  for (let i = 0; i <= grid; i++) {
    ctx.strokeStyle = i % 5 === 0 ? "rgba(0,229,255,0.18)" : "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(map.x + i * cell, map.y);
    ctx.lineTo(map.x + i * cell, map.y + map.size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(map.x, map.y + i * cell);
    ctx.lineTo(map.x + map.size, map.y + i * cell);
    ctx.stroke();
  }

  // Plotted shots for the current target.
  for (const [pos, hit] of shots) {
    const [r, c] = pos.split(",").map(Number);
    const x = map.x + (c + 0.5) * cell;
    const y = map.y + (r + 0.5) * cell;
    if (hit) {
      ctx.save();
      ctx.strokeStyle = colors.danger;
      ctx.shadowColor = colors.danger;
      ctx.shadowBlur = scaledSize(12, scale);
      ctx.lineWidth = Math.max(2, cell * 0.16);
      const s = cell * 0.24;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(0,229,255,0.65)";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, cell * 0.10), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Latest shot emphasis ring.
  const latest = state.lastShot;
  if (latest && latest.target === target && now - rs.lastShotAt < 900) {
    const t = clamp((now - rs.lastShotAt) / 900, 0, 1);
    const x = map.x + (latest.col + 0.5) * cell;
    const y = map.y + (latest.row + 0.5) * cell;
    ctx.strokeStyle = latest.hit ? colors.danger : colors.cyan;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = Math.max(1, scaledSize(3, scale));
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.4 + easeOutCubic(t) * 1.1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Coordinates
  ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let c = 0; c < grid; c++) {
    ctx.fillText(String.fromCharCode(65 + c), map.x + (c + 0.5) * cell, map.y - scaledSize(16, scale));
  }
  ctx.textAlign = "right";
  for (let r = 0; r < grid; r++) {
    ctx.fillText(String(r + 1), map.x - scaledSize(14, scale), map.y + (r + 0.5) * cell);
  }

  // Empty-state note, never a blank screen.
  if (state.phase === "placing") {
    ctx.textAlign = "center";
    ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = "rgba(245,243,255,0.55)";
    ctx.fillText("Fleet placement is private", cx, cy - scaledSize(10, scale));
    ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = "rgba(162,155,207,0.7)";
    ctx.fillText("Ships appear here only when hit", cx, cy + scaledSize(16, scale));
  }
}

function drawSidePanels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SeaBattleScreenState,
  rs: SeaBattleRenderState,
  scale: number,
  now: number,
): void {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(16, scale);
  const panelW = Math.min(width * 0.28, scaledSize(400, scale));
  const panelX = width - margin - panelW;
  const top = margin + scaledSize(60, scale);
  const availableH = height - margin - top;
  const shotH = scaledSize(150, scale);
  const fleetH = Math.min(
    availableH - shotH - gap,
    scaledSize(58, scale) * state.players.length + scaledSize(64, scale),
  );

  // Fleet panel: status and score per player.
  const fleetRect = { x: panelX, y: top, width: panelW, height: fleetH };
  drawBentoCard(ctx, fleetRect, { fill: "rgba(18,13,46,0.76)", stroke: colors.border });

  drawFleetPanel(ctx, fleetRect, state, scale);

  // Last shot card.
  const shotRect = { x: panelX, y: top + fleetH + gap, width: panelW, height: shotH };
  drawBentoCard(ctx, shotRect, { fill: "rgba(18,13,46,0.76)", stroke: colors.border });

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("LAST SHOT", shotRect.x + scaledSize(20, scale), shotRect.y + scaledSize(26, scale));

  const shot = state.lastShot;
  if (shot) {
    const age = now - rs.lastShotAt;
    const pop = age < 400 ? 0.9 + 0.1 * easeOutCubic(age / 400) : 1;
    const coord = `${String.fromCharCode(65 + shot.col)}${shot.row + 1}`;

    ctx.save();
    ctx.translate(shotRect.x + shotRect.width / 2, shotRect.y + shotRect.height * 0.55);
    ctx.scale(pop, pop);

    ctx.font = `700 ${scaledSize(34, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = shot.hit ? colors.danger : colors.cyan;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = shot.hit ? colors.danger : colors.cyan;
    ctx.shadowBlur = 18;
    ctx.fillText(shot.hit ? "HIT" : "MISS", 0, 0);
    ctx.shadowBlur = 0;

    ctx.font = `700 ${scaledSize(18, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(`${shot.shooter} → ${shot.target}`, 0, scaledSize(32, scale));

    ctx.font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(coord, 0, scaledSize(54, scale));
    ctx.restore();
  } else {
    ctx.font = `500 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No shots yet", shotRect.x + shotRect.width / 2, shotRect.y + shotRect.height * 0.62);
  }

  // Compact legend so marks are never colour-only.
  ctx.font = `500 ${scaledSize(10, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("✕ hit   ·   • miss", shotRect.x + scaledSize(20, scale), shotRect.y + shotRect.height - scaledSize(10, scale));
}

function drawFleetPanel(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  state: SeaBattleScreenState,
  scale: number,
): void {
  const pad = scaledSize(20, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${scaledSize(13, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("FLEETS", rect.x + pad, rect.y + scaledSize(26, scale));

  const n = Math.max(1, state.players.length);
  const listTop = rect.y + scaledSize(40, scale);
  const rowH = Math.min(scaledSize(82, scale), (rect.height - scaledSize(48, scale)) / n);

  state.players.forEach((p, i) => {
    const y = listTop + i * rowH;
    const color = colors.player[i % colors.player.length];
    const isTurn = state.turnName === p.name && state.phase === "playing";
    const isWinner = state.finished && state.winner?.name === p.name;

    if (isTurn || isWinner) {
      drawRoundRect(
        ctx,
        rect.x + pad * 0.5,
        y + scaledSize(4, scale),
        rect.width - pad,
        rowH - scaledSize(8, scale),
        scaledSize(10, scale),
        isWinner ? "rgba(61,255,162,0.14)" : "rgba(255,255,255,0.06)",
      );
    }

    ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = p.eliminated ? colors.textMuted : isTurn ? color : colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(p.name, rect.x + pad, y + rowH * 0.34);

    // Score
    ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = p.eliminated ? colors.textMuted : colors.amber;
    ctx.textAlign = "right";
    ctx.fillText(String(p.score), rect.x + rect.width - pad, y + rowH * 0.34);

    // Ship pips: filled = afloat, hollow = sunk.
    const pipR = Math.max(2, scaledSize(4, scale));
    const pipGap = pipR * 2 + scaledSize(5, scale);
    for (let s = 0; s < p.totalShips; s++) {
      const px = rect.x + pad + pipR + s * pipGap;
      const py = y + rowH * 0.68;
      if (s < p.shipsLeft) {
        ctx.fillStyle = colors.success;
        ctx.beginPath();
        ctx.arc(px, py, pipR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(245,243,255,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, pipR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // State tag
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
    if (p.eliminated) {
      ctx.fillStyle = colors.danger;
      ctx.fillText("SUNK", rect.x + rect.width - pad, y + rowH * 0.68);
    } else if (isTurn) {
      ctx.fillStyle = color;
      ctx.fillText("FIRING", rect.x + rect.width - pad, y + rowH * 0.68);
    } else if (state.phase === "placing" && state.placingName === p.name) {
      ctx.fillStyle = colors.amber;
      ctx.fillText("PLACING", rect.x + rect.width - pad, y + rowH * 0.68);
    }
  });
}
