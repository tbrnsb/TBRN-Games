import { test, describe } from "node:test";
import assert from "node:assert";
import {
  createSession,
  startRound,
  completeRound,
  abortRound,
  computePlacements,
  pointsForPlace,
  sessionView,
  type SessionState,
} from "../server/session.ts";
import { playerStatKey } from "../shared/results.ts";
import type { GameResult } from "../shared/scoring.ts";
import type { RumblePreset } from "../shared/rumble-presets.ts";

const players = [
  { id: "p0", name: "Ana" },
  { id: "p1", name: "Ben" },
  { id: "p2", name: "Cleo" },
];

const fourPlayers = [...players, { id: "p3", name: "Dee" }];

/** A real-catalog playlist so the resolver keeps every slot at 3-4 players. */
const preset: RumblePreset = {
  id: "test-rounds",
  name: "Test Rounds",
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

function screenFor(names: string[]) {
  const scores = [100, 50, 25, 10];
  return {
    scores: names.map((name, index) => ({ name, score: scores[index] ?? 0 })),
    winner: { name: names[0] },
  };
}

function currentSlot(session: SessionState): string {
  const gameId = session.slots[session.slotIndex]?.gameId;
  assert.ok(gameId, "the current slot must resolve to a game");
  return gameId;
}

function playCurrent(session: SessionState, roster = players): void {
  const gameId = currentSlot(session);
  assert.strictEqual(startRound(session, gameId), true);
  completeRound(session, gameId, gameId, screenFor(roster.map((p) => p.name)), roster);
}

describe("session: slots and rounds", () => {
  test("a preset session resolves its slots and waits on the interlude", () => {
    const s = createSession(players, preset);
    assert.strictEqual(s.presetId, "test-rounds");
    assert.strictEqual(s.presetName, "Test Rounds");
    assert.strictEqual(s.slots.length, 8);
    assert.strictEqual(s.status, "interlude");
    assert.strictEqual(s.slotIndex, 0);
    assert.strictEqual(s.currentGameId, "quiz");
    assert.strictEqual(sessionView(s).selection, "preset");
    assert.strictEqual(s.lastGameDouble, true);
  });

  test("only the current slot's game can start, and it locks the round", () => {
    const s = createSession(players, preset);
    assert.strictEqual(startRound(s, "mindmeld"), false);
    assert.strictEqual(startRound(s, "quiz"), true);
    assert.strictEqual(s.status, "playing");
    assert.strictEqual(s.currentGameId, "quiz");
    assert.strictEqual(startRound(s, "quiz"), false);
  });

  test("aborting a round reopens without awarding points", () => {
    const s = createSession(players, preset);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    abortRound(s);
    assert.strictEqual(s.status, "interlude");
    assert.strictEqual(s.currentGameId, gameId);
    assert.strictEqual(s.rounds.length, 0);
    assert.strictEqual(Object.values(s.stats).every((st) => st.points === 0), true);
  });
});

describe("session: scoring", () => {
  test("placement points are 10/6/3/1", () => {
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(pointsForPlace), [10, 6, 3, 1, 0]);
  });

  test("generic scores rank high-to-low; the declared winner is first", () => {
    const screen = { scores: [
      { name: "Ana", score: 100 },
      { name: "Ben", score: 50 },
      { name: "Cleo", score: 10 },
    ], winner: { name: "Ben" } };
    const places = computePlacements("quiz", screen, players);
    assert.deepStrictEqual(places.map((p) => p.name), ["Ben", "Ana", "Cleo"]);
  });

  test("golf is lower-is-better, darts uses remaining score", () => {
    const golf = computePlacements("golf", { scores: [
      { name: "Ana", totalStrokes: 12 },
      { name: "Ben", totalStrokes: 9 },
      { name: "Cleo", totalStrokes: 15 },
    ] }, players);
    assert.deepStrictEqual(golf.map((p) => p.name), ["Ben", "Ana", "Cleo"]);

    const darts = computePlacements("darts", { players: [
      { name: "Ana", score: 161 },
      { name: "Ben", score: 0 },
      { name: "Cleo", score: 84 },
    ], winner: "Ben" }, players);
    assert.deepStrictEqual(darts.map((p) => p.name), ["Ben", "Cleo", "Ana"]);
  });

  test("a finished round awards points and advances", () => {
    const s = createSession(players, preset);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    completeRound(s, gameId, "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
      ],
      winner: { name: "Ana" },
    }, players);
    assert.strictEqual(s.status, "interlude");
    assert.strictEqual(s.round, 2);
    assert.strictEqual(s.played.includes("quiz"), true);
    assert.strictEqual(s.stats.p0.points, 10);
    assert.strictEqual(s.stats.p1.points, 6);
    assert.strictEqual(s.stats.p2.points, 3);
    assert.strictEqual(s.stats.p0.wins, 1);
    assert.strictEqual(s.currentGameId, "mindmeld");
  });

  test("the last round finishes and crowns a champion", () => {
    const s = createSession(players, preset);
    for (let round = 0; round < 8 && s.status !== "finished"; round++) {
      playCurrent(s);
    }
    assert.strictEqual(s.status, "finished");
    assert.strictEqual(s.champion?.name, "Ana");
    assert.deepStrictEqual(s.trophies.map((t) => t.name), ["Most Wins", "Podium Regular", "Wooden Spoon", "High Roller"]);
  });

  test("quiz accuracy produces the Most Accurate trophy", () => {
    const s = createSession(players, preset);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    completeRound(s, gameId, "Quiz", {
      scores: [
        { name: "Ben", score: 90 },
        { name: "Ana", score: 80 },
        { name: "Cleo", score: 10 },
      ],
    }, players, {
      p0: { correct: 2, answered: 3, fastestMs: 900 },
      p1: { correct: 3, answered: 3, fastestMs: 1200 },
      p2: { correct: 1, answered: 3, fastestMs: 500 },
    });
    assert.strictEqual(s.accuracy.p1.correct, 3);
    // Finish the session to compute trophies.
    while (s.status !== "finished") playCurrent(s);
    const accuracy = s.trophies.find((t) => t.id === "accuracy");
    assert.strictEqual(accuracy?.playerName, "Ben");
    assert.strictEqual(accuracy?.detail, "3/3 correct");
  });

  test("a round records raw scores and stats without changing placement points", () => {
    const s = createSession(players, preset);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    const result: GameResult = {
      standings: [
        { playerId: "p0", rank: 1, raw: 120 },
        { playerId: "p1", rank: 2, raw: 60 },
        { playerId: "p2", rank: 3, raw: 10 },
      ],
      stats: { [playerStatKey("p0", "votesFooled")]: 4, [playerStatKey("p1", "votesFooled")]: 1 },
    };
    completeRound(s, gameId, "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
      ],
      winner: { name: "Ana" },
    }, players, undefined, result);

    const round = s.rounds[0];
    assert.ok(round);
    assert.deepStrictEqual(round.raw, { p0: 120, p1: 60, p2: 10 });
    assert.strictEqual(round.stats?.p0.votesFooled, 4);
    assert.strictEqual(round.stats?.p1.votesFooled, 1);
    assert.strictEqual(s.awardStats.p0.votesFooled, 4);

    // Placement points still come from the screen order, not the result ranks.
    assert.strictEqual(s.stats.p0.points, 10);
    assert.strictEqual(s.stats.p1.points, 6);
    assert.strictEqual(s.stats.p2.points, 3);
  });

  test("four players still earn 10/6/3/1 and every raw score is recorded", () => {
    const s = createSession(fourPlayers, preset);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    completeRound(s, gameId, "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
        { name: "Dee", score: 1 },
      ],
      winner: { name: "Ana" },
    }, fourPlayers);

    assert.deepStrictEqual(
      ["p0", "p1", "p2", "p3"].map((id) => s.stats[id].points),
      [10, 6, 3, 1],
    );
    assert.deepStrictEqual(s.rounds[0]?.raw, { p0: 100, p1: 50, p2: 10, p3: 1 });
  });

  test("a ranked result cannot move another game's placement points", () => {
    const s = createSession(players, preset);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    const result: GameResult = {
      standings: [
        { playerId: "p2", rank: 1, raw: 999 },
        { playerId: "p0", rank: 2, raw: 1 },
        { playerId: "p1", rank: 3, raw: 0 },
      ],
      stats: {},
    };
    completeRound(s, gameId, "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
      ],
    }, players, undefined, result);

    assert.strictEqual(s.stats.p0.points, 10);
    assert.strictEqual(s.stats.p1.points, 6);
    assert.strictEqual(s.stats.p2.points, 3);
  });

  test("the finale exposes awards and aggregated stats beside the trophies", () => {
    // Narrowing the roster to one enabled game leaves a single-slot Rumble.
    const s = createSession(players, preset, ["quiz"]);
    assert.strictEqual(s.length, 1);
    const gameId = currentSlot(s);
    startRound(s, gameId);
    const result: GameResult = {
      standings: [
        { playerId: "p0", rank: 1, raw: 100 },
        { playerId: "p1", rank: 2, raw: 50 },
        { playerId: "p2", rank: 3, raw: 10 },
      ],
      stats: { [playerStatKey("p0", "votesFooled")]: 4, [playerStatKey("p1", "votesFooled")]: 1 },
    };
    completeRound(s, gameId, "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
      ],
    }, players, undefined, result);

    assert.strictEqual(s.status, "finished");
    const liar = s.awards.find((award) => award.id === "best-liar");
    assert.strictEqual(liar?.playerName, "Ana");
    assert.strictEqual(liar?.detail, "4 votes fooled");

    const view = sessionView(s);
    assert.deepStrictEqual(view.awards, s.awards);
    assert.strictEqual(view.awardStats.p0.votesFooled, 4);
    assert.ok(view.trophies.length > 0);
  });
});

describe("session: view", () => {
  test("view exposes the preset slots, current game and standings", () => {
    const s = createSession(players, preset);
    const view = sessionView(s);
    assert.strictEqual(view.presetId, "test-rounds");
    assert.strictEqual(view.presetName, "Test Rounds");
    assert.strictEqual(view.slots.length, 8);
    assert.strictEqual(view.slots[0].originalId, "quiz");
    assert.strictEqual(view.slots[0].gameName, "Quiz");
    assert.strictEqual(view.slotIndex, 0);
    assert.strictEqual(view.currentGameId, "quiz");
    assert.strictEqual(view.nextGameId, "mindmeld");
    assert.strictEqual(view.status, "interlude");
    assert.strictEqual(view.standings.length, 3);
  });
});
