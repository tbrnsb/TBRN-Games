/**
 * Shared paper game board for the expansion-era renderers.
 * Draws the printed page, title, hero, options, score tags and props.
 */

import { drawSynthwaveBackground } from "./background.ts";
import { paperMeta, paperTitle } from "./header.ts";
import { drawFinishVictory } from "./finish.ts";
import { drawBentoCard, drawScoreboard, roundRect } from "./bento.ts";
import { colors, fonts, getPlayerColor, scaleForViewport, scaledSize } from "./theme.ts";

export interface PaperBoardConfig {
  title: string;
  heroKeys?: string[];
  optionMode?: boolean;
  mode?: "text" | "drawing" | "shirts" | "arena" | "slide";
  subtitleKeys?: string[];
}

interface Rect { x: number; y: number; width: number; height: number }

export function renderPaperBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  raw: unknown,
  config: PaperBoardConfig,
): void {
  const state = (raw ?? {}) as Record<string, unknown>;
  const scale = scaleForViewport(width, height);
  const margin = scaledSize(36, scale);
  const headerH = scaledSize(64, scale);
  const railW = Math.min(width * 0.25, scaledSize(310, scale));
  const railX = width - margin - railW;
  const mainW = railX - margin - scaledSize(18, scale);

  drawSynthwaveBackground(ctx, { width, height, time: performance.now() });
  if (drawFinishVictory(ctx, width, height, state, config.title)) return;
  drawHeader(ctx, width, height, margin, headerH, scale, config, state);
  drawProps(ctx, width, height, scale);

  const heroY = margin + headerH + scaledSize(8, scale);
  const heroH = config.mode === "arena" ? height - heroY - margin : Math.round(height * 0.29);
  const hero: Rect = { x: margin, y: heroY, width: mainW, height: heroH };

  if (config.mode === "arena") {
    drawArena(ctx, hero, state, scale);
  } else if (config.mode === "drawing") {
    drawDrawing(ctx, hero, state, scale);
  } else if (config.mode === "shirts") {
    drawShirts(ctx, hero, state, scale);
  } else {
    drawHero(ctx, hero, state, config, scale);
  }

  if (config.mode !== "arena") {
    const optionY = hero.y + hero.height + scaledSize(12, scale);
    const optionH = height - margin - optionY - scaledSize(44, scale);
    const options = optionsFrom(state, config.optionMode !== false);
    if (options.length > 0 && optionH > 60) {
      drawOptions(ctx, { x: margin, y: optionY, width: mainW, height: optionH }, options, scale);
    } else if (optionH > 80) {
      drawWaitingPanel(ctx, { x: margin, y: optionY, width: mainW, height: optionH }, state, scale);
    }
  }

  const railTop = margin + headerH + scaledSize(8, scale);
  drawRail(ctx, { x: railX, y: railTop, width: railW, height: Math.max(120, height - margin - railTop - scaledSize(74, scale)) }, state, scale);
  drawFooter(ctx, width, height, margin, scale, state);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  _height: number,
  margin: number,
  headerH: number,
  scale: number,
  config: PaperBoardConfig,
  state: Record<string, unknown>,
): void {
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  paperTitle(ctx, scale);
  ctx.fillText(config.title.toUpperCase(), margin, margin + headerH * 0.35);

  const round = Number(state.round ?? 1);
  const maxRounds = Number(state.maxRounds ?? state.rounds ?? 1);
  paperMeta(ctx, scale);
  ctx.fillText(`Round ${round} of ${maxRounds}`, margin, margin + headerH * 0.82);

  const timer = Number(state.timerMs ?? 0);
  if (timer > 0) {
    const label = `${Math.ceil(timer / 1000)}s`;
    const boxW = scaledSize(94, scale);
    const boxH = scaledSize(42, scale);
    const x = width - margin - boxW;
    const y = margin + scaledSize(8, scale);
    ctx.fillStyle = colors.amber;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(2, scale * 3);
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = colors.border;
    ctx.font = `800 ${scaledSize(24, scale)}px ${fonts.display.family}`;
    ctx.textAlign = "center";
    ctx.fillText(label, x + boxW / 2, y + boxH / 2);
  }

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scale * 3);
  ctx.beginPath();
  ctx.moveTo(margin, margin + headerH);
  ctx.lineTo(width - margin, margin + headerH);
  ctx.stroke();
  ctx.restore();
}

function drawProps(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number): void {
  ctx.save();
  // Pin
  ctx.fillStyle = colors.magenta;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(2, scale * 2);
  ctx.beginPath();
  ctx.arc(width - scaledSize(54, scale), scaledSize(28, scale), scaledSize(9, scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Coffee ring
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = "#9B6A3E";
  ctx.lineWidth = Math.max(2, scale * 4);
  ctx.beginPath();
  ctx.arc(scaledSize(58, scale), height - scaledSize(58, scale), scaledSize(44, scale), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHero(ctx: CanvasRenderingContext2D, rect: Rect, state: Record<string, unknown>, config: PaperBoardConfig, scale: number): void {
  drawBentoCard(ctx, rect);
  const keys = config.heroKeys ?? ["prompt", "scenario", "problem", "topic", "slide", "question", "clue", "target", "category", "caption"];
  let text = "";
  for (const key of keys) {
    const value = state[key];
    if (typeof value === "string" && value.trim()) { text = value.trim(); break; }
  }
  if (!text) text = phaseCopy(String(state.phase ?? ""));
  const size = fitCanvas(ctx, text, rect.width - scaledSize(52, scale), fonts.body.family, 700, scaledSize(46, scale), scaledSize(26, scale));
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${size}px ${fonts.body.family}`;
  ctx.fillStyle = colors.cardText;
  const lines = wrap(ctx, text, rect.width - scaledSize(52, scale), 4);
  const lineH = size * 1.16;
  const startY = rect.y + rect.height / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.width / 2, startY + i * lineH));
  ctx.restore();
}

function drawOptions(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: Array<{ label: string; votes: number; correct?: boolean }>,
  scale: number,
): void {
  const cols = options.length > 4 ? 2 : 1;
  const rows = Math.ceil(options.length / cols);
  const gap = scaledSize(8, scale);
  const rowH = (rect.height - gap * (rows - 1)) / rows;
  const cardW = (rect.width - gap * (cols - 1)) / cols;
  const maxVotes = Math.max(1, ...options.map((o) => o.votes));

  options.forEach((option, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const card: Rect = {
      x: rect.x + col * (cardW + gap),
      y: rect.y + row * (rowH + gap),
      width: cardW,
      height: rowH,
    };
    ctx.save();
    ctx.fillStyle = option.correct ? colors.amber : "#FFFDF5";
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(2, scale * 2.5);
    ctx.shadowColor = colors.border;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    roundRect(ctx, card.x, card.y, card.width, card.height, scaledSize(5, scale));
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.stroke();
    ctx.fillStyle = colors.cardText;
    ctx.font = `700 ${Math.max(14, Math.min(scaledSize(22, scale), rowH * 0.34))}px ${fonts.body.family}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = ellipsize(ctx, option.label, card.width - scaledSize(66, scale));
    ctx.fillText(label, card.x + scaledSize(12, scale), card.y + card.height * 0.44);
    if (option.votes > 0) {
      ctx.textAlign = "right";
      ctx.fillStyle = colors.magenta;
      ctx.font = `800 ${scaledSize(18, scale)}px ${fonts.display.family}`;
      ctx.fillText(String(option.votes), card.x + card.width - scaledSize(10, scale), card.y + card.height * 0.44);
      ctx.fillStyle = "rgba(29,27,38,0.15)";
      ctx.fillRect(card.x + scaledSize(10, scale), card.y + card.height - scaledSize(12, scale), card.width - scaledSize(20, scale), scaledSize(4, scale));
      ctx.fillStyle = colors.magenta;
      ctx.fillRect(card.x + scaledSize(10, scale), card.y + card.height - scaledSize(12, scale), (card.width - scaledSize(20, scale)) * (option.votes / maxVotes), scaledSize(4, scale));
    }
    ctx.restore();
  });
}

function drawRail(ctx: CanvasRenderingContext2D, rect: Rect, state: Record<string, unknown>, scale: number): void {
  const rows = scoreRows(state);
  if (rows.length === 0) return;
  drawBentoCard(ctx, rect);
  drawScoreboard(ctx, rect, rows, { title: "Scores", scale, showRank: true });
}

function drawFooter(ctx: CanvasRenderingContext2D, width: number, height: number, margin: number, scale: number, state: Record<string, unknown>): void {
  const caption = typeof state.caption === "string" ? state.caption : "";
  if (!caption) return;
  const info = caption;
  ctx.save();
  ctx.font = `700 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(ellipsize(ctx, info, width - margin * 2), margin, height - scaledSize(14, scale));
  ctx.restore();
}

function drawWaitingPanel(ctx: CanvasRenderingContext2D, rect: Rect, state: Record<string, unknown>, scale: number): void {
  drawBentoCard(ctx, rect);
  const waiting = Array.isArray(state.waitingOn) ? state.waitingOn.filter((n): n is string => typeof n === "string") : [];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.cardText;
  const waitingLabel = waiting.length ? `Waiting on ${waiting.join(", ")}` : "Play on your phone";
  ctx.fillText(
    ellipsize(ctx, waitingLabel, rect.width - scaledSize(40, scale)),
    rect.x + rect.width / 2,
    rect.y + rect.height * 0.36,
  );

  const players = Array.isArray(state.players) ? state.players as Array<Record<string, unknown>> : [];
  const chips = players.length > 0 ? players : (Array.isArray(state.scores) ? state.scores as Array<Record<string, unknown>> : []);
  const cols = Math.min(4, Math.max(1, chips.length));
  const rows = Math.ceil(chips.length / cols);
  const gap = scaledSize(8, scale);
  const chipW = Math.min(scaledSize(170, scale), (rect.width - gap * (cols + 1)) / Math.max(1, cols));
  const chipH = scaledSize(34, scale);
  const startX = rect.x + rect.width / 2 - ((cols * chipW + (cols - 1) * gap) / 2);
  const startY = rect.y + rect.height * 0.66 - ((rows * chipH + (rows - 1) * gap) / 2);
  chips.forEach((chip, i) => {
    const x = startX + (i % cols) * (chipW + gap);
    const y = startY + Math.floor(i / cols) * (chipH + gap);
    ctx.fillStyle = "#FFFDF5";
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = Math.max(1, scale * 2);
    ctx.fillRect(x, y, chipW, chipH);
    ctx.strokeRect(x, y, chipW, chipH);
    ctx.fillStyle = getPlayerColor(i);
    ctx.fillRect(x + 5, y + 6, 10, chipH - 12);
    ctx.strokeRect(x + 5, y + 6, 10, chipH - 12);
    ctx.fillStyle = colors.cardText;
    ctx.textAlign = "left";
    ctx.font = `700 ${scaledSize(14, scale)}px ${fonts.body.family}`;
    ctx.fillText(ellipsize(ctx, String(chip.name ?? `Player ${i + 1}`), chipW - 28), x + 22, y + chipH / 2);
  });
  ctx.restore();
}

function drawDrawing(ctx: CanvasRenderingContext2D, rect: Rect, state: Record<string, unknown>, scale: number): void {
  drawBentoCard(ctx, rect);
  const inner = { x: rect.x + 14, y: rect.y + 14, width: rect.width - 28, height: rect.height - 28 };
  ctx.save();
  ctx.fillStyle = "#FFFDF5";
  ctx.fillRect(inner.x, inner.y, inner.width, inner.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(inner.x, inner.y, inner.width, inner.height);
  const strokes = Array.isArray(state.strokes) ? state.strokes : [];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const raw of strokes) {
    const stroke = raw as { points?: Array<[number, number]>; color?: string };
    if (!Array.isArray(stroke.points) || stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color ?? colors.cardText;
    ctx.lineWidth = Math.max(2, scale * 3);
    ctx.beginPath();
    stroke.points.forEach(([x, y], i) => {
      const px = inner.x + Math.min(1, Math.max(0, x)) * inner.width;
      const py = inner.y + Math.min(1, Math.max(0, y)) * inner.height;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  if (strokes.length === 0) {
    ctx.fillStyle = colors.cardMuted;
    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.body.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("The drawing is under wraps", rect.x + rect.width / 2, rect.y + rect.height / 2);
  }
  ctx.restore();
}

function drawShirts(ctx: CanvasRenderingContext2D, rect: Rect, state: Record<string, unknown>, scale: number): void {
  drawBentoCard(ctx, rect);
  const shirts = Array.isArray(state.shirts) ? state.shirts : [];
  if (shirts.length === 0) {
    ctx.fillStyle = colors.cardMuted;
    ctx.font = `700 ${scaledSize(22, scale)}px ${fonts.body.family}`;
    ctx.textAlign = "center";
    ctx.fillText("Designing…", rect.x + rect.width / 2, rect.y + rect.height / 2);
    return;
  }
  const cols = Math.max(1, Math.min(4, Number(state.columns ?? 2)));
  const rows = Math.ceil(shirts.length / cols);
  const gap = scaledSize(10, scale);
  const cw = (rect.width - gap * (cols + 1)) / cols;
  const ch = (rect.height - gap * (rows + 1)) / rows;
  shirts.forEach((raw, i) => {
    const shirt = raw as { design?: Array<{ points?: Array<[number, number]>; color?: string }>; slogan?: string; text?: string };
    const x = rect.x + gap + (i % cols) * (cw + gap);
    const y = rect.y + gap + Math.floor(i / cols) * (ch + gap);
    ctx.fillStyle = "#FFFDF5";
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeRect(x, y, cw, ch);
    const design = Array.isArray(shirt.design) ? shirt.design : [];
    for (const stroke of design) {
      if (!Array.isArray(stroke.points) || stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color ?? colors.cardText;
      ctx.lineWidth = Math.max(1, scale * 2);
      ctx.beginPath();
      stroke.points.forEach(([px, py], j) => {
        const sx = x + 6 + Math.min(1, Math.max(0, px)) * (cw - 12);
        const sy = y + 6 + Math.min(1, Math.max(0, py)) * (ch * 0.65);
        if (j === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.fillStyle = colors.cardText;
    ctx.font = `700 ${Math.max(11, scaledSize(14, scale))}px ${fonts.body.family}`;
    ctx.textAlign = "center";
    ctx.fillText(ellipsize(ctx, String(shirt.slogan ?? shirt.text ?? ""), cw - 12), x + cw / 2, y + ch - scaledSize(12, scale));
  });
}

function drawArena(ctx: CanvasRenderingContext2D, rect: Rect, state: Record<string, unknown>, scale: number): void {
  drawBentoCard(ctx, rect);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const r = Math.min(rect.width, rect.height) * 0.40;
  ctx.save();
  ctx.fillStyle = "#FFFDF5";
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = Math.max(3, scale * 4);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const hazards = Array.isArray(state.hazards) ? state.hazards : [];
  for (const raw of hazards) {
    const hazard = raw as { x?: number; y?: number; r?: number };
    ctx.fillStyle = colors.danger;
    ctx.beginPath();
    ctx.arc(cx + Number(hazard.x ?? 0) * r, cy + Number(hazard.y ?? 0) * r, Number(hazard.r ?? 0.06) * r, 0, Math.PI * 2);
    ctx.fill();
  }
  const pucks = Array.isArray(state.pucks) ? state.pucks : [];
  pucks.forEach((raw, i) => {
    const puck = raw as { x?: number; y?: number; alive?: boolean; name?: string };
    if (puck.alive === false) return;
    const px = cx + Number(puck.x ?? 0) * r;
    const py = cy + Number(puck.y ?? 0) * r;
    ctx.fillStyle = getPlayerColor(i);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(8, scale * 12), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function optionsFrom(state: Record<string, unknown>, enabled: boolean): Array<{ label: string; votes: number; correct?: boolean }> {
  if (!enabled) return [];
  const raw = Array.isArray(state.options) ? state.options : Array.isArray(state.pairs) ? state.pairs : [];
  return raw.map((entry) => {
    const o = entry as Record<string, unknown>;
    const label = String(o.label ?? o.text ?? o.name ?? o.headline ?? "");
    const votes = Number(o.votes ?? 0);
    return { label, votes, correct: o.correct === true || o.isCorrect === true };
  }).filter((o) => o.label.length > 0);
}

function scoreRows(state: Record<string, unknown>): Array<{ name: string; score: number; playerIndex: number }> {
  const raw = Array.isArray(state.scores) ? state.scores : Array.isArray(state.players) ? state.players : [];
  return raw.map((entry, i) => {
    const row = entry as Record<string, unknown>;
    return { name: String(row.name ?? `Player ${i + 1}`), score: Number(row.score ?? 0), playerIndex: i };
  });
}

function phaseCopy(phase: string): string {
  switch (phase) {
    case "writing": return "Write something worth reading.";
    case "answering": return "Answer on your phone.";
    case "invent": return "Invent something on your phone.";
    case "brief": return "Read the brief on your phone.";
    case "clue": return "The presenter is writing a clue.";
    case "drawing":
    case "draw": return "Drawing on the phones.";
    case "bluffing": return "Write a convincing lie.";
    case "twisting": return "Twist someone else's answer.";
    case "rating": return "Rate the slide on your phone.";
    case "presenting": return "Watch the presenter squirm.";
    case "voting": return "Vote for the best one.";
    case "reveal": return "Let's see what won.";
    case "finished": return "That's a wrap.";
    case "aiming": return "Aim on your phone.";
    case "moving": return "Watch the pucks fly.";
    default: return "Play on your phone.";
  }
}

function fitCanvas(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, family: string, weight: number, max: number, min: number): number {
  let size = max;
  while (size > min) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return min;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (used < words.length) lines[lines.length - 1] = ellipsize(ctx, `${lines[lines.length - 1]} …`, maxWidth);
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
