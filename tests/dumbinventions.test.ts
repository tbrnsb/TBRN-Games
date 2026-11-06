/**
 * Dumb Inventions: 3-6 player flow.
 *
 * The chip check no longer penalises anything, the per-vote payout scales with
 * `f(N)` and one round gain is capped at the shared 1500 bound. The TV reveal
 * switches to the two-column grid at six pitches, and the plugin publishes the
 * reveal hooks plus result stats through the normal plugin interface.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import {
  MAX_ROUND_SCORE,
  scalePayout,
  withinRoundBound,
  type GameResult,
} from "../shared/scoring.ts";
import { voteLayout } from "../shared/vote-options.ts";
import dumbInventionsPlugin, { roundPoints, usesChips } from "../games/dumbinventions/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface InventionState {
  round: number;
  maxRounds: number;
  phase: "invent" | "vote" | "reveal" | "finished";
  problems: string[];
  chips: Array<[string, string]>;
  names: Array<string | null>;
  pitches: Array<string | null>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { rows: Array<{ name: string; pitch: string; votes: number; usedBoth: boolean }> } | null;
  stats: Record<string, number>;
}

interface InventionInstance {
  roomId: string;
  players: TestPlayer[];
  state: InventionState;
}

interface ScreenState {
  phase: string;
  round: number;
  maxRounds: number;
  playerCount: number;
  inventions: Array<{
    author: string;
    problem: string;
    chips: [string, string];
    name: string | null;
    pitch: string | null;
    usedBoth: boolean;
    votes: number | null;
  }>;
  options: Array<{ id: string; label: string; text: string; author: number; votes: number }>;
  optionColumns: number;
  reveal: { rows: Array<{ name: string; pitch: string; votes: number; usedBoth: boolean }> } | null;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: string | null;
}

interface InventionController {
  mode: string;
  options: Array<{ id: string; label: string }>;
}

interface InventionPlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; description: string };
  onStart(room: unknown, players: TestPlayer[]): InventionInstance;
  onInput(instance: InventionInstance, playerId: string, input: unknown): void;
  onTick(instance: InventionInstance, deltaMs: number): void;
  screenState(instance: InventionInstance): ScreenState;
  controllerState(instance: InventionInstance, playerId: string): InventionController;
  results?(instance: InventionInstance): GameResult;
}

const plugin = dumbInventionsPlugin as unknown as InventionPlugin;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay"];

/** A pitch that deliberately uses neither dealt chip. */
const NO_CHIPS_PITCH = "nothing at all";

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i] ?? `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: TestPlayer[]): Record<string, unknown> {
  return {
    id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
    gameId: "dumbinventions", gameState: null, createdAt: 0, status: "playing",
  };
}

function startGame(count: number): { players: TestPlayer[]; inst: InventionInstance } {
  const players = makePlayers(count);
  return { players, inst: plugin.onStart(makeRoom(players), players) };
}

/** Send a seat's product name, then its pitch. */
function submitPitch(inst: InventionInstance, seat: number, pitch: string): void {
  const player = inst.players[seat];
  plugin.onInput(inst, player.id, { text: `Gadget ${seat}` });
  plugin.onInput(inst, player.id, { text: pitch });
}

/** A pitch built from the two chips that seat was dealt. */
function pitchWithChips(inst: InventionInstance, seat: number): string {
  const [a, b] = inst.state.chips[seat];
  return `It is a ${a} and a ${b}`;
}

function submitAll(inst: InventionInstance, skip: number[] = []): void {
  inst.players.forEach((_player, seat) => {
    submitPitch(inst, seat, skip.includes(seat) ? NO_CHIPS_PITCH : pitchWithChips(inst, seat));
  });
}

function castVotes(
  inst: InventionInstance,
  pick: (voter: number, options: Array<{ id: string }>) => string | undefined = (voter, options) =>
    options[voter % options.length]?.id,
): void {
  for (let seat = 0; seat < inst.players.length; seat++) {
    const controller = plugin.controllerState(inst, inst.players[seat].id);
    if (controller.mode !== "choice") continue;
    const choice = pick(seat, controller.options);
    if (choice) plugin.onInput(inst, inst.players[seat].id, { choice });
  }
}

function release(inst: InventionInstance): void {
  inst.state.timerMs = 0;
  plugin.onTick(inst, 500);
}

function driveToFinish(inst: InventionInstance, skip: number[] = []): void {
  let guard = 0;
  while (inst.state.phase !== "finished" && guard < 5000) {
    const phase = inst.state.phase;
    if (phase === "invent") submitAll(inst, skip);
    else if (phase === "vote") castVotes(inst);
    else release(inst);
    guard++;
  }
}

/** All votes for seat 0 from every other seat; seat 0 cannot vote. */
function stackedVotes(count: number): Array<number | null> {
  return Array.from({ length: count }, (_, voter) => (voter === 0 ? null : 0));
}

/** One vote, cast by seat 1 for seat 0. */
function singleVote(count: number): Array<number | null> {
  const votes = new Array<number | null>(count).fill(null);
  votes[1] = 0;
  return votes;
}

describe("dumb inventions: chips and scoring", () => {
  test("a pitch must contain both chips, case-insensitively", () => {
    assert.strictEqual(usesChips("An umbrella that is also a subscription", ["umbrella", "subscription"]), true);
    assert.strictEqual(usesChips("A SUBSCRIPTION for umbrellas", ["umbrella", "subscription"]), true);
    assert.strictEqual(usesChips("An umbrella", ["umbrella", "subscription"]), false);
  });

  test("1000 per vote stays exact at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      assert.strictEqual(scalePayout(1000, count), 1000, `${count}: payout is not 1000`);
      const points = roundPoints(singleVote(count), count);
      assert.strictEqual(points[0], 1000, `${count}: one vote pays 1000`);
      assert.deepStrictEqual(
        points.slice(1),
        new Array(count - 1).fill(0),
        `${count}: nobody else scored`,
      );
    }
  });

  test("5 and 6 players pay scalePayout(1000, N) per vote", () => {
    for (const count of [5, 6]) {
      const points = roundPoints(singleVote(count), count);
      assert.strictEqual(points[0], scalePayout(1000, count), `${count}: scaled payout`);
    }
    assert.strictEqual(scalePayout(1000, 5), 750);
    assert.strictEqual(scalePayout(1000, 6), 600);
  });

  test("skipping a chip is not penalised: no votes scores 0", () => {
    assert.deepStrictEqual(roundPoints([null, null, null], 3), [0, 0, 0]);
    assert.deepStrictEqual(roundPoints([null, null, null, null], 4), [0, 0, 0, 0]);
  });

  test("an invalid or missing vote never changes a score", () => {
    assert.deepStrictEqual(roundPoints([9, -1, 1.5, null], 3), [0, 0, 0]);
  });

  test("3 and 4 players keep the uncapped stacked total (3-4 parity)", () => {
    for (const count of [3, 4]) {
      const uncapped = (count - 1) * scalePayout(1000, count);
      assert.strictEqual(uncapped, count === 3 ? 2000 : 3000, `${count}: old formula`);

      const points = roundPoints(stackedVotes(count), count);
      assert.strictEqual(points[0], uncapped, `${count}: uncapped round gain`);
      assert.ok(points[0] > MAX_ROUND_SCORE, `${count}: the literal bound does not apply at 3-4`);
    }
  });

  test("one round gain is capped at the shared 1500 bound only from five players", () => {
    for (const count of [5, 6]) {
      const uncapped = (count - 1) * scalePayout(1000, count);
      assert.ok(uncapped > MAX_ROUND_SCORE, `${count}: the uncapped formula should exceed the bound`);

      const points = roundPoints(stackedVotes(count), count);
      assert.strictEqual(points[0], MAX_ROUND_SCORE, `${count}: stacked round gain is capped`);
      assert.ok(withinRoundBound(points[0]), `${count}: sanity helper rejected ${points[0]}`);
      assert.ok(
        points.every((pointsForSeat) => withinRoundBound(pointsForSeat)),
        `${count}: every seat stays inside the round bound`,
      );
    }
  });
});

describe("dumb inventions: catalog and player range", () => {
  test("hard range is 3-6, ideal 4-6, and the manifest agrees", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 6);

    const entry = GAME_CATALOG.dumbinventions;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 6);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 6);
  });

  test("standalone runs two rounds at 3-4 and three from five; rumble stays two", () => {
    for (const count of [3, 4, 5, 6]) {
      const standalone = GAME_CATALOG.dumbinventions.scale(count, "standalone");
      // The pre-expansion baseline keeps two rounds at 3-4; the brief's three
      // start at five players.
      const expectedStandalone = count <= 4 ? 2 : 3;
      assert.strictEqual(standalone.rounds, expectedStandalone, `${count}: standalone rounds`);
      assert.deepStrictEqual(
        standalone.timers,
        { invent: 90, vote: 25, reveal: 9 },
        `${count}: standalone timers changed`,
      );
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one voting slot per pitch`);

      const rumble = GAME_CATALOG.dumbinventions.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 2, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
      assert.deepStrictEqual(rumble.optionCaps, standalone.optionCaps, `${count}: rumble caps changed`);
    }
  });

  test("the game starts on the standalone round count", () => {
    assert.strictEqual(startGame(6).inst.state.maxRounds, 3);
    assert.strictEqual(startGame(3).inst.state.maxRounds, 2, "3-4 players keep the baseline two rounds");
  });
});

describe("dumb inventions: scripted round", () => {
  test("name, then pitch, then a vote", () => {
    const { players, inst } = startGame(3);
    const s = inst.state;

    for (let seat = 0; seat < 3; seat++) {
      submitPitch(inst, seat, pitchWithChips(inst, seat));
      assert.strictEqual(s.names[seat], `Gadget ${seat}`);
    }
    assert.strictEqual(s.phase, "vote", "all pitches move to voting");

    plugin.onInput(inst, players[0].id, { choice: "p:0" });
    assert.strictEqual(s.votes[0], null, "cannot vote for yourself");
    plugin.onInput(inst, players[0].id, { choice: "p:1" });
    plugin.onInput(inst, players[1].id, { choice: "p:0" });
    plugin.onInput(inst, players[2].id, { choice: "p:1" });

    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.scores[1], 2000, "two votes at 1000 each, uncapped at three players");
    assert.strictEqual(s.scores[0], 1000, "one vote");
    assert.strictEqual(s.scores[2], 0, "no votes still scores 0");
  });

  test("a skipper with one vote still scores 1000, never 800", () => {
    const { players, inst } = startGame(3);
    submitAll(inst, [0]);
    assert.strictEqual(inst.state.phase, "vote");

    // One vote each, so the round bound cannot hide a chip penalty.
    plugin.onInput(inst, players[0].id, { choice: "p:2" });
    plugin.onInput(inst, players[1].id, { choice: "p:0" });
    plugin.onInput(inst, players[2].id, { choice: "p:1" });

    assert.strictEqual(inst.state.phase, "reveal");
    assert.deepStrictEqual(inst.state.scores, [1000, 1000, 1000]);
    assert.strictEqual(inst.state.reveal?.rows[0].usedBoth, false, "seat 0 skipped its chips");
  });

  test("a zero-vote skipper ends the round at 0, not -200", () => {
    const { players, inst } = startGame(3);
    submitAll(inst, [0]);
    assert.strictEqual(inst.state.phase, "vote");

    plugin.onInput(inst, players[0].id, { choice: "p:1" });
    plugin.onInput(inst, players[1].id, { choice: "p:2" });
    plugin.onInput(inst, players[2].id, { choice: "p:1" });

    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.scores[0], 0, "skipping chips is not a penalty");
    assert.ok(inst.state.scores[0] >= 0, "a round score can never go negative");
    assert.strictEqual(inst.state.reveal?.rows[0].votes, 0);
  });

  test("results reports standings plus votesReceived and chipsUsed", () => {
    const { players, inst } = startGame(3);
    submitAll(inst, [0]);

    plugin.onInput(inst, players[0].id, { choice: "p:2" });
    plugin.onInput(inst, players[1].id, { choice: "p:0" });
    plugin.onInput(inst, players[2].id, { choice: "p:1" });

    const result = plugin.results?.(inst);
    assert.ok(result, "dumbinventions must expose results()");
    assert.strictEqual(result.standings.length, 3);
    result.standings.forEach((standing, seat) => {
      assert.strictEqual(standing.raw, inst.state.scores[seat]);
      assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
    });

    assert.strictEqual(result.stats["p0:votesReceived"], 1);
    assert.strictEqual(result.stats["p1:votesReceived"], 1);
    assert.strictEqual(result.stats["p2:votesReceived"], 1);
    assert.strictEqual(result.stats["p0:chipsUsed"], 0, "a skipped chip is not counted");
    assert.strictEqual(result.stats["p1:chipsUsed"], 2);
    assert.strictEqual(result.stats["p2:chipsUsed"], 2);
  });
});

describe("dumb inventions: full playthrough", () => {
  for (const count of [3, 6]) {
    test(`${count} players reaches finished with sane, non-negative scores`, () => {
      const { players, inst } = startGame(count);
      driveToFinish(inst);

      assert.strictEqual(inst.state.phase, "finished");
      assert.strictEqual(inst.state.maxRounds, count <= 4 ? 2 : 3);
      assert.strictEqual(inst.state.scores.length, count);
      // 3-4 players keep the old uncapped per-round total; the 1500 bound
      // only applies from five players up.
      const perRoundCeiling = count >= 5
        ? MAX_ROUND_SCORE
        : (count - 1) * scalePayout(1000, count);
      for (const score of inst.state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, `bad score ${score}`);
        assert.ok(score <= perRoundCeiling * inst.state.maxRounds, `score ${score} out of bounds`);
      }

      const screen = plugin.screenState(inst);
      assert.strictEqual(screen.finished, true);
      assert.strictEqual(screen.playerCount, count);
      assert.strictEqual(screen.scores.length, count);
      assert.ok(screen.scores.every((row) => row.score >= 0), "the TV never shows a negative score");

      const result = plugin.results?.(inst);
      assert.ok(result);
      assert.strictEqual(result.standings.length, count);
      for (const player of players) {
        assert.strictEqual(typeof result.stats[`${player.id}:votesReceived`], "number");
        assert.strictEqual(typeof result.stats[`${player.id}:chipsUsed`], "number");
      }
    });
  }
});

describe("dumb inventions: six players and the TV reveal", () => {
  test("five voting options per phone, none of them your own, and six pitches at the reveal", () => {
    const { inst } = startGame(6);
    submitAll(inst);
    assert.strictEqual(inst.state.phase, "vote");

    // The pitch list, names included, is withheld from the TV until the reveal.
    assert.deepStrictEqual(plugin.screenState(inst).options, [], "no ballot list on the TV before the reveal");

    for (let seat = 0; seat < 6; seat++) {
      const controller = plugin.controllerState(inst, inst.players[seat].id);
      const ids = controller.options.map((option) => option.id);
      assert.strictEqual(ids.length, 5, `seat ${seat} should see N-1 = 5 options`);
      assert.ok(!ids.includes(`p:${seat}`), `seat ${seat} must not vote for their own pitch`);
      for (const option of controller.options) {
        assert.strictEqual(option.label, `Gadget ${option.id.slice(2)}`, "phones see the product names");
      }
    }

    castVotes(inst);
    assert.strictEqual(inst.state.phase, "reveal");
    const screen = plugin.screenState(inst);
    assert.strictEqual(screen.options.length, 6, "six pitches on the TV at the reveal");
    assert.deepStrictEqual(
      screen.options.map((option) => option.label),
      ["Gadget 0", "Gadget 1", "Gadget 2", "Gadget 3", "Gadget 4", "Gadget 5"],
    );
  });

  test("six pitches switch the TV reveal to a readable two-column grid", () => {
    const { inst } = startGame(6);
    submitAll(inst);
    castVotes(inst);
    assert.strictEqual(inst.state.phase, "reveal");

    const screen = plugin.screenState(inst);
    const options = screen.options;
    assert.strictEqual(options.length, 6);
    assert.strictEqual(screen.optionColumns, 2);
    assert.strictEqual(screen.reveal?.rows.length, 6);

    const layout = voteLayout(options.length, { minColumns: screen.optionColumns === 2 ? 2 : 1 });
    assert.strictEqual(layout.columns, 2, "six long pitches use two columns");
    assert.strictEqual(layout.letters.length, 6);
    assert.strictEqual(layout.letters[5], "F");
    assert.ok(layout.minFontPx >= 36, "two-column type stays readable");

    options.forEach((option, seat) => {
      assert.strictEqual(option.author, seat, "authors are revealed with the pitches");
      assert.ok(option.label.length > 0);
    });

    const three = startGame(3);
    submitAll(three.inst);
    castVotes(three.inst);
    assert.strictEqual(plugin.screenState(three.inst).optionColumns, 1, "three pitches stay one column");
    assert.strictEqual(voteLayout(3, { minColumns: 1 }).columns, 1);
  });
});

describe("dumb inventions: reveal hooks and TV privacy", () => {
  test("waitingOn follows the invent and vote phases", () => {
    const { players, inst } = startGame(3);
    assert.deepStrictEqual(plugin.screenState(inst).waitingOn, NAMES.slice(0, 3));

    plugin.onInput(inst, players[0].id, { text: "Gadget" });
    assert.deepStrictEqual(
      plugin.screenState(inst).waitingOn,
      NAMES.slice(0, 3),
      "a name without a pitch is still pending",
    );
    plugin.onInput(inst, players[0].id, { text: pitchWithChips(inst, 0) });
    assert.deepStrictEqual(plugin.screenState(inst).waitingOn, ["Ben", "Cleo"]);

    submitAll(inst);
    assert.strictEqual(inst.state.phase, "vote");
    assert.deepStrictEqual(plugin.screenState(inst).waitingOn, NAMES.slice(0, 3));

    plugin.onInput(inst, players[1].id, { choice: "p:0" });
    assert.deepStrictEqual(plugin.screenState(inst).waitingOn, ["Ana", "Cleo"]);
  });

  test("the reveal publishes the sound, caption and a settled waiting list", () => {
    const { inst } = startGame(5);
    submitAll(inst);
    castVotes(inst);

    assert.strictEqual(inst.state.phase, "reveal");
    const reveal = plugin.screenState(inst);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && reveal.caption.length > 0);
    assert.deepStrictEqual(reveal.waitingOn, []);
    assert.strictEqual(reveal.reveal?.rows.length, 5);
  });

  test("the ballot list stays off the TV until the reveal", () => {
    const { inst } = startGame(4);
    assert.deepStrictEqual(
      plugin.screenState(inst).options,
      [],
      "no vote list while players are inventing",
    );

    submitAll(inst);
    assert.strictEqual(inst.state.phase, "vote");
    assert.deepStrictEqual(
      plugin.screenState(inst).options,
      [],
      "no vote list while the ballot is open",
    );

    castVotes(inst);
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(plugin.screenState(inst).options.length, 4);
  });

  test("no submitted name or pitch reaches the TV before the reveal", () => {
    const { players, inst } = startGame(6);
    const secretNames = players.map((_, seat) => `SecretName${seat}`);
    const secretPitches = players.map((_, seat) => `SecretPitch${seat}`);

    const assertHidden = (stage: string): void => {
      const screen = plugin.screenState(inst);
      const json = JSON.stringify(screen);
      secretNames.forEach((name, seat) => {
        assert.ok(!json.includes(name), `${stage}: name for seat ${seat} leaked to the TV`);
      });
      secretPitches.forEach((pitch, seat) => {
        assert.ok(!json.includes(pitch), `${stage}: pitch for seat ${seat} leaked to the TV`);
      });
      for (const invention of screen.inventions) {
        assert.strictEqual(invention.name, null, `${stage}: a product name is published early`);
        assert.strictEqual(invention.pitch, null, `${stage}: a pitch is published early`);
      }
    };

    assertHidden("invent, before any input");

    players.forEach((player, seat) => {
      plugin.onInput(inst, player.id, { text: secretNames[seat] });
      assert.strictEqual(inst.state.phase, "invent");
      assertHidden(`invent, after name ${seat}`);

      plugin.onInput(inst, player.id, { text: secretPitches[seat] });
      assertHidden(`invent, after pitch ${seat}`);
    });

    assert.strictEqual(inst.state.phase, "vote");
    assertHidden("vote, before any vote");

    for (let seat = 0; seat < 6 && inst.state.phase === "vote"; seat++) {
      const controller = plugin.controllerState(inst, inst.players[seat].id);
      plugin.onInput(inst, inst.players[seat].id, { choice: controller.options[seat % 5].id });
      if (inst.state.phase === "vote") assertHidden(`vote, after vote ${seat}`);
    }

    assert.strictEqual(inst.state.phase, "reveal");
    const reveal = JSON.stringify(plugin.screenState(inst));
    secretNames.forEach((name) => assert.ok(reveal.includes(name), "names appear at the reveal"));
    secretPitches.forEach((pitch) => assert.ok(reveal.includes(pitch), "pitches appear at the reveal"));
  });
});
