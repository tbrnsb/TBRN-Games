/** Mash-Up Monsters: sheet rotation, scoring, and a scripted game. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { sheetFor, scoreMonsters } from "../games/mashup/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "mashup", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("mash up monsters", () => {
  test("every pass sends players to different sheets, and no sheet repeats a player", () => {
    const n = 4;
    const seen = new Set<string>();
    for (let pass = 0; pass < n; pass++) {
      const sheets = Array.from({ length: n }, (_, p) => sheetFor(p, pass, n));
      assert.strictEqual(new Set(sheets).size, n, "one player per sheet per pass");
      for (const sheet of sheets) seen.add(`${sheet}:${pass}`);
    }
    assert.strictEqual(seen.size, n * n, "every sheet/section pair is drawn exactly once");
  });

  test("the favourite's namer takes 1000 and everyone else 300", () => {
    assert.deepStrictEqual(scoreMonsters([1, 1, 2], [0, 1, 2], 3), [300, 1000, 300]);
    assert.deepStrictEqual(scoreMonsters([null, null, null], [0, 1, 2], 3), [300, 300, 300]);
  });

  test("scripted game: three passes, naming, voting", async () => {
    const plugin = (await import("../games/mashup/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;

    for (let pass = 0; pass < 3; pass++) {
      for (const p of players) {
        plugin.onInput(inst, p.id, { stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111" } });
        plugin.onInput(inst, p.id, { action: "action" });
      }
      if (pass < 2) assert.strictEqual(s.pass, pass + 1);
    }
    assert.strictEqual(s.phase, "naming", "three passes move to naming");
    assert.strictEqual(s.sheets.length, 3);
    for (const sheet of s.sheets) {
      assert.ok(sheet.every((section: unknown) => section !== null), "every section drawn");
    }

    for (let i = 0; i < 3; i++) plugin.onInput(inst, players[i].id, { text: `Monster ${i}` });
    assert.strictEqual(s.phase, "vote");

    plugin.onInput(inst, "p0", { choice: "s:0" });
    assert.strictEqual(s.votes[0], null, "cannot vote your own monster");
    plugin.onInput(inst, "p0", { choice: "s:1" });
    plugin.onInput(inst, "p1", { choice: "s:2" });
    plugin.onInput(inst, "p2", { choice: "s:1" });

    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.reveal.winner, 1, "sheet 1 had two votes");
    assert.strictEqual(s.scores[1], 1000, "the favourite's namer wins 1000");
    assert.strictEqual(s.scores[0], 300);
    assert.strictEqual(s.scores[2], 300);
  });
});
