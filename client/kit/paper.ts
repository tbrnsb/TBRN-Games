/** Paper surface helpers and the house skin. */

import type { Skin } from "./types.ts";
import { paperVars, TYPE } from "./theme.ts";

export const HOUSE_SKIN: Skin = {
  id: "house",
  title: "TBRN Game Night",
  vibe: "A table full of printed games",
  paper: "cream",
  inks: ["tomato", "teal"],
  fonts: { display: TYPE.display, body: TYPE.body, accent: TYPE.hand },
  props: ["tape", "pin", "coffee-ring", "star", "scribble"],
  enter: "slide-tilt",
  sound: { bank: "paper", hostPitch: 1 },
  mox: { outfit: "bowtie" },
  motif: "target",
};

export function applySkin(el: HTMLElement, skin: Skin) {
  const vars = paperVars(skin.paper, skin.inks);
  for (const [key, value] of Object.entries(vars)) el.style.setProperty(key, value);
  el.style.setProperty("--skin-display", skin.fonts.display);
  el.style.setProperty("--skin-body", skin.fonts.body);
  if (skin.fonts.accent) el.style.setProperty("--skin-accent", skin.fonts.accent);
  el.dataset.skin = skin.id;
  el.dataset.paper = skin.paper;
  el.classList.add("paper-surface");
}

export function paperCss(skin: Skin): string {
  const vars = paperVars(skin.paper, skin.inks);
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";") +
    `;--skin-display:${skin.fonts.display};--skin-body:${skin.fonts.body}` +
    (skin.fonts.accent ? `;--skin-accent:${skin.fonts.accent}` : "");
}

export function isDarkPaper(skin: Skin): boolean {
  return ["chalkboard", "blueprint", "felt", "night"].includes(skin.paper);
}
