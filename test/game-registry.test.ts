import assert from "node:assert/strict";
import test from "node:test";

import {
  createGameRegistry,
  GameRegistry,
} from "../src/server/games/registry.js";
import type { GamePlugin } from "../src/server/games/types.js";
import { createCounterGame } from "./fixtures/counter-game.js";

function gameWith(overrides: Partial<GamePlugin>): GamePlugin {
  return { ...createCounterGame(), ...overrides };
}

test("registers games and lists their public metadata", () => {
  const registry = new GameRegistry();
  const game = createCounterGame();

  registry.register(game);

  assert.equal(registry.has("counter"), true);
  assert.equal(registry.get("counter"), game);
  assert.deepEqual(registry.list(), [
    { id: "counter", name: "Counter", minPlayers: 2, maxPlayers: 4 },
  ]);
});

test("returns undefined for unknown games", () => {
  const registry = new GameRegistry();

  assert.equal(registry.has("missing"), false);
  assert.equal(registry.get("missing"), undefined);
});

test("rejects duplicate game ids", () => {
  const registry = new GameRegistry();

  registry.register(createCounterGame());

  assert.throws(
    () => registry.register(createCounterGame()),
    /already registered/,
  );
  assert.equal(registry.list().length, 1);
});

test("rejects invalid game metadata", () => {
  const registry = new GameRegistry();
  const invalidGames: Array<[string, Partial<GamePlugin>]> = [
    ["empty id", { id: "" }],
    ["uppercase id", { id: "Counter" }],
    ["spaces in id", { id: "bad id" }],
    ["leading dash", { id: "-counter" }],
    ["trailing dash", { id: "counter-" }],
    ["double dash", { id: "counter--game" }],
    ["long id", { id: "a".repeat(41) }],
    ["blank name", { name: "   " }],
    ["long name", { name: "x".repeat(61) }],
    ["zero min players", { minPlayers: 0 }],
    ["too many min players", { minPlayers: 5 }],
    ["fractional min players", { minPlayers: 1.5 }],
    ["max below min", { minPlayers: 3, maxPlayers: 2 }],
    ["zero max players", { maxPlayers: 0 }],
    ["too many max players", { maxPlayers: 5 }],
    ["fractional max players", { maxPlayers: 2.5 }],
    ["missing createState", { createState: undefined as never }],
    ["missing applyAction", { applyAction: undefined as never }],
    ["missing screenView", { screenView: undefined as never }],
    ["missing controllerView", { controllerView: undefined as never }],
    ["missing isFinished", { isFinished: undefined as never }],
    ["invalid deadline", { deadline: "soon" as never }],
    ["invalid host action", { applyHostAction: 1 as never }],
    ["invalid deadline handler", { onDeadline: {} as never }],
  ];

  for (const [label, overrides] of invalidGames) {
    assert.throws(
      () => registry.register(gameWith(overrides)),
      (error: unknown) => error instanceof Error && error.message.length > 0,
      label,
    );
  }

  assert.deepEqual(registry.list(), []);
});

test("accepts games sized for one to four players", () => {
  const registry = new GameRegistry();

  registry.register(gameWith({ id: "solo", minPlayers: 1, maxPlayers: 1 }));
  registry.register(gameWith({ id: "four", minPlayers: 1, maxPlayers: 4 }));

  assert.deepEqual(
    registry.list().map((game) => game.id),
    ["solo", "four"],
  );
});

test("creates a registry from a list of games", () => {
  const registry = createGameRegistry([
    createCounterGame(),
    gameWith({ id: "solo", minPlayers: 1, maxPlayers: 1 }),
  ]);

  assert.deepEqual(
    registry.list().map((game) => game.id),
    ["counter", "solo"],
  );
});
