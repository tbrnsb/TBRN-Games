/** Bracket Brawl: bracket shape, duel decisions, voter eligibility, scoring. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { buildBracket, decideDuel } from "../games/bracket/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "bracket", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("bracket brawl", () => {
  test("four players get two semis and a final; three get a duel and a bye", () => {
    assert.strictEqual(buildBracket(4).length, 3);
    assert.deepStrictEqual(buildBracket(3), [{ a: 0, b: 1 }, { a: -1, b: 2 }]);
  });

  test("majority decides a duel and a tie falls to the tie-break pick", () => {
    assert.strictEqual(decideDuel(["a", "a", "b", null], 1), "a");
    assert.strictEqual(decideDuel(["b", "b", "a"], 0), "b");
    assert.strictEqual(decideDuel(["a", "b", null], 0), "a", "tie pick 0");
    assert.strictEqual(decideDuel(["a", "b", null], 1), "b", "tie pick 1");
    assert.strictEqual(decideDuel([null, null], 0), "a", "no votes is a tie");
  });

  test("scripted game: only non-participants vote, and winners score", async () => {
    const plugin = (await import("../games/bracket/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;

    for (const p of players) plugin.onInput(inst, p.id, { text: `answer from ${p.id}` });
    assert.strictEqual(s.phase, "voting");
    assert.strictEqual(s.duels.length, 2, "three players: one duel then a final");

    // Duel 0 is p0 vs p1, so only p2 may vote.
    const before = s.duels[0].votes.filter((v: unknown) => v !== null).length;
    plugin.onInput(inst, "p0", { choice: "a" });
    assert.strictEqual(s.duels[0].votes.filter((v: unknown) => v !== null).length, before, "participants cannot vote");

    plugin.onInput(inst, "p2", { choice: "a" });
    assert.strictEqual(s.duels[0].winner, 0, "p0 wins the duel");
    assert.strictEqual(s.scores[0], 500, "semi win is 500");
    assert.strictEqual(s.scores[2], 100, "a correct voter earns 100");

    // Final: p0 (entry 0) vs p2's answer. Only p1 may vote now.
    plugin.onInput(inst, "p1", { choice: "a" });
    assert.strictEqual(s.duels[1].winner, 0);
    assert.strictEqual(s.scores[0], 1500, "final win is 1000 on top of the semi");
    assert.strictEqual(s.phase, "reveal", "the last duel ends the bracket");
  });
});
