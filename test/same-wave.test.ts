import assert from "node:assert/strict";
import test from "node:test";

import { GameSession } from "../src/server/games/session.js";
import {
  createSameWaveGame,
  TOTAL_ROUNDS,
  type SameWaveController,
  type SameWaveScreen,
  type SameWaveSide,
} from "../src/server/games/same-wave/index.js";
import { SAME_WAVE_PROMPTS } from "../src/server/games/same-wave/prompts.js";

const alice = { id: "p1", name: "Alice" };
const bob = { id: "p2", name: "Bob" };
const carol = { id: "p3", name: "Carol" };
const players = [alice, bob, carol];

function createSession(options: { now?: () => number } = {}): GameSession {
  return new GameSession(
    createSameWaveGame(),
    players,
    options.now ? { now: options.now, random: () => 0.42 } : { random: () => 0.42 },
  );
}

function screen(session: GameSession): SameWaveScreen {
  return session.screenView() as SameWaveScreen;
}

function controller(
  session: GameSession,
  player: { id: string },
): SameWaveController {
  return session.controllerView(player.id) as SameWaveController;
}

function vote(
  session: GameSession,
  player: { id: string },
  side: SameWaveSide,
) {
  return session.apply(player.id, { type: "vote", side });
}

function nextRound(session: GameSession) {
  return session.applyHostAction({ type: "next_round" });
}

test("starts round one with a 30-second voting window", () => {
  const session = createSession({ now: () => 1_000 });
  const view = screen(session);

  assert.equal(view.phase, "voting");

  if (view.phase !== "voting") {
    assert.fail("expected voting");
  }

  assert.equal(view.round, 1);
  assert.equal(view.totalRounds, TOTAL_ROUNDS);
  assert.equal(TOTAL_ROUNDS, 5);
  assert.equal(view.deadline, 31_000);
  assert.equal(view.votedCount, 0);
  assert.equal(view.playerCount, 3);
  assert.equal(session.deadline(), 31_000);
  assert.match(view.prompt.text, /\S/);
  assert.match(view.prompt.a, /\S/);
  assert.match(view.prompt.b, /\S/);
});

test("keeps picks secret and reveals only counts and the winning side", () => {
  const session = createSession();

  assert.deepEqual(vote(session, alice, "a"), { ok: true, finished: false });
  assert.deepEqual(vote(session, bob, "b"), { ok: true, finished: false });

  const votingScreen = screen(session);

  assert.equal(votingScreen.phase, "voting");

  if (votingScreen.phase !== "voting") {
    assert.fail("expected voting");
  }

  assert.equal(votingScreen.votedCount, 2);
  assert.equal("counts" in votingScreen, false);
  assert.equal("votes" in votingScreen, false);
  assert.equal("winner" in votingScreen, false);

  assert.equal(controller(session, alice).myVote, "a");
  assert.equal(controller(session, bob).myVote, "b");
  assert.equal(controller(session, carol).myVote, null);

  const votingJson = JSON.stringify(votingScreen);
  assert.ok(!votingJson.includes('"votes"'));
  assert.ok(!votingJson.includes('"myVote"'));
  assert.ok(!votingJson.includes('"counts"'));

  assert.deepEqual(vote(session, carol, "a"), { ok: true, finished: false });

  const reveal = screen(session);

  assert.equal(reveal.phase, "reveal");

  if (reveal.phase !== "reveal") {
    assert.fail("expected reveal");
  }

  assert.deepEqual(reveal.counts, { a: 2, b: 1 });
  assert.equal(reveal.winner, "a");
  assert.equal("votes" in reveal, false);
  assert.ok(!JSON.stringify(reveal).includes('"votes"'));
  assert.equal(controller(session, alice).myVote, "a");
  assert.equal(controller(session, bob).myVote, "b");

  const aliceReveal = controller(session, alice);

  assert.equal(aliceReveal.phase, "reveal");

  if (aliceReveal.phase !== "reveal") {
    assert.fail("expected reveal");
  }

  assert.deepEqual(
    aliceReveal.scores.map((score) => score.playerId),
    [alice.id, bob.id, carol.id],
  );
});

test("scores one point for the majority side and none for a tie", () => {
  const first = createSession();

  vote(first, alice, "a");
  vote(first, bob, "b");
  vote(first, carol, "b");

  const reveal = screen(first);

  assert.equal(reveal.phase, "reveal");

  if (reveal.phase !== "reveal") {
    assert.fail("expected reveal");
  }

  assert.equal(reveal.winner, "b");
  assert.deepEqual(
    reveal.scores.map(({ playerId, score }) => [playerId, score]),
    [
      [alice.id, 0],
      [bob.id, 1],
      [carol.id, 1],
    ],
  );

  const tied = new GameSession(createSameWaveGame(), [
    alice,
    bob,
    carol,
    { id: "p4", name: "Dave" },
  ]);

  tied.apply(alice.id, { type: "vote", side: "a" });
  tied.apply(bob.id, { type: "vote", side: "a" });
  tied.apply(carol.id, { type: "vote", side: "b" });
  tied.apply("p4", { type: "vote", side: "b" });

  const tiedView = tied.screenView() as SameWaveScreen;
  assert.equal(tiedView.phase, "reveal");

  if (tiedView.phase !== "reveal") {
    assert.fail("expected reveal");
  }

  assert.equal(tiedView.winner, null);
  assert.deepEqual(
    tiedView.scores.map((score) => score.score),
    [0, 0, 0, 0],
  );
});

test("closes on the deadline and treats non-voters as abstentions", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  assert.deepEqual(vote(session, alice, "a"), { ok: true, finished: false });

  now += 30_000;

  assert.deepEqual(session.handleDeadline(), { ok: true, finished: false });
  assert.equal(session.deadline(), null);

  const reveal = screen(session);

  assert.equal(reveal.phase, "reveal");

  if (reveal.phase !== "reveal") {
    assert.fail("expected reveal");
  }

  assert.deepEqual(reveal.counts, { a: 1, b: 0 });
  assert.equal(reveal.winner, null);
  assert.deepEqual(
    reveal.scores.map((score) => score.score),
    [0, 0, 0],
  );
  assert.deepEqual(session.handleDeadline(), {
    ok: false,
    code: "invalid_action",
    message: "Voting is already closed.",
  });
});

test("closes early when every player has voted", () => {
  const session = createSession();

  vote(session, alice, "a");
  vote(session, bob, "a");
  assert.equal(session.deadline() === null, false);

  vote(session, carol, "b");

  assert.equal(session.deadline(), null);
  assert.equal(screen(session).phase, "reveal");
  assert.deepEqual(session.apply(alice.id, { type: "vote", side: "b" }), {
    ok: false,
    code: "invalid_action",
    message: "Voting is closed.",
  });
});

test("rejects invalid and duplicate votes without changing state", () => {
  const session = createSession();
  const before = JSON.stringify(screen(session));

  assert.deepEqual(session.apply(alice.id, { type: "vote", side: "c" }), {
    ok: false,
    code: "invalid_action",
    message: "Vote for side a or b.",
  });
  assert.deepEqual(session.apply(alice.id, { type: "vote" }), {
    ok: false,
    code: "invalid_action",
    message: "Vote for side a or b.",
  });
  assert.deepEqual(session.apply(alice.id, { type: "next_round" }), {
    ok: false,
    code: "invalid_action",
    message: "Vote for side a or b.",
  });
  assert.deepEqual(session.apply(alice.id, null), {
    ok: false,
    code: "invalid_action",
    message: "Vote for side a or b.",
  });
  assert.equal(JSON.stringify(screen(session)), before);

  vote(session, alice, "a");

  assert.deepEqual(session.apply(alice.id, { type: "vote", side: "b" }), {
    ok: false,
    code: "invalid_action",
    message: "You have already voted this round.",
  });
  assert.equal(controller(session, alice).myVote, "a");
});

test("advances rounds only from a reveal, with a fresh window and prompt", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });
  const firstPrompt = screen(session);

  assert.equal(firstPrompt.phase, "voting");

  if (firstPrompt.phase !== "voting") {
    assert.fail("expected voting");
  }

  assert.deepEqual(nextRound(session), {
    ok: false,
    code: "invalid_action",
    message: "Wait for the round to be revealed.",
  });

  vote(session, alice, "a");
  vote(session, bob, "a");
  vote(session, carol, "a");

  now = 5_000;

  assert.deepEqual(nextRound(session), { ok: true, finished: false });

  const second = screen(session);

  assert.equal(second.phase, "voting");

  if (second.phase !== "voting") {
    assert.fail("expected voting");
  }

  assert.equal(second.round, 2);
  assert.equal(second.deadline, 35_000);
  assert.notEqual(second.prompt.id, firstPrompt.prompt.id);
  assert.equal(controller(session, alice).myVote, null);
  assert.equal(session.deadline(), 35_000);
});

test("plays five rounds and reports every tied leader as a winner", () => {
  const session = createSession();
  const patterns: Array<[SameWaveSide, SameWaveSide, SameWaveSide]> = [
    ["a", "a", "b"],
    ["b", "a", "b"],
    ["b", "a", "a"],
    ["a", "a", "a"],
    ["b", "b", "b"],
  ];

  for (const [roundIndex, pattern] of patterns.entries()) {
    vote(session, alice, pattern[0]);
    vote(session, bob, pattern[1]);
    vote(session, carol, pattern[2]);

    const result = nextRound(session);

    if (roundIndex === patterns.length - 1) {
      assert.equal(session.finished, true);
      assert.deepEqual(result, {
        ok: false,
        code: "game_over",
        message: "The game is already over.",
      });
    } else {
      assert.deepEqual(result, { ok: true, finished: false });
    }
  }

  const finished = screen(session);

  assert.equal(finished.phase, "finished");

  if (finished.phase !== "finished") {
    assert.fail("expected finished");
  }

  assert.equal(finished.round, 5);
  assert.deepEqual(
    finished.scores.map(({ playerId, score }) => [playerId, score]),
    [
      [alice.id, 4],
      [bob.id, 4],
      [carol.id, 4],
    ],
  );
  assert.deepEqual(
    finished.winners.map((winner) => winner.playerId),
    [alice.id, bob.id, carol.id],
  );
});

test("draws five different prompts from the original pack", () => {
  const session = createSession();
  const promptIds: string[] = [];

  for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
    const view = screen(session);

    assert.equal(view.phase, "voting");

    if (view.phase !== "voting") {
      assert.fail("expected voting");
    }

    promptIds.push(view.prompt.id);
    vote(session, alice, "a");
    vote(session, bob, "a");
    vote(session, carol, "a");

    if (round < TOTAL_ROUNDS) {
      nextRound(session);
    }
  }

  assert.equal(new Set(promptIds).size, TOTAL_ROUNDS);
  assert.ok(promptIds.every((id) => id.startsWith("wave-")));
});

test("ships 24 original prompts with unique ids and distinct options", () => {
  assert.equal(SAME_WAVE_PROMPTS.length, 24);
  assert.equal(new Set(SAME_WAVE_PROMPTS.map((prompt) => prompt.id)).size, 24);
  assert.equal(new Set(SAME_WAVE_PROMPTS.map((prompt) => prompt.text)).size, 24);

  for (const prompt of SAME_WAVE_PROMPTS) {
    assert.match(prompt.id, /^wave-\d{2}$/);
    assert.ok(prompt.text.trim().length > 0);
    assert.ok(prompt.options.a.trim().length > 0);
    assert.ok(prompt.options.b.trim().length > 0);
    assert.notEqual(prompt.options.a, prompt.options.b);
  }
});
