import { MAX_PLAYERS } from "../../shared/protocol.js";
import type { GamePlugin } from "./types.js";

export interface GameSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
}

const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_GAME_ID_LENGTH = 40;
const MAX_GAME_NAME_LENGTH = 60;
const MAX_GAME_DESCRIPTION_LENGTH = 160;

function validateGame(game: GamePlugin): void {
  if (
    typeof game.id !== "string" ||
    game.id.length > MAX_GAME_ID_LENGTH ||
    !GAME_ID_PATTERN.test(game.id)
  ) {
    throw new Error(
      `Game id must be 1-${MAX_GAME_ID_LENGTH} lowercase letters, digits, or single dashes.`,
    );
  }

  if (
    typeof game.name !== "string" ||
    game.name.trim().length === 0 ||
    game.name.length > MAX_GAME_NAME_LENGTH
  ) {
    throw new Error(
      `Game name must be 1-${MAX_GAME_NAME_LENGTH} characters and not blank.`,
    );
  }

  if (
    typeof game.description !== "string" ||
    game.description.trim().length === 0 ||
    game.description.length > MAX_GAME_DESCRIPTION_LENGTH
  ) {
    throw new Error(
      `Game description must be 1-${MAX_GAME_DESCRIPTION_LENGTH} characters and not blank.`,
    );
  }

  if (
    !Number.isInteger(game.minPlayers) ||
    game.minPlayers < 1 ||
    game.minPlayers > MAX_PLAYERS
  ) {
    throw new Error(
      `Game minPlayers must be an integer from 1 to ${MAX_PLAYERS}.`,
    );
  }

  if (
    !Number.isInteger(game.maxPlayers) ||
    game.maxPlayers < game.minPlayers ||
    game.maxPlayers > MAX_PLAYERS
  ) {
    throw new Error(
      `Game maxPlayers must be an integer from minPlayers to ${MAX_PLAYERS}.`,
    );
  }

  for (const method of [
    "createState",
    "applyAction",
    "screenView",
    "controllerView",
    "isFinished",
  ] as const) {
    if (typeof game[method] !== "function") {
      throw new Error(`Game "${game.id}" is missing ${method}().`);
    }
  }

  for (const method of ["deadline", "applyHostAction", "onDeadline"] as const) {
    const value = game[method];

    if (value !== undefined && typeof value !== "function") {
      throw new Error(`Game "${game.id}" has an invalid ${method}().`);
    }
  }
}

export class GameRegistry {
  readonly #games = new Map<string, GamePlugin>();

  register(game: GamePlugin): void {
    validateGame(game);

    if (this.#games.has(game.id)) {
      throw new Error(`Game "${game.id}" is already registered.`);
    }

    this.#games.set(game.id, game);
  }

  has(id: string): boolean {
    return this.#games.has(id);
  }

  get(id: string): GamePlugin | undefined {
    return this.#games.get(id);
  }

  list(): GameSummary[] {
    return [...this.#games.values()].map((game) => ({
      id: game.id,
      name: game.name,
      description: game.description,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
    }));
  }
}

export function createGameRegistry(
  games: readonly GamePlugin[] = [],
): GameRegistry {
  const registry = new GameRegistry();

  for (const game of games) {
    registry.register(game);
  }

  return registry;
}
