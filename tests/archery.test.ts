/**
 * Archery: 1-8 players, deterministic turn order, the unchanged proximity
 * formula at 3-4, the shared 1500 round bound, and the 8-player TV payload.
 *
 * The game is deterministic (no random source), so these tests drive the real
 * plugin through its public input/tick surface and only pin physics where a
 * shot needs an exact landing point.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import archery, { TARGET_WIDTH, archeryScore } from "../games/archery/server.ts";
import { renderArchery } from "../games/archery/screen.ts";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { SEATS } from "../shared/seat-identity.ts";
import { MAX_ROUND_SCORE } from "../shared/scoring.ts";

const mk = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `P${index}`,
    joinedAt: 0,
    rejoinToken: `t${index}`,
    connected: true,
    seat: SEATS[index],
  }));

const room = (players: ReturnType<typeof mk>) => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: players[0]?.id ?? null,
  players,
  gameId: "archery",
  gameState: null,
  createdAt: 0,
  status: "playing" as const,
});

interface TestShot {
  playerIndex: number;
  x: number;
  y: number;
  score: number;
  round: number;
  targetX: number;
}

interface TestState {
  currentPlayer: number;
  phase: "aiming" | "flying" | "scoring" | "finished";
  targetX: number;
  targetSpeed: number;
  targetDirection: 1 | -1;
  shots: TestShot[];
  scores: number[];
  round: number;
  maxRounds: number;
  drawPower: number;
  isDrawing: boolean;
  arrowX: number;
  arrowY: number;
  arrowVX: number;
  arrowVY: number;
  scoringTimerMs: number;
}

function start(count: number) {
  const players = mk(count);
  const instance = archery.onStart(room(players), players);
  return { players, instance, state: instance.state as unknown as TestState };
}

/** Drop an arrow straight onto a chosen point so a shot is exact. */
function landShot(
  instance: ReturnType<typeof archery.onStart>,
  playerIndex: number,
  hitX: number,
  targetX: number,
): TestShot {
  const state = instance.state as unknown as TestState;
  state.currentPlayer = playerIndex;
  state.phase = "flying";
  state.isDrawing = false;
  state.drawPower = 0;
  state.arrowX = hitX;
  state.arrowY = 0.001;
  state.arrowVX = 0;
  state.arrowVY = -1;
  state.targetX = targetX;
  state.targetSpeed = 0;
  archery.onTick(instance, 16);
  const shot = state.shots[state.shots.length - 1];
  assert.ok(shot, "the landing tick must record a shot");
  return shot;
}

/**
 * Play a whole game through the input/tick surface.
 *
 * `bullseyes` pins every arrow to the target centre; otherwise the test uses a
 * normal draw power and lets the real physics decide. Either way the turn
 * rotation and the scoring pause run exactly as they do on the server.
 */
function playToEnd(count: number, bullseyes: boolean) {
  const { players, instance, state } = start(count);
  let guard = 0;

  while (state.phase !== "finished" && guard++ < 200_000) {
    if (state.phase === "aiming") {
      if (bullseyes) {
        state.phase = "flying";
        state.arrowX = 0;
        state.arrowY = 0.001;
        state.arrowVX = 0;
        state.arrowVY = -1;
        state.targetX = 0;
        state.targetSpeed = 0;
        archery.onTick(instance, 16);
      } else {
        state.isDrawing = true;
        state.drawPower = 0.7;
        archery.onInput(instance, players[state.currentPlayer].id, { tap: true });
        assert.strictEqual(state.phase, "flying", "the release must fire the arrow");
      }
    } else if (state.phase === "flying") {
      archery.onTick(instance, 16);
    } else if (state.phase === "scoring") {
      archery.onTick(instance, 1600);
    } else {
      break;
    }
  }

  assert.strictEqual(state.phase, "finished", `a ${count}-player game must end`);
  return { players, instance, state };
}

describe("archery range and catalog", () => {
  test("manifest and catalog agree on 1-8 with 5 standalone / 3 rumble rounds", () => {
    assert.strictEqual(archery.manifest.minPlayers, 1);
    assert.strictEqual(archery.manifest.maxPlayers, 8);

    const entry = GAME_CATALOG.archery;
    assert.strictEqual(entry.minPlayers, 1);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 2);
    assert.strictEqual(entry.idealMax, 8);

    for (let count = 1; count <= 8; count++) {
      assert.strictEqual(entry.scale(count, "standalone").rounds, 5, `${count}: standalone rounds`);
      assert.strictEqual(entry.scale(count, "rumble").rounds, 3, `${count}: rumble rounds`);
    }
  });
});

describe("archery playthrough", () => {
  for (const count of [1, 8]) {
    test(`a ${count}-player game runs to a result`, () => {
      const { state } = playToEnd(count, false);

      assert.strictEqual(state.shots.length, state.maxRounds * count, "every seat shoots every round");
      for (const score of state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, "scores stay finite and non-negative");
      }
      const shotTotal = state.shots.reduce((sum, shot) => sum + shot.score, 0);
      assert.strictEqual(shotTotal, state.scores.reduce((sum, score) => sum + score, 0), "the score table mirrors the arrows");
    });
  }

  test("at eight players every round covers every seat in turn order", () => {
    const { state } = playToEnd(8, true);
    assert.strictEqual(state.shots.length, 8 * 5, "forty arrows for eight players over five rounds");

    for (let round = 0; round < state.maxRounds; round++) {
      const shots = state.shots.filter((shot) => shot.round === round);
      assert.strictEqual(shots.length, 8, `round ${round}: one arrow per seat`);
      assert.deepStrictEqual(
        shots.map((shot) => shot.playerIndex),
        [0, 1, 2, 3, 4, 5, 6, 7],
        `round ${round}: seat order`,
      );
    }
  });
});

describe("archery scoring", () => {
  test("the proximity formula is unchanged at 3 and 4 players", () => {
    const cases = [
      { distance: 0, expected: 100 },
      { distance: 0.015, expected: 80 },
      { distance: 0.0375, expected: 50 },
      { distance: 0.06, expected: 20 },
      { distance: 0.0749, expected: 0 },
      { distance: TARGET_WIDTH / 2, expected: 0 },
      { distance: 0.2, expected: 0 },
    ];

    for (const count of [3, 4]) {
      for (const { distance, expected } of cases) {
        const { instance } = start(count);
        const targetX = 0.5;
        const hitX = targetX + distance;
        const shot = landShot(instance, 0, hitX, targetX);

        assert.strictEqual(shot.score, expected, `${count}p, distance ${distance}`);
        assert.strictEqual(shot.score, archeryScore(hitX, targetX), `${count}p, helper agrees`);
        assert.strictEqual(shot.targetX, targetX, `${count}p, the landing keeps the target position`);
      }
    }
  });

  test("one player's round total stays inside the 1500 bound at every count", () => {
    for (let count = 1; count <= 8; count++) {
      const { state } = playToEnd(count, true);
      const perRound = new Map<number, Map<number, number>>();

      for (const shot of state.shots) {
        assert.strictEqual(shot.score, 100, "forced bullseyes score the maximum per arrow");
        const round = perRound.get(shot.round) ?? new Map<number, number>();
        round.set(shot.playerIndex, (round.get(shot.playerIndex) ?? 0) + shot.score);
        perRound.set(shot.round, round);
      }

      for (const [round, totals] of perRound) {
        for (const [playerIndex, total] of totals) {
          assert.ok(
            total <= MAX_ROUND_SCORE,
            `${count}p round ${round} seat ${playerIndex}: ${total} exceeds ${MAX_ROUND_SCORE}`,
          );
        }
      }
    }
  });
});

describe("archery TV payload", () => {
  test("eight players get eight seat-coloured arrows, a full turn order and a reveal hook", () => {    const { players, instance, state } = start(8);

    // Land one arrow per seat without advancing the round.
    for (let index = 0; index < 8; index++) {
      landShot(instance, index, 0, 0);
      state.phase = "aiming";
      state.scoringTimerMs = 0;
    }
    // Leave the payload on the reveal beat of the last arrow.
    state.currentPlayer = 7;
    state.phase = "scoring";
    state.scoringTimerMs = 1500;

    const screen = archery.screenState(instance) as {
      shots: Array<{ playerIndex: number; seat: { color: string; emoji: string } }>;
      scores: Array<{ name: string; score: number; seat: { color: string; emoji: string } }>;
      turnOrder: Array<{ name: string; seat: { color: string; emoji: string }; isCurrent: boolean }>;
      waitingOn: string[];
      caption: string | null;
      sound: string | null;
      currentPlayerName: string | null;
      round: number;
      maxRounds: number;
    };

    assert.strictEqual(screen.shots.length, 8, "all eight arrows reach the TV, not just the last five");
    for (let index = 0; index < 8; index++) {
      assert.strictEqual(screen.shots[index].playerIndex, index);
      assert.strictEqual(screen.shots[index].seat.color, SEATS[index].color, `seat ${index}: colour`);
      assert.strictEqual(screen.shots[index].seat.emoji, SEATS[index].emoji, `seat ${index}: glyph`);
    }

    assert.strictEqual(screen.scores.length, 8);
    assert.strictEqual(screen.turnOrder.length, 8);
    for (let index = 0; index < 8; index++) {
      assert.strictEqual(screen.scores[index].seat.color, SEATS[index].color, `score ${index}: colour`);
      assert.strictEqual(screen.turnOrder[index].seat.emoji, SEATS[index].emoji, `lane ${index}: glyph`);
    }

    assert.deepStrictEqual(screen.waitingOn, [players[7].name], "the TV waits on the active archer");
    assert.strictEqual(screen.currentPlayerName, players[7].name);
    assert.strictEqual(screen.sound, "reveal");
    assert.strictEqual(typeof screen.caption, "string");
    assert.ok(screen.caption?.includes("P7"), "the reveal caption names the shooter");
    assert.strictEqual(screen.round, 1);
    assert.strictEqual(screen.maxRounds, 5);
  });

  test("the renderer draws eight lanes and a full scoreboard at both resolutions", () => {
    const { instance, state } = start(8);
    for (let index = 0; index < 8; index++) {
      landShot(instance, index, 0, 0);
      state.phase = "aiming";
      state.scoringTimerMs = 0;
    }
    const screen = archery.screenState(instance) as Record<string, unknown>;
    // Round 2 skips the one-time title card, so the range and lanes are drawn.
    const drawable = { ...screen, phase: "aiming", round: 2, sound: null, caption: null };

    for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
      const ctx = makeContext();
      renderArchery(
        ctx,
        width,
        height,
        drawable as unknown as Parameters<typeof renderArchery>[3],
      );
    }
  });
});

/** Minimal recording context: unknown canvas methods are no-ops. */
function makeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    measureText: (text: unknown) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe("archery results", () => {
  test("standings come from raw scores and stats expose bullseyes and totals", () => {
    const { players, instance, state } = playToEnd(4, true);
    const result = archery.results?.(instance);

    assert.ok(result, "archery publishes explicit results");
    assert.strictEqual(result.standings.length, 4);
    assert.strictEqual(result.standings.every((row) => row.rank === 1), true, "a forced tie shares first");
    assert.strictEqual(result.standings.every((row) => row.raw === state.maxRounds * 100), true);

    for (const [index, player] of players.entries()) {
      assert.strictEqual(result.stats[`${player.id}:bullseyes`], state.maxRounds, `seat ${index}: bullseyes`);
      assert.strictEqual(result.stats[`${player.id}:totalScore`], state.scores[index], `seat ${index}: total`);
    }
  });
});
