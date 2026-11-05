/**
 * Finale awards (brief 3.7).
 *
 * Games report raw numbers; the platform names the winners. Every award maps
 * to one or more stat keys so per-game tasks can pick the key that fits their
 * rules without editing this module. A stat key is a preference list: the
 * first key with at least one player value decides that award.
 *
 * Awards are evaluated in the brief's order and capped at six, so the finale
 * never has to drop a row it has already drawn. Equal values are broken by
 * player name (then id), which keeps the result identical across runs.
 */

import { AWARDS, type Award } from "./scoring.ts";

/** The part of a finished round awards need. */
export interface AwardRound {
  results: ReadonlyArray<{ playerId: string; name: string; place: number }>;
}

/** Aggregated per-player stats: playerId -> statKey -> value. */
export type PerPlayerStats = Record<string, Record<string, number>>;

export interface AwardWinner {
  id: Award;
  name: string;
  playerId: string;
  playerName: string;
  detail: string;
}

export interface AwardDefinition {
  id: Award;
  name: string;
  /** Stat keys that can feed this award, in preference order. */
  statKeys: readonly string[];
  /** `max` rewards the highest value; `min` rewards the lowest (times). */
  direction: "max" | "min";
  /** TV-friendly line built from the winning value. */
  format: (value: number, statKey: string) => string;
}

/** The seven briefed awards and the stats each accepts. */
export const AWARD_DEFINITIONS: readonly AwardDefinition[] = [
  {
    id: "best-liar",
    name: "Best Liar",
    statKeys: ["votesFooled", "bluffsBelieved", "fools"],
    direction: "max",
    format: (value) => `${value} ${value === 1 ? "vote" : "votes"} fooled`,
  },
  {
    id: "sharpest-eye",
    name: "Sharpest Eye",
    statKeys: ["correctAccusations", "correctVotes", "correctCalls"],
    direction: "max",
    format: (value) => `${value} correct ${value === 1 ? "call" : "calls"}`,
  },
  {
    id: "fastest-fingers",
    name: "Fastest Fingers",
    statKeys: ["averageAnswerMs", "avgAnswerMs", "answerMs", "fastestMs"],
    direction: "min",
    format: (value, statKey) =>
      `${(value / 1000).toFixed(2)}s ${statKey === "fastestMs" ? "fastest answer" : "average answer"}`,
  },
  {
    id: "crowd-favourite",
    name: "Crowd Favourite",
    statKeys: ["votesReceived", "audienceVotes", "reactionsReceived"],
    direction: "max",
    format: (value) => `${value} ${value === 1 ? "vote" : "votes"} from the crowd`,
  },
  {
    id: "cold-blooded",
    name: "Cold-Blooded",
    statKeys: ["biggestPot", "betrayals", "eliminations", "kills"],
    direction: "max",
    format: (value, statKey) =>
      statKey === "biggestPot" ? `${value} chip pot` : `${value} ${value === 1 ? "cold move" : "cold moves"}`,
  },
  {
    id: "comeback-kid",
    name: "Comeback Kid",
    statKeys: ["rankImprovement", "placesGained"],
    direction: "max",
    format: (value) => `${value} ${value === 1 ? "place" : "places"} gained`,
  },
  {
    id: "master-of-disguise",
    name: "Master of Disguise",
    statKeys: ["roundsUndetected", "timesUndetected", "roundsSurvived"],
    direction: "max",
    format: (value) => `${value} ${value === 1 ? "round" : "rounds"} undetected`,
  },
];

/** At most this many awards reach the finale. */
export const MAX_AWARDS = 6;

interface WinnerCandidate {
  playerId: string;
  value: number;
  statKey: string;
}

function compareCandidates(
  a: WinnerCandidate,
  b: WinnerCandidate,
  direction: "max" | "min",
  nameOf: (playerId: string) => string,
): number {
  const difference = direction === "max" ? b.value - a.value : a.value - b.value;
  if (difference !== 0) return difference;
  const byName = nameOf(a.playerId).localeCompare(nameOf(b.playerId));
  if (byName !== 0) return byName;
  return a.playerId.localeCompare(b.playerId);
}

/** First stat key with data decides; ties go to the first name. */
function statWinner(
  definition: AwardDefinition,
  stats: PerPlayerStats,
  nameOf: (playerId: string) => string,
): WinnerCandidate | null {
  for (const statKey of definition.statKeys) {
    const candidates: WinnerCandidate[] = [];
    for (const [playerId, values] of Object.entries(stats)) {
      const value = values?.[statKey];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      candidates.push({ playerId, value, statKey });
    }
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => compareCandidates(a, b, definition.direction, nameOf));
    const best = candidates[0];
    if (!best) continue;
    if (definition.direction === "max" && best.value <= 0) continue;
    if (definition.direction === "min" && best.value < 0) continue;
    return best;
  }
  return null;
}

/** Biggest rise from a player's first to last round place. */
function comebackWinner(
  rounds: readonly AwardRound[],
  nameOf: (playerId: string) => string,
): WinnerCandidate | null {
  if (rounds.length < 2) return null;

  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const appearances = new Map<string, number>();

  for (const round of rounds) {
    for (const result of round.results) {
      appearances.set(result.playerId, (appearances.get(result.playerId) ?? 0) + 1);
      if (!first.has(result.playerId)) first.set(result.playerId, result.place);
      last.set(result.playerId, result.place);
    }
  }

  let best: WinnerCandidate | null = null;
  for (const [playerId, count] of appearances) {
    if (count < 2) continue;
    const start = first.get(playerId);
    const end = last.get(playerId);
    if (start === undefined || end === undefined) continue;
    const improvement = start - end;
    if (improvement <= 0) continue;
    const candidate: WinnerCandidate = { playerId, value: improvement, statKey: "rankImprovement" };
    if (
      !best ||
      improvement > best.value ||
      (improvement === best.value && compareCandidates(candidate, best, "max", nameOf) < 0)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Award winners for the finale, at most six.
 *
 * No stats means no awards: the older trophies still cover the finale. The
 * comeback is computed from round places first and falls back to a game's own
 * `rankImprovement` / `placesGained` stat when fewer than two rounds exist.
 */
export function computeAwards(
  rounds: readonly AwardRound[],
  stats: PerPlayerStats | undefined,
): AwardWinner[] {
  const activeStats = stats ?? {};
  const entries = Object.entries(activeStats).filter(
    ([, values]) => values && typeof values === "object",
  );
  if (entries.length === 0) return [];
  const hasValue = entries.some(([, values]) =>
    Object.values(values).some((value) => Number.isFinite(value)),
  );
  if (!hasValue) return [];

  const names = new Map<string, string>();
  for (const round of rounds) {
    for (const result of round.results) {
      if (!names.has(result.playerId)) names.set(result.playerId, result.name);
    }
  }
  const nameOf = (playerId: string): string => names.get(playerId) ?? playerId;

  const winners: AwardWinner[] = [];
  for (const definition of AWARD_DEFINITIONS) {
    if (winners.length >= MAX_AWARDS) break;
    const best =
      definition.id === "comeback-kid"
        ? comebackWinner(rounds, nameOf) ?? statWinner(definition, activeStats, nameOf)
        : statWinner(definition, activeStats, nameOf);
    if (!best) continue;
    winners.push({
      id: definition.id,
      name: definition.name,
      playerId: best.playerId,
      playerName: nameOf(best.playerId),
      detail: definition.format(best.value, best.statKey),
    });
  }
  return winners;
}

/** The seven award ids in display order, for UI parity checks. */
export const AWARD_ORDER = AWARDS;
