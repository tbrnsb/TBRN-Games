import assert from "node:assert/strict";
import test from "node:test";

import { GameSession } from "../src/server/games/session.js";
import { defineGame } from "../src/server/games/types.js";
import { COUNTER_SECRET, createCounterGame } from "./fixtures/counter-game.js";

const alice = { id: "p1", name: "Alice" };
const bob = { id: "p2", name: "Bob" };
const players = [alice, bob];

test("keeps server state secret and gives each player only their own view", () => {
  const session = new GameSession(createCounterGame(), players);

  assert.deepEqual(session.screenView(), { total: 0, finished: false });
  assert.deepEqual(session.controllerView(alice.id), { count: 0, target: 3 });
  assert.deepEqual(session.controllerView(bob.id), { count: 0, target: 3 });

  assert.deepEqual(session.apply(alice.id, { type: "tap" }), {
    ok: true,
    finished: false,
  });

  assert.deepEqual(session.screenView(), { total: 1, finished: false });
  assert.deepEqual(session.controllerView(alice.id), { count: 1, target: 3 });
  assert.deepEqual(session.controllerView(bob.id), { count: 0, target: 3 });
  assert.ok(!JSON.stringify(session.screenView()).includes(COUNTER_SECRET));
  assert.ok(
    !JSON.stringify(session.controllerView(bob.id)).includes(COUNTER_SECRET),
  );
});

test("validates the seated player list when creating a session", () => {
  assert.throws(
    () => new GameSession(createCounterGame(), [alice]),
    /at least 2/,
  );

  const fivePlayers = Array.from({ length: 5 }, (_, index) => ({
    id: `p${index}`,
    name: `Player ${index}`,
  }));

  assert.throws(
    () => new GameSession(createCounterGame(), fivePlayers),
    /at most 4/,
  );
  assert.throws(
    () => new GameSession(createCounterGame(), [alice, alice]),
    /Duplicate player id/,
  );
});

test("rejects unknown players and invalid actions without changing state", () => {
  const session = new GameSession(createCounterGame(), players);

  assert.deepEqual(session.apply("missing", { type: "tap" }), {
    ok: false,
    code: "unknown_player",
    message: "That player is not in this game.",
  });
  assert.deepEqual(session.apply(alice.id, { type: "dance" }), {
    ok: false,
    code: "invalid_action",
    message: "Only tap actions are allowed.",
  });
  assert.deepEqual(session.apply(alice.id, null), {
    ok: false,
    code: "invalid_action",
    message: "Only tap actions are allowed.",
  });
  assert.deepEqual(session.screenView(), { total: 0, finished: false });
});

test("finishes the game and rejects further actions", () => {
  const session = new GameSession(createCounterGame({ target: 2 }), players);

  assert.deepEqual(session.apply(alice.id, { type: "tap" }), {
    ok: true,
    finished: false,
  });
  assert.deepEqual(session.apply(alice.id, { type: "tap" }), {
    ok: true,
    finished: true,
  });
  assert.equal(session.finished, true);
  assert.deepEqual(session.screenView(), { total: 2, finished: true });

  assert.deepEqual(session.apply(bob.id, { type: "tap" }), {
    ok: false,
    code: "game_over",
    message: "The game is already over.",
  });
  assert.deepEqual(session.apply("missing", { type: "tap" }), {
    ok: false,
    code: "unknown_player",
    message: "That player is not in this game.",
  });
  assert.deepEqual(session.screenView(), { total: 2, finished: true });
});

test("throws when a controller view is requested for an unknown player", () => {
  const session = new GameSession(createCounterGame(), players);

  assert.throws(
    () => session.controllerView("missing"),
    /not in this game/,
  );
});

test("reports missing optional hooks without changing state", () => {
  const session = new GameSession(createCounterGame(), players);
  const before = JSON.stringify(session.screenView());

  assert.equal(session.hasPlayer(alice.id), true);
  assert.equal(session.hasPlayer("missing"), false);
  assert.equal(session.deadline(), null);
  assert.deepEqual(session.applyHostAction({ type: "next_round" }), {
    ok: false,
    code: "invalid_action",
    message: "This game does not accept host actions.",
  });
  assert.deepEqual(session.handleDeadline(), {
    ok: false,
    code: "invalid_action",
    message: "This game has no deadline.",
  });
  assert.equal(JSON.stringify(session.screenView()), before);
});

test("passes the injected random and time sources to the plugin", () => {
  interface ProbeState {
    random: number;
    now: number;
  }

  const probe = defineGame<ProbeState, never, ProbeState, ProbeState>({
    id: "probe",
    name: "Probe",
    minPlayers: 1,
    maxPlayers: 1,
    createState(context) {
      return { random: context.random(), now: context.now() };
    },
    applyAction(context, state) {
      return { ok: true, state };
    },
    screenView(context, state) {
      return state;
    },
    controllerView(context, state) {
      return state;
    },
  });
  const session = new GameSession(
    probe,
    [{ id: "p1", name: "Alice" }],
    {
      random: () => 0.25,
      now: () => 12_345,
    },
  );

  assert.deepEqual(session.screenView(), { random: 0.25, now: 12_345 });
});
