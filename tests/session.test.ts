import { test, describe } from "node:test";
import assert from "node:assert";
import {
  createSession,
  eligibleGames,
  startRound,
  recordVote,
  leadingGameId,
  completeRound,
  abortRound,
  computePlacements,
  pointsForPlace,
  sessionView,
  type SessionGame,
} from "../server/session.ts";
import { playerStatKey } from "../shared/results.ts";
import type { GameResult } from "../shared/scoring.ts";

const players = [
  { id: "p0", name: "Ana" },
  { id: "p1", name: "Ben" },
  { id: "p2", name: "Cleo" },
];

const games: SessionGame[] = [
  { id: "quiz", name: "Quiz", description: "", minPlayers: 1, maxPlayers: 4 },
  { id: "golf", name: "Golf", description: "", minPlayers: 1, maxPlayers: 4 },
  { id: "darts", name: "Darts", description: "", minPlayers: 1, maxPlayers: 4 },
  { id: "poker", name: "Poker", description: "", minPlayers: 2, maxPlayers: 4 },
  { id: "bluff", name: "Bluff", description: "", minPlayers: 3, maxPlayers: 4 },
];

describe("session: candidates and rounds", () => {
  test("eligible games respect the player count and played list", () => {
    const eligible = eligibleGames(games, 2, []);
    assert.deepStrictEqual(eligible.map((g) => g.id), ["quiz", "golf", "darts", "poker"]);
    assert.deepStrictEqual(eligibleGames(games, 2, ["quiz"]).map((g) => g.id).includes("quiz"), false);
  });

  test("length is capped at the eligible games", () => {
    const s = createSession(players, games, 8, "vote");
    assert.strictEqual(s.length, 5);
    assert.strictEqual(s.candidates.length, 5);
    assert.strictEqual(s.status, "voting");
    assert.strictEqual(s.round, 1);
  });

  test("votes pick a leader and starting a round locks it", () => {
    const s = createSession(players, games, 5, "vote");
    assert.strictEqual(recordVote(s, "p0", "quiz"), true);
    assert.strictEqual(recordVote(s, "p1", "golf"), true);
    assert.strictEqual(recordVote(s, "p2", "golf"), true);
    assert.strictEqual(leadingGameId(s), "golf");
    assert.strictEqual(startRound(s, "quiz"), true);
    assert.strictEqual(s.status, "playing");
    assert.strictEqual(s.currentGameId, "quiz");
    assert.strictEqual(startRound(s, "quiz"), false);
  });

  test("aborting a round reopens without awarding points", () => {
    const s = createSession(players, games, 5, "vote");
    recordVote(s, "p0", "quiz");
    startRound(s, "quiz");
    abortRound(s);
    assert.strictEqual(s.status, "voting");
    assert.strictEqual(s.currentGameId, null);
    assert.strictEqual(Object.keys(s.votes).length, 0);
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
    const s = createSession(players, games, 5, "vote");
    startRound(s, "quiz");
    completeRound(s, "quiz", "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
      ],
      winner: { name: "Ana" },
    }, players);
    assert.strictEqual(s.status, "voting");
    assert.strictEqual(s.round, 2);
    assert.strictEqual(s.played.includes("quiz"), true);
    assert.strictEqual(s.stats.p0.points, 10);
    assert.strictEqual(s.stats.p1.points, 6);
    assert.strictEqual(s.stats.p2.points, 3);
    assert.strictEqual(s.stats.p0.wins, 1);
    assert.strictEqual(s.candidates.some((g) => g.id === "quiz"), false);
  });

  test("the last round finishes and crowns a champion", () => {
    const s = createSession(players, games, 5, "vote");
    for (const game of ["quiz", "golf", "darts", "poker", "bluff"]) {
      startRound(s, game);
      completeRound(s, game, game, {
        scores: [
          { name: "Ana", score: 100 },
          { name: "Ben", score: 50 },
          { name: "Cleo", score: 10 },
        ],
        winner: { name: "Ana" },
      }, players);
      if (s.status === "finished") break;
      // Force a deterministic next game in this test.
      if (s.candidates.length > 0) startRound(s, s.candidates[0].id);
    }
    assert.strictEqual(s.status, "finished");
    assert.strictEqual(s.champion?.name, "Ana");
    assert.deepStrictEqual(s.trophies.map((t) => t.name), ["Most Wins", "Podium Regular", "Wooden Spoon", "High Roller"]);
  });

  test("quiz accuracy produces the Most Accurate trophy", () => {
    const s = createSession(players, games, 5, "vote");
    startRound(s, "quiz");
    completeRound(s, "quiz", "Quiz", {
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
    for (const game of ["golf", "darts", "poker", "bluff"]) {
      if (s.status === "finished") break;
      startRound(s, game);
      completeRound(s, game, game, {
        scores: [{ name: "Ana", score: 5 }, { name: "Ben", score: 4 }, { name: "Cleo", score: 3 }],
      }, players);
    }
    const accuracy = s.trophies.find((t) => t.id === "accuracy");
    assert.strictEqual(accuracy?.playerName, "Ben");
    assert.strictEqual(accuracy?.detail, "3/3 correct");
  });

  test("a round records raw scores and stats without changing placement points", () => {
    const s = createSession(players, games, 5, "vote");
    startRound(s, "quiz");
    const result: GameResult = {
      standings: [
        { playerId: "p0", rank: 1, raw: 120 },
        { playerId: "p1", rank: 2, raw: 60 },
        { playerId: "p2", rank: 3, raw: 10 },
      ],
      stats: { [playerStatKey("p0", "votesFooled")]: 4, [playerStatKey("p1", "votesFooled")]: 1 },
    };
    completeRound(s, "quiz", "Quiz", {
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
    const four = [...players, { id: "p3", name: "Dee" }];
    const s = createSession(four, games, 5, "vote");
    startRound(s, "quiz");
    completeRound(s, "quiz", "Quiz", {
      scores: [
        { name: "Ana", score: 100 },
        { name: "Ben", score: 50 },
        { name: "Cleo", score: 10 },
        { name: "Dee", score: 1 },
      ],
      winner: { name: "Ana" },
    }, four);

    assert.deepStrictEqual(
      ["p0", "p1", "p2", "p3"].map((id) => s.stats[id].points),
      [10, 6, 3, 1],
    );
    assert.deepStrictEqual(s.rounds[0]?.raw, { p0: 100, p1: 50, p2: 10, p3: 1 });
  });

  test("a ranked result cannot move another game's placement points", () => {
    const s = createSession(players, games, 5, "vote");
    startRound(s, "quiz");
    const result: GameResult = {
      standings: [
        { playerId: "p2", rank: 1, raw: 999 },
        { playerId: "p0", rank: 2, raw: 1 },
        { playerId: "p1", rank: 3, raw: 0 },
      ],
      stats: {},
    };
    completeRound(s, "quiz", "Quiz", {
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
    const s = createSession(players, games, 1, "vote");
    startRound(s, "quiz");
    const result: GameResult = {
      standings: [
        { playerId: "p0", rank: 1, raw: 100 },
        { playerId: "p1", rank: 2, raw: 50 },
        { playerId: "p2", rank: 3, raw: 10 },
      ],
      stats: { [playerStatKey("p0", "votesFooled")]: 4, [playerStatKey("p1", "votesFooled")]: 1 },
    };
    completeRound(s, "quiz", "Quiz", {
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
  test("view exposes standings, candidates and vote counts", () => {
    const s = createSession(players, games, 5, "vote");
    recordVote(s, "p0", "quiz");
    recordVote(s, "p1", "quiz");
    const view = sessionView(s);
    assert.strictEqual(view.round, 1);
    assert.strictEqual(view.voted, 2);
    assert.strictEqual(view.leadingGameId, "quiz");
    assert.strictEqual(view.votes.find((v) => v.gameId === "quiz")?.count, 2);
    assert.strictEqual(view.standings.length, 3);
  });
});
