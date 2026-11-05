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

  test("darts: the slider aim decides the throw, not random chance", async () => {
    const plugin = (await import("../games/darts/server.ts")).default;
    const players = mk(1);
    const inst = plugin.onStart(room("darts", players), players);
    const s = inst.state as any;

    // Dead centre is the bull.
    plugin.onInput(inst, "p0", { slider: { axis: "x", value: 0.5 } });
    plugin.onInput(inst, "p0", { slider: { axis: "y", value: 0.5 } });
    plugin.onInput(inst, "p0", { action: "action" });

    assert.strictEqual(s.throws.length, 1, "the throw must be recorded");
    assert.strictEqual(s.throws[0].score, 50, "centre aim scores the bull");
    assert.strictEqual(s.scores[0], 451, "501 minus 50");

    // Aim at the far edge: outside the board, no score.
    plugin.onInput(inst, "p0", { slider: { axis: "x", value: 1 } });
    plugin.onInput(inst, "p0", { slider: { axis: "y", value: 1 } });
    plugin.onInput(inst, "p0", { action: "action" });
    assert.strictEqual(s.throws[1].score, 0, "aiming off the board scores nothing");

    // Slider input alone must never throw.
    plugin.onInput(inst, "p0", { slider: { axis: "x", value: 0.2 } });
    assert.strictEqual(s.throws.length, 2, "moving a slider is not a throw");
  });

  test("guess who: fixed opponent, and flips are the player's own", async () => {
    const plugin = (await import("../games/guesswho/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room("guesswho", players), players);
    const s = inst.state as any;

    assert.deepStrictEqual(s.opponents, [1, 2, 0], "each seat keeps one opponent");

    // p0 flips character 3 and 7 down.
    plugin.onInput(inst, "p0", { board: { id: "3", action: "flip" } });
    plugin.onInput(inst, "p0", { board: { id: "7", action: "flip" } });
    const cs0 = plugin.controllerState(inst, "p0") as any;
    assert.strictEqual(cs0.board.tiles[3].marked, true);
    assert.strictEqual(cs0.board.tiles[7].marked, true);
    assert.strictEqual(cs0.remaining, 22, "two faces down");

    // Flipping again is a toggle, not a one-way door.
    plugin.onInput(inst, "p0", { board: { id: "3", action: "flip" } });
    assert.strictEqual((plugin.controllerState(inst, "p0") as any).board.tiles[3].marked, false);

    // p1's board is untouched by p0's flips.
    const cs1 = plugin.controllerState(inst, "p1") as any;
    assert.strictEqual(cs1.board.tiles[7].marked, false, "boards are private");

    // Asking a question moves the turn but never the opponent.
    const q = s.questions[0];
    plugin.onInput(inst, "p0", { choice: q.id });
    assert.deepStrictEqual(s.opponents, [1, 2, 0], "opponents never rotate");
    assert.notStrictEqual(s.currentPlayer, 0, "turn passed on");
  });

  test("racing: taps drive the racer and the first to the line wins", async () => {
    const plugin = (await import("../games/racing/server.ts")).default;
    const players = mk(2);
    const inst = plugin.onStart(room("racing", players), players);
    const s = inst.state as any;

    // Countdown first.
    plugin.onTick(inst, 3500);
    assert.strictEqual(s.phase, "racing", "countdown must end");

    const before = s.racers[0].distance;
    plugin.onInput(inst, "p0", { tap: true });
    plugin.onTick(inst, 100);
    assert.ok(s.racers[0].distance > before, "a tap moves the racer");

    // 400 taps for p0, none for p1.
    for (let i = 0; i < 400 && s.phase !== "finished"; i++) {
      plugin.onInput(inst, "p0", { tap: true });
      plugin.onTick(inst, 100);
    }
    assert.strictEqual(s.phase, "finished", "the race must end");
    assert.strictEqual(s.winnerIndex, 0, "the masher wins");
    assert.strictEqual(s.racers[1].distance, 0, "the idle racer never moved");
  });
});
