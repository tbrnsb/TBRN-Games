/** Four paper-cut player tokens, deterministic faces, one per seat. */

import { INKS, PLAYERS } from "./theme.ts";

export type TokenState = "idle" | "thinking" | "sent" | "winner" | "sleeping";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function shape(index: number): string {
  switch (index % 4) {
    case 0:
      return `<path d="M60 14c25 0 43 20 41 45-2 30-19 46-42 46S18 87 18 59C18 33 36 14 60 14Z"/>`;
    case 1:
      return `<path d="M61 14 106 96c3 6-1 11-8 11H22c-7 0-11-5-8-11Z"/>`;
    case 2:
      return `<path d="M28 20h64c5 0 8 3 8 8v62c0 5-3 8-8 8H28c-5 0-8-3-8-8V28c0-5 3-8 8-8Z"/>`;
    default:
      return `<path d="m60 12 12 28 31 3-23 21 7 31-27-16-27 16 7-31-23-21 31-3Z"/>`;
  }
}

function eyes(variant: number): string {
  const ink = INKS.ink;
  switch (variant % 6) {
    case 0:
      return `<circle cx="46" cy="54" r="7" fill="${ink}"/><circle cx="74" cy="54" r="7" fill="${ink}"/>`;
    case 1:
      return `<circle cx="46" cy="54" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/><circle cx="47" cy="55" r="4.5" fill="${ink}"/><circle cx="74" cy="54" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/><circle cx="75" cy="55" r="4.5" fill="${ink}"/>`;
    case 2:
      return `<path d="M38 54q8-8 16 0M66 54q8-8 16 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    case 3:
      return `<path d="m39 47 14 14M53 47 39 61M67 47l14 14M81 47 67 61" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    case 4:
      return `<circle cx="48" cy="54" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/><circle cx="48" cy="54" r="4" fill="${ink}"/><path d="M66 54h16" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    default:
      return `<ellipse cx="46" cy="54" rx="8" ry="6" fill="${ink}"/><ellipse cx="74" cy="54" rx="8" ry="6" fill="${ink}"/><circle cx="48" cy="52" r="2" fill="#fff"/><circle cx="76" cy="52" r="2" fill="#fff"/>`;
  }
}

function mouth(variant: number): string {
  const ink = INKS.ink;
  switch (variant % 6) {
    case 0:
      return `<path d="M46 78q14 12 28 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    case 1:
      return `<path d="M47 81h26" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    case 2:
      return `<ellipse cx="60" cy="82" rx="8" ry="10" fill="${ink}"/>`;
    case 3:
      return `<path d="M45 81q7-7 14 0t14 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
    case 4:
      return `<path d="M43 77q17 17 34 0Z" fill="${ink}"/>`;
    default:
      return `<path d="M46 85q14-12 28 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
  }
}

function shorten(name: string): string {
  return name.length > 11 ? `${name.slice(0, 10)}…` : name;
}

export function tokenMarkup(index: number, name: string, seed = name): string {
  const player = PLAYERS[index % PLAYERS.length];
  const h = hash(seed);
  const tag = shorten(name);
  return `<svg class="token-svg" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g transform="translate(5 5)" fill="${INKS.ink}" opacity=".9">${shape(index)}</g>
    <g fill="${player.hex}" stroke="${INKS.ink}" stroke-width="4" stroke-linejoin="round">${shape(index)}</g>
    ${eyes(h % 6)}
    ${mouth((h >> 4) % 6)}
    <g class="token-tag" transform="translate(10 104) rotate(-2)">
      <rect width="100" height="27" rx="2" fill="#F4EBD9" stroke="${INKS.ink}" stroke-width="2"/>
      <text x="50" y="19" text-anchor="middle" font-family="Permanent Marker, cursive" font-size="14" fill="${INKS.ink}" ${tag.length > 8 ? 'textLength="88" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeXml(tag)}</text>
    </g>
  </svg>`;
}

export function createToken(index: number, name: string, state: TokenState = "idle", seed = name): HTMLElement {
  const el = document.createElement("div");
  el.className = "player-token";
  el.dataset.player = String(index);
  el.dataset.state = state;
  el.innerHTML = tokenMarkup(index, name, seed);
  el.title = name;
  return el;
}

export function setTokenState(el: HTMLElement, state: TokenState) {
  el.dataset.state = state;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
