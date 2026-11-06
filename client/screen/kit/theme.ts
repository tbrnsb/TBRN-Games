/**
 * Legacy canvas theme, now paper-and-ink.
 *
 * The old renderers still call these tokens; `setLegacySkin()` swaps the paper,
 * two inks and display font to the active game skin before each frame. No
 * gradients, glow or soft shadows live here.
 */


import { INKS, PAPERS, PLAYERS, TYPE } from "../../kit/theme.ts";
import type { Skin } from "../../kit/types.ts";
import { theme as sharedTheme } from "../../../shared/theme.ts";


export const colors = {
  bg0: PAPERS.cream.hex,
  bg1: PAPERS.newsprint.hex,
  surface: "#FFFDF5",
  surfaceHi: "#F4EBD9",
  border: INKS.ink,
  text: INKS.ink,
  textMuted: "#5B5448",
  cardText: "#1D1B26",
  cardMuted: "#5B5448",
  magenta: INKS.tomato,
  cyan: INKS.teal,
  violet: INKS.grape,
  amber: INKS.sun,
  success: INKS.grass,
  danger: INKS.tomato,
  paperTexture: PAPERS.cream.texture,
  player: [...sharedTheme.colors.player] as string[],

  gradient: {
    bgStart: PAPERS.cream.hex,
    bgEnd: PAPERS.cream.hex,
    gridLine: "rgba(29,27,38,0.12)",
    sunStart: INKS.sun,
    sunEnd: INKS.tomato,
  },
};

export const fonts = {
  display: {
    family: TYPE.display as string,
    weights: { medium: 700, bold: 800 },
  },
  body: {
    family: TYPE.body as string,
    weights: { regular: 400, medium: 700, semibold: 700 },
  },
  title: {
    family: '"Bricolage Grotesque", sans-serif' as string,
    weights: { bold: 800 },
  },
  minSize: { body: 28, label: 22, score: 64, title: 96 },
};

export const spacing = [4, 8, 12, 16, 24, 32, 48] as const;

export const radius = { card: 7, chip: 4, pill: 999 } as const;
export const bento = { columns: 12, gap: 20, outerMargin: 44 } as const;

export const glow = {
  cardActive: () => `4px 4px 0 ${INKS.ink}`,
  textLayers: 0,
  maxCompeting: 0,
} as const;

export const motion = {
  enter: { duration: 280, easing: "easeOutCubic" },
  pop: { duration: 320, easing: "easeOutBack" },
  stagger: 50,
  shake: { maxOffset: 6, decayMs: 200 },
  reducedMotion: false,
} as const;

export const viewport = { designWidth: 1920, designHeight: 1080, minWidth: 1280, minHeight: 720 } as const;

export function getPlayerColor(index: number): string {
  return colors.player[index % colors.player.length];
}

export function scaleForViewport(width: number, height: number): number {
  const scaleX = width / viewport.designWidth;
  const scaleY = height / viewport.designHeight;
  return Math.min(scaleX, scaleY);
}

export function scaledSize(base: number, scale: number): number {
  return Math.max(1, Math.round(base * scale));
}

export function tabularFigures(ctx: CanvasRenderingContext2D): void {
  ctx.font = ctx.font.replace(/^(\d+px)/, "tabular-nums $1");
}

/** Swap the legacy tokens to the current game's printed skin. */
export function setLegacySkin(skin: Skin): void {
  if (typeof window !== "undefined") (window as unknown as { __paperSkin?: string }).__paperSkin = skin.id;
  const paper = PAPERS[skin.paper];
  colors.bg0 = paper.hex;
  colors.bg1 = paper.hex;
  colors.surface = "#FFFDF5";
  colors.surfaceHi = paper.hex;
  colors.border = INKS.ink;
  colors.text = paper.onPaper;
  colors.textMuted = paper.onPaper === INKS.ink ? "#5B5448" : "#E7E0CC";
  colors.magenta = INKS[skin.inks[0]];
  colors.cyan = INKS[skin.inks[1]];
  colors.violet = INKS.grape;
  colors.amber = INKS.sun;
  colors.success = INKS.grass;
  colors.danger = INKS.tomato;
  colors.paperTexture = paper.texture;
  colors.gradient = {
    bgStart: paper.hex,
    bgEnd: paper.hex,
    gridLine: "rgba(29,27,38,0.12)",
    sunStart: INKS.sun,
    sunEnd: INKS.tomato,
  };
  fonts.display.family = TYPE.display;
  fonts.body.family = TYPE.body;
  fonts.title.family = skin.fonts.display;
}

export const cssVars = {
  "--color-bg0": colors.bg0,
  "--color-bg1": colors.bg1,
  "--color-surface": colors.surface,
  "--color-surface-hi": colors.surfaceHi,
  "--color-border": colors.border,
  "--color-text": colors.text,
  "--color-text-muted": colors.textMuted,
  "--color-magenta": colors.magenta,
  "--color-cyan": colors.cyan,
  "--color-violet": colors.violet,
  "--color-amber": colors.amber,
  "--color-success": colors.success,
  "--color-danger": colors.danger,
  "--font-display": TYPE.display,
  "--font-body": TYPE.body,
  "--font-title": fonts.title.family,
  "--radius-card": `${radius.card}px`,
  "--radius-chip": `${radius.chip}px`,
  "--radius-pill": `${radius.pill}px`,
  "--spacing-unit": "4px",
  "--bento-gap": `${bento.gap}px`,
  "--bento-margin": `${bento.outerMargin}px`,
};
