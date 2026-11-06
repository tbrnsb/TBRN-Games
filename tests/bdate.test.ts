/** Blind Date Chat: pure scoring rules. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { scoreDate } from "../games/bdate/server.ts";

describe("blind date chat", () => {
  test("candidates earn 100 per LOL and 1000 for being picked", () => {
    const points = scoreDate([0, 2, 1], 1, 0);
    assert.deepStrictEqual(points, [0, 1200, 100]);
  });

  test("the dater earns 300 only after three LOLs", () => {
    assert.strictEqual(scoreDate([2, 0, 0], null, 0)[0], 0, "two LOLs is not enough");
    assert.strictEqual(scoreDate([3, 0, 0], null, 0)[0], 300, "three LOLs pays the dater");
  });

  test("a missing pick and an out-of-range pick never pay the 1000", () => {
    assert.deepStrictEqual(scoreDate([1, 1, 1], null, 0), [0, 100, 100]);
    assert.deepStrictEqual(scoreDate([1, 1, 1], 9, 0), [0, 100, 100]);
  });
});
