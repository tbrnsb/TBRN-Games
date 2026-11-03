/**
 * Title Card — countdown/intro overlay with Orbitron font
 * Large animated text for game start, round transitions, etc.
 */

import { fonts, colors, scaledSize, scaleForViewport } from "./theme.ts";
import { easeOutCubic, easeOutBack, staggerDelay } from "./easing.ts";

export interface TitleCardConfig {
  title: string;
  subtitle?: string;
  duration: number; // total display time in ms
  fadeInDuration: number;
  holdDuration: number;
  fadeOutDuration: number;
}

export interface TitleCardInputConfig {
  title: string;
  subtitle?: string;
  duration: number; // total display time in ms
  fadeInDuration?: number;
  holdDuration?: number;
  fadeOutDuration?: number;
}

export interface TitleCard {
  config: TitleCardConfig;
  state: "idle" | "fadeIn" | "hold" | "fadeOut" | "done";
  startTime: number;
  animations: {
    title: { progress: number; y: number; scale: number; alpha: number };
    subtitle: { progress: number; y: number; alpha: number };
  };
}

export function createTitleCard(config: TitleCardInputConfig): TitleCard {
  const fadeIn = config.fadeInDuration ?? 400;
  const fadeOut = config.fadeOutDuration ?? 400;
  const hold = Math.max(0, config.holdDuration ?? config.duration - fadeIn - fadeOut);

  const fullConfig: TitleCardConfig = {
    ...config,
    fadeInDuration: fadeIn,
    holdDuration: hold,
    fadeOutDuration: fadeOut,
  };

  return {
    config: fullConfig,
    state: "idle",
    startTime: 0,
    animations: {
      title: { progress: 0, y: 0, scale: 1, alpha: 0 },
      subtitle: { progress: 0, y: 0, alpha: 0 },
    },
  };
}

export function showTitleCard(card: TitleCard, now: number): void {
  card.state = "fadeIn";
  card.startTime = now;
}

export function updateTitleCard(card: TitleCard, now: number): void {
  if (card.state === "idle" || card.state === "done") return;

  const elapsed = now - card.startTime;
  const { fadeInDuration, holdDuration, fadeOutDuration } = card.config;
  const total = fadeInDuration + holdDuration + fadeOutDuration;

  if (elapsed >= total) {
    card.state = "done";
    return;
  }

  if (elapsed < fadeInDuration) {
    card.state = "fadeIn";
    const t = elapsed / fadeInDuration;
    const eased = easeOutBack(t);
    card.animations.title.progress = eased;
    card.animations.title.y = (1 - eased) * 60; // slide up from below
    card.animations.title.scale = 0.8 + 0.2 * eased;
    card.animations.title.alpha = eased;

    if (card.config.subtitle) {
      const subDelay = staggerDelay(0, 100);
      const subT = Math.max(0, (elapsed - subDelay) / fadeInDuration);
      const subEased = easeOutCubic(subT);
      card.animations.subtitle.progress = subEased;
      card.animations.subtitle.y = (1 - subEased) * 40;
      card.animations.subtitle.alpha = subEased;
    }
  } else if (elapsed < fadeInDuration + holdDuration) {
    card.state = "hold";
    card.animations.title = { progress: 1, y: 0, scale: 1, alpha: 1 };
    card.animations.subtitle = { progress: 1, y: 0, alpha: 1 };
  } else {
    card.state = "fadeOut";
    const t = (elapsed - fadeInDuration - holdDuration) / fadeOutDuration;
    const eased = easeOutCubic(1 - t); // reverse
    card.animations.title.alpha = eased;
    card.animations.subtitle.alpha = eased;
  }
}

export function drawTitleCard(ctx: CanvasRenderingContext2D, width: number, height: number, card: TitleCard): void {
  if (card.state === "idle" || card.state === "done") return;

  const scale = scaleForViewport(width, height);
  const centerX = width / 2;
  const centerY = height / 2;

  const { title, subtitle } = card.config;
  const { title: titleAnim, subtitle: subAnim } = card.animations;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Dim the playfield so the card reads clearly over the synthwave sun.
  if (titleAnim.alpha > 0) {
    ctx.fillStyle = `rgba(11,8,32,${(0.55 * titleAnim.alpha).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }

  // Title (Orbitron, huge)
  const titleSize = scaledSize(96, scale);
  ctx.font = `700 ${titleSize}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;

  // Glow effect
  if (titleAnim.alpha > 0) {
    ctx.shadowColor = colors.magenta;
    ctx.shadowBlur = 30 * titleAnim.alpha;
    ctx.globalAlpha = titleAnim.alpha;
    ctx.save();
    ctx.translate(centerX, centerY + titleAnim.y);
    ctx.scale(titleAnim.scale, titleAnim.scale);
    ctx.fillText(title, 0, 0);
    ctx.restore();
  }

  // Subtitle (Space Grotesk)
  if (subtitle && subAnim.alpha > 0) {
    const subSize = scaledSize(28, scale);
    ctx.font = `500 ${subSize}px ${fonts.display.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.shadowColor = colors.cyan;
    ctx.shadowBlur = 20 * subAnim.alpha;
    ctx.globalAlpha = subAnim.alpha;
    ctx.fillText(subtitle, centerX, centerY + titleSize * 0.7 + subAnim.y);
  }

  ctx.restore();
}

export function isTitleCardDone(card: TitleCard): boolean {
  return card.state === "done";
}

// --- Countdown Title Card (3, 2, 1, GO!) ---
export interface CountdownCard {
  numbers: number[];
  currentIndex: number;
  numberStartTime: number;
  numberDuration: number;
  state: "running" | "go" | "done";
  scale: number;
  alpha: number;
}

const GO_DURATION = 550;

export function createCountdownCard(startNumber: number = 3, numberDuration: number = 600): CountdownCard {
  const numbers = Array.from({ length: startNumber }, (_, i) => startNumber - i);
  return {
    numbers,
    currentIndex: 0,
    numberStartTime: 0,
    numberDuration,
    state: "running",
    scale: 1,
    alpha: 0,
  };
}

export function startCountdown(card: CountdownCard, now: number): void {
  card.numberStartTime = now;
  card.state = "running";
  card.scale = 0.5;
  card.alpha = 0;
}

export function updateCountdown(card: CountdownCard, now: number): void {
  if (card.state === "done") return;

  if (card.state === "go") {
    const elapsed = now - card.numberStartTime;
    const t = Math.min(1, elapsed / GO_DURATION);
    card.scale = 1 + 0.18 * easeOutCubic(t);
    card.alpha = 1 - easeOutCubic(t);
    if (t >= 1) {
      card.state = "done";
      card.alpha = 0;
    }
    return;
  }

  const elapsed = now - card.numberStartTime;
  const progress = Math.min(1, elapsed / card.numberDuration);
  const eased = easeOutBack(progress);

  card.scale = 0.5 + 0.5 * eased;
  card.alpha = eased;

  if (progress >= 1) {
    card.currentIndex++;
    if (card.currentIndex >= card.numbers.length) {
      card.state = "go";
      card.numberStartTime = now;
      card.scale = 1;
      card.alpha = 1;
    } else {
      card.numberStartTime = now;
      card.scale = 0.5;
      card.alpha = 0;
    }
  }
}

export function drawCountdown(ctx: CanvasRenderingContext2D, width: number, height: number, card: CountdownCard): void {
  if (card.state === "done" && card.alpha === 0) return;

  const scale = scaleForViewport(width, height);
  const centerX = width / 2;
  const centerY = height / 2;

  const text = card.state === "go" ? "GO!" : String(card.numbers[card.currentIndex] ?? "");

  const size = scaledSize(140, scale);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(card.scale, card.scale);
  ctx.globalAlpha = card.alpha;

  ctx.font = `700 ${size}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Glow
  ctx.shadowColor = card.state === "go" ? colors.success : colors.magenta;
  ctx.shadowBlur = 40 * card.alpha;

  ctx.fillText(text, 0, 0);
  ctx.restore();
}