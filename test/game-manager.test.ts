import assert from "node:assert/strict";
import test from "node:test";

import { GameRegistry } from "../src/server/games/registry.js";
import { GameManager } from "../src/server/games/manager.js";
import { createSameWaveGame } from "../src/server/games/same-wave/index.js";
import type {
  GameControllerState,
  LobbyControllerState,
  SpectatorControllerState,
} from "../src/shared/protocol.js";
import { Room } from "../src/server/room.js";

function setup(options: { voteWindowMs?: number; withGame?: boolean } = {}) {
  let now = 1_000;
  let sequence = 0;
  const room = new Room({
    now: () => now,
    generateId: () => `player-${++sequence}`,
    generateToken: () => `token-${++sequence}`,
  });
  const registry = new GameRegistry();

  if (options.withGame !== false) {
    registry.register(
      createSameWaveGame({ voteWindowMs: options.voteWindowMs ?? 30_000 }),
    );
  }

  const manager = new GameManager(room, registry, { now: () => now });

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

test("lists games and host in the lobby and requires the host to start", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");

  const lobby = manager.lobbyState();

  assert.deepEqual(
    lobby.games.map((game) => game.id),
    ["same-wave"],
  );
  assert.equal(lobby.hostId, alice.player.id);

  const aliceLobby = manager.controllerState(
    alice.player.id,
  ) as LobbyControllerState;
  const bobLobby = manager.controllerState(bob.player.id) as LobbyControllerState;

  assert.equal(aliceLobby.phase, "lobby");
  assert.equal(aliceLobby.isHost, true);
  assert.equal(aliceLobby.canStart, false);
  assert.equal(bobLobby.isHost, false);
  assert.equal(bobLobby.canStart, false);
  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: false,
    code: "not_enough_players",
    message: "Same Wave needs 3-4 connected players.",
  });

  join("Carol");

  const ready = manager.controllerState(
    alice.player.id,
  ) as LobbyControllerState;
  assert.equal(ready.canStart, true);

  assert.deepEqual(manager.startGame(bob.player.id, "same-wave"), {
    ok: false,
    code: "not_host",
    message: "Only the host can start a game.",
  });
  assert.deepEqual(manager.startGame(alice.player.id, "missing"), {
    ok: false,
    code: "unknown_game",
    message: "That game is not available.",
  });
  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: true,
    finished: false,
  });
  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: false,
    code: "game_in_progress",
    message: "A game is already in progress.",
  });

  const screen = manager.screenState();

  assert.ok(screen);
  assert.equal(screen.phase, "game");
  assert.equal(screen.gameId, "same-wave");
  assert.equal(screen.hostId, alice.player.id);
  assert.equal(
    (screen.view as { phase: string }).phase,
    "voting",
  );

  const aliceGame = manager.controllerState(
    alice.player.id,
  ) as GameControllerState;

  assert.equal(aliceGame.phase, "game");
  assert.equal(aliceGame.isHost, true);
  assert.equal(aliceGame.gameId, "same-wave");
  assert.equal((aliceGame.view as { phase: string }).phase, "voting");
});

test("requires enough connected players and excludes disconnected seats", () => {
  const { manager, room, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  room.disconnect(carol.player.id);

  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: false,
    code: "not_enough_players",
    message: "Same Wave needs 3-4 connected players.",
  });

  const resumed = room.resume(carol.token);

  if (!resumed.ok) {
    assert.fail(resumed.message);
  }

  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: true,
    finished: false,
  });

  const dave = join("Dave");
  const spectator = manager.controllerState(
    dave.player.id,
  ) as SpectatorControllerState;

  assert.equal(spectator.phase, "spectating");
  assert.equal(spectator.gameId, "same-wave");
  assert.deepEqual(manager.applyAction(dave.player.id, { type: "vote", side: "a" }), {
    ok: false,
    code: "not_in_game",
    message: "That player is not in this game.",
  });

  room.disconnect(bob.player.id);
  const bobResumed = room.resume(bob.token);

  if (!bobResumed.ok) {
    assert.fail(bobResumed.message);
  }

  assert.deepEqual(manager.applyAction(bob.player.id, { type: "vote", side: "a" }), {
    ok: true,
    finished: false,
  });
});

test("routes votes, host controls, and the return to the lobby", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  assert.deepEqual(manager.applyAction(alice.player.id, { type: "vote", side: "a" }), {
    ok: false,
    code: "wrong_phase",
    message: "There is no game in progress.",
  });

  manager.startGame(alice.player.id, "same-wave");

  assert.deepEqual(
    manager.applyHostAction(bob.player.id, { type: "next_round" }),
    {
      ok: false,
      code: "not_host",
      message: "Only the host can control the game.",
    },
  );

  for (const player of [alice, bob, carol]) {
    assert.deepEqual(
      manager.applyAction(player.player.id, { type: "vote", side: "a" }),
      { ok: true, finished: false },
    );
  }

  const reveal = manager.screenState();

  assert.ok(reveal);
  assert.equal((reveal.view as { phase: string }).phase, "reveal");
  assert.deepEqual(
    (reveal.view as { counts: { a: number; b: number } }).counts,
    { a: 3, b: 0 },
  );

  assert.deepEqual(
    manager.applyHostAction(alice.player.id, { type: "next_round" }),
    { ok: true, finished: false },
  );
  assert.equal(
    (manager.screenState()?.view as { round: number }).round,
    2,
  );
  assert.deepEqual(manager.returnToLobby(bob.player.id), {
    ok: false,
    code: "not_host",
    message: "Only the host can control the game.",
  });
  assert.deepEqual(manager.returnToLobby(alice.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.screenState(), null);
  assert.equal(manager.gameId, null);
  assert.equal(manager.lobbyState().hostId, alice.player.id);
  assert.equal(
    (manager.controllerState(alice.player.id) as LobbyControllerState).phase,
    "lobby",
  );
});

test("transfers host control during a game and never restores it on resume", () => {
  const { manager, room, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGame(alice.player.id, "same-wave");

  for (const player of [alice, bob, carol]) {
    manager.applyAction(player.player.id, { type: "vote", side: "a" });
  }

  room.disconnect(alice.player.id);

  assert.equal(manager.screenState()?.hostId, bob.player.id);
  assert.deepEqual(
    manager.applyHostAction(alice.player.id, { type: "next_round" }),
    {
      ok: false,
      code: "not_host",
      message: "Only the host can control the game.",
    },
  );
  assert.deepEqual(
    manager.applyHostAction(bob.player.id, { type: "next_round" }),
    { ok: true, finished: false },
  );

  const resumed = room.resume(alice.token);

  if (!resumed.ok) {
    assert.fail(resumed.message);
  }

  assert.equal(manager.screenState()?.hostId, bob.player.id);
  assert.equal(
    (manager.controllerState(alice.player.id) as GameControllerState).isHost,
    false,
  );

  room.disconnect(bob.player.id);
  assert.equal(manager.screenState()?.hostId, alice.player.id);

  room.disconnect(alice.player.id);
  assert.equal(manager.screenState()?.hostId, carol.player.id);
});

test("closes a round on the deadline, keeps abstentions, and rejects early ticks", () => {
  const { manager, join, advance } = setup({ voteWindowMs: 1_000 });
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGame(alice.player.id, "same-wave");
  assert.equal(manager.deadline(), 2_000);

  manager.applyAction(alice.player.id, { type: "vote", side: "a" });
  manager.applyAction(bob.player.id, { type: "vote", side: "b" });

  assert.deepEqual(manager.handleDeadline(), {
    ok: false,
    code: "invalid_action",
    message: "The voting window is still open.",
  });

  advance(1_000);

  assert.deepEqual(manager.handleDeadline(), { ok: true, finished: false });
  assert.equal(manager.deadline(), null);

  const screen = manager.screenState();
  const view = screen?.view as {
    phase: string;
    counts: { a: number; b: number };
    winner: string | null;
  };

  assert.equal(view.phase, "reveal");
  assert.deepEqual(view.counts, { a: 1, b: 1 });
  assert.equal(view.winner, null);
  assert.equal(
    (manager.controllerState(carol.player.id) as GameControllerState).phase,
    "game",
  );
});

test("reports canStart only when a host has a game that fits", () => {
  const { manager, join } = setup({ withGame: false });
  const alice = join("Alice");

  join("Bob");
  join("Carol");

  assert.deepEqual(manager.lobbyState().games, []);
  assert.equal(
    (manager.controllerState(alice.player.id) as LobbyControllerState).canStart,
    false,
  );
  assert.deepEqual(manager.startGame(alice.player.id, "same-wave"), {
    ok: false,
    code: "unknown_game",
    message: "That game is not available.",
  });
});

test("leaving the lobby releases the seat and transfers host control", () => {
  const { manager, room, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");

  assert.deepEqual(manager.leaveRoom(alice.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(room.publicState().players.length, 1);
  assert.equal(manager.lobbyState().hostId, bob.player.id);
  assert.deepEqual(manager.leaveRoom(alice.player.id), {
    ok: false,
    code: "not_joined",
    message: "You are not in the room.",
  });
});

test("leaving during a game keeps the game alive for the remaining players", () => {
  const { manager, room, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGame(alice.player.id, "same-wave");

  assert.deepEqual(manager.leaveRoom(bob.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.gameId, "same-wave");
  assert.equal(manager.screenState()?.hostId, alice.player.id);
  assert.equal(room.publicState().players.length, 2);
  assert.equal(
    (manager.controllerState(carol.player.id) as GameControllerState).phase,
    "game",
  );
});

test("the host can leave during a game and the new host can end it", () => {
  const { manager, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGame(alice.player.id, "same-wave");

  assert.deepEqual(manager.leaveRoom(alice.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.screenState()?.hostId, bob.player.id);
  assert.deepEqual(manager.returnToLobby(bob.player.id), {
    ok: true,
    finished: false,
  });
  assert.equal(manager.gameId, null);
  assert.equal(manager.lobbyState().players.length, 2);
  assert.equal(manager.lobbyState().hostId, bob.player.id);
  assert.equal(
    (manager.controllerState(carol.player.id) as LobbyControllerState).phase,
    "lobby",
  );
});

test("leaving the last player ends the game and clears the room", () => {
  const { manager, room, join } = setup();
  const alice = join("Alice");
  const bob = join("Bob");
  const carol = join("Carol");

  manager.startGame(alice.player.id, "same-wave");
  manager.leaveRoom(alice.player.id);
  manager.leaveRoom(bob.player.id);
  manager.leaveRoom(carol.player.id);

  assert.equal(manager.gameId, null);
  assert.equal(manager.screenState(), null);
  assert.equal(manager.lobbyState().hostId, null);
  assert.deepEqual(room.publicState().players, []);
});
