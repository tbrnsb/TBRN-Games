/**
 * Voting layout primitives.
 *
 * These lock down the thresholds from brief 3.5: 1-6 options stay on one
 * screen with large type, 7+ switch to two columns with letter badges, and a
 * cast vote stays editable until everyone has voted or the clock ends.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  LARGE_TYPE_MIN_PX,
  canChangeVote,
  optionLetter,
  voteLayout,
} from "../shared/vote-options.ts";

describe("optionLetter", () => {
  test("numbers the first nine options A through I", () => {
    assert.deepStrictEqual(
      Array.from({ length: 9 }, (_, index) => optionLetter(index)),
      ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    );
  });

  test("rolls over after Z", () => {
    assert.strictEqual(optionLetter(25), "Z");
    assert.strictEqual(optionLetter(26), "AA");
    assert.strictEqual(optionLetter(27), "AB");
    assert.strictEqual(optionLetter(51), "AZ");
    assert.strictEqual(optionLetter(52), "BA");
  });

  test("rejects negative and non-finite indexes", () => {
    assert.strictEqual(optionLetter(-1), "");
    assert.strictEqual(optionLetter(Number.NaN), "");
    assert.strictEqual(optionLetter(Number.POSITIVE_INFINITY), "");
  });
});

describe("voteLayout", () => {
  test("2 options fit one column with A/B badges", () => {
    const layout = voteLayout(2);
    assert.strictEqual(layout.columns, 1);
    assert.deepStrictEqual(layout.letters, ["A", "B"]);
  });

  test("6 options remain one column and never drop below large type", () => {
    const layout = voteLayout(6);
    assert.strictEqual(layout.columns, 1);
    assert.strictEqual(layout.letters.length, 6);
    assert.strictEqual(layout.letters[5], "F");
    assert.ok(layout.minFontPx >= LARGE_TYPE_MIN_PX);
  });

  test("1-6 options keep the large-type floor", () => {
    for (let count = 1; count <= 6; count++) {
      assert.ok(
        voteLayout(count).minFontPx >= LARGE_TYPE_MIN_PX,
        `${count} options fell below the large-type floor`,
      );
    }
  });

  test("7 and 9 options use two columns with unique letters", () => {
    for (const count of [7, 9]) {
      const layout = voteLayout(count);
      assert.strictEqual(layout.columns, 2);
      assert.strictEqual(layout.letters.length, count);
      assert.strictEqual(new Set(layout.letters).size, count);
      assert.strictEqual(layout.letters[0], "A");
      assert.strictEqual(layout.letters[count - 1], optionLetter(count - 1));
    }
  });

  test("10 options keep two columns and cover every option", () => {
    const layout = voteLayout(10);
    assert.strictEqual(layout.columns, 2);
    assert.strictEqual(layout.letters.length, 10);
    assert.strictEqual(layout.letters[9], "J");
  });

  test("font bounds are positive and ordered at every size", () => {
    for (let count = 0; count <= 12; count++) {
      const layout = voteLayout(count);
      assert.ok(layout.maxFontPx > 0);
      assert.ok(layout.minFontPx > 0);
      assert.ok(layout.maxFontPx >= layout.minFontPx);
    }
  });
});

describe("canChangeVote", () => {
  const timeLeftMs = 5000;

  test("covers all four has-voted / all-voted combinations", () => {
    assert.strictEqual(canChangeVote({ hasVoted: false, allVoted: false, timeLeftMs }), true);
    assert.strictEqual(canChangeVote({ hasVoted: true, allVoted: false, timeLeftMs }), true);
    assert.strictEqual(canChangeVote({ hasVoted: false, allVoted: true, timeLeftMs }), false);
    assert.strictEqual(canChangeVote({ hasVoted: true, allVoted: true, timeLeftMs }), false);
  });

  test("the server clock ending closes the ballot", () => {
    assert.strictEqual(canChangeVote({ hasVoted: false, allVoted: false, timeLeftMs: 0 }), false);
    assert.strictEqual(canChangeVote({ hasVoted: true, allVoted: false, timeLeftMs: 0 }), false);
  });
});
