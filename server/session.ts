/**
 * Royal Rumble session engine (pure logic).
 *
 * A session plays a fixed number of distinct games. Each round awards placement
 * points, then the next round is chosen by phone vote or at random. After the
 * last round the champion and honorary trophies are computed.
 */

export type SessionSelection = "vote" | "random";
export type SessionStatus = "voting" | "playing" | "finished";

import type { SessionView } from "../shared/types.ts";
import { computeAwards, type AwardWinner } from "../shared/awards.ts";
import { normaliseGameResult, perPlayerStats, resultFromScreen } from "../shared/results.ts";
import type { GameResult } from "../shared/scoring.ts";

export interface SessionGame {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface SessionPlayerStat {
  playerId: string;
  name: string;
  points: number;
  wins: number;
  podiums: number;
  lastPlaces: number;
  bestSingle: number;
}

export interface SessionRoundResult {
  gameId: string;
  gameName: string;
  results: Array<{ playerId: string; name: string; place: number; points: number }>;
  /** The game's own raw score per player, shown beside placement points. */
  raw: Record<string, number>;
  /** Per-player stat totals for this round, when the game supplied them. */
  stats?: Record<string, Record<string, number>>;
}

export interface SessionTrophy {
  id: string;
  name: string;
  playerName: string;
  detail: string;
}

export interface SessionState {
  length: number;
  selection: SessionSelection;
  status: SessionStatus;
  round: number;
  played: string[];
  currentGameId: string | null;
  candidates: SessionGame[];
  votes: Record<string, string>; // playerId -> gameId
  stats: Record<string, SessionPlayerStat>; // playerId
  rounds: SessionRoundResult[];
  accuracy: Record<string, { correct: number; answered: number; fastestMs: number | null }>;
  /** All per-player stats merged across rounds; powers the finale awards. */
  awardStats: Record<string, Record<string, number>>;
  trophies: SessionTrophy[];
  awards: AwardWinner[];
  champion: { playerId: string; name: string; points: number } | null;
}

interface PlayerLike { id: string; name: string; }

const PLACEMENT_POINTS = [10, 6, 3, 1];

export function pointsForPlace(place: number): number {
  return PLACEMENT_POINTS[place - 1] ?? 0;
}

/** Games that can start with the current player count and have not been played. */
export function eligibleGames(games: SessionGame[], playerCount: number, played: string[]): SessionGame[] {
  const done = new Set(played);
  return games.filter(
    (g) => !done.has(g.id) && playerCount >= g.minPlayers && playerCount <= g.maxPlayers,
  );
}

export function createSession(
  players: PlayerLike[],
  games: SessionGame[],
  length: number,
  selection: SessionSelection,
): SessionState {
  const candidates = eligibleGames(games, players.length, []);
  const effectiveLength = Math.max(1, Math.min(length, candidates.length));
  const stats: Record<string, SessionPlayerStat> = {};
  for (const p of players) {
    stats[p.id] = { playerId: p.id, name: p.name, points: 0, wins: 0, podiums: 0, lastPlaces: 0, bestSingle: 0 };
  }
  const session: SessionState = {
    length: effectiveLength,
    selection,
    status: "voting",
    round: 1,
    played: [],
    currentGameId: null,
    candidates,
    votes: {},
    stats,
    rounds: [],
    accuracy: {},
    awardStats: {},
    trophies: [],
    awards: [],
    champion: null,
  };
  if (selection === "random") session.currentGameId = pickRandom(candidates)?.id ?? null;
  return session;
}

export function recordVote(session: SessionState, playerId: string, gameId: string): boolean {
  if (session.status !== "voting" || session.selection !== "vote") return false;
  if (!session.candidates.some((g) => g.id === gameId)) return false;
  session.votes[playerId] = gameId;
  return true;
}

/** Highest vote count; ties are broken deterministically by candidate order. */
export function leadingGameId(session: SessionState): string | null {
  if (session.selection === "random") return session.currentGameId;
  let best: string | null = null;
  let bestCount = 0;
  for (const game of session.candidates) {
    const count = Object.values(session.votes).filter((v) => v === game.id).length;
    if (count > bestCount) {
      bestCount = count;
      best = game.id;
    }
  }
  return best;
}

export function voteCounts(session: SessionState): Array<{ gameId: string; name: string; count: number }> {
  return session.candidates.map((game) => ({
    gameId: game.id,
    name: game.name,
    count: Object.values(session.votes).filter((v) => v === game.id).length,
  }));
}

export function startRound(session: SessionState, gameId: string): boolean {
  if (session.status !== "voting") return false;
  if (!session.candidates.some((g) => g.id === gameId)) return false;
  session.status = "playing";
  session.currentGameId = gameId;
  session.votes = {};
  return true;
}

/** Abort a running round without awarding points; reopen the same round. */
export function abortRound(session: SessionState): void {
  if (session.status !== "playing") return;
  session.status = "voting";
  session.currentGameId = null;
  session.votes = {};
  if (session.selection === "random") session.currentGameId = pickRandom(session.candidates)?.id ?? null;
}

interface ScoreEntry { name: string; score: number; }

function winnerName(screen: unknown): string | null {
  if (!screen || typeof screen !== "object") return null;
  const w = (screen as { winner?: unknown }).winner;
  if (typeof w === "string") return w;
  if (w && typeof w === "object" && typeof (w as { name?: unknown }).name === "string") {
    return (w as { name: string }).name;
  }
  return null;
}

function entriesFromScreen(gameId: string, screen: unknown): ScoreEntry[] {
  if (!screen || typeof screen !== "object") return [];
  const s = screen as Record<string, unknown>;

  const asEntries = (value: unknown, scoreKey: string): ScoreEntry[] => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({ name: String(e.name ?? ""), score: Number(e[scoreKey] ?? 0) }))
      .filter((e) => e.name.length > 0 && Number.isFinite(e.score));
  };

  switch (gameId) {
    case "golf":
      return asEntries(s.scores, "totalStrokes");
    case "darts":
      return asEntries(s.players, "score");
    case "racing":
      return asEntries(s.racers, "progress");
    case "poker":
      return asEntries(s.players, "chips");
    case "spinwar":
    case "guesswho":
      return asEntries(s.scores, "score");
    default:
      if (Array.isArray(s.scores)) return asEntries(s.scores, "score");
      if (Array.isArray(s.players)) return asEntries(s.players, "score");
      return [];
  }
}

/** Higher score wins, except the games whose score counts down or is strokes. */
function higherIsBetter(gameId: string): boolean {
  return gameId !== "golf" && gameId !== "darts";
}

/** Ordered finishers for one game; the declared winner is forced to the front. */
export function computePlacements(gameId: string, screen: unknown, players: PlayerLike[]): Array<{ playerId: string; name: string; place: number }> {
  const entries = entriesFromScreen(gameId, screen);
  const high = higherIsBetter(gameId);
  entries.sort((a, b) => (high ? b.score - a.score : a.score - b.score) || a.name.localeCompare(b.name));

  const winner = winnerName(screen);
  if (winner) {
    const idx = entries.findIndex((e) => e.name === winner);
    if (idx > 0) {
      const [w] = entries.splice(idx, 1);
      entries.unshift(w);
    } else if (idx === -1) {
      entries.unshift({ name: winner, score: 0 });
    }
  }

  // Map names back to player ids; fall back to seat order for unnamed entries.
  const byName = new Map(players.map((p) => [p.name, p]));
  const used = new Set<string>();
  const ordered: Array<{ playerId: string; name: string }> = [];
  for (const entry of entries) {
    const player = byName.get(entry.name);
    if (player && !used.has(player.id)) {
      ordered.push({ playerId: player.id, name: player.name });
      used.add(player.id);
    }
  }
  for (const p of players) {
    if (!used.has(p.id)) ordered.push({ playerId: p.id, name: p.name });
  }
  return ordered.map((p, i) => ({ ...p, place: i + 1 }));
}

export function quizAccuracy(instance: unknown): Record<string, { correct: number; answered: number; fastestMs: number | null }> {
  const out: Record<string, { correct: number; answered: number; fastestMs: number | null }> = {};
  const state = (instance as { state?: Record<string, unknown> })?.state;
  if (!state || !Array.isArray(state.questions) || !(state.answers instanceof Map)) return out;
  const questions = state.questions as Array<{ correct?: string }>;
  const answers = state.answers as Map<number, Map<string, { optionId?: string; timeMs?: number }>>;

  for (const [questionIndex, byPlayer] of answers) {
    const correct = questions[questionIndex]?.correct;
    for (const [playerId, answer] of byPlayer) {
      const stat = out[playerId] ?? { correct: 0, answered: 0, fastestMs: null };
      stat.answered++;
      if (correct && answer.optionId === correct) {
        stat.correct++;
        const time = Number(answer.timeMs);
        if (Number.isFinite(time) && time >= 0) {
          stat.fastestMs = stat.fastestMs === null ? time : Math.min(stat.fastestMs, time);
        }
      }
      out[playerId] = stat;
    }
  }
  return out;
}

/** Apply one finished round: award points, record it, and advance or finish. */
export function completeRound(
  session: SessionState,
  gameId: string,
  gameName: string,
  screen: unknown,
  players: PlayerLike[],
  accuracy?: Record<string, { correct: number; answered: number; fastestMs: number | null }>,
  gameResult?: GameResult,
): void {
  const placements = computePlacements(gameId, screen, players);
  const results = placements.map((p) => ({ ...p, points: pointsForPlace(p.place) }));

  // Raw scores and stats sit beside the unchanged placement points. A game
  // result is preferred; otherwise derive it from the screen it already shows.
  const result = gameResult
    ? normaliseGameResult(gameResult, players)
    : resultFromScreen(screen, players, gameId);
  const raw: Record<string, number> = {};
  for (const standing of result.standings) raw[standing.playerId] = standing.raw;
  const roundStats = perPlayerStats(result.stats, players);

  for (const r of results) {
    const stat = session.stats[r.playerId];
    if (!stat) continue;
    stat.points += r.points;
    stat.bestSingle = Math.max(stat.bestSingle, r.points);
    if (r.place === 1) stat.wins++;
    if (r.place <= 3) stat.podiums++;
    if (r.place === results.length) stat.lastPlaces++;
  }
  if (accuracy) {
    for (const [playerId, a] of Object.entries(accuracy)) {
      const prev = session.accuracy[playerId] ?? { correct: 0, answered: 0, fastestMs: null };
      session.accuracy[playerId] = {
        correct: prev.correct + a.correct,
        answered: prev.answered + a.answered,
        fastestMs: a.fastestMs === null ? prev.fastestMs : prev.fastestMs === null ? a.fastestMs : Math.min(prev.fastestMs, a.fastestMs),
      };
    }
  }

  const round: SessionRoundResult = { gameId, gameName, results, raw };
  if (Object.keys(roundStats).length > 0) {
    round.stats = roundStats;
    for (const [playerId, values] of Object.entries(roundStats)) {
      const aggregate = session.awardStats[playerId] ?? {};
      for (const [statKey, value] of Object.entries(values)) {
        aggregate[statKey] = (aggregate[statKey] ?? 0) + value;
      }
      session.awardStats[playerId] = aggregate;
    }
  }
  session.rounds.push(round);
  session.played.push(gameId);

  const remaining = eligibleGames(session.candidates, players.length, session.played);
  if (session.rounds.length >= session.length || remaining.length === 0) {
    session.status = "finished";
    session.currentGameId = null;
    session.candidates = remaining;
    session.votes = {};
    finalise(session);
    return;
  }

  session.candidates = remaining;
  session.round++;
  session.status = "voting";
  session.votes = {};
  session.currentGameId = session.selection === "random" ? pickRandom(remaining)?.id ?? null : null;
}

function finalise(session: SessionState): void {
  const stats = Object.values(session.stats);
  stats.sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.bestSingle - a.bestSingle ||
      a.name.localeCompare(b.name),
  );
  const top = stats[0];
  session.champion = top ? { playerId: top.playerId, name: top.name, points: top.points } : null;

  const trophies: SessionTrophy[] = [];
  const addTrophy = (id: string, name: string, detail: (s: SessionPlayerStat) => string, candidates: SessionPlayerStat[]) => {
    if (candidates.length === 0) return;
    const best = candidates[0];
    trophies.push({ id, name, playerName: best.name, detail: detail(best) });
  };

  const most = (pick: (s: SessionPlayerStat) => number) => {
    const max = Math.max(0, ...stats.map(pick));
    return max > 0 ? stats.filter((s) => pick(s) === max) : [];
  };

  addTrophy("wins", "Most Wins", (s) => `${s.wins} ${s.wins === 1 ? "win" : "wins"}`, most((s) => s.wins));
  addTrophy("podium", "Podium Regular", (s) => `${s.podiums} podium finishes`, most((s) => s.podiums));
  addTrophy("spoon", "Wooden Spoon", (s) => `${s.lastPlaces} last-place finishes`, most((s) => s.lastPlaces));
  addTrophy("high-roller", "High Roller", (s) => `${s.bestSingle} points in one game`, most((s) => s.bestSingle));

  // Accuracy only exists for quiz rounds; rate, then speed as the tiebreak.
  const accuracy = Object.entries(session.accuracy)
    .filter(([, a]) => a.answered > 0)
    .map(([playerId, a]) => ({
      playerId,
      name: session.stats[playerId]?.name ?? "Player",
      rate: a.correct / a.answered,
      correct: a.correct,
      answered: a.answered,
      fastest: a.fastestMs ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => b.rate - a.rate || a.fastest - b.fastest || a.name.localeCompare(b.name));
  if (accuracy.length > 0 && accuracy[0].correct > 0) {
    const best = accuracy[0];
    trophies.push({
      id: "accuracy",
      name: "Most Accurate",
      playerName: best.name,
      detail: `${best.correct}/${best.answered} correct`,
    });
  }

  session.trophies = trophies;
  session.awards = computeAwards(session.rounds, session.awardStats);
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export function sessionView(session: SessionState): SessionView {
  const standings = Object.values(session.stats).sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.bestSingle - a.bestSingle ||
      a.name.localeCompare(b.name),
  );
  return {
    length: session.length,
    selection: session.selection,
    status: session.status,
    round: session.round,
    played: [...session.played],
    currentGameId: session.currentGameId,
    leadingGameId: leadingGameId(session),
    candidates: session.candidates,
    votes: voteCounts(session),
    voted: Object.keys(session.votes).length,
    standings,
    champion: session.champion ? { name: session.champion.name, points: session.champion.points } : null,
    trophies: session.trophies,
    awardStats: session.awardStats,
    awards: session.awards,
  };
}
