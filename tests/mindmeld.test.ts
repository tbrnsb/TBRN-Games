/** Mind Meld: pure normalization + scoring, plus a scripted full game. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { normalizeAnswer, scoreRound } from "../games/mindmeld/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true,
  }));

const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "mindmeld", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("mind meld", () => {
  test("normalization strips case, punctuation, spaces and simple plurals", () => {
    assert.strictEqual(normalizeAnswer("Cats!"), "cat");
    assert.strictEqual(normalizeAnswer("  APPLES "), "apple");
    assert.strictEqual(normalizeAnswer("berries"), "berry");
    assert.strictEqual(normalizeAnswer("Pass!"), "pass");
    assert.strictEqual(normalizeAnswer("green  beans"), "green bean");
    assert.strictEqual(normalizeAnswer("   "), "");
  });

  test("300 per matching partner, zero for a unique answer", () => {
    const { points, allMatched } = scoreRound(["pizza", "Pizza!", "taco"]);
    assert.deepStrictEqual(points, [300, 300, 0]);
    assert.strictEqual(allMatched, false);
  });

  test("a full match pays the 1000 jackpot and ends the game", () => {
    const { points, allMatched } = scoreRound(["apple", "apples", "APPLE"]);
    assert.deepStrictEqual(points, [1000, 1000, 1000]);
    assert.strictEqual(allMatched, true);
  });

  test("empty answers never match and never score", () => {
    const { points } = scoreRound(["", "", "dog"]);
    assert.deepStrictEqual(points, [0, 0, 0]);
  });

  test("scripted full game: three players meld and the game ends early", async () => {
    const plugin = (await import("../games/mindmeld/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);

    for (const p of players) plugin.onInput(inst, p.id, { text: "Banana" });
    const s = inst.state as { phase: string; scores: number[] };
    assert.strictEqual(s.phase, "reveal", "all submissions move to reveal");
    assert.deepStrictEqual(s.scores, [1000, 1000, 1000], "jackpot applied");

    // Delta is deliberately clamped per tick, so advance in bounded steps.
    for (let i = 0; i < 10 && (inst.state as { phase: string }).phase !== "finished"; i++) {
      plugin.onTick(inst, 2000);
    }
    assert.strictEqual((inst.state as { phase: string }).phase, "finished", "a full meld ends the game");
  });

  test("no submission at the deadline still resolves the round", async () => {
    const plugin = (await import("../games/mindmeld/server.ts")).default;
    const players = mk(2);
    const inst = plugin.onStart(room(players), players);
    plugin.onInput(inst, "p0", { text: "cat" });
    for (let i = 0; i < 12 && (inst.state as { phase: string }).phase === "collect"; i++) {
      plugin.onTick(inst, 2000);
    }
    const s = inst.state as { phase: string; scores: number[] };
    assert.strictEqual(s.phase, "reveal");
    assert.deepStrictEqual(s.scores, [0, 0], "a lone answer scores nothing");
  });
});
