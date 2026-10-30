import { defineGame, type GameContext } from "../types.js";

export const DARTS_ID = "darts";
export const DARTS_ROUNDS = 3;
export const AIM_DELAY_MS = 3_000;
export const TURN_GRACE_MS = 2_000;

export interface DartsPlayerAction {
  readonly type: "throw";
}

export interface DartsThrowView {
  readonly round: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly score: number;
  readonly label: string;
  readonly deltaMs: number | null;
}

export interface DartsScore {
  readonly playerId: string;
  readonly name: string;
  readonly score: number;
}

export interface DartsPlayingScreen {
  readonly phase: "playing";
  readonly round: number;
  readonly totalRounds: number;
  readonly currentPlayer: { readonly id: string; readonly name: string };
  readonly targetAt: number;
  readonly deadline: number;
  readonly lastThrow: DartsThrowView | null;
  readonly scores: readonly DartsScore[];
}

export interface DartsFinishedScreen {
  readonly phase: "finished";
  readonly round: number;
  readonly totalRounds: number;
  readonly scores: readonly DartsScore[];
  readonly winners: readonly DartsScore[];
  readonly lastThrow: DartsThrowView | null;
}

export type DartsScreen = DartsPlayingScreen | DartsFinishedScreen;

export interface DartsPlayingController {
  readonly phase: "playing";
  readonly round: number;
  readonly totalRounds: number;
  readonly isMyTurn: boolean;
  readonly currentPlayerName: string;
  readonly targetAt: number;
  readonly deadline: number;
  readonly myScore: number;
  readonly lastThrow: DartsThrowView | null;
  readonly scores: readonly DartsScore[];
}

export interface DartsFinishedController {
  readonly phase: "finished";
  readonly round: number;
  readonly totalRounds: number;
  readonly isMyTurn: false;
  readonly currentPlayerName: null;
  readonly targetAt: null;
  readonly deadline: null;
  readonly myScore: number;
  readonly lastThrow: DartsThrowView | null;
  readonly scores: readonly DartsScore[];
  readonly winners: readonly DartsScore[];
}

export type DartsController =
  | DartsPlayingController
  | DartsFinishedController;

interface DartsThrowRecord {
  readonly round: number;
  readonly playerId: string;
  readonly score: number;
  readonly label: string;
  readonly deltaMs: number | null;
}

interface DartsState {
  phase: "playing" | "finished";
  round: number;
  turnIndex: number;
  targetAt: number | null;
  deadline: number | null;
  throws: readonly DartsThrowRecord[];
  scores: Readonly<Record<string, number>>;
}

export interface DartsTier {
  readonly score: number;
  readonly label: string;
}

const SCORE_TIERS: ReadonlyArray<{ maxDeltaMs: number } & DartsTier> = [
  { maxDeltaMs: 80, score: 50, label: "Bullseye" },
  { maxDeltaMs: 200, score: 25, label: "Outer bull" },
  { maxDeltaMs: 400, score: 20, label: "Triple 20" },
  { maxDeltaMs: 700, score: 10, label: "Double 10" },
  { maxDeltaMs: 1_200, score: 5, label: "Single 5" },
];

export function scoreForDelta(deltaMs: number): DartsTier {
  const magnitude = Number.isFinite(deltaMs) ? Math.abs(deltaMs) : Infinity;

  for (const tier of SCORE_TIERS) {
    if (magnitude <= tier.maxDeltaMs) {
      return { score: tier.score, label: tier.label };
    }
  }

  return { score: 0, label: "Miss" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAction(action: unknown): DartsPlayerAction | null {
  if (!isRecord(action) || action.type !== "throw") {
    return null;
  }

  return { type: "throw" };
}

function currentPlayer(context: GameContext, state: DartsState) {
  const player = context.players[state.turnIndex];

  if (!player) {
    throw new Error(`Darts turn ${state.turnIndex} has no player.`);
  }

  return player;
}

function scoresView(
  context: GameContext,
  scores: Readonly<Record<string, number>>,
): DartsScore[] {
  return context.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    score: scores[player.id] ?? 0,
  }));
}

function winnersView(
  context: GameContext,
  scores: Readonly<Record<string, number>>,
): DartsScore[] {
  const view = scoresView(context, scores);
  const best = Math.max(...view.map((entry) => entry.score));

  return view.filter((entry) => entry.score === best);
}

function throwView(
  context: GameContext,
  record: DartsThrowRecord | undefined,
): DartsThrowView | null {
  if (!record) {
    return null;
  }

  const player = context.players.find((entry) => entry.id === record.playerId);

  return {
    round: record.round,
    playerId: record.playerId,
    playerName: player?.name ?? "Unknown player",
    score: record.score,
    label: record.label,
    deltaMs: record.deltaMs,
  };
}

function advance(
  context: GameContext,
  state: DartsState,
  throws: readonly DartsThrowRecord[],
  scores: Readonly<Record<string, number>>,
): DartsState {
  let round = state.round;
  let turnIndex = state.turnIndex + 1;

  if (turnIndex >= context.players.length) {
    turnIndex = 0;
    round += 1;
  }

  if (round > DARTS_ROUNDS) {
    return {
      ...state,
      phase: "finished",
      round: DARTS_ROUNDS,
      turnIndex: 0,
      targetAt: null,
      deadline: null,
      throws,
      scores,
    };
  }

  const now = context.now();

  return {
    ...state,
    phase: "playing",
    round,
    turnIndex,
    targetAt: now + AIM_DELAY_MS,
    deadline: now + AIM_DELAY_MS + TURN_GRACE_MS,
    throws,
    scores,
  };
}

function recordThrow(
  context: GameContext,
  state: DartsState,
  record: DartsThrowRecord,
): DartsState {
  const scores = {
    ...state.scores,
    [record.playerId]: (state.scores[record.playerId] ?? 0) + record.score,
  };

  return advance(context, state, [...state.throws, record], scores);
}

export function createDartsGame() {
  return defineGame<
    DartsState,
    DartsPlayerAction,
    DartsScreen,
    DartsController
  >({
    id: DARTS_ID,
    name: "Darts",
    description: "Three rounds, one button. Time your throw for the bullseye.",
    minPlayers: 1,
    maxPlayers: 4,
    createState(context) {
      const now = context.now();

      return {
        phase: "playing",
        round: 1,
        turnIndex: 0,
        targetAt: now + AIM_DELAY_MS,
        deadline: now + AIM_DELAY_MS + TURN_GRACE_MS,
        throws: [],
        scores: Object.fromEntries(
          context.players.map((player) => [player.id, 0]),
        ),
      };
    },
    applyAction(context, state, playerId, action) {
      const parsed = parseAction(action);

      if (!parsed) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Press the throw button to throw.",
        };
      }

      if (state.phase === "finished") {
        return {
          ok: false,
          code: "invalid_action",
          message: "The game is over.",
        };
      }

      const player = currentPlayer(context, state);

      if (player.id !== playerId) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Wait for your turn.",
        };
      }

      const now = context.now();

      if (state.deadline !== null && now >= state.deadline) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Your turn has ended.",
        };
      }

      const deltaMs = state.targetAt === null ? Infinity : now - state.targetAt;
      const tier = scoreForDelta(deltaMs);
      const next = recordThrow(context, state, {
        round: state.round,
        playerId,
        score: tier.score,
        label: tier.label,
        deltaMs: Number.isFinite(deltaMs) ? deltaMs : null,
      });

      return { ok: true, state: next };
    },
    onDeadline(context, state) {
      if (state.phase === "finished") {
        return {
          ok: false,
          code: "invalid_action",
          message: "The game is over.",
        };
      }

      if (state.deadline === null || context.now() < state.deadline) {
        return {
          ok: false,
          code: "invalid_action",
          message: "The turn is still open.",
        };
      }

      const player = currentPlayer(context, state);
      const next = recordThrow(context, state, {
        round: state.round,
        playerId: player.id,
        score: 0,
        label: "Miss",
        deltaMs: null,
      });

      return { ok: true, state: next };
    },
    screenView(context, state) {
      const scores = scoresView(context, state.scores);
      const lastThrow = throwView(context, state.throws.at(-1));

      if (state.phase === "finished") {
        return {
          phase: "finished",
          round: DARTS_ROUNDS,
          totalRounds: DARTS_ROUNDS,
          scores,
          winners: winnersView(context, state.scores),
          lastThrow,
        };
      }

      const player = currentPlayer(context, state);

      return {
        phase: "playing",
        round: state.round,
        totalRounds: DARTS_ROUNDS,
        currentPlayer: { id: player.id, name: player.name },
        targetAt: state.targetAt ?? context.now() + AIM_DELAY_MS,
        deadline: state.deadline ?? context.now() + AIM_DELAY_MS + TURN_GRACE_MS,
        lastThrow,
        scores,
      };
    },
    controllerView(context, state, playerId) {
      const scores = scoresView(context, state.scores);
      const lastThrow = throwView(context, state.throws.at(-1));
      const myScore = state.scores[playerId] ?? 0;

      if (state.phase === "finished") {
        return {
          phase: "finished",
          round: DARTS_ROUNDS,
          totalRounds: DARTS_ROUNDS,
          isMyTurn: false,
          currentPlayerName: null,
          targetAt: null,
          deadline: null,
          myScore,
          lastThrow,
          scores,
          winners: winnersView(context, state.scores),
        };
      }

      const player = currentPlayer(context, state);

      return {
        phase: "playing",
        round: state.round,
        totalRounds: DARTS_ROUNDS,
        isMyTurn: player.id === playerId,
        currentPlayerName: player.name,
        targetAt: state.targetAt ?? context.now() + AIM_DELAY_MS,
        deadline: state.deadline ?? context.now() + AIM_DELAY_MS + TURN_GRACE_MS,
        myScore,
        lastThrow,
        scores,
      };
    },
    isFinished(_context, state) {
      return state.phase === "finished";
    },
    deadline(_context, state) {
      return state.phase === "playing" ? state.deadline : null;
    },
  });
}
