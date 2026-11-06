/**
 * Royal Rumble session engine (pure logic).
 *
 * A session plays a pre-built playlist (a preset) of up to eight games back to
 * back, with one running leaderboard. Each round awards placement points, then
 * the remaining slots are re-resolved for the players still in the room. After
 * the last surviving slot the champion and honorary trophies are computed.
 *
 * A session always plays a preset (brief section 6); vote selection was removed
 * with the transport move. The old vote/random helpers are gone so no session
 * state can carry a half-voted, half-preset playlist.
 */

import type { SessionRoundView, SessionSlotView, SessionView } from "../shared/types.ts";
import { computeAwards, type AwardWinner } from "../shared/awards.ts";
import { GAME_CATALOG, catalogEntry, type GameCatalogEntry } from "../shared/game-catalog.ts";
import {
  resolvePreset,
  type PresetSwap,
  type ResolvedSlot,
  type RumblePreset,
} from "../shared/rumble-presets.ts";
import { normaliseGameResult, perPlayerStats, resultFromScreen } from "../shared/results.ts";
import type { GameResult } from "../shared/scoring.ts";

export type SessionStatus = "voting" | "playing" | "interlude" | "finished";

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

/**
 * Options passed into `onStart` for one preset-Rumble game.
 *
 * Every preset game runs in `mode: "rumble"` (brief section 6), with the round
 * count the catalog reports for this table, so the started game matches the
 * short Rumble length instead of its standalone one. A slot's own mode wins
 * over the generic default: Quiz in "Friday Night at Mo's" keeps `"fast"`, and
 * Big Brain Sunday keeps `"standard"`, while both get the Rumble round count.
 */
export function rumbleSlotOptions(
  gameId: string,
  slotOptions: Record<string, unknown> | undefined,
  playerCount: number,
): Record<string, unknown> {
  const entry = catalogEntry(gameId);
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  const rounds = entry?.scale(count, "rumble").rounds;
  return {
    ...(slotOptions ?? {}),
    rumble: true,
    mode: slotOptions?.mode ?? "rumble",
    ...(rounds !== undefined ? { rounds } : {}),
  };
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

  /** Playable slots in the resolved playlist (for the view's old `length`). */
  length: number;
  /** 1-based round number shown by the clients. */
  round: number;
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
  preset: RumblePreset,
  enabledGames?: readonly string[],
  options?: SessionOptions,
): SessionState {
  return createPresetSession(players, preset, enabledGames, options);
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
    round: 1,
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

/**
 * Start the current round. Only the resolved game for the current slot is
 * accepted; the host may start it once the interlude is over.
 */
export function startRound(session: SessionState, gameId: string): boolean {
  if (session.status !== "interlude") return false;
  const slot = session.slots[session.slotIndex];
  if (!slot || slot.gameId !== gameId) return false;
  session.status = "playing";
  session.currentGameId = gameId;
  return true;
}

/**
 * Leave the between-game card and begin the current slot.
 *
 * When the current roster is supplied the remaining slots are re-resolved for
 * the players actually connected, so a lineup never runs a game that stopped
 * fitting during the interlude. Swaps are appended once and announced.
 */
export function beginNextGame(session: SessionState, players?: PlayerLike[]): boolean {
  if (session.status !== "interlude") return false;
  if (players) {
    if (!resolveFrom(session, players, session.slotIndex, true)) {
      finishPreset(session);
      return false;
    }
  }
  const slot = session.slots[session.slotIndex];
  if (!slot?.gameId) return false;
  session.status = "playing";
  session.currentGameId = slot.gameId;
  return true;
}

/** Abort a running round without awarding points; reopen the same round. */
export function abortRound(session: SessionState): void {
  if (session.status !== "playing") return;
  session.status = "interlude";
  session.currentGameId = session.slots[session.slotIndex]?.gameId ?? null;
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
  // The presets' final surviving slot pays double; decide before advancing.
  const doubled = session.lastGameDouble && isFinalSurvivingSlot(session, gameId, players);
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

  const ineligible = new Set(session.ineligibleThisSlot);
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

  advancePreset(session, players);
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

function swapKey(swap: PresetSwap): string {
  return `${swap.from}|${swap.to}|${swap.reason}`;
}

/** Append only swaps the session has not announced before. */
function appendSwaps(session: SessionState, swaps: PresetSwap[], dedupe = false): void {
  if (!dedupe) {
    session.swaps.push(...swaps);
    return;
  }
  const seen = new Set(session.swaps.map(swapKey));
  for (const swap of swaps) {
    const key = swapKey(swap);
    if (seen.has(key)) continue;
    seen.add(key);
    session.swaps.push(swap);
  }
}

/** Games already played or already planned in a different slot. */
function usedSlotIds(session: SessionState, exceptIndex: number): Set<string> {
  const used = new Set(session.played);
  session.slots.forEach((slot, index) => {
    if (index !== exceptIndex && slot.gameId) used.add(slot.gameId);
  });
  return used;
}

function fitsCatalogEntry(entry: GameCatalogEntry | undefined, playerCount: number): boolean {
  return !!entry && entry.enabled && playerCount >= entry.minPlayers && playerCount <= entry.maxPlayers;
}

/**
 * Re-resolve every slot from `fromIndex` for the current connected players.
 * The playlist's already-played slots stay untouched. Returns true when a
 * playable slot was found (and parks `slotIndex` on it).
 */
function resolveFrom(
  session: SessionState,
  players: PlayerLike[],
  fromIndex: number,
  dedupeSwaps = false,
): boolean {
  const preset = session.preset;
  if (!preset) return false;
  const remaining = preset.slots.slice(fromIndex);
  if (remaining.length === 0) return false;

  const previous = session.slots.slice();
  const resolution = resolvePreset(
    { ...preset, slots: remaining },
    activePlayerCount(players),
    session.played,
    session.enabledGames,
  );
  const resolved = resolution.slots.map((slot, index) => {
    const old = previous[fromIndex + index];
    // A host skip already announced this exact game; keep that line and the
    // preset's original slot when the slot is re-resolved.
    if (!slot.announcement && old?.gameId === slot.gameId && old.announcement) {
      return { ...slot, originalId: old.originalId, announcement: old.announcement };
    }
    return slot;
  });
  session.slots = [...session.slots.slice(0, fromIndex), ...resolved];
  appendSwaps(session, resolution.swaps, dedupeSwaps);
  session.length = countPlayable(session.slots);

  const next = firstPlayableIndex(session.slots, fromIndex);
  if (next === -1) return false;
  session.slotIndex = next;
  session.currentGameId = session.slots[next].gameId;
  return true;
}

/**
 * Move past the round just recorded: re-resolve every remaining slot for the
 * current connected player count, append the swap announcements and park on the
 * next playable slot (or finish).
 */
function advancePreset(session: SessionState, players: PlayerLike[]): void {
  session.ineligibleThisSlot = [];
  session.slotIndex++;

  if (!resolveFrom(session, players, session.slotIndex)) {
    finishPreset(session);
    return;
  }

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

/**
 * Swap the next unplayed slot for an enabled game the host chose, or a
 * resolver-style fallback. A game that has already started is never touched,
 * so while a game is running the slot after it is the target; during the
 * interlude the upcoming slot itself is the target.
 *
 * Returns the recorded swap, or null when there is no next slot or no valid
 * replacement.
 */
export function skipNextGame(
  session: SessionState,
  players: PlayerLike[],
  gameId?: string,
): { from: string; to: string; announcement: string } | null {
  if (session.status === "finished" || !session.preset) return null;

  const fromIndex = session.status === "interlude" ? session.slotIndex : session.slotIndex + 1;
  let target = -1;
  for (let index = fromIndex; index < session.slots.length; index++) {
    if (session.slots[index].gameId) {
      target = index;
      break;
    }
  }
  if (target === -1) return null;

  const current = session.slots[target].gameId;
  if (!current) return null;

  const active = activePlayerCount(players);
  const used = usedSlotIds(session, target);
  const enabled = new Set(session.enabledGames);
  const valid = (id: string): boolean => {
    if (used.has(id) || !enabled.has(id)) return false;
    return fitsCatalogEntry(catalogEntry(id), active);
  };

  let replacement = typeof gameId === "string" && valid(gameId) ? gameId : null;
  if (!replacement) replacement = session.preset.bench.find(valid) ?? null;
  if (!replacement) {
    const kind = catalogEntry(current)?.kind;
    if (kind) {
      for (const entry of Object.values(GAME_CATALOG)) {
        if (entry.kind !== kind) continue;
        if (valid(entry.id)) {
          replacement = entry.id;
          break;
        }
      }
    }
  }
  if (!replacement) return null;
  if (replacement === current) return null;

  const announcement = `${displayName(current)} was swapped for ${displayName(replacement)}.`;

  // Persist the host's choice in this session's copy of the playlist so the
  // next re-resolution keeps the swap instead of restoring the preset slot.
  session.preset = {
    ...session.preset,
    slots: session.preset.slots.map((slot, index) =>
      index === target ? { gameId: replacement } : slot,
    ),
  };
  session.slots[target] = {
    originalId: session.slots[target].originalId,
    gameId: replacement,
    announcement,
  };
  if (target === session.slotIndex) session.currentGameId = replacement;

  const swap = {
    from: current,
    to: replacement,
    reason: `Host swapped ${displayName(current)}`,
    announcement,
  };
  appendSwaps(session, [swap]);
  return { from: current, to: replacement, announcement };
}

/** End the Rumble early and crown the current leader (trophies included). */
export function endSessionEarly(session: SessionState): void {
  if (session.status === "finished") return;
  session.ineligibleThisSlot = [];
  finishPreset(session);
}

/**
 * Rebuild a session from an on-disk summary. A stored `playing` status becomes
 * an interlude: the running game instance is not part of the snapshot, so the
 * host restarts that slot rather than resuming a game with no state.
 */
export function restoreSession(summary: SessionSummary, preset: RumblePreset | null): SessionState {
  const playing = summary.status === "playing";
  const status: SessionStatus = playing ? "interlude" : summary.status;
  return {
    presetId: summary.presetId,
    presetName: summary.presetName,
    preset,
    slots: summary.slots.map((slot) => ({
      originalId: slot.originalId,
      gameId: slot.gameId,
      ...(slot.options ? { options: { ...slot.options } } : {}),
      announcement: slot.announcement,
    })),
    slotIndex: summary.slotIndex,
    swaps: summary.swaps.map((swap) => ({ ...swap })),
    lastGameDouble: summary.lastGameDouble,
    enabledGames: [...summary.enabledGames],
    ineligibleThisSlot: [],
    status,
    currentGameId: playing
      ? summary.slots[summary.slotIndex]?.gameId ?? null
      : summary.currentGameId,
    played: [...summary.played],
    stats: Object.fromEntries(
      Object.entries(summary.stats).map(([playerId, stat]) => [playerId, { ...stat }]),
    ),
    rounds: summary.rounds.map((round) => ({
      gameId: round.gameId,
      gameName: round.gameName,
      results: round.results.map((result) => ({ ...result })),
      raw: cloneNumberMap(round.raw),
      ...(round.stats ? { stats: cloneStatMap(round.stats) } : {}),
    })),
    accuracy: Object.fromEntries(
      Object.entries(summary.accuracy).map(([playerId, value]) => [playerId, { ...value }]),
    ),
    awardStats: Object.fromEntries(
      Object.entries(summary.awardStats).map(([playerId, values]) => [playerId, cloneNumberMap(values)]),
    ),
    trophies: summary.trophies.map((trophy) => ({ ...trophy })),
    awards: summary.awards.map((award) => ({ ...award })),
    champion: summary.champion ? { ...summary.champion } : null,
    length: summary.length,
    round: summary.status === "finished" ? summary.rounds.length : summary.rounds.length + 1,
  };
}

/** The resolved game for the slot after the current one, if any. */
function nextGameId(session: SessionState): string | null {
  if (session.status === "finished") return null;
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
  return {
    presetId: session.presetId,
    presetName: session.presetName,
    slots: session.slots.map(slotView),
    slotIndex: session.slotIndex,
    nextGameId: nextGameId(session),
    rounds: session.rounds.map(roundView),
    lastGameDouble: session.lastGameDouble,
    length: session.length,
    // Kept for the current clients while they move to preset slots. The vote
    // fields are inert: no session can switch into vote selection any more.
    selection: "preset",
    status: session.status,
    round: session.round,
    played: [...session.played],
    currentGameId: session.currentGameId,
    leadingGameId: null,
    candidates: [],
    votes: [],
    voted: 0,
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
