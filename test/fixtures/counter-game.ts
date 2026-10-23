import { defineGame } from "../../src/server/games/types.js";

export const COUNTER_SECRET = "fixture-secret";

export interface CounterState {
  counts: Record<string, number>;
  secret: string;
}

export interface CounterAction {
  type: "tap";
}

export interface CounterScreen {
  total: number;
  finished: boolean;
}

export interface CounterController {
  count: number;
  target: number;
}

export function createCounterGame(options: { target?: number } = {}) {
  const target = options.target ?? 3;

  return defineGame<
    CounterState,
    CounterAction,
    CounterScreen,
    CounterController
  >({
    id: "counter",
    name: "Counter",
    description: "Tap to count. A test fixture.",
    minPlayers: 2,
    maxPlayers: 4,
    createState(context) {
      return {
        counts: Object.fromEntries(
          context.players.map((player) => [player.id, 0]),
        ),
        secret: COUNTER_SECRET,
      };
    },
    applyAction(context, state, playerId, action) {
      if (
        typeof action !== "object" ||
        action === null ||
        (action as { type?: unknown }).type !== "tap"
      ) {
        return {
          ok: false,
          code: "invalid_action",
          message: "Only tap actions are allowed.",
        };
      }

      const counts = {
        ...state.counts,
        [playerId]: (state.counts[playerId] ?? 0) + 1,
      };

      return { ok: true, state: { ...state, counts } };
    },
    screenView(context, state) {
      return {
        total: Object.values(state.counts).reduce(
          (total, count) => total + count,
          0,
        ),
        finished: Object.values(state.counts).some(
          (count) => count >= target,
        ),
      };
    },
    controllerView(context, state, playerId) {
      return { count: state.counts[playerId] ?? 0, target };
    },
    isFinished(context, state) {
      return Object.values(state.counts).some((count) => count >= target);
    },
  });
}
