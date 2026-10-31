/**
 * Poker unit tests: 7-card hand evaluator categories and tiebreakers,
 * plus a randomized betting simulation asserting chips are conserved.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { evaluateHand } from "../games/poker/server.ts";
import type { HandEval } from "../games/poker/server.ts";

type Suit = "hearts" | "diamonds" | "clubs" | "spades";

function c(rank: number, suit: Suit = "hearts") {
  return { suit, rank };
}

function name(cards: ReturnType<typeof c>[]): string {
  return evaluateHand(cards).name;
}

function compare(a: HandEval, b: HandEval): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < len; i++) {
    const d = (a.values[i] ?? 0) - (b.values[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe("poker evaluator", () => {
  test("royal flush beats everything", () => {
    const royal = evaluateHand([c(10, "spades"), c(11, "spades"), c(12, "spades"), c(13, "spades"), c(14, "spades")]);
    assert.strictEqual(royal.name, "Royal Flush");
    assert.strictEqual(royal.category, 8);
  });

  test("straight flush", () => {
    assert.strictEqual(name([c(5, "clubs"), c(6, "clubs"), c(7, "clubs"), c(8, "clubs"), c(9, "clubs")]), "Straight Flush");
  });

  test("four of a kind with kicker", () => {
    const quads = evaluateHand([c(9), c(9, "spades"), c(9, "clubs"), c(9, "diamonds"), c(2, "spades")]);
    assert.strictEqual(quads.name, "Four of a Kind");
    assert.deepStrictEqual(quads.values, [9, 2]);
  });

  test("full house", () => {
    const fh = evaluateHand([c(7), c(7, "spades"), c(7, "clubs"), c(3, "diamonds"), c(3, "spades")]);
    assert.strictEqual(fh.name, "Full House");
    assert.deepStrictEqual(fh.values, [7, 3]);
  });

  test("flush uses top five kickers", () => {
    const fl = evaluateHand([c(2, "diamonds"), c(5, "diamonds"), c(9, "diamonds"), c(11, "diamonds"), c(13, "diamonds")]);
    assert.strictEqual(fl.name, "Flush");
    assert.deepStrictEqual(fl.values, [13, 11, 9, 5, 2]);
  });

  test("ace-low straight (wheel)", () => {
    const wheel = evaluateHand([c(14), c(2, "spades"), c(3, "clubs"), c(4, "diamonds"), c(5, "spades")]);
    assert.strictEqual(wheel.name, "Straight");
    assert.deepStrictEqual(wheel.values, [5]);
  });

  test("trips and kickers", () => {
    const trips = evaluateHand([c(8), c(8, "spades"), c(8, "clubs"), c(12, "diamonds"), c(2, "spades")]);
    assert.strictEqual(trips.name, "Three of a Kind");
    assert.deepStrictEqual(trips.values, [8, 12, 2]);
  });

  test("two pair ordering", () => {
    const tp = evaluateHand([c(10), c(10, "spades"), c(4, "clubs"), c(4, "diamonds"), c(13, "spades")]);
    assert.strictEqual(tp.name, "Two Pair");
    assert.deepStrictEqual(tp.values, [10, 4, 13]);
  });

  test("pair beats high card", () => {
    const pair = evaluateHand([c(2), c(2, "spades"), c(9, "clubs"), c(11, "diamonds"), c(13, "spades")]);
    const high = evaluateHand([c(2), c(5, "spades"), c(9, "clubs"), c(11, "diamonds"), c(13, "spades")]);
    assert.strictEqual(pair.name, "Pair");
    assert.strictEqual(high.name, "High Card");
    assert.ok(compare(pair, high) > 0);
  });

  test("best of 7 cards is chosen", () => {
    // Board pairs the ace; hand has K kicker vs the 2.
    const seven = [c(14), c(14, "spades"), c(13, "clubs"), c(7, "diamonds"), c(2, "spades"), c(9, "clubs"), c(4, "diamonds")];
    const ev = evaluateHand(seven);
    assert.strictEqual(ev.name, "Pair");
    assert.strictEqual(ev.values[0], 14);
    assert.ok(ev.values[1] >= 13, "kicker must include the king");
  });

  test("same category compares kickers, not suits", () => {
    const a = evaluateHand([c(14), c(13, "spades"), c(9, "clubs"), c(7, "diamonds"), c(5, "spades")]);
    const b = evaluateHand([c(14, "clubs"), c(13, "diamonds"), c(9, "spades"), c(7, "clubs"), c(4, "diamonds")]);
    assert.strictEqual(a.name, "High Card");
    assert.strictEqual(b.name, "High Card");
    assert.ok(compare(a, b) > 0, "A-K-9-7-5 beats A-K-9-7-4");
  });
});

describe("poker: randomized betting conserves chips", () => {
  test("total chips stay at players * 1000 over many hands", async () => {
    const plugin = (await import("../games/poker/server.ts")).default;
    for (let run = 0; run < 5; run++) {
      const players = [0, 1, 2, 3].map((i) => ({
        id: `p${i}`,
        name: `P${i}`,
        joinedAt: 0,
        rejoinToken: "t",
        connected: true,
      }));
      const room = {
        id: "r1",
        code: "ABCD",
        hostPlayerId: "p0",
        players,
        gameId: "poker",
        gameState: null,
        createdAt: 0,
        status: "playing" as const,
      };
      const instance = plugin.onStart(room, players);
      let ticks = 0;
      const rand = (n: number) => Math.floor(Math.random() * n);
      while ((instance.state as { finished?: boolean }).finished !== true && ticks < 200000) {
        plugin.onTick(instance, 500);
        const s = instance.state as { turnIndex: number; finished?: boolean };
        if (s.turnIndex >= 0) {
          const pid = players[s.turnIndex].id;
          const cs = plugin.controllerState(instance, pid) as Record<string, unknown>;
          const r = Math.random();
          if (r < 0.3 && cs.canCheck) plugin.onInput(instance, pid, { action: "check" });
          else if (r < 0.6 && cs.canCall) plugin.onInput(instance, pid, { action: "call" });
          else if (r < 0.8 && cs.canRaise) {
            plugin.onInput(instance, pid, {
              action: "raise",
              amount: Math.min(Number(cs.maxRaiseTo), Number(cs.minRaiseTo) + rand(200)),
            });
          } else if (cs.canCheck) plugin.onInput(instance, pid, { action: "check" });
          else if (cs.canCall) plugin.onInput(instance, pid, { action: "call" });
          else plugin.onInput(instance, pid, { action: "fold" });
        }
        ticks++;
      }
      const screen = plugin.screenState(instance) as {
        finished: boolean;
        players: Array<{ name: string; chips: number }>;
      };
      assert.strictEqual(screen.finished, true, `run ${run}: game should finish`);
      const total = screen.players.reduce((sum, p) => sum + p.chips, 0);
      assert.strictEqual(total, 4000, `run ${run}: chips must be conserved`);
    }
  });
});
