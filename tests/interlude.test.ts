/**
 * Between-game interlude and watchability helpers (Phase 2, brief 3.8).
 *
 * Pins the pure pieces the TV leans on: rank movement, the next-up card, the
 * fixed caption bank and the count-up curve. Also covers the score-table
 * normalisation that feeds the in-game ticker, so a new game cannot silently
 * break "never a dead screen".
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  CAPTION_DURATION_MS,
  INTERLUDE_DURATION_MS,
  captionFor,
  countUp,
  interludeCard,
  livePlayerCount,
  oneLineRule,
  standingsMovement,
} from "../shared/interlude.ts";
import {
  createWatchOverlay,
  drawWatchOverlay,
  leaderName,
  revealTextFromScreen,
  tickerRowsFromScreen,
  updateWatchOverlay,
  waitingNamesFromScreen,
} from "../client/screen/kit/ticker.ts";
import { seatForIndex } from "../shared/seat-identity.ts";

/** Minimal recording context: every canvas method is a no-op. */
function makeContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    measureText: (text: unknown) => ({ width: String(text).length * 8 }),
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

describe("standingsMovement", () => {
  test("ranks by position, not raw points", () => {
    // Both scores rise, but the order stays Ana then Ben: no movement.
    const movement = standingsMovement(
      [
        { playerId: "a", points: 10 },
        { playerId: "b", points: 20 },
      ],
      [
        { playerId: "a", points: 15 },
        { playerId: "b", points: 25 },
      ],
    );
    assert.deepStrictEqual(movement, [
      { playerId: "a", direction: "same" },
      { playerId: "b", direction: "same" },
    ]);
  });

  test("a rank swap moves one player up and the other down", () => {
    const movement = standingsMovement(
      [
        { playerId: "b", points: 20 },
        { playerId: "a", points: 10 },
      ],
      [
        { playerId: "a", points: 30 },
        { playerId: "b", points: 20 },
      ],
    );
    assert.deepStrictEqual(movement, [
      { playerId: "a", direction: "up" },
      { playerId: "b", direction: "down" },
    ]);
  });

  test("a tie keeps the given order and shares a rank", () => {
    // Same points, reversed order: a tie is not movement.
    const movement = standingsMovement(
      [
        { playerId: "a", points: 10 },
        { playerId: "b", points: 10 },
        { playerId: "c", points: 5 },
      ],
      [
        { playerId: "b", points: 10 },
        { playerId: "a", points: 10 },
        { playerId: "c", points: 5 },
      ],
    );
    assert.deepStrictEqual(movement, [
      { playerId: "b", direction: "same" },
      { playerId: "a", direction: "same" },
      { playerId: "c", direction: "same" },
    ]);
  });

  test("a new player is marked new and a departed player is omitted", () => {
    const movement = standingsMovement(
      [
        { playerId: "a", points: 10 },
        { playerId: "b", points: 5 },
      ],
      [
        { playerId: "c", points: 12 },
        { playerId: "a", points: 10 },
      ],
    );
    assert.deepStrictEqual(movement, [
      { playerId: "c", direction: "new" },
      { playerId: "a", direction: "down" },
    ]);
  });

  test("an empty previous list makes every current player new", () => {
    const movement = standingsMovement([], [
      { playerId: "a", points: 1 },
      { playerId: "b", points: 2 },
    ]);
    assert.deepStrictEqual(movement, [
      { playerId: "a", direction: "new" },
      { playerId: "b", direction: "new" },
    ]);
  });

  test("duplicate ids keep the first row and bad points count as zero", () => {
    const movement = standingsMovement(
      [{ playerId: "a", points: Number.NaN }],
      [
        { playerId: "a", points: 5 },
        { playerId: "a", points: 99 },
      ],
    );
    assert.deepStrictEqual(movement, [{ playerId: "a", direction: "same" }]);
  });
});

describe("interludeCard", () => {
  test("defaults to a 15-second card with the session leader", () => {
    const card = interludeCard({
      session: {
        status: "voting",
        currentGameId: null,
        leadingGameId: "quiz",
        candidates: [
          { id: "quiz", name: "Quiz", description: "Answer fast. Ten questions, more points for speed." },
          { id: "bluff", name: "Bluff", description: "Write a lie." },
        ],
      },
      players: [
        { presence: "active" },
        { presence: "active" },
        { presence: "active" },
      ],
    });

    assert.strictEqual(card.title, "That's a wrap");
    assert.strictEqual(card.gameName, "Quiz");
    assert.strictEqual(card.rule, "Answer fast.");
    assert.strictEqual(card.playerCount, 3);
    assert.strictEqual(card.durationMs, INTERLUDE_DURATION_MS);
    assert.strictEqual(INTERLUDE_DURATION_MS, 15000);
  });

  test("an explicit next game wins and the rule is one line", () => {
    const card = interludeCard({
      session: {
        leadingGameId: "quiz",
        candidates: [{ id: "quiz", name: "Quiz", description: "Old description." }],
      },
      nextGame: {
        id: "drawful",
        name: "Drawful",
        description: "Draw the prompt.\nEveryone else writes a fake title, then you all vote on the real one.",
      },
      playerCount: 6,
    });

    assert.strictEqual(card.gameName, "Drawful");
    assert.strictEqual(card.rule, "Draw the prompt.");
    assert.ok(!card.rule.includes("\n"));
    assert.strictEqual(card.playerCount, 6);
  });

  test("player count excludes spectators, away and left players", () => {
    const card = interludeCard({
      players: [
        { presence: "active" },
        { presence: "active", connected: true },
        { presence: "away" },
        { presence: "left" },
        { connected: false },
        { spectator: true, presence: "active" },
      ],
    });
    assert.strictEqual(card.playerCount, 2);
    assert.strictEqual(livePlayerCount([{ spectator: true }, { presence: "away" }]), 0);
  });

  test("no next game falls back to the host line", () => {
    const card = interludeCard({ session: null, nextGame: null, players: [{ presence: "active" }] });
    assert.strictEqual(card.gameName, "Table's choice");
    assert.ok(card.rule.length > 0);
    assert.ok(!card.rule.includes("{"));
  });

  test("a long description is truncated at a word boundary", () => {
    const long = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
    const rule = oneLineRule(long, 20);
    assert.ok(rule.length <= 21, `expected a short line, got ${rule}`);
    assert.ok(rule.endsWith("…"));
    assert.ok(!rule.includes("  "));
    assert.strictEqual(oneLineRule(undefined), "Grab your phone and follow the TV.");
  });
});

describe("captionFor", () => {
  test("is deterministic for the same seed", () => {
    for (let seed = 0; seed < 25; seed++) {
      const event = { kind: "fooled" as const, name: "Ana", count: 4, seed };
      const first = captionFor(event);
      assert.strictEqual(captionFor(event), first);
      assert.ok(first.length > 0);
    }
  });

  test("fills public names and counts with no placeholders left", () => {
    const text = captionFor({ kind: "fooled", name: "  Priya  ", count: 4, seed: 1 });
    assert.ok(text.includes("Priya"));
    assert.ok(text.includes("4"));
    assert.ok(!text.includes("{"));
    assert.ok(!text.includes("undefined"));
  });

  test("a missing name or count falls back to a generic reveal line", () => {
    for (const event of [
      { kind: "fooled" as const, seed: 0 },
      { kind: "fooled" as const, name: "Ana", seed: 0 },
      { kind: "fastest" as const, seed: 0 },
      { kind: "perfect" as const, name: "", seed: 2 },
      { kind: "catchup" as const, seed: 3 },
    ]) {
      const text = captionFor(event);
      assert.ok(text.length > 0);
      assert.ok(!text.includes("{"), `placeholder left in: ${text}`);
      assert.ok(!text.includes("undefined"), `undefined leaked into: ${text}`);
      assert.ok(!text.includes("NaN"), `NaN leaked into: ${text}`);
    }
  });

  test("the bank never mentions roles or secret values", () => {
    const forbidden = ["imposter", "larper", "secret word", "hole card", "role:"];
    for (const kind of ["fooled", "fastest", "perfect", "catchup", "reveal"] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const text = captionFor({ kind, name: "Ana", count: 3, seed }).toLowerCase();
        for (const word of forbidden) {
          assert.ok(!text.includes(word), `${kind} caption leaked "${word}": ${text}`);
        }
      }
    }
  });

  test("is stable for negative and fractional seeds", () => {
    for (const seed of [-1, -7, 2.9, Number.NaN]) {
      const text = captionFor({ kind: "reveal", seed });
      assert.ok(text.length > 0);
      assert.strictEqual(captionFor({ kind: "reveal", seed }), text);
    }
  });

  test("caption timing stays short enough to be a beat", () => {
    assert.ok(CAPTION_DURATION_MS >= 2000 && CAPTION_DURATION_MS <= 4000);
  });
});

describe("countUp", () => {
  test("lands on both endpoints", () => {
    assert.strictEqual(countUp(0, 100, 0), 0);
    assert.strictEqual(countUp(0, 100, 1), 100);
    assert.strictEqual(countUp(42, 42, 0.5), 42);
  });

  test("clamps progress outside 0..1", () => {
    assert.strictEqual(countUp(0, 100, -3), 0);
    assert.strictEqual(countUp(0, 100, 4), 100);
  });

  test("is monotonic and eases out", () => {
    let previous = -1;
    for (let step = 0; step <= 10; step++) {
      const value = countUp(0, 100, step / 10);
      assert.ok(value >= previous, `count-up went backwards at ${step}`);
      previous = value;
    }
    // Ease-out: more than half the distance is covered by the halfway point.
    assert.ok(countUp(0, 100, 0.5) > 50);
  });

  test("counts down as well as up", () => {
    assert.strictEqual(countUp(100, 0, 0), 100);
    assert.strictEqual(countUp(100, 0, 1), 0);
    assert.ok(countUp(100, 0, 0.5) < 50);
  });

  test("non-finite input degrades to the start value", () => {
    assert.strictEqual(countUp(Number.NaN, 50, 1), 50);
    assert.strictEqual(countUp(10, Number.NaN, 1), 10);
    assert.strictEqual(countUp(10, 20, Number.NaN), 10);
  });
});

describe("ticker source tables", () => {
  test("reads score, chips and progress from any table", () => {
    assert.deepStrictEqual(
      tickerRowsFromScreen({ scores: [{ name: "Ana", score: 30 }, { name: "Ben", score: 20 }] }),
      [{ name: "Ana", score: 30 }, { name: "Ben", score: 20 }],
    );
    assert.deepStrictEqual(
      tickerRowsFromScreen({ players: [{ name: "Ana", chips: 900 }, { name: "Ben", chips: 400 }] }),
      [{ name: "Ana", score: 900 }, { name: "Ben", score: 400 }],
    );
    assert.deepStrictEqual(
      tickerRowsFromScreen({ racers: [{ name: "Ana", progress: 0.8 }, { name: "Ben", progress: 0.4 }] }),
      [{ name: "Ana", score: 0.8 }, { name: "Ben", score: 0.4 }],
    );
  });

  test("ignores malformed rows, duplicates and empty tables", () => {
    assert.deepStrictEqual(tickerRowsFromScreen(null), []);
    assert.deepStrictEqual(tickerRowsFromScreen({ players: [] }), []);
    assert.deepStrictEqual(
      tickerRowsFromScreen({
        players: [
          { name: "Ana", score: 10 },
          { name: "Ana", score: 99 },
          { name: "", score: 5 },
          { name: "Ben", score: "nope" },
        ],
      }),
      [{ name: "Ana", score: 10 }],
    );
  });

  test("waits on waitingOn first, then turnName", () => {
    assert.deepStrictEqual(
      waitingNamesFromScreen({ waitingOn: [" Ana ", "Ben"], turnName: "Cleo" }),
      ["Ana", "Ben"],
    );
    assert.deepStrictEqual(waitingNamesFromScreen({ turnName: "Cleo" }), ["Cleo"]);
    assert.deepStrictEqual(waitingNamesFromScreen({}), []);
  });

  test("normalises reveal strings and arrays", () => {
    assert.strictEqual(revealTextFromScreen({ reveal: "The answer" }), "The answer");
    assert.strictEqual(revealTextFromScreen({ reveal: ["Ana", "Ben"] }), "Ana · Ben");
    assert.strictEqual(revealTextFromScreen({ reveal: [] }), null);
    assert.strictEqual(revealTextFromScreen({}), null);
  });
});

describe("watch overlay state", () => {
  const row = (name: string, score: number) => ({
    name,
    seat: seatForIndex(name.length % 2),
    score,
  });

  test("the leader flashes only after a real change", () => {
    const state = createWatchOverlay();
    updateWatchOverlay(state, {
      rows: [row("Ana", 10), row("Ben", 5)],
      waitingNames: [],
      timeLeft: null,
      caption: null,
      reveal: null,
      now: 1000,
      reducedMotion: false,
    });
    assert.strictEqual(leaderName([{ name: "Ana", score: 10 }, { name: "Ben", score: 5 }]), "Ana");
    assert.strictEqual(state.leader, "Ana");
    assert.strictEqual(state.leaderFlashStart, 0);

    updateWatchOverlay(state, {
      rows: [row("Ana", 10), row("Ben", 20)],
      waitingNames: [],
      timeLeft: null,
      caption: null,
      reveal: null,
      now: 2000,
      reducedMotion: false,
    });
    assert.strictEqual(state.leader, "Ben");
    assert.strictEqual(state.leaderFlashStart, 2000);
  });

  test("counters retarget when a score changes", () => {
    const state = createWatchOverlay();
    const base = {
      waitingNames: [],
      timeLeft: null,
      caption: null,
      reveal: null,
      reducedMotion: false,
    };
    updateWatchOverlay(state, { ...base, rows: [row("Ana", 10)], now: 0 });
    updateWatchOverlay(state, { ...base, rows: [row("Ana", 40)], now: 100 });
    assert.deepStrictEqual(state.counters.get("Ana"), { from: 10, to: 40, start: 100 });

    // A second change captures the value shown at that moment, not the old target.
    updateWatchOverlay(state, { ...base, rows: [row("Ana", 50)], now: 200 });
    const counter = state.counters.get("Ana");
    assert.ok(counter);
    assert.strictEqual(counter.to, 50);
    assert.ok(counter.from >= 10 && counter.from <= 40);
  });

  test("caption and reveal timers restart only on new text", () => {
    const state = createWatchOverlay();
    const base = {
      rows: [row("Ana", 1)],
      waitingNames: [],
      timeLeft: null,
      reducedMotion: false,
    };
    updateWatchOverlay(state, { ...base, caption: "First", reveal: "Ra", now: 500 });
    assert.strictEqual(state.captionStart, 500);
    const firstRevealStart = state.revealStart;

    updateWatchOverlay(state, { ...base, caption: "First", reveal: "Ra", now: 900 });
    assert.strictEqual(state.captionStart, 500);
    assert.strictEqual(state.revealStart, firstRevealStart);

    updateWatchOverlay(state, { ...base, caption: "Second", reveal: "Rb", now: 1200 });
    assert.strictEqual(state.captionStart, 1200);
    assert.strictEqual(state.revealStart, 1200);
  });

  test("draws at 1080p and 720p with eight seats and every overlay on", () => {
    const state = createWatchOverlay();
    const rows = Array.from({ length: 8 }, (_, index) => ({
      name: `Player ${index + 1}`,
      seat: seatForIndex(index),
      score: (8 - index) * 100,
    }));

    updateWatchOverlay(state, {
      rows,
      waitingNames: ["Player 2", "Player 7"],
      timeLeft: 14000,
      caption: "Priya fooled four people!",
      reveal: "The answer was: lighthouse",
      now: 1000,
      reducedMotion: false,
    });

    const ctx = makeContext();
    assert.doesNotThrow(() => drawWatchOverlay(ctx, 1920, 1080, state, 1200, false));
    assert.doesNotThrow(() => drawWatchOverlay(ctx, 1280, 720, state, 1200, false));
    assert.doesNotThrow(() => drawWatchOverlay(ctx, 1280, 720, state, 1200, true));
  });
});
