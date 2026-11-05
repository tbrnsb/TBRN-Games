/**
 * Frankenanswers: 3-6 player flow.
 *
 * Pool dealing, server-composed answers, scaled scoring with the round bound,
 * the six-answer TV grid and the reveal hooks are pinned through the plugin
 * interface. Phones never send free text for the final answer: they send tile
 * ids only, and the server composes the text from those tiles.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, scalePayout, withinRoundBound } from "../shared/scoring.ts";
import { voteLayout } from "../shared/vote-options.ts";
import frankenanswersPlugin, {
  dealPools,
  composeAnswer,
  CONNECTORS,
  type FaTile,
} from "../games/frankenanswers/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface FaAnswer {
  author: number;
  text: string;
  chipIds: string[];
}

interface FaState {
  round: number;
  maxRounds: number;
  phase: "chips" | "build" | "vote" | "reveal" | "finished";
  prompt: string;
  tiles: FaTile[];
  submitted: number[];
  pools: string[][];
  build: Array<string[] | null>;
  answers: Array<FaAnswer | null>;
  votes: Array<string | null>;
  scores: number[];
  timerMs: number;
  reveal: { winners: number[]; rows: Array<{ text: string; author: number; votes: number }> } | null;
  stats: Record<string, number>;
}

interface FaInstance {
  roomId: string;
  players: TestPlayer[];
  state: FaState;
}

interface FaController {
  mode: string;
  controllerType: string;
  options: Array<{ id: string; label: string }>;
  rank?: { items: Array<{ id: string; label: string }>; min: number; max: number };
  hasSubmitted?: boolean;
  hasVoted?: boolean;
  info?: string;
}

interface FaPlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; description: string };
  onStart(room: unknown, players: TestPlayer[]): FaInstance;
  onInput(instance: FaInstance, playerId: string, input: unknown): void;
  onTick(instance: FaInstance, deltaMs: number): void;
  screenState(instance: FaInstance): Record<string, any>;
  controllerState(instance: FaInstance, playerId: string): FaController;
  results?(instance: FaInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const plugin = frankenanswersPlugin as unknown as FaPlugin;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay"];
const pack = Array.from({ length: 40 }, (_, i) => ({ id: `pack_${i}`, text: `packword${i}`, author: -1 }));

function chipsFor(players: number): FaTile[] {
  const tiles: FaTile[] = [];
  for (let p = 0; p < players; p++) {
    for (let k = 0; k < 3; k++) tiles.push({ id: `c:${p}:${k}`, text: `p${p}word${k}`, author: p });
  }
  return tiles;
}

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
    gameId: "frankenanswers",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

function startGame(count: number): FaInstance {
  const players = makePlayers(count);
  return plugin.onStart(makeRoom(players), players);
}

function submitChips(instance: FaInstance, prefix = "chip"): void {
  instance.players.forEach((player, p) => {
    for (let k = 0; k < 3; k++) plugin.onInput(instance, player.id, { text: `${prefix}-${p}-${k}` });
  });
}

function chipIdsOf(instance: FaInstance, playerIndex: number): string[] {
  const controller = plugin.controllerState(instance, instance.players[playerIndex].id);
  return (controller.rank?.items ?? []).map((item) => item.id).filter((id) => !id.startsWith("k:"));
}

/** Submit the first three foreign chips from a player's own pool. */
function buildFirst(instance: FaInstance, playerIndex: number): string[] {
  const order = chipIdsOf(instance, playerIndex).slice(0, 3);
  plugin.onInput(instance, instance.players[playerIndex].id, { rank: { order } });
  return order;
}

function submitBuilds(instance: FaInstance): void {
  instance.players.forEach((_, p) => {
    if (instance.state.answers[p] === null) buildFirst(instance, p);
  });
}

function castVotes(
  instance: FaInstance,
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

function release(instance: FaInstance): void {
  instance.state.timerMs = 0;
  plugin.onTick(instance, 500);
}

function driveToFinish(instance: FaInstance): void {
  let guard = 0;
  while (instance.state.phase !== "finished" && guard < 5000) {
    const state = instance.state;
    if (state.phase === "chips") {
      submitChips(instance);
    } else if (state.phase === "build") {
      submitBuilds(instance);
    } else if (state.phase === "vote") {
      castVotes(instance, (voter, options) => options[voter % options.length]?.id);
    } else if (state.phase === "reveal") {
      release(instance);
    } else {
      break;
    }
    guard++;
  }
}

describe("frankenanswers: pool dealing and composition", () => {
  test("no player is ever dealt one of their own chips", () => {
    const tiles = [...chipsFor(4), ...pack];
    const pools = dealPools(tiles, 4);
    for (let p = 0; p < 4; p++) {
      const own = pools[p].filter((id) => tiles.find((t) => t.id === id)?.author === p);
      assert.deepStrictEqual(own, [], `player ${p} was dealt their own chip`);
      assert.strictEqual(pools[p].length, 10, "6 chips plus 4 connectors");
    }
  });

  test("a six-player pool tops up from the pack when foreign chips run short", () => {
    const pools = dealPools([...chipsFor(1), ...pack], 6);
    for (const pool of pools) {
      const chipIds = pool.filter((id) => !CONNECTORS.some((c) => c.id === id));
      assert.strictEqual(chipIds.length, 6);
    }
    // Seat 0 wrote the only player chips, so their pool is all pack chips.
    const own = pools[0].filter((id) => chipsFor(1).some((tile) => tile.id === id));
    assert.deepStrictEqual(own, [], "seat 0 was dealt a chip of their own");
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

  test("a phone only ever sees its own pool, and the screen sees none", () => {
    const instance = startGame(3);
    submitChips(instance);
    assert.strictEqual(instance.state.phase, "build");

    const screenJson = JSON.stringify(plugin.screenState(instance));
    assert.ok(!screenJson.includes("c:0:0"), "chip ids must not reach the screen");

    for (let p = 0; p < 3; p++) {
      const controller = plugin.controllerState(instance, instance.players[p].id);
      const ids = (controller.rank?.items ?? []).map((item) => item.id);
      assert.ok(ids.every((id) => instance.state.pools[p].includes(id)), `player ${p} sees a tile outside their pool`);
      assert.ok(!ids.includes(`c:${p}:0`), `player ${p} sees their own chip`);
    }
  });
});

describe("frankenanswers: catalog and player range", () => {
  test("hard range is 3-6, ideal 4-6, and the manifest agrees", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 6);

    const entry = GAME_CATALOG.frankenanswers;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 6);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 6);
  });

  test("standalone runs three rounds, rumble two, and the pool stays 6 chips + 4 links", () => {
    for (const count of [3, 4, 5, 6]) {
      const standalone = GAME_CATALOG.frankenanswers.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 3, `${count}: standalone rounds`);
      assert.deepStrictEqual(
        standalone.timers,
        { chips: 60, build: 90, vote: 25, reveal: 9 },
        `${count}: timers changed`,
      );
      assert.strictEqual(standalone.optionCaps?.chips, 6, `${count}: foreign chip pool`);
      assert.strictEqual(standalone.optionCaps?.connectors, CONNECTORS.length, `${count}: connectors`);
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one voting slot per answer`);

      const rumble = GAME_CATALOG.frankenanswers.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 2, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
      assert.deepStrictEqual(rumble.optionCaps, standalone.optionCaps, `${count}: rumble caps changed`);
    }
  });

  test("the game starts on the standalone round count", () => {
    assert.strictEqual(startGame(6).state.maxRounds, 3);
  });
});

describe("frankenanswers: server-composed answers", () => {
  test("the server composes the text from tile ids and ignores phone-supplied text", () => {
    const instance = startGame(3);
    submitChips(instance, "word");
    assert.strictEqual(instance.state.phase, "build");

    // Seat 2's chips are in both seat 0's and seat 1's pools.
    const order = ["c:2:0", "c:2:1", "c:2:2"];
    plugin.onInput(instance, "p0", { rank: { order }, text: "PWNED by seat 0" });
    plugin.onInput(instance, "p1", { rank: { order }, text: "PWNED by seat 1" });

    const first = instance.state.answers[0];
    const second = instance.state.answers[1];
    assert.ok(first && second);
    assert.strictEqual(first.text, "word-2-0 word-2-1 word-2-2");
    assert.strictEqual(second.text, first.text, "both authors get the same server-composed text");
    assert.deepStrictEqual(first.chipIds, order);
    assert.deepStrictEqual(second.chipIds, order);

    const stateJson = JSON.stringify(instance.state);
    assert.ok(!stateJson.includes("PWNED"), "phone text can never reach the final answer");
    assert.ok(
      !JSON.stringify(plugin.screenState(instance)).includes("word-2-0"),
      "composed answers stay off the TV before the vote",
    );
  });

  test("a text payload without chip ids cannot submit an answer", () => {
    const instance = startGame(3);
    submitChips(instance);
    assert.strictEqual(instance.state.phase, "build");

    plugin.onInput(instance, "p0", { text: "free text answer" });
    assert.strictEqual(instance.state.answers[0], null);
    assert.strictEqual(instance.state.phase, "build");
  });
});

describe("frankenanswers: scoring", () => {
  const EXACT: Record<number, { vote: number; chip: number }> = {
    3: { vote: 1000, chip: 100 },
    4: { vote: 1000, chip: 100 },
    5: { vote: 750, chip: 75 },
    6: { vote: 600, chip: 60 },
  };

  /** One vote for answer 0; answer 0 borrows seat 1's three chips. */
  function scoreOneVote(count: number): FaInstance {
    const instance = startGame(count);
    submitChips(instance);
    plugin.onInput(instance, "p0", { rank: { order: ["c:1:0", "c:1:1", "c:1:2"] } });
    for (let p = 1; p < count; p++) buildFirst(instance, p);
    assert.strictEqual(instance.state.phase, "vote");

    plugin.onInput(instance, "p2", { choice: "a0" });
    release(instance);
    assert.strictEqual(instance.state.phase, "reveal");
    return instance;
  }

  test("a vote pays 1000 and each borrowed chip 100 exactly at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      const instance = scoreOneVote(count);
      assert.strictEqual(instance.state.scores[0], EXACT[count].vote, `${count}: vote payout`);
      assert.strictEqual(instance.state.scores[1], 3 * EXACT[count].chip, `${count}: three borrowed chips`);
      assert.deepStrictEqual(
        instance.state.scores.slice(2),
        new Array(count - 2).fill(0),
        `${count}: nobody else scored`,
      );
    }
  });

  test("5 and 6 players pay scalePayout(1000, N) per vote and scalePayout(100, N) per chip", () => {
    for (const count of [5, 6]) {
      const instance = scoreOneVote(count);
      assert.strictEqual(instance.state.scores[0], scalePayout(1000, count), `${count}: vote payout`);
      assert.strictEqual(instance.state.scores[1], 3 * scalePayout(100, count), `${count}: borrowed chips`);
      assert.strictEqual(instance.state.scores[0], EXACT[count].vote, `${count}: pinned vote payout`);
      assert.strictEqual(instance.state.scores[1], 3 * EXACT[count].chip, `${count}: pinned chip payout`);
    }
    assert.strictEqual(scalePayout(1000, 5), 750);
    assert.strictEqual(scalePayout(100, 5), 75);
    assert.strictEqual(scalePayout(1000, 6), 600);
    assert.strictEqual(scalePayout(100, 6), 60);
  });

  /** All N-1 eligible voters back seat 0's answer, which borrows seat 1's chips. */
  function stackedRound(count: number): FaInstance {
    const instance = startGame(count);
    submitChips(instance);
    plugin.onInput(instance, "p0", { rank: { order: ["c:1:0", "c:1:1", "c:1:2"] } });
    for (let p = 1; p < count; p++) buildFirst(instance, p);
    assert.strictEqual(instance.state.phase, "vote", `${count}: ballot open`);

    // Every eligible voter backs seat 0's answer: N-1 votes, all on one answer.
    for (let voter = 1; voter < count; voter++) {
      plugin.onInput(instance, instance.players[voter].id, { choice: "a0" });
    }
    // Seat 0 cannot vote for their own answer, so the clock closes the ballot.
    release(instance);
    assert.strictEqual(instance.state.phase, "reveal", `${count}: ballot closed`);
    return instance;
  }

  test("3 and 4 players keep the uncapped stacked total", () => {
    for (const count of [3, 4]) {
      const instance = stackedRound(count);
      const uncapped = (count - 1) * scalePayout(1000, count);
      assert.strictEqual(uncapped, count === 3 ? 2000 : 3000, `${count}: old formula`);
      assert.strictEqual(instance.state.scores[0], uncapped, `${count}: uncapped round gain`);
      assert.ok(
        instance.state.scores[0] > MAX_ROUND_SCORE,
        `${count}: 3-4 parity beats the literal 1500 bound`,
      );
      assert.strictEqual(instance.state.stats["p0:votesReceived"], count - 1, `${count}: votes received`);
      assert.strictEqual(instance.state.stats["p1:chipsBorrowed"], 3, `${count}: borrowed chips`);
    }
  });

  test("the cap binds only from five players", () => {
    for (const count of [5, 6]) {
      const instance = stackedRound(count);
      assert.ok(
        (count - 1) * scalePayout(1000, count) > MAX_ROUND_SCORE,
        `${count}: stacked formula should exceed the bound`,
      );
      assert.strictEqual(instance.state.scores[0], MAX_ROUND_SCORE, `${count}: capped round gain`);
      const max = Math.max(...instance.state.scores);
      assert.ok(max <= MAX_ROUND_SCORE, `${count}: ${max} exceeds ${MAX_ROUND_SCORE}`);
      assert.ok(withinRoundBound(max), `${count}: sanity helper rejected ${max}`);
      assert.strictEqual(instance.state.stats["p0:votesReceived"], count - 1, `${count}: votes received`);
      assert.strictEqual(instance.state.stats["p1:chipsBorrowed"], 3, `${count}: borrowed chips`);
    }
  });

  test("results publish standings plus the votes and borrowed-chip stats", () => {
    const instance = scoreOneVote(4);
    const result = plugin.results?.(instance);
    assert.ok(result, "frankenanswers must expose results()");
    assert.strictEqual(result.standings[0].playerId, "p0");
    assert.strictEqual(result.standings[0].raw, 1000);
    assert.strictEqual(result.stats["p0:votesReceived"], 1);
    assert.strictEqual(result.stats["p1:chipsBorrowed"], 3);
    assert.strictEqual(result.stats["p1:votesReceived"], 0);
  });

  test("scripted round: build, vote, and chip authors get credit", () => {
    const instance = startGame(3);
    submitChips(instance);

    for (let p = 0; p < 3; p++) buildFirst(instance, p);
    assert.strictEqual(instance.state.phase, "vote");
    assert.ok(instance.state.answers.every((answer) => answer && answer.chipIds.length === 3));

    plugin.onInput(instance, "p0", { choice: "a1" });
    plugin.onInput(instance, "p1", { choice: "a0" });
    plugin.onInput(instance, "p2", { choice: "a0" });

    assert.strictEqual(instance.state.phase, "reveal");
    assert.strictEqual(instance.state.scores[0], 2000, "author of the two-vote answer scores 1000 per vote");

    // Chip credit is 100 per chip of that answer, paid to whoever wrote them.
    const winner = instance.state.answers[0];
    assert.ok(winner);
    const expected = winner.chipIds.reduce((sum, id) => {
      const tile = instance.state.tiles.find((item) => item.id === id);
      return sum + (tile && tile.author >= 0 ? 100 : 0);
    }, 0);
    assert.strictEqual(expected, 300, "the winning answer used three player chips");
    assert.ok(instance.state.scores[1] >= 300, "chip authors earn 100 per chip used");
  });
});

describe("frankenanswers: full playthrough", () => {
  for (const count of [3, 6]) {
    test(`${count} players reaches finished with sane scores and results`, () => {
      const instance = startGame(count);
      driveToFinish(instance);

      assert.strictEqual(instance.state.phase, "finished");
      assert.strictEqual(instance.state.scores.length, count);
      // 3-4 players keep the old uncapped per-round formula; the 1500 bound
      // only applies from five players up.
      const perRoundCeiling = count >= 5
        ? MAX_ROUND_SCORE
        : (count - 1) * scalePayout(1000, count) + count * 4 * scalePayout(100, count);
      for (const score of instance.state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, `bad score ${score}`);
        assert.ok(
          score <= perRoundCeiling * instance.state.maxRounds,
          `score ${score} out of bounds`,
        );
      }

      const screen = plugin.screenState(instance);
      assert.strictEqual(screen.finished, true);
      assert.strictEqual(screen.playerCount, count);
      assert.strictEqual((screen.scores as unknown[]).length, count);

      const result = plugin.results?.(instance);
      assert.ok(result, "frankenanswers must expose results()");
      assert.strictEqual(result.standings.length, count);
      for (const standing of result.standings) {
        assert.ok(Number.isFinite(standing.raw) && standing.raw >= 0);
        assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
      }
      for (const player of instance.players) {
        assert.strictEqual(typeof result.stats[`${player.id}:votesReceived`], "number");
        assert.strictEqual(typeof result.stats[`${player.id}:chipsBorrowed`], "number");
      }
    });
  }
});

describe("frankenanswers: six-player flow and TV reveal", () => {
  test("at six players there are six answers and five voting options per phone", () => {
    const instance = startGame(6);
    submitChips(instance);
    submitBuilds(instance);
    assert.strictEqual(instance.state.phase, "vote");

    const screen = plugin.screenState(instance);
    assert.strictEqual((screen.options as unknown[]).length, 6, "six composed answers on the TV");

    for (let p = 0; p < 6; p++) {
      const controller = plugin.controllerState(instance, instance.players[p].id);
      const ids = controller.options.map((option) => option.id);
      assert.strictEqual(ids.length, 5, `seat ${p} should see N-1 = 5 options`);
      assert.ok(!ids.includes(`a${p}`), `seat ${p} must not vote for their own answer`);
    }

    for (const answer of instance.state.answers) {
      assert.ok(answer);
      assert.ok(answer.chipIds.length >= 3 && answer.chipIds.length <= 4);
    }
  });

  test("the chip picker still enforces 3-4 chips and at most 2 links", () => {
    const instance = startGame(6);
    submitChips(instance);

    const controller = plugin.controllerState(instance, "p0");
    const items = controller.rank?.items ?? [];
    const chips = items.map((item) => item.id).filter((id) => !id.startsWith("k:"));
    const links = items.map((item) => item.id).filter((id) => id.startsWith("k:"));
    assert.strictEqual(chips.length, 6, "six foreign chips");
    assert.strictEqual(links.length, 4, "four connectors");
    assert.strictEqual(controller.rank?.min, 3);
    assert.strictEqual(controller.rank?.max, 6);

    plugin.onInput(instance, "p0", { rank: { order: chips.slice(0, 5) } });
    assert.strictEqual(instance.state.answers[0], null, "five chips are rejected");

    plugin.onInput(instance, "p0", { rank: { order: [chips[0], links[0], links[1], links[2]] } });
    assert.strictEqual(instance.state.answers[0], null, "three links are rejected");

    plugin.onInput(instance, "p0", {
      rank: { order: [chips[0], links[0], chips[1], links[1], chips[2]] },
    });
    const answer = instance.state.answers[0] as FaAnswer | null;
    assert.ok(answer, "three chips plus two links are accepted");
    assert.strictEqual(answer.chipIds.length, 3);
  });

  test("six answers switch the TV reveal to a two-column readable grid", () => {
    const instance = startGame(6);
    submitChips(instance);
    submitBuilds(instance);
    castVotes(instance);
    assert.strictEqual(instance.state.phase, "reveal");

    const screen = plugin.screenState(instance);
    const options = screen.options as Array<{ id: string; text: string; author: number; votes: number }>;
    assert.strictEqual(options.length, 6);
    assert.strictEqual(screen.optionColumns, 2);

    const layout = voteLayout(options.length, { minColumns: screen.optionColumns });
    assert.strictEqual(layout.columns, 2, "six long answers use two columns");
    assert.strictEqual(layout.letters.length, 6);
    assert.strictEqual(layout.letters[5], "F");
    assert.ok(layout.minFontPx >= 36, "two-column type stays readable");
    assert.ok(layout.maxFontPx >= layout.minFontPx);

    options.forEach((option, index) => {
      assert.strictEqual(option.author, index, "authors are revealed with the answers");
      assert.ok(option.text.length > 0);
    });

    const three = startGame(3);
    submitChips(three);
    submitBuilds(three);
    assert.strictEqual(plugin.screenState(three).optionColumns, 1, "three answers stay one column");
    assert.strictEqual(voteLayout(3, { minColumns: 1 }).columns, 1);
  });
});

describe("frankenanswers: reveal hooks and TV privacy", () => {
  test("waitingOn follows the chip, build and vote phases", () => {
    const instance = startGame(3);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(0, 3));

    for (let k = 0; k < 3; k++) plugin.onInput(instance, "p0", { text: `ana${k}` });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ben", "Cleo"]);

    submitChips(instance);
    assert.strictEqual(instance.state.phase, "build");
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(0, 3));

    buildFirst(instance, 1);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana", "Cleo"]);

    submitBuilds(instance);
    assert.strictEqual(instance.state.phase, "vote");
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(0, 3));

    plugin.onInput(instance, "p1", { choice: "a0" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana", "Cleo"]);
  });

  test("the TV hides composed answers until the vote and authors until the reveal", () => {
    const instance = startGame(4);
    submitChips(instance, "secret");

    const building = plugin.screenState(instance);
    assert.deepStrictEqual(building.options, [], "no answers before the vote");
    assert.ok(!JSON.stringify(building).includes("secret"), "chips stay off the TV");

    submitBuilds(instance);
    const voting = plugin.screenState(instance);
    assert.strictEqual((voting.options as Array<{ author: number }>).length, 4);
    assert.ok(
      (voting.options as Array<{ author: number }>).every((option) => option.author === -1),
      "authors stay hidden until the reveal",
    );

    castVotes(instance);
    const reveal = plugin.screenState(instance);
    assert.ok(
      (reveal.options as Array<{ author: number }>).every((option) => option.author >= 0),
      "authors are published at the reveal",
    );
  });

  test("the reveal publishes the sound, caption and a settled waiting list", () => {
    const instance = startGame(5);
    submitChips(instance);
    submitBuilds(instance);
    castVotes(instance);

    assert.strictEqual(instance.state.phase, "reveal");
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && (reveal.caption as string).length > 0);
    assert.deepStrictEqual(reveal.waitingOn, []);
    const revealed = reveal.reveal as { winners: number[]; rows: unknown[] };
    assert.ok(revealed && Array.isArray(revealed.rows));
    assert.strictEqual(revealed.rows.length, 5, "one reveal row per answer");
  });
});
