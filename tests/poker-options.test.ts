/** Host-configured starting stack and hand cap. */
import { test, describe } from "node:test";
import assert from "node:assert";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "poker", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("poker host options", () => {
  test("the host stack and hand cap are honoured", async () => {
    const plugin = (await import("../games/poker/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players, { startingStack: 2500, maxHands: 4 });
    const s = inst.state as any;
    // Blinds are already posted, so chips plus the live bet is the stack.
    assert.ok(s.seats.every((seat: any) => seat.chips + seat.bet === 2500), "every seat starts equal");
    assert.strictEqual(s.maxHands, 4);
  });

  test("nonsense options fall back to the defaults", async () => {
    const plugin = (await import("../games/poker/server.ts")).default;
    const players = mk(2);
    const bad = plugin.onStart(room(players), players, { startingStack: -50, maxHands: 0 });
    const s = bad.state as any;
    assert.ok(s.seats.every((seat: any) => seat.chips + seat.bet >= 100), "stack is clamped, never negative");
    assert.ok(s.maxHands >= 1);
  });
});
