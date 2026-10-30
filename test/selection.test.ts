import assert from "node:assert/strict";
import test from "node:test";

import { GameManager } from "../src/server/games/manager.js";
import { GameRegistry } from "../src/server/games/registry.js";
import { createDartsGame } from "../src/server/games/darts/index.js";
import { createSameWaveGame } from "../src/server/games/same-wave/index.js";
import type {
  GameControllerState,
  LobbyControllerState,
} from "../src/shared/protocol.js";
import { Room } from "../src/server/room.js";

function setup(options: { random?: () => number; withGames?: boolean } = {}) {
  let now = 1_000;
  let sequence = 0;
  const room = new Room({
    now: () => now,
    generateId: () => `player-${++sequence}`,
    generateToken: () => `token-${++sequence}`,
  });
  const registry = new GameRegistry();

  if (options.withGames !== false) {
    registry.register(createSameWaveGame({ voteWindowMs: 30_000 }));
    registry.register(createDartsGame());
  }

  const manager = new GameManager(room, registry, {
    now: () => now,
    random: options.random ?? (() => 0),
  });

  function join(name: string) {
    const result = room.join(name);

    if (!result.ok) {
      assert.fail(result.message);
    }

    return result;
  }

  return {
    room,
    registry,
    manager,
    join,
    advance(ms: number): void {
      now += ms;
    },
  };
}

function lobby(manager: GameManager, playerId: string): LobbyControllerState {
  return manager.controllerState(playerId) as LobbyControllerState;
}

test("the host can start a random eligible game", () => {
  const { manager, join } = setup({ random: () => 0.99 });
  const alice = join("Alice");

  assert.deepEqual(manager.selectRandom(alice.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.gameId, "darts");
  assert.equal(manager.screenState()?.gameId, "darts");

  const game = manager.controllerState(alice.player.id) as GameControllerState;

  assert.equal(game.phase, "game");
  assert.equal(game.gameId, "darts");
});

test("random selection uses only games that fit the connected player count", () => {
  const two = setup({ random: () => 0 });
  const alice = two.join("Alice");

  two.join("Bob");

  assert.deepEqual(
    two.manager.lobbyState().games.map((game) => game.id),
    ["same-wave", "darts"],
  );

  two.manager.selectRandom(alice.player.id);

  assert.equal(two.manager.gameId, "darts");

  const three = setup({ random: () => 0 });
  const carol = three.join("Carol");

  three.join("Dave");
  three.join("Eve");

  three.manager.selectRandom(carol.player.id);

  assert.equal(three.manager.gameId, "same-wave");
});

test("only the host can start random selection or a game vote", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");

  join("Carol");

  assert.deepEqual(manager.selectRandom(bob.player.id), {
    ok: false,
    code: "not_host",
    message: "Only the host can start a game.",
  });
  assert.deepEqual(manager.startGameVote(bob.player.id), {
    ok: false,
    code: "not_host",
    message: "Only the host can start a game.",
  });
  assert.equal(manager.lobbyState().selection, null);
  assert.equal(manager.lobbyState().hostId, alice.player.id);
  assert.equal(manager.gameId, null);
});

test("the host starts a private ballot with eligible games and a 30-second deadline", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");

  join("Carol");

  assert.deepEqual(manager.startGameVote(alice.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.deadline(), 31_000);

  const state = manager.lobbyState();
  const selection = state.selection;

  assert.ok(selection);
  assert.equal(selection.phase, "voting");
  assert.equal(selection.deadline, 31_000);
  assert.equal(selection.ballotsCast, 0);
  assert.equal(selection.voterCount, 3);
  assert.deepEqual(
    selection.games.map((game) => game.id),
    ["same-wave", "darts"],
  );
  assert.equal("winner" in selection, false);
  assert.equal("ballots" in selection, false);
  assert.ok(!JSON.stringify(selection).includes(alice.player.id));

  assert.equal(lobby(manager, alice.player.id).selection?.myBallot, null);
  assert.equal(lobby(manager, bob.player.id).selection?.myBallot, null);
});

test("rejects ballots for ineligible games, duplicate ballots, and ballots outside a vote", () => {
  const { manager, join } = setup();
  const alice = join("Alice");

  join("Bob");
  join("Carol");

  assert.deepEqual(manager.castBallot(alice.player.id, "darts"), {
    ok: false,
    code: "wrong_phase",
    message: "There is no game vote in progress.",
  });

  manager.startGameVote(alice.player.id);

  assert.deepEqual(manager.castBallot(alice.player.id, "missing"), {
    ok: false,
    code: "not_eligible",
    message: "That game is not on the ballot.",
  });
  assert.deepEqual(manager.castBallot(alice.player.id, "darts"), {
    ok: true,
    finished: false,
  });
  assert.deepEqual(manager.castBallot(alice.player.id, "same-wave"), {
    ok: false,
    code: "already_voted",
    message: "Your ballot is already cast.",
  });
  assert.equal(lobby(manager, alice.player.id).selection?.myBallot, "darts");
  assert.equal(manager.lobbyState().selection?.ballotsCast, 1);
});

test("closes early when every connected player has voted and starts exactly one game", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGameVote(alice.player.id);

  manager.castBallot(alice.player.id, "same-wave");
  manager.castBallot(bob.player.id, "same-wave");

  assert.ok(manager.lobbyState().selection);

  assert.deepEqual(manager.castBallot(carol.player.id, "darts"), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.lobbyState().selection, null);
  assert.equal(manager.gameId, "same-wave");
  assert.equal(manager.screenState()?.gameId, "same-wave");
});

test("breaks a tie uniformly with the injected random source", () => {
  for (const [value, expected] of [
    [0, "same-wave"],
    [0.49, "same-wave"],
    [0.5, "darts"],
    [0.99, "darts"],
  ] as const) {
    const { manager, join } = setup({ random: () => value });
    const alice = join("Alice");
    const bob = join("Bob");
    const carol = join("Carol");
    const dave = join("Dave");

    manager.startGameVote(alice.player.id);
    manager.castBallot(alice.player.id, "same-wave");
    manager.castBallot(bob.player.id, "same-wave");
    manager.castBallot(carol.player.id, "darts");
    manager.castBallot(dave.player.id, "darts");

    assert.equal(manager.gameId, expected, `random value ${value}`);
  }
});

test("missing votes abstain at the deadline and the most-voted game wins", () => {
  const { manager, join, advance } = setup();
  const alice = join("Alice");
  const bob = join("Bob");

  join("Carol");

  manager.startGameVote(alice.player.id);
  manager.castBallot(alice.player.id, "darts");
  manager.castBallot(bob.player.id, "darts");

  assert.deepEqual(manager.handleDeadline(), {
    ok: false,
    code: "invalid_action",
    message: "The game vote is still open.",
  });

  advance(30_000);

  assert.deepEqual(manager.handleDeadline(), { ok: true, finished: false });
  assert.equal(manager.gameId, "darts");
  assert.equal(manager.lobbyState().selection, null);
});

test("chooses uniformly from eligible games when nobody votes", () => {
  const first = setup({ random: () => 0 });
  const alice = first.join("Alice");

  first.join("Bob");
  first.join("Carol");
  first.manager.startGameVote(alice.player.id);
  first.advance(30_000);
  first.manager.handleDeadline();

  assert.equal(first.manager.gameId, "same-wave");

  const second = setup({ random: () => 0.99 });
  const dave = second.join("Dave");

  second.join("Eve");
  second.join("Frank");
  second.manager.startGameVote(dave.player.id);
  second.advance(30_000);
  second.manager.handleDeadline();

  assert.equal(second.manager.gameId, "darts");
});

test("excludes disconnected players from voters and closes cleanly on disconnect", () => {
  const { manager, room, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");
  const dave = join("Dave");

  manager.startGameVote(alice.player.id);
  manager.castBallot(alice.player.id, "same-wave");
  manager.castBallot(bob.player.id, "same-wave");
  manager.castBallot(carol.player.id, "same-wave");

  assert.equal(manager.lobbyState().selection?.voterCount, 4);
  assert.equal(manager.lobbyState().selection?.ballotsCast, 3);

  room.disconnect(dave.player.id);
  manager.handleRoomChange();

  assert.equal(manager.gameId, "same-wave");
  assert.equal(manager.lobbyState().selection, null);
});

test("does not count a disconnected player's ballot when the vote closes", () => {
  const { manager, room, join } = setup({ random: () => 0 });
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");
  const dave = join("Dave");

  manager.startGameVote(alice.player.id);
  manager.castBallot(alice.player.id, "darts");
  manager.castBallot(bob.player.id, "darts");
  manager.castBallot(dave.player.id, "same-wave");

  assert.equal(manager.lobbyState().selection?.ballotsCast, 3);

  room.disconnect(dave.player.id);
  manager.handleRoomChange();

  assert.ok(manager.lobbyState().selection);

  manager.castBallot(carol.player.id, "same-wave");

  assert.equal(manager.gameId, "darts");
  assert.equal(manager.lobbyState().selection, null);
});

test("falls back to an eligible game when the vote winner no longer fits", () => {
  const { manager, room, join } = setup({ random: () => 0 });
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGameVote(alice.player.id);
  manager.castBallot(alice.player.id, "same-wave");
  manager.castBallot(bob.player.id, "same-wave");

  room.disconnect(carol.player.id);
  manager.handleRoomChange();

  assert.equal(manager.gameId, "darts");
});

test("rejects direct starts while a game vote is open", () => {
  const { manager, join } = setup();
  const alice = join("Alice");

  join("Bob");
  join("Carol");

  manager.startGameVote(alice.player.id);

  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: false,
    code: "selection_in_progress",
    message: "A game vote is already in progress.",
  });
  assert.deepEqual(manager.selectRandom(alice.player.id), {
    ok: false,
    code: "selection_in_progress",
    message: "A game vote is already in progress.",
  });
});

test("reports no eligible game when the registry is empty", () => {
  const { manager, join } = setup({ withGames: false });
  const alice = join("Alice");

  assert.deepEqual(manager.selectRandom(alice.player.id), {
    ok: false,
    code: "not_enough_players",
    message: "No registered game fits this player count.",
  });
  assert.deepEqual(manager.startGameVote(alice.player.id), {
    ok: false,
    code: "not_enough_players",
    message: "No registered game fits this player count.",
  });
});

test("leaving removes the ballot and can close the vote early", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");
  const dave = join("Dave");

  manager.startGameVote(alice.player.id);
  manager.castBallot(alice.player.id, "same-wave");
  manager.castBallot(bob.player.id, "same-wave");
  manager.castBallot(carol.player.id, "same-wave");

  assert.equal(manager.lobbyState().selection?.ballotsCast, 3);
  assert.equal(manager.lobbyState().selection?.voterCount, 4);

  assert.deepEqual(manager.leaveRoom(carol.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.lobbyState().selection?.ballotsCast, 2);
  assert.equal(manager.lobbyState().selection?.voterCount, 3);
  assert.equal(manager.gameId, null);
  assert.equal(manager.lobbyState().players.length, 3);

  manager.castBallot(dave.player.id, "same-wave");

  assert.equal(manager.gameId, "same-wave");
});
