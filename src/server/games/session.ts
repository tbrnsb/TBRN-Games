import type {
  GameActionResult,
  GameContext,
  GamePlayer,
  GamePlugin,
} from "./types.js";

export type SessionErrorCode =
  | "unknown_player"
  | "game_over"
  | "invalid_action";

export type SessionActionResult =
  | { readonly ok: true; readonly finished: boolean }
  | {
      readonly ok: false;
      readonly code: SessionErrorCode;
      readonly message: string;
    };

export interface GameSessionOptions {
  readonly random?: () => number;
  readonly now?: () => number;
}

export class GameSession {
  readonly game: GamePlugin;
  readonly context: GameContext;
  readonly #playersById: Set<string>;
  #state: unknown;
  #finished: boolean;

  constructor(
    game: GamePlugin,
    players: readonly GamePlayer[],
    options: GameSessionOptions = {},
  ) {
    if (players.length < game.minPlayers) {
      throw new Error(
        `Game "${game.id}" requires at least ${game.minPlayers} players.`,
      );
    }

    if (players.length > game.maxPlayers) {
      throw new Error(
        `Game "${game.id}" allows at most ${game.maxPlayers} players.`,
      );
    }

    const playersById = new Set<string>();

    for (const player of players) {
      if (playersById.has(player.id)) {
        throw new Error(`Duplicate player id "${player.id}".`);
      }

      playersById.add(player.id);
    }

    this.game = game;
    this.context = {
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
      })),
      random: options.random ?? Math.random,
      now: options.now ?? Date.now,
    };
    this.#playersById = playersById;
    this.#state = game.createState(this.context);
    this.#finished = game.isFinished(this.context, this.#state);
  }

  get finished(): boolean {
    return this.#finished;
  }

  hasPlayer(playerId: string): boolean {
    return this.#playersById.has(playerId);
  }

  apply(playerId: string, action: unknown): SessionActionResult {
    if (!this.#playersById.has(playerId)) {
      return {
        ok: false,
        code: "unknown_player",
        message: "That player is not in this game.",
      };
    }

    if (this.#finished) {
      return {
        ok: false,
        code: "game_over",
        message: "The game is already over.",
      };
    }

    const result = this.game.applyAction(
      this.context,
      this.#state,
      playerId,
      action,
    );

    if (!result.ok) {
      return {
        ok: false,
        code: "invalid_action",
        message: result.message,
      };
    }

    this.#state = result.state;
    this.#finished = this.game.isFinished(this.context, this.#state);

    return { ok: true, finished: this.#finished };
  }

  applyHostAction(action: unknown): SessionActionResult {
    if (this.#finished) {
      return {
        ok: false,
        code: "game_over",
        message: "The game is already over.",
      };
    }

    if (!this.game.applyHostAction) {
      return {
        ok: false,
        code: "invalid_action",
        message: "This game does not accept host actions.",
      };
    }

    const result = this.game.applyHostAction(this.context, this.#state, action);

    return this.#commit(result);
  }

  deadline(): number | null {
    if (!this.game.deadline) {
      return null;
    }

    return this.game.deadline(this.context, this.#state);
  }

  handleDeadline(): SessionActionResult {
    if (this.#finished) {
      return {
        ok: false,
        code: "game_over",
        message: "The game is already over.",
      };
    }

    if (!this.game.onDeadline) {
      return {
        ok: false,
        code: "invalid_action",
        message: "This game has no deadline.",
      };
    }

    return this.#commit(this.game.onDeadline(this.context, this.#state));
  }

  #commit(result: GameActionResult<unknown>): SessionActionResult {
    if (!result.ok) {
      return {
        ok: false,
        code: "invalid_action",
        message: result.message,
      };
    }

    this.#state = result.state;
    this.#finished = this.game.isFinished(this.context, this.#state);

    return { ok: true, finished: this.#finished };
  }

  screenView(): unknown {
    return this.game.screenView(this.context, this.#state);
  }

  controllerView(playerId: string): unknown {
    if (!this.#playersById.has(playerId)) {
      throw new Error(`Player "${playerId}" is not in this game.`);
    }

    return this.game.controllerView(this.context, this.#state, playerId);
  }
}
