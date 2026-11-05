/** Stowaway: accusation tally + a scripted round where the Stowaway is caught. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { tallyAccusation } from "../games/stowaway/server.ts";

describe("stowaway", () => {
  test("a strict majority on the real Stowaway catches them", () => {
    assert.deepStrictEqual(tallyAccusation([1, 1, null, 1], 1), { accused: 1, caught: true });
  });

  test("a tie never catches anyone", () => {
    const result = tallyAccusation([1, 2, null, null], 1);
    assert.strictEqual(result.caught, false, "1-1 tie is not a catch");
  });

  test("no votes means nobody is accused", () => {
    assert.deepStrictEqual(tallyAccusation([null, null, null], 0), { accused: null, caught: false });
  });

  test("garbage votes are ignored, not counted", () => {
    const result = tallyAccusation([-5, 99, null], 0);
    assert.strictEqual(result.caught, false, "a single stray vote is not a majority");
  });

  test("scripted round: everyone clues, votes catch the Stowaway, category guess pays", async () => {
    const plugin = (await import("../games/stowaway/server.ts")).default;
    const players = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
    const room = { id: "r1", code: "ABCDE", hostPlayerId: "p0", players, gameId: "stowaway", gameState: null, createdAt: 0, status: "playing" as const };
    const inst = plugin.onStart(room, players);
    const s = inst.state as any;

    // Skip the brief phase.
    for (let i = 0; i < 4 && s.phase === "brief"; i++) plugin.onTick(inst, 2000);
    assert.strictEqual(s.phase, "clue");

    for (const p of players) plugin.onInput(inst, p.id, { text: "water" });
    assert.strictEqual(s.phase, "discussion");

    for (let i = 0; i < 20 && s.phase === "discussion"; i++) plugin.onTick(inst, 2000);
    assert.strictEqual(s.phase, "vote");

    // Stowaway is p0 this round: p1 and p2 accuse them.
    plugin.onInput(inst, "p1", { choice: "p:0" });
    plugin.onInput(inst, "p2", { choice: "p:0" });
    assert.strictEqual(s.phase, "catchguess", "a majority catches the Stowaway");

    // The Stowaway guesses the real category.
    plugin.onInput(inst, "p0", { choice: s.category });
    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.scores[1], 500, "correct detective scores");
    assert.strictEqual(s.scores[2], 500, "correct detective scores");
    assert.strictEqual(s.scores[0], 500, "caught Stowaway still earns the category guess");
  });
});
