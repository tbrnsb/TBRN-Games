/**
 * Poker — Texas Hold'em Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: community cards, pot, seats, bets, phase and turn timer.
 * Hole cards are never drawn except at showdown, when the server reveals them.
 */

import {
  // Theme
  colors, fonts, scaleForViewport, scaledSize,
  // Background
  drawSynthwaveBackground,
  // Bento
  // Particles
  emitScoreBurst, updateParticles, drawParticles,
  // Shake
  createShake, triggerShake, applyShakeTransform,
  // Title Card
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  // Victory
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  // Utils
  drawRoundRect, drawPill, clamp,
} from "../../client/screen/kit/index.ts";
import { paperTitle, paperMeta } from "../../client/screen/kit/header.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";

type Suit = "hearts" | "diamonds" | "clubs" | "spades";
interface CardDisplay {
  suit: Suit;
  rank: string;
}

interface PlayerDisplay {
  name: string;
  chips: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  out: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: string | null;
  connected: boolean;
}

interface PokerScreenState {
  phase: "preflop" | "flop" | "turn" | "river" | "showdown" | "hand-end" | "finished";
  handNumber: number;
  maxHands: number;
  community: CardDisplay[];
  pot: number;
  /** Main pot plus every side pot; more than one when players are all-in. */
  pots: Array<{ amount: number; label: string }>;
  currentBet: number;
  players: PlayerDisplay[];
  turnName: string | null;
  timeLeft: number;
  showdown: Array<{ name: string; handName: string }> | null;
  potBreakdown: Array<{ amount: number; winners: string[] }> | null;
  results: string[] | null;
  finished: boolean;
  winner: { name: string; chips: number } | null;
}

interface PokerRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastHand: number;
}

const ACTION_TIMEOUT_MS = 25000;

function createPokerRenderState(): PokerRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastHand: -1,
  };
}

const renderState = (globalThis as any)._pokerRenderState ||= createPokerRenderState();

/** This renderer draws its own score rail; the platform ticker stays off. */
export const showsScores = true;

export function renderPoker(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PokerScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: PokerRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.phase !== rs.lastPhase || state.handNumber !== rs.lastHand) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
      rs.lastHand = state.handNumber;
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

    drawTable(ctx, width, height, state, scale);
    drawHeader(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: PokerScreenState,
  rs: PokerRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "preflop" && state.handNumber > 0) {
    rs.titleCard = createTitleCard({
      title: `HAND ${state.handNumber}`,
      subtitle: `of ${state.maxHands} · blinds posted`,
      duration: 1500,
      fadeInDuration: 350,
      holdDuration: 800,
      fadeOutDuration: 350,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.phase === "showdown") {
    triggerShake(rs.shake, 0.2, now);
    emitScoreBurst(width * 0.5, height * 0.42, 0, scaleForViewport(width, height));
  }

  if (state.phase === "finished" && state.winner) {
    const entries = buildRankedEntries(
      state.players.map((p) => ({ name: p.name, score: p.chips })),
      state.winner.name,
    );
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Poker",
        duration: 0,
        scoreSuffix: "chips",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PokerScreenState,
  scale: number,
): void {
  const margin = scaledSize(48, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  paperTitle(ctx, scale);
  ctx.fillText("POKER", margin, margin + scaledSize(26, scale));
  const wordW = ctx.measureText("POKER").width;

  paperMeta(ctx, scale);
  const meta = `Hand ${Math.max(1, state.handNumber)} of ${state.maxHands}  ·  ${phaseLabel(state.phase)}`;
  ctx.fillText(meta, margin + wordW + scaledSize(18, scale), margin + scaledSize(25, scale));

  // Turn / pot summary on the right.
  if (state.turnName) {
    ctx.textAlign = "right";
    ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.amber;
    const seconds = Math.max(0, Math.ceil(state.timeLeft / 1000));
    ctx.fillText(`${state.turnName} to act${seconds > 0 ? ` · ${seconds}s` : ""}`, width - margin, margin + scaledSize(24, scale));
  }
  void height;
}

function phaseLabel(phase: PokerScreenState["phase"]): string {
  switch (phase) {
    case "preflop": return "Preflop";
    case "flop": return "Flop";
    case "turn": return "Turn";
    case "river": return "River";
    case "showdown": return "Showdown";
    case "hand-end": return "Hand complete";
    case "finished": return "Final";
  }
}

interface TableGeometry {
  area: { x: number; y: number; width: number; height: number };
  cx: number;
  cy: number;
  feltRX: number;
  feltRY: number;
  seatRX: number;
  seatRY: number;
  scale: number;
}

/** One shared table geometry so the renderer and the layout test agree. */
function tableGeometry(width: number, height: number): TableGeometry {
  const scale = scaleForViewport(width, height);
  const margin = scaledSize(48, scale);
  const headerH = scaledSize(56, scale);
  const area = {
    x: margin,
    y: margin + headerH,
    width: width - margin * 2,
    height: height - margin * 2 - headerH,
  };
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const feltRX = area.width * 0.30;
  const feltRY = area.height * 0.31;
  return {
    area,
    cx,
    cy,
    feltRX,
    feltRY,
    seatRX: feltRX + scaledSize(78, scale),
    seatRY: feltRY + scaledSize(64, scale),
    scale,
  };
}

/** A seat panel rectangle in screen pixels. */
export interface SeatBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Seat panel rectangles for a table of `playerCount`.
 * Exported so tests can prove the eight-seat ring never overlaps.
 */
export function pokerSeatLayout(
  playerCount: number,
  width: number,
  height: number,
): SeatBox[] {
  const geometry = tableGeometry(width, height);
  const panelWidth = scaledSize(280, geometry.scale);
  const panelHeight = scaledSize(116, geometry.scale);
  return seatPositions(playerCount, geometry.cx, geometry.cy, geometry.seatRX, geometry.seatRY)
    .map((position) => ({
      x: position.x - panelWidth / 2,
      y: position.y - panelHeight / 2,
      width: panelWidth,
      height: panelHeight,
    }));
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PokerScreenState,
  scale: number,
): void {
  const { area, cx, cy, feltRX, feltRY } = tableGeometry(width, height);

  // Paper table: flat mint stock, ink rim, cream inlay and a stitched line.
  ctx.save();
  ctx.shadowColor = "rgba(29,27,38,0.28)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = Math.max(4, scaledSize(7, scale));
  ctx.shadowOffsetY = Math.max(4, scaledSize(7, scale));
  ctx.fillStyle = "#E4F2EA";
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRX, feltRY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(3, scaledSize(5, scale));
  ctx.stroke();
  ctx.strokeStyle = "#FFFDF5";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRX - Math.max(6, scaledSize(9, scale)), feltRY - Math.max(6, scaledSize(9, scale)), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([Math.max(6, scaledSize(9, scale)), Math.max(6, scaledSize(9, scale))]);
  ctx.strokeStyle = "rgba(29,27,38,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRX - Math.max(16, scaledSize(24, scale)), feltRY - Math.max(16, scaledSize(24, scale)), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Community cards. Undealt slots are the same striped back as the phone.
  const cardW = scaledSize(108, scale);
  const cardH = scaledSize(150, scale);
  const cardGap = scaledSize(12, scale);
  const totalW = 5 * cardW + 4 * cardGap;
  const cardsX = cx - totalW / 2;
  const cardsY = cy - feltRY * 0.48;

  ctx.font = `700 ${Math.max(10, scaledSize(13, scale))}px ${fonts.body.family}`;
  ctx.fillStyle = "rgba(29,27,38,0.55)";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("COMMUNITY", cx, cardsY - Math.max(7, scaledSize(10, scale)));

  for (let i = 0; i < 5; i++) {
    const x = cardsX + i * (cardW + cardGap);
    if (i < state.community.length) {
      drawCard(ctx, x, cardsY, cardW, cardH, state.community[i], scale);
    } else {
      drawCardBack(ctx, x, cardsY, cardW, cardH, scale, 0.92);
    }
  }

  // Pots. One large pill when there is a single pot; a compact row list when
  // side pots exist, so every all-in level stays visible on the TV.
  // Anchor the pot below the community cards: the old fixed centre made the
  // preflop card backs collide with the POT / SIDE / current-bet stack.
  const cardsBottom = cardsY + cardH;
  const potTop = Math.max(cy + feltRY * 0.30, cardsBottom + scaledSize(26, scale));
  const potY = potTop + scaledSize(24, scale);
  let infoY = potY;
  const pots = state.pots.length > 0
    ? state.pots
    : state.pot > 0
      ? [{ amount: state.pot, label: "POT" }]
      : [];

  if (pots.length <= 1) {
    const potText = pots[0] ? String(pots[0].amount) : "—";
    ctx.font = `700 ${scaledSize(30, scale)}px ${fonts.display.family}`;
    const potLabelW = ctx.measureText(potText).width + scaledSize(104, scale);
    const potW = Math.max(scaledSize(164, scale), potLabelW);
    drawChipStack(ctx, cx - potW / 2 - scaledSize(34, scale), potY, scale);
    drawPill(
      ctx,
      cx - potW / 2,
      potY - scaledSize(24, scale),
      potW,
      scaledSize(48, scale),
      "#FFFDF5",
      colors.border,
      Math.max(2, scaledSize(2.5, scale)),
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.cardMuted;
    ctx.textAlign = "left";
    ctx.fillText("POT", cx - potW / 2 + scaledSize(18, scale), potY);
    ctx.textAlign = "right";
    ctx.font = `700 ${scaledSize(34, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.cardText;
    ctx.fillText(potText, cx + potW / 2 - scaledSize(18, scale), potY + 1);
    infoY = potY + scaledSize(28, scale);
  } else {
    infoY = drawPotRows(ctx, cx, potTop, pots, scale, area.width * 0.72);
  }

  // Current bet
  if (state.currentBet > 0 && state.phase !== "showdown" && state.phase !== "hand-end") {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.cardMuted;
    ctx.fillText(`Current bet ${state.currentBet}`, cx, infoY + scaledSize(18, scale));
  }

  // Results (fold win / split pot) below the pots.
  if (state.results && state.results.length > 0 && (state.phase === "hand-end" || state.phase === "showdown")) {
    const startY = infoY + scaledSize(40, scale);
    ctx.textAlign = "center";
    state.results.slice(0, 2).forEach((line, i) => {
      ctx.font = `${i === 0 ? 700 : 500} ${scaledSize(i === 0 ? 20 : 15, scale)}px ${fonts.display.family}`;
      ctx.fillStyle = i === 0 ? colors.success : colors.cardMuted;
      ctx.fillText(line, cx, startY + i * scaledSize(24, scale));
    });
  }

  // Seats: four fixed anchors up to four players, an even ring from five so
  // all eight panels fit without colliding.
  const n = state.players.length;
  const seatRX = feltRX + scaledSize(78, scale);
  const seatRY = feltRY + scaledSize(64, scale);
  const positions = seatPositions(n, cx, cy, seatRX, seatRY);

  // Two face-down hole cards in front of every live seat, using the phone's
  // striped back. The TV never sees the faces, so this is the honest view.
  const holeW = scaledSize(40, scale);
  const holeH = scaledSize(54, scale);
  const holeGap = scaledSize(6, scale);
  const holeTotal = holeW * 2 + holeGap;
  state.players.forEach((player, i) => {
    if (player.out || player.folded) return;
    const pos = positions[i];
    // Sit the pair inside the felt, clearly inboard of the seat plate. The old
    // panel-edge anchor tucked the outer card under the plate at 8 seats.
    const px = cx + (pos.x - cx) * 0.66;
    const py = cy + (pos.y - cy) * 0.66;
    drawCardBack(ctx, px - holeTotal / 2, py - holeH / 2, holeW, holeH, scale, 0.95);
    drawCardBack(ctx, px - holeTotal / 2 + holeW + holeGap, py - holeH / 2, holeW, holeH, scale, 0.95);
  });

  state.players.forEach((player, i) => {
    drawSeat(ctx, positions[i].x, positions[i].y, player, i, state, scale);
  });
}

/** A short stack of paper chips, for the pot. */
function drawChipStack(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const chipW = Math.max(20, scaledSize(30, scale));
  const chipH = Math.max(7, scaledSize(10, scale));
  const colours = ["#F0453A", "#FFFDF5", "#0E8C8C", "#FFFDF5", "#F0453A"];
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const cy = y + chipH * 1.2 - i * chipH * 0.78;
    ctx.fillStyle = colours[i];
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(1, scaledSize(2, scale));
    ctx.beginPath();
    ctx.ellipse(x, cy, chipW / 2 - (i % 2) * 1.5, chipH / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw every pot as a compact pill and pack the rows into `maxWidth`.
 * Returns the y coordinate just below the last row.
 */
function drawPotRows(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  pots: Array<{ amount: number; label: string }>,
  scale: number,
  maxWidth: number,
): number {
  const height = scaledSize(32, scale);
  const gap = scaledSize(10, scale);
  const padX = scaledSize(14, scale);
  const font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
  ctx.font = font;

  const items = pots.map((pot) => {
    const text = `${pot.label} ${pot.amount}`;
    return { text, width: ctx.measureText(text).width + padX * 2 };
  });

  const rows: Array<Array<{ text: string; width: number }>> = [];
  let row: Array<{ text: string; width: number }> = [];
  let rowWidth = 0;
  for (const item of items) {
    const extra = row.length > 0 ? gap : 0;
    if (row.length > 0 && rowWidth + extra + item.width > maxWidth) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    rowWidth += (row.length > 0 ? gap : 0) + item.width;
    row.push(item);
  }
  if (row.length > 0) rows.push(row);

  rows.forEach((cells, rowIndex) => {
    const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0) + gap * (cells.length - 1);
    let x = cx - totalWidth / 2;
    const y = top + rowIndex * (height + gap);
    for (const cell of cells) {
      drawPill(
        ctx,
        x,
        y,
        cell.width,
        height,
        "#FFFDF5",
        "rgba(255,179,71,0.5)",
        Math.max(1, scaledSize(1.5, scale)),
      );
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font;
      ctx.fillStyle = colors.cardText;
      ctx.fillText(cell.text, x + cell.width / 2, y + height / 2 + 1);
      x += cell.width + gap;
    }
  });

  return top + rows.length * height + Math.max(0, rows.length - 1) * gap;
}

/** Seat centres around the table: four anchors below five, an even ring above. */
function seatPositions(
  playerCount: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Array<{ x: number; y: number }> {
  if (playerCount <= 0) return [];
  if (playerCount <= 4) {
    return Array.from({ length: playerCount }, (_, i) =>
      seatAnchor(Math.round((i * 4) / playerCount) % 4, cx, cy, rx, ry),
    );
  }
  return Array.from({ length: playerCount }, (_, i) => {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / playerCount;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function seatAnchor(
  anchor: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): { x: number; y: number } {
  switch (anchor) {
    case 0: return { x: cx, y: cy + ry };       // bottom
    case 1: return { x: cx - rx, y: cy };       // left
    case 2: return { x: cx, y: cy - ry };       // top
    default: return { x: cx + rx, y: cy };      // right
  }
}

function drawSeat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  player: PlayerDisplay,
  playerIndex: number,
  state: PokerScreenState,
  scale: number,
): void {
  const w = scaledSize(280, scale);
  const h = scaledSize(116, scale);
  const left = x - w / 2;
  const top = y - h / 2;
  const seat = seatForIndex(playerIndex);
  const isTurn = state.turnName === player.name;
  const isWinner = !!state.showdown?.some((s) => s.name === player.name && s.handName.length > 0)
    && !!state.potBreakdown?.some((p) => p.winners.includes(player.name));
  const showdown = state.showdown?.find((s) => s.name === player.name) ?? null;

  ctx.save();
  ctx.globalAlpha = player.out ? 0.45 : player.folded ? 0.6 : 1;

  drawRoundRect(
    ctx,
    left,
    top,
    w,
    h,
    scaledSize(16, scale),
    "#FFFDF5",
    isTurn ? seat.color : isWinner ? colors.success : "rgba(29,27,38,0.18)",
    isTurn || isWinner ? Math.max(2, scaledSize(3, scale)) : 1,
  );

  // Seat badge, so the TV uses the same colour/shape identity as the phones.
  const badge = scaledSize(28, scale);
  const badgeX = left + scaledSize(14, scale);
  const badgeY = top + scaledSize(18, scale);
  ctx.fillStyle = seat.color;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.beginPath();
  ctx.arc(badgeX + badge / 2, badgeY + badge / 2, badge / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#FFFDF5";
  ctx.font = `700 ${Math.max(9, badge * 0.46)}px ${fonts.title.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(seat.emoji, badgeX + badge / 2, badgeY + badge / 2 + 0.5);

  // Name
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(24, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = player.folded || player.out ? colors.cardMuted : colors.cardText;
  ctx.fillText(player.name, badgeX + badge + scaledSize(8, scale), top + scaledSize(28, scale));

  // Chips
  ctx.font = `700 ${scaledSize(30, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.cardText;
  ctx.fillText(String(player.chips), left + scaledSize(14, scale), top + h - scaledSize(24, scale));

  // Bet / last action (hidden at showdown, where the hand name takes this space).
  if (!showdown && player.lastAction) {
    ctx.textAlign = "right";
    ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.cardMuted;
    ctx.fillText(player.lastAction, left + w - scaledSize(14, scale), top + h - scaledSize(24, scale));
  } else if (!showdown && player.bet > 0) {
    ctx.textAlign = "right";
    ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.cyan;
    ctx.fillText(`bet ${player.bet}`, left + w - scaledSize(14, scale), top + h - scaledSize(24, scale));
  }

  // Status pill (dealer / SB / BB / ALL IN / OUT / FOLDED)
  let pill = "";
  let pillColor: string = colors.surfaceHi;
  if (player.out) { pill = "OUT"; pillColor = colors.textMuted; }
  else if (player.allIn) { pill = "ALL IN"; pillColor = colors.danger; }
  else if (player.folded) { pill = "FOLDED"; pillColor = colors.textMuted; }

  if (pill) {
    ctx.textAlign = "center";
    ctx.font = `700 ${scaledSize(11, scale)}px ${fonts.title.family}`;
    const pw = ctx.measureText(pill).width + scaledSize(18, scale);
    drawPill(ctx, left + w / 2 - pw / 2, top - scaledSize(13, scale), pw, scaledSize(22, scale), pillColor);
    ctx.fillStyle = colors.bg0;
    ctx.textBaseline = "middle";
    ctx.fillText(pill, left + w / 2, top - scaledSize(1, scale));
  }

  // Blinds / dealer badges along the top edge.
  const badges: Array<{ text: string; color: string }> = [];
  if (player.isDealer) badges.push({ text: "D", color: "#FFC21A" });
  if (player.isSB) badges.push({ text: "SB", color: "#0E8C8C" });
  if (player.isBB) badges.push({ text: "BB", color: "#F0453A" });
  badges.forEach((badge, bi) => {
    const bw = Math.max(24, scaledSize(badge.text.length > 1 ? 34 : 26, scale));
    const bh = Math.max(20, scaledSize(24, scale));
    const bx = left + w - scaledSize(14, scale) - (bi + 1) * (bw + scaledSize(6, scale));
    drawPill(ctx, bx, top - scaledSize(12, scale), bw, bh, badge.color);
    ctx.fillStyle = "#FFFDF5";
    ctx.font = `700 ${Math.max(10, scaledSize(12, scale))}px ${fonts.title.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge.text, bx + bw / 2, top - scaledSize(2, scale));
  });

  // Hand name at showdown. Hole cards stay on the owners' phones, so the TV
  // only publishes the made hand and the pot winners.
  if (showdown) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = isWinner ? colors.success : colors.cardMuted;
    ctx.fillText(showdown.handName, left + w - scaledSize(14, scale), top + h - scaledSize(24, scale));
  }

  ctx.restore();

  // Turn timer bar along the bottom edge.
  if (isTurn && state.timeLeft > 0) {
    const progress = clamp(state.timeLeft / ACTION_TIMEOUT_MS, 0, 1);
    const barH = Math.max(6, scaledSize(9, scale));
    drawRoundRect(ctx, left + scaledSize(8, scale), top + h - barH - scaledSize(3, scale), w - scaledSize(16, scale), barH, barH / 2, "rgba(29,27,38,0.18)");
    drawRoundRect(
      ctx,
      left + scaledSize(8, scale),
      top + h - barH - scaledSize(3, scale),
      Math.max(barH, (w - scaledSize(16, scale)) * progress),
      barH,
      barH / 2,
      progress > 0.3 ? seat.color : colors.danger,
    );
  }
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  card: CardDisplay,
  scale: number,
): void {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  const ink = red ? "#D6204E" : colors.cardText;

  ctx.save();
  ctx.shadowColor = "rgba(29,27,38,0.35)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = Math.max(3, scaledSize(5, scale));
  ctx.shadowOffsetY = Math.max(3, scaledSize(5, scale));
  drawRoundRect(
    ctx,
    x,
    y,
    w,
    h,
    Math.max(6, scaledSize(10, scale)),
    "#F5F3FF",
    colors.border,
    Math.max(2, scaledSize(2.5, scale)),
  );
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  const rankSize = Math.max(scaledSize(18, scale), h * 0.28);
  const suitSize = Math.max(scaledSize(18, scale), h * 0.30);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${rankSize}px ${fonts.title.family}`;
  ctx.fillText(card.rank, x + w / 2, y + h * 0.33);
  ctx.font = `700 ${suitSize}px ${fonts.display.family}`;
  ctx.fillText(suitGlyph(card.suit), x + w / 2, y + h * 0.68);

  // Tiny corner pip, like the phone's card but quieter.
  ctx.font = `700 ${Math.max(9, h * 0.10)}px ${fonts.display.family}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(suitGlyph(card.suit), x + w * 0.12, y + h * 0.06);
  ctx.restore();
}

/**
 * The phone's face-down card: tomato stock, cream diagonal stripes, "?".
 * Used for every undealt community slot so the board matches the controller.
 */
function drawCardBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(29,27,38,0.35)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = Math.max(3, scaledSize(5, scale));
  ctx.shadowOffsetY = Math.max(3, scaledSize(5, scale));
  drawRoundRect(
    ctx,
    x,
    y,
    w,
    h,
    Math.max(6, scaledSize(10, scale)),
    "#F0453A",
    colors.border,
    Math.max(2, scaledSize(2.5, scale)),
  );
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 3, y + 3, w - 6, h - 6);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,253,245,0.26)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  const step = Math.max(7, scaledSize(10, scale));
  for (let d = -h; d < w + h; d += step) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + h, y + h);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#FFFDF5";
  ctx.font = `700 ${Math.max(16, h * 0.28)}px ${fonts.display.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", x + w / 2, y + h / 2);
  ctx.restore();
}

function suitGlyph(suit: Suit): string {
  switch (suit) {
    case "hearts": return "♥";
    case "diamonds": return "♦";
    case "clubs": return "♣";
    case "spades": return "♠";
  }
}

