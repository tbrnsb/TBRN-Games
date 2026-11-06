/**
 * Royal Rumble session engine (pure logic).
 *
 * A session plays a pre-built playlist (a preset) of up to eight games back to
 * back, with one running leaderboard. Each round awards placement points, then
 * the remaining slots are re-resolved for the players still in the room. After
 * the last surviving slot the champion and honorary trophies are computed.
 *
 * The preset path replaces vote selection (brief section 6). The legacy
 * vote/random path is kept here only until the server transport and clients
 * move over, so the HTTP layer keeps compiling during this step.
 */

import type { SessionRoundView, SessionSlotView, SessionView } from "../shared/types.ts";
import { computeAwards, type AwardWinner } from "../shared/awards.ts";
import { GAME_CATALOG, catalogEntry } from "../shared/game-catalog.ts";
import {
  resolvePreset,
  type PresetSwap,
  type ResolvedSlot,
  type RumblePreset,
} from "../shared/rumble-presets.ts";
import { normaliseGameResult, perPlayerStats, resultFromScreen } from "../shared/results.ts";
import type { GameResult } from "../shared/scoring.ts";

export type SessionSelection = "vote" | "random" | "preset";
export type SessionStatus = "voting" | "playing" | "interlude" | "finished";

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

/** Options accepted when starting a preset Rumble. */
export interface SessionOptions {
  /** Double the final surviving slot's placement points. Defaults to on. */
  lastGameDouble?: boolean;
}

export interface SessionState {
  // --- Preset mode ---
  presetId: string;
  presetName: string;
  /** The preset being played; null on a legacy vote/random session. */
  preset: RumblePreset | null;
  slots: ResolvedSlot[];
  /** Index of the current slot; `slots.length` once the Rumble is finished. */
  slotIndex: number;
  /** Every swap announcement shown so far, oldest first. */
  swaps: PresetSwap[];
  /** Final-slot doubling setting, default on. */
  lastGameDouble: boolean;
  /** The enabled roster the preset was resolved against. */
  enabledGames: string[];
  /** Late joiners added mid-game, scored from the next slot only. */
  ineligibleThisSlot: string[];

  // --- Shared ---
  status: SessionStatus;
  currentGameId: string | null;
  played: string[];
  stats: Record<string, SessionPlayerStat>; // playerId
  rounds: SessionRoundResult[];
  accuracy: Record<string, { correct: number; answered: number; fastestMs: number | null }>;
  /** All per-player stats merged across rounds; powers the finale awards. */
  awardStats: Record<string, Record<string, number>>;
  trophies: SessionTrophy[];
  awards: AwardWinner[];
  champion: { playerId: string; name: string; points: number } | null;

  // --- Legacy vote/random mode (kept until the transport moves over) ---
  length: number;
  selection: SessionSelection;
  round: number;
  candidates: SessionGame[];
  votes: Record<string, string>; // playerId -> gameId
}

interface PlayerLike {
  id: string;
  name: string;
  connected?: boolean;
  presence?: string;
  spectator?: boolean;
}

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

/** Players who count for the Rumble: connected, present and not spectating. */
function activePlayerCount(players: PlayerLike[]): number {
  return players.filter(
    (p) =>
      p.spectator !== true &&
      p.connected !== false &&
      (p.presence === undefined || p.presence === "active"),
  ).length;
}

function emptyStats(players: PlayerLike[]): Record<string, SessionPlayerStat> {
  const stats: Record<string, SessionPlayerStat> = {};
  for (const p of players) {
    stats[p.id] = emptyStat(p);
  }
  return stats;
}

function emptyStat(player: PlayerLike): SessionPlayerStat {
  return {
    playerId: player.id,
    name: player.name,
    points: 0,
    wins: 0,
    podiums: 0,
    lastPlaces: 0,
    bestSingle: 0,
  };
}

function defaultEnabledGameIds(): string[] {
  return Object.values(GAME_CATALOG)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.id);
}

function displayName(id: string): string {
  return catalogEntry(id)?.displayName ?? id;
}

function firstPlayableIndex(slots: ResolvedSlot[], from = 0): number {
  for (let i = from; i < slots.length; i++) {
    if (slots[i].gameId !== null) return i;
  }
  return -1;
}

function countPlayable(slots: ResolvedSlot[]): number {
  return slots.filter((slot) => slot.gameId !== null).length;
}

export function createSession(
  players: PlayerLike[],
  games: SessionGame[],
  length: number,
  selection?: SessionSelection,
): SessionState;
export function createSession(
  players: PlayerLike[],
  preset: RumblePreset,
  enabledGames?: readonly string[],
  options?: SessionOptions,
): SessionState;
export function createSession(
  players: PlayerLike[],
  presetOrGames: RumblePreset | SessionGame[],
  lengthOrEnabled?: number | readonly string[],
  selectionOrOptions?: SessionSelection | SessionOptions,
): SessionState {
  if (Array.isArray(presetOrGames)) {
    return createLegacySession(
      players,
      presetOrGames,
      Number(lengthOrEnabled ?? 1),
      (selectionOrOptions as SessionSelection | undefined) ?? "vote",
    );
  }
  return createPresetSession(
    players,
    presetOrGames,
    lengthOrEnabled as readonly string[] | undefined,
    selectionOrOptions as SessionOptions | undefined,
  );
}

function createPresetSession(
  players: PlayerLike[],
  preset: RumblePreset,
  enabledGames?: readonly string[],
  options?: SessionOptions,
): SessionState {
  const enabled = enabledGames ? [...enabledGames] : defaultEnabledGameIds();
  const resolution = resolvePreset(preset, activePlayerCount(players), [], enabled);
  const session: SessionState = {
    presetId: preset.id,
    presetName: preset.name,
    preset,
    slots: resolution.slots,
    slotIndex: 0,
    swaps: [...resolution.swaps],
    lastGameDouble: options?.lastGameDouble ?? true,
    enabledGames: enabled,
    ineligibleThisSlot: [],
    status: "interlude",
    currentGameId: null,
    played: [],
    stats: emptyStats(players),
    rounds: [],
    accuracy: {},
    awardStats: {},
    trophies: [],
    awards: [],
    champion: null,
    length: countPlayable(resolution.slots),
    selection: "preset",
    round: 1,
    candidates: [],
    votes: {},
  };

  const first = firstPlayableIndex(session.slots);
  if (first === -1) {
    finishPreset(session);
    return session;
  }
  session.slotIndex = first;
  session.currentGameId = session.slots[first].gameId;
  return session;
}

function createLegacySession(
  players: PlayerLike[],
  games: SessionGame[],
  length: number,
  selection: SessionSelection,
): SessionState {
  const candidates = eligibleGames(games, players.length, []);
  const effectiveLength = Math.max(1, Math.min(length, candidates.length));
  const session: SessionState = {
    presetId: "",
    presetName: "",
    preset: null,
    slots: [],
    slotIndex: 0,
    swaps: [],
    lastGameDouble: false,
    enabledGames: [],
    ineligibleThisSlot: [],
    status: "voting",
    currentGameId: null,
    played: [],
    stats: emptyStats(players),
    rounds: [],
    accuracy: {},
    awardStats: {},
    trophies: [],
    awards: [],
    champion: null,
    length: effectiveLength,
    selection,
    round: 1,
    candidates,
    votes: {},
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
  if (session.selection === "preset") return null;
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
  if (session.selection === "preset") return [];
  return session.candidates.map((game) => ({
    gameId: game.id,
    name: game.name,
    count: Object.values(session.votes).filter((v) => v === game.id).length,
  }));
}

/**
 * Start the current round. In preset mode only the resolved game for the
 * current slot is accepted; the host may start it once the interlude is over.
 */
export function startRound(session: SessionState, gameId: string): boolean {
  if (session.selection === "preset") {
    if (session.status !== "interlude") return false;
    const slot = session.slots[session.slotIndex];
    if (!slot || slot.gameId !== gameId) return false;
    session.status = "playing";
    session.currentGameId = gameId;
    return true;
  }

  if (session.status !== "voting") return false;
  if (!session.candidates.some((g) => g.id === gameId)) return false;
  session.status = "playing";
  session.currentGameId = gameId;
  session.votes = {};
  return true;
}

/**
 * Leave the between-game card and begin the already-resolved current slot.
 * Equivalent to calling `startRound` with the slot's game.
 */
export function beginNextGame(session: SessionState): boolean {
  if (session.selection !== "preset") return false;
  if (session.status !== "interlude") return false;
  const slot = session.slots[session.slotIndex];
  if (!slot?.gameId) return false;
  session.status = "playing";
  session.currentGameId = slot.gameId;
  return true;
}

/** Abort a running round without awarding points; reopen the same round. */
export function abortRound(session: SessionState): void {
  if (session.status !== "playing") return;

  if (session.selection === "preset") {
    session.status = "interlude";
    session.currentGameId = session.slots[session.slotIndex]?.gameId ?? null;
    return;
  }

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
  const presetMode = session.selection === "preset";
  // The presets' final surviving slot pays double; decide before advancing.
  const doubled = presetMode && session.lastGameDouble && isFinalSurvivingSlot(session, gameId, players);
  const results = placements.map((p) => ({
    ...p,
    points: pointsForPlace(p.place) * (doubled ? 2 : 1),
  }));

  // Raw scores and stats sit beside the unchanged placement points. A game
  // result is preferred; otherwise derive it from the screen it already shows.
  const result = gameResult
    ? normaliseGameResult(gameResult, players)
    : resultFromScreen(screen, players, gameId);
  const raw: Record<string, number> = {};
  for (const standing of result.standings) raw[standing.playerId] = standing.raw;
  const roundStats = perPlayerStats(result.stats, players);

  const ineligible = new Set(presetMode ? session.ineligibleThisSlot : []);
  for (const r of results) {
    const stat = session.stats[r.playerId];
    if (!stat) continue;
    // A player added during this game starts scoring from the next slot.
    if (ineligible.has(r.playerId)) continue;
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

  if (presetMode) {
    advancePreset(session, players);
    return;
  }

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

/**
 * True when no playable slot would remain after this game. The probe uses the
 * current connected player count and the used ids, exactly like the real
 * re-resolution that follows.
 */
function isFinalSurvivingSlot(session: SessionState, gameId: string, players: PlayerLike[]): boolean {
  const preset = session.preset;
  if (!preset) return false;
  const remaining = preset.slots.slice(session.slotIndex + 1);
  if (remaining.length === 0) return true;
  const resolution = resolvePreset(
    { ...preset, slots: remaining },
    activePlayerCount(players),
    [...session.played, gameId],
    session.enabledGames,
  );
  return resolution.slots.every((slot) => slot.gameId === null);
}

/**
 * Move past the round just recorded: re-resolve every remaining slot for the
 * current connected player count, append the swap announcements and park on the
 * next playable slot (or finish).
 */
function advancePreset(session: SessionState, players: PlayerLike[]): void {
  session.ineligibleThisSlot = [];
  session.slotIndex++;

  const preset = session.preset;
  const remaining = preset ? preset.slots.slice(session.slotIndex) : [];
  if (!preset || remaining.length === 0) {
    finishPreset(session);
    return;
  }

  const resolution = resolvePreset(
    { ...preset, slots: remaining },
    activePlayerCount(players),
    session.played,
    session.enabledGames,
  );
  session.slots = [...session.slots.slice(0, session.slotIndex), ...resolution.slots];
  session.swaps.push(...resolution.swaps);
  session.length = countPlayable(session.slots);

  const next = firstPlayableIndex(session.slots, session.slotIndex);
  if (next === -1) {
    finishPreset(session);
    return;
  }
  session.slotIndex = next;
  session.currentGameId = session.slots[next].gameId;
  session.status = "interlude";
  session.round = session.rounds.length + 1;
}

function finishPreset(session: SessionState): void {
  session.status = "finished";
  session.currentGameId = null;
  session.ineligibleThisSlot = [];
  session.slotIndex = session.slots.length;
  session.round = session.rounds.length;
  finalise(session);
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

/**
 * Add a phone that joined after the Rumble began. They enter on the current
 * lowest score (never ahead) and score from the next slot; a player added
 * while a game is running is skipped for that game.
 */
export function addLatePlayer(session: SessionState, player: PlayerLike): boolean {
  if (session.status === "finished") return false;
  if (session.stats[player.id]) return false;

  const scores = Object.values(session.stats).map((stat) => stat.points);
  const points = scores.length > 0 ? Math.min(...scores) : 0;
  session.stats[player.id] = { ...emptyStat(player), points };

  if (session.status === "playing") session.ineligibleThisSlot.push(player.id);
  return true;
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

/** The resolved game for the slot after the current one, if any. */
function nextGameId(session: SessionState): string | null {
  if (session.selection !== "preset" || session.status === "finished") return null;
  for (let i = session.slotIndex + 1; i < session.slots.length; i++) {
    const gameId = session.slots[i].gameId;
    if (gameId) return gameId;
  }
  return null;
}

function slotView(slot: ResolvedSlot): SessionSlotView {
  return {
    originalId: slot.originalId,
    originalName: displayName(slot.originalId),
    gameId: slot.gameId,
    gameName: slot.gameId ? displayName(slot.gameId) : null,
    ...(slot.options ? { options: { ...slot.options } } : {}),
    announcement: slot.announcement,
  };
}

function roundView(round: SessionRoundResult): SessionRoundView {
  return {
    gameId: round.gameId,
    gameName: round.gameName,
    results: round.results.map((result) => ({ ...result })),
    raw: { ...round.raw },
    ...(round.stats ? { stats: cloneStatMap(round.stats) } : {}),
  };
}

function cloneNumberMap(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) out[key] = value;
  return out;
}

function cloneStatMap(
  map: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [playerId, values] of Object.entries(map)) out[playerId] = cloneNumberMap(values);
  return out;
}

export function sessionView(session: SessionState): SessionView {
  const standings = Object.values(session.stats).sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.bestSingle - a.bestSingle ||
      a.name.localeCompare(b.name),
  );
  const presetMode = session.selection === "preset";
  return {
    presetId: session.presetId,
    presetName: session.presetName,
    slots: presetMode ? session.slots.map(slotView) : [],
    slotIndex: session.slotIndex,
    nextGameId: nextGameId(session),
    rounds: session.rounds.map(roundView),
    lastGameDouble: session.lastGameDouble,
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

/** JSON-safe snapshot for persistence; safe to `JSON.stringify`. */
export interface SessionSummary {
  presetId: string;
  presetName: string;
  slotIndex: number;
  slots: ResolvedSlot[];
  swaps: PresetSwap[];
  status: SessionStatus;
  currentGameId: string | null;
  played: string[];
  rounds: SessionRoundResult[];
  stats: Record<string, SessionPlayerStat>;
  accuracy: Record<string, { correct: number; answered: number; fastestMs: number | null }>;
  awardStats: Record<string, Record<string, number>>;
  trophies: SessionTrophy[];
  awards: AwardWinner[];
  champion: { playerId: string; name: string; points: number } | null;
  lastGameDouble: boolean;
  enabledGames: string[];
  length: number;
}

export function sessionSummary(session: SessionState): SessionSummary {
  const slots: ResolvedSlot[] = session.slots.map((slot) => ({
    originalId: slot.originalId,
    gameId: slot.gameId,
    ...(slot.options ? { options: { ...slot.options } } : {}),
    announcement: slot.announcement,
  }));
  const swaps: PresetSwap[] = session.swaps.map((swap) => ({ ...swap }));
  const rounds: SessionRoundResult[] = session.rounds.map((round) => ({
    gameId: round.gameId,
    gameName: round.gameName,
    results: round.results.map((result) => ({ ...result })),
    raw: cloneNumberMap(round.raw),
    ...(round.stats ? { stats: cloneStatMap(round.stats) } : {}),
  }));
  const stats: Record<string, SessionPlayerStat> = {};
  for (const [playerId, stat] of Object.entries(session.stats)) stats[playerId] = { ...stat };
  const accuracy: SessionSummary["accuracy"] = {};
  for (const [playerId, value] of Object.entries(session.accuracy)) accuracy[playerId] = { ...value };
  const awardStats: Record<string, Record<string, number>> = {};
  for (const [playerId, values] of Object.entries(session.awardStats)) {
    awardStats[playerId] = cloneNumberMap(values);
  }
  return {
    presetId: session.presetId,
    presetName: session.presetName,
    slotIndex: session.slotIndex,
    slots,
    swaps,
    status: session.status,
    currentGameId: session.currentGameId,
    played: [...session.played],
    rounds,
    stats,
    accuracy,
    awardStats,
    trophies: session.trophies.map((trophy) => ({ ...trophy })),
    awards: session.awards.map((award) => ({ ...award })),
    champion: session.champion ? { ...session.champion } : null,
    lastGameDouble: session.lastGameDouble,
    enabledGames: [...session.enabledGames],
    length: session.length,
  };
}
