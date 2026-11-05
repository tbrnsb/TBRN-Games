/**
 * Survive the Internet - server logic.
 * Answer innocently, twist someone else's answer into a headline, vote for the funniest.
 *
 * Pairing rules (brief 4, 3-6 players): each round assigns a derangement
 * `pairing[writer] = quoted`, so every player writes exactly one headline for
 * someone else's answer and nobody quotes themselves. The ballot has one slot
 * per pairing, and a player can never vote for a pairing they are part of
 * (neither as the writer nor as the quoted answer).
 */

import { secureShuffle } from "../../shared/secure-random.ts";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import {
  MAX_ROUND_SCORE,
  scalePayout,
  standingsFromScores,
  type GameResult,
} from "../../shared/scoring.ts";

interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
}

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

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
}

interface RoomState {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: unknown;
}

interface GamePlugin {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  results?(instance: GameInstance): GameResult;
}

interface SurviveState {
  round: number;
  maxRounds: number;
  phase: "answering" | "twisting" | "voting" | "reveal" | "finished";
  prompt: string;
  answers: Array<string | null>;
  twists: Array<string | null>;
  /** `pairing[writer] = quoted player`; a derangement, so nobody quotes themselves. */
  pairing: number[];
  /** `votes[voter] = pairing index` (the writing seat of that pairing). */
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: Array<{ twister: number; author: number; votes: number }> | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface SurviveInstance extends GameInstance { state: SurviveState }

const PROMPTS = [
  "What is your favourite food?",
  "What is the last thing you bought?",
  "Where did you go on your last holiday?",
  "What is your most used app?",
  "What is your comfort movie?",
  "What is the weirdest thing in your bag?",
];

const ANSWER_MS = 45000;
const TWIST_MS = 40000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_TEXT = 100;

/** Per-vote payouts, before `scalePayout` applies `f(N)` (brief 4). */
const WRITER_POINTS = 700;
const QUOTED_POINTS = 300;

const manifest: GameManifest = {
  id: "survive",
  name: "Survive the Internet",
  minPlayers: 3,
  maxPlayers: 6,
  controllerType: "text",
  description: "Answer an innocent question. Someone else twists your answer into a headline. Vote for the funniest.",
};

/**
 * A random derangement: `permutation[writer]` is the quoted player's seat and
 * never equals the writer's own seat.
 *
 * Rejection sampling over `secureShuffle` keeps the distribution uniform over
 * all derangements. The fallback is a secure N-cycle, which is always a
 * derangement for N >= 2, so the loop can never return a fixed point.
 */
function secureDerangement(count: number): number[] {
  const seats = Array.from({ length: count }, (_, index) => index);
  if (count < 2) return seats;

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = secureShuffle(seats);
    if (candidate.every((author, writer) => author !== writer)) return candidate;
  }

  const order = secureShuffle(seats);
  const permutation = new Array<number>(count);
  order.forEach((seat, index) => {
    permutation[seat] = order[(index + 1) % count];
  });
  return permutation;
}

function bumpStat(
  state: SurviveState,
  playerId: string,
  stat: "votesReceived" | "quotedVotes",
  amount = 1,
): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + amount;
}

/** Who the TV is waiting on during each timed phase. */
function waitingNames(instance: SurviveInstance): string[] {
  const s = instance.state;
  if (s.phase === "answering") {
    return instance.players.filter((_, i) => s.answers[i] === null).map((p) => p.name);
  }
  if (s.phase === "twisting") {
    return instance.players.filter((_, i) => s.twists[i] === null).map((p) => p.name);
  }
  if (s.phase === "voting") {
    return instance.players.filter((_, i) => s.votes[i] === null).map((p) => p.name);
  }
  return [];
}

/** Public reveal line: the most-voted headline writer. Never carries answer text. */
function revealCaption(instance: SurviveInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;

  let top: { twister: number; votes: number } | null = null;
  for (const row of s.reveal) {
    if (row.votes <= 0) continue;
    if (!top || row.votes > top.votes) top = row;
  }
  if (top) {
    return captionFor({
      kind: "favourite",
      name: instance.players[top.twister]?.name,
      count: top.votes,
      seed: s.round,
    });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

function surviveLeader(instance: SurviveInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function surviveBegin(instance: SurviveInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.prompt = PROMPTS[round % PROMPTS.length];
  s.answers = instance.players.map(() => null);
  s.twists = instance.players.map(() => null);
  s.pairing = secureDerangement(instance.players.length);
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = ANSWER_MS;
  s.phase = "answering";
}

function quoteTarget(instance: SurviveInstance, writer: number): number {
  const s = instance.state;
  return s.pairing[writer] ?? writer;
}

/** True when `voter` is part of the pairing written by seat `writer`. */
function isOwnPairing(instance: SurviveInstance, voter: number, writer: number): boolean {
  return writer === voter || quoteTarget(instance, writer) === voter;
}

function surviveSettle(instance: SurviveInstance): void {
  const s = instance.state;
  const count = instance.players.length;
  const tally = new Array<number>(count).fill(0);
  for (const vote of s.votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= count) continue;
    tally[vote]++;
  }

  const writerPayout = scalePayout(WRITER_POINTS, count);
  const quotedPayout = scalePayout(QUOTED_POINTS, count);
  const roundGain = new Array<number>(count).fill(0);

  tally.forEach((votes, writer) => {
    if (votes <= 0) return;
    const author = quoteTarget(instance, writer);
    roundGain[writer] += votes * writerPayout;
    roundGain[author] += votes * quotedPayout;
    bumpStat(s, instance.players[writer].id, "votesReceived", votes);
    bumpStat(s, instance.players[author].id, "quotedVotes", votes);
  });

  // A player can be paid in both roles in one round. The platform's round
  // sanity rule (brief 3.3) caps their total round gain at 1500.
  roundGain.forEach((gain, index) => {
    s.scores[index] += Math.min(gain, MAX_ROUND_SCORE);
  });

  s.reveal = tally.map((votes, writer) => ({
    twister: writer,
    author: quoteTarget(instance, writer),
    votes,
  }));
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: 3,
        phase: "answering",
        prompt: PROMPTS[0],
        answers: players.map(() => null),
        twists: players.map(() => null),
        pairing: secureDerangement(players.length),
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: ANSWER_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.flatMap((p): Array<[string, number]> => [
            [playerStatKey(p.id, "votesReceived"), 0],
            [playerStatKey(p.id, "quotedVotes"), 0],
          ]),
        ),
      } satisfies SurviveState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "answering") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.answers[index] = raw.text.trim().slice(0, MAX_TEXT);
        if (s.answers.every((a) => a !== null)) { s.phase = "twisting"; s.timerMs = TWIST_MS; }
      }
      return;
    }
    if (s.phase === "twisting") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.twists[index] = raw.text.trim().slice(0, MAX_TEXT);
        if (s.twists.every((t) => t !== null)) { s.phase = "voting"; s.timerMs = VOTE_MS; }
      }
      return;
    }
    if (s.phase === "voting") {
      if (typeof raw?.choice === "string" && raw.choice.startsWith("t:")) {
        const target = Number(raw.choice.slice(2));
        if (!Number.isInteger(target) || target < 0 || target >= inst.players.length) return;
        // Never your own pairing: not as the writer and not as the quoted answer.
        if (isOwnPairing(inst, index, target)) return;
        s.votes[index] = target;
        if (s.votes.every((v) => v !== null)) surviveSettle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    if (s.phase === "answering") {
      inst.players.forEach((_, i) => { if (!s.answers[i]) s.answers[i] = "something boring"; });
      s.phase = "twisting"; s.timerMs = TWIST_MS; return;
    }
    if (s.phase === "twisting") {
      inst.players.forEach((_, i) => { if (!s.twists[i]) s.twists[i] = "a slow news day"; });
      s.phase = "voting"; s.timerMs = VOTE_MS; return;
    }
    if (s.phase === "voting") { surviveSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    surviveBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    const reveal = s.phase === "reveal";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      prompt: s.prompt,
      // Answer and headline text reach the TV only when the pairings are
      // actually on screen for the vote. Answering and twisting stay hidden.
      pairs: s.phase === "voting" || reveal
        ? inst.players.map((p, writer) => {
            const author = quoteTarget(inst, writer);
            return {
              twisterName: p.name,
              authorName: inst.players[author].name,
              headline: s.twists[writer],
              answer: s.answers[author],
            };
          })
        : [],
      reveal: s.reveal,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: reveal ? "reveal" : null,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? surviveLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && surviveLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "answering") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "Your honest answer",
        maxLength: MAX_TEXT,
        hasSubmitted: s.answers[index] !== null,
        info: s.prompt,
      };
    }
    if (s.phase === "twisting") {
      const author = quoteTarget(inst, index);
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "Write a headline that makes this look bad",
        maxLength: MAX_TEXT,
        hasSubmitted: s.twists[index] !== null,
        info: `Their answer: "${s.answers[author] ?? ""}"`,
      };
    }
    if (s.phase === "voting") {
      // One slot per pairing, minus the two pairings this player is part of.
      const options = inst.players
        .map((_, writer) => writer)
        .filter((writer) => !isOwnPairing(inst, index, writer))
        .map((writer) => {
          const author = quoteTarget(inst, writer);
          return {
            id: `t:${writer}`,
            label: `${s.twists[writer] ?? ""} — "${s.answers[author] ?? ""}"`,
          };
        });
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options,
        hasVoted: s.votes[index] !== null,
        info: "Which pairing is funniest?",
      };
    }
    return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Scoring..." };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as SurviveInstance;
    return {
      standings: standingsFromScores(
        inst.players.map((p, i) => ({ id: p.id, raw: inst.state.scores[i] })),
      ),
      stats: { ...inst.state.stats },
    };
  },
};

export default plugin;
