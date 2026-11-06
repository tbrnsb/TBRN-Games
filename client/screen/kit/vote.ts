/**
 * Canvas vote list / grid.
 *
 * Shared by the generic screen fallback and by any game renderer that wants
 * the platform voting layout: letter badges, readable type and an optional
 * selected-option highlight. Layout thresholds live in
 * `shared/vote-options.ts` so the phone controller and the TV cannot disagree.
 */

import { colors, fonts, radius, scaledSize } from "./theme.ts";
import { clamp, drawRoundRect, hexToRgba, wrapText } from "./utils.ts";
import { voteLayout } from "../../../shared/vote-options.ts";

export interface VoteOption {
  id: string;
  label: string;
  /** Vote count, when the phase is allowed to show one. */
  votes?: number;
  /** Server-side selected flag; `selectedId` also works. */
  selected?: boolean;
}

export interface VoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VoteDrawOptions {
  /** Option id to highlight as the current selection. */
  selectedId?: string | null;
  /** Viewport scale from `scaleForViewport`; defaults to 1 (1080p). */
  scale?: number;
  accent?: string;
  /** Draw the numeric tally on the right of each option. */
  showVoteCounts?: boolean;
  /** Force at least this many columns (composed-text reveals split at six). */
  minColumns?: 1 | 2;
  emptyLabel?: string;
}

/**
 * Draw a voting list. One column for 1-6 options, two columns with letter
 * badges for 7+. The caller owns the background; this helper only paints the
 * option cards inside `rect` and restores every canvas field it changes.
 */
export function drawVoteOptions(
  ctx: CanvasRenderingContext2D,
  rect: VoteRect,
  options: VoteOption[],
  opts: VoteDrawOptions = {},
): void {
  const {
    selectedId = null,
    scale = 1,
    accent = colors.magenta,
    showVoteCounts = false,
    minColumns,
    emptyLabel = "No options yet",
  } = opts;

  ctx.save();
  try {
    if (options.length === 0) {
      ctx.fillStyle = colors.textMuted;
      ctx.font = `500 ${scaledSize(20, scale)}px ${fonts.body.family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emptyLabel, rect.x + rect.width / 2, rect.y + rect.height / 2);
      return;
    }

    const layout = voteLayout(options.length, { minColumns });
    const gap = scaledSize(14, scale);
    const columns = layout.columns;
    const rows = Math.max(1, Math.ceil(options.length / columns));
    const cellWidth = Math.max(1, (rect.width - gap * (columns - 1)) / columns);
    const cellHeight = Math.max(1, (rect.height - gap * (rows - 1)) / rows);

    const minFont = scaledSize(layout.minFontPx, scale);
    const maxFont = scaledSize(layout.maxFontPx, scale);
    const fontPx = clamp(Math.round(cellHeight * 0.32), minFont, maxFont);

    const padding = scaledSize(16, scale);
    const textGap = scaledSize(14, scale);
    const badgeSize = Math.max(
      scaledSize(26, scale),
      Math.min(cellHeight * 0.46, cellWidth * 0.24, scaledSize(56, scale)),
    );
    const countSpace = showVoteCounts ? scaledSize(58, scale) : 0;
    const textMax = Math.max(
      scaledSize(24, scale),
      cellWidth - padding * 2 - badgeSize - textGap - countSpace,
    );

    options.forEach((option, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = rect.x + column * (cellWidth + gap);
      const y = rect.y + row * (cellHeight + gap);
      const selected = option.selected === true || (selectedId !== null && option.id === selectedId);

      drawRoundRect(
        ctx,
        x,
        y,
        cellWidth,
        cellHeight,
        scaledSize(radius.card, scale),
        selected ? hexToRgba(accent, 0.16) : "rgba(17,13,42,0.86)",
        selected ? accent : colors.border,
        selected ? Math.max(2, scaledSize(2, scale)) : 1,
      );

      // Letter badge. Same letters as the phone controller.
      const badgeX = x + padding;
      const badgeY = y + (cellHeight - badgeSize) / 2;
      drawRoundRect(
        ctx,
        badgeX,
        badgeY,
        badgeSize,
        badgeSize,
        scaledSize(radius.chip, scale),
        selected ? accent : "rgba(255,255,255,0.10)",
        selected ? accent : "rgba(255,255,255,0.16)",
        1,
      );
      ctx.fillStyle = selected ? colors.bg0 : accent;
      ctx.font = `700 ${Math.max(scaledSize(11, scale), Math.round(badgeSize * 0.46))}px ${fonts.display.family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(layout.letters[index] ?? "", badgeX + badgeSize / 2, badgeY + badgeSize / 2 + 1);

      // Option text, vertically centred. Long answers get up to three lines;
      // the card clips at the edge rather than overlapping its neighbours.
      ctx.font = `600 ${fontPx}px ${fonts.display.family}`;
      ctx.fillStyle = colors.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const lines = wrapText(ctx, option.label, textMax).slice(0, 3);
      const lineHeight = fontPx * 1.12;
      const blockHeight = lines.length * lineHeight;
      const startY = y + cellHeight / 2 - blockHeight / 2 + lineHeight / 2;
      lines.forEach((line, lineIndex) => {
        ctx.fillText(line, badgeX + badgeSize + textGap, startY + lineIndex * lineHeight);
      });

      if (showVoteCounts && typeof option.votes === "number") {
        ctx.font = `700 ${Math.max(scaledSize(14, scale), Math.round(fontPx * 0.62))}px ${fonts.display.family}`;
        ctx.fillStyle = selected ? accent : colors.textMuted;
        ctx.textAlign = "right";
        ctx.fillText(
          String(option.votes),
          x + cellWidth - padding,
          y + cellHeight / 2,
        );
      }
    });
  } finally {
    ctx.restore();
  }
}
