/**
 * Survive the Internet: 3-6 player flow.
 *
 * The game is driven through its plugin interface so the pairing rules,
 * scaled scoring, reveal hooks and TV privacy are pinned without a browser.
 * Pairings are secure-random in production, so the scoring tests pin a known
 * derangement after `onStart`; the playthroughs use the real shuffle.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, scalePayout, withinRoundBound } from "../shared/scoring.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface SurviveState {
  round: number;
  maxRounds: number;
  phase: "answering" | "twisting" | "voting" | "reveal" | "finished";
  prompt: string;
  answers: Array<string | null>;
  twists: Array<string | null>;
  pairing: number[];
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: Array<{ twister: number; author: number; votes: number }> | null;
  stats: Record<string, number>;
}

interface SurviveInstance {
  roomId: string;
  players: TestPlayer[];
  state: SurviveState;
}

interface ControllerState {
  mode: string;
  controllerType: string;
  options: Array<{ id: string; label: string }>;
  hasSubmitted?: boolean;
  hasVoted?: boolean;
  info?: string;
}

interface SurvivePlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; description: string };
  onStart(room: unknown, players: TestPlayer[]): SurviveInstance;
  onInput(instance: SurviveInstance, playerId: string, input: unknown): void;
  onTick(instance: SurviveInstance, deltaMs: number): void;
  screenState(instance: SurviveInstance): Record<string, unknown>;
  controllerState(instance: SurviveInstance, playerId: string): ControllerState;
  results?(instance: SurviveInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const mod = (await import("../games/survive/server.ts")) as { default: SurvivePlugin };
const plugin = mod.default;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay"];

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
    gameId: "survive",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/** Start a round with a known cyclic derangement: seat i quotes seat i+1. */
function startPinned(count: number): SurviveInstance {
  const players = makePlayers(count);
  const instance = plugin.onStart(makeRoom(players), players);
  instance.state.pairing = players.map((_, i) => (i + 1) % count);
  return instance;
}

function submitAnswers(instance: SurviveInstance, prefix = "answer"): void {
  instance.players.forEach((player, i) => {
    plugin.onInput(instance, player.id, { text: `${prefix}-${i}` });
  });
}

function submitTwists(instance: SurviveInstance, prefix = "headline"): void {
  instance.players.forEach((player, i) => {
    plugin.onInput(instance, player.id, { text: `${prefix}-${i}` });
  });
}

/** Every player votes with the first option (or any option chosen by pick). */
function castVotes(
  instance: SurviveInstance,
  pick: (voter: number, options: Array<{ id: string }>) => string | undefined = (_voter, options) => options[0]?.id,
): void {
  for (let voter = 0; voter < instance.players.length; voter++) {
    const controller = plugin.controllerState(instance, instance.players[voter].id);
    if (controller.mode !== "choice") continue;
    const choice = pick(voter, controller.options);
    if (!choice) continue;
    plugin.onInput(instance, instance.players[voter].id, { choice });
  }
}

function settleByTimeout(instance: SurviveInstance): void {
  instance.state.timerMs = 0;
  plugin.onTick(instance, 500);
}

function endReveal(instance: SurviveInstance): void {
  instance.state.timerMs = 0;
  plugin.onTick(instance, 500);
}

function driveToFinish(instance: SurviveInstance): void {
  let guard = 0;
  while (instance.state.phase !== "finished" && guard < 5000) {
    const state = instance.state;
    if (state.phase === "answering") {
      submitAnswers(instance);
    } else if (state.phase === "twisting") {
      submitTwists(instance);
    } else if (state.phase === "voting") {
      castVotes(instance, (voter, options) => options[voter % options.length]?.id);
    } else if (state.phase === "reveal") {
      endReveal(instance);
    } else {
      break;
    }
    guard++;
  }
}

describe("survive: catalog and player range", () => {
  test("hard range is 3-6 and every manifest agrees", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 6);

    const entry = GAME_CATALOG.survive;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 6);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 6);
  });

  test("standalone runs three rounds, rumble two, timers unchanged", () => {
    for (const count of [3, 4, 5, 6]) {
      const standalone = GAME_CATALOG.survive.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 3, `${count}: standalone rounds`);
      assert.deepStrictEqual(
        standalone.timers,
        { answer: 45, twist: 40, vote: 25, reveal: 9 },
        `${count}: timers changed`,
      );
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one slot per pairing`);

      const rumble = GAME_CATALOG.survive.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 2, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
    }
  });
});

describe("survive: pairing validity", () => {
  for (const count of [5, 6]) {
    test(`${count} players: every answer is twisted by exactly one other player`, () => {
      const players = makePlayers(count);
      const instance = plugin.onStart(makeRoom(players), players);
      const pairing = instance.state.pairing;

      assert.strictEqual(pairing.length, count);
      assert.deepStrictEqual(
        [...pairing].sort((a, b) => a - b),
        Array.from({ length: count }, (_, i) => i),
        "pairing must be a permutation",
      );
      for (let writer = 0; writer < count; writer++) {
        assert.notStrictEqual(pairing[writer], writer, `seat ${writer} quoted itself`);
      }
    });
  }

  test("at six players the ballot has six slots and excludes both of a voter's pairings", () => {
    const instance = startPinned(6);
    submitAnswers(instance);
    submitTwists(instance);
    assert.strictEqual(instance.state.phase, "voting");

    const screen = plugin.screenState(instance);
    assert.strictEqual((screen.pairs as unknown[]).length, 6, "one TV slot per pairing");

    for (let voter = 0; voter < 6; voter++) {
      const controller = plugin.controllerState(instance, instance.players[voter].id);
      const ids = controller.options.map((option) => option.id);
      assert.strictEqual(ids.length, 4, `voter ${voter} should have N-2 = 4 options`);
      for (let writer = 0; writer < 6; writer++) {
        const own = writer === voter || instance.state.pairing[writer] === voter;
        const offered = ids.includes(`t:${writer}`);
        assert.strictEqual(offered, !own, `voter ${voter}, pairing ${writer}: own-pairing exemption`);
      }
    }
  });

  test("the plugin rejects a vote for a pairing the voter is part of", () => {
    const instance = startPinned(6);
    submitAnswers(instance);
    submitTwists(instance);

    // Seat 0 writes pairing 0 (quotes seat 1) and is quoted by pairing 5.
    plugin.onInput(instance, "p0", { choice: "t:0" });
    assert.strictEqual(instance.state.votes[0], null, "cannot vote for your own headline");
    plugin.onInput(instance, "p0", { choice: "t:5" });
    assert.strictEqual(instance.state.votes[0], null, "cannot vote for the pairing quoting you");
    plugin.onInput(instance, "p0", { choice: "t:2" });
    assert.strictEqual(instance.state.votes[0], 2, "a pairing you are not part of is allowed");
  });
});

describe("survive: full playthrough", () => {
  for (const count of [3, 6]) {
    test(`${count} players reaches finished with sane scores and results`, () => {
      const players = makePlayers(count);
      const instance = plugin.onStart(makeRoom(players), players);
      driveToFinish(instance);

      assert.strictEqual(instance.state.phase, "finished");
      assert.strictEqual(instance.state.scores.length, count);
      for (const score of instance.state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, `bad score ${score}`);
        assert.ok(score <= MAX_ROUND_SCORE * instance.state.maxRounds, `score ${score} out of bounds`);
      }

      const screen = plugin.screenState(instance);
      assert.strictEqual(screen.finished, true);
      assert.strictEqual(screen.playerCount, count);
      assert.strictEqual((screen.scores as unknown[]).length, count);

      const result = plugin.results?.(instance);
      assert.ok(result, "survive must expose results()");
      assert.strictEqual(result.standings.length, count);
      for (const standing of result.standings) {
        assert.ok(Number.isFinite(standing.raw) && standing.raw >= 0);
        assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
      }
      for (const player of instance.players) {
        assert.strictEqual(typeof result.stats[`${player.id}:votesReceived`], "number");
        assert.strictEqual(typeof result.stats[`${player.id}:quotedVotes`], "number");
      }
    });
  }
});

/** Play one round where exactly one vote goes to pairing 0. */
function scoreOneVote(count: number): SurviveInstance {
  const instance = startPinned(count);
  submitAnswers(instance);
  submitTwists(instance);
  plugin.onInput(instance, instance.players[2].id, { choice: "t:0" });
  assert.strictEqual(instance.state.phase, "voting");
  settleByTimeout(instance);
  assert.strictEqual(instance.state.phase, "reveal");
  return instance;
}

describe("survive: scoring", () => {
  const EXACT: Record<number, { writer: number; quoted: number }> = {
    3: { writer: 700, quoted: 300 },
    4: { writer: 700, quoted: 300 },
    5: { writer: 525, quoted: 225 },
    6: { writer: 420, quoted: 180 },
  };

  test("a vote pays 700/300 exactly at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      const instance = scoreOneVote(count);
      assert.deepStrictEqual(
        instance.state.scores,
        [EXACT[count].writer, EXACT[count].quoted, ...new Array(count - 2).fill(0)],
        `${count}: per-vote totals`,
      );
      assert.strictEqual(instance.state.scores[0], 700, `${count}: writer share`);
      assert.strictEqual(instance.state.scores[1], 300, `${count}: quoted share`);
      assert.deepStrictEqual(instance.state.reveal?.[0], { twister: 0, author: 1, votes: 1 });
    }
  });

  test("5 and 6 players pay scalePayout(700, N) / scalePayout(300, N)", () => {
    for (const count of [5, 6]) {
      const instance = scoreOneVote(count);
      assert.strictEqual(instance.state.scores[0], scalePayout(700, count), `${count}: writer share`);
      assert.strictEqual(instance.state.scores[1], scalePayout(300, count), `${count}: quoted share`);
      assert.strictEqual(instance.state.scores[0], EXACT[count].writer, `${count}: pinned writer`);
      assert.strictEqual(instance.state.scores[1], EXACT[count].quoted, `${count}: pinned quoted`);
      assert.deepStrictEqual(
        instance.state.scores.slice(2),
        new Array(count - 2).fill(0),
        `${count}: nobody else scored`,
      );
    }
    assert.strictEqual(scalePayout(700, 5), 525);
    assert.strictEqual(scalePayout(300, 5), 225);
    assert.strictEqual(scalePayout(700, 6), 420);
    assert.strictEqual(scalePayout(300, 6), 180);
  });

  test("results publish standings plus the writer and quoted stats", () => {
    const instance = scoreOneVote(4);
    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings[0].playerId, "p0");
    assert.strictEqual(result.standings[0].raw, 700);
    assert.strictEqual(result.stats["p0:votesReceived"], 1);
    assert.strictEqual(result.stats["p1:quotedVotes"], 1);
    assert.strictEqual(result.stats["p2:votesReceived"], 0);
  });

  test("maximum single-round score stays within 1500 at every N from 3 to 6", () => {
    for (let count = 3; count <= 6; count++) {
      const instance = startPinned(count);
      submitAnswers(instance);
      submitTwists(instance);

      const focus = 0;
      const partner = instance.state.pairing[focus];
      const quotingPairing = instance.state.pairing.findIndex((author) => author === focus);

      // Every eligible voter backs the focus player's headline; the one voter
      // who cannot adds a vote to the pairing that quotes the focus player.
      for (let voter = 0; voter < count; voter++) {
        if (voter === focus) continue;
        const target = voter === partner ? quotingPairing : 0;
        plugin.onInput(instance, instance.players[voter].id, { choice: `t:${target}` });
      }
      settleByTimeout(instance);

      const writerPayout = scalePayout(700, count);
      const quotedPayout = scalePayout(300, count);
      const expected = (count - 2) * writerPayout + quotedPayout;
      assert.strictEqual(
        instance.state.scores[focus],
        Math.min(expected, MAX_ROUND_SCORE),
        `${count}: capped round gain`,
      );

      const max = Math.max(...instance.state.scores);
      assert.ok(max <= MAX_ROUND_SCORE, `${count}: ${max} exceeds ${MAX_ROUND_SCORE}`);
      assert.ok(withinRoundBound(max), `${count}: sanity helper rejected ${max}`);
      assert.strictEqual(instance.state.stats["p0:votesReceived"], count - 2, `${count}: writer votes`);
      assert.strictEqual(instance.state.stats["p0:quotedVotes"], 1, `${count}: quoted votes`);
    }
  });
});

describe("survive: reveal hooks and TV privacy", () => {
  test("waitingOn follows the answer, headline and vote phases", () => {
    const instance = startPinned(4);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(0, 4));

    submitAnswers(instance);
    assert.strictEqual(instance.state.phase, "twisting");
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(0, 4));

    plugin.onInput(instance, "p1", { text: "headline one" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana", "Cleo", "Dev"]);

    submitTwists(instance);
    assert.strictEqual(instance.state.phase, "voting");
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(0, 4));

    plugin.onInput(instance, "p1", { choice: "t:2" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana", "Cleo", "Dev"]);
  });

  test("the TV hides answers and headlines until the voting pairings go up", () => {
    const instance = startPinned(6);

    instance.players.forEach((player, i) => {
      plugin.onInput(instance, player.id, { text: `answer-secret-${i}` });
    });
    instance.players.forEach((player, i) => {
      if (i === 0) return;
      plugin.onInput(instance, player.id, { text: `headline-secret-${i}` });
    });

    assert.strictEqual(instance.state.phase, "twisting");
    const twisting = plugin.screenState(instance);
    assert.deepStrictEqual(twisting.pairs, [], "no pairings before the vote");
    assert.ok(!JSON.stringify(twisting).includes("answer-secret"), "answers must stay off the TV");
    assert.ok(!JSON.stringify(twisting).includes("headline-secret"), "headlines must stay off the TV");

    plugin.onInput(instance, "p0", { text: "headline-secret-0" });
    assert.strictEqual(instance.state.phase, "voting");
    const voting = plugin.screenState(instance);
    assert.strictEqual((voting.pairs as unknown[]).length, 6, "pairings are public for the vote");
    assert.ok(JSON.stringify(voting).includes("answer-secret"), "the vote needs the quoted answers");
    assert.ok(JSON.stringify(voting).includes("headline-secret"), "the vote needs the headlines");
  });

  test("the reveal publishes the sound, caption and a settled waiting list", () => {
    const instance = startPinned(5);
    submitAnswers(instance);
    submitTwists(instance);
    castVotes(instance);

    assert.strictEqual(instance.state.phase, "reveal");
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && (reveal.caption as string).length > 0);
    assert.deepStrictEqual(reveal.waitingOn, []);
    assert.ok(Array.isArray(reveal.reveal));
    assert.strictEqual((reveal.reveal as unknown[]).length, 5, "one reveal row per pairing");
  });
});
