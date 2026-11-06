/**
 * Blather Round: 3-8 player flow, presenter rotation, speed-decayed guessing,
 * scaled presenter payouts, the reveal hooks and the TV privacy rule.
 *
 * The plugin is driven directly, so every rule is pinned without a browser or
 * a real clock. The guessing clock is advanced by writing `elapsedMs` before
 * a guess, which is exactly the value the server records at input time.
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

interface BlatherState {
  round: number;
  maxRounds: number;
  phase: "clue" | "guessing" | "reveal" | "finished";
  presenter: number;
  target: string;
  clue: string | null;
  guesses: Array<string | null>;
  guessMs: number[];
  elapsedMs: number;
  scores: number[];
  timerMs: number;
  reveal: { correct: number[] } | null;
  stats: Record<string, number>;
  answerMsTotal: number[];
  answerCount: number[];
}

interface BlatherInstance {
  roomId: string;
  players: TestPlayer[];
  state: BlatherState;
}

interface ScreenState {
  phase: string;
  round: number;
  maxRounds: number;
  playerCount: number;
  presenterName: string;
  clue: string | null;
  target: string | null;
  guessCount: number;
  guesserCount: number;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  guesses: Array<{ name: string; guess: string | null; correct: boolean }>;
  reveal: { correct: number[] } | null;
  timerMs: number;
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
  placeholder?: string;
  maxLength?: number;
  hasSubmitted?: boolean;
  info?: string;
  options: Array<{ id: string; label: string }>;
}

interface BlatherPlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; description: string };
  onStart(room: unknown, players: TestPlayer[]): BlatherInstance;
  onInput(instance: BlatherInstance, playerId: string, input: unknown): void;
  onTick(instance: BlatherInstance, deltaMs: number): void;
  screenState(instance: BlatherInstance): ScreenState;
  controllerState(instance: BlatherInstance, playerId: string): ControllerState;
  results?(instance: BlatherInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const mod = (await import("../games/blather/server.ts")) as {
  default: BlatherPlugin;
  guessScore: (seconds: number) => number;
  presenterScore: (correctGuesses: number, playerCount: number) => number;
};

const plugin = mod.default;
const guessScore = mod.guessScore;
const presenterScore = mod.presenterScore;

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal"];

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: NAMES[index] ?? `Player ${index + 1}`,
    joinedAt: 0,
    rejoinToken: `t${index}`,
    connected: true,
  }));
}

function makeRoom(players: TestPlayer[]): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: players[0].id,
    players,
    gameId: "blather",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

function start(count: number): BlatherInstance {
  const players = makePlayers(count);
  return plugin.onStart(makeRoom(players), players);
}

function presenter(instance: BlatherInstance): TestPlayer {
  return instance.players[instance.state.presenter];
}

function submitClue(instance: BlatherInstance, text = "a common thing you see outside"): void {
  plugin.onInput(instance, presenter(instance).id, { text });
}

function guess(instance: BlatherInstance, index: number, text: string): void {
  plugin.onInput(instance, instance.players[index].id, { text });
}

function endReveal(instance: BlatherInstance): void {
  instance.state.timerMs = 0;
  plugin.onTick(instance, 500);
}

/** Play a whole match with deterministic inputs; returns the presenter seat per round. */
function driveToFinish(instance: BlatherInstance): number[] {
  const presenters: number[] = [];
  let guard = 0;

  while (instance.state.phase !== "finished" && guard < 5000) {
    const state = instance.state;
    if (state.phase === "clue") {
      presenters.push(state.presenter);
      submitClue(instance, `clue for round ${state.round}`);
    } else if (state.phase === "guessing") {
      for (let index = 0; index < instance.players.length; index++) {
        if (index === state.presenter) continue;
        const text = (index + state.round) % 2 === 0 ? state.target : "definitely not it";
        guess(instance, index, text);
      }
    } else if (state.phase === "reveal") {
      endReveal(instance);
    }
    guard++;
  }

  return presenters;
}

/** Assert a TV payload does not carry the secret word. */
function assertNoTarget(screen: unknown, target: string, phase: string): void {
  assert.ok(
    !JSON.stringify(screen).includes(target),
    `${phase}: the secret word leaked to the TV`,
  );
}

describe("blather: catalog and player range", () => {
  test("hard range is 3-8 and the catalog matches the plugin manifest", () => {
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);

    const entry = GAME_CATALOG.blather;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);
  });

  test("standalone runs min(N, 6) rounds; rumble always runs four", () => {
    const standalone: Record<number, number> = { 3: 3, 4: 4, 5: 5, 6: 6, 7: 6, 8: 6 };
    for (const [count, rounds] of Object.entries(standalone)) {
      const scale = GAME_CATALOG.blather.scale(Number(count), "standalone");
      assert.strictEqual(scale.rounds, rounds, `${count}: standalone rounds`);
      assert.deepStrictEqual(
        scale.timers,
        { clue: 45, guess: 45, reveal: 8 },
        `${count}: timers changed`,
      );
    }
    for (let count = 3; count <= 8; count++) {
      assert.strictEqual(GAME_CATALOG.blather.scale(count, "rumble").rounds, 4, `${count}: rumble rounds`);
    }
  });

  test("onStart uses the standalone round count", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const instance = start(count);
      assert.strictEqual(instance.state.maxRounds, Math.min(count, 6), `${count}: maxRounds`);
      assert.strictEqual(instance.state.scores.length, count);
    }
  });
});

describe("blather: scoring formulas", () => {
  test("a guess is speed-decayed over 45 seconds, with a hard 100 floor", () => {
    assert.strictEqual(guessScore(0), 1000);
    assert.strictEqual(guessScore(10), 800);
    assert.strictEqual(guessScore(45), 100);
    assert.strictEqual(guessScore(60), 100, "past the limit is still the floor");
    assert.strictEqual(guessScore(-5), 1000, "a negative clock is treated as zero");
  });

  test("the presenter earns a scaled 100 per correct guesser", () => {
    assert.strictEqual(presenterScore(1, 3), 100);
    assert.strictEqual(presenterScore(1, 4), 100);
    assert.strictEqual(presenterScore(1, 5), 75);
    assert.strictEqual(presenterScore(1, 6), 60);
    assert.strictEqual(presenterScore(1, 7), 50);
    assert.strictEqual(presenterScore(1, 8), 43);
    assert.strictEqual(presenterScore(0, 8), 0);
  });

  test("the presenter payout is capped at 600 even for a huge round", () => {
    for (let count = 3; count <= 8; count++) {
      assert.strictEqual(presenterScore(100, count), 600, `${count}: cap`);
      assert.ok(presenterScore(count - 1, count) <= 600, `${count}: normal round under the cap`);
    }
  });

  test("the best single-round gain stays inside the 1500 bound at every N", () => {
    for (let count = 3; count <= 8; count++) {
      const bestGuesser = guessScore(0);
      const bestPresenter = presenterScore(count - 1, count);

      assert.ok(bestGuesser <= 1000, `${count}: a guesser cannot exceed 1000`);
      assert.ok(bestPresenter <= 600, `${count}: a presenter cannot exceed 600`);

      const best = Math.max(bestGuesser, bestPresenter);
      assert.ok(best <= MAX_ROUND_SCORE, `${count}: ${best} exceeds ${MAX_ROUND_SCORE}`);
      assert.ok(withinRoundBound(best), `${count}: sanity helper rejected ${best}`);
    }
  });
});

describe("blather: full playthroughs", () => {
  for (const count of [3, 8]) {
    test(`${count} players reaches finished with sane scores and results`, () => {
      const instance = start(count);
      const presenters = driveToFinish(instance);

      assert.strictEqual(instance.state.phase, "finished");
      assert.strictEqual(presenters.length, Math.min(count, 6), `${count}: round count`);
      assert.strictEqual(instance.state.scores.length, count);
      for (const score of instance.state.scores) {
        assert.ok(Number.isFinite(score) && score >= 0, `bad score ${score}`);
      }

      const screen = plugin.screenState(instance);
      assert.strictEqual(screen.finished, true);
      assert.strictEqual(screen.playerCount, count);
      assert.strictEqual(screen.scores.length, count);

      const result = plugin.results?.(instance);
      assert.ok(result, "blather must expose results()");
      assert.strictEqual(result.standings.length, count);
      for (const standing of result.standings) {
        assert.ok(Number.isFinite(standing.raw) && standing.raw >= 0);
        assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
      }
    });
  }

  test("eight players rotate through six presenters in seat order", () => {
    const instance = start(8);
    const presenters = driveToFinish(instance);
    assert.deepStrictEqual(presenters, [0, 1, 2, 3, 4, 5]);
  });

  test("three players rotate through the whole table", () => {
    const instance = start(3);
    assert.deepStrictEqual(driveToFinish(instance), [0, 1, 2]);
  });
});

describe("blather: round flow and privacy", () => {
  test("a 10-second guess pays 800 and the presenter 100 per correct guesser", () => {
    const instance = start(3);
    submitClue(instance);

    instance.state.elapsedMs = 10000;
    guess(instance, 1, instance.state.target);
    guess(instance, 2, "banana");

    assert.strictEqual(instance.state.phase, "reveal");
    assert.strictEqual(instance.state.scores[1], 800);
    assert.strictEqual(instance.state.scores[2], 0);
    assert.strictEqual(instance.state.scores[0], 100);
    assert.deepStrictEqual(instance.state.reveal?.correct, [1]);
  });

  test("an instant guess pays the full 1000", () => {
    const instance = start(3);
    submitClue(instance);
    guess(instance, 1, instance.state.target);
    guess(instance, 2, "banana");
    assert.strictEqual(instance.state.scores[1], 1000);
  });

  test("the target never reaches the TV before the reveal, at any phase", () => {
    const instance = start(8);

    while (instance.state.phase !== "finished") {
      const state = instance.state;
      const target = state.target;

      if (state.phase === "clue") {
        assertNoTarget(plugin.screenState(instance), target, "clue");
        submitClue(instance);
        assertNoTarget(plugin.screenState(instance), target, "clue submitted");
      } else if (state.phase === "guessing") {
        assertNoTarget(plugin.screenState(instance), target, "guessing");
        assert.deepStrictEqual(plugin.screenState(instance).target, null);

        // A correct guess must still not put the word on the TV before the reveal.
        const firstGuesser = state.presenter === 0 ? 1 : 0;
        guess(instance, firstGuesser, target);
        assert.strictEqual(instance.state.phase, "guessing", "one guess leaves the round open");
        assertNoTarget(plugin.screenState(instance), target, "correct guess while guessing");
        assert.strictEqual(plugin.screenState(instance).target, null);

        for (let index = 0; index < instance.players.length; index++) {
          if (index === instance.state.presenter || index === firstGuesser) continue;
          guess(instance, index, "not the answer");
        }
      } else if (state.phase === "reveal") {
        const screen = plugin.screenState(instance);
        assert.strictEqual(screen.target, target, "the word appears at the reveal");
        assert.ok(screen.guesses.some((row) => row.guess === target && row.correct));
        endReveal(instance);
      }
    }
  });

  test("the TV shows a live guess counter, never the guess text, while guessing", () => {
    const instance = start(8);
    submitClue(instance, "something with wheels");

    const before = plugin.screenState(instance);
    assert.strictEqual(before.clue, "something with wheels");
    assert.strictEqual(before.guessCount, 0);
    assert.strictEqual(before.guesserCount, 7);
    assert.deepStrictEqual(before.guesses, [], "no guess rows before the reveal");

    guess(instance, 1, "a bicycle");
    const after = plugin.screenState(instance);
    assert.strictEqual(after.guessCount, 1);
    assert.deepStrictEqual(after.guesses, []);
    assert.ok(!JSON.stringify(after).includes("a bicycle"), "guess text waits for the reveal");
  });

  test("guesser phones see the clue, not the secret word", () => {
    const instance = start(8);
    const target = instance.state.target;
    submitClue(instance, "something with wheels");

    for (let index = 0; index < instance.players.length; index++) {
      const controller = plugin.controllerState(instance, instance.players[index].id);
      if (index === instance.state.presenter) {
        assert.strictEqual(controller.mode, "wait", "the presenter watches the guesses arrive");
        continue;
      }
      assert.strictEqual(controller.mode, "text");
      assert.strictEqual(controller.info, "something with wheels");
      assert.ok(!JSON.stringify(controller).includes(target), "a guesser must not see the word");
    }
  });

  test("waitingOn tracks the presenter, then the silent guessers", () => {
    const instance = start(4);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ana"]);

    submitClue(instance);
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Ben", "Cleo", "Dev"]);

    guess(instance, 1, "nope");
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, ["Cleo", "Dev"]);

    guess(instance, 2, "nope");
    guess(instance, 3, "nope");
    const reveal = plugin.screenState(instance);
    assert.deepStrictEqual(reveal.waitingOn, [], "a settled round waits on nobody");
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(typeof reveal.caption === "string" && reveal.caption.length > 0);
  });

  test("caption and sound stay quiet until the reveal", () => {
    const instance = start(3);
    assert.strictEqual(plugin.screenState(instance).caption, null);
    assert.strictEqual(plugin.screenState(instance).sound, null);

    submitClue(instance);
    assert.strictEqual(plugin.screenState(instance).caption, null);
    assert.strictEqual(plugin.screenState(instance).sound, null);

    guess(instance, 1, instance.state.target);
    guess(instance, 2, "nope");
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption && reveal.caption.length > 0);
  });
});

describe("blather: typo tolerance", () => {
  const cases: Array<{ guess: string; correct: boolean }> = [
    { guess: "BICYCLE-PUMP!", correct: true },
    { guess: "bicyle pump", correct: true },
    { guess: "bicycle pumpp", correct: true },
    { guess: "bicycl pumpz", correct: false },
  ];

  for (const item of cases) {
    test(`"${item.guess}" is ${item.correct ? "accepted" : "rejected"}`, () => {
      const instance = start(3);
      submitClue(instance);
      guess(instance, 1, item.guess);
      guess(instance, 2, "definitely not it");

      assert.strictEqual(instance.state.phase, "reveal");
      assert.deepStrictEqual(instance.state.reveal?.correct, item.correct ? [1] : []);
    });
  }
});

describe("blather: results", () => {
  test("results publishes standings plus correctGuesses and averageAnswerMs", () => {
    const instance = start(3);
    submitClue(instance);

    instance.state.elapsedMs = 10000;
    guess(instance, 1, instance.state.target);
    instance.state.elapsedMs = 20000;
    guess(instance, 2, "nope");

    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings.length, 3);

    for (const player of instance.players) {
      assert.strictEqual(typeof result.stats[`${player.id}:correctGuesses`], "number");
      assert.strictEqual(typeof result.stats[`${player.id}:averageAnswerMs`], "number");
    }

    assert.strictEqual(result.stats["p1:correctGuesses"], 1);
    assert.strictEqual(result.stats["p2:correctGuesses"], 0);
    assert.strictEqual(result.stats["p0:correctGuesses"], 0);
    assert.strictEqual(result.stats["p1:averageAnswerMs"], 10000);
    assert.strictEqual(result.stats["p2:averageAnswerMs"], 20000);
    assert.strictEqual(result.stats["p0:averageAnswerMs"], 0, "a presenter submits no guess");
  });
});
