/** Slogan Shirts: derangement, scoring, and a scripted round. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { buildShirts, scoreShirts } from "../games/sloganshirts/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "sloganshirts", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("slogan shirts", () => {
  test("nobody is ever paired with their own slogan", () => {
    for (const n of [3, 4]) {
      const shirts = buildShirts(n);
      assert.strictEqual(shirts.length, n);
      for (const shirt of shirts) {
        assert.notStrictEqual(shirt.design, shirt.slogan, `player ${shirt.design} got their own slogan`);
      }
      assert.strictEqual(new Set(shirts.map((s) => s.slogan)).size, n, "every slogan is used once");
    }
  });

  test("the winning shirt pays both authors 1000, others 100 per vote", () => {
    const shirts = buildShirts(3); // design i, slogan i+1
    const points = scoreShirts([1, 1, 0], shirts, 3);
    // shirt 1 has 2 votes and wins: design 1 and slogan 2 each get 1000.
    // shirt 0 has 1 vote: design 0 and slogan 1 each get 100.
    assert.deepStrictEqual(points, [100, 1100, 1000]);
  });

  test("scripted round: draw, slogan, vote, score", async () => {
    const plugin = (await import("../games/sloganshirts/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;

    for (const p of players) {
      plugin.onInput(inst, p.id, { stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111" } });
      plugin.onInput(inst, p.id, { action: "action" });
    }
    assert.strictEqual(s.phase, "slogan", "all designs submitted");

    for (let i = 0; i < 3; i++) plugin.onInput(inst, players[i].id, { text: `slogan ${i}` });
    assert.strictEqual(s.phase, "vote", "all slogans submitted");
    assert.strictEqual(s.shirts.length, 3);

    // p2 cannot vote for the shirt built from their own design.
    const ownShirt = s.shirts.findIndex((sh: any) => sh.design === 2);
    plugin.onInput(inst, "p2", { choice: `s:${ownShirt}` });
    assert.strictEqual(s.votes[2], null, "own shirt rejected");

    // p0 and p2 back shirt 1; p1 backs shirt 2.
    plugin.onInput(inst, "p0", { choice: "s:1" });
    plugin.onInput(inst, "p2", { choice: "s:1" });
    plugin.onInput(inst, "p1", { choice: "s:2" });

    assert.strictEqual(s.phase, "reveal");
    const shirt = s.shirts[1];
    // Both co-authors get the 1000 win; a player can also collect 100 from
    // another shirt they are part of, so assert the floor.
    assert.ok(s.scores[shirt.design] >= 1000, "design author paid");
    assert.ok(s.scores[shirt.slogan] >= 1000, "slogan author paid");
  });
});
