/** Global paper, ink, type, spacing and motion tokens for DESIGN.md v2. */

import type { InkId, PaperId } from "./types.ts";

export const INKS: Record<InkId, string> = {
  bubblegum: "#FF5BA7",
  tomato: "#F0453A",
  tangerine: "#FF8A1F",
  sun: "#FFC21A",
  grass: "#2FB56A",
  teal: "#0E8C8C",
  sky: "#3AA7E8",
  cobalt: "#2447C8",
  grape: "#7A4FD0",
  ink: "#1D1B26",
};

export const PAPERS: Record<PaperId, { hex: string; onPaper: string; texture: string }> = {
  cream: { hex: "#F4EBD9", onPaper: "#1D1B26", texture: "/assets/paper/cream.webp" },
  newsprint: { hex: "#E7E0CC", onPaper: "#1D1B26", texture: "/assets/paper/newsprint.webp" },
  kraft: { hex: "#C8A26B", onPaper: "#1D1B26", texture: "/assets/paper/kraft.webp" },
  butter: { hex: "#FBE7A1", onPaper: "#1D1B26", texture: "/assets/paper/butter.webp" },
  mint: { hex: "#D9F0E8", onPaper: "#1D1B26", texture: "/assets/paper/mint.webp" },
  "pale-pink": { hex: "#FBD9E3", onPaper: "#1D1B26", texture: "/assets/paper/pale-pink.webp" },
  chalkboard: { hex: "#2C4A3E", onPaper: "#F4EBD9", texture: "/assets/paper/chalkboard.webp" },
  blueprint: { hex: "#1F4E9C", onPaper: "#F4EBD9", texture: "/assets/paper/blueprint.webp" },
  felt: { hex: "#0F5C3F", onPaper: "#F4EBD9", texture: "/assets/paper/felt.webp" },
  night: { hex: "#1E1B3A", onPaper: "#F4EBD9", texture: "/assets/paper/night.webp" },
};

export const PLAYERS = [
  { name: "Bubblegum", hex: "#FF5BA7", shape: "blob" },
  { name: "Sun", hex: "#FFC21A", shape: "triangle" },
  { name: "Teal", hex: "#0E8C8C", shape: "square" },
  { name: "Sky", hex: "#3AA7E8", shape: "star" },
] as const;

export const TYPE = {
  display: '"Bricolage Grotesque", "Arial Black", sans-serif',
  body: '"Atkinson Hyperlegible", "Trebuchet MS", sans-serif',
  hand: '"Permanent Marker", "Comic Sans MS", cursive',
  min: { body: 28, label: 22, score: 72, title: 110 },
} as const;

export const SPACE = [4, 8, 12, 16, 24, 32, 48, 64] as const;
export const RADIUS = { card: 7, chip: 4, sticker: 999 } as const;
export const SHADOW = {
  small: `4px 4px 0 ${INKS.ink}`,
  large: `8px 8px 0 ${INKS.ink}`,
} as const;
export const MOTION = {
  enter: 280,
  pop: 320,
  stamp: 120,
  stagger: 50,
  wobble: 1.5,
  shake: 6,
} as const;

export const GRAIN = "/assets/paper/grain.webp";

export function paperVars(paper: PaperId, inks: [InkId, InkId]) {
  const p = PAPERS[paper];
  return {
    "--paper": p.hex,
    "--paper-ink": p.onPaper,
    "--paper-texture": `url("${p.texture}")`,
    "--ink-1": INKS[inks[0]],
    "--ink-2": INKS[inks[1]],
    "--ink": INKS.ink,
  } as Record<string, string>;
}

export function ink(index: 0 | 1) {
  return index === 0 ? "var(--ink-1)" : "var(--ink-2)";
}
