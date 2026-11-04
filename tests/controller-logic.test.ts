/**
 * Controller/lobby logic tests (no DOM required).
 *
 * The seven layouts are browser-verified; these lock down the decisions that
 * are easy to regress: when choices lock, how grid cells are classified, what
 * poker's action bar offers, and how the lobby stage scales.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { choiceDisabled, gridValueClass, pokerActions } from "../shared/controllers.ts";
import { stageScale } from "../client/screen/layout.ts";

describe("choice controller: lock semantics", () => {
  test("games without a turn flag stay tappable until answered", () => {
    assert.strictEqual(choiceDisabled({ options: [], hasVoted: false }), false);
    assert.strictEqual(choiceDisabled({ options: [] }), false);
  });

  test("answered or wrong-turn states lock the buttons", () => {
    assert.strictEqual(choiceDisabled({ hasVoted: true }), true);
    assert.strictEqual(choiceDisabled({ hasSubmitted: true }), true);
    assert.strictEqual(choiceDisabled({ yourTurn: false }), true);
    assert.strictEqual(choiceDisabled({ isYourTurn: false }), true);
    assert.strictEqual(choiceDisabled({ yourTurn: true, hasVoted: true }), true);
    assert.strictEqual(choiceDisabled({ isYourTurn: true }), false);
  });

  test("null/undefined never lock", () => {
    assert.strictEqual(choiceDisabled(null), false);
    assert.strictEqual(choiceDisabled(undefined), false);
  });
});

describe("private grid: cell classes", () => {
  test("maps server cell values to visual states", () => {
    assert.strictEqual(gridValueClass(""), "");
    assert.strictEqual(gridValueClass("X"), "v-X");
    assert.strictEqual(gridValueClass("o"), "v-o");
    assert.strictEqual(gridValueClass("S"), "v-S");
    assert.strictEqual(gridValueClass("[T]"), "v-selected");
    assert.strictEqual(gridValueClass("1"), "v-fill");
  });
});

describe("poker controller: action bar", () => {
  test("no action fields means no action bar", () => {
    assert.strictEqual(pokerActions({ cards: [] }).show, false);
  });

  test("your turn exposes check/call/raise with amounts", () => {
    const a = pokerActions({
      yourTurn: true,
      canCheck: false,
      canCall: true,
      canRaise: true,
      callAmount: 20,
      minRaiseTo: 40,
    });
    assert.strictEqual(a.show, true);
    assert.strictEqual(a.locked, false);
    assert.strictEqual(a.canCall, true);
    assert.strictEqual(a.callAmount, 20);
    assert.strictEqual(a.minRaiseTo, 40);
  });

  test("someone else's turn locks the actions", () => {
    const a = pokerActions({ yourTurn: false, canCheck: true });
    assert.strictEqual(a.show, true);
    assert.strictEqual(a.locked, true);
  });
});

describe("host lobby stage", () => {
  test("design size maps to 1, 720p stays 1, 1080p scales 1.5", () => {
    assert.strictEqual(stageScale(1280, 666), 1);
    assert.strictEqual(stageScale(1280, 720), 1);
    assert.strictEqual(stageScale(1920, 1080), 1.5);
    assert.strictEqual(stageScale(960, 540), 0.75);
  });

  test("degenerate containers fall back to 1", () => {
    assert.strictEqual(stageScale(0, 0), 1);
    assert.strictEqual(stageScale(1, 500), 1);
  });
});
