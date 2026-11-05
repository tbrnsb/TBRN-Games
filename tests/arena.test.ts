/** Slingshot Arena: impulse maths, bounds, and a full match that actually ends. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { impulseFor, outOfBounds } from "../games/arena/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "arena", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("slingshot arena", () => {
  test("impulse follows direction and scales with power", () => {
    const low = impulseFor(0, 1, 0);
    const high = impulseFor(0, 1, 1);
    assert.ok(Math.hypot(high.vx, high.vy) > Math.hypot(low.vx, low.vy), "more power, more speed");
    assert.ok(Math.abs(high.vx) < 1e-9 && high.vy > 0, "straight up gives no x velocity");

    const diagonal = impulseFor(1, 1, 0.5);
    assert.ok(Math.abs(diagonal.vx - diagonal.vy) < 1e-9, "diagonal is symmetric");

    assert.deepStrictEqual(impulseFor(0, 0, 1), { vx: 0, vy: 0 }, "no direction, no shot");
  });

  test("a puck is out once it leaves the arena", () => {
    assert.strictEqual(outOfBounds({ x: 0, y: 0 }), false);
    assert.strictEqual(outOfBounds({ x: 0.9, y: 0 }), false);
    // The centre leaving the rim counts, so 0.99 is already over the edge.
    assert.strictEqual(outOfBounds({ x: 0.99, y: 0 }), true);
    assert.strictEqual(outOfBounds({ x: 1.01, y: 0 }), true);
    assert.strictEqual(outOfBounds({ x: 0.8, y: 0.8 }), true);
  });

  test("a full match reaches a result", async () => {
    const plugin = (await import("../games/arena/server.ts")).default;
    const players = mk(2);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;

    for (let step = 0; step < 6000 && s.phase !== "finished"; step++) {
      if (s.phase === "aiming") {
        const shooter = players[s.turn];
        plugin.onInput(inst, shooter.id, { pad: { x: 0, y: 1 } });
        plugin.onInput(inst, shooter.id, { slider: { axis: "y", value: 1 } });
        plugin.onInput(inst, shooter.id, { action: "action" });
      }
      plugin.onTick(inst, 100);
    }

    assert.strictEqual(s.phase, "finished", "the match must end");
    assert.strictEqual(s.scores.reduce((a: number, b: number) => a + b, 0), 3, "every round awards exactly one win");
    assert.strictEqual(s.round, 3, "three rounds played");
  });
});
