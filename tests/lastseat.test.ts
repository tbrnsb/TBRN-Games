/** Last Seat: minigame losers, seat loss, and the finale transition. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { reflexLoser, memoryLoser, trapdoorLoser } from "../games/lastseat/server.ts";

const QUESTIONS: Array<{ answer: number }> = JSON.parse(
  readFileSync(new URL("../games/lastseat/content/questions.json", import.meta.url), "utf8"),
) as Array<{ answer: number }>;

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "lastseat", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("last seat", () => {
  test("reflex: early tap or latest tap loses, silence loses worst", () => {
    assert.strictEqual(reflexLoser([null, 2500, 2600], 2000, [0, 1, 2]), 0, "never tapped");
    assert.strictEqual(reflexLoser([500, 2500, 2600], 2000, [0, 1, 2]), 0, "tapped early");
    assert.strictEqual(reflexLoser([2300, 2500, 2600], 2000, [0, 1, 2]), 2, "latest valid tap");
  });

  test("memory: the most wrong loses, a perfect run is safe", () => {
    const seq = [0, 1, 2, 3];
    assert.strictEqual(memoryLoser([[0, 1, 2, 3], [0, 1, 2, 3]], seq, [0, 1]), -1, "everyone right");
    assert.strictEqual(memoryLoser([[0, 0, 0, 0], [0, 1, 2, 3]], seq, [0, 1]), 0);
    assert.strictEqual(memoryLoser([[0, 1, 2, 3], [0, 1]], seq, [0, 1]), 1, "incomplete entry loses");
  });

  test("trapdoors: only the rigged door loses", () => {
    assert.strictEqual(trapdoorLoser([2, 0, 3], 2, [0, 1, 2]), 0);
    assert.strictEqual(trapdoorLoser([0, 1, 3], 2, [0, 1, 2]), -1, "nobody picked it");
  });

  test("a wrong answer sends you to a minigame and can cost the seat", async () => {
    const plugin = (await import("../games/lastseat/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;
    const correct = QUESTIONS[0].answer;

    plugin.onInput(inst, "p0", { choice: String((correct + 1) % 4) });
    plugin.onInput(inst, "p1", { choice: String(correct) });
    plugin.onInput(inst, "p2", { choice: String(correct) });

    assert.strictEqual(s.phase, "minigame", "a wrong answer starts a minigame");
    assert.deepStrictEqual(s.danger, [0], "only the wrong player is in danger");
    assert.strictEqual(s.minigame, "reflex");

    plugin.onInput(inst, "p0", { choice: "tap" });
    // The minigame resolves on the next tick once everybody has input.
    plugin.onTick(inst, 100);

    assert.strictEqual(s.out[0], true, "the seat is lost");
    assert.strictEqual(s.phase, "finale", "two survivors go to the finale");
  });
});
