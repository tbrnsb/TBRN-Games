import { defineGame, type GameContext } from "../types.js";
import { SAME_WAVE_PROMPTS, type SameWavePrompt } from "./prompts.js";

export const SAME_WAVE_ID = "same-wave";
export const TOTAL_ROUNDS = 5;
export const VOTE_WINDOW_MS = 30_000;

export type SameWaveSide = "a" | "b";
export type SameWavePhase = "voting" | "reveal" | "finished";

export interface SameWavePlayerAction {
  readonly type: "vote";
  readonly side: SameWaveSide;
}

export interface SameWaveHostAction {
  readonly type: "next_round";
}

export interface SameWavePromptView {
  readonly id: string;
  readonly text: string;
  readonly a: string;
  readonly b: string;
}

export interface SameWaveCounts {
  readonly a: number;
  readonly b: number;
}

export interface SameWaveRoundResult {
  readonly round: number;
  readonly promptId: string;
  readonly counts: SameWaveCounts;
  readonly winner: SameWaveSide | null;
  readonly scoredPlayerIds: readonly string[];
}

export interface SameWaveScore {
  readonly playerId: string;
  readonly name: string;
  readonly score: number;
}

export interface SameWaveVotingScreen {
  readonly phase: "voting";
  readonly round: number;
  readonly totalRounds: number;
  readonly prompt: SameWavePromptView;
  readonly deadline: number;
  readonly votedCount: number;
  readonly playerCount: number;
}

export interface SameWaveRevealScreen {
  readonly phase: "reveal";
  readonly round: number;
  readonly totalRounds: number;
  readonly prompt: SameWavePromptView;
  readonly counts: SameWaveCounts;
  readonly winner: SameWaveSide | null;
  readonly scores: readonly SameWaveScore[];
}

export interface SameWaveFinishedScreen {
  readonly phase: "finished";
  readonly round: number;
  readonly totalRounds: number;
  readonly prompt: SameWavePromptView;
  readonly counts: SameWaveCounts;
  readonly winner: SameWaveSide | null;
  readonly scores: readonly SameWaveScore[];
  readonly winners: readonly SameWaveScore[];
}

export type SameWaveScreen =
  | SameWaveVotingScreen
  | SameWaveRevealScreen
  | SameWaveFinishedScreen;

export interface SameWaveVotingController {
  readonly phase: "voting";
  readonly round: number;
  readonly totalRounds: number;
  readonly prompt: SameWavePromptView;
  readonly deadline: number;
  readonly myVote: SameWaveSide | null;
}

export interface SameWaveRevealController {
  readonly phase: "reveal";
  readonly round: number;
  readonly totalRounds: number;
  readonly prompt: SameWavePromptView;
  readonly counts: SameWaveCounts;
  readonly winner: SameWaveSide | null;
  readonly myVote: SameWaveSide | null;
  readonly myScore: number;
  readonly scores: readonly SameWaveScore[];
}

export interface SameWaveFinishedController extends Omit<
  SameWaveRevealController,
  "phase"
> {
  readonly phase: "finished";
  readonly winners: readonly SameWaveScore[];
}

export type SameWaveController =
  | SameWaveVotingController
  | SameWaveRevealController
  | SameWaveFinishedController;

interface SameWaveState {
  phase: SameWavePhase;
  round: number;
  prompts: readonly SameWavePrompt[];
  votes: Readonly<Record<string, SameWaveSide>>;
  deadline: number | null;
  results: readonly SameWaveRoundResult[];
  scores: Readonly<Record<string, number>>;
}

export interface SameWaveOptions {
  readonly voteWindowMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlayerAction(action: unknown): SameWavePlayerAction | null {
  if (!isRecord(action) || action.type !== "vote") {
    return null;
  }

  if (action.side !== "a" && action.side !== "b") {
    return null;
  }

  return { type: "vote", side: action.side };
}

function parseHostAction(action: unknown): SameWaveHostAction | null {
  if (!isRecord(action) || action.type !== "next_round") {
    return null;
  }

  return { type: "next_round" };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.min(
      index,
      Math.floor(random() * (index + 1)),
    );
    const current = result[index] as T;
    const other = result[target] as T;

    result[index] = other;
    result[target] = current;
  }

  return result;
}

function promptView(prompt: SameWavePrompt): SameWavePromptView {
  return {
    id: prompt.id,
    text: prompt.text,
    a: prompt.options.a,
    b: prompt.options.b,
  };
}

function currentPrompt(state: SameWaveState): SameWavePrompt {
  const prompt = state.prompts[state.round - 1];

  if (!prompt) {
    throw new Error(`Missing prompt for round ${state.round}.`);
  }

  return prompt;
}

function scoresView(
  context: GameContext,
  scores: Readonly<Record<string, number>>,
): SameWaveScore[] {
  return context.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    score: scores[player.id] ?? 0,
  }));
}

function winnersView(
  context: GameContext,
  scores: Readonly<Record<string, number>>,
): SameWaveScore[] {
  const view = scoresView(context, scores);
  const best = Math.max(...view.map((entry) => entry.score));

  return view.filter((entry) => entry.score === best);
}

function reveal(
  context: GameContext,
  state: SameWaveState,
  votes: Readonly<Record<string, SameWaveSide>>,
): SameWaveState {
  const counts: { a: number; b: number } = { a: 0, b: 0 };

  for (const side of Object.values(votes)) {
    counts[side] += 1;
  }

  const cast = counts.a + counts.b;
  const winner: SameWaveSide | null =
    cast < 2 || counts.a === counts.b ? null : counts.a > counts.b ? "a" : "b";
  const scores: Record<string, number> = { ...state.scores };
  const scoredPlayerIds: string[] = [];

  if (winner !== null) {
    for (const player of context.players) {
      if (votes[player.id] === winner) {
        scores[player.id] = (scores[player.id] ?? 0) + 1;
        scoredPlayerIds.push(player.id);
      }
    }
  }

  const result: SameWaveRoundResult = {
    round: state.round,
    promptId: currentPrompt(state).id,
    counts,
    winner,
    scoredPlayerIds,
  };
  const finished = state.round >= TOTAL_ROUNDS;

  return {
    ...state,
    phase: finished ? "finished" : "reveal",
    votes,
    deadline: null,
    results: [...state.results, result],
    scores,
  };
}

export function createSameWaveGame(options: SameWaveOptions = {}) {
  const voteWindowMs = options.voteWindowMs ?? VOTE_WINDOW_MS;

  if (!Number.isFinite(voteWindowMs) || voteWindowMs <= 0) {
    throw new Error("Same Wave voteWindowMs must be a positive number.");
  }

  return defineGame<
    SameWaveState,
    SameWavePlayerAction,
    SameWaveScreen,
    SameWaveController,
    SameWaveHostAction
  >({
    id: SAME_WAVE_ID,
    name: "Same Wave",
    minPlayers: 3,
    maxPlayers: 4,
    createState(context) {
      const prompts = shuffle(SAME_WAVE_PROMPTS, context.random).slice(
        0,
        TOTAL_ROUNDS,
      );

      return {
        phase: "voting",
        round: 1,
        prompts,
        votes: {},
        deadline: context.now() + voteWindowMs,
        results: [],
        scores: Object.fromEntries(
          context.players.map((player) => [player.id, 0]),
        ),
      };
    },
    applyAction(context, state, playerId, action) {
      const parsed = parsePlayerAction(action);

      if (!parsed) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Vote for side a or b.",
        };
      }

      if (state.phase !== "voting") {
        return {
          ok: false,
          code: "invalid_action",
          message: "Voting is closed.",
        };
      }

      if (state.votes[playerId] !== undefined) {
        return {
          ok: false,
          code: "invalid_action",
          message: "You have already voted this round.",
        };
      }

      const votes = { ...state.votes, [playerId]: parsed.side };

      if (Object.keys(votes).length === context.players.length) {
        return { ok: true, state: reveal(context, state, votes) };
      }

      return { ok: true, state: { ...state, votes } };
    },
    applyHostAction(context, state, action) {
      const parsed = parseHostAction(action);

      if (!parsed) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Unknown host action.",
        };
      }

      if (state.phase !== "reveal") {
        return {
          ok: false,
          code: "invalid_action",
          message: "Wait for the round to be revealed.",
        };
      }

      const nextRound = state.round + 1;
      const prompt = state.prompts[nextRound - 1];

      if (!prompt) {
        return {
          ok: false,
          code: "invalid_action",
          message: "There is no next round.",
        };
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: "voting",
          round: nextRound,
          votes: {},
          deadline: context.now() + voteWindowMs,
        },
      };
    },
    onDeadline(context, state) {
      if (state.phase !== "voting") {
        return {
          ok: false,
          code: "invalid_action",
          message: "Voting is already closed.",
        };
      }

      if (state.deadline === null || context.now() < state.deadline) {
        return {
          ok: false,
          code: "invalid_action",
          message: "The voting window is still open.",
        };
      }

      return { ok: true, state: reveal(context, state, state.votes) };
    },
    screenView(context, state) {
      const prompt = currentPrompt(state);
      const scores = scoresView(context, state.scores);
      const result = state.results.at(-1);

      if (state.phase === "voting" || !result) {
        return {
          phase: "voting",
          round: state.round,
          totalRounds: TOTAL_ROUNDS,
          prompt: promptView(prompt),
          deadline: state.deadline ?? context.now() + voteWindowMs,
          votedCount: Object.keys(state.votes).length,
          playerCount: context.players.length,
        };
      }

      if (state.phase === "finished") {
        return {
          phase: "finished",
          round: state.round,
          totalRounds: TOTAL_ROUNDS,
          prompt: promptView(prompt),
          counts: result.counts,
          winner: result.winner,
          scores,
          winners: winnersView(context, state.scores),
        };
      }

      return {
        phase: "reveal",
        round: state.round,
        totalRounds: TOTAL_ROUNDS,
        prompt: promptView(prompt),
        counts: result.counts,
        winner: result.winner,
        scores,
      };
    },
    controllerView(context, state, playerId) {
      const prompt = promptView(currentPrompt(state));
      const myVote = state.votes[playerId] ?? null;
      const myScore = state.scores[playerId] ?? 0;

      if (state.phase === "voting") {
        return {
          phase: "voting",
          round: state.round,
          totalRounds: TOTAL_ROUNDS,
          prompt,
          deadline: state.deadline ?? context.now() + voteWindowMs,
          myVote,
        };
      }

      const result = state.results.at(-1);

      if (!result) {
        throw new Error("A revealed round is missing its result.");
      }

      const scores = scoresView(context, state.scores);

      if (state.phase === "finished") {
        return {
          phase: "finished",
          round: state.round,
          totalRounds: TOTAL_ROUNDS,
          prompt,
          counts: result.counts,
          winner: result.winner,
          myVote,
          myScore,
          scores,
          winners: winnersView(context, state.scores),
        };
      }

      return {
        phase: "reveal",
        round: state.round,
        totalRounds: TOTAL_ROUNDS,
        prompt,
        counts: result.counts,
        winner: result.winner,
        myVote,
        myScore,
        scores,
      };
    },
    isFinished(_context, state) {
      return state.phase === "finished";
    },
    deadline(_context, state) {
      return state.phase === "voting" ? state.deadline : null;
    },
  });
}

export { SAME_WAVE_PROMPTS } from "./prompts.js";
export type { SameWavePrompt } from "./prompts.js";
