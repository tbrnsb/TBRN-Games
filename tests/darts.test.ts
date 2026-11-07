/**
 * Darts: the two-stage timing lock that replaced the free-drag sliders.
 *
 * The server owns both markers, so every test drives the real plugin through
 * `onTick` / `onInput` only: half a sweep (600 ms) parks a marker dead centre,
 * which lets the ring maths be pinned exactly.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import darts, { AIM_SWEEP_MS, DARTBOARD_RADIUS } from "../games/darts/server.ts";
import { createDualSliderLayout } from "../shared/controllers.ts";

const mk = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `P${index + 1}`,
    joinedAt: 0,
    rejoinToken: `t${index}`,
    connected: true,
  }));

const room = (players: ReturnType<typeof mk>) => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: players[0]?.id ?? null,
  players,
  gameId: "darts",
  gameState: null,
  createdAt: 0,
  status: "playing" as const,
});

interface TestThrow {
  playerIndex: number;
  x: number;
  y: number;
  score: number;
  timestamp: number;
}

interface TestState {
  currentPlayer: number;
  turn: number;
  scores: number[];
  throws: TestThrow[];
  finished: boolean;
  winner: number | null;
  phase: "aimX" | "aimY";
  markerX: number;
  markerY: number;
  dirX: 1 | -1;
  dirY: 1 | -1;
  lockedX: number | null;
  lockedY: number | null;
  round: number;
  maxRounds: number;
}

interface TestInstance {
  roomId: string;
  players: ReturnType<typeof mk>;
  state: TestState;
}

function start(count = 2, options?: Record<string, unknown>): TestInstance {
  const players = mk(count);
  return darts.onStart(room(players), players, options) as unknown as TestInstance;
}

const tick = (inst: TestInstance, ms: number): void => {
  (darts.onTick as unknown as (i: TestInstance, d: number) => void)(inst, ms);
};
const send = (inst: TestInstance, playerId: string, input: unknown): void => {
  (darts.onInput as unknown as (i: TestInstance, p: string, v: unknown) => void)(inst, playerId, input);
};
const lockAxis = (inst: TestInstance, playerId: string): void => send(inst, playerId, { action: "action" });

/** Half a sweep in ms: a marker starting at 0 lands exactly on 0.5. */
const HALF_SWEEP = AIM_SWEEP_MS / 2;

/** Marker 0..1 that maps to board X `units` from the centre (right side). */
const markerForBoard = (units: number): number => 0.5 + units / (DARTBOARD_RADIUS * 2);

/** One full dart: sweep X to `xMarker`, lock it, sweep Y, lock it (throws). */
function throwAt(inst: TestInstance, playerId: string, xMarker: number, yMarker: number): void {
  tick(inst, xMarker * AIM_SWEEP_MS);
  lockAxis(inst, playerId);
  tick(inst, yMarker * AIM_SWEEP_MS);
  lockAxis(inst, playerId);
}

function close(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

describe("darts: marker sweep", () => {
  test("constant speed across fixed 500 ms ticks, bouncing at both edges", () => {
    const inst = start(2);
    const s = inst.state;
    const step = 500 / AIM_SWEEP_MS; // 0.4166…

    tick(inst, 500);
    close(s.markerX, step, "first tick");
    close(s.markerY, 0, "inactive axis stays put");
    close(s.dirX, 1, "still heading right");

    tick(inst, 500);
    close(s.markerX, step * 2, "second tick");

    tick(inst, 500);
    // 1.25 overshoots the right edge and reflects to 0.75.
    close(s.markerX, 2 - step * 3, "bounced off 1");
    assert.strictEqual(s.dirX, -1);

    tick(inst, 500);
    close(s.markerX, 2 - step * 4, "heading left");

    tick(inst, 500);
    // 0.3333 - 0.4167 crosses 0 and reflects to 0.0833.
    close(s.markerX, step * 5 - 2, "bounced off 0");
    assert.strictEqual(s.dirX, 1);

    // Lock X, then prove Y sweeps independently and bounces while X is fixed.
    const frozenX = s.markerX;
    lockAxis(inst, "p0");
    assert.strictEqual(s.phase, "aimY");
    close(s.lockedX ?? -1, frozenX, "locked X");

    tick(inst, 500);
    close(s.markerX, frozenX, "locked axis never moves");
    close(s.markerY, step, "Y begins at 0");
    tick(inst, 500);
    close(s.markerY, step * 2, "Y second tick");
    tick(inst, 500);
    close(s.markerY, 2 - step * 3, "Y bounced off 1");
    assert.strictEqual(s.dirY, -1);
  });

  test("delta is clamped to 0..2000 ms", () => {
    const inst = start(2);
    const s = inst.state;

    tick(inst, -500);
    close(s.markerX, 0, "negative delta ignored");
    tick(inst, Number.NaN);
    close(s.markerX, 0, "non-finite delta ignored");

    tick(inst, 5000);
    // 2000 ms is one and two-thirds of a sweep: 1.6667 reflects to 0.3333.
    close(s.markerX, 2 - 2000 / AIM_SWEEP_MS, "3000 ms clamped to 2000");
    assert.strictEqual(s.dirX, -1);
  });

  test("max-size ticks stay inside 0..1 from every start and reflect repeatedly", () => {
    const inRange = (value: number): boolean => value >= 0 && value <= 1;

    for (const startAt of [0, 0.05, 0.5, 0.9, 0.99]) {
      const inst = start(2);
      const s = inst.state;
      tick(inst, startAt * AIM_SWEEP_MS);

      // 0.9 + 1.667 = 2.567 used to reflect once to -0.567; the marker must
      // now bounce off both walls and stay on the board.
      for (let i = 0; i < 25; i++) {
        tick(inst, 2000);
        assert.ok(inRange(s.markerX), `X left 0..1 from ${startAt} at tick ${i}: ${s.markerX}`);
      }

      // Lock at the landed spot, then sweep Y with the same max delta.
      lockAxis(inst, "p0");
      assert.ok(inRange(s.lockedX ?? Number.NaN), `locked X out of range: ${s.lockedX}`);
      for (let i = 0; i < 25; i++) {
        tick(inst, 2000);
        assert.ok(inRange(s.markerY), `Y left 0..1 from ${startAt} at tick ${i}: ${s.markerY}`);
        assert.strictEqual(s.markerX, s.lockedX, "locked X stays frozen");
      }
      lockAxis(inst, "p0");
      // The server clears both locks as it arms the next dart, so the throw's
      // board coordinate is the observable proof of the Y lock value.
      const dart = s.throws[0];
      const lockedYFromThrow = (dart.y / DARTBOARD_RADIUS + 1) / 2;
      assert.ok(inRange(lockedYFromThrow), `locked Y out of range: ${lockedYFromThrow}`);
      assert.ok(Math.abs(dart.x) <= DARTBOARD_RADIUS, `throw x off the board: ${dart.x}`);
      assert.ok(Math.abs(dart.y) <= DARTBOARD_RADIUS, `throw y off the board: ${dart.y}`);
    }

    // Explicit extremes: lock at 1 after a full sweep, and at 0 immediately.
    const high = start(1);
    tick(high, AIM_SWEEP_MS);
    close(high.state.markerX, 1, "X reaches the far edge");
    lockAxis(high, "p0");
    close(high.state.lockedX ?? -1, 1, "X locks at 1");
    tick(high, AIM_SWEEP_MS);
    close(high.state.markerY, 1, "Y reaches the far edge");
    lockAxis(high, "p0");
    close(high.state.throws[0].y, DARTBOARD_RADIUS, "Y lock at 1 maps to the far edge");
    assert.ok(Math.abs(high.state.throws[0].x) <= DARTBOARD_RADIUS);
    assert.ok(Math.abs(high.state.throws[0].y) <= DARTBOARD_RADIUS);

    const low = start(1);
    lockAxis(low, "p0");
    close(low.state.lockedX ?? -1, 0, "X locks at 0");
    lockAxis(low, "p0");
    close(low.state.throws[0].x, -DARTBOARD_RADIUS, "low X maps to the left edge");
    close(low.state.throws[0].y, -DARTBOARD_RADIUS, "low Y maps to the top edge");
  });
});

describe("darts: two-stage lock", () => {
  test("locking X freezes X and starts Y", () => {
    const inst = start(2);
    const s = inst.state;

    tick(inst, 500);
    const lockedAt = s.markerX;
    lockAxis(inst, "p0");

    assert.strictEqual(s.phase, "aimY");
    assert.strictEqual(s.lockedX, lockedAt);
    assert.strictEqual(s.lockedY, null);
    assert.strictEqual(s.throws.length, 0, "one press never throws");

    tick(inst, 700);
    close(s.markerX, lockedAt, "X stays frozen");
    close(s.markerY, 700 / AIM_SWEEP_MS, "Y is the live axis");
    assert.strictEqual(s.throws.length, 0);
  });

  test("locking Y throws at the locked coordinates with the expected score", () => {
    const inst = start(1);
    const s = inst.state;

    throwAt(inst, "p0", 0.5, 0.5);
    assert.strictEqual(s.throws.length, 1);
    close(s.throws[0].x, 0, "x");
    close(s.throws[0].y, 0, "y");
    assert.strictEqual(s.throws[0].score, 50, "centre is the bull");
    assert.strictEqual(s.scores[0], 451);

    // A resolved dart arms the next one at 0,0.
    assert.strictEqual(s.phase, "aimX");
    assert.strictEqual(s.lockedX, null);
    assert.strictEqual(s.lockedY, null);
    close(s.markerX, 0, "next dart starts at X 0");
    close(s.markerY, 0, "next dart starts at Y 0");
    assert.strictEqual(s.dirX, 1);
    assert.strictEqual(s.dirY, 1);
  });

  test("ring values: bull, outer bull, single, triple, double, miss", () => {
    const cases = [
      { name: "bull", x: 0.5, y: 0.5, score: 50 },
      { name: "outer bull", x: markerForBoard(10), y: 0.5, score: 25 },
      { name: "single 20", x: markerForBoard(60), y: 0.5, score: 20 },
      { name: "triple 20", x: markerForBoard(103), y: 0.5, score: 60 },
      { name: "double 20", x: markerForBoard(166), y: 0.5, score: 40 },
      { name: "miss", x: 0, y: 0, score: 0 },
    ];

    for (const c of cases) {
      const inst = start(1);
      throwAt(inst, "p0", c.x, c.y);
      const t = inst.state.throws[0];
      assert.ok(t, `${c.name}: throw recorded`);
      assert.strictEqual(t.score, c.score, `${c.name}: score`);
      assert.strictEqual(inst.state.scores[0], 501 - c.score, `${c.name}: remaining`);
    }
  });

  test("three darts rotate the turn and a full cycle advances the round", () => {
    const inst = start(2);
    const s = inst.state;

    for (let i = 0; i < 3; i++) throwAt(inst, "p0", 0.5, 0.5);
    assert.strictEqual(s.throws.length, 3);
    assert.strictEqual(s.currentPlayer, 1, "turn passes after three darts");
    assert.strictEqual(s.turn, 0);
    assert.strictEqual(s.round, 0);

    for (let i = 0; i < 3; i++) throwAt(inst, "p1", 0.5, 0.5);
    assert.strictEqual(s.currentPlayer, 0, "rotation wraps back");
    assert.strictEqual(s.round, 1, "round advances when the table wraps");
    assert.deepStrictEqual(s.scores, [351, 351]);
  });
});

describe("darts: checkout, round cap and options", () => {
  test("exactly zero wins the game", () => {
    const inst = start(1);
    const s = inst.state;
    s.scores[0] = 40;

    throwAt(inst, "p0", markerForBoard(166), 0.5);
    assert.strictEqual(s.throws[0].score, 40, "double 20 checkout");
    assert.strictEqual(s.scores[0], 0);
    assert.strictEqual(s.finished, true);
    assert.strictEqual(s.winner, 0);
  });

  test("the 20-round cap ends the game and keeps the lowest score", () => {
    const inst = start(2);
    const s = inst.state;

    // Nineteen full rounds of misses: scores stay 501, nobody checks out.
    for (let round = 0; round < 19; round++) {
      for (let dart = 0; dart < 6; dart++) {
        const id = inst.players[s.currentPlayer].id;
        lockAxis(inst, id); // X at 0
        lockAxis(inst, id); // Y at 0 -> (-170, -170), a miss
      }
    }
    assert.strictEqual(s.round, 19);
    assert.strictEqual(s.finished, false);

    // Give seat 1 the lower remaining score before the last round decides it.
    s.scores[1] = 450;
    for (let dart = 0; dart < 6; dart++) {
      const id = inst.players[s.currentPlayer].id;
      lockAxis(inst, id);
      lockAxis(inst, id);
    }

    assert.strictEqual(s.finished, true);
    assert.strictEqual(s.round, 20, "cap is 20 rounds by default");
    assert.strictEqual(s.winner, 1, "lowest remaining score wins a cold game");
  });

  test("options.rounds overrides the default cap", () => {
    const custom = start(2, { rounds: 3 });
    assert.strictEqual(custom.state.maxRounds, 3);

    const floored = start(2, { rounds: 2.9 });
    assert.strictEqual(floored.state.maxRounds, 2, "whole rounds only");

    const invalid = start(2, { rounds: 0 });
    assert.strictEqual(invalid.state.maxRounds, 20, "zero falls back to the default");

    const absent = start(2);
    assert.strictEqual(absent.state.maxRounds, 20);
  });
});

describe("darts: authority and screen payloads", () => {
  test("non-current players, slider drags and finished games cannot change the aim", () => {
    const inst = start(2);
    const s = inst.state;

    // Seat 1 has no turn yet.
    lockAxis(inst, "p1");
    assert.strictEqual(s.phase, "aimX");
    assert.strictEqual(s.lockedX, null);
    assert.strictEqual(s.throws.length, 0);

    // The old free-drag input shape is ignored completely.
    send(inst, "p0", { slider: { axis: "x", value: 0.9 } });
    send(inst, "p0", { slider: { axis: "y", value: 0.1 } });
    assert.strictEqual(s.phase, "aimX");
    assert.strictEqual(s.lockedX, null);
    close(s.markerX, 0, "slider input cannot move the server marker");

    // Finish, then try to keep playing.
    s.scores[0] = 50;
    throwAt(inst, "p0", 0.5, 0.5);
    assert.strictEqual(s.finished, true);
    const throwsAtEnd = s.throws.length;
    const markerAtEnd = s.markerX;

    lockAxis(inst, "p0");
    lockAxis(inst, "p1");
    tick(inst, 500);
    assert.strictEqual(s.throws.length, throwsAtEnd, "no throws after the win");
    close(s.markerX, markerAtEnd, "no sweeping after the win");
  });

  test("screenState exposes phase, markers and locks without leaking extra data", () => {
    const inst = start(2);
    let screen = darts.screenState(inst) as Record<string, unknown>;
    assert.deepStrictEqual(screen.aim, {
      x: 0,
      y: 0.5,
      phase: "aimX",
      lockedX: null,
      lockedY: null,
      active: true,
    });
    assert.strictEqual(screen.finished, false);
    assert.strictEqual(screen.maxRounds, 20);
    assert.strictEqual(screen.gameMode, "501");

    tick(inst, HALF_SWEEP);
    lockAxis(inst, "p0");
    screen = darts.screenState(inst) as Record<string, unknown>;
    const aim = screen.aim as Record<string, unknown>;
    assert.strictEqual(aim.phase, "aimY");
    close(aim.x as number, 0.5, "X shows the locked value");
    close(aim.y as number, 0, "Y shows the live marker");
    close(aim.lockedX as number, 0.5, "lockedX is published");

    tick(inst, HALF_SWEEP);
    lockAxis(inst, "p0");
    screen = darts.screenState(inst) as Record<string, unknown>;
    const after = screen.aim as Record<string, unknown>;
    assert.strictEqual(after.phase, "aimX", "next dart is armed");
    assert.strictEqual(after.lockedX, null, "the next dart has no X lock yet");
    assert.strictEqual(after.lockedY, null, "the next dart has no Y lock yet");
    close(after.x as number, 0, "next dart starts at X 0");
    close(after.y as number, 0.5, "inactive Y defaults to centre");
  });

  test("controllerState drives the read-only dual slider from the server", () => {
    const inst = start(2);
    const current = darts.controllerState(inst, "p0") as Record<string, unknown>;
    const sliders = current.sliders as Record<string, unknown>;
    const x = sliders.x as Record<string, unknown>;
    const y = sliders.y as Record<string, unknown>;

    assert.strictEqual(sliders.readOnly, true);
    assert.strictEqual(sliders.disabled, false);
    assert.strictEqual(sliders.actionLabel, "LOCK HORIZONTAL");
    assert.strictEqual(x.label, "HORIZONTAL");
    assert.strictEqual(y.label, "VERTICAL");
    assert.strictEqual(x.locked, false);
    assert.strictEqual(y.locked, false);
    assert.strictEqual(current.yourTurn, true);
    assert.strictEqual(current.currentPlayer, "P1");

    tick(inst, HALF_SWEEP);
    lockAxis(inst, "p0");
    const locked = darts.controllerState(inst, "p0") as Record<string, unknown>;
    const lockedSliders = locked.sliders as Record<string, unknown>;
    assert.strictEqual((lockedSliders.x as Record<string, unknown>).locked, true);
    assert.strictEqual((lockedSliders.y as Record<string, unknown>).locked, false);
    assert.strictEqual(lockedSliders.actionLabel, "LOCK VERTICAL");

    const waiting = darts.controllerState(inst, "p1") as Record<string, unknown>;
    assert.strictEqual((waiting.sliders as Record<string, unknown>).disabled, true);
    assert.strictEqual(waiting.yourTurn, false);

    // Differential check: P1's payload never carries P0's score.
    assert.strictEqual(waiting.yourScore, 501);
    assert.strictEqual(current.yourScore, 501);
  });

  test("the read-only dual layout draws the server markers and never a drag target", () => {
    const inst = start(1);
    tick(inst, HALF_SWEEP);
    lockAxis(inst, "p0");

    const layout = createDualSliderLayout();
    let html = "";
    const fakeContainer = (): HTMLElement => ({
      get innerHTML() { return html; },
      set innerHTML(value: string) { html = value; },
      querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
      querySelector: () => null,
    }) as unknown as HTMLElement;

    const inputs: unknown[] = [];
    layout.render(fakeContainer(), darts.controllerState(inst, "p0"), (input) => { inputs.push(input); });

    assert.ok(html.includes("is-readonly"), "the track is marked read-only");
    assert.ok(html.includes("axis-x locked"), "the locked X axis carries its class");
    assert.ok(!html.includes("axis-y locked"), "Y is not locked yet");
    assert.ok(html.includes("LOCK VERTICAL"), "the button asks for the second lock");
    assert.ok(!html.includes(" disabled"), "the action button stays enabled on your turn");

    // The update path repaints from state; with no DOM nodes it must not throw.
    assert.doesNotThrow(() => layout.update(fakeContainer(), darts.controllerState(inst, "p0")));
    assert.strictEqual(inputs.length, 0, "rendering never sends input by itself");
  });

  test("same tick and action sequence gives identical throws and scores", () => {
    const run = (): { throws: TestThrow[]; scores: number[] } => {
      const inst = start(2);
      const s = inst.state;
      for (let i = 0; i < 30; i++) {
        const id = inst.players[s.currentPlayer].id;
        tick(inst, 500);
        lockAxis(inst, id);
      }
      return { throws: s.throws, scores: s.scores };
    };
    assert.deepStrictEqual(run(), run());
  });

  test("a bot pressing action every tick finishes within a sane budget", () => {
    const inst = start(2);
    const s = inst.state;
    let ticks = 0;
    for (; ticks < 1000 && !s.finished; ticks++) {
      for (const p of inst.players) send(inst, p.id, { action: "action" });
      tick(inst, 500);
    }

    assert.strictEqual(s.finished, true, "bot loop reaches a terminal state");
    assert.ok(s.throws.length > 0, "the bot actually threw darts");
    assert.ok(ticks < 500, `expected a finish inside 500 ticks, took ${ticks}`);
    assert.notStrictEqual(s.winner, null);
  });
});
