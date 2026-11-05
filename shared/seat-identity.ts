/**
 * Seat identity for up to 8 players.
 *
 * Every seat has a distinct colour AND a distinct shape/emoji, so a player is
 * never identified by colour alone (colour-blind safe). The TV lobby, the
 * in-game scoreboards and the phone header all read from this one list.
 *
 * Seat colours reuse the shared theme palette so a player keeps the same
 * colour from the lobby into a game.
 */

import { theme } from "./theme.ts";

export type SeatShape =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "star"
  | "hexagon"
  | "plus"
  | "heart";

export interface SeatIdentity {
  /** Zero-based seat number, 0..7. */
  index: number;
  /** Hex colour, always paired with `shape`/`emoji`. */
  color: string;
  /** Semantic shape name, also used as the accessible label. */
  shape: SeatShape;
  /** Monochrome glyph drawn on the colour badge. */
  emoji: string;
}

export const SEATS: readonly SeatIdentity[] = [
  { index: 0, color: theme.colors.player[0], shape: "circle", emoji: "●" },
  { index: 1, color: theme.colors.player[1], shape: "square", emoji: "■" },
  { index: 2, color: theme.colors.player[2], shape: "triangle", emoji: "▲" },
  { index: 3, color: theme.colors.player[3], shape: "diamond", emoji: "◆" },
  { index: 4, color: theme.colors.player[4], shape: "star", emoji: "★" },
  { index: 5, color: theme.colors.player[5], shape: "hexagon", emoji: "⬢" },
  { index: 6, color: theme.colors.player[6], shape: "plus", emoji: "✚" },
  { index: 7, color: theme.colors.player[7], shape: "heart", emoji: "♥" },
];

/** Number of seats the platform supports. */
export const SEAT_COUNT = SEATS.length;

/** The seat identity for a seat index, wrapping defensively. */
export function seatForIndex(index: number): SeatIdentity {
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  const wrapped = ((safe % SEAT_COUNT) + SEAT_COUNT) % SEAT_COUNT;
  return SEATS[wrapped];
}

/**
 * The seat identity for a player in a room's player list, or null when the
 * player is not in the list. Falls back to the list position when an older
 * player object has no `seat` field yet.
 */
export function seatForPlayer(
  players: readonly { id: string; seat?: SeatIdentity }[],
  playerId: string,
): SeatIdentity | null {
  const index = players.findIndex((player) => player.id === playerId);
  if (index === -1) return null;
  return players[index].seat ?? seatForIndex(index);
}
