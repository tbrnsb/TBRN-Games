/** Flat two-ink box art for every existing game. */

import type { MotifId, Skin } from "./types.ts";
import { INKS } from "./theme.ts";

export function boxMotif(motif: MotifId, ink1: string, ink2: string, paper: string): string {
  const line = INKS.ink;
  switch (motif) {
    case "target":
      return `<circle cx="100" cy="70" r="44" fill="${paper}" stroke="${line}" stroke-width="4"/><circle cx="100" cy="70" r="30" fill="${ink2}"/><circle cx="100" cy="70" r="16" fill="${paper}" stroke="${line}" stroke-width="3"/><circle cx="100" cy="70" r="5" fill="${line}"/><path d="M100 70 150 26M140 26h12v12" fill="none" stroke="${ink1}" stroke-width="6" stroke-linecap="round"/>`;
    case "curtain":
      return `<path d="M22 10h156v120H22Z" fill="${paper}" stroke="${line}" stroke-width="4"/><path d="M22 10q30 30 10 120H22ZM178 10q-30 30-10 120h10Z" fill="${ink1}" stroke="${line}" stroke-width="3"/><path d="M45 120q55 18 110 0" fill="none" stroke="${ink2}" stroke-width="6"/><path d="m100 42 8 16 18 2-13 12 4 18-17-9-17 9 4-18-13-12 18-2Z" fill="${ink2}" stroke="${line}" stroke-width="3"/>`;
    case "dartboard":
      return `<circle cx="100" cy="70" r="48" fill="${paper}" stroke="${line}" stroke-width="4"/><circle cx="100" cy="70" r="36" fill="${ink2}"/><circle cx="100" cy="70" r="24" fill="${paper}"/><circle cx="100" cy="70" r="12" fill="${ink1}"/><path d="M100 22v96M52 70h96M66 36l68 68M134 36l-68 68" stroke="${paper}" stroke-width="3"/><path d="M135 35 170 12" stroke="${ink1}" stroke-width="6" stroke-linecap="round"/>`;
    case "flag":
      return `<path d="M54 120V18" stroke="${line}" stroke-width="5" stroke-linecap="round"/><path d="M56 20h76l-13 22 13 22H56Z" fill="${ink1}" stroke="${line}" stroke-width="3"/><ellipse cx="118" cy="120" rx="36" ry="10" fill="${ink2}" stroke="${line}" stroke-width="3"/><circle cx="118" cy="114" r="5" fill="${paper}"/>`;
    case "planet":
      return `<circle cx="100" cy="70" r="38" fill="${ink1}" stroke="${line}" stroke-width="4"/><path d="M42 78q58 26 116-14" fill="none" stroke="${ink2}" stroke-width="12"/><circle cx="87" cy="57" r="6" fill="${paper}"/><circle cx="112" cy="82" r="4" fill="${paper}"/><path d="m154 26 3 10 10 3-10 3-3 10-3-10-10-3 10-3ZM34 32l2 7 7 2-7 2-2 7-2-7-7-2 7-2Z" fill="${ink2}"/>`;
    case "magnifier":
      return `<circle cx="88" cy="58" r="38" fill="${paper}" stroke="${line}" stroke-width="7"/><path d="m118 88 42 38" stroke="${ink1}" stroke-width="12" stroke-linecap="round"/><circle cx="88" cy="58" r="27" fill="${ink2}" opacity=".45"/><path d="M64 72q24 18 48 0" fill="none" stroke="${line}" stroke-width="4"/>`;
    case "gallows":
      return `<path d="M40 122h100M64 122V20h66v20" fill="none" stroke="${line}" stroke-width="6" stroke-linecap="round"/><path d="M130 40v20" stroke="${ink2}" stroke-width="4"/><circle cx="130" cy="68" r="12" fill="${paper}" stroke="${line}" stroke-width="4"/><path d="M130 80v26M118 88h24M130 106l-12 16M130 106l12 16" stroke="${line}" stroke-width="4" stroke-linecap="round"/>`;
    case "knife":
      return `<circle cx="100" cy="70" r="48" fill="${ink2}" stroke="${line}" stroke-width="4"/><circle cx="100" cy="70" r="34" fill="${paper}" stroke="${line}" stroke-width="3"/><circle cx="100" cy="70" r="8" fill="${line}"/><path d="m132 26 18-18 10 10-18 18Z" fill="${ink1}" stroke="${line}" stroke-width="3"/><path d="m132 26 15 15" stroke="${line}" stroke-width="4"/>`;
    case "yearbook":
      return `<rect x="36" y="14" width="128" height="112" rx="3" fill="${paper}" stroke="${line}" stroke-width="4"/><rect x="50" y="28" width="44" height="54" fill="${ink2}" stroke="${line}" stroke-width="2"/><circle cx="72" cy="49" r="13" fill="${paper}" stroke="${line}" stroke-width="2"/><path d="M58 76q14-16 28 0" fill="${paper}" stroke="${line}" stroke-width="2"/><path d="M106 38h42M106 50h42M106 62h34M50 96h98M50 108h70" stroke="${ink1}" stroke-width="4"/>`;
    case "cards":
      return `<rect x="52" y="24" width="62" height="88" rx="5" fill="${paper}" stroke="${line}" stroke-width="4" transform="rotate(-8 83 68)"/><rect x="92" y="24" width="62" height="88" rx="5" fill="${paper}" stroke="${line}" stroke-width="4" transform="rotate(7 123 68)"/><path d="M123 55c-9-11-24 4 0 26 24-22 9-37 0-26Z" fill="${ink1}" stroke="${line}" stroke-width="2"/><path d="M83 56h14M90 49v14" stroke="${ink2}" stroke-width="5" stroke-linecap="round"/>`;
    case "tv":
      return `<rect x="24" y="34" width="152" height="90" rx="8" fill="${paper}" stroke="${line}" stroke-width="5"/><rect x="38" y="48" width="104" height="62" rx="4" fill="${ink2}" stroke="${line}" stroke-width="3"/><path d="m74 30-18-18M126 30l18-18" stroke="${line}" stroke-width="4" stroke-linecap="round"/><circle cx="158" cy="62" r="6" fill="${ink1}" stroke="${line}" stroke-width="2"/><circle cx="158" cy="82" r="6" fill="${ink1}" stroke="${line}" stroke-width="2"/><path d="m80 66 12 12 26-26" fill="none" stroke="${paper}" stroke-width="6" stroke-linecap="round"/>`;
    case "checker":
      return `<path d="M36 120V18" stroke="${line}" stroke-width="5"/><path d="M38 20h100v72H38Z" fill="${paper}" stroke="${line}" stroke-width="3"/>${[0, 1, 2].flatMap((y) => [0, 1, 2, 3].map((x) => ((x + y) % 2 === 0 ? `<rect x="${42 + x * 24}" y="${24 + y * 24}" width="24" height="24" fill="${ink1}"/>` : ""))).join("")}<path d="M36 54h-16M36 82h-16M36 108h-16" stroke="${ink2}" stroke-width="4"/>`;
    case "ship":
      return `<path d="M30 92h140l-22 26H52Z" fill="${ink1}" stroke="${line}" stroke-width="4"/><path d="M100 18v74M100 24l42 50h-42Z" fill="${ink2}" stroke="${line}" stroke-width="3"/><path d="M20 126q20-12 40 0t40 0 40 0 40 0" fill="none" stroke="${ink2}" stroke-width="5"/>`;
    case "track":
      return `<path d="M52 100c-28-34 8-72 48-72s76 38 48 72c-20 24-76 24-96 0Z" fill="none" stroke="${line}" stroke-width="18"/><path d="M52 100c-28-34 8-72 48-72s76 38 48 72c-20 24-76 24-96 0Z" fill="none" stroke="${ink2}" stroke-width="10"/><rect x="88" y="70" width="30" height="16" rx="4" fill="${ink1}" stroke="${line}" stroke-width="3"/><circle cx="95" cy="88" r="6" fill="${line}"/><circle cx="112" cy="88" r="6" fill="${line}"/>`;
    case "snake":
      return `<path d="M34 100q28-40 56 0t56 0 20-42" fill="none" stroke="${ink1}" stroke-width="16" stroke-linecap="round"/><path d="M34 100q28-40 56 0t56 0 20-42" fill="none" stroke="${line}" stroke-width="4" stroke-dasharray="4 22"/><circle cx="166" cy="56" r="10" fill="${ink1}" stroke="${line}" stroke-width="3"/><circle cx="162" cy="53" r="2.5" fill="${paper}"/><circle cx="78" cy="46" r="7" fill="${ink2}" stroke="${line}" stroke-width="2"/>`;
    case "top":
      return `<path d="M100 22 138 92H62Z" fill="${ink1}" stroke="${line}" stroke-width="4"/><ellipse cx="100" cy="96" rx="44" ry="14" fill="${ink2}" stroke="${line}" stroke-width="4"/><path d="M100 110v20" stroke="${line}" stroke-width="5"/><path d="M68 46q32 16 64 0" fill="none" stroke="${ink2}" stroke-width="5"/>`;
    case "car":
      return `<path d="M34 96h132l-14-30H58Z" fill="${ink1}" stroke="${line}" stroke-width="4"/><rect x="66" y="52" width="66" height="18" rx="4" fill="${ink2}" stroke="${line}" stroke-width="3"/><circle cx="66" cy="104" r="14" fill="${paper}" stroke="${line}" stroke-width="5"/><circle cx="136" cy="104" r="14" fill="${paper}" stroke="${line}" stroke-width="5"/><path d="M28 120h144" stroke="${line}" stroke-width="4" stroke-dasharray="10 7"/>`;
    case "note":
      return `<path d="M42 22h116v96l-26 18H42Z" fill="${ink2}" stroke="${line}" stroke-width="4"/><path d="M132 118v18l26-18" fill="${paper}" stroke="${line}" stroke-width="3"/><path d="M58 46h82M58 64h70M58 82h78M58 100h44" stroke="${ink1}" stroke-width="5" stroke-linecap="round"/><path d="m120 96 18 18" stroke="${line}" stroke-width="6" stroke-linecap="round"/>`;
    default:
      return "";
  }
}

export function boxArt(skin: Skin): string {
  return `<svg class="box-art-svg" viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${boxMotif(
    skin.motif,
    INKS[skin.inks[0]],
    INKS[skin.inks[1]],
    "#F4EBD9",
  )}</svg>`;
}
