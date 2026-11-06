/**
 * Write & Vote: 3-8 player flow, scaled scoring, vote changes and TV privacy.
 *
 * The game is driven through its plugin interface so every rule is pinned
 * without a browser: the 3-8 range, 100-per-vote at small tables, the scaled
 * payout at a full table, changeable votes before the lock, the two-column
 * reveal grid, and the reveal/result hooks.
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

interface Prompt {
  text: string;
  category: string;
}

interface WriteVoteState {
  prompts: Prompt[];
  currentPrompt: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  responses: Record<string, string>;
  voteOrder: string[];
  votes: Record<string, string>;
  phaseTimerMs: number;
  scores: number[];
  lastResult: {
    prompt: string;
    responses: Array<{ id: string; text: string; author: string; votes: number }>;
  } | null;
  stats: Record<string, number>;
}

interface WriteVoteInstance {
  roomId: string;
  players: TestPlayer[];
  state: WriteVoteState;
}

interface WriteVotePlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number };
  onStart(room: unknown, players: TestPlayer[]): WriteVoteInstance;
  onInput(instance: WriteVoteInstance, playerId: string, input: unknown): void;
  onTick(instance: WriteVoteInstance, deltaMs: number): void;
  screenState(instance: WriteVoteInstance): Record<string, any>;
  controllerState(instance: WriteVoteInstance, playerId: string): Record<string, any>;
  results?(instance: WriteVoteInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const mod = (await import("../games/writevote/server.ts")) as { default: WriteVotePlugin };
const plugin = mod.default;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal"];
const TEST_PROMPT: Prompt = { text: "A test prompt for the round.", category: "Test" };

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
    gameId: "writevote",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/** Start with one deterministic prompt so assertions never depend on shuffle. */
function startControlled(count: number): WriteVoteInstance {
  const players = makePlayers(count);
  const instance = plugin.onStart(makeRoom(players), players);
  instance.state.prompts = [{ ...TEST_PROMPT }];
  instance.state.currentPrompt = 0;
  return instance;
}

function submitAll(instance: WriteVoteInstance): void {
  for (const player of instance.players) {
    plugin.onInput(instance, player.id, { text: `response from ${player.name}` });
  }
}

function castVotes(instance: WriteVoteInstance, choiceFor: (playerId: string) => string): void {
  for (const player of instance.players) {
    plugin.onInput(instance, player.id, { choice: choiceFor(player.id) });
  }
}

function driveToFinish(instance: WriteVoteInstance): void {
  let guard = 0;
  while (instance.state.phase !== "finished" && guard < 5000) {
    instance.players.forEach((player, index) => {
      const controller = plugin.controllerState(instance, player.id);
      if (controller.phase === "writing" && controller.hasSubmitted !== true) {
        plugin.onInput(instance, player.id, { text: `answer ${player.id} round ${instance.state.currentPrompt}` });
      } else if (controller.phase === "voting" && controller.hasVoted !== true) {
        const options = (controller.options ?? []) as Array<{ id: string }>;
        if (options.length > 0) {
          plugin.onInput(instance, player.id, {
            choice: options[(guard + index) % options.length].id,
          });
        }
      }
    });
    plugin.onTick(instance, 500);
    guard++;
  }
}

describe("writevote: catalog and player range", () => {
  test("hard range is 3-8 and the manifest agrees", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);
    assert.strictEqual(GAME_CATALOG.writevote.minPlayers, 3);
    assert.strictEqual(GAME_CATALOG.writevote.maxPlayers, 8);
    assert.strictEqual(GAME_CATALOG.writevote.idealMin, 4);
    assert.strictEqual(GAME_CATALOG.writevote.idealMax, 8);
  });

  test("round counts: standalone 5, rumble 3, timers unchanged", () => {
    for (let count = 3; count <= 8; count++) {
      const standalone = GAME_CATALOG.writevote.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 5, `${count}: standalone rounds`);
      assert.deepStrictEqual(standalone.timers, { write: 45, vote: 20, reveal: 6 });

      const rumble = GAME_CATALOG.writevote.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 3, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, { write: 45, vote: 20, reveal: 6 });
    }
  });
});

describe("writevote: full playthrough", () => {
  for (const count of [3, 8]) {
    test(`${count} players reaches finished with sane scores and results`, () => {
      const players = makePlayers(count);
      const instance = plugin.onStart(makeRoom(players), players);
      driveToFinish(instance);

      assert.strictEqual(instance.state.phase, "finished");
      const screen = plugin.screenState(instance);
      assert.strictEqual(screen.finished, true);
      assert.strictEqual(instance.state.scores.length, count);
      for (const score of instance.state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, `bad score ${score}`);
      }

      const result = plugin.results?.(instance);
      assert.ok(result, "writevote must expose results()");
      assert.strictEqual(result.standings.length, count);
      for (const standing of result.standings) {
        assert.ok(Number.isFinite(standing.raw) && standing.raw >= 0);
        assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
      }
      assert.strictEqual(typeof result.stats["p0:votesReceived"], "number");
      assert.strictEqual(typeof result.stats["p0:wordsWritten"], "number");
    });
  }
});

describe("writevote: scoring", () => {
  test("a received vote is exactly 100 at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      const instance = startControlled(count);
      submitAll(instance);
      // Everyone except the author votes for Ana's response.
      castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));

      assert.strictEqual(instance.state.phase, "reveal");
      assert.strictEqual(instance.state.scores[0], (count - 1) * 100, `${count}: unscaled vote payout`);
      assert.strictEqual(
        instance.state.scores[0] / (count - 1),
        100,
        `${count}: each vote must be worth exactly 100`,
      );
    }
  });

  test("5+ players apply scalePayout(100, N)", () => {
    for (const count of [5, 6, 7, 8]) {
      const instance = startControlled(count);
      submitAll(instance);
      castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));

      assert.strictEqual(instance.state.phase, "reveal");
      const expected = (count - 1) * scalePayout(100, count);
      assert.strictEqual(instance.state.scores[0], expected, `${count}: scaled vote payout`);
    }
    assert.strictEqual(scalePayout(100, 8), 43);
  });

  test("maximum single-round score stays within 1500 at every N", () => {
    for (let count = 3; count <= 8; count++) {
      const instance = startControlled(count);
      submitAll(instance);
      // Ana takes every other player's vote; her own vote goes elsewhere.
      castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));

      const max = instance.state.scores[0];
      assert.strictEqual(max, (count - 1) * scalePayout(100, count), `${count}: max round score`);
      assert.ok(max <= MAX_ROUND_SCORE, `${count}: ${max} exceeds ${MAX_ROUND_SCORE}`);
      assert.ok(withinRoundBound(max), `${count}: sanity helper rejected ${max}`);
    }
  });

  test("results publish standings and award stats", () => {
    const instance = startControlled(3);
    submitAll(instance);
    castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));

    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings[0].playerId, "p0");
    assert.strictEqual(result.standings[0].raw, 200);
    assert.strictEqual(result.stats["p0:votesReceived"], 2);
    assert.strictEqual(result.stats["p0:wordsWritten"], 1);
  });
});

describe("writevote: changing a vote", () => {
  test("a later pick replaces the earlier one and stays one vote", () => {
    const instance = startControlled(4);
    submitAll(instance);
    assert.strictEqual(instance.state.phase, "voting");

    plugin.onInput(instance, "p0", { choice: "p1" });
    assert.strictEqual(instance.state.votes.p0, "p1");
    assert.strictEqual(Object.keys(instance.state.votes).length, 1);

    plugin.onInput(instance, "p0", { choice: "p2" });
    assert.strictEqual(instance.state.votes.p0, "p2", "the later choice must replace the earlier one");
    assert.strictEqual(Object.keys(instance.state.votes).length, 1, "a change must not add a second vote");

    const controller = plugin.controllerState(instance, "p0");
    assert.strictEqual(controller.hasVoted, true);
    assert.strictEqual(controller.canChangeVote, true, "the ballot stays open until everyone has voted");
  });

  test("votes cannot change once the ballot is locked", () => {
    const instance = startControlled(3);
    submitAll(instance);
    castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));
    assert.strictEqual(instance.state.phase, "reveal");
    assert.strictEqual(instance.state.votes.p0, "p1");

    plugin.onInput(instance, "p0", { choice: "p2" });
    assert.strictEqual(instance.state.votes.p0, "p1", "a locked ballot must ignore the late pick");
  });

  test("the server clock ending closes the ballot", () => {
    const instance = startControlled(3);
    submitAll(instance);
    assert.strictEqual(instance.state.phase, "voting");

    plugin.onInput(instance, "p2", { choice: "p0" });
    instance.state.phaseTimerMs = 0;
    plugin.onInput(instance, "p0", { choice: "p1" });
    assert.strictEqual(instance.state.votes.p0, undefined, "no vote may land after the clock ends");
    plugin.onInput(instance, "p1", { choice: "p0" });
    assert.strictEqual(instance.state.votes.p1, undefined, "the clock closes the ballot for everyone");

    // The tick that expires the ballot still scores the votes already cast.
    plugin.onTick(instance, 500);
    assert.strictEqual(instance.state.phase, "reveal");
    assert.strictEqual(instance.state.scores[0], 100, "the vote cast before the lock still scores");
  });
});

describe("writevote: own answer and TV privacy", () => {
  test("a player is never offered their own response and cannot vote for it", () => {
    const instance = startControlled(8);
    submitAll(instance);
    assert.strictEqual(instance.state.phase, "voting");

    for (const player of instance.players) {
      const options = plugin.controllerState(instance, player.id).options as Array<{ id: string }>;
      assert.strictEqual(options.length, instance.players.length - 1);
      assert.ok(!options.some((option) => option.id === player.id), `${player.name} was offered their own answer`);
    }

    plugin.onInput(instance, "p0", { choice: "p0" });
    assert.strictEqual(instance.state.votes.p0, undefined, "voting for your own answer must be ignored");
  });

  test("unrevealed answers never reach the TV payload", () => {
    const instance = startControlled(3);
    const writing = plugin.screenState(instance);
    assert.strictEqual(writing.phase, "writing");
    assert.deepStrictEqual(writing.responses, []);
    assert.strictEqual(writing.caption, null);
    assert.ok(!JSON.stringify(writing).includes("response from"), "answers leaked while writing");

    submitAll(instance);
    const voting = plugin.screenState(instance);
    assert.strictEqual(voting.phase, "voting");
    assert.deepStrictEqual(voting.responses, []);
    assert.ok(!JSON.stringify(voting).includes("response from"), "answers leaked while voting");
    assert.strictEqual(voting.caption, null);

    castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.phase, "reveal");
    assert.strictEqual(reveal.responses.length, 3);
    assert.ok(JSON.stringify(reveal).includes("response from"), "the reveal must show the answers");
  });

  test("waitingOn, caption and sound describe the current beat", () => {
    const instance = startControlled(3);
    const writing = plugin.screenState(instance);
    assert.deepStrictEqual(writing.waitingOn, ["Ana", "Ben", "Cleo"]);
    assert.strictEqual(writing.sound, null);

    plugin.onInput(instance, "p0", { text: "first answer" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ben", "Cleo"]);

    submitAll(instance);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana", "Ben", "Cleo"]);

    // Ana's answer is the top vote-getter.
    castVotes(instance, (playerId) => (playerId === "p0" ? "p1" : "p0"));
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.phase, "reveal");
    assert.deepStrictEqual(reveal.waitingOn, []);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && reveal.caption.length > 0);
    assert.ok(reveal.caption.includes("Ana"), `caption should name the top vote-getter: ${reveal.caption}`);
    assert.ok(!reveal.caption.includes("response from"), "caption must never carry an answer");
  });
});

/** Recording 2D context: every canvas method is a no-op except fillText. */
function makeContext(seen: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    measureText: (text: unknown) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    fillText: (text: unknown) => {
      seen.push(String(text));
    },
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

describe("writevote: reveal grid render", () => {
  test("six and eight answers draw letter badges at 1080p and 720p", async () => {
    const { renderWritevote } = (await import("../games/writevote/screen.ts")) as {
      renderWritevote: (context: CanvasRenderingContext2D, width: number, height: number, state: unknown) => void;
    };
    const originalNow = performance.now;
    let now = 1000;
    Object.defineProperty(performance, "now", { value: () => now, configurable: true });
    try {
      for (const count of [6, 8]) {
        const instance = startControlled(count);
        submitAll(instance);
        for (const player of instance.players) {
          const options = plugin.controllerState(instance, player.id).options as Array<{ id: string }>;
          plugin.onInput(instance, player.id, { choice: options[0].id });
        }
        const screen = plugin.screenState(instance);
        assert.strictEqual(screen.phase, "reveal");
        assert.strictEqual(screen.responses.length, count);

        const seen: string[] = [];
        const ctx = makeContext(seen);
        // First frame at 720p may draw the title card; the later frames draw
        // the reveal, and the 1080p frame proves the same layout scales up.
        renderWritevote(ctx, 1280, 720, screen);
        now += 2000;
        renderWritevote(ctx, 1280, 720, screen);
        renderWritevote(ctx, 1920, 1080, screen);

        for (const letter of "ABCDEFGH".slice(0, count)) {
          assert.ok(seen.includes(letter), `${count}-answer grid must draw letter badge ${letter}`);
        }
      }
    } finally {
      Object.defineProperty(performance, "now", { value: originalNow, configurable: true });
    }
  });
});
