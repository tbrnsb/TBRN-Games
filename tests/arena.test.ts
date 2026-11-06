/**
 * Slingshot Arena: impulse maths, bounds, the 2-4 range, standalone best of
 * three, the one-match Rumble, round-win standings, and the TV hooks.
 *
 * The game has no random source, so these tests drive the real plugin through
 * its input/tick surface and only pin positions where a round needs an exact
 * nearest-to-centre result.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import arena, { impulseFor, outOfBounds } from "../games/arena/server.ts";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE } from "../shared/scoring.ts";
import { SEATS } from "../shared/seat-identity.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
    seat: SEATS[i],
  }));

const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "arena", gameState: null, createdAt: 0, status: "playing" as const,
});

interface TestPuck { x: number; y: number; vx: number; vy: number; alive: boolean }

interface TestState {
  mode: "standalone" | "rumble";
  round: number;
  rounds: number;
  phase: "aiming" | "moving" | "reveal" | "finished";
  pucks: TestPuck[];
  hazards: Array<{ x: number; y: number; r: number }>;
  turn: number;
  aimX: number;
  aimY: number;
  power: number;
  timerMs: number;
  revealMs: number;
  simMs: number;
  scores: number[];
  nearest: number[];
  roundWinner: number | null;
}

interface TestScreen {
  phase: TestState["phase"];
  mode: TestState["mode"];
  round: number;
  rounds: number;
  pucks: Array<{ name: string; seat: { color: string; emoji: string }; alive: boolean; isTurn: boolean }>;
  roundWinner: string | null;
  players: Array<{ name: string; score: number; seat: { color: string; emoji: string }; alive: boolean }>;
  scores: Array<{ name: string; score: number; seat: { color: string; emoji: string } }>;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  finished: boolean;
  winner: string | null;
}

function start(count: number, mode: "standalone" | "rumble" = "standalone") {
  const players = mk(count);
  const instance = arena.onStart(room(players), players, mode === "rumble" ? { mode } : undefined);
  return { players, instance, state: instance.state as unknown as TestState };
}

/** One full best-of-three (or one-match Rumble) through the real input surface. */
function playToEnd(count: number, mode: "standalone" | "rumble" = "standalone") {
  const { players, instance, state } = start(count, mode);
  let guard = 0;
  let maxRoundGain = 0;
  let previous = [...state.scores];

  while (state.phase !== "finished" && guard++ < 20_000) {
    if (state.phase === "aiming") {
      const shooter = players[state.turn];
      arena.onInput(instance, shooter.id, { pad: { x: 0, y: 1 } });
      arena.onInput(instance, shooter.id, { slider: { axis: "y", value: 1 } });
      arena.onInput(instance, shooter.id, { action: "action" });
    }
    arena.onTick(instance, 100);

    if (state.phase === "reveal") {
      const gain = state.scores.map((score, index) => score - previous[index]);
      maxRoundGain = Math.max(maxRoundGain, ...gain);
      previous = [...state.scores];
    }
  }

  return { players, instance, state, maxRoundGain };
}

/** Set the live puck positions, then let the clock end the round. */
function placePucks(instance: ReturnType<typeof arena.onStart>, positions: Array<[number, number, number]>): void {
  const state = instance.state as unknown as TestState;
  for (const [index, x, y] of positions) {
    const puck = state.pucks[index];
    assert.ok(puck, `seat ${index} has a puck`);
    puck.x = x;
    puck.y = y;
    puck.vx = 0;
    puck.vy = 0;
    puck.alive = true;
  }
}

function endRoundByClock(instance: ReturnType<typeof arena.onStart>): void {
  const state = instance.state as unknown as TestState;
  state.timerMs = 1;
  arena.onTick(instance, 10);
  assert.strictEqual(state.phase, "reveal", "the clock must end the round");
}

function leaveReveal(instance: ReturnType<typeof arena.onStart>): void {
  arena.onTick(instance, 2000);
}

describe("slingshot arena fundamentals", () => {
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

  test("a full match reaches a result", () => {
    const { state } = playToEnd(2);

    assert.strictEqual(state.phase, "finished", "the match must end");
    assert.strictEqual(state.scores.reduce((a, b) => a + b, 0), 3, "every round awards exactly one win");
    assert.strictEqual(state.round, 3, "three rounds played");
  });
});

describe("slingshot arena range", () => {
  test("manifest.json, the plugin and the catalog all stay at 2-4", () => {
    const json = JSON.parse(
      readFileSync(join(process.cwd(), "games", "arena", "manifest.json"), "utf8"),
    ) as { minPlayers: number; maxPlayers: number };

    assert.strictEqual(json.minPlayers, 2);
    assert.strictEqual(json.maxPlayers, 4);
    assert.strictEqual(arena.manifest.minPlayers, 2);
    assert.strictEqual(arena.manifest.maxPlayers, 4);

    const entry = GAME_CATALOG.arena;
    assert.strictEqual(entry.minPlayers, 2);
    assert.strictEqual(entry.maxPlayers, 4);
    assert.strictEqual(entry.idealMin, 2);
    assert.strictEqual(entry.idealMax, 4);
  });

  test("catalog scale is 3 standalone / 1 rumble on the 60-second round clock", () => {
    for (const count of [2, 3, 4]) {
      for (const mode of ["standalone", "rumble"] as const) {
        const scale = GAME_CATALOG.arena.scale(count, mode);
        assert.strictEqual(scale.rounds, mode === "rumble" ? 1 : 3, `${count}/${mode}: rounds`);
        assert.deepStrictEqual(scale.timers, { round: 60, shot: 20 }, `${count}/${mode}: timers`);
      }
    }
  });
});

describe("slingshot arena modes", () => {
  for (const count of [2, 3, 4]) {
    test(`${count} players keep the standalone best of three and round-win scoring`, () => {
      const { instance, state, maxRoundGain } = playToEnd(count);

      assert.strictEqual(state.mode, "standalone");
      assert.strictEqual(state.rounds, 3);
      assert.strictEqual(state.phase, "finished", `${count}: the match must end`);
      assert.strictEqual(state.round, 3, `${count}: three rounds played`);
      assert.strictEqual(state.scores.length, count, `${count}: one score per seat`);
      assert.strictEqual(
        state.scores.reduce((a, b) => a + b, 0),
        3,
        `${count}: only round wins score, one award per round`,
      );
      for (const score of state.scores) {
        assert.ok(Number.isInteger(score) && score >= 0 && score <= 3, `${count}: score is a round-win count`);
      }
      assert.ok(maxRoundGain >= 0 && maxRoundGain <= MAX_ROUND_SCORE, `${count}: round gain ${maxRoundGain}`);

      const result = arena.results?.(instance);
      assert.ok(result, "arena publishes explicit results");
      assert.strictEqual(result.standings.length, count);
      assert.deepStrictEqual(
        [...result.standings].map((row) => row.raw).sort((a, b) => b - a),
        [...state.scores].sort((a, b) => b - a),
        `${count}: raw is the round-win count`,
      );
      assert.ok(result.standings.every((row) => row.raw <= MAX_ROUND_SCORE));
    });
  }

  test("rumble is one match, and the 60-second clock ends it", () => {
    const { players, instance, state } = start(4, "rumble");

    assert.strictEqual(state.mode, "rumble");
    assert.strictEqual(state.rounds, 1, "one match in the Rumble");

    // No shots: run the round clock out in one-second beats.
    for (let beat = 0; beat < 60; beat++) arena.onTick(instance, 1000);

    assert.strictEqual(state.phase, "reveal", "the clock ends the single round");
    assert.strictEqual(state.round, 1);
    assert.strictEqual(state.roundWinner, 0, "an untouched field resolves to the first seat");
    assert.strictEqual(state.scores.reduce((a, b) => a + b, 0), 1, "one round win awarded");

    const reveal = arena.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(reveal.round, 1, "the reveal shows the round just played");
    assert.strictEqual(reveal.rounds, 1);
    assert.deepStrictEqual(reveal.waitingOn, [], "nobody is waiting during the reveal");
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption?.includes(players[0].name), "the reveal names the round winner");

    leaveReveal(instance);
    assert.strictEqual(state.phase, "finished", "one match ends the Rumble game");
    assert.strictEqual(state.round, 1);

    const screen = arena.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(screen.finished, true);
    assert.strictEqual(screen.round, 1);
    assert.strictEqual(screen.rounds, 1);
    assert.strictEqual(screen.winner, players[0].name);
    assert.strictEqual(screen.sound, "reveal");
    assert.ok(screen.caption?.includes(players[0].name), "the match caption names the winner");

    const controller = arena.controllerState(instance, players[1].id) as { round: number; rounds: number; finished: boolean };
    assert.strictEqual(controller.round, 1);
    assert.strictEqual(controller.rounds, 1);
    assert.strictEqual(controller.finished, true);
  });

  test("the 60-second clock ends a standalone round and starts the next", () => {
    const { players, instance, state } = start(2);

    for (let beat = 0; beat < 60; beat++) arena.onTick(instance, 1000);
    assert.strictEqual(state.phase, "reveal", "the clock ends round 1");
    assert.strictEqual(state.round, 1);
    assert.strictEqual(state.scores.reduce((a, b) => a + b, 0), 1);

    leaveReveal(instance);
    assert.strictEqual(state.phase, "aiming", "standalone starts round 2");
    assert.strictEqual(state.round, 1);
    assert.strictEqual(state.timerMs, 60_000, "the next round gets the full clock");
    assert.strictEqual(state.roundWinner, null);

    const screen = arena.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(screen.round, 2);
    assert.strictEqual(screen.rounds, 3);
    assert.deepStrictEqual(screen.waitingOn, [players[0].name]);
  });
});

describe("slingshot arena standings and stats", () => {
  test("standings order by round wins and stats expose roundWins and nearestMiss", () => {
    const { players, instance, state } = start(3);

    // Round 1: seat 0 is closest to the centre.
    placePucks(instance, [[0, 0, 0], [1, 0.5, 0], [2, -0.5, 0]]);
    endRoundByClock(instance);
    assert.strictEqual(state.roundWinner, 0);
    leaveReveal(instance);

    // Round 2: seat 1 barely misses, seat 0 sits further out.
    placePucks(instance, [[0, 0.5, 0], [1, 0.01, 0], [2, -0.5, 0]]);
    endRoundByClock(instance);
    assert.strictEqual(state.roundWinner, 1);
    leaveReveal(instance);

    // Round 3: seat 0 takes the match.
    placePucks(instance, [[0, 0.02, 0], [1, 0.4, 0], [2, -0.4, 0]]);
    endRoundByClock(instance);
    assert.strictEqual(state.roundWinner, 0);
    leaveReveal(instance);

    assert.strictEqual(state.phase, "finished");
    assert.deepStrictEqual(state.scores, [2, 1, 0]);

    const result = arena.results?.(instance);
    assert.ok(result, "arena publishes explicit results");
    assert.deepStrictEqual(result.standings.map((row) => row.playerId), players.map((p) => p.id));
    assert.deepStrictEqual(result.standings.map((row) => row.rank), [1, 2, 3]);
    assert.deepStrictEqual(result.standings.map((row) => row.raw), [2, 1, 0]);

    assert.strictEqual(result.stats[`${players[0].id}:roundWins`], 2);
    assert.strictEqual(result.stats[`${players[1].id}:roundWins`], 1);
    assert.strictEqual(result.stats[`${players[2].id}:roundWins`], 0);

    assert.strictEqual(result.stats[`${players[0].id}:nearestMiss`], 0);
    assert.ok(Math.abs(result.stats[`${players[1].id}:nearestMiss`] - 0.01) < 1e-9);
    assert.ok(Math.abs(result.stats[`${players[2].id}:nearestMiss`] - 0.4) < 1e-9);
  });

  test("a tied match shares first place in the standings", () => {
    const { players, instance, state } = start(2);

    // Seat 0 takes round 1, seat 1 takes round 2.
    placePucks(instance, [[0, 0, 0], [1, 0.5, 0]]);
    endRoundByClock(instance);
    leaveReveal(instance);
    placePucks(instance, [[0, 0.5, 0], [1, 0, 0]]);
    endRoundByClock(instance);
    leaveReveal(instance);
    assert.deepStrictEqual(state.scores, [1, 1]);

    // Round 3 ends with the whole field out: nobody scores, so the match ties.
    for (const puck of state.pucks) puck.alive = false;
    endRoundByClock(instance);
    assert.strictEqual(state.roundWinner, null);
    leaveReveal(instance);
    assert.strictEqual(state.phase, "finished");
    assert.deepStrictEqual(state.scores, [1, 1]);

    const result = arena.results?.(instance);
    assert.ok(result, "arena publishes explicit results");
    assert.deepStrictEqual(result.standings.map((row) => row.playerId), players.map((p) => p.id));
    assert.deepStrictEqual(result.standings.map((row) => row.rank), [1, 1]);
    assert.deepStrictEqual(result.standings.map((row) => row.raw), [1, 1]);
  });
});

describe("slingshot arena TV hooks", () => {
  test("aiming waits on the active player, round and match ends reveal", () => {
    const { players, instance, state } = start(3);
    const initial = arena.screenState(instance) as unknown as TestScreen;

    assert.strictEqual(initial.phase, "aiming");
    assert.strictEqual(initial.round, 1);
    assert.strictEqual(initial.rounds, 3);
    assert.deepStrictEqual(initial.waitingOn, [players[0].name], "the TV waits on the seat to shoot");
    assert.strictEqual(initial.caption, null);
    assert.strictEqual(initial.sound, null);

    // Every seat keeps its colour + glyph badge on the puck scoreboard.
    for (let index = 0; index < 3; index++) {
      assert.strictEqual(initial.scores[index].seat.color, SEATS[index].color, `seat ${index}: colour`);
      assert.strictEqual(initial.scores[index].seat.emoji, SEATS[index].emoji, `seat ${index}: glyph`);
      assert.strictEqual(initial.pucks[index].seat.emoji, SEATS[index].emoji, `puck ${index}: glyph`);
      assert.strictEqual(initial.players[index].seat.color, SEATS[index].color, `row ${index}: colour`);
    }

    // End one round and stay on the reveal beat.
    placePucks(instance, [[0, 0, 0], [1, 0.5, 0], [2, -0.5, 0]]);
    endRoundByClock(instance);
    const reveal = arena.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(reveal.phase, "reveal");
    assert.strictEqual(reveal.round, 1, "the reveal shows the finished round");
    assert.strictEqual(reveal.roundWinner, players[0].name);
    assert.deepStrictEqual(reveal.waitingOn, [], "nothing is active during a reveal");
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption?.includes(players[0].name), "the round caption names the winner");

    // The next round clears the reveal hooks and waits on seat 0 again.
    leaveReveal(instance);
    const next = arena.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(next.phase, "aiming");
    assert.strictEqual(next.round, 2);
    assert.deepStrictEqual(next.waitingOn, [players[0].name]);
    assert.strictEqual(next.caption, null);
    assert.strictEqual(next.sound, null);

    // Play the rest out through the real clock so the match-end hooks show.
    while (state.phase !== "finished") arena.onTick(instance, 1000);
    const finished = arena.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(finished.finished, true);
    assert.strictEqual(finished.round, 3);
    assert.strictEqual(finished.sound, "reveal");
    assert.strictEqual(typeof finished.winner, "string");
    assert.ok(finished.caption?.includes(finished.winner ?? ""), "the match caption names the winner");
    assert.deepStrictEqual(finished.waitingOn, []);
  });
});
