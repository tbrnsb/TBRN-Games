/**
 * TBRN-Games Visual Overhaul — Design Tokens
 * Synthwave + Bento Grid + Swiss Typography
 * All values from DESIGN.md — single source of truth.
 */

import { theme as sharedTheme } from "../../../shared/theme.ts";

// --- Color Palette ---
export const colors = {
  // Base
  bg0: "#0B0820",           // page background
  bg1: "#140F33",           // panels
  surface: "#1B1545",       // bento cards
  surfaceHi: "#2A1F6B",     // raised/active cards
  border: "rgba(255,255,255,0.08)", // card edges

  // Text
  text: "#F5F3FF",          // primary text
  textMuted: "#A29BCF",     // labels, secondary

  // Accents
  magenta: "#FF2E97",       // primary accent
  cyan: "#00E5FF",          // secondary accent
  violet: "#8B5CF6",        // tertiary, gradients
  amber: "#FFB347",         // sun, warnings
  success: "#3DFFA2",       // correct, win
  danger: "#FF4D6D",        // wrong, lose

  // Player colors (always paired with number badge/shape). The eight entries
  // come straight from the shared theme so a kit-rendered scoreboard keeps the
  // same seat identity as the lobby, the ticker and every game renderer.
  player: [
    sharedTheme.colors.player[0],  // P1 magenta
    sharedTheme.colors.player[1],  // P2 cyan
    sharedTheme.colors.player[2],  // P3 amber
    sharedTheme.colors.player[3],  // P4 green
    sharedTheme.colors.player[4],  // P5 orange
    sharedTheme.colors.player[5],  // P6 violet
    sharedTheme.colors.player[6],  // P7 sky
    sharedTheme.colors.player[7],  // P8 off-white
  ],

  // Gradient stops
  gradient: {
    bgStart: "#0B0820",
    bgEnd: "#1A0B3B",
    gridLine: "rgba(255,46,151,0.15)", // magenta at 15%
    sunStart: "#FFB347",  // amber
    sunEnd: "#FF2E97",    // magenta
  },
} as const;

// --- Typography ---
export const fonts = {
  // Space Grotesk 500/700: headings, scores, names
  display: {
    family: '"Space Grotesk", sans-serif',
    weights: { medium: 500, bold: 700 },
  },
  // Inter 400/600: labels and body
  body: {
    family: '"Inter", sans-serif',
    weights: { regular: 400, medium: 500, semibold: 600 },
  },
  // Orbitron 700: ONLY logo, room code, title cards
  title: {
    family: '"Orbitron", sans-serif',
    weights: { bold: 700 },
  },

  // Minimum on-screen sizes (at 1920x1080 logical)
  // Scale down proportionally for smaller viewports
  minSize: {
    body: 28,
    label: 22,
    score: 64,
    title: 96,
  },
} as const;

// --- Spacing Scale (px) ---
export const spacing = [4, 8, 12, 16, 24, 32, 48] as const;

// --- Border Radius ---
export const radius = {
  card: 16,
  chip: 10,
  pill: 999,
} as const;

// --- Bento Grid ---
export const bento = {
  columns: 12,
  gap: 24,
  outerMargin: 48,
} as const;

// --- Glow & Depth ---
export const glow = {
  cardActive: (accent: string) => `0 0 24px ${accent}4D`, // 30% alpha
  textLayers: 2, // max glow layers on text
  maxCompeting: 3, // max glowing elements at once
} as const;

// --- Motion ---
export const motion = {
  enter: { duration: 240, easing: "easeOutCubic" },
  pop: { duration: 320, easing: "easeOutBack" },
  stagger: 40,
  shake: { maxOffset: 6, decayMs: 250 },
  reducedMotion: false, // set from prefers-reduced-motion
} as const;

// --- Viewport ---
export const viewport = {
  designWidth: 1920,
  designHeight: 1080,
  minWidth: 1280,
  minHeight: 720,
} as const;

// --- Helpers ---
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

// CSS custom properties for HTML/CSS layers (if needed)
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
  "--font-display": fonts.display.family,
  "--font-body": fonts.body.family,
  "--font-title": fonts.title.family,
  "--radius-card": `${radius.card}px`,
  "--radius-chip": `${radius.chip}px`,
  "--radius-pill": `${radius.pill}px`,
  "--spacing-unit": "4px",
  "--bento-gap": `${bento.gap}px`,
  "--bento-margin": `${bento.outerMargin}px`,
} as const;