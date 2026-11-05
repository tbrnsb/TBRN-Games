/** Slide Roulette: star average, presenter scoring, and a scripted round. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { averageRating, presenterPoints } from "../games/slideroulette/server.ts";

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "slideroulette", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("slide roulette", () => {
  test("averages only real stars", () => {
    assert.strictEqual(averageRating([5, 4, null]), 4.5);
    assert.strictEqual(averageRating([null, null]), 0);
    assert.strictEqual(averageRating([5, 0, 9]), 5, "out-of-range values are ignored");
  });

  test("presenter scores 200 per star", () => {
    assert.strictEqual(presenterPoints(4.5), 900);
    assert.strictEqual(presenterPoints(0), 0);
    assert.strictEqual(presenterPoints(5), 1000);
  });

  test("scripted round: write, present, rate, score", async () => {
    const plugin = (await import("../games/slideroulette/server.ts")).default;
    const players = mk(3);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;

    assert.strictEqual(s.presenter, 0, "first presenter");
    plugin.onInput(inst, "p0", { text: "presenters do not write" });
    assert.strictEqual(s.submissions[0], null, "the presenter cannot submit a slide");

    plugin.onInput(inst, "p1", { text: "slide one" });
    plugin.onInput(inst, "p2", { text: "slide two" });
    assert.strictEqual(s.phase, "presenting");
    assert.strictEqual(s.deck.length, 2, "one slide per non-presenter");

    // Presenter taps through the deck.
    plugin.onInput(inst, "p0", { choice: "next" });
    assert.strictEqual(s.slideIndex, 1);
    plugin.onInput(inst, "p0", { choice: "next" });
    assert.strictEqual(s.phase, "rating");

    plugin.onInput(inst, "p0", { choice: "5" });
    assert.strictEqual(s.ratings[0], null, "the presenter cannot rate themselves");
    plugin.onInput(inst, "p1", { choice: "5" });
    plugin.onInput(inst, "p2", { choice: "5" });

    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.reveal.average, 5);
    assert.strictEqual(s.scores[0], 1000, "presenter earns 200 per star");
    assert.strictEqual(s.scores[1], 100, "slide authors earn 100 at 4+ stars");
    assert.strictEqual(s.scores[2], 100);
  });
});
