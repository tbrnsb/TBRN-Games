/** Mind Meld: pure normalization + scoring, plus scripted full games at 2-8. */
import { test, describe } from "node:test";
import assert from "node:assert";
import plugin, {
  mindmeldRounds,
  normalizeAnswer,
  scoreRound,
} from "../games/mindmeld/server.ts";
import { mindmeldGridColumns, renderMindmeld } from "../games/mindmeld/screen.ts";
import { MAX_ROUND_SCORE, scalePayout } from "../shared/scoring.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true,
  }));

const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "mindmeld", gameState: null, createdAt: 0, status: "playing" as const,
});

interface Screen {
  phase: string;
  round: number;
  maxRounds: number;
  submitted: number;
  playerCount: number;
  answers: Array<{ name: string; answer: string; points: number; seat: number }>;
  allMatched: boolean;
  nearMatch: boolean;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
}

const screenOf = (inst: ReturnType<typeof plugin.onStart>): Screen => plugin.screenState(inst) as Screen;
const stateOf = (inst: ReturnType<typeof plugin.onStart>) =>
  inst.state as {
    phase: string;
    round: number;
    maxRounds: number;
    scores: number[];
    roundPoints: number[];
    allMatched: boolean;
    nearMatch: boolean;
    matches: number[];
    roundsWon: number[];
  };

/** Tick in the server's clamped steps until `done` reports true. */
function tickUntil(inst: ReturnType<typeof plugin.onStart>, done: () => boolean, steps = 24): void {
  for (let i = 0; i < steps && !done(); i++) plugin.onTick(inst, 2000);
}

function submit(inst: ReturnType<typeof plugin.onStart>, players: ReturnType<typeof mk>, texts: string[]): void {
  players.forEach((player, index) => plugin.onInput(inst, player.id, { text: texts[index] ?? "" }));
}

function start(n: number, mode?: "standalone" | "rumble"): { inst: ReturnType<typeof plugin.onStart>; players: ReturnType<typeof mk> } {
  const players = mk(n);
  const inst = plugin.onStart(room(players), players, mode ? { mode } : undefined);
  return { inst, players };
}

/** Play one full round with `texts`, then advance past the reveal. */
function playRound(inst: ReturnType<typeof plugin.onStart>, players: ReturnType<typeof mk>, texts: string[]): void {
  submit(inst, players, texts);
  assert.strictEqual(stateOf(inst).phase, "reveal", "all submissions close the round");
  const round = stateOf(inst).round;
  tickUntil(inst, () => stateOf(inst).phase !== "reveal" || stateOf(inst).round !== round);
}

describe("mind meld", () => {
  test("normalization strips case, punctuation, spaces and simple plurals", () => {
    assert.strictEqual(normalizeAnswer("Cats!"), "cat");
    assert.strictEqual(normalizeAnswer("  APPLES "), "apple");
    assert.strictEqual(normalizeAnswer("berries"), "berry");
    assert.strictEqual(normalizeAnswer("Pass!"), "pass");
    assert.strictEqual(normalizeAnswer("green  beans"), "green bean");
    assert.strictEqual(normalizeAnswer("   "), "");
  });

  test("300 per matching partner, zero for a unique answer", () => {
    const { points, allMatched } = scoreRound(["pizza", "Pizza!", "taco"]);
    assert.deepStrictEqual(points, [300, 300, 0]);
    assert.strictEqual(allMatched, false);
  });

  test("a full match pays the 1000 jackpot and ends the game", () => {
    const { points, allMatched } = scoreRound(["apple", "apples", "APPLE"]);
    assert.deepStrictEqual(points, [1000, 1000, 1000]);
    assert.strictEqual(allMatched, true);
  });

  test("empty answers never match and never score", () => {
    const { points } = scoreRound(["", "", "dog"]);
    assert.deepStrictEqual(points, [0, 0, 0]);
  });

  test("scripted full game: three players meld and the game ends early", () => {
    const { inst, players } = start(3);
    players.forEach((p) => plugin.onInput(inst, p.id, { text: "Banana" }));
    assert.strictEqual(stateOf(inst).phase, "reveal", "all submissions move to reveal");
    assert.deepStrictEqual(stateOf(inst).scores, [1000, 1000, 1000], "jackpot applied");

    tickUntil(inst, () => stateOf(inst).phase === "finished");
    assert.strictEqual(stateOf(inst).phase, "finished", "a full meld ends the game");
  });

  test("no submission at the deadline still resolves the round", () => {
    const { inst } = start(2);
    plugin.onInput(inst, "p0", { text: "cat" });
    tickUntil(inst, () => stateOf(inst).phase !== "collect");
    assert.strictEqual(stateOf(inst).phase, "reveal");
    assert.deepStrictEqual(stateOf(inst).scores, [0, 0], "a lone answer scores nothing");
  });
});

describe("mind meld rounds and range", () => {
  test("standalone is six rounds at 2-4, five at 5-8; rumble is four", () => {
    for (const n of [2, 3, 4]) assert.strictEqual(mindmeldRounds(n), 6, `${n}: standalone`);
    for (const n of [5, 6, 7, 8]) assert.strictEqual(mindmeldRounds(n), 5, `${n}: standalone`);
    for (let n = 2; n <= 8; n++) assert.strictEqual(mindmeldRounds(n, "rumble"), 4, `${n}: rumble`);

    assert.strictEqual(plugin.manifest.minPlayers, 2);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);
  });

  test("onStart sizes the game from the table and the optional mode", () => {
    assert.strictEqual(stateOf(start(4).inst).maxRounds, 6);
    assert.strictEqual(stateOf(start(5).inst).maxRounds, 5);
    assert.strictEqual(stateOf(start(8).inst).maxRounds, 5);
    assert.strictEqual(stateOf(start(5, "rumble").inst).maxRounds, 4);
  });
});

describe("mind meld scoring", () => {
  test("exactly 300 per match at 3 and 4 players", () => {
    const three = scoreRound(["Pizza!", "pizza", "Taco"]);
    assert.deepStrictEqual(three.points, [300, 300, 0]);
    assert.strictEqual(three.nearMatch, false);

    const four = scoreRound(["Apple", "apples", "Banana", "bananas"]);
    assert.deepStrictEqual(four.points, [300, 300, 300, 300]);
  });

  test("per-match payout scales with scalePayout(300, N) from five players up", () => {
    const cases: Array<[number, string[]]> = [
      [5, ["alpha", "alpha", "bravo", "charlie", "delta"]],
      [6, ["alpha", "alpha", "bravo", "charlie", "delta", "echo"]],
      [7, ["alpha", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]],
      [8, ["alpha", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"]],
    ];
    for (const [count, answers] of cases) {
      const { points, nearMatch } = scoreRound(answers);
      const perMatch = scalePayout(300, count);
      assert.strictEqual(nearMatch, false);
      assert.deepStrictEqual(points, [perMatch, perMatch, 0, 0, 0, 0, 0, 0].slice(0, count), `${count}: scaled match`);
    }
    assert.strictEqual(scalePayout(300, 5), 225);
    assert.strictEqual(scalePayout(300, 6), 180);
    assert.strictEqual(scalePayout(300, 7), 150);
    assert.strictEqual(scalePayout(300, 8), 129);
  });

  test("a full table pays 1000 and finishes at every count from 2 to 8", () => {
    for (let n = 2; n <= 8; n++) {
      const answers = Array.from({ length: n }, () => "Apple");
      const round = scoreRound(answers);
      assert.strictEqual(round.allMatched, true, `${n}: full table`);
      assert.strictEqual(round.nearMatch, false, `${n}: not an N-1 match`);
      assert.deepStrictEqual(round.points, answers.map(() => 1000), `${n}: jackpot`);

      const { inst, players } = start(n);
      submit(inst, players, answers);
      assert.deepStrictEqual(stateOf(inst).scores, players.map(() => 1000), `${n}: applied`);
      tickUntil(inst, () => stateOf(inst).phase === "finished");
      assert.strictEqual(stateOf(inst).phase, "finished", `${n}: game ends`);
    }
  });

  test("an N-1 match pays 800 each and ends from five players up", () => {
    for (let n = 5; n <= 8; n++) {
      const answers = [...Array.from({ length: n - 1 }, () => "Apple"), "Pear"];
      const round = scoreRound(answers);
      assert.strictEqual(round.nearMatch, true, `${n}: N-1 match`);
      assert.strictEqual(round.allMatched, false, `${n}: not a full table`);
      assert.deepStrictEqual(
        round.points,
        [...Array.from({ length: n - 1 }, () => 800), 0],
        `${n}: 800 each to the matching group`,
      );

      const { inst, players } = start(n);
      playRound(inst, players, answers);
      assert.deepStrictEqual(
        stateOf(inst).scores,
        [...Array.from({ length: n - 1 }, () => 800), 0],
        `${n}: applied`,
      );
      assert.strictEqual(stateOf(inst).phase, "finished", `${n}: game ends early`);
    }
  });

  test("3 and 4 players keep today's 300-per-match parity, no early end", () => {
    for (const n of [3, 4]) {
      const answers = [...Array.from({ length: n - 1 }, () => "Apple"), "Pear"];
      const round = scoreRound(answers);
      assert.strictEqual(round.nearMatch, false, `${n}: new rule must not fire`);
      assert.deepStrictEqual(
        round.points,
        [...Array.from({ length: n - 1 }, () => (n - 2) * 300), 0],
        `${n}: unchanged 300 per match`,
      );

      const { inst, players } = start(n);
      playRound(inst, players, answers);
      assert.strictEqual(stateOf(inst).phase, "collect", `${n}: the game continues`);
      assert.strictEqual(stateOf(inst).round, 1, `${n}: round two starts`);
    }
  });

  test("a missing answer never triggers the early N-1 end", () => {
    const round = scoreRound(["apple", "apple", "apple", "apple", ""]);
    assert.strictEqual(round.nearMatch, false);
    assert.strictEqual(round.allMatched, false);
    assert.deepStrictEqual(round.points, [675, 675, 675, 675, 0]);
  });

  test("one player's maximum round score stays within 1500 at 2-8 players", () => {
    for (let n = 2; n <= 8; n++) {
      const scenarios = [
        Array.from({ length: n }, () => "apple"),
        [...Array.from({ length: n - 1 }, () => "apple"), "pear"],
        Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "apple" : "pear")),
        Array.from({ length: n }, (_, i) => `word${i}`),
      ];
      for (const answers of scenarios) {
        const best = Math.max(...scoreRound(answers).points);
        assert.ok(best <= MAX_ROUND_SCORE, `${n}: ${best} exceeds the round bound`);
      }
    }
  });
});

describe("mind meld playthroughs", () => {
  test("two players play the six-round standalone game", () => {
    const { inst, players } = start(2);
    assert.strictEqual(stateOf(inst).maxRounds, 6);

    for (let round = 0; round < 5; round++) {
      playRound(inst, players, [`round${round}a`, `round${round}b`]);
      assert.strictEqual(stateOf(inst).phase, "collect", `round ${round + 1}: next round`);
    }
    playRound(inst, players, ["lasta", "lastb"]);
    assert.strictEqual(stateOf(inst).phase, "finished", "six rounds finish the game");
    assert.deepStrictEqual(stateOf(inst).scores, [0, 0], "distinct answers never score");
  });

  test("eight players play the five-round standalone game", () => {
    const { inst, players } = start(8);
    const screen = screenOf(inst);
    assert.strictEqual(screen.maxRounds, 5);
    assert.strictEqual(screen.playerCount, 8);

    for (let round = 0; round < 5; round++) {
      playRound(
        inst,
        players,
        players.map((_, index) => `round${round}word${index}`),
      );
    }
    assert.strictEqual(stateOf(inst).phase, "finished", "five rounds finish the game");
    assert.strictEqual(screenOf(inst).finished, true);
  });
});

describe("mind meld TV payload and stats", () => {
  test("the reveal publishes all eight answer rows and hides them while collecting", () => {
    const { inst, players } = start(8);
    const initial = screenOf(inst);
    assert.deepStrictEqual(initial.answers, [], "answers stay hidden");
    assert.deepStrictEqual(initial.waitingOn, players.map((p) => p.name));
    assert.strictEqual(initial.caption, null);
    assert.strictEqual(initial.sound, null);

    players.forEach((player, index) => {
      plugin.onInput(inst, player.id, { text: `word${index}` });
      if (index < 7) {
        assert.strictEqual(screenOf(inst).waitingOn.length, 7 - index, "one fewer name each time");
        assert.deepStrictEqual(screenOf(inst).answers, [], "still hidden");
      }
    });

    const reveal = screenOf(inst);
    assert.strictEqual(reveal.phase, "reveal");
    assert.strictEqual(reveal.submitted, 8);
    assert.strictEqual(reveal.answers.length, 8, "eight-cell reveal grid");
    assert.deepStrictEqual(reveal.waitingOn, []);
    assert.ok(reveal.answers.every((row) => row.name && row.answer), "every row has a name and answer");
    assert.strictEqual(typeof reveal.caption, "string");
    assert.ok(reveal.caption && reveal.caption.length > 0, "a reveal caption is published");
    assert.strictEqual(reveal.sound, "reveal");
    assert.strictEqual(reveal.nearMatch, false, "all distinct answers are no near match");
  });

  test("results report matches and roundsWon per player", () => {
    const { inst, players } = start(5);
    playRound(inst, players, ["apple", "apple", "apple", "banana", "cherry"]);
    const results = plugin.results?.(inst);
    assert.ok(results, "results hook exists");
    assert.strictEqual(results.standings.length, 5);
    for (const player of players) {
      const matches = results.stats[`${player.id}:matches`];
      const roundsWon = results.stats[`${player.id}:roundsWon`];
      assert.ok(Number.isFinite(matches), `${player.id}: matches`);
      assert.ok(Number.isFinite(roundsWon), `${player.id}: roundsWon`);
    }
    assert.strictEqual(results.stats["p0:matches"], 2, "three-way match counts two others");
    assert.strictEqual(results.stats["p0:roundsWon"], 1);
    assert.strictEqual(results.stats["p3:matches"], 0);
    assert.strictEqual(results.stats["p3:roundsWon"], 0);
    assert.deepStrictEqual(
      results.standings.filter((row) => row.raw === 450).map((row) => row.playerId),
      ["p0", "p1", "p2"],
    );
  });

  test("the eight-answer reveal grid renders at both target resolutions", () => {
    assert.strictEqual(mindmeldGridColumns(2), 2);
    assert.strictEqual(mindmeldGridColumns(4), 2);
    assert.strictEqual(mindmeldGridColumns(5), 4);
    assert.strictEqual(mindmeldGridColumns(8), 4);

    const { inst, players } = start(8);
    submit(inst, players, players.map((_, index) => `word${index}`));
    const reveal = screenOf(inst);
    assert.strictEqual(reveal.answers.length, 8);

    const ctx = recordingContext();
    const draw = reveal as unknown as Parameters<typeof renderMindmeld>[3];
    renderMindmeld(ctx, 1920, 1080, draw);
    renderMindmeld(ctx, 1280, 720, draw);

    // The finished panel must also fit all eight standings rows.
    const fullTable = start(8);
    submit(fullTable.inst, fullTable.players, fullTable.players.map(() => "apple"));
    tickUntil(fullTable.inst, () => stateOf(fullTable.inst).phase === "finished");
    const finished = screenOf(fullTable.inst) as unknown as Parameters<typeof renderMindmeld>[3];
    renderMindmeld(ctx, 1920, 1080, finished);
    renderMindmeld(ctx, 1280, 720, finished);
  });
});

/** Minimal recording 2D context: unknown canvas methods are no-ops. */
function recordingContext(): CanvasRenderingContext2D {
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
