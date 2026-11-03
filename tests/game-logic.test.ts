/**
 * Regression tests for game-logic defects found in the deep review.
 * These exercise game rules directly (no server), so they stay fast.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

interface P {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

const mk = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));

const room = (gameId: string, players: P[]) => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: players[0]?.id ?? null,
  players,
  gameId,
  gameState: null,
  createdAt: 0,
  status: "playing" as const,
});

describe("game logic regressions", () => {
  test("spin war declares the last survivor the winner, not the top knockout score", async () => {
    const plugin = (await import("../games/spinwar/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room("spinwar", players), players);
    const s = inst.state as any;

    // P0 knocked out both opponents (100 points) but was eliminated.
    // P2 survives with 0 points. Highest score must NOT win.
    s.spinners[0].alive = false;
    s.spinners[0].score = 100;
    s.spinners[1].alive = false;
    s.spinners[1].score = 0;
    s.spinners[2].alive = true;
    s.spinners[2].score = 0;
    s.phase = "finished";

    const screen = plugin.screenState(inst) as any;
    assert.strictEqual(screen.winner.name, "P2");
  });

  test("knife throw gives every player maxRounds sets", async () => {
    const plugin = (await import("../games/knifethrow/server.ts")).default;
    const players = mk(4);
    const inst = plugin.onStart(room("knifethrow", players), players);
    const throws = [0, 0, 0, 0];

    let guard = 0;
    while ((inst.state as any).phase !== "finished" && guard++ < 300) {
      const s = inst.state as any;
      throws[s.currentPlayer]++;
      plugin.onInput(inst, players[s.currentPlayer].id, { tap: true });
      plugin.onTick(inst, 100);
    }

    assert.strictEqual((inst.state as any).phase, "finished");
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(throws[i], 15, `P${i} should throw 3 rounds x 5 knives`);
    }
  });

  test("golf caps a hole at par + 4 strokes", async () => {
    const plugin = (await import("../games/golf/server.ts")).default;
    const players = mk(1);
    const inst = plugin.onStart(room("golf", players), players);
    const s = inst.state as any;
    const par = 2; // hole 1

    for (let i = 0; i < par + 4; i++) {
      plugin.onInput(inst, "p0", { move: "up" });
      plugin.onInput(inst, "p0", { move: "down" });
      for (let t = 0; t < 40 && (inst.state as any).phase === "moving"; t++) {
        plugin.onTick(inst, 500);
      }
      if ((inst.state as any).phase === "hole-done") break;
    }

    assert.ok(s.holeStrokes[0] <= par + 4, `hole strokes capped (got ${s.holeStrokes[0]})`);
  });
});
