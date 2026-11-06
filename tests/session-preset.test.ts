/**
 * Royal Rumble preset sessions (brief section 6).
 *
 * The preset path replaces vote selection: eight slots resolve at start, every
 * game boundary re-resolves the rest for the players still connected, the last
 * surviving slot doubles, and late joiners/leavers follow the brief's rules.
 * Placement scoring itself is untouched (10/6/3/1).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  addLatePlayer,
  beginNextGame,
  createSession,
  sessionSummary,
  sessionView,
  startRound,
  completeRound,
  type SessionState,
} from "../server/session.ts";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { RUMBLE_PRESETS, type RumblePreset } from "../shared/rumble-presets.ts";

const players3 = [
  { id: "p0", name: "Ana" },
  { id: "p1", name: "Ben" },
  { id: "p2", name: "Cleo" },
];

const players4 = [...players3, { id: "p3", name: "Dee" }];

const EIGHT_PLAYERS = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index}`,
  name: `Player ${index + 1}`,
}));

const FIVE_PLAYERS = EIGHT_PLAYERS.slice(0, 5);

/** A real-catalog playlist whose slots all fit 3-4 players. */
const preset: RumblePreset = {
  id: "preset-test",
  name: "Preset Test",
  vibe: "test",
  idealMin: 3,
  idealMax: 8,
  slots: [
    { gameId: "quiz" },
    { gameId: "mindmeld" },
    { gameId: "mostlikely" },
    { gameId: "bluff" },
    { gameId: "splitroom" },
    { gameId: "fakin" },
    { gameId: "drawful" },
    { gameId: "racing" },
  ],
  bench: [],
};

function scores(names: string[]) {
  const values = [100, 50, 25, 10, 5, 4, 3, 2];
  return {
    scores: names.map((name, index) => ({ name, score: values[index] ?? 0 })),
    winner: { name: names[0] },
  };
}

function currentSlot(session: SessionState): string {
  const gameId = session.slots[session.slotIndex]?.gameId;
  assert.ok(gameId, "the current slot must resolve to a game");
  return gameId;
}

function playCurrent(session: SessionState, roster = players3): void {
  const gameId = currentSlot(session);
  assert.strictEqual(startRound(session, gameId), true);
  completeRound(session, gameId, gameId, scores(roster.map((p) => p.name)), roster);
}

describe("session preset: resolution", () => {
  test("a preset session resolves eight slots at start", () => {
    const session = createSession(players3, preset);
    assert.strictEqual(session.presetId, preset.id);
    assert.strictEqual(session.presetName, preset.name);
    assert.strictEqual(session.slots.length, 8);
    assert.strictEqual(session.length, 8);
    assert.strictEqual(session.slotIndex, 0);
    assert.strictEqual(session.status, "interlude");
    assert.strictEqual(session.selection, "preset");
    assert.strictEqual(session.currentGameId, "quiz");
    assert.deepStrictEqual(session.slots.map((slot) => slot.gameId), preset.slots.map((slot) => slot.gameId));
  });

  test("a drop from 8 to 5 re-resolves the remaining slots and records the announcement", () => {
    const session = createSession(EIGHT_PLAYERS, RUMBLE_PRESETS[3]);
    assert.strictEqual(session.slots.length, 8);
    // Slingshot Arena caps at four, so it is already swapped at eight players.
    assert.ok(session.swaps.some((swap) => swap.from === "arena"), "the start should announce the arena swap");

    const swapsBefore = session.swaps.length;
    playCurrent(session, FIVE_PLAYERS);

    assert.strictEqual(session.status, "interlude");
    assert.ok(session.swaps.length > swapsBefore, "the drop must record a new swap announcement");

    const announced = session.swaps.slice(swapsBefore);
    assert.ok(
      announced.some((swap) => swap.from === "arena" && /needs 2-4 players/.test(swap.reason)),
      "the arena slot's reason should be announced",
    );
    assert.ok(
      announced.some((swap) => swap.announcement.includes("Slingshot Arena")),
      "the announcement should name the original game",
    );

    for (const slot of session.slots) {
      if (!slot.gameId) continue;
      const entry = GAME_CATALOG[slot.gameId];
      assert.ok(entry, `unknown game "${slot.gameId}"`);
      assert.ok(
        5 >= entry.minPlayers && 5 <= entry.maxPlayers,
        `"${slot.gameId}" does not fit the five players still connected`,
      );
    }
  });

  test("beginNextGame starts the already-resolved current slot", () => {
    const session = createSession(players3, preset);
    assert.strictEqual(beginNextGame(session), true);
    assert.strictEqual(session.status, "playing");
    assert.strictEqual(session.currentGameId, "quiz");
    assert.strictEqual(beginNextGame(session), false);
  });
});

describe("session preset: scoring", () => {
  test("three players keep the old 10/6/3 placement points", () => {
    const session = createSession(players3, preset);
    const gameId = currentSlot(session);
    startRound(session, gameId);
    completeRound(session, gameId, "Quiz", scores(["Ana", "Ben", "Cleo"]), players3);

    assert.deepStrictEqual(
      ["p0", "p1", "p2"].map((id) => session.stats[id].points),
      [10, 6, 3],
    );
    assert.deepStrictEqual(
      session.rounds[0]?.results.map((result) => result.points),
      [10, 6, 3],
    );
  });

  test("four players keep the old 10/6/3/1 placement points", () => {
    const session = createSession(players4, preset);
    const gameId = currentSlot(session);
    startRound(session, gameId);
    completeRound(session, gameId, "Quiz", scores(["Ana", "Ben", "Cleo", "Dee"]), players4);

    assert.deepStrictEqual(
      ["p0", "p1", "p2", "p3"].map((id) => session.stats[id].points),
      [10, 6, 3, 1],
    );
    assert.deepStrictEqual(
      session.rounds[0]?.results.map((result) => result.points),
      [10, 6, 3, 1],
    );
  });

  test("last-game doubling applies only to the final surviving slot", () => {
    // Only two games survive, so the second one is the final slot.
    const session = createSession(players3, preset, ["quiz", "mindmeld"]);
    assert.strictEqual(session.length, 2);

    playCurrent(session);
    playCurrent(session);

    assert.strictEqual(session.status, "finished");
    assert.deepStrictEqual(session.rounds.map((round) => round.gameId), ["quiz", "mindmeld"]);
    assert.deepStrictEqual(
      session.rounds[0]?.results.map((result) => result.points),
      [10, 6, 3],
      "the first slot must not double",
    );
    assert.deepStrictEqual(
      session.rounds[1]?.results.map((result) => result.points),
      [20, 12, 6],
      "the final surviving slot must double",
    );
  });

  test("last-game doubling can be switched off", () => {
    const session = createSession(players3, preset, ["quiz", "mindmeld"], { lastGameDouble: false });
    assert.strictEqual(session.lastGameDouble, false);
    playCurrent(session);
    playCurrent(session);

    assert.deepStrictEqual(session.rounds[1]?.results.map((result) => result.points), [10, 6, 3]);
  });
});

describe("session preset: late joins and departures", () => {
  test("a late joiner enters at the lowest current score and cannot lead", () => {
    const session = createSession(players3, preset);
    playCurrent(session);

    assert.strictEqual(addLatePlayer(session, { id: "p3", name: "Dee" }), true);
    assert.strictEqual(session.stats.p3.name, "Dee");
    assert.strictEqual(session.stats.p3.points, 3, "enters on the lowest current score");
    assert.notStrictEqual(sessionView(session).standings[0]?.playerId, "p3", "a late joiner never starts ahead");

    // Added between games, Dee scores from the very next slot.
    playCurrent(session, players4);
    assert.strictEqual(session.rounds[1]?.results.some((result) => result.playerId === "p3"), true);
    assert.ok(session.stats.p3.points > 3);
  });

  test("a player added mid-game never scores retroactively", () => {
    const session = createSession(players3, preset);
    const gameId = currentSlot(session);
    startRound(session, gameId);

    assert.strictEqual(addLatePlayer(session, { id: "p3", name: "Dee" }), true);
    assert.strictEqual(session.stats.p3.points, 0);

    completeRound(session, gameId, "Quiz", scores(["Ana", "Ben", "Cleo", "Dee"]), players4);

    assert.strictEqual(session.stats.p3.points, 0, "the running game must not pay a late joiner");
    assert.strictEqual(session.stats.p0.points, 10);
    assert.strictEqual(session.stats.p1.points, 6);
    assert.strictEqual(session.stats.p2.points, 3);

    // From the next slot they are a normal scorer again.
    playCurrent(session, players4);
    assert.ok(session.stats.p3.points > 0, "the next slot must pay the late joiner");
  });

  test("a departed player keeps their score row", () => {
    const session = createSession(players3, preset);
    playCurrent(session);
    assert.strictEqual(session.stats.p2.points, 3);

    // Cleo is gone for the next game; only two players finish it.
    const remaining = players3.slice(0, 2);
    playCurrent(session, remaining);

    assert.strictEqual(session.stats.p2.points, 3, "the departed row must survive");
    assert.strictEqual(session.stats.p2.name, "Cleo");
    assert.ok(sessionView(session).standings.some((standing) => standing.playerId === "p2"));
  });
});

describe("session preset: finale", () => {
  test("champion and trophies follow the unchanged rules", () => {
    const session = createSession(players3, preset, ["quiz", "mindmeld"]);
    playCurrent(session);
    playCurrent(session);

    assert.strictEqual(session.status, "finished");
    assert.strictEqual(session.champion?.name, "Ana");
    assert.strictEqual(session.champion?.points, 30, "10 from the first slot plus 20 doubled");
    assert.deepStrictEqual(
      session.trophies.map((trophy) => trophy.name),
      ["Most Wins", "Podium Regular", "Wooden Spoon", "High Roller"],
    );
  });

  test("fewer than eight surviving slots still finish cleanly", () => {
    const session = createSession(players3, preset, ["quiz", "mindmeld"]);
    assert.strictEqual(session.length, 2);
    assert.strictEqual(session.slots.filter((slot) => slot.gameId !== null).length, 2);

    while (session.status !== "finished") playCurrent(session);

    assert.strictEqual(session.rounds.length, 2);
    assert.strictEqual(session.slotIndex, session.slots.length);
    assert.ok(session.champion);
    for (const stat of Object.values(session.stats)) {
      assert.ok(Number.isFinite(stat.points) && stat.points >= 0, "no NaN or negative scores");
    }
  });
});

describe("session preset: persistence", () => {
  test("sessionSummary is a JSON-safe snapshot", () => {
    const session = createSession(players3, preset, ["quiz", "mindmeld"]);
    playCurrent(session);

    const summary = sessionSummary(session);
    assert.strictEqual(summary.presetId, preset.id);
    assert.strictEqual(summary.stats.p0.points, 10);
    assert.deepStrictEqual(summary.played, ["quiz"]);
    assert.ok(!("preset" in summary), "the helper should not persist the whole config object");

    assert.deepStrictEqual(JSON.parse(JSON.stringify(summary)), summary);
  });
});
