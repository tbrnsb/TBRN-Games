/**
 * Percentile: pure scoring, round counts, content metadata, and scripted
 * full games at 2 and 8 players.
 *
 * The tests pin today's 3-4 scoring exactly, prove the guesser rotates through
 * every seat at eight players, and assert that neither the guess nor the true
 * statistic reaches the shared screen before the reveal.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import plugin, {
  BET_BONUS,
  BET_BONUS_DISTANCE,
  BET_POINTS,
  CLOSE_STEP,
  CLOSE_WINDOW,
  EXACT_POINTS,
  betScore,
  guessPoints,
  percentileRounds,
  settleRound,
  type PercentileBet,
} from "../games/percentile/server.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";

const players = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));

const room = (list: ReturnType<typeof players>) => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: list[0]?.id ?? null,
  players: list,
  gameId: "percentile",
  gameState: null,
  createdAt: 0,
  status: "playing" as const,
});

type Instance = ReturnType<typeof plugin.onStart>;

interface PromptView {
  id: string;
  text: string;
  value: number;
  unit: string;
  source: string;
  year: number;
}

interface StateView {
  prompts: PromptView[];
  phase: "guessing" | "betting" | "reveal" | "finished";
  round: number;
  maxRounds: number;
  guesser: number;
  scores: number[];
  reveal: { guess: number; actual: number; delta: number; points: number; unit: string } | null;
}

interface ScreenView {
  phase: string;
  round: number;
  maxRounds: number;
  question: string;
  unit: string;
  guesserName: string;
  guess: number | null;
  actual: number | null;
  delta: number | null;
  reveal: { guess: number; actual: number; delta: number; points: number; unit: string } | null;
  source: string | null;
  year: number | null;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  scores: Array<{ name: string; score: number; seat: number }>;
  finished: boolean;
  winner: string | null;
}

const stateOf = (inst: Instance): StateView => inst.state as StateView;
const screenOf = (inst: Instance): ScreenView => plugin.screenState(inst) as ScreenView;

function start(count: number, options?: Record<string, unknown>): { inst: Instance; list: ReturnType<typeof players> } {
  const list = players(count);
  return { inst: plugin.onStart(room(list), list, options), list };
}

/** Tick in the server's clamped steps until `done` reports true. */
function tickUntil(inst: Instance, done: () => boolean, steps = 12): void {
  for (let i = 0; i < steps && !done(); i++) plugin.onTick(inst, 2000);
}

function actualOf(inst: Instance): number {
  const state = stateOf(inst);
  return state.prompts[state.round % state.prompts.length].value;
}

/**
 * Play one round: the current guesser sets `guess`, every other seat places the
 * bet from `betFor`, and the round must reach the reveal.
 */
function playRound(
  inst: Instance,
  list: ReturnType<typeof players>,
  guess: number,
  betFor: (seat: number) => PercentileBet,
): void {
  const state = stateOf(inst);
  const guesser = state.guesser;
  plugin.onInput(inst, list[guesser].id, { slider: { value: guess / 100 } });
  plugin.onInput(inst, list[guesser].id, { action: "action" });
  assert.strictEqual(state.phase, "betting", "the guesser's submit opens betting");

  for (let seat = 0; seat < list.length; seat++) {
    if (seat === guesser) continue;
    plugin.onInput(inst, list[seat].id, { choice: betFor(seat) });
  }
  assert.strictEqual(state.phase, "reveal", "the last bet closes the round");
}

/** Leave the reveal so the next round (or the finish) starts. */
function leaveReveal(inst: Instance): void {
  const round = stateOf(inst).round;
  tickUntil(inst, () => stateOf(inst).phase !== "reveal" || stateOf(inst).round !== round);
}

describe("percentile scoring", () => {
  test("exact, within-15 and directional bets keep today's rule at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      const seats = players(count);
      const bets: Array<PercentileBet | null> = seats.map((_, index) =>
        index === 0 ? null : "higher",
      );

      const exact = settleRound(50, 50, bets);
      assert.strictEqual(exact.guessPoints, 1000, `${count}: exact pays 1000`);
      assert.deepStrictEqual(exact.betPoints, seats.map(() => 0), `${count}: an exact guess has no direction to bet`);

      const close = settleRound(40, 50, bets);
      assert.strictEqual(close.guessPoints, 1000 - CLOSE_STEP * 10, `${count}: 10 away pays 500`);
      assert.strictEqual(close.guessPoints, 500);
      assert.deepStrictEqual(
        close.betPoints,
        seats.map((_, index) => (index === 0 ? 0 : 500)),
        `${count}: a correct near bet pays 500`,
      );

      const edge = settleRound(35, 50, bets);
      assert.strictEqual(edge.guessPoints, 250, `${count}: 15 away is the last scoring step`);
      assert.strictEqual(guessPoints(34, 50), 0, `${count}: 16 away scores nothing`);

      const twenty = settleRound(30, 50, bets);
      assert.strictEqual(twenty.guessPoints, 0, `${count}: 20 away scores nothing`);
      assert.deepStrictEqual(
        twenty.betPoints,
        seats.map((_, index) => (index === 0 ? 0 : 500)),
        `${count}: a miss of exactly 20 keeps the base bet`,
      );

      const far = settleRound(29, 50, bets);
      assert.strictEqual(far.betPoints[1], 700, `${count}: a miss over 20 adds the bonus`);
      assert.strictEqual(betScore(29, 50, "lower"), 0, `${count}: the wrong direction pays 0`);
    }

    assert.strictEqual(EXACT_POINTS, 1000);
    assert.strictEqual(CLOSE_WINDOW, 15);
    assert.strictEqual(CLOSE_STEP, 50);
    assert.strictEqual(BET_POINTS, 500);
    assert.strictEqual(BET_BONUS, 200);
    assert.strictEqual(BET_BONUS_DISTANCE, 20);
  });

  test("one player's maximum round score stays inside 1500 at 2-8 players", () => {
    for (let count = 2; count <= 8; count++) {
      const seats = players(count);
      const exact = settleRound(50, 50, seats.map((_, index) => (index === 0 ? null : "lower")));
      assert.ok(
        withinRoundBound(Math.max(exact.guessPoints, ...exact.betPoints)),
        `${count}: an exact guess must stay inside the bound`,
      );

      const far = settleRound(0, 100, seats.map((_, index) => (index === 0 ? null : "higher")));
      assert.strictEqual(far.betPoints[1], 700, `${count}: the maximum bet is 700`);
      assert.ok(
        Math.max(...[far.guessPoints, ...far.betPoints]) <= MAX_ROUND_SCORE,
        `${count}: a 700 bet is inside the bound`,
      );

      assert.ok(guessPoints(0, 100) <= MAX_ROUND_SCORE, `${count}: a guess never pays over 1000`);
    }
  });
});

describe("percentile rounds and range", () => {
  test("standalone is five, the everyone-guesses setting is N, and the Rumble is four", () => {
    for (let count = 2; count <= 8; count++) {
      assert.strictEqual(percentileRounds(count), 5, `${count}: standalone default`);
      assert.strictEqual(percentileRounds(count, "standalone", true), count, `${count}: everyone guesses once`);
      assert.strictEqual(percentileRounds(count, "rumble", true), 4, `${count}: rumble ignores the setting`);
      assert.strictEqual(percentileRounds(count, "rumble"), 4, `${count}: rumble`);
    }

    assert.strictEqual(plugin.manifest.minPlayers, 2);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);
  });

  test("onStart sizes the game from the table and the host setting", () => {
    assert.strictEqual(stateOf(start(2).inst).maxRounds, 5);
    assert.strictEqual(stateOf(start(4).inst).maxRounds, 5);
    assert.strictEqual(stateOf(start(5).inst).maxRounds, 5);
    assert.strictEqual(stateOf(start(8).inst).maxRounds, 5);
    assert.strictEqual(stateOf(start(8, { guessOnce: true }).inst).maxRounds, 8);
    assert.strictEqual(stateOf(start(8, { mode: "rumble", guessOnce: true }).inst).maxRounds, 4);
  });
});

describe("percentile playthroughs", () => {
  test("two players finish the five-round standalone game", () => {
    const { inst, list } = start(2);
    assert.strictEqual(stateOf(inst).maxRounds, 5);

    for (let round = 0; round < 5; round++) {
      const before = [...stateOf(inst).scores];
      playRound(inst, list, 50, () => "higher");
      stateOf(inst).scores.forEach((score, seat) => {
        assert.ok(score - before[seat] <= MAX_ROUND_SCORE, `round ${round + 1}: seat ${seat} over the bound`);
      });
      if (round < 4) {
        leaveReveal(inst);
        assert.strictEqual(stateOf(inst).phase, "guessing", `round ${round + 2}: next round starts`);
      }
    }

    leaveReveal(inst);
    assert.strictEqual(stateOf(inst).phase, "finished", "five rounds finish the game");
    assert.strictEqual(screenOf(inst).finished, true);
    assert.strictEqual(screenOf(inst).scores.length, 2);
  });

  test("eight players guess once each and the guesser rotates through every seat", () => {
    const { inst, list } = start(8, { guessOnce: true });
    assert.strictEqual(stateOf(inst).maxRounds, 8);

    const guessers: number[] = [];
    for (let round = 0; round < 8; round++) {
      const state = stateOf(inst);
      guessers.push(state.guesser);
      assert.strictEqual(screenOf(inst).scores.length, 8, `round ${round + 1}: eight score rows`);
      assert.deepStrictEqual(screenOf(inst).waitingOn, [list[state.guesser].name], `round ${round + 1}: waiting on the guesser`);

      const before = [...state.scores];
      playRound(inst, list, 50, (seat) => (seat % 2 === 0 ? "higher" : "lower"));
      state.scores.forEach((score, seat) => {
        assert.ok(score - before[seat] <= MAX_ROUND_SCORE, `round ${round + 1}: seat ${seat} over the bound`);
      });

      const reveal = screenOf(inst);
      assert.deepStrictEqual(reveal.waitingOn, [], `round ${round + 1}: nobody is waited on at the reveal`);
      assert.strictEqual(reveal.sound, "reveal", `round ${round + 1}: reveal cue`);
      assert.ok(reveal.caption && reveal.caption.length > 0, `round ${round + 1}: reveal caption`);
      if (round < 7) {
        leaveReveal(inst);
        assert.strictEqual(stateOf(inst).phase, "guessing", `round ${round + 2}: next round starts`);
      }
    }

    assert.deepStrictEqual(guessers, [0, 1, 2, 3, 4, 5, 6, 7], "every seat guesses exactly once");

    leaveReveal(inst);
    assert.strictEqual(stateOf(inst).phase, "finished", "eight rounds finish the game");
    assert.strictEqual(screenOf(inst).finished, true);
    assert.strictEqual(screenOf(inst).scores.length, 8, "the finished TV still has eight rows");
  });
});

describe("percentile TV privacy and hooks", () => {
  test("neither the guess nor the actual reaches the TV before the reveal", () => {
    const { inst, list } = start(8);
    const initial = screenOf(inst);
    assert.strictEqual(initial.phase, "guessing");
    assert.strictEqual(initial.actual, null, "actual hidden while guessing");
    assert.strictEqual(initial.guess, null, "guess hidden while guessing");
    assert.strictEqual(initial.delta, null);
    assert.strictEqual(initial.reveal, null);
    assert.strictEqual(initial.source, null, "source hidden before the reveal");
    assert.strictEqual(initial.year, null, "year hidden before the reveal");
    assert.deepStrictEqual(initial.waitingOn, [list[0].name]);

    const guesser = stateOf(inst).guesser;
    plugin.onInput(inst, list[guesser].id, { slider: { value: 0.42 } });
    plugin.onInput(inst, list[guesser].id, { action: "action" });

    const betting = screenOf(inst);
    assert.strictEqual(betting.phase, "betting");
    assert.strictEqual(betting.actual, null, "actual hidden while betting");
    assert.strictEqual(betting.guess, null, "the guess stays hidden while bettors decide");
    assert.strictEqual(betting.reveal, null);
    assert.strictEqual(betting.waitingOn.length, 7, "seven bettors are waited on");

    const other = (guesser + 1) % list.length;
    const otherController = plugin.controllerState(inst, list[other].id) as Record<string, unknown>;
    assert.ok(!("guess" in otherController), "a bettor's phone does not receive the guess");
    assert.ok(!String(otherController.info ?? "").includes("42"), "a bettor's info does not leak the guess");

    for (let seat = 0; seat < list.length; seat++) {
      if (seat === guesser) continue;
      plugin.onInput(inst, list[seat].id, { choice: "higher" });
    }

    const reveal = screenOf(inst);
    const actual = actualOf(inst);
    assert.strictEqual(reveal.phase, "reveal");
    assert.strictEqual(reveal.guess, 42);
    assert.strictEqual(reveal.actual, actual);
    assert.strictEqual(reveal.delta, Math.abs(42 - actual));
    assert.strictEqual(reveal.unit, "%");
    assert.ok(reveal.source && reveal.source.length > 0, "the reveal credits a source");
    assert.ok(Number.isInteger(reveal.year), "the reveal carries the year");
    assert.strictEqual(reveal.reveal?.points, guessPoints(42, actual));
    assert.strictEqual(reveal.sound, "reveal");
  });

  test("results reports betAccuracy and guessAccuracy for every player", () => {
    const { inst, list } = start(3);
    const state = stateOf(inst);
    const guesser = state.guesser;
    const actual = actualOf(inst);

    // A 30-point miss: the guesser scores nothing and both bettors are right.
    playRound(inst, list, Math.max(0, actual - 30), () => "higher");

    const results = plugin.results?.(inst);
    assert.ok(results, "results hook exists");
    assert.strictEqual(results.standings.length, 3);

    for (const player of list) {
      const betAccuracy = results.stats[`${player.id}:betAccuracy`];
      const guessAccuracy = results.stats[`${player.id}:guessAccuracy`];
      assert.ok(Number.isFinite(betAccuracy), `${player.id}: betAccuracy`);
      assert.ok(Number.isFinite(guessAccuracy), `${player.id}: guessAccuracy`);
    }

    const guesserId = list[guesser].id;
    assert.strictEqual(results.stats[`${guesserId}:betAccuracy`], 0, "the guesser placed no bets");
    assert.strictEqual(results.stats[`${guesserId}:guessAccuracy`], 0, "a 30-point miss is outside the window");
    list.forEach((player, seat) => {
      if (seat === guesser) return;
      assert.strictEqual(results.stats[`${player.id}:betAccuracy`], 1, `${player.id}: correct bet`);
    });
  });
});

describe("percentile content pack", () => {
  test("every statistic has a value, unit, source and year", () => {
    const path = join(process.cwd(), "packs", "percentile-stats.json");
    const pack = JSON.parse(readFileSync(path, "utf8")) as {
      id?: unknown;
      stats?: Array<Record<string, unknown>>;
    };
    assert.strictEqual(pack.id, "percentile-stats");
    assert.ok(Array.isArray(pack.stats), "the pack has a stats list");
    assert.ok((pack.stats?.length ?? 0) >= 8, "eight players must have eight distinct statistics available");

    for (const [index, stat] of (pack.stats ?? []).entries()) {
      assert.strictEqual(typeof stat.text, "string", `${index}: text`);
      assert.ok(Number.isFinite(stat.value), `${index}: value`);
      assert.strictEqual(typeof stat.unit, "string", `${index}: unit`);
      assert.ok(String(stat.unit).trim().length > 0, `${index}: unit is not empty`);
      assert.strictEqual(typeof stat.source, "string", `${index}: source`);
      assert.ok(String(stat.source).trim().length > 0, `${index}: source is not empty`);
      assert.ok(Number.isInteger(stat.year), `${index}: year`);
    }
  });
});
