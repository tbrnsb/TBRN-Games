/** The shelf of game boxes. */

import type { Skin } from "./types.ts";
import { boxArt } from "./boxArt.ts";
import { applySkin, HOUSE_SKIN } from "./paper.ts";
import { skinFor } from "../skins/index.ts";
import { prop } from "./props.ts";

export interface ShelfGame {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface ShelfOptions {
  selectedId?: string | null;
  playerCount: number;
  /**
   * Reason the box cannot be picked at the current table, or null when it can.
   * Defaults to the plain minimum-player check so the shelf also works without
   * the expanded catalog rules.
   */
  unavailable?: (game: ShelfGame) => string | null;
  onSelect: (id: string) => void;
}

function skinOf(id: string): Skin {
  return skinFor(id) ?? HOUSE_SKIN;
}

export function createGameBox(game: ShelfGame, options: ShelfOptions): HTMLButtonElement {
  const skin = skinOf(game.id);
  const reason = options.unavailable
    ? options.unavailable(game)
    : options.playerCount >= game.minPlayers
      ? null
      : `needs ${game.minPlayers}`;
  const available = reason === null;
  const box = document.createElement("button");
  box.type = "button";
  box.className = "game-box";
  box.dataset.game = game.id;
  box.dataset.paper = skin.paper;
  box.setAttribute(
    "aria-label",
    `${game.name}. ${game.description}. ${game.minPlayers} to ${game.maxPlayers} players.${available ? "" : ` ${reason}.`}`,
  );
  if (options.selectedId === game.id) box.classList.add("selected");
  if (!game.name.includes(" ") && game.name.length > 11) box.classList.add("box-tight");
  if (!available) {
    box.classList.add("disabled");
    box.setAttribute("aria-disabled", "true");
  }
  applySkin(box, skin);
  box.style.rotate = `${((game.id.charCodeAt(0) % 5) - 2) * 0.7}deg`;
  box.innerHTML = `
    <span class="box-lid">
      <span class="box-kicker">${escapeHtml(skin.vibe)}</span>
      <span class="box-title" style="font-family:${skin.fonts.display}">${escapeHtml(game.name)}</span>
      <span class="box-art">${boxArt(skin)}</span>
      <span class="box-meta">${game.minPlayers}–${game.maxPlayers}</span>
      ${available ? "" : `<span class="box-note" style="font-family:var(--font-hand)">${escapeHtml(reason.toUpperCase())}</span>`}
    </span>
  `;
  box.appendChild(prop("tape", { x: "38%", y: "-9px", size: 86, rotate: -3, opacity: 0.9 }));
  if (game.id.length % 2 === 0) box.appendChild(prop("pin", { x: "84%", y: "-9px", size: 22, rotate: 8 }));
  box.addEventListener("click", () => {
    if (!available) return;
    options.onSelect(game.id);
  });
  return box;
}

export function createShelf(games: ShelfGame[], options: ShelfOptions): HTMLElement {
  const shelf = document.createElement("div");
  shelf.className = "shelf-strip";
  for (const game of games) shelf.appendChild(createGameBox(game, options));
  return shelf;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
