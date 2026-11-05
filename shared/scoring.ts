/**
 * Shared scoring rules (brief 3.3 / 3.7).
 *
 * Every game ends by returning a `GameResult`: ranked standings plus numeric
 * stats for the awards. These helpers are the single source for the platform
 * rules so games cannot drift:
 *
 * - `scalingFactor(N)` is `min(1, 3 / (N - 1))`. It applies only to payouts
 *   that are per-other-player or per-vote. Fixed payouts are the caller's
 *   responsibility and must NOT be passed through `scalePayout`.
 * - `rankPoints(rank, N)` is `round(100 * (N - rank) / (N - 1))` for Rumble.
 * - Ties share the average of the rank points for the positions they occupy,
 *   and the block keeps the (competition) rank of its first position.
 *
 * Rounding is half-up everywhere: `.5` goes away from zero for positive
 * values (the only values these functions produce).
 *
 * Defensive behaviour below 2 players: `scalingFactor` and `scalePayout`
 * return 1 / the base amount, and `rankPoints` treats the sole player as
 * first place (100). Games should not run below their declared minimum, but a
 * lobby race must never produce a division by zero or a NaN score.
 */

/** Base value of the per-vote scaling numerator. */
const SCALING_BASE = 3;

/** Highest score one player may earn in a single round, per brief 3.3. */
export const MAX_ROUND_SCORE = 1500;

/** Award ids the TV can render (brief 3.7). */
export const AWARDS = [
  "best-liar",
  "sharpest-eye",
  "fastest-fingers",
  "crowd-favourite",
  "cold-blooded",
  "comeback-kid",
  "master-of-disguise",
] as const;

export type Award = (typeof AWARDS)[number];

/** One player's line in a game's final standings. */
export interface GameStanding {
  playerId: string;
  /** 1-based; tied players share the rank of the block's first position. */
  rank: number;
  /** The game's own score, shown beside Rumble points. */
  raw: number;
}

/** What every game returns at the end of a match. */
export interface GameResult {
  standings: GameStanding[];
  /** Per-player or per-game numbers that feed the awards. */
  stats: Record<string, number>;
}

/** A player's raw score, before ranking. */
export interface ScoredEntry {
  id: string;
  raw: number;
}

/** A ranked player with the Rumble points earned for their position. */
export interface RankedEntry {
  id: string;
  rank: number;
  raw: number;
  points: number;
}

/** Whole player count, with non-finite input treated as a single player. */
function normalisePlayerCount(playerCount: number): number {
  if (!Number.isFinite(playerCount)) return 1;
  const count = Math.floor(playerCount);
  return count < 0 ? 0 : count;
}

/** Round half up for the non-negative values this module produces. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Scale factor for per-other-player and per-vote payouts.
 *
 * `min(1, 3 / (N - 1))`, so 2, 3 and 4 players are unchanged. Returns 1 for
 * fewer than 2 players instead of dividing by zero.
 */
export function scalingFactor(playerCount: number): number {
  const count = normalisePlayerCount(playerCount);
  if (count < 2) return 1;
  return Math.min(1, SCALING_BASE / (count - 1));
}

/**
 * Apply `scalingFactor` to a per-vote payout and round half up.
 *
 * Fixed payouts must be added without this function: only the part that is
 * per-other-player or per-vote is scaled, so callers that mix both should
 * call `scalePayout` on the variable part only.
 */
export function scalePayout(base: number, playerCount: number): number {
  const count = normalisePlayerCount(playerCount);
  if (count < 2 || count <= 4) return roundHalfUp(base);
  // Divide once from an exact integer numerator so a true .5 stays exact.
  return roundHalfUp((base * SCALING_BASE) / (count - 1));
}

/**
 * Rumble points for a 1-based position: `round(100 * (N - rank) / (N - 1))`.
 *
 * Ranks outside 1..N are clamped, and fewer than 2 players is treated as the
 * sole player taking first place.
 */
export function rankPoints(rank: number, playerCount: number): number {
  const count = normalisePlayerCount(playerCount);
  if (count < 2) return rank <= 1 ? 100 : 0;

  const safeRank = Math.min(count, Math.max(1, Math.round(rank)));
  return Math.round((100 * (count - safeRank)) / (count - 1));
}

/** Non-finite raw scores sort last rather than corrupting the comparator. */
function rankableRaw(raw: number): number {
  return Number.isFinite(raw) ? raw : Number.NEGATIVE_INFINITY;
}

/** Higher raw first; equal raw is broken by id so the order is stable. */
function compareEntries(a: ScoredEntry, b: ScoredEntry): number {
  const difference = rankableRaw(b.raw) - rankableRaw(a.raw);
  if (difference !== 0) return difference;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Rank players by raw score, highest first, with ties sharing the average of
 * the rank points for the positions they occupy.
 *
 * A tie block keeps the rank of its first position (1, 1, 3, ...) and every
 * member gets the same rounded average of `rankPoints` across the block.
 * Equal raw scores are ordered by id, so the result is deterministic.
 *
 * `playerCount` defaults to the number of entries. Pass it when `entries` is a
 * subset of the table (for example players still on the board) so the points
 * reflect their positions in the full field.
 */
export function rankWithTies(
  entries: readonly ScoredEntry[],
  playerCount: number = entries.length,
): RankedEntry[] {
  const sorted = [...entries].sort(compareEntries);
  const count = Math.max(normalisePlayerCount(playerCount), sorted.length);

  const ranked: RankedEntry[] = [];
  let blockStart = 0;

  while (blockStart < sorted.length) {
    let blockEnd = blockStart + 1;
    while (
      blockEnd < sorted.length &&
      rankableRaw(sorted[blockEnd].raw) === rankableRaw(sorted[blockStart].raw)
    ) {
      blockEnd++;
    }

    const blockSize = blockEnd - blockStart;
    const firstPosition = blockStart + 1;

    let pointSum = 0;
    for (let position = firstPosition; position < firstPosition + blockSize; position++) {
      pointSum += rankPoints(position, count);
    }
    const points = roundHalfUp(pointSum / blockSize);

    for (let index = blockStart; index < blockEnd; index++) {
      ranked.push({
        id: sorted[index].id,
        rank: firstPosition,
        raw: sorted[index].raw,
        points,
      });
    }

    blockStart = blockEnd;
  }

  return ranked;
}

/**
 * Convenience wrapper for games that only need the shared standings shape.
 *
 * Applies `rankWithTies` and drops the Rumble points. Output is in rank order,
 * with equal raws ordered by id.
 */
export function standingsFromScores(
  entries: readonly ScoredEntry[],
  playerCount: number = entries.length,
): GameStanding[] {
  return rankWithTies(entries, playerCount).map(({ id, rank, raw }) => ({
    playerId: id,
    rank,
    raw,
  }));
}

/**
 * Upper-bound guard for the round sanity test: one player's maximum possible
 * score in a single round must stay at or below `MAX_ROUND_SCORE`.
 */
export function withinRoundBound(score: number): boolean {
  return Number.isFinite(score) && score <= MAX_ROUND_SCORE;
}
