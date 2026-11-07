/**
 * Guess the Imposter — TV renderer (brief section 5).
 *
 * Everything secret stays on the phones: this renderer only draws the words,
 * roles and ballots the server has already decided are public. `finalReveal`
 * is the single exception and the server only sends it from the reveal phase.
 *
 * Layout note: the generic watch overlay owns the top-centre waiting banner and
 * the bottom-right score ticker, so the order rail lives on the left and the
 * phase content stops above the ticker. Names are ellipsised and every type
 * size comes from `scaledSize`, so 720p and 1080p both stay readable.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard,
  emitConfetti, emitScoreBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, clamp, easeOutCubic,
} from "../../client/screen/kit/index.ts";
import { paperTitle, paperMeta } from "../../client/screen/kit/header.ts";
import { seatForIndex } from "../../shared/seat-identity.ts";

// --- Payload (mirrors games/guessimposter/server.ts `screenState`) ---------

type Phase =
  | "countdown"
  | "peek"
  | "clue"
  | "discussion"
  | "vote"
  | "voteReveal"
  | "finalGuess"
  | "reveal"
  | "finished";

interface SeatRef {
  seat: number;
  id: string;
  name: string;
}

interface OrderRow extends SeatRef {
  done: boolean;
  active: boolean;
}

interface ClueRow extends SeatRef {
  clueRound: number;
  cycle: number;
  text: string;
}

interface VoteRevealState {
  attempt: number;
  revote: boolean;
  secondTie: boolean;
  nobodyOut: boolean;
  tiedSeats: SeatRef[];
  tally: Array<SeatRef & { votes: number }>;
  ballots: Array<{
    seat: number;
    id: string;
    name: string;
    target: SeatRef | null;
    skipped: boolean;
  }>;
  ejected: (SeatRef & { side: string | null }) | null;
}

interface FinalGuessReveal extends SeatRef {
  correct: boolean;
  choice: string | null;
  options: string[];
}

interface FinalReveal {
  round: number;
  word: string;
  category: string;
  lookalike: string;
  winner: "crew" | "imposters";
  reason: "caught" | "finalGuess" | "numbers" | "cap" | "disconnect";
  imposters: SeatRef[];
  larper: (SeatRef & { word: string }) | null;
  ejected: Array<SeatRef & { side: string | null }>;
  guesses: FinalGuessReveal[];
}

export interface ImposterScreenState {
  phase: Phase;
  round: number;
  maxRounds: number;
  playerCount: number;
  settings?: {
    clueMode?: "spoken" | "typed";
    clueRounds?: number;
    turnTimerMs?: number;
    discussionMs?: number;
    allowSkipVotes?: boolean;
    spokenAnnouncements?: boolean;
  };
  countdownMs?: number | null;
  announcement?: string | null;
  announce?: string | null;
  clueRound?: number | null;
  clueRounds?: number;
  order?: OrderRow[];
  activePlayer?: SeatRef | null;
  clues?: ClueRow[];
  timerMs?: number | null;
  timerTotalMs?: number | null;
  timerOff?: boolean;
  waitingOn?: string[];
  vote?: {
    revote?: boolean;
    tied?: SeatRef[];
    cast?: number;
    total?: number;
  } | null;
  voteReveal?: VoteRevealState | null;
  finalGuess?: SeatRef | null;
  ejected?: Array<SeatRef & { side: string | null }>;
  finalReveal?: FinalReveal | null;
  players?: Array<{ id: string; name: string; seat: number; score: number }>;
  scores?: Array<{ id: string; name: string; score: number }>;
  finished: boolean;
  winner?: string | null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImposterRenderState {
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastRound: number;
}

function createImposterRenderState(): ImposterRenderState {
  return {
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastRound: 0,
  };
}

// A page can swap games without reloading, so the state lives on globalThis.
const renderState: ImposterRenderState =
  (globalThis as any)._imposterRenderState ||= createImposterRenderState();

// --- Entry point -----------------------------------------------------------

/** This renderer draws its own score rail; the platform ticker stays off. */
export const showsScores = true;

export function renderGuessimposter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: ImposterScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.phase !== rs.lastPhase || state.round !== rs.lastRound) {
      handlePhaseChange(state, rs, now, width, height, scale);
      rs.lastPhase = state.phase;
      rs.lastRound = state.round;
    }
    if (!state.finished && rs.victoryScreen) rs.victoryScreen = null;
    if (rs.victoryScreen) updateVictoryScreen(rs.victoryScreen, now, dt);

    if (state.finished && rs.victoryScreen) {
      drawVictoryScreen(ctx, width, height, rs.victoryScreen);
      return;
    }

    drawFrame(ctx, width, height, state, scale, now);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: ImposterScreenState,
  rs: ImposterRenderState,
  now: number,
  width: number,
  height: number,
  scale: number,
): void {
  if (state.phase === "voteReveal") {
    triggerShake(rs.shake, 0.12, now);
  }
  if (state.phase === "finalGuess") {
    triggerShake(rs.shake, 0.18, now);
    emitScoreBurst(width * 0.55, height * 0.4, 1, scale);
  }
  if (state.phase === "reveal") {
    triggerShake(rs.shake, 0.36, now);
    emitConfetti(
      width / 2,
      height * 0.32,
      width,
      [colors.magenta, colors.cyan, colors.amber, colors.success, colors.violet],
      scale,
    );
  }
  if (state.finished && state.winner) {
    const entries = buildRankedEntries(
      (state.scores ?? state.players ?? []).map((row) => ({ name: row.name, score: row.score })),
      state.winner,
    );
    const winner = entries.find((entry) => entry.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Guess the Imposter",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

// --- Layout ----------------------------------------------------------------

interface Frame {
  margin: number;
  gap: number;
  headerH: number;
  rail: Rect;
  main: Rect;
}

function layoutFor(width: number, height: number, scale: number, playerCount: number): Frame {
  const margin = scaledSize(40, scale);
  const gap = scaledSize(24, scale);
  const headerH = scaledSize(62, scale);
  const railW = Math.min(width * 0.25, scaledSize(300, scale));
  // The watch overlay draws the score ticker in the bottom-right corner; stop
  // the phase content above it instead of letting it cover a name or a word.
  const tickerH = playerCount * Math.max(26, scaledSize(34, scale)) + scaledSize(40, scale);
  const top = margin + headerH;
  const bottom = Math.max(top + scaledSize(120, scale), height - margin - tickerH);
  return {
    margin,
    gap,
    headerH,
    rail: { x: margin, y: top, width: railW, height: Math.max(1, height - margin * 2 - headerH) },
    main: {
      x: margin + railW + gap,
      y: top,
      width: Math.max(1, width - margin * 2 - railW - gap),
      height: Math.max(1, bottom - top),
    },
  };
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  const frame = layoutFor(width, height, scale, state.playerCount);
  drawHeader(ctx, width, frame, state, scale);
  drawRail(ctx, frame.rail, state, scale, now);
  drawPhase(ctx, frame.main, state, scale, now);
}

// --- Header ----------------------------------------------------------------

function phaseLabel(state: ImposterScreenState): string {
  switch (state.phase) {
    case "countdown":
      return "GET READY";
    case "peek":
      return "PRIVATE";
    case "clue":
      return `CLUE ${state.clueRound ?? 1}/${state.clueRounds ?? 1}`;
    case "discussion":
      return "DISCUSS";
    case "vote":
      return state.vote?.revote ? "REVOTE" : "VOTE";
    case "voteReveal":
      return "THE VERDICT";
    case "finalGuess":
      return "FINAL GUESS";
    case "reveal":
      return "REVEAL";
    default:
      return "FINAL";
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  frame: Frame,
  state: ImposterScreenState,
  scale: number,
): void {
  const { margin } = frame;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  paperTitle(ctx, scale);
  ctx.fillText("GUESS THE IMPOSTER", margin, margin + scaledSize(24, scale));

  paperMeta(ctx, scale, 16);
  ctx.fillText(
    `Word ${state.round} of ${state.maxRounds}`,
    margin,
    margin + scaledSize(48, scale),
  );

  // Phase pill, right-aligned.
  const label = phaseLabel(state);
  const fontSize = smallSize(15, scale);
  ctx.font = `700 ${fontSize}px ${fonts.display.family}`;
  const padX = scaledSize(18, scale);
  const pillH = scaledSize(34, scale);
  const pillW = ctx.measureText(label).width + padX * 2;
  const pillX = width - margin - pillW;
  const pillY = margin + scaledSize(6, scale);
  drawRoundRect(
    ctx,
    pillX,
    pillY,
    pillW,
    pillH,
    pillH / 2,
    "#FFFDF5",
    "#1D1B26",
    1,
  );
  ctx.fillStyle = state.phase === "finalGuess" ? colors.danger : colors.cyan;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, pillX + pillW / 2, pillY + pillH / 2 + 1);
}

// --- Order / roster rail ---------------------------------------------------

type RailMode = "order" | "alive" | "roster";

interface RailRow {
  seat: number;
  name: string;
  status: "idle" | "done" | "active" | "out" | "guessing";
}

function railMode(state: ImposterScreenState): RailMode {
  if (state.phase === "clue" && (state.order?.length ?? 0) > 0) return "order";
  if (state.phase === "discussion" || state.phase === "vote") return "alive";
  return "roster";
}

function railRows(state: ImposterScreenState): RailRow[] {
  const mode = railMode(state);
  if (mode === "order") {
    return (state.order ?? []).map((row) => ({
      seat: row.seat,
      name: row.name,
      status: row.active ? "active" : row.done ? "done" : "idle",
    }));
  }

  const ejected = new Set((state.ejected ?? []).map((row) => row.seat));
  // A ballot that is still being revealed has not been announced yet, so the
  // rail must not spoil the ejection before the banner does.
  const spoilOut = state.phase !== "voteReveal";
  const guessingSeat = state.phase === "finalGuess" ? state.finalGuess?.seat ?? null : null;
  const rows = (state.players ?? []).map((player) => ({
    seat: player.seat,
    name: player.name,
    status: "idle" as RailRow["status"],
  }));

  return rows
    .filter((row) => mode !== "alive" || !ejected.has(row.seat))
    .map((row) => {
      if (guessingSeat === row.seat) return { ...row, status: "guessing" as const };
      if (spoilOut && ejected.has(row.seat)) return { ...row, status: "out" as const };
      return row;
    });
}

function railTitle(mode: RailMode): string {
  if (mode === "order") return "TURN ORDER";
  if (mode === "alive") return "STILL IN";
  return "AT THE TABLE";
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  const mode = railMode(state);
  const rows = railRows(state);
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.9)", stroke: colors.border });

  const pad = scaledSize(16, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${smallSize(12, scale, 10)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(railTitle(mode), rect.x + pad, rect.y + pad + scaledSize(10, scale));

  if (rows.length === 0) {
    ctx.font = `500 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillText("Waiting…", rect.x + pad, rect.y + pad + scaledSize(40, scale));
    return;
  }

  const listTop = rect.y + pad + scaledSize(24, scale);
  const available = rect.y + rect.height - pad - listTop;
  const rowH = Math.min(scaledSize(52, scale), available / rows.length);
  const badge = Math.max(scaledSize(18, scale), Math.min(rowH * 0.68, scaledSize(40, scale)));
  const nameSize = Math.max(13, Math.min(scaledSize(19, scale), rowH * 0.42));

  rows.forEach((row, index) => {
    const y = listTop + index * rowH;
    const dim = row.status === "out";
    const active = row.status === "active" || row.status === "guessing";

    if (active) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.globalAlpha = 0.22 + 0.2 * pulse;
      drawRoundRect(
        ctx,
        rect.x + scaledSize(8, scale),
        y,
        rect.width - scaledSize(16, scale),
        rowH - scaledSize(3, scale),
        scaledSize(10, scale),
        colors.cyan,
      );
      ctx.globalAlpha = 1;
    }

    drawSeatBadge(ctx, rect.x + pad, y + (rowH - badge) / 2, badge, row.seat);
    ctx.globalAlpha = dim ? 0.45 : 1;

    const statusText = row.status === "done"
      ? "✓"
      : row.status === "active"
        ? "UP"
        : row.status === "guessing"
          ? "GUESS"
          : row.status === "out"
            ? "OUT"
            : "";
    ctx.font = `700 ${Math.max(scaledSize(10, scale), nameSize * 0.72)}px ${fonts.display.family}`;
    const statusW = statusText ? ctx.measureText(statusText).width + scaledSize(6, scale) : 0;

    ctx.font = `600 ${nameSize}px ${fonts.display.family}`;
    ctx.fillStyle = dim ? colors.textMuted : row.status === "active" ? colors.cyan : colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const nameX = rect.x + pad + badge + scaledSize(10, scale);
    const nameMax = rect.x + rect.width - pad - statusW - nameX;
    ctx.fillText(ellipsize(ctx, row.name, Math.max(scaledSize(20, scale), nameMax)), nameX, y + rowH / 2);

    if (statusText) {
      ctx.textAlign = "right";
      ctx.font = `700 ${Math.max(scaledSize(10, scale), nameSize * 0.72)}px ${fonts.display.family}`;
      ctx.fillStyle = row.status === "out"
        ? colors.danger
        : row.status === "done"
          ? colors.success
          : colors.cyan;
      ctx.fillText(statusText, rect.x + rect.width - pad, y + rowH / 2);
    }
    ctx.globalAlpha = 1;
  });
}

// --- Phase body ------------------------------------------------------------

function drawPhase(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  switch (state.phase) {
    case "countdown":
      drawCountdown(ctx, rect, state, scale);
      return;
    case "peek":
      drawPeek(ctx, rect, state, scale, now);
      return;
    case "clue":
      drawClueTurn(ctx, rect, state, scale);
      return;
    case "discussion":
      drawDiscussion(ctx, rect, state, scale, now);
      return;
    case "vote":
      drawVote(ctx, rect, state, scale, now);
      return;
    case "voteReveal":
      drawVoteReveal(ctx, rect, state, scale);
      return;
    case "finalGuess":
      drawFinalGuess(ctx, rect, state, scale, now);
      return;
    case "reveal":
      drawReveal(ctx, rect, state, scale, now);
      return;
    default:
      drawAtTheTable(ctx, rect, state, scale);
  }
}

// --- Countdown -------------------------------------------------------------

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border, glow: colors.magenta });

  const remaining = Math.max(0, state.countdownMs ?? 0);
  const total = 3000;
  const step = Math.max(1, Math.ceil(remaining / 1000));
  // Resets every second, so the digit pops as it changes.
  const intoStep = 1 - ((remaining % 1000) / 1000);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fitFontSize(ctx, "Look at your phones", rect.width * 0.86, scaledSize(52, scale), scaledSize(24, scale), fonts.display.family)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("Look at your phones", rect.x + rect.width / 2, rect.y + rect.height * 0.24);

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height * 0.58;
  const radius = Math.min(rect.width, rect.height) * 0.17;
  drawTimerRing(ctx, cx, cy, radius, remaining / total, scale, colors.magenta, "");

  const pop = 0.72 + 0.34 * easeOutCubic(clamp(intoStep, 0, 1));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.font = `700 ${Math.round(radius * 0.8)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.fillText(String(step), 0, 0);
  ctx.restore();

  ctx.font = `500 ${smallSize(16, scale, 12)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    "Your card is private. Hold the button on your phone to peek.",
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.84,
  );

  if (state.announcement) {
    ctx.font = `700 ${smallSize(17, scale, 12)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.amber;
    ctx.fillText(ellipsize(ctx, state.announcement, rect.width * 0.9), rect.x + rect.width / 2, rect.y + rect.height * 0.93);
  }
}

// --- Peek ------------------------------------------------------------------

function drawPeek(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fitFontSize(ctx, "CARDS ARE OUT", rect.width * 0.8, scaledSize(56, scale), scaledSize(26, scale), fonts.display.family)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("CARDS ARE OUT", rect.x + rect.width / 2, rect.y + rect.height * 0.3);

  ctx.font = `500 ${smallSize(19, scale, 13)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    "Eyes on your own phone. Nothing private is on this screen.",
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.43,
  );

  const total = state.timerTotalMs && state.timerTotalMs > 0 ? state.timerTotalMs : 5000;
  const remaining = Math.max(0, state.timerMs ?? total);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height * 0.66;
  const radius = Math.min(rect.height * 0.16, rect.width * 0.1);
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
  drawTimerRing(ctx, cx, cy, radius, remaining / total, scale, colors.cyan, clockLabel(remaining));
  ctx.globalAlpha = 0.5 + 0.3 * pulse;
  ctx.font = `500 ${smallSize(14, scale, 11)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("Cards auto-hide", cx, cy + radius + scaledSize(24, scale));
  ctx.globalAlpha = 1;
}

// --- Clue turn -------------------------------------------------------------

function drawClueTurn(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
): void {
  const gap = scaledSize(16, scale);
  const turnH = rect.height * 0.6;
  const turnRect = { ...rect, height: turnH };
  const feedRect = { x: rect.x, y: rect.y + turnH + gap, width: rect.width, height: rect.height - turnH - gap };

  drawBentoCard(ctx, turnRect, { fill: "rgba(23,18,56,0.97)", stroke: colors.cyan, glow: colors.cyan });

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${smallSize(13, scale, 10)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("WHOSE TURN", turnRect.x + scaledSize(22, scale), turnRect.y + scaledSize(26, scale));

  const active = state.activePlayer;
  const pad = scaledSize(22, scale);
  if (!active) {
    ctx.font = `600 ${scaledSize(28, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.textBaseline = "middle";
    ctx.fillText("Next clue…", turnRect.x + pad, turnRect.y + turnRect.height * 0.55);
    return;
  }

  const ringRadius = Math.min(turnRect.height * 0.3, turnRect.width * 0.11);
  const hasRing = !state.timerOff && state.timerMs !== null && state.timerMs !== undefined;
  const ringX = turnRect.x + turnRect.width - pad - ringRadius;
  const ringY = turnRect.y + turnRect.height * 0.56;
  const nameMax = hasRing ? ringX - ringRadius - pad - scaledSize(16, scale) - (turnRect.x + pad) : turnRect.width - pad * 2;

  const badge = Math.min(turnRect.height * 0.4, scaledSize(64, scale));
  drawSeatBadge(ctx, turnRect.x + pad, turnRect.y + turnRect.height * 0.46 - badge / 2, badge, active.seat);

  const nameSize = fitFontSize(
    ctx,
    active.name,
    Math.max(scaledSize(40, scale), nameMax - badge - scaledSize(14, scale)),
    scaledSize(46, scale),
    scaledSize(20, scale),
    fonts.display.family,
  );
  ctx.font = `700 ${nameSize}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    ellipsize(ctx, active.name, Math.max(scaledSize(40, scale), nameMax - badge - scaledSize(14, scale))),
    turnRect.x + pad + badge + scaledSize(14, scale),
    turnRect.y + turnRect.height * 0.46,
  );

  const instruction = state.settings?.clueMode === "typed"
    ? "Typing one clue word on their phone…"
    : "Say one clue out loud, then tap DONE.";
  ctx.font = `500 ${smallSize(16, scale, 12)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    ellipsize(ctx, instruction, turnRect.width - pad * 2),
    turnRect.x + pad,
    turnRect.y + turnRect.height * 0.82,
  );

  if (hasRing) {
    const total = state.timerTotalMs && state.timerTotalMs > 0 ? state.timerTotalMs : 1;
    drawTimerRing(
      ctx,
      ringX,
      ringY,
      ringRadius,
      (state.timerMs ?? 0) / total,
      scale,
      colors.cyan,
      clockLabel(state.timerMs ?? 0),
    );
  } else {
    ctx.font = `600 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "right";
    ctx.fillText("No timer", turnRect.x + turnRect.width - pad, turnRect.y + turnRect.height * 0.56);
  }

  drawClueFeed(ctx, feedRect, state, scale);
}

function currentClues(state: ImposterScreenState): ClueRow[] {
  const clues = state.clues ?? [];
  if (clues.length === 0) return [];
  const maxCycle = Math.max(...clues.map((clue) => clue.cycle));
  const cycle = clues.filter((clue) => clue.cycle === maxCycle);
  const maxRound = Math.max(...cycle.map((clue) => clue.clueRound));
  return cycle.filter((clue) => clue.clueRound === maxRound);
}

/** The newest submitted clue only; earlier ones stay off the TV. */
function drawClueFeed(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.9)", stroke: colors.border });
  const pad = scaledSize(18, scale);
  const clues = currentClues(state);
  const latest = clues.length > 0 ? clues[clues.length - 1] : null;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${smallSize(11, scale, 10)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(latest ? "LATEST CLUE" : "CLUES", rect.x + pad, rect.y + pad + scaledSize(8, scale));

  if (!latest) {
    ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textBaseline = "middle";
    ctx.fillText(
      state.phase === "clue" ? "The first clue is coming…" : "No clues this round.",
      rect.x + pad,
      rect.y + rect.height * 0.58,
    );
    return;
  }

  // The author sits on the label line, so the clue itself owns the middle.
  const labelY = rect.y + pad + scaledSize(8, scale);
  const badge = Math.max(scaledSize(14, scale), Math.min(rect.height * 0.18, scaledSize(22, scale)));
  const author = ellipsize(ctx, latest.name, rect.width * 0.32);
  ctx.font = `600 ${smallSize(12, scale, 10)}px ${fonts.body.family}`;
  const authorW = ctx.measureText(author).width;
  const authorX = rect.x + rect.width - pad - authorW;
  drawSeatBadge(ctx, authorX - badge - scaledSize(6, scale), labelY - badge * 0.8, badge, latest.seat);
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(author, authorX, labelY);

  const quote = `“${latest.text}”`;
  const maxW = rect.width - pad * 2;
  const size = fitFontSize(ctx, quote, maxW, scaledSize(36, scale), scaledSize(18, scale), fonts.display.family);
  ctx.font = `700 ${size}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, quote, maxW), rect.x + rect.width / 2, rect.y + rect.height * 0.5);

  if (clues.length > 1) {
    ctx.font = `500 ${smallSize(11, scale, 10)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${clues.length} this round`, rect.x + rect.width - pad, rect.y + rect.height - pad);
  }
}

// --- Discussion ------------------------------------------------------------

function drawDiscussion(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  const gap = scaledSize(18, scale);
  const timerW = rect.width * 0.36;
  const timerRect = { x: rect.x, y: rect.y, width: timerW, height: rect.height };
  const cluesRect = {
    x: rect.x + timerW + gap,
    y: rect.y,
    width: rect.width - timerW - gap,
    height: rect.height,
  };

  drawBentoCard(ctx, timerRect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border, glow: colors.magenta });
  const total = state.timerTotalMs && state.timerTotalMs > 0
    ? state.timerTotalMs
    : state.settings?.discussionMs ?? 90000;
  const remaining = Math.max(0, state.timerMs ?? total);
  const cx = timerRect.x + timerRect.width / 2;
  const cy = timerRect.y + timerRect.height * 0.46;
  const radius = Math.min(timerRect.width * 0.3, timerRect.height * 0.24);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${smallSize(13, scale, 11)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("DISCUSS", cx, timerRect.y + timerRect.height * 0.11);

  drawTimerRing(ctx, cx, cy, radius, remaining / total, scale, colors.magenta, clockLabel(remaining));

  const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
  ctx.font = `500 ${smallSize(15, scale, 12)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.globalAlpha = 0.6 + 0.4 * pulse;
  ctx.fillText("Who is bluffing?", cx, timerRect.y + timerRect.height * 0.78);
  ctx.globalAlpha = 1;

  drawDiscussionClues(ctx, cluesRect, state, scale);
}

/** The last clue round, as a readable list. Two columns above four clues. */
function drawDiscussionClues(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.9)", stroke: colors.border });
  const pad = scaledSize(16, scale);
  const clues = currentClues(state);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${smallSize(11, scale, 10)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("THE CLUES", rect.x + pad, rect.y + pad + scaledSize(8, scale));

  if (clues.length === 0) {
    ctx.font = `500 ${scaledSize(15, scale)}px ${fonts.body.family}`;
    ctx.textBaseline = "middle";
    ctx.fillText("No clues this round.", rect.x + pad, rect.y + rect.height * 0.55);
    return;
  }

  const columns = clues.length > 4 ? 2 : 1;
  const rows = Math.ceil(clues.length / columns);
  const top = rect.y + pad + scaledSize(24, scale);
  const innerW = rect.width - pad * 2;
  const gap = scaledSize(8, scale);
  const cellW = (innerW - gap * (columns - 1)) / columns;
  const cellH = (rect.y + rect.height - pad - top - gap * (rows - 1)) / rows;
  const nameSize = Math.max(12, Math.min(scaledSize(15, scale), cellH * 0.34));
  const badge = Math.max(scaledSize(16, scale), Math.min(cellH * 0.56, scaledSize(28, scale)));

  clues.forEach((clue, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = rect.x + pad + column * (cellW + gap);
    const y = top + row * (cellH + gap);
    drawSeatBadge(ctx, x, y + cellH * 0.58 - badge / 2, badge, clue.seat);

    const textX = x + badge + scaledSize(8, scale);
    const textW = cellW - badge - scaledSize(12, scale);
    ctx.font = `600 ${nameSize}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(ellipsize(ctx, clue.name, textW * 0.45), textX, y + cellH * 0.22);

    const clueSize = Math.max(14, Math.min(scaledSize(21, scale), cellH * 0.44));
    ctx.font = `700 ${clueSize}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(ellipsize(ctx, clue.text, textW), textX, y + cellH * 0.58);
  });
}

// --- Vote ------------------------------------------------------------------

function drawVote(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(18,13,46,0.94)", stroke: colors.border, glow: colors.magenta });
  const cast = Math.max(0, Math.floor(state.vote?.cast ?? 0));
  const total = Math.max(1, Math.floor(state.vote?.total ?? state.playerCount));
  const done = cast >= total;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${smallSize(13, scale, 11)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(state.vote?.revote ? "REVOTE" : "THE BALLOT", rect.x + rect.width / 2, rect.y + rect.height * 0.16);

  ctx.font = `700 ${scaledSize(64, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = done ? colors.success : colors.text;
  ctx.fillText(`${cast}/${total}`, rect.x + rect.width / 2, rect.y + rect.height * 0.4);

  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(done ? "Votes are in" : "Votes coming in…", rect.x + rect.width / 2, rect.y + rect.height * 0.53);

  // One pip per eligible voter: a progress count, never who voted for whom.
  const pipR = scaledSize(9, scale);
  const spacing = pipR * 2.8;
  const startX = rect.x + rect.width / 2 - ((total - 1) * spacing) / 2;
  const pipY = rect.y + rect.height * 0.66;
  for (let index = 0; index < total; index += 1) {
    const filled = index < cast;
    ctx.beginPath();
    ctx.arc(startX + index * spacing, pipY, pipR, 0, Math.PI * 2);
    ctx.fillStyle = filled ? colors.magenta : "rgba(255,255,255,0.14)";
    ctx.fill();
  }

  const tied = state.vote?.tied ?? [];
  if (tied.length > 0) {
    ctx.font = `600 ${smallSize(14, scale, 12)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.amber;
    ctx.fillText(
      `Revote between ${tied.map((row) => row.name).join(" and ")}`,
      rect.x + rect.width / 2,
      rect.y + rect.height * 0.8,
    );
  } else {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
    ctx.globalAlpha = done ? 1 : 0.55 + 0.35 * pulse;
    ctx.font = `500 ${smallSize(15, scale, 12)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(
      "Vote on your phone — counts stay hidden until the reveal.",
      rect.x + rect.width / 2,
      rect.y + rect.height * 0.82,
    );
    ctx.globalAlpha = 1;
  }
}

// --- Vote reveal -----------------------------------------------------------

const VOTE_REVEAL_ANIM_MS = 1000;
const BALLOT_STEP_MS = 420;

function drawVoteReveal(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
): void {
  const reveal = state.voteReveal;
  const total = state.timerTotalMs && state.timerTotalMs > 0 ? state.timerTotalMs : 6000;
  const remaining = state.timerMs ?? 0;
  const elapsed = clamp(total - remaining, 0, total);

  drawBentoCard(ctx, rect, {
    fill: "rgba(18,13,46,0.95)",
    stroke: reveal?.ejected ? colors.danger : colors.border,
    glow: reveal?.ejected ? colors.danger : colors.magenta,
  });

  const pad = scaledSize(18, scale);
  const bannerH = rect.height * 0.2;
  const bannerRect = { x: rect.x + pad, y: rect.y + pad, width: rect.width - pad * 2, height: bannerH };
  drawVerdictBanner(ctx, bannerRect, state, scale, elapsed);

  const ballots = (reveal?.ballots ?? []).filter(
    (ballot) => ballot.target !== null || ballot.skipped,
  );
  const listTop = rect.y + pad + bannerH + scaledSize(12, scale);
  const listH = rect.y + rect.height - pad - listTop;

  if (ballots.length === 0) {
    ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No ballots were cast.", rect.x + rect.width / 2, listTop + listH / 2);
    return;
  }

  // One ballot appears every 520 ms after a short "votes are in" beat.
  const shown = clamp(Math.floor((elapsed - VOTE_REVEAL_ANIM_MS) / BALLOT_STEP_MS) + 1, 0, ballots.length);
  // Six ballots read as one column; a full eight-seat table splits in two.
  const columns = ballots.length > 6 ? 2 : 1;
  const rows = Math.ceil(ballots.length / columns);
  const gap = scaledSize(8, scale);
  const cellW = (rect.width - pad * 2 - gap * (columns - 1)) / columns;
  const cellH = (listH - gap * (rows - 1)) / rows;

  for (let index = 0; index < shown; index += 1) {
    const ballot = ballots[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = rect.x + pad + column * (cellW + gap);
    const y = listTop + row * (cellH + gap);
    // The newest ballot slides in over 180 ms; older rows are fully opaque.
    const rowAge = clamp(
      (elapsed - (VOTE_REVEAL_ANIM_MS + index * BALLOT_STEP_MS)) / 180,
      0,
      1,
    );
    drawBallotRow(ctx, x, y, cellW, cellH, ballot, scale, 0.35 + 0.65 * rowAge);
  }
}

function drawVerdictBanner(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  elapsed: number,
): void {
  const reveal = state.voteReveal;
  const ballots = (reveal?.ballots ?? []).filter((ballot) => ballot.target !== null || ballot.skipped);
  const announceAt = VOTE_REVEAL_ANIM_MS + ballots.length * BALLOT_STEP_MS;
  const announced = reveal !== null && reveal !== undefined && elapsed >= announceAt;

  if (!announced) {
    // "Votes are in": a bar that fills before the first ballot is read out.
    const progress = clamp(elapsed / VOTE_REVEAL_ANIM_MS, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fitFontSize(ctx, "VOTES ARE IN", rect.width * 0.8, scaledSize(34, scale), scaledSize(20, scale), fonts.display.family)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText("VOTES ARE IN", rect.x + rect.width / 2, rect.y + rect.height * 0.36);

    const barW = rect.width * 0.76;
    const barX = rect.x + (rect.width - barW) / 2;
    const barY = rect.y + rect.height * 0.68;
    const barH = scaledSize(8, scale);
    drawRoundRect(ctx, barX, barY, barW, barH, barH / 2, "rgba(255,255,255,0.1)");
    drawRoundRect(
      ctx,
      barX,
      barY,
      Math.max(barH, barW * progress),
      barH,
      barH / 2,
      progress > 0.6 ? colors.success : colors.magenta,
    );
    return;
  }

  if (!reveal) return;

  if (reveal.ejected) {
    const ejected = reveal.ejected;
    const side = ejected.side;
    const label = side === "crew"
      ? "CREW MEMBER"
      : side === "larper"
        ? "THE LARPER"
        : side === "imposter"
          ? "THE IMPOSTER"
          : "ROLE STILL SECRET";
    const badge = Math.min(rect.height * 0.72, scaledSize(42, scale));
    drawSeatBadge(ctx, rect.x, rect.y + (rect.height - badge) / 2, badge, ejected.seat);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fitFontSize(ctx, `${ejected.name} is out`, rect.width - badge - scaledSize(16, scale), scaledSize(30, scale), scaledSize(18, scale), fonts.display.family)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText(
      ellipsize(ctx, `${ejected.name} is out`, rect.width - badge - scaledSize(16, scale)),
      rect.x + badge + scaledSize(14, scale),
      rect.y + rect.height * 0.36,
    );

    ctx.font = `700 ${smallSize(12, scale, 11)}px ${fonts.body.family}`;
    ctx.fillStyle = side === "imposter" ? colors.danger : colors.amber;
    ctx.fillText(
      ellipsize(ctx, label, rect.width - badge - scaledSize(16, scale)),
      rect.x + badge + scaledSize(14, scale),
      rect.y + rect.height * 0.68,
    );
    return;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fitFontSize(ctx, "NOBODY IS OUT", rect.width * 0.8, scaledSize(30, scale), scaledSize(18, scale), fonts.display.family)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.amber;
  ctx.fillText("NOBODY IS OUT", rect.x + rect.width / 2, rect.y + rect.height * 0.34);
  ctx.font = `500 ${smallSize(13, scale, 11)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    reveal.secondTie ? "A second tie — the word moves on." : "The vote was tied.",
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.7,
  );
}

function drawBallotRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  ballot: VoteRevealState["ballots"][number],
  scale: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawRoundRect(
    ctx,
    x,
    y,
    width,
    height,
    scaledSize(8, scale),
    "#FFFDF5",
    "#1D1B26",
    1,
  );

  const badge = Math.max(scaledSize(14, scale), Math.min(height * 0.6, scaledSize(26, scale)));
  const rowMid = y + height / 2;
  drawSeatBadge(ctx, x + scaledSize(10, scale), rowMid - badge / 2, badge, ballot.seat);

  const voterX = x + scaledSize(10, scale) + badge + scaledSize(8, scale);
  const size = Math.max(13, Math.min(scaledSize(19, scale), height * 0.38));
  ctx.font = `600 ${size}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, ballot.name, width * 0.34), voterX, rowMid);

  const arrowX = x + width * 0.44;
  drawArrow(ctx, arrowX, rowMid, Math.max(7, size * 0.55), colors.textMuted);

  if (ballot.skipped) {
    ctx.textAlign = "left";
    ctx.fillStyle = colors.amber;
    ctx.font = `700 ${size}px ${fonts.display.family}`;
    ctx.fillText("SKIPPED", arrowX + scaledSize(14, scale), rowMid);
  } else if (ballot.target) {
    const targetBadge = Math.max(scaledSize(12, scale), badge * 0.8);
    drawSeatBadge(
      ctx,
      arrowX + scaledSize(14, scale),
      rowMid - targetBadge / 2,
      targetBadge,
      ballot.target.seat,
    );
    ctx.textAlign = "left";
    ctx.fillStyle = colors.text;
    ctx.font = `600 ${size}px ${fonts.display.family}`;
    ctx.fillText(
      ellipsize(ctx, ballot.target.name, width * 0.32),
      arrowX + scaledSize(14, scale) + targetBadge + scaledSize(6, scale),
      rowMid,
    );
  }
  ctx.restore();
}

// --- Final guess -----------------------------------------------------------

function drawFinalGuess(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.danger, glow: colors.danger });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fitFontSize(ctx, "FINAL GUESS", rect.width * 0.8, scaledSize(56, scale), scaledSize(26, scale), fonts.title.family)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.danger;
  ctx.fillText("FINAL GUESS", rect.x + rect.width / 2, rect.y + rect.height * 0.2);

  const guesser = state.finalGuess;
  if (guesser) {
    const badge = Math.min(rect.height * 0.16, scaledSize(52, scale));
    const gap = scaledSize(10, scale);
    const nameSize = Math.max(scaledSize(20, scale), Math.min(scaledSize(34, scale), rect.width * 0.035));
    const name = ellipsize(ctx, guesser.name, rect.width * 0.4);
    ctx.font = `700 ${nameSize}px ${fonts.display.family}`;
    const nameW = ctx.measureText(name).width;
    const groupW = badge + gap + nameW;
    const startX = rect.x + (rect.width - groupW) / 2;
    drawSeatBadge(ctx, startX, rect.y + rect.height * 0.42 - badge / 2, badge, guesser.seat);
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.fillText(name, startX + badge + gap, rect.y + rect.height * 0.42);
    ctx.textAlign = "center";
  } else {
    ctx.font = `600 ${scaledSize(22, scale)}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.fillText("The ejected Imposter is guessing…", rect.x + rect.width / 2, rect.y + rect.height * 0.42);
  }

  const total = state.timerTotalMs && state.timerTotalMs > 0 ? state.timerTotalMs : 15000;
  const remaining = Math.max(0, state.timerMs ?? total);
  const cy = rect.y + rect.height * 0.7;
  const radius = Math.min(rect.height * 0.14, rect.width * 0.09);
  drawTimerRing(ctx, rect.x + rect.width / 2, cy, radius, remaining / total, scale, colors.danger, clockLabel(remaining));

  // Suspense dots under the ring.
  const dots = 3;
  const dotR = scaledSize(5, scale);
  const gap = scaledSize(16, scale);
  const startX = rect.x + rect.width / 2 - ((dots - 1) * gap) / 2;
  const dotY = cy + radius + scaledSize(26, scale);
  for (let index = 0; index < dots; index += 1) {
    const phase = (now / 400 + index) % dots;
    const alpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin((phase / dots) * Math.PI * 2));
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(startX + index * gap, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = colors.danger;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.font = `500 ${smallSize(14, scale, 12)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    "Name the real word to steal the win.",
    rect.x + rect.width / 2,
    Math.min(rect.y + rect.height - scaledSize(14, scale), dotY + scaledSize(22, scale)),
  );
}

// --- Reveal ----------------------------------------------------------------

const REASON_TEXT: Record<FinalReveal["reason"], string> = {
  caught: "Every Imposter was caught.",
  finalGuess: "The Imposter named the word.",
  numbers: "The Imposters outnumber the crew.",
  cap: "The crew ran out of votes.",
  disconnect: "An Imposter slipped away.",
};

function drawReveal(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
  now: number,
): void {
  const reveal = state.finalReveal;
  if (!reveal) {
    drawAtTheTable(ctx, rect, state, scale);
    return;
  }

  const gap = scaledSize(14, scale);
  const wordH = rect.height * 0.4;
  const rolesH = rect.height * 0.26;
  const guess = reveal.guesses.length > 0 ? reveal.guesses[reveal.guesses.length - 1] : null;
  const guessH = guess ? rect.height - wordH - rolesH - gap * 2 : rect.height - wordH - rolesH - gap;

  drawWordCard(ctx, { x: rect.x, y: rect.y, width: rect.width, height: wordH }, reveal, scale, now);
  drawWinnerRow(
    ctx,
    { x: rect.x, y: rect.y + wordH + gap, width: rect.width, height: rolesH },
    reveal,
    scale,
  );
  if (guess) {
    drawGuessGrid(
      ctx,
      { x: rect.x, y: rect.y + wordH + rolesH + gap * 2, width: rect.width, height: guessH },
      reveal,
      guess,
      scale,
    );
  }
}

function drawWordCard(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  reveal: FinalReveal,
  scale: number,
  now: number,
): void {
  drawBentoCard(ctx, rect, { fill: "#171038", stroke: colors.magenta, glow: colors.magenta });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${smallSize(12, scale, 10)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("THE SECRET WORD WAS", rect.x + rect.width / 2, rect.y + rect.height * 0.2);

  const size = fitFontSize(
    ctx,
    reveal.word,
    rect.width * 0.86,
    scaledSize(84, scale),
    scaledSize(26, scale),
    fonts.display.family,
  );
  const pulse = 1 + 0.02 * Math.sin(now * 0.004);
  ctx.save();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height * 0.55);
  ctx.scale(pulse, pulse);
  ctx.font = `700 ${size}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.shadowColor = colors.magenta;
  ctx.shadowBlur = scaledSize(24, scale);
  ctx.fillText(ellipsize(ctx, reveal.word, rect.width * 0.9), 0, 0);
  ctx.restore();

  ctx.font = `600 ${smallSize(13, scale, 11)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.amber;
  ctx.fillText(reveal.category.toUpperCase(), rect.x + rect.width / 2, rect.y + rect.height * 0.85);
}

function drawWinnerRow(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  reveal: FinalReveal,
  scale: number,
): void {
  const crewWin = reveal.winner === "crew";
  drawBentoCard(ctx, rect, {
    fill: crewWin ? "#10261F" : "#2A1220",
    stroke: crewWin ? colors.success : colors.danger,
    glow: crewWin ? colors.success : colors.danger,
  });

  const pad = scaledSize(16, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = crewWin ? colors.success : colors.danger;
  ctx.fillText(crewWin ? "THE CREW WINS" : "THE IMPOSTERS WIN", rect.x + pad, rect.y + rect.height * 0.32);

  ctx.font = `500 ${smallSize(13, scale, 12)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(REASON_TEXT[reveal.reason], rect.x + pad, rect.y + rect.height * 0.68);

  // Role chips, right-aligned: Imposter(s) and the Larper with their word.
  const chips: Array<{ seat: number; name: string; label: string; color: string }> = [];
  for (const imposter of reveal.imposters) {
    chips.push({
      seat: imposter.seat,
      name: imposter.name,
      label: `${imposter.name} · IMPOSTER`,
      color: colors.danger,
    });
  }
  if (reveal.larper) {
    chips.push({
      seat: reveal.larper.seat,
      name: reveal.larper.name,
      // The Larper's phone showed the lookalike, so the TV owes the table both.
      label: `${reveal.larper.name} · LARPER · ${reveal.larper.word}`,
      color: colors.violet,
    });
  }
  if (chips.length === 0) return;

  const chipH = Math.max(scaledSize(24, scale), Math.min(rect.height * 0.36, scaledSize(34, scale)));
  let right = rect.x + rect.width - pad;
  ctx.textBaseline = "middle";
  for (let index = chips.length - 1; index >= 0; index -= 1) {
    const chip = chips[index];
    const badge = Math.max(scaledSize(14, scale), chipH * 0.78);
    const chipFont = Math.max(11, Math.round(chipH * 0.4));
    ctx.font = `700 ${chipFont}px ${fonts.body.family}`;
    const labelW = ctx.measureText(chip.label).width + scaledSize(8, scale);
    const chipW = badge + scaledSize(6, scale) + labelW + scaledSize(12, scale);
    const x = right - chipW;
    const y = rect.y + rect.height * 0.74 - chipH / 2;
    drawRoundRect(
      ctx,
      x,
      y,
      chipW,
      chipH,
      chipH / 2,
      "#FFFDF5",
      "#1D1B26",
      1,
    );
    drawSeatBadge(ctx, x + scaledSize(4, scale), y + (chipH - badge) / 2, badge, chip.seat);
    ctx.textAlign = "left";
    ctx.fillStyle = chip.color;
    ctx.font = `700 ${chipFont}px ${fonts.body.family}`;
    ctx.fillText(
      ellipsize(ctx, chip.label, Math.max(scaledSize(30, scale), labelW - scaledSize(8, scale))),
      x + scaledSize(4, scale) + badge + scaledSize(6, scale),
      y + chipH / 2,
    );
    right = x - scaledSize(8, scale);
    if (right < rect.x + rect.width * 0.4) break;
  }
}

function drawGuessGrid(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  reveal: FinalReveal,
  guess: FinalGuessReveal,
  scale: number,
): void {
  drawBentoCard(ctx, rect, { fill: "#150F33", stroke: colors.border });
  const pad = scaledSize(12, scale);

  const verdict = guess.choice === null
    ? `${guess.name} ran out of time.`
    : guess.correct
      ? `${guess.name} guessed “${guess.choice}” — correct!`
      : `${guess.name} guessed “${guess.choice}” — wrong.`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${smallSize(12, scale, 11)}px ${fonts.body.family}`;
  ctx.fillStyle = guess.correct ? colors.danger : colors.textMuted;
  ctx.fillText(ellipsize(ctx, verdict, rect.width - pad * 2), rect.x + pad, rect.y + pad + scaledSize(8, scale));

  const options = guess.options;
  const columns = Math.min(3, Math.max(1, options.length));
  const rows = Math.ceil(options.length / columns);
  const top = rect.y + pad + scaledSize(20, scale);
  const gap = scaledSize(8, scale);
  const cellW = (rect.width - pad * 2 - gap * (columns - 1)) / columns;
  const cellH = Math.max(scaledSize(20, scale), (rect.y + rect.height - pad - top - gap * (rows - 1)) / rows);
  const letters = "ABCDEF";
  const fontSize = Math.max(
    scaledSize(11, scale),
    Math.min(scaledSize(17, scale), cellH * 0.4, cellW * 0.16),
  );

  options.forEach((option, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = rect.x + pad + column * (cellW + gap);
    const y = top + row * (cellH + gap);
    const isWord = option === reveal.word;
    const picked = guess.choice === option;

    drawRoundRect(
      ctx,
      x,
      y,
      cellW,
      cellH,
      scaledSize(8, scale),
      isWord ? "rgba(47,181,106,0.16)" : picked ? "rgba(240,69,58,0.12)" : "#FFFDF5",
      isWord ? colors.success : picked ? colors.danger : "#1D1B26",
      isWord ? Math.max(1, scaledSize(2, scale)) : 1,
    );

    const badgeSize = Math.max(scaledSize(12, scale), Math.min(cellH * 0.5, scaledSize(20, scale)));
    drawRoundRect(
      ctx,
      x + scaledSize(5, scale),
      y + (cellH - badgeSize) / 2,
      badgeSize,
      badgeSize,
      scaledSize(4, scale),
      isWord ? colors.success : picked ? colors.danger : "rgba(255,255,255,0.12)",
    );
    ctx.fillStyle = isWord ? colors.bg0 : colors.text;
    ctx.font = `700 ${Math.max(scaledSize(9, scale), Math.round(badgeSize * 0.5))}px ${fonts.display.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letters[index] ?? "", x + scaledSize(5, scale) + badgeSize / 2, y + cellH / 2 + 1);

    const textX = x + scaledSize(5, scale) + badgeSize + scaledSize(6, scale);
    ctx.font = `600 ${fontSize}px ${fonts.display.family}`;
    ctx.fillStyle = isWord ? colors.text : picked ? "rgba(255,200,210,0.95)" : "rgba(245,243,255,0.82)";
    ctx.textAlign = "left";
    ctx.fillText(
      ellipsize(ctx, option, Math.max(scaledSize(20, scale), x + cellW - scaledSize(5, scale) - textX)),
      textX,
      y + cellH / 2,
    );
  });
}

/** Defensive end screen when a finished game has no standings to crown. */
function drawAtTheTable(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  state: ImposterScreenState,
  scale: number,
): void {
  drawBentoCard(ctx, rect, { fill: "rgba(23,18,56,0.97)", stroke: colors.border });
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(40, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(state.finished ? "That's a wrap" : "Guess the Imposter", rect.x + rect.width / 2, rect.y + rect.height / 2);
}

// --- Shared drawing helpers ------------------------------------------------

function drawSeatBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  seatIndex: number,
): void {
  const seat = seatForIndex(seatIndex);
  drawRoundRect(ctx, x, y, size, size, Math.max(3, size * 0.24), seat.color);
  ctx.fillStyle = colors.bg0;
  ctx.font = `700 ${Math.max(9, Math.round(size * 0.52))}px ${fonts.display.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Shape glyph, never colour alone.
  ctx.fillText(seat.emoji, x + size / 2, y + size / 2 + 1);
}

/** A crisp right-pointing arrow; a text arrow is font-dependent. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size * 0.55, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size, y);
  ctx.lineTo(x + size * 0.3, y - size * 0.55);
  ctx.lineTo(x + size * 0.3, y + size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTimerRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  progress: number,
  scale: number,
  accent: string,
  label: string,
): void {
  const lineWidth = Math.max(3, scaledSize(9, scale));
  const value = clamp(progress, 0, 1);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  if (value > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * value);
    ctx.strokeStyle = value < 0.25 ? colors.danger : accent;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  if (label) {
    const size = fitFontSize(
      ctx,
      label,
      radius * 1.35,
      Math.round(radius * 0.62),
      Math.max(9, Math.round(radius * 0.24)),
      fonts.display.family,
    );
    ctx.font = `700 ${size}px ${fonts.display.family}`;
    ctx.fillStyle = colors.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 1);
  }
  ctx.restore();
}

/** mm:ss for a long timer, plain seconds for a short one. */
function clockLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return String(total);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}


/** A scaled label size with a hard floor so 720p never drops below legible. */
function smallSize(base: number, scale: number, floor = 11): number {
  return Math.max(floor, scaledSize(base, scale));
}

/** Largest font size that fits `text` inside `maxWidth`, never below `minSize`. */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  family: string,
  weight = 700,
): number {
  let size = Math.max(1, Math.round(maxSize));
  const floor = Math.max(1, Math.round(minSize));
  const step = Math.max(1, Math.round(size * 0.05));
  while (size > floor) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= step;
  }
  return Math.max(floor, size);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}
