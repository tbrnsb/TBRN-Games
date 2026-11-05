/**
 * Most Likely To - Server Logic
 * Vote on who's most likely to do something.
 *
 * The existing scoring rule is deliberately unchanged: the top vote-getter
 * takes `max * 10` and voters never receive a bonus. That keeps 3- and
 * 4-player results identical to the pre-expansion game (see docs/DECISIONS.md).
 */

import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores, type GameResult } from "../../shared/scoring.ts";
import { secureShuffle } from "../../shared/secure-random.ts";

interface GameManifest { id: string; name: string; minPlayers: number; maxPlayers: number; controllerType: ControllerType; description: string; }
type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand"
  | "slider"
  | "dual-slider"
  | "pad"
  | "aim"
  | "tap-race"
  | "board"
  | "numpad"
  | "canvas"
  | "chat";
interface Player { id: string; name: string; joinedAt: number; rejoinToken: string; connected: boolean; controllerType?: string; }
interface RoomState { id: string; code: string; hostPlayerId: string | null; players: Player[]; gameId: string | null; gameState: unknown | null; createdAt: number; status: "lobby" | "playing" | "finished"; }
interface GameInstance { roomId: string; players: Player[]; state: unknown; }
interface GamePlugin { manifest: GameManifest; onStart(room: RoomState, players: Player[]): GameInstance; onInput(instance: GameInstance, playerId: string, input: unknown): void; onTick(instance: GameInstance, deltaMs: number): void; screenState(instance: GameInstance): unknown; controllerState(instance: GameInstance, playerId: string): unknown; results?(instance: GameInstance): GameResult; }

/**
 * General-table prompts only: no private or sensitive traits (health, money,
 * politics, religion, identity), so any group can play without a target.
 */
const PROMPTS = [
  "Most likely to become a billionaire", "Most likely to survive a zombie apocalypse",
  "Most likely to accidentally reply all", "Most likely to get lost in their own city",
  "Most likely to adopt 10 cats", "Most likely to win a hot dog eating contest",
  "Most likely to forget their own birthday", "Most likely to talk their way out of a ticket",
  "Most likely to start a band", "Most likely to become a meme",
  "Most likely to sleep through an earthquake", "Most likely to cry at a commercial",
  "Most likely to accidentally send a text to the wrong person", "Most likely to win big at a carnival game",
  "Most likely to have a secret talent", "Most likely to become a superhero",
  "Most likely to survive on a deserted island", "Most likely to talk to animals",
  "Most likely to invent something useless", "Most likely to become a game show host",
  "Most likely to forget where they parked", "Most likely to win a dance-off"
];
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** Standalone rounds; the catalog reports 5 for rumble (brief 4). */
const STANDALONE_ROUNDS = 8;
/** Points per vote the round winner received. Unchanged from the original game. */
const POINTS_PER_VOTE = 10;
const VOTE_MS = 15000;
/** A short drum-roll beat between the ballot closing and the result. */
const TALLY_MS = 2000;
const REVEAL_MS = 4000;

interface MostLikelyState {
  prompts: string[]; currentPrompt: number; phase: "voting" | "tally" | "reveal" | "finished";
  votes: Map<number, Map<string, string>>; // promptIndex -> voterId -> targetId
  scores: number[]; timeLeft: number; roundWinner: number | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}
interface MostLikelyInstance extends GameInstance { state: MostLikelyState; }

const manifest: GameManifest = { id: "mostlikely", name: "Most Likely To", minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, controllerType: "choice", description: "Vote on who's most likely to do something. Anonymous voting, reveal results." };

function bumpStat(state: MostLikelyState, playerId: string, stat: "votesReceived" | "mostLikelyWins"): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}

/** Who the TV is waiting on: every player without a ballot in the current round. */
function waitingNames(instance: MostLikelyInstance): string[] {
  const state = instance.state;
  if (state.phase !== "voting") return [];
  const votes = state.votes.get(state.currentPrompt);
  return instance.players.filter((player) => !votes?.has(player.id)).map((player) => player.name);
}

/** Public vote counts per seat, or null until the reveal phase. */
function voteRows(instance: MostLikelyInstance): Array<{ name: string; count: number; seat: number; won: boolean }> | null {
  const state = instance.state;
  if (state.phase !== "reveal") return null;
  const counts = new Map<string, number>();
  state.votes.get(state.currentPrompt)?.forEach((targetId) => {
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  });
  return instance.players
    .map((player, seat) => ({
      name: player.name,
      count: counts.get(player.id) ?? 0,
      seat,
      won: seat === state.roundWinner,
    }))
    .sort((a, b) => b.count - a.count || a.seat - b.seat);
}

/** The result line only exists once the tally has been revealed. */
function revealCaption(instance: MostLikelyInstance): string | null {
  const state = instance.state;
  if (state.phase !== "reveal" || state.roundWinner === null) return null;
  const winner = instance.players[state.roundWinner];
  if (!winner) return null;
  const count = state.votes.get(state.currentPrompt)
    ? Array.from(state.votes.get(state.currentPrompt)!.values()).filter((id) => id === winner.id).length
    : 0;
  if (count === 0) return null;
  return captionFor({ kind: "favourite", name: winner.name, count, seed: state.currentPrompt });
}

function beginTally(state: MostLikelyState): void {
  state.phase = "tally";
  state.timeLeft = TALLY_MS;
}

function beginReveal(state: MostLikelyState, players: Player[]): void {
  state.phase = "reveal";
  state.timeLeft = REVEAL_MS;
  scoreRound(state, players);
}

function beginVoting(state: MostLikelyState): void {
  state.phase = "voting";
  state.timeLeft = VOTE_MS;
  state.roundWinner = null;
}

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): MostLikelyInstance {
    const shuffled = secureShuffle(PROMPTS).slice(0, STANDALONE_ROUNDS);
    return {
      roomId: room.id,
      players,
      state: {
        prompts: shuffled,
        currentPrompt: 0,
        phase: "voting",
        votes: new Map(),
        scores: players.map(() => 0),
        timeLeft: VOTE_MS,
        roundWinner: null,
        stats: Object.fromEntries(
          players.flatMap((player): Array<[string, number]> => [
            [playerStatKey(player.id, "votesReceived"), 0],
            [playerStatKey(player.id, "mostLikelyWins"), 0],
          ]),
        ),
      } satisfies MostLikelyState,
    };
  },
  onInput(instance: MostLikelyInstance, playerId: string, input: unknown): void {
    const state = instance.state; if (state.phase !== "voting") return;
    const voterIndex = instance.players.findIndex(p => p.id === playerId); if (voterIndex === -1) return;
    const choice = input as { choice?: string }; if (!choice?.choice) return;
    const targetIndex = parseInt(choice.choice); if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= instance.players.length) return;
    if (!state.votes.has(state.currentPrompt)) state.votes.set(state.currentPrompt, new Map());
    // Voting for yourself is allowed, and a later pick replaces an earlier one
    // until the ballot closes.
    state.votes.get(state.currentPrompt)!.set(playerId, instance.players[targetIndex].id);
    const roundVotes = state.votes.get(state.currentPrompt)!;
    if (instance.players.every((player) => roundVotes.has(player.id))) beginTally(state);
  },
  onTick(instance: MostLikelyInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;
    state.timeLeft -= Math.min(Math.max(deltaMs, 0), 2000);
    if (state.timeLeft > 0) return;

    if (state.phase === "voting") { beginTally(state); return; }
    if (state.phase === "tally") { beginReveal(state, instance.players); return; }
    if (state.phase === "reveal") {
      state.currentPrompt++;
      if (state.currentPrompt >= state.prompts.length) { state.phase = "finished"; return; }
      beginVoting(state);
    }
  },
  screenState(instance: MostLikelyInstance): unknown {
    const state = instance.state; const prompt = state.prompts[state.currentPrompt];
    const votes = voteRows(instance);
    return {
      prompt,
      currentPrompt: state.currentPrompt + 1,
      totalPrompts: state.prompts.length,
      phase: state.phase,
      timeLeft: Math.max(0, state.timeLeft),
      players: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })),
      // The tally stays off the shared screen until the reveal phase.
      votes,
      roundWinner: state.phase === "reveal" && state.roundWinner !== null
        ? instance.players[state.roundWinner]?.name ?? null
        : null,
      waitingOn: waitingNames(instance),
      caption: revealCaption(instance),
      sound: state.phase === "tally" ? "vote" : state.phase === "reveal" ? "reveal" : null,
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },
  controllerState(instance: MostLikelyInstance, playerId: string): unknown {
    const state = instance.state; const voterIndex = instance.players.findIndex(p => p.id === playerId);
    if (voterIndex === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const roundVotes = state.votes.get(state.currentPrompt);
    const selectedTarget = roundVotes?.get(playerId) ?? null;
    const hasVoted = selectedTarget !== null;
    const options = instance.players.map((p, i) => ({
      id: String(i),
      label: p.name,
      selected: selectedTarget === p.id,
    }));
    return {
      prompt: state.prompts[state.currentPrompt],
      options,
      hasVoted,
      canChangeVote: state.phase === "voting" && state.timeLeft > 0,
      yourScore: state.scores[voterIndex],
      timeLeft: Math.max(0, state.timeLeft),
      phase: state.phase,
      currentPrompt: state.currentPrompt + 1,
      totalPrompts: state.prompts.length,
      info: state.phase === "tally"
        ? "Tallying the votes…"
        : state.phase === "reveal" && state.roundWinner !== null
          ? `${instance.players[state.roundWinner]?.name ?? "Someone"} took the round`
          : "",
      finished: state.phase === "finished",
      youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[voterIndex].name : false,
    };
  },
  results(instance: MostLikelyInstance): GameResult {
    const state = instance.state;
    return {
      standings: standingsFromScores(
        instance.players.map((player, i) => ({ id: player.id, raw: state.scores[i] })),
      ),
      stats: { ...state.stats },
    };
  }
};

function scoreRound(state: MostLikelyState, players: Player[]): void {
  const votes = state.votes.get(state.currentPrompt); if (!votes) return;
  const counts = new Map<string, number>();
  votes.forEach(targetId => {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
    bumpStat(state, targetId, "votesReceived");
  });
  // Unchanged rule: first target to reach the top count wins, and the winner
  // takes `max * 10`. No voter bonus is paid.
  let max = 0, winnerId = ""; counts.forEach((count, id) => { if (count > max) { max = count; winnerId = id; } });
  if (winnerId) {
    const winnerIdx = players.findIndex(p => p.id === winnerId);
    if (winnerIdx >= 0) {
      state.scores[winnerIdx] += max * POINTS_PER_VOTE;
      state.roundWinner = winnerIdx;
      bumpStat(state, winnerId, "mostLikelyWins");
    }
  }
}
function getWinner(instance: MostLikelyInstance): { name: string; score: number } | null { const state = instance.state; let best = -1, idx = -1; state.scores.forEach((s,i) => { if (s > best) { best = s; idx = i; } }); if (idx >= 0) return { name: instance.players[idx].name, score: best }; return null; }

export default plugin;
