/**
 * One title/meta treatment for every game header.
 *
 * The per-game paper and display font still come from the active skin, but the
 * size, weight and accent ink are fixed so all 22 TVs read as one printed
 * series instead of 22 unrelated posters.
 */

import { colors, fonts, scaledSize } from "./theme.ts";

/** Skin display font, 32px at 1080p, first ink. */
export function paperTitle(ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.font = `700 ${scaledSize(32, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.magenta;
}

/** Body font, 18px at 1080p, muted ink. */
export function paperMeta(ctx: CanvasRenderingContext2D, scale: number, size = 18): void {
  ctx.font = `600 ${scaledSize(size, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
}
