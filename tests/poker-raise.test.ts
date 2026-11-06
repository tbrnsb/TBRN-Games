/** Poker raise bounds reach the controller so the phone can size a bet. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { pokerActions } from "../shared/controllers.ts";

describe("poker raise sizing", () => {
  test("bounds and step are exposed to the card-hand layout", () => {
    const actions = pokerActions({
      yourTurn: true, canRaise: true, canCall: true,
      minRaiseTo: 40, maxRaiseTo: 900, raiseStep: 20, callAmount: 20,
    });
    assert.strictEqual(actions.minRaiseTo, 40);
    assert.strictEqual(actions.maxRaiseTo, 900);
    assert.strictEqual(actions.raiseStep, 20);
  });

  test("a missing or zero step falls back to 1 so the buttons still move", () => {
    assert.strictEqual(pokerActions({ yourTurn: true, canRaise: true, minRaiseTo: 40, raiseStep: 0 }).raiseStep, 1);
    assert.strictEqual(pokerActions({ yourTurn: true, canRaise: true }).raiseStep, 1);
  });
});
