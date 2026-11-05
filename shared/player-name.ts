/**
 * Server-side player-name rules.
 *
 * Display names are capped at 12 characters, trimmed, and deduplicated so
 * name-keyed winner/ranking lookups cannot pick the wrong seat. "Ana" joining
 * three times becomes "Ana", "Ana 2", "Ana 3".
 */

export const MAX_PLAYER_NAME_LENGTH = 12;

/** Trim, then truncate to the platform cap. Never splits a surrogate pair. */
export function truncatePlayerName(
  name: string,
  max = MAX_PLAYER_NAME_LENGTH,
): string {
  const chars = Array.from(name);
  const clipped = chars.length > max ? chars.slice(0, max).join("") : name;
  return clipped.trimEnd();
}

/**
 * Validate and normalise a raw join name.
 * Returns null when the name is empty or contains control characters.
 */
export function sanitisePlayerName(raw: string): string | null {
  if (typeof raw !== "string") return null;

  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return truncatePlayerName(trimmed);
}

/**
 * Make a normalised name unique against the names already in the room.
 * The numeric suffix is kept inside the 12-character cap by shortening the
 * base, so "MaximilianAB" becomes "Maximilian 2" rather than 14 characters.
 */
export function uniquePlayerName(
  takenNames: readonly string[],
  name: string,
): string {
  const capped = truncatePlayerName(name);
  const taken = new Set(takenNames.map((taken) => taken.toLowerCase()));
  if (!taken.has(capped.toLowerCase())) return capped;

  for (let suffixNumber = 2; suffixNumber < 1000; suffixNumber++) {
    const suffix = ` ${suffixNumber}`;
    const base = truncatePlayerName(capped, MAX_PLAYER_NAME_LENGTH - suffix.length);
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  // Unreachable with an 8-seat room, but keep the function total.
  return truncatePlayerName(`${capped} 999`);
}
