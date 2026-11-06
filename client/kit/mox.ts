/**
 * Mox, the cut-paper host. One SVG character with seven expressions, a few
 * outfits, a typed caption banner and zero TTS: each typed character gets a
 * pitched blip from the shared sound manager.
 */

import { INKS } from "./theme.ts";
import { sound } from "./sound.ts";
import type { MoxOutfit } from "./types.ts";

export type MoxExpression = "idle" | "talk" | "gasp" | "laugh" | "smug" | "sad" | "celebrate";

export interface MoxHandle {
  say(text: string, options?: { holdMs?: number; expression?: MoxExpression }): void;
  setExpression(expression: MoxExpression): void;
  setOutfit(outfit: MoxOutfit): void;
  destroy(): void;
}

export type MoxElement = HTMLElement & { mox: MoxHandle };

const MOUTHS: Record<MoxExpression, string> = {
  idle: "M96 132q18 12 36 0",
  talk: "M98 132q16 20 32 0Z",
  gasp: "M100 132q14-12 28 0q-14 22-28 0Z",
  laugh: "M94 130q20 28 40 0Z",
  smug: "M96 136q20-10 38 2",
  sad: "M96 140q18-12 36 0",
  celebrate: "M94 128q20 30 42 0Z",
};

const BROWS: Record<MoxExpression, string> = {
  idle: "M104 96q10-5 20 0",
  talk: "M104 94q10-7 20 0",
  gasp: "M102 88q12-12 24-2",
  laugh: "M104 94q10-8 20 0",
  smug: "M104 96q10-2 20-7",
  sad: "M104 99q10 6 20 1",
  celebrate: "M102 90q12-10 24 0",
};

function outfitMarkup(outfit: MoxOutfit): string {
  switch (outfit) {
    case "tophat":
      return `<g class="mox-outfit" data-outfit="tophat"><path d="M74 72h92l-8-42H82Z" fill="${INKS.ink}" stroke="${INKS.ink}" stroke-width="4"/><rect x="64" y="70" width="112" height="10" rx="3" fill="${INKS.ink}"/><rect x="82" y="40" width="76" height="8" fill="var(--ink-1)"/></g>`;
    case "bowtie":
      return `<g class="mox-outfit" data-outfit="bowtie"><path d="m104 158 16 10 16-10v22l-16-10-16 10Z" fill="var(--ink-2)" stroke="${INKS.ink}" stroke-width="3"/><circle cx="120" cy="169" r="5" fill="${INKS.ink}"/></g>`;
    case "sunglasses":
      return `<g class="mox-outfit" data-outfit="sunglasses"><rect x="82" y="104" width="32" height="19" rx="5" fill="${INKS.ink}"/><rect x="126" y="104" width="32" height="19" rx="5" fill="${INKS.ink}"/><path d="M114 112h12" stroke="${INKS.ink}" stroke-width="4"/></g>`;
    case "detective":
      return `<g class="mox-outfit" data-outfit="detective"><path d="M72 82h96l-10-22H82Z" fill="var(--ink-1)" stroke="${INKS.ink}" stroke-width="3"/><rect x="60" y="80" width="120" height="9" rx="3" fill="${INKS.ink}"/><path d="M88 160h64l10 26H78Z" fill="var(--ink-1)" stroke="${INKS.ink}" stroke-width="3"/></g>`;
    case "chef":
      return `<g class="mox-outfit" data-outfit="chef"><path d="M78 58q-4-24 18-24 4-18 24-8 16-10 24 8 20 2 14 24Z" fill="#F4EBD9" stroke="${INKS.ink}" stroke-width="3"/><rect x="82" y="56" width="76" height="13" fill="#F4EBD9" stroke="${INKS.ink}" stroke-width="3"/></g>`;
    case "party":
      return `<g class="mox-outfit" data-outfit="party"><path d="M120 18 92 68h56Z" fill="var(--ink-1)" stroke="${INKS.ink}" stroke-width="3"/><circle cx="120" cy="16" r="8" fill="var(--ink-2)" stroke="${INKS.ink}" stroke-width="3"/><path d="m104 54 32-12" stroke="var(--ink-2)" stroke-width="5"/></g>`;
    default:
      return "";
  }
}

export function createMox(options: { outfit?: MoxOutfit; pitch?: number; bank?: string } = {}): MoxElement {
  const root = document.createElement("div");
  root.className = "mox";
  root.dataset.expression = "idle";
  root.dataset.outfit = options.outfit ?? "bowtie";
  root.innerHTML = `
    <div class="mox-figure">
      <svg viewBox="0 0 240 230" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g transform="translate(6 7)" fill="${INKS.ink}" opacity=".85">
          <path d="M120 48c42 0 72 30 68 70-4 40-28 60-68 60s-64-20-68-60c-4-40 26-70 68-70Z"/>
        </g>
        <path d="M120 48c42 0 72 30 68 70-4 40-28 60-68 60s-64-20-68-60c-4-40 26-70 68-70Z" fill="#F4EBD9" stroke="${INKS.ink}" stroke-width="6"/>
        <path d="M82 150q38 30 76 0v30q-38 20-76 0Z" fill="var(--ink-1)" stroke="${INKS.ink}" stroke-width="4"/>
        <ellipse cx="120" cy="110" rx="47" ry="45" fill="#F4EBD9" stroke="${INKS.ink}" stroke-width="4"/>
        <g class="mox-eyes">
          <circle cx="102" cy="108" r="8" fill="${INKS.ink}"/><circle cx="138" cy="108" r="8" fill="${INKS.ink}"/>
          <circle cx="104" cy="105" r="2.5" fill="#fff"/><circle cx="140" cy="105" r="2.5" fill="#fff"/>
        </g>
        <path class="mox-brow" d="${BROWS.idle}" fill="none" stroke="${INKS.ink}" stroke-width="4" stroke-linecap="round"/>
        <path class="mox-mouth" d="${MOUTHS.idle}" fill="${INKS.ink}" stroke="${INKS.ink}" stroke-width="3" stroke-linejoin="round"/>
        ${outfitMarkup(root.dataset.outfit as MoxOutfit)}
        <g class="mox-hand">
          <path d="M58 150q-18 10-22 28" fill="none" stroke="${INKS.ink}" stroke-width="13" stroke-linecap="round"/>
          <circle cx="34" cy="182" r="12" fill="#F4EBD9" stroke="${INKS.ink}" stroke-width="4"/>
        </g>
        <g class="mox-prop">
          <path d="M182 146 218 128l-8 28-32 10Z" fill="var(--ink-2)" stroke="${INKS.ink}" stroke-width="4"/>
          <path d="M180 154 168 166" stroke="${INKS.ink}" stroke-width="6" stroke-linecap="round"/>
        </g>
      </svg>
    </div>
    <div class="mox-caption" role="status" aria-live="polite"><span class="mox-text"></span></div>
  `;
  const mox = new Mox(root, options.pitch ?? 1, options.outfit ?? "bowtie", options.bank ?? "");
  const el = root as unknown as MoxElement;
  el.mox = mox;
  return el;
}

class Mox implements MoxHandle {
  private root: HTMLElement;
  private pitch: number;
  private outfit: MoxOutfit;
  private bank: string;
  private textEl: HTMLElement;
  private captionEl: HTMLElement;
  private typeToken = 0;
  private hideTimer = 0;

  constructor(root: HTMLElement, pitch: number, outfit: MoxOutfit, bank: string) {
    this.root = root;
    this.pitch = pitch;
    this.outfit = outfit;
    this.bank = bank;
    this.textEl = root.querySelector(".mox-text")!;
    this.captionEl = root.querySelector(".mox-caption")!;
  }

  setOutfit(outfit: MoxOutfit) {
    if (outfit === this.outfit) return;
    this.outfit = outfit;
    this.root.dataset.outfit = outfit;
    const current = this.root.querySelector(".mox-outfit");
    current?.remove();
    const g = this.root.querySelector(".mox-figure svg");
    if (g) {
      const svg = g as SVGSVGElement;
      const markup = outfitMarkup(outfit);
      if (markup) svg.insertAdjacentHTML("beforeend", markup);
    }
  }

  setExpression(expression: MoxExpression) {
    this.root.dataset.expression = expression;
    const mouth = this.root.querySelector(".mox-mouth");
    const brow = this.root.querySelector(".mox-brow");
    if (mouth) mouth.setAttribute("d", MOUTHS[expression]);
    if (brow) brow.setAttribute("d", BROWS[expression]);
  }

  say(text: string, options: { holdMs?: number; expression?: MoxExpression } = {}) {
    window.clearTimeout(this.hideTimer);
    const token = ++this.typeToken;
    this.captionEl.classList.add("visible");
    this.textEl.textContent = "";
    this.setExpression(options.expression ?? "talk");
    const chars = [...text];
    let i = 0;
    const step = () => {
      if (token !== this.typeToken) return;
      if (i >= chars.length) {
        this.setExpression(options.expression ?? "idle");
        this.hideTimer = window.setTimeout(() => this.captionEl.classList.remove("visible"), options.holdMs ?? 4800);
        return;
      }
      this.textEl.textContent += chars[i++];
      if (i % 2 === 0) {
        sound.hostBlip(this.pitch, this.bank);
        this.setExpression(i % 4 === 0 ? "talk" : "idle");
      }
      window.setTimeout(step, 38);
    };
    step();
  }

  destroy() {
    this.typeToken++;
    window.clearTimeout(this.hideTimer);
  }
}
