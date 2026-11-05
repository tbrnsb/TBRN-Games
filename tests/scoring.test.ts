/**
 * Shared scoring utilities (Phase 2, brief 3.3).
 *
 * Pure functions only: the per-other-player scaling factor, payout scaling,
 * Rumble rank points, tie handling, the shared result schema and the round
 * sanity bound. Every game will return `GameResult` once its own scoring task
 * lands; this file pins the rules they share.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  AWARDS,
  MAX_ROUND_SCORE,
  rankPoints,
  rankWithTies,
  scalePayout,
  scalingFactor,
  standingsFromScores,
  withinRoundBound,
  type Award,
  type GameResult,
  type GameStanding,
} from "../shared/scoring.ts";

describe("scalingFactor", () => {
  test("unchanged at 2, 3 and 4 players", () => {
    assert.strictEqual(scalingFactor(2), 1);
    assert.strictEqual(scalingFactor(3), 1);
    assert.strictEqual(scalingFactor(4), 1);
  });

  test("falls off exactly as min(1, 3/(N-1)) above 4 players", () => {
    assert.strictEqual(scalingFactor(5), 0.75);
    assert.strictEqual(scalingFactor(6), 0.6);
    assert.strictEqual(scalingFactor(7), 0.5);
    assert.strictEqual(scalingFactor(8), 3 / 7);
  });

  test("defensive below 2 players: returns 1", () => {
    assert.strictEqual(scalingFactor(0), 1);
    assert.strictEqual(scalingFactor(1), 1);
    assert.strictEqual(scalingFactor(Number.NaN), 1);
  });
});

describe("scalePayout", () => {
  test("3 and 4 players pay exactly the base amount (regression guard)", () => {
    for (const base of [50, 100, 200, 250, 500, 1000]) {
      assert.strictEqual(scalePayout(base, 3), base, `base ${base} at 3 players`);
      assert.strictEqual(scalePayout(base, 4), base, `base ${base} at 4 players`);
    }
  });

  test("8 players: 200 -> 86, 100 -> 43", () => {
    assert.strictEqual(scalePayout(200, 8), 86);
    assert.strictEqual(scalePayout(100, 8), 43);
  });

  test("5, 6 and 7 players scale by 0.75, 0.6 and 0.5", () => {
    assert.strictEqual(scalePayout(100, 5), 75);
    assert.strictEqual(scalePayout(100, 6), 60);
    assert.strictEqual(scalePayout(100, 7), 50);
  });

  test("rounds half up", () => {
    // 5 * 0.5 = 2.5 -> 3
    assert.strictEqual(scalePayout(5, 7), 3);
    // 1 * 3/7 = 0.43 -> 0
    assert.strictEqual(scalePayout(1, 8), 0);
  });

  test("defensive below 2 players: returns the base", () => {
    assert.strictEqual(scalePayout(200, 1), 200);
    assert.strictEqual(scalePayout(200, 0), 200);
  });
});

describe("rankPoints", () => {
  const TABLE: Record<number, number[]> = {
    3: [100, 50, 0],
    4: [100, 67, 33, 0],
    5: [100, 75, 50, 25, 0],
    6: [100, 80, 60, 40, 20, 0],
    7: [100, 83, 67, 50, 33, 17, 0],
    8: [100, 86, 71, 57, 43, 29, 14, 0],
  };

  test("full table for N=3..8, rank 1..N", () => {
    for (const [n, expected] of Object.entries(TABLE)) {
      const playerCount = Number(n);
      for (let rank = 1; rank <= playerCount; rank++) {
        assert.strictEqual(
          rankPoints(rank, playerCount),
          expected[rank - 1],
          `N=${playerCount} rank=${rank}`,
        );
      }
    }
  });

  test("first is 100, last is 0", () => {
    for (let n = 2; n <= 8; n++) {
      assert.strictEqual(rankPoints(1, n), 100, `first at N=${n}`);
      assert.strictEqual(rankPoints(n, n), 0, `last at N=${n}`);
    }
  });

  test("defensive below 2 players and out-of-range ranks", () => {
    assert.strictEqual(rankPoints(1, 1), 100);
    assert.strictEqual(rankPoints(1, 0), 100);
    // Ranks are clamped into 1..N rather than producing a negative score.
    assert.strictEqual(rankPoints(0, 5), 100);
    assert.strictEqual(rankPoints(9, 5), 0);
  });
});

describe("rankWithTies", () => {
  test("two-way tie at the top averages the occupied positions", () => {
    const ranked = rankWithTies([
      { id: "a", raw: 10 },
      { id: "b", raw: 10 },
      { id: "c", raw: 7 },
      { id: "d", raw: 3 },
      { id: "e", raw: 1 },
    ]);

    // Positions 1 and 2: (100 + 75) / 2 = 87.5 -> 88.
    assert.deepStrictEqual(ranked, [
      { id: "a", rank: 1, raw: 10, points: 88 },
      { id: "b", rank: 1, raw: 10, points: 88 },
      { id: "c", rank: 3, raw: 7, points: 50 },
      { id: "d", rank: 4, raw: 3, points: 25 },
      { id: "e", rank: 5, raw: 1, points: 0 },
    ]);
  });

  test("three-way tie averages three positions and the next rank skips", () => {
    const ranked = rankWithTies([
      { id: "p1", raw: 100 },
      { id: "p2", raw: 90 },
      { id: "p3", raw: 90 },
      { id: "p4", raw: 90 },
      { id: "p5", raw: 50 },
      { id: "p6", raw: 40 },
      { id: "p7", raw: 30 },
      { id: "p8", raw: 10 },
    ]);

    // Positions 2..4 at N=8: 86, 71, 57 -> average 71.33 -> 71.
    assert.deepStrictEqual(
      ranked.map((entry) => entry.rank),
      [1, 2, 2, 2, 5, 6, 7, 8],
    );
    assert.deepStrictEqual(
      ranked.map((entry) => entry.points),
      [100, 71, 71, 71, 43, 29, 14, 0],
    );
  });

  test("a tie for last shares the average of the bottom positions", () => {
    const ranked = rankWithTies([
      { id: "a", raw: 10 },
      { id: "b", raw: 7 },
      { id: "c", raw: 3 },
      { id: "d", raw: 1 },
      { id: "e", raw: 1 },
    ]);

    // Positions 4 and 5 at N=5: (25 + 0) / 2 = 12.5 -> 13.
    assert.deepStrictEqual(ranked, [
      { id: "a", rank: 1, raw: 10, points: 100 },
      { id: "b", rank: 2, raw: 7, points: 75 },
      { id: "c", rank: 3, raw: 3, points: 50 },
      { id: "d", rank: 4, raw: 1, points: 13 },
      { id: "e", rank: 4, raw: 1, points: 13 },
    ]);
  });

  test("everyone tied shares one rank and the average of all positions", () => {
    const ranked = rankWithTies([
      { id: "d", raw: 5 },
      { id: "c", raw: 5 },
      { id: "b", raw: 5 },
      { id: "a", raw: 5 },
    ]);

    // Positions 1..4 at N=4: 100, 67, 33, 0 -> average 50.
    assert.deepStrictEqual(
      ranked.map((entry) => ({ id: entry.id, rank: entry.rank, points: entry.points })),
      [
        { id: "a", rank: 1, points: 50 },
        { id: "b", rank: 1, points: 50 },
        { id: "c", rank: 1, points: 50 },
        { id: "d", rank: 1, points: 50 },
      ],
    );
  });

  test("equal scores are ordered by id, never by input order", () => {
    const ranked = rankWithTies([
      { id: "c", raw: 5 },
      { id: "a", raw: 5 },
      { id: "b", raw: 5 },
    ]);

    assert.deepStrictEqual(
      ranked.map((entry) => entry.id),
      ["a", "b", "c"],
    );
  });

  test("does not mutate the caller's array or entries", () => {
    const entries = [
      { id: "a", raw: 3 },
      { id: "b", raw: 9 },
    ];
    const snapshot = structuredClone(entries);

    rankWithTies(entries);

    assert.deepStrictEqual(entries, snapshot);
  });
});

describe("standingsFromScores", () => {
  test("returns a GameStanding per player, exactly once, with ranks and raw scores", () => {
    const standings = standingsFromScores([
      { id: "ana", raw: 10 },
      { id: "ben", raw: 10 },
      { id: "cat", raw: 7 },
      { id: "dan", raw: 3 },
      { id: "eve", raw: 1 },
    ]);

    assert.strictEqual(standings.length, 5);
    assert.deepStrictEqual(
      standings.map((entry) => entry.playerId),
      ["ana", "ben", "cat", "dan", "eve"],
    );
    assert.deepStrictEqual(
      standings.map((entry) => entry.rank),
      [1, 1, 3, 4, 5],
    );
    assert.deepStrictEqual(
      standings.map((entry) => entry.raw),
      [10, 10, 7, 3, 1],
    );
    assert.deepStrictEqual(new Set(standings.map((entry) => entry.playerId)).size, 5);
  });

  test("accepts an explicit player count for a partial standings list", () => {
    // Four of eight players are still on the board; positions are out of 8.
    const standings = standingsFromScores(
      [
        { id: "a", raw: 3 },
        { id: "b", raw: 2 },
        { id: "c", raw: 1 },
        { id: "d", raw: 0 },
      ],
      8,
    );

    assert.deepStrictEqual(
      standings.map((entry) => entry.rank),
      [1, 2, 3, 4],
    );
  });

  test("output order is rank order, and ties are ordered by id", () => {
    const standings = standingsFromScores([
      { id: "zoe", raw: 5 },
      { id: "amy", raw: 5 },
      { id: "max", raw: 9 },
    ]);

    assert.deepStrictEqual(
      standings.map((entry) => entry.playerId),
      ["max", "amy", "zoe"],
    );
  });
});

describe("result schema", () => {
  test("a GameResult carries standings and numeric stats", () => {
    const result: GameResult = {
      standings: [
        { playerId: "ana", rank: 1, raw: 8 },
        { playerId: "ben", rank: 2, raw: 3 },
      ],
      stats: { "best-liar:ana": 4, votesFooled: 12 },
    };

    assert.strictEqual(result.standings.length, 2);
    assert.strictEqual(result.stats.votesFooled, 12);
  });

  test("GameStanding has exactly playerId, rank and raw", () => {
    const standing: GameStanding = { playerId: "ana", rank: 1, raw: 8 };
    assert.deepStrictEqual(Object.keys(standing).sort(), ["playerId", "rank", "raw"]);
  });

  test("award names are the seven briefed awards", () => {
    assert.deepStrictEqual([...AWARDS], [
      "best-liar",
      "sharpest-eye",
      "fastest-fingers",
      "crowd-favourite",
      "cold-blooded",
      "comeback-kid",
      "master-of-disguise",
    ]);

    const sample: Award = "cold-blooded";
    assert.ok(AWARDS.includes(sample));
  });
});

describe("round sanity bound", () => {
  test("the ceiling is 1500", () => {
    assert.strictEqual(MAX_ROUND_SCORE, 1500);
  });

  test("boundary is inclusive at 1500 and excludes anything above it", () => {
    assert.strictEqual(withinRoundBound(0), true);
    assert.strictEqual(withinRoundBound(1499), true);
    assert.strictEqual(withinRoundBound(1500), true);
    assert.strictEqual(withinRoundBound(1500.01), false);
    assert.strictEqual(withinRoundBound(1501), false);
  });

  test("non-finite scores are out of bounds", () => {
    assert.strictEqual(withinRoundBound(Number.NaN), false);
    assert.strictEqual(withinRoundBound(Number.POSITIVE_INFINITY), false);
  });
});
