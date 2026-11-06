/**
 * Tap Race: 1-8 players, one race at every count, rank-only results, an
 * eight-lane TV that never overlaps, and the kit's eight-seat palette.
 *
 * The race is deterministic (no random source), so these tests drive the real
 * plugin through its input/tick surface and pin only geometry that the renderer
 * also uses.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import racing from "../games/racing/server.ts";
import { racingLaneLayout, renderRacing } from "../games/racing/screen.ts";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { SEATS } from "../shared/seat-identity.ts";
import { theme } from "../shared/theme.ts";
import { colors as kitColors, getPlayerColor, scaleForViewport } from "../client/screen/kit/theme.ts";

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
  gameId: "racing",
  gameState: null,
  createdAt: 0,
  status: "playing" as const,
});

interface TestRacer {
  lane: number;
  distance: number;
  speed: number;
  taps: number;
  topSpeed: number;
  finished: boolean;
}

interface TestState {
  racers: TestRacer[];
  phase: "countdown" | "racing" | "finished";
  countdownMs: number;
  elapsedMs: number;
  winnerIndex: number | null;
}

interface TestScreen {
  phase: TestState["phase"];
  lanes: number;
  finishDistance: number;
  racers: Array<{
    name: string;
    lane: number;
    progress: number;
    taps: number;
    speed: number;
    topSpeed: number;
    finished: boolean;
    seat: { color: string; emoji: string };
  }>;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  finished: boolean;
  winner: { name: string; progress: number } | null;
}

function start(count: number) {
  const players = mk(count);
  const instance = racing.onStart(room(players), players);
  return { players, instance, state: instance.state as unknown as TestState };
}

/** Leave the 3-second countdown behind and start racing. */
function beginRace(instance: ReturnType<typeof racing.onStart>): void {
  racing.onTick(instance, 3000);
}

/** One 100 ms beat where every listed player taps once. */
function tapBeat(
  instance: ReturnType<typeof racing.onStart>,
  ids: readonly string[],
): void {
  for (const id of ids) racing.onInput(instance, id, { tap: true });
  racing.onTick(instance, 100);
}

/** Read the phase without letting `assert.strictEqual` narrow it away. */
function isFinished(state: TestState): boolean {
  return state.phase === "finished";
}

describe("racing range and catalog", () => {
  test("manifest.json, the plugin and the catalog agree on 1-8", () => {
    const json = JSON.parse(
      readFileSync(join(process.cwd(), "games", "racing", "manifest.json"), "utf8"),
    ) as { minPlayers: number; maxPlayers: number };

    assert.strictEqual(json.minPlayers, 1);
    assert.strictEqual(json.maxPlayers, 8);
    assert.strictEqual(racing.manifest.minPlayers, 1);
    assert.strictEqual(racing.manifest.maxPlayers, 8);

    const entry = GAME_CATALOG.racing;
    assert.strictEqual(entry.minPlayers, 1);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 3);
    assert.strictEqual(entry.idealMax, 8);
  });

  test("one race at every count with the unchanged countdown and buzzer", () => {
    const entry = GAME_CATALOG.racing;
    for (let count = 1; count <= 8; count++) {
      for (const mode of ["standalone", "rumble"] as const) {
        const scale = entry.scale(count, mode);
        assert.strictEqual(scale.rounds, 1, `${count}/${mode}: one race`);
        assert.deepStrictEqual(scale.timers, { countdown: 3, race: 60 }, `${count}/${mode}: timers changed`);
      }
    }
  });
});

describe("racing playthrough", () => {
  test("a one-player race finishes at the line", () => {
    const { players, instance, state } = start(1);
    beginRace(instance);

    const ids = players.map((p) => p.id);
    let guard = 0;
    while (!isFinished(state) && guard++ < 2000) {
      tapBeat(instance, ids);
    }

    assert.strictEqual(state.phase, "finished", "the solo race must end");
    assert.strictEqual(state.winnerIndex, 0);
    assert.strictEqual(state.racers[0].finished, true);
    assert.strictEqual(state.racers[0].distance, 100);
  });

  test("at eight players every lane is raced and all eight can finish together", () => {
    const { players, instance, state } = start(8);
    beginRace(instance);

    let guard = 0;
    const ids = players.map((p) => p.id);
    while (!isFinished(state) && guard++ < 2000) {
      tapBeat(instance, ids);
    }

    assert.strictEqual(state.phase, "finished", "an eight-player race must end");
    assert.strictEqual(state.racers.length, 8, "one racer per seat");
    assert.strictEqual(state.racers.every((racer) => racer.finished), true, "identical taps finish every lane");
    assert.strictEqual(state.racers.every((racer) => racer.distance === 100), true);
    assert.strictEqual(state.winnerIndex, 0, "the first lane across takes the win");
  });

  test("the buzzer ends an idle eight-player race with the furthest lane winning", () => {
    const { instance, state } = start(8);
    beginRace(instance);

    // No taps at all: the 60-second timeout must still produce a result.
    racing.onTick(instance, 60_000);
    assert.strictEqual(state.phase, "finished", "the buzzer ends the race");
    assert.strictEqual(state.winnerIndex, 0, "an all-zero field resolves deterministically");
    assert.ok(state.elapsedMs >= 60_000);
    assert.strictEqual(state.racers.every((racer) => racer.distance === 0), true);
  });

  test("3-4 player progress and the winner behave exactly as before", () => {
    for (const count of [3, 4]) {
      const { players, instance, state } = start(count);
      beginRace(instance);

      // Seat 0 mashes hardest, seat 1 less, the rest idle.
      for (let beat = 0; beat < 30; beat++) {
        const ids = [players[0].id];
        if (beat < 15) ids.push(players[1].id);
        if (beat < 5 && count > 2) ids.push(players[2].id);
        tapBeat(instance, ids);
      }

      assert.strictEqual(state.phase, "racing", `${count}: thirty beats stay under the line`);
      assert.ok(state.racers[0].distance > state.racers[1].distance, `${count}: hardest masher leads`);
      assert.ok(state.racers[1].distance > state.racers[2].distance, `${count}: tap count orders progress`);

      const screen = racing.screenState(instance) as unknown as TestScreen;
      assert.strictEqual(screen.racers.length, count);
      screen.racers.forEach((racer, index) => {
        assert.ok(Math.abs(racer.progress - state.racers[index].distance / screen.finishDistance) < 1e-9);
        assert.strictEqual(racer.lane, index, `${count}: lane ${index} is seat ${index}`);
      });
      assert.strictEqual(screen.winner, null, `${count}: no winner while racing`);
      assert.strictEqual(screen.finished, false);

      // Tap seat 0 to the line; the first across still wins.
      let guard = 0;
      while (!isFinished(state) && guard++ < 2000) {
        tapBeat(instance, [players[0].id]);
      }
      assert.strictEqual(state.phase, "finished", `${count}: the race ends`);
      assert.strictEqual(state.winnerIndex, 0, `${count}: the masher wins`);

      const final = racing.screenState(instance) as unknown as TestScreen;
      assert.strictEqual(final.finished, true);
      assert.strictEqual(final.winner?.name, players[0].name);
      assert.strictEqual(final.racers[0].progress, 1);

      const controller = racing.controllerState(instance, players[0].id) as {
        race: { taps: number; progress: number; opponentName: string; finished: boolean };
        youWon: boolean;
      };
      assert.strictEqual(controller.race.taps, state.racers[0].taps);
      assert.strictEqual(controller.race.progress, 1);
      assert.ok(controller.race.opponentName.length > 0, `${count}: the phone names a rival`);
      assert.strictEqual(controller.race.finished, true);
      assert.strictEqual(controller.youWon, true);
    }
  });
});

describe("racing eight-lane TV payload", () => {
  test("every lane carries its seat identity and the finish hooks", () => {
    const { players, instance, state } = start(8);
    beginRace(instance);
    racing.onTick(instance, 60_000);

    const screen = racing.screenState(instance) as unknown as TestScreen;
    assert.strictEqual(screen.lanes, 8);
    assert.strictEqual(screen.racers.length, 8);
    for (let index = 0; index < 8; index++) {
      assert.strictEqual(screen.racers[index].name, players[index].name);
      assert.strictEqual(screen.racers[index].seat.color, SEATS[index].color, `seat ${index}: colour`);
      assert.strictEqual(screen.racers[index].seat.emoji, SEATS[index].emoji, `seat ${index}: glyph`);
    }

    assert.deepStrictEqual(screen.waitingOn, [], "a simultaneous race waits on nobody");
    assert.strictEqual(screen.sound, "win");
    assert.strictEqual(typeof screen.caption, "string");
    assert.ok(screen.caption?.includes(players[state.winnerIndex ?? 0].name), "the finish caption names the winner");
  });

  test("the renderer draws eight lanes at 1080p and 720p", () => {
    const { instance } = start(8);
    beginRace(instance);
    racing.onTick(instance, 60_000);
    const screen = racing.screenState(instance) as unknown as Record<string, unknown>;
    // The title card owns the first racing frame; race second so the track draws.
    const drawable = { ...screen, phase: "racing", finished: false, winner: null, sound: null, caption: null };

    for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
      const ctx = makeContext();
      renderRacing(ctx, width, height, drawable as unknown as Parameters<typeof renderRacing>[3]);
    }
  });
});

describe("racing lane geometry", () => {
  test("eight lanes tile the track without overlapping at both resolutions", () => {
    for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
      const scale = scaleForViewport(width, height);
      const layout = racingLaneLayout(8, width, height, scale);

      assert.strictEqual(layout.lanes.length, 8, `${width}x${height}: eight lanes`);
      assert.ok(layout.laneWidth >= 96, `${width}x${height}: lanes stay wide enough to read (${layout.laneWidth})`);
      assert.ok(layout.headerHeight > 0);

      for (let index = 0; index < layout.lanes.length; index++) {
        const lane = layout.lanes[index];
        assert.strictEqual(lane.index, index);
        assert.ok(lane.width > 0);
        assert.ok(lane.nameMaxWidth >= 60, `${width}x${height}: lane ${index} name width ${lane.nameMaxWidth}`);
        assert.ok(lane.x >= layout.track.x - 1e-9, `${width}x${height}: lane ${index} starts inside the track`);
        assert.ok(
          lane.x + lane.width <= layout.track.x + layout.track.width + 1e-9,
          `${width}x${height}: lane ${index} ends inside the track`,
        );
        assert.ok(
          Math.abs(lane.centerX - (lane.x + lane.width / 2)) < 1e-9,
          `${width}x${height}: lane ${index} centre`,
        );

        if (index > 0) {
          const previous = layout.lanes[index - 1];
          assert.ok(
            previous.x + previous.width <= lane.x + 1e-9,
            `${width}x${height}: lane ${index - 1} must not overlap lane ${index}`,
          );
        }
      }
    }
  });

  test("lane geometry degrades safely for a single racer", () => {
    const layout = racingLaneLayout(1, 1920, 1080, 1);
    assert.strictEqual(layout.lanes.length, 1);
    assert.strictEqual(layout.lanes[0].width, layout.track.width);
  });
});

describe("racing results", () => {
  test("standings rank by progress and stats expose taps and top speed", () => {
    const { players, instance, state } = start(4);
    beginRace(instance);

    // Distinct efforts: p0 hard, p1 medium, p2 light, p3 idle.
    for (let beat = 0; beat < 30; beat++) {
      const ids = [players[0].id];
      if (beat < 18) ids.push(players[1].id);
      if (beat < 6) ids.push(players[2].id);
      tapBeat(instance, ids);
    }
    while (!isFinished(state)) {
      tapBeat(instance, [players[0].id]);
    }

    const result = racing.results?.(instance);
    assert.ok(result, "racing publishes explicit results");

    assert.deepStrictEqual(
      result.standings.map((row) => row.playerId),
      players.map((player) => player.id),
      "progress order is the standings order",
    );
    assert.deepStrictEqual(result.standings.map((row) => row.rank), [1, 2, 3, 4]);
    for (const row of result.standings) {
      assert.ok(row.raw >= 0 && row.raw <= 1, "raw is the same 0..1 progress the TV shows");
    }

    for (const [index, player] of players.entries()) {
      const racer = state.racers[index];
      assert.strictEqual(result.stats[`${player.id}:taps`], racer.taps, `seat ${index}: taps`);
      assert.strictEqual(result.stats[`${player.id}:topSpeed`], racer.topSpeed, `seat ${index}: top speed`);
      if (racer.taps > 0) {
        assert.ok(racer.topSpeed > 0 && racer.topSpeed <= 16 + 1e-9, `seat ${index}: tracked peak speed`);
      } else {
        assert.strictEqual(racer.topSpeed, 0, `seat ${index}: an idle seat never built speed`);
      }
    }

    const winner = result.standings[0];
    assert.strictEqual(winner.playerId, players[0].id, "the first across is ranked first");
    assert.strictEqual(winner.raw, 1);
  });

  test("an idle field ties on progress and keeps the shared rank rule", () => {
    const { instance } = start(3);
    beginRace(instance);
    racing.onTick(instance, 60_000);

    const result = racing.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings.length, 3);
    assert.strictEqual(result.standings.every((row) => row.rank === 1), true, "a zero-progress field ties");
    assert.strictEqual(result.standings.every((row) => row.raw === 0), true);
  });
});

describe("kit player palette", () => {
  test("the kit reuses the shared eight-seat palette, first four unchanged", () => {
    const expectedFirstFour = ["#FF2E97", "#00E5FF", "#FFE45E", "#3DFFA2"];
    assert.deepStrictEqual(kitColors.player.slice(0, 4), expectedFirstFour);
    assert.deepStrictEqual([...kitColors.player], [...theme.colors.player], "kit and shared palettes must match");

    const seen = new Set<string>();
    for (let index = 0; index < 8; index++) {
      const color = getPlayerColor(index);
      assert.match(color, /^#[0-9A-F]{6}$/i, `seat ${index}: hex colour`);
      assert.ok(!seen.has(color.toLowerCase()), `seat ${index}: colour must be distinct`);
      seen.add(color.toLowerCase());
    }
    assert.strictEqual(seen.size, 8, "eight distinct seat colours");
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
