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
  currentBet: number;
  players: PlayerDisplay[];
  turnName: string | null;
  timeLeft: number;
  showdown: Array<{ name: string; cards: CardDisplay[]; handName: string }> | null;
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
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("POKER", margin, margin + scaledSize(26, scale));
  const wordW = ctx.measureText("POKER").width;

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  const meta = `Hand ${Math.max(1, state.handNumber)} of ${state.maxHands}  ·  ${phaseLabel(state.phase)}`;
  ctx.fillText(meta, margin + wordW + scaledSize(18, scale), margin + scaledSize(25, scale));

  // Turn / pot summary on the right.
  if (state.turnName) {
    ctx.textAlign = "right";
    ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.amber;
    ctx.fillText(`${state.turnName} to act`, width - margin, margin + scaledSize(24, scale));
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

function drawTable(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: PokerScreenState,
  scale: number,
): void {
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

  // Felt
  ctx.save();
  const felt = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(feltRX, feltRY));
  felt.addColorStop(0, "#2A1A5C");
  felt.addColorStop(0.72, "#18103C");
  felt.addColorStop(1, "#0E0A26");
  ctx.fillStyle = felt;
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRX, feltRY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,46,151,0.45)";
  ctx.lineWidth = Math.max(1, scaledSize(2, scale));
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,229,255,0.10)";
  ctx.lineWidth = Math.max(1, scaledSize(8, scale));
  ctx.beginPath();
  ctx.ellipse(cx, cy, feltRX - scaledSize(12, scale), feltRY - scaledSize(12, scale), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Community cards
  const cardW = scaledSize(96, scale);
  const cardH = scaledSize(132, scale);
  const cardGap = scaledSize(10, scale);
  const totalW = 5 * cardW + 4 * cardGap;
  const cardsX = cx - totalW / 2;
  const cardsY = cy - feltRY * 0.46;

  for (let i = 0; i < 5; i++) {
    const x = cardsX + i * (cardW + cardGap);
    if (i < state.community.length) {
      drawCard(ctx, x, cardsY, cardW, cardH, state.community[i], scale);
    } else {
      drawCardPlaceholder(ctx, x, cardsY, cardW, cardH, scale);
    }
  }

  // Pot
  const potText = state.pot > 0 ? String(state.pot) : "—";
  ctx.font = `700 ${scaledSize(26, scale)}px ${fonts.display.family}`;
  const potLabelW = ctx.measureText(potText).width + scaledSize(96, scale);
  const potW = Math.max(scaledSize(150, scale), potLabelW);
  const potY = cy + feltRY * 0.34;
  drawPill(
    ctx,
    cx - potW / 2,
    potY - scaledSize(22, scale),
    potW,
    scaledSize(44, scale),
    "rgba(11,8,32,0.72)",
    "rgba(255,179,71,0.5)",
    Math.max(1, scaledSize(2, scale)),
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.fillText("POT", cx - potW / 2 + scaledSize(18, scale), potY);
  ctx.textAlign = "right";
  ctx.font = `700 ${scaledSize(32, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.amber;
  ctx.fillText(potText, cx + potW / 2 - scaledSize(18, scale), potY + 1);

  // Current bet
  if (state.currentBet > 0 && state.phase !== "showdown" && state.phase !== "hand-end") {
    ctx.textAlign = "center";
    ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(`Current bet ${state.currentBet}`, cx, potY + scaledSize(38, scale));
  }

  // Results (fold win / split pot) below the pot.
  if (state.results && state.results.length > 0 && (state.phase === "hand-end" || state.phase === "showdown")) {
    const startY = potY + scaledSize(60, scale);
    ctx.textAlign = "center";
    state.results.slice(0, 2).forEach((line, i) => {
      ctx.font = `${i === 0 ? 700 : 500} ${scaledSize(i === 0 ? 20 : 15, scale)}px ${fonts.display.family}`;
      ctx.fillStyle = i === 0 ? colors.success : colors.textMuted;
      ctx.fillText(line, cx, startY + i * scaledSize(24, scale));
    });
  }

  // Seats
  const n = state.players.length;
  const seatRX = feltRX + scaledSize(78, scale);
  const seatRY = feltRY + scaledSize(64, scale);
  state.players.forEach((player, i) => {
    // Only use four anchor points for up to four players so panels never collide.
    const anchor = n <= 1 ? 0 : Math.round((i * 4) / n) % 4;
    const pos = seatAnchor(anchor, cx, cy, seatRX, seatRY);
    drawSeat(ctx, pos.x, pos.y, player, state, scale);
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
  state: PokerScreenState,
  scale: number,
): void {
  const w = scaledSize(280, scale);
  const h = scaledSize(116, scale);
  const left = x - w / 2;
  const top = y - h / 2;
  const color = colors.player[state.players.indexOf(player) % colors.player.length];
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
    "rgba(18,13,46,0.92)",
    isTurn ? color : isWinner ? colors.success : "rgba(255,255,255,0.10)",
    isTurn || isWinner ? Math.max(1, scaledSize(2, scale)) : 1,
  );

  // Turn glow
  if (isTurn) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    drawRoundRect(ctx, left, top, w, h, scaledSize(16, scale));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Name
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(24, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = player.folded || player.out ? colors.textMuted : colors.text;
  ctx.fillText(player.name, left + scaledSize(14, scale), top + scaledSize(26, scale));

  // Chips
  ctx.font = `700 ${scaledSize(30, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.amber;
  ctx.fillText(String(player.chips), left + scaledSize(14, scale), top + h - scaledSize(22, scale));

  // Bet / last action (hidden at showdown, where the cards take this space).
  if (!showdown && player.bet > 0) {
    ctx.textAlign = "right";
    ctx.font = `600 ${scaledSize(20, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.cyan;
    ctx.fillText(`bet ${player.bet}`, left + w - scaledSize(14, scale), top + h - scaledSize(22, scale));
  } else if (!showdown && player.lastAction) {
    ctx.textAlign = "right";
    ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(player.lastAction, left + w - scaledSize(14, scale), top + h - scaledSize(22, scale));
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
  if (player.isDealer) badges.push({ text: "D", color: colors.amber });
  if (player.isSB) badges.push({ text: "SB", color: colors.cyan });
  if (player.isBB) badges.push({ text: "BB", color: colors.magenta });
  badges.forEach((badge, bi) => {
    const bw = scaledSize(badge.text.length > 1 ? 30 : 22, scale);
    const bh = scaledSize(20, scale);
    const bx = left + w - scaledSize(14, scale) - (bi + 1) * (bw + scaledSize(6, scale));
    drawPill(ctx, bx, top - scaledSize(12, scale), bw, bh, badge.color);
    ctx.fillStyle = colors.bg0;
    ctx.font = `700 ${scaledSize(10, scale)}px ${fonts.title.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge.text, bx + bw / 2, top - scaledSize(2, scale));
  });

  // Showdown: revealed hole cards + hand name, on the right of the panel.
  if (showdown) {
    const cw = scaledSize(38, scale);
    const ch = scaledSize(54, scale);
    const cGap = scaledSize(5, scale);
    const cardsX = left + w - scaledSize(14, scale) - (2 * cw + cGap);
    const cardsY = top + scaledSize(20, scale);
    showdown.cards.slice(0, 2).forEach((card, ci) => {
      drawCard(ctx, cardsX + ci * (cw + cGap), cardsY, cw, ch, card, scale, true);
    });
    ctx.textAlign = "right";
    ctx.font = `600 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = isWinner ? colors.success : colors.textMuted;
    ctx.fillText(showdown.handName, left + w - scaledSize(14, scale), cardsY + ch + scaledSize(12, scale));
  }

  ctx.restore();

  // Turn timer bar along the bottom edge.
  if (isTurn && state.timeLeft > 0) {
    const progress = clamp(state.timeLeft / ACTION_TIMEOUT_MS, 0, 1);
    const barH = scaledSize(5, scale);
    drawRoundRect(ctx, left + scaledSize(8, scale), top + h - barH - scaledSize(3, scale), w - scaledSize(16, scale), barH, barH / 2, "rgba(255,255,255,0.10)");
    drawRoundRect(
      ctx,
      left + scaledSize(8, scale),
      top + h - barH - scaledSize(3, scale),
      Math.max(barH, (w - scaledSize(16, scale)) * progress),
      barH,
      barH / 2,
      progress > 0.3 ? color : colors.danger,
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
  mini = false,
): void {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  const ink = red ? "#D6204E" : "#1B1545";

  ctx.save();
  drawRoundRect(ctx, x, y, w, h, scaledSize(8, scale), "#F5F3FF", "rgba(255,255,255,0.35)", 1);

  const suit = suitGlyph(card.suit);
  const rankSize = Math.max(scaledSize(mini ? 12 : 22, scale), w * (mini ? 0.34 : 0.24));
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${rankSize}px ${fonts.display.family}`;
  ctx.fillText(card.rank, x + w * 0.1, y + h * 0.06);

  const suitSize = Math.max(scaledSize(mini ? 12 : 26, scale), w * (mini ? 0.34 : 0.28));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${suitSize}px ${fonts.display.family}`;
  ctx.fillText(suit, x + w / 2, y + h * (mini ? 0.66 : 0.62));

  if (!mini) {
    // Mirrored corner mark, classic playing-card detail.
    ctx.save();
    ctx.translate(x + w * 0.9, y + h * 0.94);
    ctx.rotate(Math.PI);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `700 ${rankSize}px ${fonts.display.family}`;
    ctx.fillText(card.rank, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawCardPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.save();
  ctx.setLineDash([scaledSize(8, scale), scaledSize(8, scale)]);
  drawRoundRect(ctx, x, y, w, h, scaledSize(8, scale), "rgba(255,255,255,0.03)", "rgba(255,255,255,0.12)", 1);
  ctx.setLineDash([]);
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

