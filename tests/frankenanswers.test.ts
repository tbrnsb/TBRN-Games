/** Frankenanswers: pool dealing, composition validation, privacy, pack fallback. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { dealPools, composeAnswer, CONNECTORS, type FaTile } from "../games/frankenanswers/server.ts";

const pack = Array.from({ length: 40 }, (_, i) => ({ id: `pack_${i}`, text: `packword${i}`, author: -1 }));

function chipsFor(players: number): FaTile[] {
  const tiles: FaTile[] = [];
  for (let p = 0; p < players; p++) {
    for (let k = 0; k < 3; k++) tiles.push({ id: `c:${p}:${k}`, text: `p${p}word${k}`, author: p });
  }
  return tiles;
}

describe("frankenanswers", () => {
  test("no player is ever dealt one of their own chips", () => {
    const tiles = [...chipsFor(4), ...pack];
    const pools = dealPools(tiles, 4);
    for (let p = 0; p < 4; p++) {
      const own = pools[p].filter((id) => tiles.find((t) => t.id === id)?.author === p);
      assert.deepStrictEqual(own, [], `player ${p} was dealt their own chip`);
      assert.strictEqual(pools[p].length, 10, "6 chips plus 4 connectors");
    }
  });

  test("a pool never runs short: the pack fills the gap", () => {
    // No player chips at all, so every pool must come from the pack.
    const pools = dealPools([...pack], 3);
    for (const pool of pools) {
      const chipIds = pool.filter((id) => !CONNECTORS.some((c) => c.id === id));
      assert.strictEqual(chipIds.length, 6);
      assert.ok(chipIds.every((id) => id.startsWith("pack_")));
    }
  });

  test("composition only accepts the player's own tiles, once each", () => {
    const tiles: FaTile[] = [
      { id: "x1", text: "a", author: 1 },
      { id: "x2", text: "b", author: 2 },
      { id: "x3", text: "c", author: 1 },
      { id: "x4", text: "d", author: 2 },
      ...CONNECTORS,
    ];
    const pool = ["x1", "x2", "x3", "x4", "k:0", "k:1"];

    const ok = composeAnswer(["x1", "k:0", "x2", "x3"], pool, tiles);
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.text, "a the b c");
    assert.deepStrictEqual(ok.chipIds, ["x1", "x2", "x3"]);

    assert.strictEqual(composeAnswer(["x1", "zzz", "x2", "x3"], pool, tiles).ok, false, "foreign tile");
    assert.strictEqual(composeAnswer(["x1", "x1", "x2", "x3"], pool, tiles).ok, false, "duplicate tile");
    assert.strictEqual(composeAnswer(["x1", "x2"], pool, tiles).ok, false, "too few chips");
    assert.strictEqual(composeAnswer(["x1", "x2", "x3", "k:0", "k:1", "k:0"], pool, tiles).ok, false, "duplicate link");
  });

  test("a phone only ever sees its own pool, and the screen sees none", async () => {
    const plugin = (await import("../games/frankenanswers/server.ts")).default;
    const players = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
    const room = { id: "r1", code: "ABCDE", hostPlayerId: "p0", players, gameId: "frankenanswers", gameState: null, createdAt: 0, status: "playing" as const };
    const inst = plugin.onStart(room, players);
    const s = inst.state as any;

    for (const p of players) for (let k = 0; k < 3; k++) plugin.onInput(inst, p.id, { text: `${p.id}chip${k}` });
    assert.strictEqual(s.phase, "build");

    const screenJson = JSON.stringify(plugin.screenState(inst));
    assert.ok(!screenJson.includes("c:0:0"), "chip ids must not reach the screen");

    for (let p = 0; p < 3; p++) {
      const cs = plugin.controllerState(inst, players[p].id) as any;
      const ids = cs.rank.items.map((i: any) => i.id);
      assert.ok(ids.every((id: string) => s.pools[p].includes(id)), `player ${p} sees a tile outside their pool`);
      assert.ok(!ids.includes(`c:${p}:0`), `player ${p} sees their own chip`);
    }
  });

  test("scripted round: build, vote, and chip authors get credit", async () => {
    const plugin = (await import("../games/frankenanswers/server.ts")).default;
    const players = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
    const room = { id: "r1", code: "ABCDE", hostPlayerId: "p0", players, gameId: "frankenanswers", gameState: null, createdAt: 0, status: "playing" as const };
    const inst = plugin.onStart(room, players);
    const s = inst.state as any;

    for (const p of players) for (let k = 0; k < 3; k++) plugin.onInput(inst, p.id, { text: `${p.id}chip${k}` });

    for (let p = 0; p < 3; p++) {
      const cs = plugin.controllerState(inst, players[p].id) as any;
      const order = cs.rank.items.filter((i: any) => !i.id.startsWith("k:")).slice(0, 3).map((i: any) => i.id);
      plugin.onInput(inst, players[p].id, { rank: { order } });
    }
    assert.strictEqual(s.phase, "vote");
    assert.ok(s.answers.every((a: any) => a && a.chipIds.length === 3));

    plugin.onInput(inst, "p0", { choice: "a1" });
    plugin.onInput(inst, "p1", { choice: "a0" });
    plugin.onInput(inst, "p2", { choice: "a0" });

    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.scores[0], 2000, "author of the two-vote answer scores 1000 per vote");

    // Chip credit is 100 per chip of that answer, paid to whoever wrote them.
    const winner = s.answers[0];
    const expected = winner.chipIds.reduce((sum: number, id: string) => {
      const tile = s.tiles.find((t: any) => t.id === id);
      return sum + (tile && tile.author >= 0 ? 100 : 0);
    }, 0);
    assert.strictEqual(expected, 300, "the winning answer used three player chips");
    assert.ok(s.scores[1] >= 300, "chip authors earn 100 per chip used");
  });
});
