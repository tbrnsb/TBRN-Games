/**
 * Result extraction (Phase 2, brief 3.3 / 3.7).
 *
 * Pins the two paths: a game's own `results()` when it is well-formed, and the
 * screen-state fallback every current game still uses. Normalisation is the
 * gate both paths share, so missing players, duplicates and NaN never reach a
 * session round.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  extractGameResult,
  normaliseGameResult,
  perPlayerStats,
  playerStatKey,
  resultFromScreen,
  type ResultPlayer,
} from "../shared/results.ts";

const players: ResultPlayer[] = [
  { id: "a", name: "Ana" },
  { id: "b", name: "Ben" },
  { id: "c", name: "Cleo" },
];

const byPlayer = (result: { standings: Array<{ playerId: string; raw: number; rank: number }> }) =>
  new Map(result.standings.map((standing) => [standing.playerId, standing]));

describe("extractGameResult: custom results", () => {
  test("a well-formed plugin result is preferred over the screen state", () => {
    const custom = {
      standings: [
        { playerId: "b", rank: 1, raw: 30 },
        { playerId: "a", rank: 2, raw: 20 },
        { playerId: "c", rank: 3, raw: 10 },
      ],
      stats: { [playerStatKey("b", "votesFooled")]: 4, gameWide: 9 },
    };
    const plugin = {
      results: () => custom,
      screenState: () => ({ scores: [{ name: "Ana", score: 99 }] }),
    };

    const result = extractGameResult(plugin, {}, players, "bluff");
    assert.deepStrictEqual(result, custom);
  });

  test("a result that misses a player falls back to the screen scores", () => {
    const plugin = {
      results: () => ({
        standings: [
          { playerId: "a", rank: 1, raw: 99 },
          { playerId: "b", rank: 2, raw: 98 },
        ],
        stats: {},
      }),
      screenState: () => ({
        scores: [
          { name: "Ana", score: 10 },
          { name: "Ben", score: 20 },
          { name: "Cleo", score: 5 },
        ],
      }),
    };

    const result = extractGameResult(plugin, {}, players, "quiz");
    const standings = byPlayer(result);
    assert.deepStrictEqual(standings.get("b"), { playerId: "b", rank: 1, raw: 20 });
    assert.deepStrictEqual(standings.get("a"), { playerId: "a", rank: 2, raw: 10 });
    assert.deepStrictEqual(standings.get("c"), { playerId: "c", rank: 3, raw: 5 });
  });

  test("a NaN raw makes the plugin result malformed and triggers the fallback", () => {
    const plugin = {
      results: () => ({
        standings: [
          { playerId: "a", rank: 1, raw: Number.NaN },
          { playerId: "b", rank: 2, raw: 5 },
          { playerId: "c", rank: 3, raw: 1 },
        ],
        stats: {},
      }),
      screenState: () => ({ winner: "Cleo", scores: [{ name: "Cleo", score: 7 }] }),
    };

    const result = extractGameResult(plugin, {}, players, "quiz");
    assert.strictEqual(byPlayer(result).get("c")?.raw, 7);
    assert.strictEqual(byPlayer(result).get("a")?.raw, 0);
    assert.strictEqual(result.standings.length, 3);
  });
});

describe("extractGameResult: screen fallback", () => {
  test("generic scores rank high-to-low and keep the raw score", () => {
    const plugin = {
      screenState: () => ({
        scores: [
          { name: "Ana", score: 100 },
          { name: "Ben", score: 50 },
          { name: "Cleo", score: 10 },
        ],
      }),
    };
    const result = extractGameResult(plugin, {}, players, "quiz");
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.playerId),
      ["a", "b", "c"],
    );
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.raw),
      [100, 50, 10],
    );
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.rank),
      [1, 2, 3],
    );
  });

  test("a declared winner ranks first even when another raw score leads", () => {
    const plugin = {
      screenState: () => ({
        scores: [
          { name: "Ana", score: 100 },
          { name: "Ben", score: 50 },
          { name: "Cleo", score: 10 },
        ],
        winner: { name: "Ben" },
      }),
    };
    const result = extractGameResult(plugin, {}, players, "quiz");
    assert.strictEqual(result.standings[0]?.playerId, "b");
    assert.strictEqual(result.standings[0]?.rank, 1);
    assert.strictEqual(result.standings[0]?.raw, 50);
    assert.strictEqual(byPlayer(result).get("a")?.rank, 2);
  });

  test("golf strokes and darts remaining score count down without losing the raw", () => {
    const golf = extractGameResult(
      { screenState: () => ({ scores: [
        { name: "Ana", totalStrokes: 12 },
        { name: "Ben", totalStrokes: 9 },
        { name: "Cleo", totalStrokes: 15 },
      ] }) },
      {},
      players,
      "golf",
    );
    assert.deepStrictEqual(golf.standings.map((standing) => standing.playerId), ["b", "a", "c"]);
    assert.deepStrictEqual(golf.standings.map((standing) => standing.raw), [9, 12, 15]);

    const darts = extractGameResult(
      { screenState: () => ({ players: [
        { name: "Ana", score: 161 },
        { name: "Ben", score: 0 },
        { name: "Cleo", score: 84 },
      ] }) },
      {},
      players,
      "darts",
    );
    assert.deepStrictEqual(darts.standings.map((standing) => standing.playerId), ["b", "c", "a"]);
  });

  test("racing reads racers.progress and poker reads players.chips", () => {
    const racing = extractGameResult(
      { screenState: () => ({ racers: [
        { name: "Ana", progress: 0.8 },
        { name: "Ben", progress: 0.9 },
        { name: "Cleo", progress: 0.4 },
      ] }) },
      {},
      players,
      "racing",
    );
    assert.deepStrictEqual(racing.standings.map((standing) => standing.playerId), ["b", "a", "c"]);

    const poker = extractGameResult(
      { screenState: () => ({ players: [
        { name: "Ana", chips: 300 },
        { name: "Ben", chips: 500 },
        { name: "Cleo", chips: 100 },
      ] }) },
      {},
      players,
      "poker",
    );
    assert.deepStrictEqual(poker.standings.map((standing) => standing.playerId), ["b", "a", "c"]);
  });

  test("a declared winner with no score table still gets a standing", () => {
    const plugin = { screenState: () => ({ winner: { name: "Ben" } }) };
    const result = extractGameResult(plugin, {}, players, "spinwar");
    assert.strictEqual(result.standings.length, 3);
    assert.strictEqual(byPlayer(result).get("b")?.raw, 0);
    assert.deepStrictEqual(new Set(result.standings.map((standing) => standing.playerId)), new Set(["a", "b", "c"]));
  });

  test("resultFromScreen is usable without a plugin wrapper", () => {
    const result = resultFromScreen(
      { scores: [{ name: "Ana", score: 3 }, { name: "Ben", score: 1 }] },
      players.slice(0, 2),
      "quiz",
    );
    assert.deepStrictEqual(result.standings.map((standing) => standing.playerId), ["a", "b"]);
    assert.deepStrictEqual(result.stats, {});
  });
});

describe("normaliseGameResult", () => {
  test("dedupes, coerces numeric strings, drops unknown players and fills the rest", () => {
    const result = normaliseGameResult(
      {
        standings: [
          { playerId: "a", rank: 1, raw: "12" },
          { playerId: "a", rank: 1, raw: 99 },
          { playerId: "b", rank: 2, raw: Number.NaN },
          { playerId: "unknown", rank: 1, raw: 5 },
        ],
        stats: { "a:votesFooled": "4", broken: Number.NaN },
      },
      players,
    );

    assert.deepStrictEqual(result.standings, [
      { playerId: "a", rank: 1, raw: 12 },
      { playerId: "b", rank: 2, raw: 0 },
      { playerId: "c", rank: 2, raw: 0 },
    ]);
    assert.deepStrictEqual(result.stats, { "a:votesFooled": 4 });
  });

  test("missing players get raw 0 and the next free rank", () => {
    const result = normaliseGameResult(
      {
        standings: [
          { playerId: "b", rank: 1, raw: 8 },
          { playerId: "c", rank: 3, raw: 2 },
        ],
        stats: {},
      },
      players,
    );
    assert.deepStrictEqual(result.standings, [
      { playerId: "b", rank: 1, raw: 8 },
      { playerId: "c", rank: 3, raw: 2 },
      { playerId: "a", rank: 4, raw: 0 },
    ]);
  });

  test("a non-object result becomes every player at raw 0", () => {
    const result = normaliseGameResult(undefined, players);
    assert.deepStrictEqual(
      result.standings.map((standing) => ({ playerId: standing.playerId, raw: standing.raw })),
      [
        { playerId: "a", raw: 0 },
        { playerId: "b", raw: 0 },
        { playerId: "c", raw: 0 },
      ],
    );
  });
});

describe("perPlayerStats", () => {
  test("splits player-first keys", () => {
    assert.deepStrictEqual(perPlayerStats({ "a:votesFooled": 3, "b:votesFooled": 1 }), {
      a: { votesFooled: 3 },
      b: { votesFooled: 1 },
    });
  });

  test("accepts both key orders when the table is known, and drops strangers", () => {
    const stats = perPlayerStats(
      {
        "a:votesFooled": 3,
        "correctAccusations:a": 2,
        "unknown:foo": 9,
        "foo:unknown": 9,
      },
      players,
    );
    assert.deepStrictEqual(stats, { a: { votesFooled: 3, correctAccusations: 2 } });
  });

  test("without a table the player-first order is the convention", () => {
    assert.deepStrictEqual(perPlayerStats({ "a:votesFooled": 3 }), { a: { votesFooled: 3 } });
    assert.deepStrictEqual(perPlayerStats({ "no-separator": 3 }), {});
    assert.deepStrictEqual(perPlayerStats({ "a:": 3 }), {});
  });
});
