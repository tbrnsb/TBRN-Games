export interface GamePlayer {
  readonly id: string;
  readonly name: string;
}

export interface GameContext {
  readonly players: readonly GamePlayer[];
  readonly random: () => number;
  readonly now: () => number;
}

export type GameActionResult<TState> =
  | { readonly ok: true; readonly state: TState }
  | {
      readonly ok: false;
      readonly code: "invalid_action";
      readonly message: string;
    };

/**
 * Server-side game contract. The state is private to the server; only the
 * screen and controller views returned by the plugin may leave it.
 */
export interface GamePlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  createState(context: GameContext): unknown;
  applyAction(
    context: GameContext,
    state: unknown,
    playerId: string,
    action: unknown,
  ): GameActionResult<unknown>;
  screenView(context: GameContext, state: unknown): unknown;
  controllerView(
    context: GameContext,
    state: unknown,
    playerId: string,
  ): unknown;
  isFinished(context: GameContext, state: unknown): boolean;
  /** Optional server-side deadline for timed phases. */
  deadline?(context: GameContext, state: unknown): number | null;
  /** Optional host-only action, routed only after the manager checks the host. */
  applyHostAction?(
    context: GameContext,
    state: unknown,
    action: unknown,
  ): GameActionResult<unknown>;
  /** Optional handler for when the deadline from `deadline()` is reached. */
  onDeadline?(context: GameContext, state: unknown): GameActionResult<unknown>;
}

export interface TypedGamePlugin<
  TState,
  TAction,
  TScreen,
  TController,
  THostAction = unknown,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  createState(context: GameContext): TState;
  applyAction(
    context: GameContext,
    state: TState,
    playerId: string,
    action: TAction,
  ): GameActionResult<TState>;
  screenView(context: GameContext, state: TState): TScreen;
  controllerView(
    context: GameContext,
    state: TState,
    playerId: string,
  ): TController;
  isFinished?(context: GameContext, state: TState): boolean;
  deadline?(context: GameContext, state: TState): number | null;
  applyHostAction?(
    context: GameContext,
    state: TState,
    action: THostAction,
  ): GameActionResult<TState>;
  onDeadline?(context: GameContext, state: TState): GameActionResult<TState>;
}

/**
 * Wraps a typed plugin in the type-erased contract used by the engine. The
 * plugin must validate raw actions before using them as TAction.
 */
export function defineGame<
  TState,
  TAction,
  TScreen,
  TController,
  THostAction = unknown,
>(
  plugin: TypedGamePlugin<TState, TAction, TScreen, TController, THostAction>,
): GamePlugin {
  const isFinished = plugin.isFinished;
  const deadline = plugin.deadline;
  const applyHostAction = plugin.applyHostAction;
  const onDeadline = plugin.onDeadline;

  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    minPlayers: plugin.minPlayers,
    maxPlayers: plugin.maxPlayers,
    createState: (context) => plugin.createState(context),
    applyAction: (context, state, playerId, action) =>
      plugin.applyAction(
        context,
        state as TState,
        playerId,
        action as TAction,
      ),
    screenView: (context, state) =>
      plugin.screenView(context, state as TState),
    controllerView: (context, state, playerId) =>
      plugin.controllerView(context, state as TState, playerId),
    isFinished: isFinished
      ? (context, state) => isFinished(context, state as TState)
      : () => false,
    ...(deadline
      ? {
          deadline: (context: GameContext, state: unknown) =>
            deadline(context, state as TState),
        }
      : {}),
    ...(applyHostAction
      ? {
          applyHostAction: (
            context: GameContext,
            state: unknown,
            action: unknown,
          ) => applyHostAction(context, state as TState, action as THostAction),
        }
      : {}),
    ...(onDeadline
      ? {
          onDeadline: (context: GameContext, state: unknown) =>
            onDeadline(context, state as TState),
        }
      : {}),
  };
}
