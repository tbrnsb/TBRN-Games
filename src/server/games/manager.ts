import {
  SELECTION_WINDOW_MS,
  type ControllerSelectionState,
  type ErrorCode,
  type GameControllerState,
  type GameScreenState,
  type LobbyControllerState,
  type PrivateControllerState,
  type PublicGameSummary,
  type PublicLobbyState,
  type PublicSelectionState,
  type SpectatorControllerState,
} from "../../shared/protocol.js";
import type { Room } from "../room.js";
import type { GameRegistry } from "./registry.js";
import { GameSession } from "./session.js";
import type { GamePlugin } from "./types.js";

export type GameManagerResult =
  | { readonly ok: true; readonly finished: boolean }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly message: string;
    };

export interface GameManagerOptions {
  readonly now?: () => number;
  readonly random?: () => number;
  readonly selectionWindowMs?: number;
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

function pickIndex(length: number, random: () => number): number {
  const value = random();
  const normalized = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 0.999_999_999)
    : 0;

  return Math.floor(normalized * length);
}

function pickUniform<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) {
    return null;
  }

  return items[pickIndex(items.length, random)] ?? null;
}

/**
 * Chooses the most-voted eligible game. Ties and empty ballots are broken
 * uniformly with the injected random source.
 */
export function chooseBallotWinner(
  ballots: ReadonlyMap<string, string>,
  eligibleGameIds: readonly string[],
  random: () => number,
): string | null {
  if (eligibleGameIds.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const gameId of ballots.values()) {
    if (eligibleGameIds.includes(gameId)) {
      counts.set(gameId, (counts.get(gameId) ?? 0) + 1);
    }
  }

  let best = 0;

  for (const count of counts.values()) {
    best = Math.max(best, count);
  }

  if (best > 0) {
    const tied = eligibleGameIds.filter(
      (gameId) => (counts.get(gameId) ?? 0) === best,
    );

    return pickUniform(tied, random);
  }

  return pickUniform(eligibleGameIds, random);
}

export class GameManager {
  readonly #room: Room;
  readonly #registry: GameRegistry;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #selectionWindowMs: number;
  #session: GameSession | null = null;
  #gameId: string | null = null;
  #ballots: Map<string, string> | null = null;
  #selectionDeadline: number | null = null;
  #selectionGames: PublicGameSummary[] = [];
  #notice: string | null = null;

  constructor(
    room: Room,
    registry: GameRegistry,
    options: GameManagerOptions = {},
  ) {
    this.#room = room;
    this.#registry = registry;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#selectionWindowMs = options.selectionWindowMs ?? SELECTION_WINDOW_MS;
  }

  get gameId(): string | null {
    return this.#gameId;
  }

  eligibleGames(): PublicGameSummary[] {
    const count = this.#room.connectedPlayers().length;

    return this.#registry
      .list()
      .filter((game) => count >= game.minPlayers && count <= game.maxPlayers);
  }

  lobbyState(): PublicLobbyState {
    return {
      ...this.#room.publicState(),
      games: this.#registry.list(),
      selection: this.#selectionView(),
      notice: this.#notice,
    };
  }

  clearNotice(): void {
    this.#notice = null;
  }

  startGame(playerId: string, gameId: unknown): GameManagerResult {
    const blocked = this.#blockedFromStarting(playerId);

    if (blocked) {
      return blocked;
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

    return this.#startSession(game, connected);
  }

  selectRandom(playerId: string): GameManagerResult {
    const blocked = this.#blockedFromStarting(playerId);

    if (blocked) {
      return blocked;
    }

    const eligible = this.eligibleGames();
    const game = pickUniform(eligible, this.#random);

    if (!game) {
      return {
        ok: false,
        code: "not_enough_players",
        message: "No registered game fits this player count.",
      };
    }

    const plugin = this.#registry.get(game.id);

    if (!plugin) {
      return {
        ok: false,
        code: "unknown_game",
        message: "That game is not available.",
      };
    }

    return this.#startSession(plugin, this.#room.connectedPlayers());
  }

  startGameVote(playerId: string): GameManagerResult {
    const blocked = this.#blockedFromStarting(playerId);

    if (blocked) {
      return blocked;
    }

    const eligible = this.eligibleGames();

    if (eligible.length === 0) {
      return {
        ok: false,
        code: "not_enough_players",
        message: "No registered game fits this player count.",
      };
    }

    this.#ballots = new Map();
    this.#selectionDeadline = this.#now() + this.#selectionWindowMs;
    this.#selectionGames = eligible;
    this.#notice = null;

    return { ok: true, finished: false };
  }

  castBallot(playerId: string, gameId: unknown): GameManagerResult {
    if (this.#session) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "A game is already in progress.",
      };
    }

    if (!this.#ballots || this.#selectionDeadline === null) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "There is no game vote in progress.",
      };
    }

    if (
      typeof gameId !== "string" ||
      !this.eligibleGames().some((game) => game.id === gameId)
    ) {
      return {
        ok: false,
        code: "not_eligible",
        message: "That game is not on the ballot.",
      };
    }

    if (this.#ballots.has(playerId)) {
      return {
        ok: false,
        code: "already_voted",
        message: "Your ballot is already cast.",
      };
    }

    this.#ballots.set(playerId, gameId);
    this.#maybeCloseSelection();

    return { ok: true, finished: false };
  }

  leaveRoom(playerId: string): GameManagerResult {
    if (!this.#room.leave(playerId)) {
      return {
        ok: false,
        code: "not_joined",
        message: "You are not in the room.",
      };
    }

    this.#ballots?.delete(playerId);
    this.handleRoomChange();

    return { ok: true, finished: false };
  }

  /**
   * Keeps lobby voting in step with the connected players. Pass ids whose
   * seats were removed for good so their ballots no longer count.
   */
  handleRoomChange(removedPlayerIds: readonly string[] = []): void {
    for (const playerId of removedPlayerIds) {
      this.#ballots?.delete(playerId);
    }

    if (this.#session && this.#room.connectedPlayers().length === 0) {
      this.#session = null;
      this.#gameId = null;
    }

    this.#maybeCloseSelection();
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
      canStart: isHost && this.eligibleGames().length > 0,
      selection: this.#selectionControllerView(playerId),
    };

    return state;
  }

  deadline(): number | null {
    if (this.#selectionDeadline !== null) {
      return this.#selectionDeadline;
    }

    return this.#session?.deadline() ?? null;
  }

  handleDeadline(): GameManagerResult {
    if (this.#selectionDeadline !== null) {
      if (this.#now() < this.#selectionDeadline) {
        return {
          ok: false,
          code: "invalid_action",
          message: "The game vote is still open.",
        };
      }

      this.#closeSelection();

      return { ok: true, finished: false };
    }

    if (!this.#session) {
      return {
        ok: false,
        code: "wrong_phase",
        message: "There is no game in progress.",
      };
    }

    return fromSession(this.#session.handleDeadline());
  }

  #blockedFromStarting(playerId: string): GameManagerResult | null {
    if (this.#session) {
      return {
        ok: false,
        code: "game_in_progress",
        message: "A game is already in progress.",
      };
    }

    if (this.#selectionDeadline !== null) {
      return {
        ok: false,
        code: "selection_in_progress",
        message: "A game vote is already in progress.",
      };
    }

    if (this.#room.hostId() !== playerId) {
      return {
        ok: false,
        code: "not_host",
        message: "Only the host can start a game.",
      };
    }

    return null;
  }

  #startSession(
    game: GamePlugin,
    players: readonly { id: string; name: string }[],
  ): GameManagerResult {
    const session = new GameSession(game, players, {
      now: this.#now,
      random: this.#random,
    });

    this.#session = session;
    this.#gameId = game.id;
    this.#notice = null;

    return { ok: true, finished: session.finished };
  }

  #selectionView(): PublicSelectionState | null {
    if (this.#selectionDeadline === null || !this.#ballots) {
      return null;
    }

    const connectedIds = new Set(
      this.#room.connectedPlayers().map((player) => player.id),
    );
    const ballotsCast = [...this.#ballots.keys()].filter((playerId) =>
      connectedIds.has(playerId),
    ).length;

    return {
      phase: "voting",
      deadline: this.#selectionDeadline,
      games: this.#selectionGames,
      ballotsCast,
      voterCount: connectedIds.size,
    };
  }

  #selectionControllerView(
    playerId: string,
  ): ControllerSelectionState | null {
    if (this.#selectionDeadline === null || !this.#ballots) {
      return null;
    }

    return {
      phase: "voting",
      deadline: this.#selectionDeadline,
      games: this.#selectionGames,
      myBallot: this.#ballots.get(playerId) ?? null,
    };
  }

  #maybeCloseSelection(): void {
    if (this.#selectionDeadline === null || !this.#ballots) {
      return;
    }

    const connected = this.#room.connectedPlayers();

    if (connected.length === 0) {
      this.#ballots = null;
      this.#selectionDeadline = null;
      this.#selectionGames = [];
      this.#notice = "Everyone left. Start a new game when players join.";
      return;
    }

    if (connected.every((player) => this.#ballots?.has(player.id))) {
      this.#closeSelection();
    }
  }

  #closeSelection(): void {
    const ballots = this.#ballots;

    this.#ballots = null;
    this.#selectionDeadline = null;
    this.#selectionGames = [];

    if (!ballots) {
      return;
    }

    const eligible = this.eligibleGames();

    if (eligible.length === 0) {
      this.#notice =
        "No registered game fits the remaining players. Waiting for players.";
      return;
    }

    // Disconnected seats keep their ballot in case they reconnect, but only
    // connected players count as voters when the vote closes.
    const connectedIds = new Set(
      this.#room.connectedPlayers().map((player) => player.id),
    );
    const countedBallots = new Map(
      [...ballots].filter(([playerId]) => connectedIds.has(playerId)),
    );

    const winnerId = chooseBallotWinner(
      countedBallots,
      eligible.map((game) => game.id),
      this.#random,
    );
    const game = winnerId ? this.#registry.get(winnerId) : undefined;

    if (!game) {
      this.#notice = "The game vote could not pick a game. Try again.";
      return;
    }

    this.#startSession(game, this.#room.connectedPlayers());
  }
}
