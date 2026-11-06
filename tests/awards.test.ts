/**
 * Finale awards (Phase 2, brief 3.7).
 *
 * Each briefed award has a stat mapping, ties are broken by name, the finale
 * is capped at six rows, and a session with no stats produces no awards.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  AWARD_DEFINITIONS,
  MAX_AWARDS,
  computeAwards,
  type AwardRound,
} from "../shared/awards.ts";
import { AWARDS } from "../shared/scoring.ts";

const rounds: AwardRound[] = [
  {
    results: [
      { playerId: "a", name: "Ana", place: 3 },
      { playerId: "b", name: "Ben", place: 1 },
      { playerId: "c", name: "Cleo", place: 2 },
    ],
  },
  {
    results: [
      { playerId: "a", name: "Ana", place: 1 },
      { playerId: "b", name: "Ben", place: 3 },
      { playerId: "c", name: "Cleo", place: 2 },
    ],
  },
];

const winnerOf = (stats: Record<string, Record<string, number>>, id: string) =>
  computeAwards(rounds, stats).find((award) => award.id === id);

describe("award definitions", () => {
  test("the seven briefed ids appear once each, in order", () => {
    assert.deepStrictEqual(
      AWARD_DEFINITIONS.map((definition) => definition.id),
      [...AWARDS],
    );
    for (const definition of AWARD_DEFINITIONS) {
      assert.ok(definition.statKeys.length >= 1, `${definition.id} must map a stat`);
      assert.ok(definition.format(2, definition.statKeys[0] ?? "").length > 0);
    }
  });
});

describe("computeAwards: one award per stat family", () => {
  test("best liar reads votes fooled", () => {
    const award = winnerOf(
      { a: { votesFooled: 4 }, b: { votesFooled: 5 }, c: { votesFooled: 1 } },
      "best-liar",
    );
    assert.strictEqual(award?.playerName, "Ben");
    assert.strictEqual(award?.detail, "5 votes fooled");
  });

  test("sharpest eye reads correct accusations", () => {
    const award = winnerOf(
      { a: { correctAccusations: 2 }, b: { correctAccusations: 1 } },
      "sharpest-eye",
    );
    assert.strictEqual(award?.playerName, "Ana");
    assert.strictEqual(award?.detail, "2 correct calls");
  });

  test("fastest fingers rewards the lowest answer time", () => {
    const award = winnerOf(
      { a: { averageAnswerMs: 900 }, b: { averageAnswerMs: 800 }, c: { averageAnswerMs: 1200 } },
      "fastest-fingers",
    );
    assert.strictEqual(award?.playerName, "Ben");
    assert.strictEqual(award?.detail, "0.80s average answer");
  });

  test("crowd favourite reads votes received", () => {
    const award = winnerOf(
      { a: { votesReceived: 7 }, b: { votesReceived: 3 } },
      "crowd-favourite",
    );
    assert.strictEqual(award?.playerName, "Ana");
    assert.strictEqual(award?.detail, "7 votes from the crowd");
  });

  test("cold blooded reads the biggest pot", () => {
    const award = winnerOf(
      { a: { biggestPot: 300 }, b: { biggestPot: 500 } },
      "cold-blooded",
    );
    assert.strictEqual(award?.playerName, "Ben");
    assert.strictEqual(award?.detail, "500 chip pot");
  });

  test("comeback kid uses the biggest rank improvement across rounds", () => {
    const award = winnerOf({ a: { votesFooled: 1 } }, "comeback-kid");
    assert.strictEqual(award?.playerName, "Ana");
    assert.strictEqual(award?.detail, "2 places gained");
  });

  test("comeback kid falls back to a game stat when rounds are too short", () => {
    const award = computeAwards(
      [rounds[0]],
      { a: { rankImprovement: 3 }, b: { rankImprovement: 1 } },
    ).find((entry) => entry.id === "comeback-kid");
    assert.strictEqual(award?.playerName, "Ana");
    assert.strictEqual(award?.detail, "3 places gained");
  });

  test("master of disguise reads rounds undetected", () => {
    const award = winnerOf(
      { a: { roundsUndetected: 2 }, b: { roundsUndetected: 4 } },
      "master-of-disguise",
    );
    assert.strictEqual(award?.playerName, "Ben");
    assert.strictEqual(award?.detail, "4 rounds undetected");
  });
});

describe("computeAwards: determinism and limits", () => {
  test("equal values are broken by player name", () => {
    const award = winnerOf(
      { c: { votesFooled: 5 }, a: { votesFooled: 5 }, b: { votesFooled: 5 } },
      "best-liar",
    );
    assert.strictEqual(award?.playerName, "Ana");
  });

  test("repeated calls with the same input return the same list", () => {
    const stats = { a: { votesFooled: 3, correctAccusations: 1 }, b: { votesFooled: 2 } };
    assert.deepStrictEqual(computeAwards(rounds, stats), computeAwards(rounds, stats));
  });

  test("the finale gets at most six awards, in definition order", () => {
    const stats = {
      a: {
        votesFooled: 4,
        correctAccusations: 2,
        averageAnswerMs: 900,
        votesReceived: 7,
        biggestPot: 300,
        roundsUndetected: 2,
      },
      b: {
        votesFooled: 5,
        correctAccusations: 1,
        averageAnswerMs: 800,
        votesReceived: 3,
        biggestPot: 500,
        roundsUndetected: 4,
      },
    };
    const awards = computeAwards(rounds, stats);
    assert.strictEqual(awards.length, MAX_AWARDS);
    assert.deepStrictEqual(
      awards.map((award) => award.id),
      ["best-liar", "sharpest-eye", "fastest-fingers", "crowd-favourite", "cold-blooded", "comeback-kid"],
    );
  });

  test("no stats means no awards", () => {
    assert.deepStrictEqual(computeAwards(rounds, undefined), []);
    assert.deepStrictEqual(computeAwards(rounds, {}), []);
    assert.deepStrictEqual(computeAwards(rounds, { a: {}, b: {} }), []);
  });
});
