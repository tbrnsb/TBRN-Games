import type {
  ErrorCode,
  GameControllerState,
  GameScreenState,
  LobbyControllerState,
  PrivateControllerState,
  PublicLobbyState,
  SpectatorControllerState,
} from "../../shared/protocol.js";
import type { Room } from "../room.js";
import type { GameRegistry } from "./registry.js";
import { GameSession } from "./session.js";

export type GameManagerResult =
  | { readonly ok: true; readonly finished: boolean }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly message: string;
    };

export interface GameManagerOptions {
  readonly now?: () => number;
}

function playerRange(minPlayers: number, maxPlayers: number): string {
  return minPlayers === maxPlayers
    ? `${minPlayers}`
    : `${minPlayers}-${maxPlayers}`;
}

function fromSession(
  result:
    | { readonly ok: true; readonly finished: boolean }
    | {
        readonly ok: false;
        readonly code: "unknown_player" | "game_over" | "invalid_action";
        readonly message: string;
      },
): GameManagerResult {
  if (result.ok) {
    return result;
  }

  return {
    ok: false,
    code: result.code === "unknown_player" ? "not_in_game" : result.code,
    message: result.message,
  };
}

export class GameManager {
  readonly #room: Room;
  readonly #registry: GameRegistry;
  readonly #now: () => number;
  #session: GameSession | null = null;
  #gameId: string | null = null;

  constructor(
    room: Room,
    registry: GameRegistry,
    options: GameManagerOptions = {},
  ) {
    this.#room = room;
    this.#registry = registry;
    this.#now = options.now ?? Date.now;
  }

  get gameId(): string | null {
    return this.#gameId;
  }

  lobbyState(): PublicLobbyState {
    return {
      ...this.#room.publicState(),
      games: this.#registry.list(),
    };
  }

  startGame(playerId: string, gameId: unknown): GameManagerResult {
    if (this.#session) {
      return {
        ok: false,
        code: "game_in_progress",
        message: "A game is already in progress.",
      };
    }

    if (this.#room.hostId() !== playerId) {
      return {
        ok: false,
        code: "not_host",
        message: "Only the host can start a game.",
      };
    }

    if (typeof gameId !== "string") {
      return {
        ok: false,
        code: "unknown_game",
        message: "That game is not available.",
      };
    }

    const game = this.#registry.get(gameId);

    if (!game) {
      return {
        ok: false,
        code: "unknown_game",
        message: "That game is not available.",
      };
    }

    const connected = this.#room.connectedPlayers();

    if (connected.length < game.minPlayers) {
      return {
        ok: false,
        code: "not_enough_players",
        message: `${game.name} needs ${playerRange(
          game.minPlayers,
          game.maxPlayers,
        )} connected players.`,
      };
    }

    if (connected.length > game.maxPlayers) {
      return {
        ok: false,
        code: "too_many_players",
        message: `${game.name} allows at most ${game.maxPlayers} players.`,
      };
    }

    const session = new GameSession(game, connected, { now: this.#now });

    this.#session = session;
    this.#gameId = game.id;

    return { ok: true, finished: session.finished };
  }

  applyAction(playerId: string, action: unknown): GameManagerResult {
    if (!this.#session) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "There is no game in progress.",
      };
    }

    if (!this.#session.hasPlayer(playerId)) {
      return {
        ok: false,
        code: "not_in_game",
        message: "That player is not in this game.",
      };
    }

    return fromSession(this.#session.apply(playerId, action));
  }

  applyHostAction(playerId: string, action: unknown): GameManagerResult {
    if (!this.#session) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "There is no game in progress.",
      };
    }

    if (this.#room.hostId() !== playerId) {
      return {
        ok: false,
        code: "not_host",
        message: "Only the host can control the game.",
      };
    }

    return fromSession(this.#session.applyHostAction(action));
  }

  returnToLobby(playerId: string): GameManagerResult {
    if (!this.#session) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "There is no game in progress.",
      };
    }

    if (this.#room.hostId() !== playerId) {
      return {
        ok: false,
        code: "not_host",
        message: "Only the host can control the game.",
      };
    }

    this.#session = null;
    this.#gameId = null;

    return { ok: true, finished: false };
  }

  screenState(): GameScreenState | null {
    if (!this.#session || !this.#gameId) {
      return null;
    }

    return {
      phase: "game",
      gameId: this.#gameId,
      hostId: this.#room.hostId(),
      view: this.#session.screenView(),
    };
  }

  controllerState(playerId: string): PrivateControllerState {
    const player = this.#room.playerById(playerId);

    if (!player) {
      throw new Error(`Player "${playerId}" is not seated.`);
    }

    const isHost = this.#room.hostId() === playerId;

    if (this.#session && this.#gameId) {
      if (this.#session.hasPlayer(playerId)) {
        const state: GameControllerState = {
          phase: "game",
          playerId,
          name: player.name,
          isHost,
          gameId: this.#gameId,
          view: this.#session.controllerView(playerId),
        };

        return state;
      }

      const spectator: SpectatorControllerState = {
        phase: "spectating",
        playerId,
        name: player.name,
        isHost,
        gameId: this.#gameId,
      };

      return spectator;
    }

    const state: LobbyControllerState = {
      phase: "lobby",
      playerId,
      name: player.name,
      isHost,
      canStart: isHost && this.#canStart(),
    };

    return state;
  }

  deadline(): number | null {
    return this.#session?.deadline() ?? null;
  }

  handleDeadline(): GameManagerResult {
    if (!this.#session) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "There is no game in progress.",
      };
    }

    return fromSession(this.#session.handleDeadline());
  }

  #canStart(): boolean {
    const count = this.#room.connectedPlayers().length;

    return this.#registry
      .list()
      .some((game) => count >= game.minPlayers && count <= game.maxPlayers);
  }
}
