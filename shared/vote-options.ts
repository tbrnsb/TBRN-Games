/**
 * Voting layout primitives shared by the TV renderer and the phone choice UI.
 *
 * Font sizes are canvas pixels at the 1920x1080 design viewport. The shared
 * screen is watched from roughly 3 metres, so a full-width list never goes
 * below 48px (the kit's "large" body threshold). Two-column grids trade some
 * size for density but stay at or above the 28px kit body minimum.
 */

/** Smallest allowed type for the one-column / one-screen layout (1080p). */
export const LARGE_TYPE_MIN_PX = 48;

/** Largest type the one-column layout will use (1080p). */
export const VOTE_FONT_CEILING_PX = 72;

export interface VoteLayout {
  /** 1 for 1-6 options, 2 for 7+ or when `minColumns: 2` asks for a grid. */
  columns: 1 | 2;
  /** One letter badge per option: A, B, C ... Z, AA, AB ... */
  letters: string[];
  /** Ceiling for the computed type size at 1080p. */
  maxFontPx: number;
  /** Floor for the computed type size at 1080p. */
  minFontPx: number;
}

export interface VoteLayoutOptions {
  /**
   * Force at least this many columns. Composed-text games use it to split six
   * long answers earlier than the default seven-option threshold (brief 4).
   */
  minColumns?: 1 | 2;
}

/**
 * Spreadsheet-style option letter: 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB.
 * Negative/non-finite input returns an empty string so a bad index cannot
 * paint "undefined" on a public screen.
 */
export function optionLetter(index: number): string {
  if (!Number.isFinite(index) || index < 0) return "";
  let value = Math.floor(index) + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/**
 * Layout for a vote list.
 *
 * Thresholds (brief 3.5):
 * - 1-6 options: one column, maximum type (72px ceiling, 48px floor).
 * - 7-9 options: two columns with letter badges (56px ceiling, 36px floor).
 * - 10+ options: still two columns and a letter for every option; the game
 *   may page the list without re-computing letters.
 *
 * `minColumns: 2` lets a game opt into the two-column layout below seven
 * options; the six-option case then keeps the readable two-column type floor.
 */
export function voteLayout(optionCount: number, options: VoteLayoutOptions = {}): VoteLayout {
  const count = Number.isFinite(optionCount) ? Math.max(0, Math.floor(optionCount)) : 0;
  const columns: 1 | 2 = count >= 7 || options.minColumns === 2 ? 2 : 1;
  const letters = Array.from({ length: count }, (_, index) => optionLetter(index));

  if (columns === 1) {
    return { columns, letters, maxFontPx: VOTE_FONT_CEILING_PX, minFontPx: LARGE_TYPE_MIN_PX };
  }
  if (count <= 9) {
    return { columns, letters, maxFontPx: 56, minFontPx: 36 };
  }
  return { columns, letters, maxFontPx: 48, minFontPx: 28 };
}

/**
 * A cast vote stays editable until the whole table has voted or the server
 * clock reaches zero. `hasVoted` is accepted so call sites can pass the same
 * state object to the phone and the TV; it does not close the ballot by itself.
 */
export function canChangeVote(args: {
  hasVoted: boolean;
  allVoted: boolean;
  timeLeftMs: number;
}): boolean {
  return !args.allVoted && args.timeLeftMs > 0;
}
