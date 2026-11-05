/** Dumb Inventions: chip usage check, scoring, and a scripted round. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { usesChips, roundPoints } from "../games/dumbinventions/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "dumbinventions", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("dumb inventions", () => {
  test("a pitch must contain both chips, case-insensitively", () => {
    assert.strictEqual(usesChips("An umbrella that is also a subscription", ["umbrella", "subscription"]), true);
    assert.strictEqual(usesChips("A SUBSCRIPTION for umbrellas", ["umbrella", "subscription"]), true);
    assert.strictEqual(usesChips("An umbrella", ["umbrella", "subscription"]), false);
  });

  test("1000 per vote, minus 200 when a chip is missing", () => {
    assert.deepStrictEqual(roundPoints([1, 1, null], [true, true, true], 3), [0, 2000, 0]);
    assert.deepStrictEqual(roundPoints([1, 1, null], [true, false, true], 3), [0, 1800, 0]);
    assert.deepStrictEqual(roundPoints([null, null, null], [true, true, true], 3), [0, 0, 0]);
  });

  test("scripted round: name, then pitch, then a vote", async () => {
    const plugin = (await import("../games/dumbinventions/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;
    const chipsFor = (i: number): string[] => s.chips[i];

    for (let i = 0; i < 3; i++) {
      const p = players[i];
      plugin.onInput(inst, p.id, { text: `Gadget ${i}` });
      assert.strictEqual(s.names[i], `Gadget ${i}`);
      plugin.onInput(inst, p.id, { text: `It is a ${chipsFor(i)[0]} and a ${chipsFor(i)[1]}` });
    }
    assert.strictEqual(s.phase, "vote", "all pitches move to voting");

    plugin.onInput(inst, "p0", { choice: "p:0" });
    assert.strictEqual(s.votes[0], null, "cannot vote for yourself");
    plugin.onInput(inst, "p0", { choice: "p:1" });
    plugin.onInput(inst, "p1", { choice: "p:0" });
    plugin.onInput(inst, "p2", { choice: "p:1" });

    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.scores[1], 2000, "two votes at 1000 each");
    assert.strictEqual(s.scores[0], 1000, "one vote");
  });
});
