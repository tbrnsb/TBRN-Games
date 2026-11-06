/**
 * Result extraction and normalisation (brief 3.3 / 3.7).
 *
 * A game may report its own `GameResult` through `GamePlugin.results()`. Until
 * every game does, the platform falls back to the score tables the existing
 * screen states already expose. Both paths run through `normaliseGameResult`,
 * so the session engine always receives one line per player with a finite raw
 * score and a rank.
 *
 * Per-player stats travel in the flat `GameResult.stats` map as
 * `<playerId>:<statKey>` (see `playerStatKey`). Keys that do not name a known
 * player are dropped; `perPlayerStats` also accepts the reversed
 * `<statKey>:<playerId>` order for compatibility.
 */

import { rankWithTies, type GameResult, type GameStanding, type ScoredEntry } from "./scoring.ts";

/** The minimum player shape result handling needs. */
export interface ResultPlayer {
  id: string;
  name: string;
}

/** The part of a plugin result extraction uses. */
export interface ResultProvider<TInstance = unknown> {
  results?(instance: TInstance): unknown;
  screenState?(instance: TInstance): unknown;
}

interface ScoreSource {
  list: string;
  key: string;
  /** True when a bigger number is a better position. */
  high: boolean;
}

/** Score tables already published by the existing games. */
function scoreSources(gameId: string): ScoreSource[] {
  switch (gameId) {
    case "golf":
      return [{ list: "scores", key: "totalStrokes", high: false }];
    case "darts":
      return [{ list: "players", key: "score", high: false }];
    case "racing":
      return [{ list: "racers", key: "progress", high: true }];
    case "poker":
      return [{ list: "players", key: "chips", high: true }];
    case "spinwar":
    case "guesswho":
      return [{ list: "scores", key: "score", high: true }];
    default:
      return [
        { list: "scores", key: "score", high: true },
        { list: "players", key: "score", high: true },
      ];
  }
}

function winnerName(screen: unknown): string | null {
  if (!screen || typeof screen !== "object") return null;
  const winner = (screen as { winner?: unknown }).winner;
  if (typeof winner === "string") return winner;
  if (winner && typeof winner === "object" && typeof (winner as { name?: unknown }).name === "string") {
    return (winner as { name: string }).name;
  }
  return null;
}

function asFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

/**
 * Read raw scores out of an existing screen state, mapping names to seats.
 * The declared winner is kept even when the screen carries no score row.
 */
function entriesFromScreen(
  gameId: string,
  screen: unknown,
  players: readonly ResultPlayer[],
): { entries: ScoredEntry[]; high: boolean; winnerId: string | null } {
  const byName = new Map(players.map((player) => [player.name, player]));
  const raws = new Map<string, number>();
  let high = true;
  let winnerId: string | null = null;

  if (screen && typeof screen === "object") {
    const record = screen as Record<string, unknown>;
    const source = scoreSources(gameId).find(
      (candidate) => Array.isArray(record[candidate.list]) && (record[candidate.list] as unknown[]).length > 0,
    );
    if (source) {
      high = source.high;
      for (const item of record[source.list] as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const player = typeof row.name === "string" ? byName.get(row.name) : undefined;
        if (!player || raws.has(player.id)) continue;
        const raw = asFiniteNumber(row[source.key]);
        if (raw === null) continue;
        raws.set(player.id, raw);
      }
    }

    const winner = winnerName(screen);
    const winnerPlayer = winner ? byName.get(winner) : undefined;
    if (winnerPlayer) {
      winnerId = winnerPlayer.id;
      if (!raws.has(winnerPlayer.id)) raws.set(winnerPlayer.id, 0);
    }
  }

  const entries = players.map((player) => ({ id: player.id, raw: raws.get(player.id) ?? 0 }));
  return { entries, high, winnerId };
}

/**
 * Derive standings from the screen state a game already publishes.
 *
 * Ranks come from `rankWithTies`, so ties share a rank. A declared winner is
 * lifted to first for ranking even when its raw score does not lead, which
 * mirrors the placement rule the session still uses; the standings keep the
 * real raw value. Count-down games (golf strokes, darts remaining score) are
 * negated for ranking only.
 */
export function resultFromScreen(
  screen: unknown,
  players: readonly ResultPlayer[],
  gameId: string,
): GameResult {
  const { entries, high, winnerId } = entriesFromScreen(gameId, screen, players);
  const raws = entries.map((entry) => entry.raw);
  const winnerEdge = high ? Math.max(...raws) + 1 : Math.min(...raws) - 1;
  const ranking = entries.map((entry) =>
    entry.id === winnerId ? { id: entry.id, raw: winnerEdge } : entry,
  );
  const ranked = rankWithTies(
    ranking.map((entry) => ({ id: entry.id, raw: high ? entry.raw : -entry.raw })),
  );
  const rawById = new Map(entries.map((entry) => [entry.id, entry.raw]));
  const standings: GameStanding[] = ranked.map((entry) => ({
    playerId: entry.id,
    rank: entry.rank,
    raw: rawById.get(entry.id) ?? 0,
  }));
  return { standings, stats: {} };
}

/** True when a game-supplied result covers every player exactly once. */
function isWellFormed(result: unknown, players: readonly ResultPlayer[]): result is GameResult {
  if (!result || typeof result !== "object") return false;
  const record = result as { standings?: unknown; stats?: unknown };
  if (!Array.isArray(record.standings) || record.standings.length !== players.length) return false;

  const known = new Set(players.map((player) => player.id));
  const seen = new Set<string>();
  for (const item of record.standings) {
    if (!item || typeof item !== "object") return false;
    const standing = item as Record<string, unknown>;
    if (typeof standing.playerId !== "string" || !known.has(standing.playerId)) return false;
    if (seen.has(standing.playerId)) return false;
    seen.add(standing.playerId);
    if (asFiniteNumber(standing.raw) === null) return false;
    const rank = asFiniteNumber(standing.rank);
    if (rank === null || rank < 1) return false;
  }
  if (seen.size !== known.size) return false;

  if (record.stats !== undefined) {
    if (!record.stats || typeof record.stats !== "object" || Array.isArray(record.stats)) return false;
    for (const value of Object.values(record.stats as Record<string, unknown>)) {
      if (asFiniteNumber(value) === null) return false;
    }
  }
  return true;
}

/**
 * Dedupe, coerce and complete a result against the table.
 *
 * Supplied entries keep their order and rank (numeric strings are coerced).
 * A duplicate, an unknown player or a non-finite raw is ignored. Any player
 * left over is appended with raw 0 and the next free rank.
 */
export function normaliseGameResult(
  result: unknown,
  players: readonly ResultPlayer[],
): GameResult {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const known = new Set(players.map((player) => player.id));
  const provided = new Map<string, { rank: number; raw: number }>();
  const order: string[] = [];

  const rawStandings = Array.isArray(record.standings) ? record.standings : [];
  for (const item of rawStandings) {
    if (!item || typeof item !== "object") continue;
    const standing = item as Record<string, unknown>;
    const playerId = typeof standing.playerId === "string" ? standing.playerId : "";
    if (!known.has(playerId) || provided.has(playerId)) continue;
    const raw = asFiniteNumber(standing.raw);
    if (raw === null) continue;
    const parsedRank = asFiniteNumber(standing.rank);
    provided.set(playerId, {
      raw,
      rank: parsedRank !== null && parsedRank >= 1 ? Math.round(parsedRank) : 0,
    });
    order.push(playerId);
  }

  let maxRank = 0;
  for (const entry of provided.values()) maxRank = Math.max(maxRank, entry.rank);
  const fillRank = Math.max(1, maxRank + 1);

  const standings: GameStanding[] = [];
  for (const playerId of order) {
    const entry = provided.get(playerId);
    if (!entry) continue;
    standings.push({
      playerId,
      rank: entry.rank > 0 ? entry.rank : fillRank,
      raw: entry.raw,
    });
  }
  for (const player of players) {
    if (provided.has(player.id)) continue;
    standings.push({ playerId: player.id, rank: fillRank, raw: 0 });
  }

  const stats: Record<string, number> = {};
  const rawStats = record.stats;
  if (rawStats && typeof rawStats === "object" && !Array.isArray(rawStats)) {
    for (const [key, value] of Object.entries(rawStats as Record<string, unknown>)) {
      const number = asFiniteNumber(value);
      if (number !== null) stats[key] = number;
    }
  }

  return { standings, stats };
}

/**
 * Prefer a well-formed `plugin.results()`, otherwise derive standings from the
 * screen state. Both branches return a normalised result.
 */
export function extractGameResult<TInstance>(
  plugin: ResultProvider<TInstance>,
  instance: TInstance,
  players: readonly ResultPlayer[],
  gameId: string,
): GameResult {
  let custom: unknown;
  if (typeof plugin.results === "function") {
    try {
      custom = plugin.results(instance);
    } catch {
      custom = undefined;
    }
  }
  if (isWellFormed(custom, players)) return normaliseGameResult(custom, players);

  let screen: unknown;
  if (typeof plugin.screenState === "function") {
    try {
      screen = plugin.screenState(instance);
    } catch {
      screen = undefined;
    }
  }
  return normaliseGameResult(resultFromScreen(screen, players, gameId), players);
}

/** Key a game uses to report one player's stat inside `GameResult.stats`. */
export function playerStatKey(playerId: string, statKey: string): string {
  return `${playerId}:${statKey}`;
}

/**
 * Split the flat stats map into per-player buckets.
 *
 * Unknown player ids are dropped and repeated keys are summed, so a game can
 * report stats for one round without worrying about the aggregation shape.
 * Supplying `players` also accepts the reversed `<statKey>:<playerId>` order.
 */
export function perPlayerStats(
  stats: Record<string, number> | undefined,
  players?: readonly ResultPlayer[],
): Record<string, Record<string, number>> {
  const known = players ? new Set(players.map((player) => player.id)) : null;
  const out: Record<string, Record<string, number>> = {};

  for (const [key, value] of Object.entries(stats ?? {})) {
    if (!Number.isFinite(value)) continue;
    const separator = key.indexOf(":");
    if (separator <= 0 || separator >= key.length - 1) continue;

    const left = key.slice(0, separator);
    const right = key.slice(separator + 1);
    let playerId: string;
    let statKey: string;
    if (known) {
      if (known.has(left)) {
        playerId = left;
        statKey = right;
      } else if (known.has(right)) {
        playerId = right;
        statKey = left;
      } else {
        continue;
      }
    } else {
      playerId = left;
      statKey = right;
    }

    const bucket = out[playerId] ?? (out[playerId] = {});
    bucket[statKey] = (bucket[statKey] ?? 0) + value;
  }

  return out;
}
