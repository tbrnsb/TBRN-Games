/**
 * Split the Room: 3-8 player flow, writer rotation, the unchanged 3-4 player
 * scoring rule, the reveal hooks and server-side text sanitising.
 *
 * The game is driven through its plugin interface so every rule is pinned
 * without a browser. The 3-4 player fixture replays a scripted game against a
 * reference implementation of the old fixed four-round rule and must match it
 * exactly, including the minority bonus.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface Scenario {
  text: string;
  hint: string;
}

type Vote = "yes" | "no" | null;

interface SplitState {
  scenarios: Scenario[];
  round: number;
  maxRounds: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  writer: number;
  submission: string | null;
  votes: Vote[];
  scores: number[];
  timerMs: number;
  reveal: { yes: number; no: number; points: number } | null;
  stats: Record<string, number>;
}

interface SplitInstance {
  roomId: string;
  players: TestPlayer[];
  state: SplitState;
}

interface ScreenState {
  phase: string;
  round: number;
  maxRounds: number;
  playerCount: number;
  scenario: string;
  prompt: string;
  filled: string | null;
  writerName: string;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  reveal: { yes: number; no: number; points: number } | null;
  timerMs: number;
  players: Array<{ name: string; score: number }>;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: string | null;
}

interface ControllerState {
  mode: string;
  controllerType: string;
  round: number;
  maxRounds: number;
  yourScore: number;
  finished: boolean;
  youWon: boolean;
  prompt?: string;
  placeholder?: string;
  maxLength?: number;
  options: Array<{ id: string; label: string }>;
  hasVoted?: boolean;
  info?: string;
}

interface SplitRoomPlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; description: string };
  onStart(room: unknown, players: TestPlayer[]): SplitInstance;
  onInput(instance: SplitInstance, playerId: string, input: unknown): void;
  onTick(instance: SplitInstance, deltaMs: number): void;
  screenState(instance: SplitInstance): ScreenState;
  controllerState(instance: SplitInstance, playerId: string): ControllerState;
  results?(instance: SplitInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const mod = (await import("../games/splitroom/server.ts")) as { default: SplitRoomPlugin };
const plugin = mod.default;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal"];

const FIXED_SCENARIOS: Scenario[] = [
  { text: "You win a lifetime supply of ___.", hint: "a prize" },
  { text: "You can only eat ___ for a year.", hint: "a food" },
  { text: "Your house is slowly filling with ___.", hint: "a thing" },
  { text: "You must sing every word to ___.", hint: "someone" },
];

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i] ?? `Player ${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: TestPlayer[]): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: players[0].id,
    players,
    gameId: "splitroom",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/** Start with a pinned four-scenario list so scenario text never affects a rule test. */
function startPinned(count: number): SplitInstance {
  const players = makePlayers(count);
  const instance = plugin.onStart(makeRoom(players), players);
  instance.state.scenarios = FIXED_SCENARIOS.map((scenario) => ({ ...scenario }));
  return instance;
}

/** The writer submits their fill, moving the round to voting. */
function submit(instance: SplitInstance, text = "something odd"): void {
  const writer = instance.players[instance.state.writer];
  plugin.onInput(instance, writer.id, { text });
}

/** Cast one vote per non-writer; `null` leaves that voter silent. */
function castVotes(instance: SplitInstance, choices: Vote[]): void {
  choices.forEach((choice, index) => {
    if (choice === null || index === instance.state.writer) return;
    plugin.onInput(instance, instance.players[index].id, { choice });
  });
}

/** Expire the reveal phase without waiting on the real clock. */
function endReveal(instance: SplitInstance): void {
  instance.state.timerMs = 0;
  plugin.onTick(instance, 500);
}

/** Play a whole match with deterministic inputs and return the writer per round. */
function driveToFinish(instance: SplitInstance): Map<number, number> {
  const writers = new Map<number, number>();
  let guard = 0;
  while (instance.state.phase !== "finished" && guard < 5000) {
    const state = instance.state;
    if (state.phase === "writing") {
      if (!writers.has(state.round)) writers.set(state.round, state.writer);
      submit(instance, `fill ${state.round} by ${instance.players[state.writer].name}`);
    } else if (state.phase === "voting") {
      for (let index = 0; index < instance.players.length; index++) {
        if (index === state.writer) continue;
        plugin.onInput(instance, instance.players[index].id, {
          choice: (index + state.round) % 2 === 0 ? "yes" : "no",
        });
      }
    }
    plugin.onTick(instance, 500);
    guard++;
  }
  return writers;
}

describe("splitroom: catalog and player range", () => {
  test("hard range is 3-8 and every manifest agrees", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);

    const entry = GAME_CATALOG.splitroom;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);
  });

  test("standalone rounds keep four at N=3 and N=4, then follow the table", () => {
    const expected: Record<number, number> = { 3: 4, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
    for (const [count, rounds] of Object.entries(expected)) {
      const scale = GAME_CATALOG.splitroom.scale(Number(count), "standalone");
      assert.strictEqual(scale.rounds, rounds, `${count}: standalone rounds`);
      assert.deepStrictEqual(scale.timers, { write: 45, vote: 25, reveal: 8 }, `${count}: timers changed`);
    }
  });

  test("rumble rounds cap at four and timers stay put", () => {
    const expected: Record<number, number> = { 3: 3, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 };
    for (const [count, rounds] of Object.entries(expected)) {
      const scale = GAME_CATALOG.splitroom.scale(Number(count), "rumble");
      assert.strictEqual(scale.rounds, rounds, `${count}: rumble rounds`);
      assert.deepStrictEqual(scale.timers, { write: 45, vote: 25, reveal: 8 }, `${count}: timers changed`);
    }
  });

  test("onStart runs one write per player, floored at four rounds", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const players = makePlayers(count);
      const instance = plugin.onStart(makeRoom(players), players);
      assert.strictEqual(instance.state.maxRounds, Math.max(4, count), `${count}: maxRounds`);
      assert.ok(instance.state.scenarios.length >= 4, `${count}: too few scenarios`);
    }
  });
});

describe("splitroom: full playthrough", () => {
  for (const count of [3, 8]) {
    test(`${count} players reaches finished with sane scores and results`, () => {
      const players = makePlayers(count);
      const instance = plugin.onStart(makeRoom(players), players);
      const writers = driveToFinish(instance);

      assert.strictEqual(instance.state.phase, "finished");
      assert.strictEqual(writers.size, instance.state.maxRounds, `${count}: rounds with a writer`);
      assert.strictEqual(instance.state.scores.length, count);
      for (const score of instance.state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, `bad score ${score}`);
      }

      const screen = plugin.screenState(instance);
      assert.strictEqual(screen.finished, true);
      assert.strictEqual(screen.playerCount, count);
      assert.strictEqual(screen.players.length, count);

      const result = plugin.results?.(instance);
      assert.ok(result, "splitroom must expose results()");
      assert.strictEqual(result.standings.length, count);
      for (const standing of result.standings) {
        assert.ok(Number.isFinite(standing.raw) && standing.raw >= 0);
        assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
      }
      for (const player of instance.players) {
        assert.strictEqual(typeof result.stats[`${player.id}:splitScore`], "number");
        assert.strictEqual(typeof result.stats[`${player.id}:minorityCalls`], "number");
      }
    });
  }

  test("at eight players every player writes exactly once", () => {
    const players = makePlayers(8);
    const instance = plugin.onStart(makeRoom(players), players);
    const writers = driveToFinish(instance);

    const order = [...writers.values()];
    assert.strictEqual(order.length, 8, "eight rounds expected");
    assert.deepStrictEqual(
      new Set(order),
      new Set([0, 1, 2, 3, 4, 5, 6, 7]),
      "every seat must write once",
    );
    assert.strictEqual(new Set(order).size, 8, "no seat may write twice");
  });

  test("at three players the writer cycle repeats the first seat", () => {
    const players = makePlayers(3);
    const instance = plugin.onStart(makeRoom(players), players);
    const writers = driveToFinish(instance);
    assert.deepStrictEqual([...writers.values()], [0, 1, 2, 0]);
  });
});

// --- 3-4 player regression fixture ---------------------------------------

/** One scripted ballot per round; the writer's slot is ignored. */
const VOTE_SCRIPT: Record<number, Vote[][]> = {
  3: [
    [null, "yes", "no"],
    ["yes", null, "yes"],
    ["no", "yes", null],
    [null, "yes", "yes"],
  ],
  4: [
    [null, "yes", "yes", "no"],
    ["yes", null, "no", "no"],
    ["no", "no", null, "yes"],
    ["yes", "yes", "yes", null],
  ],
};

/** Reference implementation of the pre-expansion fixed four-round scoring. */
function legacyTotals(playerCount: number): {
  scores: number[];
  splitScore: number[];
  minorityCalls: number[];
} {
  const scores = Array.from({ length: playerCount }, () => 0);
  const splitScore = Array.from({ length: playerCount }, () => 0);
  const minorityCalls = Array.from({ length: playerCount }, () => 0);

  for (let round = 0; round < 4; round++) {
    const writer = round % playerCount;
    const ballot = VOTE_SCRIPT[playerCount][round];
    const yes = ballot.filter((choice, index) => index !== writer && choice === "yes").length;
    const no = ballot.filter((choice, index) => index !== writer && choice === "no").length;
    const voters = playerCount - 1;
    const points = Math.round(1000 - Math.abs(yes - no) * (1000 / voters));

    scores[writer] += points;
    splitScore[writer] += points;

    if (yes !== no) {
      const minority = yes < no ? "yes" : "no";
      ballot.forEach((choice, index) => {
        if (index === writer || choice !== minority) return;
        scores[index] += 150;
        minorityCalls[index] += 1;
      });
    }
  }

  return { scores, splitScore, minorityCalls };
}

/** Replay the scripted ballots through the real plugin. */
function runScriptedGame(playerCount: number): SplitInstance {
  const instance = startPinned(playerCount);
  assert.strictEqual(instance.state.maxRounds, 4, `${playerCount}: the old game ran four rounds`);

  for (let round = 0; round < 4; round++) {
    assert.strictEqual(instance.state.phase, "writing", `${playerCount}/${round}: writing`);
    assert.strictEqual(instance.state.round, round);
    assert.strictEqual(instance.state.writer, round % playerCount, `${playerCount}/${round}: writer`);

    submit(instance, `scripted fill ${round}`);
    assert.strictEqual(instance.state.phase, "voting", `${playerCount}/${round}: voting`);

    castVotes(instance, VOTE_SCRIPT[playerCount][round]);
    assert.strictEqual(instance.state.phase, "reveal", `${playerCount}/${round}: reveal`);

    endReveal(instance);
  }

  assert.strictEqual(instance.state.phase, "finished", `${playerCount}: finished`);
  return instance;
}

describe("splitroom: 3-4 player totals match the old four-round game", () => {
  const fixtures: Record<number, { scores: number[]; splitScore: number[]; minorityCalls: number[] }> = {
    3: { scores: [1000, 0, 1000], splitScore: [1000, 0, 1000], minorityCalls: [0, 0, 0] },
    4: { scores: [817, 667, 667, 300], splitScore: [667, 667, 667, 0], minorityCalls: [1, 0, 0, 2] },
  };

  for (const count of [3, 4]) {
    test(`${count} players: scripted totals are byte-for-byte the old rule`, () => {
      const instance = runScriptedGame(count);
      const legacy = legacyTotals(count);

      assert.deepStrictEqual(instance.state.scores, legacy.scores, `${count}: totals drift from the old rule`);
      assert.deepStrictEqual(instance.state.scores, fixtures[count].scores, `${count}: pinned fixture`);

      const result = plugin.results?.(instance);
      assert.ok(result);
      const stats = result.stats;
      instance.players.forEach((player, index) => {
        assert.strictEqual(stats[`${player.id}:splitScore`], fixtures[count].splitScore[index], `${count}: splitScore`);
        assert.strictEqual(
          stats[`${player.id}:minorityCalls`],
          fixtures[count].minorityCalls[index],
          `${count}: minorityCalls`,
        );
      });
    });
  }
});

describe("splitroom: scoring formula", () => {
  test("a perfect split pays the writer the full 1000", () => {
    const instance = startPinned(3);
    submit(instance);
    castVotes(instance, [null, "yes", "no"]);

    assert.deepStrictEqual(instance.state.reveal, { yes: 1, no: 1, points: 1000 });
    assert.strictEqual(instance.state.scores[0], 1000);
    assert.strictEqual(instance.state.scores[1], 0, "a split tie leaves both voters on zero");
    assert.strictEqual(instance.state.scores[2], 0);
  });

  test("a unanimous vote pays the writer nothing and nobody a minority bonus", () => {
    const instance = startPinned(4);
    submit(instance);
    castVotes(instance, [null, "yes", "yes", "yes"]);

    assert.deepStrictEqual(instance.state.reveal, { yes: 3, no: 0, points: 0 });
    assert.deepStrictEqual(instance.state.scores, [0, 0, 0, 0]);
  });

  test("an odd voter count rounds the writer down and pays the minority 150", () => {
    const instance = startPinned(4);
    submit(instance);
    castVotes(instance, [null, "yes", "yes", "no"]);

    assert.deepStrictEqual(instance.state.reveal, { yes: 2, no: 1, points: 667 });
    assert.strictEqual(instance.state.scores[0], 667, "writer payout rounds half up");
    assert.strictEqual(instance.state.scores[3], 150, "the lone no-voter is the minority");
    assert.strictEqual(instance.state.scores[1], 0);
    assert.strictEqual(instance.state.scores[2], 0);
  });

  test("the minority bonus stays a fixed 150 at every larger table", () => {
    for (const count of [5, 6, 7, 8]) {
      const instance = startPinned(count);
      assert.strictEqual(instance.state.writer, 0);
      submit(instance);

      const voters = count - 1;
      // Always leave at least one voter on the smaller side.
      const yesCount = Math.floor(voters / 2) + 1;
      const noCount = voters - yesCount;
      const choices: Vote[] = [null];
      for (let index = 1; index <= voters; index++) {
        choices.push(index <= yesCount ? "yes" : "no");
      }
      castVotes(instance, choices);

      assert.deepStrictEqual(instance.state.reveal, {
        yes: yesCount,
        no: noCount,
        points: Math.round(1000 - Math.abs(yesCount - noCount) * (1000 / voters)),
      });
      for (let index = 1 + yesCount; index <= voters; index++) {
        assert.strictEqual(instance.state.scores[index], 150, `${count}: minority voter ${index}`);
      }
      assert.strictEqual(instance.state.scores[0], instance.state.reveal?.points);
    }
  });

  test("maximum single-round score stays within 1500 at every N", () => {
    for (let count = 3; count <= 8; count++) {
      const instance = startPinned(count);
      submit(instance);

      const voters = count - 1;
      const yesCount = Math.ceil(voters / 2);
      const choices: Vote[] = [null];
      for (let index = 1; index <= voters; index++) {
        choices.push(index <= yesCount ? "yes" : "no");
      }
      castVotes(instance, choices);

      const max = Math.max(...instance.state.scores);
      assert.ok(max <= MAX_ROUND_SCORE, `${count}: ${max} exceeds ${MAX_ROUND_SCORE}`);
      assert.ok(withinRoundBound(max), `${count}: sanity helper rejected ${max}`);

      // The theoretical best split and the fixed minority bonus are both in bounds.
      const bestSplit = Math.round(1000 - (voters % 2) * (1000 / voters));
      assert.ok(withinRoundBound(bestSplit), `${count}: best split ${bestSplit} out of bounds`);
      assert.ok(withinRoundBound(150), `${count}: minority bonus out of bounds`);
    }
  });
});

describe("splitroom: reveal hooks and TV payload", () => {
  test("waitingOn tracks the writer, then the silent voters", () => {
    const instance = startPinned(4);
    assert.strictEqual(instance.state.writer, 0);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana"]);

    submit(instance);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ben", "Cleo", "Dev"]);

    plugin.onInput(instance, "p1", { choice: "yes" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Cleo", "Dev"]);

    castVotes(instance, [null, "yes", "yes", "no"]);
    const reveal = plugin.screenState(instance);
    assert.deepStrictEqual(reveal.waitingOn, [], "a settled round waits on nobody");
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && reveal.caption.length > 0);
  });

  test("the TV carries the filled scenario only once the writer submits", () => {
    const instance = startPinned(3);
    const writing = plugin.screenState(instance);
    assert.strictEqual(writing.filled, null);
    assert.strictEqual(writing.prompt, FIXED_SCENARIOS[0].text);
    assert.strictEqual(writing.caption, null);

    submit(instance, "a rubber duck");
    const voting = plugin.screenState(instance);
    assert.strictEqual(voting.filled, "a rubber duck");
    assert.strictEqual(voting.prompt, FIXED_SCENARIOS[0].text.replace("___", "a rubber duck"));
    assert.strictEqual(voting.players.length, 3, "all three seats stay on the TV");
    assert.strictEqual(voting.caption, null, "no caption before the reveal");

    castVotes(instance, [null, "yes", "no"]);
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption?.includes("Ana"), `caption should name the perfect split writer: ${reveal.caption}`);
  });

  test("eight voters keep all eight names and scores on the TV", () => {
    const instance = startPinned(8);
    submit(instance);
    const screen = plugin.screenState(instance);
    assert.strictEqual(screen.playerCount, 8);
    assert.deepStrictEqual(
      screen.scores.map((row) => row.name),
      NAMES,
      "every seat must appear on the TV",
    );
    assert.strictEqual(screen.waitingOn.length, 7);
    for (const player of instance.players.slice(1)) {
      assert.ok(screen.waitingOn.includes(player.name), `${player.name} missing from waitingOn`);
    }
  });

  test("results publishes standings plus the split and minority stats", () => {
    const instance = startPinned(4);
    submit(instance);
    castVotes(instance, [null, "yes", "yes", "no"]);

    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings[0].playerId, "p0");
    assert.strictEqual(result.standings[0].raw, 667);
    assert.strictEqual(result.stats["p0:splitScore"], 667);
    assert.strictEqual(result.stats["p3:minorityCalls"], 1);
  });
});

describe("splitroom: inputs and text sanitising", () => {
  test("free text is collapsed, stripped of control characters and capped at 140", () => {
    const instance = startPinned(3);
    submit(instance, "  a\n\tb\u0000c  ");

    assert.strictEqual(instance.state.submission, "a b c");

    const long = startPinned(3);
    submit(long, "x".repeat(5000));
    assert.strictEqual(long.state.submission?.length, 140);

    const empty = startPinned(3);
    submit(empty, "   \n\t ");
    assert.strictEqual(empty.state.phase, "writing", "an empty fill must not start the vote");
    assert.strictEqual(empty.state.submission, null);
  });

  test("only the writer may fill and only voters may vote", () => {
    const instance = startPinned(4);
    plugin.onInput(instance, "p1", { text: "not my turn" });
    assert.strictEqual(instance.state.submission, null);
    assert.strictEqual(instance.state.phase, "writing");

    submit(instance);
    plugin.onInput(instance, "p0", { choice: "yes" });
    assert.strictEqual(instance.state.votes[0], null, "the writer cannot vote on their own scenario");

    plugin.onInput(instance, "p1", { choice: "maybe" });
    assert.strictEqual(instance.state.votes[1], null, "an unknown choice is ignored");
  });

  test("a voter can change their vote before the ballot closes", () => {
    const instance = startPinned(4);
    submit(instance);

    plugin.onInput(instance, "p1", { choice: "yes" });
    plugin.onInput(instance, "p1", { choice: "no" });
    assert.strictEqual(instance.state.votes[1], "no", "the later pick replaces the earlier one");

    castVotes(instance, [null, "no", "yes", "no"]);
    assert.deepStrictEqual(instance.state.reveal, { yes: 1, no: 2, points: 667 });
  });

  test("a silent voter still counts in the split denominator at the deadline", () => {
    const instance = startPinned(4);
    submit(instance);
    plugin.onInput(instance, "p1", { choice: "yes" });

    instance.state.timerMs = 0;
    plugin.onTick(instance, 500);

    // Two voters are silent, so the visible split is 1 yes / 0 no out of three voters.
    assert.deepStrictEqual(instance.state.reveal, { yes: 1, no: 0, points: 667 });
  });
});
