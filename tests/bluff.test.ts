/**
 * Bluff: 3-8 player flow, scoring, content packs and TV privacy.
 *
 * The game is driven directly through its plugin interface so every rule is
 * pinned without a browser: the 9-option full table, the scaled per-fool
 * payout, fixed truth points, the reveal hooks and both content packs.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  answer: string;
  category: string;
}

interface BluffState {
  contentPack: string;
  prompts: Prompt[];
  currentPrompt: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  submissions: Record<string, string>;
  voteOrder: string[];
  votes: Record<string, string>;
  phaseTimerMs: number;
  scores: number[];
  lastResult: {
    prompt: string;
    realAnswer: string;
    answers: Array<{ id: string; text: string; author: string; votes: number }>;
  } | null;
  stats: Record<string, number>;
}

interface BluffInstance {
  roomId: string;
  players: TestPlayer[];
  state: BluffState;
}

interface BluffPlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number };
  onStart(room: unknown, players: TestPlayer[], options?: Record<string, unknown>): BluffInstance;
  onInput(instance: BluffInstance, playerId: string, input: unknown): void;
  onTick(instance: BluffInstance, deltaMs: number): void;
  screenState(instance: BluffInstance): Record<string, any>;
  controllerState(instance: BluffInstance, playerId: string): Record<string, any>;
  results?(instance: BluffInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const mod = (await import("../games/bluff/server.ts")) as { default: BluffPlugin };
const plugin = mod.default;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal"];
const REAL = "THE-REAL-ANSWER";
const TEST_PROMPT: Prompt = {
  text: "A test prompt with a blank _____.",
  answer: REAL,
  category: "Test",
};

const dictionary = JSON.parse(
  readFileSync(join(process.cwd(), "games/bluff/content/dictionary.json"), "utf8"),
) as Array<{ word: string; definition: string }>;

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
    gameId: "bluff",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/** Start with one deterministic prompt so assertions never depend on shuffle. */
function startControlled(count: number, options?: Record<string, unknown>): BluffInstance {
  const players = makePlayers(count);
  const instance = plugin.onStart(makeRoom(players), players, options);
  instance.state.prompts = [{ ...TEST_PROMPT }];
  instance.state.currentPrompt = 0;
  return instance;
}

function submitAll(instance: BluffInstance): void {
  for (const player of instance.players) {
    plugin.onInput(instance, player.id, { text: `fake answer from ${player.name}` });
  }
}

function castVotes(instance: BluffInstance, choiceFor: (playerId: string) => string): void {
  for (const player of instance.players) {
    plugin.onInput(instance, player.id, { choice: choiceFor(player.id) });
  }
}

function driveToFinish(instance: BluffInstance): void {
  let guard = 0;
  while (instance.state.phase !== "finished" && guard < 5000) {
    instance.players.forEach((player, index) => {
      const controller = plugin.controllerState(instance, player.id);
      if (controller.phase === "writing" && controller.hasSubmitted !== true) {
        plugin.onInput(instance, player.id, { text: `answer ${player.id} ${instance.state.currentPrompt}` });
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

describe("bluff: catalog and player range", () => {
  test("hard range is 3-8 and the manifest agrees", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);
    assert.strictEqual(GAME_CATALOG.bluff.minPlayers, 3);
    assert.strictEqual(GAME_CATALOG.bluff.maxPlayers, 8);
  });

  test("round counts: standalone 6, rumble 4, and 3 at 7+", () => {
    const timers = { write: 30, vote: 20, reveal: 6 };
    for (const n of [3, 4, 5, 6, 7, 8]) {
      assert.strictEqual(GAME_CATALOG.bluff.scale(n, "standalone").rounds, 6, `${n}: standalone rounds`);
      assert.deepStrictEqual(GAME_CATALOG.bluff.scale(n, "standalone").timers, timers);
    }
    for (const n of [3, 4, 5, 6]) {
      assert.strictEqual(GAME_CATALOG.bluff.scale(n, "rumble").rounds, 4, `${n}: rumble rounds`);
    }
    for (const n of [7, 8]) {
      assert.strictEqual(GAME_CATALOG.bluff.scale(n, "rumble").rounds, 3, `${n}: rumble rounds`);
    }
  });

  test("both content packs are declared", () => {
    assert.deepStrictEqual(
      [...GAME_CATALOG.bluff.contentPacks].sort(),
      ["Dictionary", "Facts"],
    );
  });
});

describe("bluff: full playthrough", () => {
  for (const count of [3, 8]) {
    test(`${count} players reaches finished with sane scores`, () => {
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
      assert.ok(result, "bluff must expose results()");
      assert.strictEqual(result.standings.length, count);
      for (const standing of result.standings) {
        assert.ok(Number.isFinite(standing.raw) && standing.raw >= 0);
        assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
      }
    });
  }
});

describe("bluff: eight-player round", () => {
  test("nine options, and no voter can pick their own fake", () => {
    const instance = startControlled(8);
    submitAll(instance);
    assert.strictEqual(instance.state.phase, "voting");
    assert.strictEqual(instance.state.voteOrder.length, 9, "8 fakes plus the real answer");
    assert.ok(instance.state.voteOrder.includes("real"));

    for (const player of instance.players) {
      const controller = plugin.controllerState(instance, player.id);
      const options = controller.options as Array<{ id: string }>;
      assert.strictEqual(options.length, 8, "a voter sees every option except their own");
      assert.ok(!options.some((option) => option.id === player.id), "own fake offered as a vote");
      plugin.onInput(instance, player.id, { choice: options[0].id });
    }

    const screen = plugin.screenState(instance);
    assert.strictEqual(screen.phase, "reveal");
    assert.strictEqual(screen.answers.length, 9, "the reveal shows every fake plus the truth");
    assert.strictEqual(screen.answers.filter((answer: { isReal: boolean }) => answer.isReal).length, 1);
    assert.strictEqual(screen.realAnswer, REAL);
  });
});

describe("bluff: scoring", () => {
  test("a fooled vote is exactly 200 at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      const instance = startControlled(count);
      submitAll(instance);
      castVotes(instance, (playerId) => (playerId === "p0" ? "real" : "p0"));

      assert.strictEqual(instance.state.phase, "reveal");
      assert.strictEqual(
        instance.state.scores[0] - 500,
        (count - 1) * 200,
        `${count}: every fool should pay 200`,
      );
    }
  });

  test("5+ players apply scalePayout(200, N)", () => {
    for (const count of [5, 6, 7, 8]) {
      const instance = startControlled(count);
      submitAll(instance);
      castVotes(instance, (playerId) => (playerId === "p0" ? "real" : "p0"));

      assert.strictEqual(instance.state.phase, "reveal");
      const expected = 500 + (count - 1) * scalePayout(200, count);
      assert.strictEqual(instance.state.scores[0], expected, `${count}: scaled fool payout`);
      assert.strictEqual(
        instance.state.scores[0] - 500,
        (count - 1) * scalePayout(200, count),
        `${count}: payout must be the scaled per-vote value`,
      );
    }
  });

  test("finding the truth always pays 500", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const instance = startControlled(count);
      submitAll(instance);
      castVotes(instance, () => "real");

      assert.strictEqual(instance.state.phase, "reveal");
      for (const score of instance.state.scores) {
        assert.strictEqual(score, 500, `${count}: truth points must stay fixed`);
      }
    }
  });

  test("maximum single-round score stays within 1500 at every N", () => {
    for (let count = 3; count <= 8; count++) {
      const max = 500 + (count - 1) * scalePayout(200, count);
      assert.ok(max <= MAX_ROUND_SCORE, `${count}: ${max} exceeds ${MAX_ROUND_SCORE}`);
      assert.ok(withinRoundBound(max), `${count}: sanity helper rejected ${max}`);
    }
  });

  test("results publish standings and the award stats", () => {
    const instance = startControlled(3);
    submitAll(instance);
    castVotes(instance, (playerId) => (playerId === "p0" ? "real" : "p0"));

    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings[0].playerId, "p0");
    assert.strictEqual(result.standings[0].raw, 900);
    assert.strictEqual(result.stats["p0:votes-fooled"], 2);
    assert.strictEqual(result.stats["p0:votesFooled"], 2);
    assert.strictEqual(result.stats["p0:truth-found"], 1);
    assert.strictEqual(result.stats["p0:correctVotes"], 1);
    assert.strictEqual(result.stats["p0:fakes-written"], 1);
  });
});

describe("bluff: TV privacy and reveal hooks", () => {
  test("writing and voting payloads hide fakes and the real answer", () => {
    const instance = startControlled(3);
    const writing = plugin.screenState(instance);
    assert.strictEqual(writing.phase, "writing");
    assert.strictEqual(writing.realAnswer, null);
    assert.deepStrictEqual(writing.answers, []);
    assert.ok(!JSON.stringify(writing).includes(REAL), "truth leaked while writing");

    submitAll(instance);
    const voting = plugin.screenState(instance);
    assert.strictEqual(voting.phase, "voting");
    assert.ok(!JSON.stringify(voting).includes("fake answer from"), "fakes leaked while voting");
    assert.ok(!JSON.stringify(voting).includes(REAL), "truth leaked while voting");
    assert.strictEqual(voting.realAnswer, null);

    castVotes(instance, () => "real");
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.phase, "reveal");
    assert.strictEqual(reveal.realAnswer, REAL);
    assert.ok(JSON.stringify(reveal).includes(REAL), "the truth must appear at reveal");
  });

  test("waitingOn, caption and sound describe the current beat", () => {
    const instance = startControlled(3);
    const writing = plugin.screenState(instance);
    assert.deepStrictEqual(writing.waitingOn, ["Ana", "Ben", "Cleo"]);
    assert.strictEqual(writing.sound, null);

    plugin.onInput(instance, "p0", { text: "one fake" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ben", "Cleo"]);

    submitAll(instance);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana", "Ben", "Cleo"]);

    // Ana's fake is the top fooler; Ana finds the truth.
    castVotes(instance, (playerId) => (playerId === "p0" ? "real" : "p0"));
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.phase, "reveal");
    assert.deepStrictEqual(reveal.waitingOn, []);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && reveal.caption.length > 0);
    assert.ok(reveal.caption.includes("Ana"), `caption should name the top fooler: ${reveal.caption}`);
    assert.ok(!reveal.caption.includes(REAL), "caption must never carry the real answer");
  });
});

describe("bluff: content packs", () => {
  test("dictionary pack starts a game and uses word then definition", () => {
    assert.ok(dictionary.length >= 60, `expected 60+ dictionary entries, found ${dictionary.length}`);
    const players = makePlayers(4);
    const instance = plugin.onStart(makeRoom(players), players, { contentPack: "dictionary" });

    assert.strictEqual(instance.state.contentPack, "dictionary");
    assert.strictEqual(instance.state.phase, "writing");
    const screen = plugin.screenState(instance);
    assert.strictEqual(screen.phase, "writing");
    assert.strictEqual(screen.category, "Dictionary");
    const word = String(screen.prompt);
    const entry = dictionary.find((candidate) => candidate.word === word);
    assert.ok(entry, `prompt ${word} is not a dictionary word`);

    submitAll(instance);
    castVotes(instance, () => "real");
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.realAnswer, entry.definition);
    const real = reveal.answers.find((answer: { isReal: boolean; text: string }) => answer.isReal);
    assert.strictEqual(real.text, entry.definition);
  });

  test("the default pack is facts", () => {
    const players = makePlayers(3);
    const instance = plugin.onStart(makeRoom(players), players);
    assert.strictEqual(instance.state.contentPack, "facts");
    assert.strictEqual(plugin.screenState(instance).category !== "Dictionary", true);
  });
});

describe("bluff: nine-answer reveal render", () => {
  test("two-column letter layout draws at 1080p and 720p", async () => {
    const instance = startControlled(8);
    submitAll(instance);
    for (const player of instance.players) {
      const options = plugin.controllerState(instance, player.id).options as Array<{ id: string }>;
      plugin.onInput(instance, player.id, { choice: options[0].id });
    }
    const screen = plugin.screenState(instance);
    assert.strictEqual(screen.answers.length, 9);

    const seen: string[] = [];
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
    const ctx = new Proxy(target, {
      get(obj, prop) {
        if (prop in obj) return obj[prop as string];
        return () => undefined;
      },
      set(obj, prop, value) {
        obj[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;

    const { renderBluff } = (await import("../games/bluff/screen.ts")) as {
      renderBluff: (context: CanvasRenderingContext2D, width: number, height: number, state: unknown) => void;
    };
    const originalNow = performance.now;
    let now = 1000;
    Object.defineProperty(performance, "now", { value: () => now, configurable: true });
    try {
      // First frame creates the title card; later frames draw the reveal.
      renderBluff(ctx, 1280, 720, screen);
      now = 8000;
      renderBluff(ctx, 1280, 720, screen);
      renderBluff(ctx, 1920, 1080, screen);
    } finally {
      Object.defineProperty(performance, "now", { value: originalNow, configurable: true });
    }

    for (const letter of ["A", "B", "C", "D", "E", "F", "G", "H", "I"]) {
      assert.ok(seen.includes(letter), `nine-answer grid must draw letter badge ${letter}`);
    }
  });
});
