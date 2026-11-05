/**
 * TV watchability overlays (Phase 2, brief 3.8).
 *
 * The shared screen must never sit still: this module draws a compact live score
 * ticker, a "Waiting on …" banner, a big caption line and a one-shot reveal
 * flash on top of whatever renderer the running game uses.
 *
 * Everything is canvas drawing plus small pieces of animation state. The game
 * renderers are untouched; the game's own score tables (`players`, `scores`,
 * `racers`) are the only source.
 */

import type { SeatIdentity } from "../../../shared/seat-identity.ts";
import { countUp, CAPTION_DURATION_MS } from "../../../shared/interlude.ts";
import { roundRect } from "./bento.ts";
import { colors, fonts, scaleForViewport, scaledSize } from "./theme.ts";

/** How long a score takes to count up to its new value. */
const COUNT_UP_MS = 700;

/** How long the leader-change flash runs. */
const LEADER_FLASH_MS = 900;

/** How long the reveal band flashes. */
const REVEAL_FLASH_MS = 1200;

/** Compact row cap: one row per seat. */
const MAX_TICKER_ROWS = 8;

export interface TickerRow {
  name: string;
  score: number;
}

export interface WatchTickerRow {
  name: string;
  seat: SeatIdentity;
  score: number;
}

const SCORE_TABLES = ["players", "scores", "racers"] as const;
const SCORE_KEYS = ["score", "chips", "points", "total", "progress", "totalStrokes"] as const;

/**
 * Normalise whichever score table the running game publishes into ticker rows.
 * Tables are checked in order and the first non-empty one wins; duplicate names
 * keep their first row.
 */
export function tickerRowsFromScreen(state: unknown): TickerRow[] {
  if (!state || typeof state !== "object") return [];
  const record = state as Record<string, unknown>;

  for (const tableKey of SCORE_TABLES) {
    const table = record[tableKey];
    if (!Array.isArray(table)) continue;

    const rows: TickerRow[] = [];
    const seen = new Set<string>();
    for (const entry of table) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const rawName =
        typeof item.name === "string"
          ? item.name
          : typeof item.playerName === "string"
            ? item.playerName
            : "";
      const name = rawName.trim();
      if (!name || seen.has(name)) continue;

      let score: number | null = null;
      for (const key of SCORE_KEYS) {
        const value = item[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          score = value;
          break;
        }
      }
      if (score === null) continue;

      seen.add(name);
      rows.push({ name, score });
      if (rows.length >= MAX_TICKER_ROWS) break;
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

/**
 * Names the game says it is waiting on. `waitingOn` wins; a single `turnName`
 * is the older shape several games already publish.
 */
export function waitingNamesFromScreen(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const record = state as Record<string, unknown>;

  const names: string[] = [];
  if (Array.isArray(record.waitingOn)) {
    for (const raw of record.waitingOn) {
      if (typeof raw === "string" && raw.trim()) names.push(raw.trim());
      if (names.length >= MAX_TICKER_ROWS) break;
    }
  }
  if (names.length === 0 && typeof record.turnName === "string" && record.turnName.trim()) {
    names.push(record.turnName.trim());
  }
  return names;
}

/** A screen-state `reveal` as one line: the string itself, or an array joined. */
export function revealTextFromScreen(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const reveal = (state as Record<string, unknown>).reveal;

  if (typeof reveal === "string") return reveal.trim() || null;
  if (Array.isArray(reveal)) {
    const parts: string[] = [];
    for (const raw of reveal) {
      if (typeof raw === "string" && raw.trim()) parts.push(raw.trim());
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return null;
}

// --- Animation state ------------------------------------------------------

export interface WatchOverlayState {
  /** Per name: the value shown when the count-up started, its target, and when. */
  counters: Map<string, { from: number; to: number; start: number }>;
  leader: string | null;
  leaderFlashStart: number;
  caption: string;
  captionStart: number;
  reveal: string;
  revealStart: number;
  rows: WatchTickerRow[];
  waiting: string[];
  timeLeft: number | null;
}

export function createWatchOverlay(): WatchOverlayState {
  return {
    counters: new Map(),
    leader: null,
    leaderFlashStart: 0,
    caption: "",
    captionStart: 0,
    reveal: "",
    revealStart: 0,
    rows: [],
    waiting: [],
    timeLeft: null,
  };
}

export interface WatchOverlayInput {
  rows: WatchTickerRow[];
  waitingNames: string[];
  timeLeft: number | null;
  caption: string | null;
  reveal: string | null;
  now: number;
  reducedMotion: boolean;
}

/** Highest score wins; ties keep the first row, matching the standings rule. */
export function leaderName(rows: readonly TickerRow[]): string | null {
  let leader: string | null = null;
  let best = -Infinity;
  for (const row of rows) {
    if (row.score > best) {
      best = row.score;
      leader = row.name;
    }
  }
  return leader;
}

/**
 * Advance counters, leader tracking and the caption/reveal timers. Called once
 * per frame before `drawWatchOverlay`.
 */
export function updateWatchOverlay(state: WatchOverlayState, input: WatchOverlayInput): void {
  const { rows, now, reducedMotion } = input;
  const live = new Set(rows.map((row) => row.name));
  for (const key of state.counters.keys()) {
    if (!live.has(key)) state.counters.delete(key);
  }

  for (const row of rows) {
    const existing = state.counters.get(row.name);
    if (!existing) {
      state.counters.set(row.name, { from: row.score, to: row.score, start: now });
      continue;
    }
    if (existing.to === row.score) continue;

    const progress = reducedMotion ? 1 : (now - existing.start) / COUNT_UP_MS;
    const shown = countUp(existing.from, existing.to, progress);
    state.counters.set(row.name, { from: shown, to: row.score, start: now });
  }

  const leader = leaderName(rows);
  if (leader !== null && state.leader !== null && leader !== state.leader) {
    state.leaderFlashStart = now;
  }
  state.leader = leader;
  state.rows = rows;
  state.waiting = input.waitingNames;
  state.timeLeft = input.timeLeft;

  if (!input.caption) {
    state.caption = "";
  } else if (input.caption !== state.caption) {
    state.caption = input.caption;
    state.captionStart = now;
  }

  if (!input.reveal) {
    state.reveal = "";
  } else if (input.reveal !== state.reveal) {
    state.reveal = input.reveal;
    state.revealStart = now;
  }
}

// --- Drawing -------------------------------------------------------------

/** The score a counter shows at `now`. */
function counterValue(
  state: WatchOverlayState,
  row: WatchTickerRow,
  now: number,
  reducedMotion: boolean,
): number {
  const counter = state.counters.get(row.name);
  if (!counter) return row.score;
  const progress = reducedMotion ? 1 : (now - counter.start) / COUNT_UP_MS;
  return countUp(counter.from, counter.to, progress);
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

function drawTicker(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WatchOverlayState,
  now: number,
  scale: number,
  reducedMotion: boolean,
): number {
  const rows = state.rows;
  if (rows.length === 0) return 0;

  const margin = Math.max(12, scaledSize(24, scale));
  const padding = Math.max(8, scaledSize(12, scale));
  const rowHeight = Math.max(26, scaledSize(34, scale));
  const cardWidth = Math.min(Math.max(190, scaledSize(300, scale)), width * 0.36);
  const cardHeight = rows.length * rowHeight + padding * 2;
  const x = width - margin - cardWidth;
  const y = height - margin - cardHeight;

  ctx.save();
  roundRect(ctx, x, y, cardWidth, cardHeight, Math.max(10, scaledSize(14, scale)));
  ctx.fillStyle = "rgba(11, 8, 32, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const badgeSize = rowHeight * 0.64;
  const nameSize = Math.max(13, scaledSize(18, scale));
  const scoreSize = Math.max(14, scaledSize(22, scale));
  const flashAge = now - state.leaderFlashStart;
  const flash = !reducedMotion && flashAge >= 0 && flashAge < LEADER_FLASH_MS
    ? 1 - flashAge / LEADER_FLASH_MS
    : 0;
  const waiting = new Set(state.waiting.map((name) => name.toLowerCase()));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowY = y + padding + i * rowHeight;
    const isLeader = row.name === state.leader;
    const isWaiting = waiting.has(row.name.toLowerCase());

    if (isLeader && flash > 0) {
      ctx.fillStyle = `rgba(255, 179, 71, ${(0.26 * flash).toFixed(3)})`;
      roundRect(ctx, x + 4, rowY, cardWidth - 8, rowHeight, 8);
      ctx.fill();
    }

    const badgeX = x + padding;
    const badgeY = rowY + (rowHeight - badgeSize) / 2;
    if (isWaiting) {
      const pulse = reducedMotion ? 1 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now / 220));
      ctx.strokeStyle = `rgba(255, 179, 71, ${pulse.toFixed(3)})`;
      ctx.lineWidth = 2;
      roundRect(ctx, badgeX - 2, badgeY - 2, badgeSize + 4, badgeSize + 4, 8);
      ctx.stroke();
    }

    ctx.fillStyle = row.seat.color;
    roundRect(ctx, badgeX, badgeY, badgeSize, badgeSize, Math.max(5, badgeSize * 0.24));
    ctx.fill();
    ctx.fillStyle = colors.bg0;
    ctx.font = `700 ${Math.max(10, Math.floor(badgeSize * 0.52))}px ${fonts.display.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(row.seat.emoji, badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 1);

    const scoreText = String(counterValue(state, row, now, reducedMotion));
    ctx.font = `700 ${scoreSize}px ${fonts.display.family}`;
    const scoreWidth = ctx.measureText(scoreText).width;
    const nameX = badgeX + badgeSize + Math.max(6, scaledSize(9, scale));
    const nameMax = x + cardWidth - padding - scoreWidth - Math.max(6, scaledSize(10, scale));

    ctx.font = `500 ${nameSize}px ${fonts.display.family}`;
    ctx.fillStyle = isWaiting ? colors.amber : colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      ellipsize(ctx, row.name, Math.max(20, nameMax - nameX)),
      nameX,
      rowY + rowHeight / 2,
    );

    // Leader marker: a small amber bar, never colour alone in the row itself.
    if (isLeader) {
      ctx.fillStyle = colors.amber;
      ctx.fillRect(x + 4, rowY + rowHeight * 0.22, 3, rowHeight * 0.56);
    }

    ctx.font = `700 ${scoreSize}px ${fonts.display.family}`;
    ctx.fillStyle = isLeader ? colors.amber : colors.text;
    ctx.textAlign = "right";
    ctx.fillText(scoreText, x + cardWidth - padding, rowY + rowHeight / 2);
  }

  ctx.restore();
  return cardHeight;
}

function drawWaitingBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  state: WatchOverlayState,
  now: number,
  scale: number,
  reducedMotion: boolean,
): void {
  let label: string | null = null;
  let accent: string = colors.amber;
  let waiting = true;

  if (state.waiting.length > 0) {
    const shown = state.waiting.slice(0, 3).join(", ");
    const extra = state.waiting.length > 3 ? ` +${state.waiting.length - 3}` : "";
    label = `Waiting on: ${shown}${extra}`;
  } else if (state.timeLeft !== null && state.timeLeft > 0) {
    label = `${Math.ceil(state.timeLeft / 1000)}s`;
    accent = colors.cyan;
    waiting = false;
  }
  if (!label) return;

  const margin = Math.max(12, scaledSize(24, scale));
  const paddingX = Math.max(14, scaledSize(22, scale));
  const fontSize = waiting ? Math.max(16, scaledSize(26, scale)) : Math.max(18, scaledSize(30, scale));
  ctx.save();
  ctx.font = `700 ${fontSize}px ${fonts.display.family}`;
  const textWidth = ctx.measureText(label).width;
  const boxWidth = Math.min(width - margin * 2, textWidth + paddingX * 2);
  const boxHeight = Math.max(36, fontSize * 1.9);
  const x = (width - boxWidth) / 2;
  const y = margin;

  const pulse = reducedMotion || !waiting ? 1 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now / 260));
  roundRect(ctx, x, y, boxWidth, boxHeight, boxHeight / 2);
  ctx.fillStyle = "rgba(11, 8, 32, 0.86)";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, label, boxWidth - paddingX * 2), width / 2, y + boxHeight / 2 + 1);
  ctx.restore();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WatchOverlayState,
  now: number,
  scale: number,
  tickerHeight: number,
  reducedMotion: boolean,
): void {
  if (!state.caption) return;
  const age = now - state.captionStart;
  if (age < 0 || age >= CAPTION_DURATION_MS) return;

  const fadeIn = reducedMotion ? 1 : Math.min(1, age / 180);
  const fadeOut = reducedMotion ? 1 : Math.min(1, (CAPTION_DURATION_MS - age) / 400);
  const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut));

  const margin = Math.max(12, scaledSize(24, scale));
  const paddingX = Math.max(18, scaledSize(30, scale));
  const paddingY = Math.max(8, scaledSize(14, scale));
  const fontSize = Math.max(22, scaledSize(40, scale));

  ctx.save();
  ctx.font = `700 ${fontSize}px ${fonts.display.family}`;
  const maxWidth = width * 0.82;
  const text = ellipsize(ctx, state.caption, maxWidth - paddingX * 2);
  const boxWidth = Math.min(maxWidth, ctx.measureText(text).width + paddingX * 2);
  const boxHeight = fontSize + paddingY * 2;
  const x = (width - boxWidth) / 2;
  const base = tickerHeight > 0 ? height - margin - tickerHeight - Math.max(8, scaledSize(12, scale)) : height - margin;
  const y = base - boxHeight;

  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, boxWidth, boxHeight, Math.max(10, scaledSize(14, scale)));
  ctx.fillStyle = "rgba(11, 8, 32, 0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, y + boxHeight / 2 + 1);
  ctx.restore();
}

function drawReveal(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WatchOverlayState,
  now: number,
  scale: number,
  reducedMotion: boolean,
): void {
  if (!state.reveal) return;
  const age = now - state.revealStart;
  if (age < 0 || age >= REVEAL_FLASH_MS) return;

  const fade = reducedMotion ? 0.9 : 1 - age / REVEAL_FLASH_MS;
  const bandHeight = Math.max(90, scaledSize(150, scale));
  const y = height / 2 - bandHeight / 2;
  const fontSize = Math.max(24, scaledSize(44, scale));

  ctx.save();
  ctx.fillStyle = `rgba(0, 229, 255, ${(0.16 * fade).toFixed(3)})`;
  ctx.fillRect(0, y, width, bandHeight);
  ctx.fillStyle = `rgba(0, 229, 255, ${(0.55 * fade).toFixed(3)})`;
  ctx.fillRect(0, y, width, 2);
  ctx.fillRect(0, y + bandHeight - 2, width, 2);

  ctx.font = `700 ${fontSize}px ${fonts.display.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, state.reveal, width * 0.86), width / 2, height / 2);
  ctx.restore();
}

/**
 * Draw the never-a-dead-screen layer. Ticker bottom-right, waiting/timer banner
 * top-centre, caption above the ticker and the reveal flash across the middle.
 * Returns the ticker height so callers can place their own content if needed.
 */
export function drawWatchOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WatchOverlayState,
  now: number,
  reducedMotion: boolean,
): number {
  const scale = scaleForViewport(width, height);
  const tickerHeight = drawTicker(ctx, width, height, state, now, scale, reducedMotion);
  drawWaitingBanner(ctx, width, state, now, scale, reducedMotion);
  drawCaption(ctx, width, height, state, now, scale, tickerHeight, reducedMotion);
  drawReveal(ctx, width, height, state, now, scale, reducedMotion);
  return tickerHeight;
}
