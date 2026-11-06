/** Mind Reader: footrule scoring + a scripted full round. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { footruleDistance, scoreGuess } from "../games/mindreader/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "mindreader", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("mind reader", () => {
  test("footrule distance counts position moves", () => {
    assert.strictEqual(footruleDistance(["a", "b", "c", "d"], ["a", "b", "c", "d"]), 0);
    assert.strictEqual(footruleDistance(["a", "b", "c", "d"], ["b", "a", "c", "d"]), 2);
    assert.strictEqual(footruleDistance(["a", "b", "c", "d"], ["d", "c", "b", "a"]), 8);
  });

  test("identical ranking scores 1000, reversed scores 0, a swap scores 750", () => {
    assert.strictEqual(scoreGuess(["a", "b", "c", "d"], ["a", "b", "c", "d"]), 1000);
    assert.strictEqual(scoreGuess(["a", "b", "c", "d"], ["d", "c", "b", "a"]), 0);
    assert.strictEqual(scoreGuess(["a", "b", "c", "d"], ["b", "a", "c", "d"]), 750);
  });

  test("malformed guesses score zero instead of throwing", () => {
    assert.strictEqual(scoreGuess(["a", "b", "c", "d"], ["a", "b"]), 0);
    assert.strictEqual(scoreGuess(["a", "b", "c", "d"], ["a", "a", "b", "c"]), 0);
    assert.strictEqual(scoreGuess([], []), 0);
  });

  test("scripted round: spotlight scores, one guesser nails it, one reverses it", async () => {
    const plugin = (await import("../games/mindreader/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const state = inst.state as any;
    const ids = state.prompts[0].items.map((i: any) => i.id);

    // Everyone ranks, in different orders.
    plugin.onInput(inst, "p0", { rank: { order: ids } });
    plugin.onInput(inst, "p1", { rank: { order: ids } });
    plugin.onInput(inst, "p2", { rank: { order: [...ids].reverse() } });
    assert.strictEqual(state.phase, "guessing", "all rankings move to guessing");

    // Spotlight is p0 (round 0). p1 matches it, p2 reverses it.
    plugin.onInput(inst, "p1", { rank: { order: ids } });
    plugin.onInput(inst, "p2", { rank: { order: [...ids].reverse() } });

    assert.strictEqual(state.phase, "reveal");
    assert.strictEqual(state.scores[1], 1000, "exact match pays 1000");
    assert.strictEqual(state.scores[2], 0, "reversed guess pays nothing");
    assert.strictEqual(state.scores[0], 100, "spotlight earns per high-scoring guesser");
  });
});
