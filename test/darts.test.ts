import assert from "node:assert/strict";
import test from "node:test";

import {
  AIM_DELAY_MS,
  createDartsGame,
  DARTS_ROUNDS,
  scoreForDelta,
  TURN_GRACE_MS,
  type DartsController,
  type DartsScreen,
} from "../src/server/games/darts/index.js";
import { GameSession } from "../src/server/games/session.js";

const alice = { id: "p1", name: "Alice" };
const bob = { id: "p2", name: "Bob" };
const carol = { id: "p3", name: "Carol" };

function createSession(
  players = [alice, bob, carol],
  options: { now?: () => number } = {},
): GameSession {
  return new GameSession(createDartsGame(), players, {
    now: options.now ?? (() => 1_000),
    random: () => 0.5,
  });
}

function screen(session: GameSession): DartsScreen {
  return session.screenView() as DartsScreen;
}

function controller(
  session: GameSession,
  player: { id: string },
): DartsController {
  return session.controllerView(player.id) as DartsController;
}

function throwDart(session: GameSession, player: { id: string }) {
  return session.apply(player.id, { type: "throw" });
}

test("starts round one on the earliest seated player with a three-second target", () => {
  const session = createSession(undefined, { now: () => 1_000 });
  const view = screen(session);

  assert.equal(view.phase, "playing");

  if (view.phase !== "playing") {
    assert.fail("expected playing");
  }

  assert.equal(view.round, 1);
  assert.equal(view.totalRounds, DARTS_ROUNDS);
  assert.equal(DARTS_ROUNDS, 3);
  assert.equal(view.currentPlayer.id, alice.id);
  assert.equal(view.targetAt, 1_000 + AIM_DELAY_MS);
  assert.equal(view.deadline, 1_000 + AIM_DELAY_MS + TURN_GRACE_MS);
  assert.equal(session.deadline(), view.deadline);
  assert.deepEqual(
    view.scores.map((entry) => [entry.playerId, entry.score]),
    [
      [alice.id, 0],
      [bob.id, 0],
      [carol.id, 0],
    ],
  );
});

test("scores server-side timing tiers and never trusts a client score", () => {
  assert.equal(scoreForDelta(0).score, 50);
  assert.equal(scoreForDelta(80).score, 50);
  assert.equal(scoreForDelta(81).score, 25);
  assert.equal(scoreForDelta(200).score, 25);
  assert.equal(scoreForDelta(201).score, 20);
  assert.equal(scoreForDelta(400).score, 20);
  assert.equal(scoreForDelta(401).score, 10);
  assert.equal(scoreForDelta(700).score, 10);
  assert.equal(scoreForDelta(701).score, 5);
  assert.equal(scoreForDelta(1_200).score, 5);
  assert.equal(scoreForDelta(1_201).score, 0);
  assert.equal(scoreForDelta(0).label, "Bullseye");
  assert.equal(scoreForDelta(1_201).label, "Miss");
});

test("scores early and late throws by distance from the target", () => {
  assert.equal(scoreForDelta(-80).score, 50);
  assert.equal(scoreForDelta(-81).score, 25);
  assert.equal(scoreForDelta(-200).score, 25);
  assert.equal(scoreForDelta(-201).score, 20);
  assert.equal(scoreForDelta(-400).score, 20);
  assert.equal(scoreForDelta(-401).score, 10);
  assert.equal(scoreForDelta(-700).score, 10);
  assert.equal(scoreForDelta(-701).score, 5);
  assert.equal(scoreForDelta(-1_200).score, 5);
  assert.equal(scoreForDelta(-1_201).score, 0);

  let now = 1_000;
  const session = createSession(undefined, { now: () => now });

  now = 1_000 + AIM_DELAY_MS - 80;
  assert.deepEqual(throwDart(session, alice), { ok: true, finished: false });
  assert.equal(screen(session).lastThrow?.score, 50);
  assert.equal(screen(session).lastThrow?.deltaMs, -80);
});

test("throws at the target, advances turn order, and resets the next target", () => {
  let now = 1_000;
  const session = createSession(undefined, { now: () => now });

  now = 1_000 + AIM_DELAY_MS;

  assert.deepEqual(throwDart(session, alice), { ok: true, finished: false });

  const afterAlice = screen(session);

  assert.equal(afterAlice.phase, "playing");

  if (afterAlice.phase !== "playing") {
    assert.fail("expected playing");
  }

  assert.equal(afterAlice.currentPlayer.id, bob.id);
  assert.equal(afterAlice.lastThrow?.playerId, alice.id);
  assert.equal(afterAlice.lastThrow?.score, 50);
  assert.equal(afterAlice.scores[0]?.score, 50);
  assert.equal(afterAlice.targetAt, now + AIM_DELAY_MS);

  now = 7_000 + 500;
  assert.deepEqual(throwDart(session, bob), { ok: true, finished: false });

  const afterBob = screen(session);

  assert.equal(afterBob.phase, "playing");

  if (afterBob.phase !== "playing") {
    assert.fail("expected playing");
  }

  assert.equal(afterBob.currentPlayer.id, carol.id);
  assert.equal(afterBob.lastThrow?.score, 10);
});

test("rejects throws from the wrong player, invalid actions, and finished games", () => {
  const session = createSession();

  assert.deepEqual(throwDart(session, bob), {
    ok: false,
    code: "invalid_action",
    message: "Wait for your turn.",
  });
  assert.deepEqual(session.apply(alice.id, { type: "score", value: 180 }), {
    ok: false,
    code: "invalid_action",
    message: "Press the throw button to throw.",
  });
  assert.deepEqual(session.apply(alice.id, null), {
    ok: false,
    code: "invalid_action",
    message: "Press the throw button to throw.",
  });
});

test("closes an expired turn as a miss and advances to the next player", () => {
  let now = 1_000;
  const session = createSession(undefined, { now: () => now });

  assert.deepEqual(session.handleDeadline(), {
    ok: false,
    code: "invalid_action",
    message: "The turn is still open.",
  });

  now = 1_000 + AIM_DELAY_MS + TURN_GRACE_MS;

  assert.deepEqual(session.handleDeadline(), { ok: true, finished: false });

  const view = screen(session);

  assert.equal(view.phase, "playing");

  if (view.phase !== "playing") {
    assert.fail("expected playing");
  }

  assert.equal(view.currentPlayer.id, bob.id);
  assert.equal(view.lastThrow?.playerId, alice.id);
  assert.equal(view.lastThrow?.score, 0);
  assert.equal(view.lastThrow?.label, "Miss");
});

test("plays three rounds and reports every tied leader as a winner", () => {
  let now = 1_000;
  const session = createSession(undefined, { now: () => now });

  for (let round = 1; round <= DARTS_ROUNDS; round += 1) {
    for (const player of [alice, bob, carol]) {
      now += AIM_DELAY_MS;
      assert.deepEqual(throwDart(session, player), {
        ok: true,
        finished: round === DARTS_ROUNDS && player === carol,
      });
    }
  }

  assert.equal(session.finished, true);

  const view = screen(session);

  assert.equal(view.phase, "finished");

  if (view.phase !== "finished") {
    assert.fail("expected finished");
  }

  assert.deepEqual(
    view.scores.map((entry) => entry.score),
    [150, 150, 150],
  );
  assert.deepEqual(
    view.winners.map((entry) => entry.playerId),
    [alice.id, bob.id, carol.id],
  );
  assert.equal(view.lastThrow?.playerId, carol.id);
  assert.deepEqual(throwDart(session, alice), {
    ok: false,
    code: "game_over",
    message: "The game is already over.",
  });
});

test("keeps controller views private to turn state and survives a reconnect", () => {
  let now = 1_000;
  const session = createSession(undefined, { now: () => now });

  const aliceTurn = controller(session, alice);
  const bobTurn = controller(session, bob);

  assert.equal(aliceTurn.isMyTurn, true);
  assert.equal(bobTurn.isMyTurn, false);
  assert.equal(bobTurn.currentPlayerName, "Alice");
  assert.equal(JSON.stringify(screen(session)).includes("isMyTurn"), false);

  now += AIM_DELAY_MS;
  throwDart(session, alice);

  assert.equal(controller(session, alice).isMyTurn, false);
  assert.equal(controller(session, alice).myScore, 50);
  assert.equal(controller(session, bob).isMyTurn, true);
  assert.equal(controller(session, bob).myScore, 0);
});

test("supports a solo game", () => {
  let now = 1_000;
  const session = createSession([alice], { now: () => now });

  for (let round = 1; round <= DARTS_ROUNDS; round += 1) {
    now += AIM_DELAY_MS;
    const result = throwDart(session, alice);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.finished, round === DARTS_ROUNDS);
  }

  const view = screen(session);

  assert.equal(view.phase, "finished");

  if (view.phase !== "finished") {
    assert.fail("expected finished");
  }

  assert.equal(view.winners.length, 1);
  assert.equal(view.winners[0]?.score, 150);
});
