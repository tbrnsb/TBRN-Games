/**
 * Bracket Brawl: power-of-two bracket shapes, bye handling, duel decisions,
 * voter eligibility, per-round scoring, hooks and TV layout.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  bracketRounds,
  bracketSize,
  buildBracket,
  decideDuel,
} from "../games/bracket/server.ts";
import { bracketCardLayout, renderBracket } from "../games/bracket/screen.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";

const NAMES = ["Ana", "Ben", "Cleo", "Dev", "Eve", "Fay"];

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: NAMES[i] ?? `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));

type Player = ReturnType<typeof mk>[number];

const room = (players: Player[]) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "bracket", gameState: null, createdAt: 0, status: "playing" as const,
});

interface BracketPlugin {
  onStart(room: unknown, players: Player[]): { players: Player[]; state: any };
  onInput(instance: any, playerId: string, input: unknown): void;
  onTick(instance: any, deltaMs: number): void;
  screenState(instance: any): any;
  controllerState(instance: any, playerId: string): any;
  results?(instance: any): any;
}

async function loadPlugin(): Promise<BracketPlugin> {
  const mod = await import("../games/bracket/server.ts");
  return mod.default as unknown as BracketPlugin;
}

/** Player index that authored an entry (entry index === seat in this game). */
function authorOf(state: any, entry: number): number {
  return entry >= 0 ? state.entries[entry]?.author ?? -1 : -1;
}

/** Resolve a duel's two slots to entry indices (earlier matches are settled). */
function resolvedSides(state: any, index: number): { a: number; b: number } {
  const resolve = (slot: number): number =>
    slot >= 0 ? slot : state.duels[-slot - 1]?.winner ?? -1;
  return { a: resolve(state.duels[index].a), b: resolve(state.duels[index].b) };
}

function submitAnswers(plugin: BracketPlugin, instance: any, players: Player[]): void {
  for (const player of players) plugin.onInput(instance, player.id, { text: `answer from ${player.id}` });
}

/**
 * Vote through every duel, steering `champion` to win. Voters back the
 * champion's side when present, otherwise side "a" — which also lets the
 * champion collect voter points in parallel duels.
 */
function playBracket(plugin: BracketPlugin, instance: any, players: Player[], champion: number): void {
  const state = instance.state;
  let guard = 0;
  while (state.phase === "voting" && guard++ < 50) {
    const index = state.current;
    const sides = resolvedSides(state, index);
    const aAuthor = authorOf(state, sides.a);
    const bAuthor = authorOf(state, sides.b);
    const side = aAuthor === champion ? "a" : bAuthor === champion ? "b" : "a";
    for (let seat = 0; seat < players.length; seat++) {
      if (seat === aAuthor || seat === bAuthor) continue;
      if (state.duels[index].votes[seat] !== null) continue;
      plugin.onInput(instance, players[seat].id, { choice: side });
    }
  }
}

function playToFinish(plugin: BracketPlugin, instance: any, players: Player[], champion: number): void {
  const state = instance.state;
  let guard = 0;
  while (state.phase !== "finished" && guard++ < 200) {
    if (state.phase === "writing") submitAnswers(plugin, instance, players);
    else if (state.phase === "voting") playBracket(plugin, instance, players, champion);
    else plugin.onTick(instance, 5000);
  }
}

describe("bracket brawl: bracket shape", () => {
  test("bracketSize pads up to the next power of two", () => {
    assert.strictEqual(bracketSize(3), 4);
    assert.strictEqual(bracketSize(4), 4);
    assert.strictEqual(bracketSize(5), 8);
    assert.strictEqual(bracketSize(6), 8);
    assert.strictEqual(bracketSize(1), 1);
    assert.strictEqual(bracketSize(0), 0);
  });

  test("three and four players match today's fixtures", () => {
    assert.deepStrictEqual(buildBracket(3), [{ a: 0, b: 1 }, { a: -1, b: 2 }]);
    assert.deepStrictEqual(buildBracket(4), [
      { a: 0, b: 1 },
      { a: 2, b: 3 },
      { a: -1, b: -2 },
    ]);
    assert.strictEqual(buildBracket(4).length, 3);
  });

  test("every count 3-6 has N-1 matches and each player appears once", () => {
    for (const count of [3, 4, 5, 6]) {
      const matches = buildBracket(count);
      assert.strictEqual(matches.length, count - 1, `${count}: single elimination is N-1 matches`);
      const appearances = new Map<number, number>();
      matches.forEach((match, index) => {
        for (const slot of [match.a, match.b]) {
          if (slot >= 0) {
            appearances.set(slot, (appearances.get(slot) ?? 0) + 1);
          } else {
            assert.ok(-slot - 1 < index, `${count}: match ${index} reads a later match`);
          }
        }
      });
      for (let player = 0; player < count; player++) {
        assert.strictEqual(appearances.get(player), 1, `${count}: player ${player} must appear once`);
      }
      assert.strictEqual(appearances.size, count, `${count}: no phantom entries`);
    }
  });

  test("byes are one per first-round pair and nobody waits more than one round", () => {
    for (const count of [3, 4, 5, 6]) {
      const matches = buildBracket(count);
      const rounds = bracketRounds(matches);
      const size = bracketSize(count);

      const opening = new Set<number>();
      matches.forEach((match, index) => {
        if (rounds[index] !== 0) return;
        for (const slot of [match.a, match.b]) if (slot >= 0) opening.add(slot);
      });
      assert.strictEqual(count - opening.size, size - count, `${count}: bye count`);

      for (let player = 0; player < count; player++) {
        let firstRound = Number.POSITIVE_INFINITY;
        matches.forEach((match, index) => {
          if (match.a === player || match.b === player) firstRound = Math.min(firstRound, rounds[index]);
        });
        assert.ok(firstRound <= 1, `${count}: player ${player} waits more than one bye`);
      }
    }
  });

  test("five and six players add an opening round", () => {
    assert.strictEqual(Math.max(...bracketRounds(buildBracket(3))), 1);
    assert.strictEqual(Math.max(...bracketRounds(buildBracket(4))), 1);
    assert.strictEqual(Math.max(...bracketRounds(buildBracket(5))), 2);
    assert.strictEqual(Math.max(...bracketRounds(buildBracket(6))), 2);
  });

  test("a supplied order seeds the bracket without losing a player", () => {
    const matches = buildBracket(5, [4, 3, 2, 1, 0]);
    assert.strictEqual(matches.length, 4);
    const entries = matches.flatMap((match) => [match.a, match.b]).filter((slot) => slot >= 0).sort((a, b) => a - b);
    assert.deepStrictEqual(entries, [0, 1, 2, 3, 4]);
  });

  test("majority decides a duel and a tie falls to the tie-break pick", () => {
    assert.strictEqual(decideDuel(["a", "a", "b", null], 1), "a");
    assert.strictEqual(decideDuel(["b", "b", "a"], 0), "b");
    assert.strictEqual(decideDuel(["a", "b", null], 0), "a", "tie pick 0");
    assert.strictEqual(decideDuel(["a", "b", null], 1), "b", "tie pick 1");
    assert.strictEqual(decideDuel([null, null], 0), "a", "no votes is a tie");
  });
});

describe("bracket brawl: game flow and scoring", () => {
  test("scripted three-player game: only non-participants vote, and winners score", async () => {
    const plugin = await loadPlugin();
    const players = mk(3);
    const instance = plugin.onStart(room(players), players);
    const state = instance.state;

    for (const player of players) plugin.onInput(instance, player.id, { text: `answer from ${player.id}` });
    assert.strictEqual(state.phase, "voting");
    assert.strictEqual(state.duels.length, 2, "three players: one duel then a final");

    const first = resolvedSides(state, 0);
    const aAuthor = authorOf(state, first.a);
    const bAuthor = authorOf(state, first.b);
    const bye = players.map((_, i) => i).find((seat) => seat !== aAuthor && seat !== bAuthor);
    assert.ok(bye !== undefined, "exactly one player has the bye");

    // Duel 0 is a head-to-head, so neither participant may vote.
    const before = state.duels[0].votes.filter((vote: unknown) => vote !== null).length;
    plugin.onInput(instance, players[aAuthor].id, { choice: "a" });
    assert.strictEqual(state.duels[0].votes.filter((vote: unknown) => vote !== null).length, before, "participants cannot vote");

    plugin.onInput(instance, players[bye].id, { choice: "a" });
    assert.strictEqual(state.duels[0].winner, first.a, "side a wins the duel");
    assert.strictEqual(state.scores[aAuthor], 500, "duel win is 500");
    assert.strictEqual(state.scores[bye], 100, "a correct voter earns 100");

    // Final: the duel winner against the bye entry. Only the eliminated player votes.
    const final = resolvedSides(state, 1);
    const winnerSide = authorOf(state, final.a) === aAuthor ? "a" : "b";
    plugin.onInput(instance, players[bAuthor].id, { choice: winnerSide });
    assert.strictEqual(authorOf(state, state.duels[1].winner), aAuthor);
    assert.strictEqual(state.scores[aAuthor], 1500, "final win is 1000 on top of the duel");
    assert.strictEqual(state.phase, "reveal", "the last duel ends the bracket");
  });

  test("five and six players finish one full bracket with sane scores", async () => {
    const plugin = await loadPlugin();
    for (const count of [5, 6]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const state = instance.state;
      assert.strictEqual(state.maxRounds, 1, `${count}: one full bracket`);

      playToFinish(plugin, instance, players, 0);

      assert.strictEqual(state.phase, "finished", `${count}: finished`);
      assert.strictEqual(state.duels.length, count - 1, `${count}: every match ran`);
      const screen = plugin.screenState(instance);
      assert.strictEqual(screen.finished, true, `${count}: screen finished`);
      assert.strictEqual(screen.maxRounds, 1, `${count}: screen reports one bracket`);
      assert.ok(screen.winner, `${count}: a champion is named`);
      for (const score of state.scores) {
        assert.ok(Number.isFinite(score), `${count}: finite score`);
        assert.ok(score >= 0, `${count}: no negative score`);
        assert.ok(score <= MAX_ROUND_SCORE, `${count}: ${score} exceeds the round bound`);
      }
      assert.strictEqual(state.scores[0], MAX_ROUND_SCORE, `${count}: a champion tops out at the bound`);
    }
  });

  test("three and four players keep the two-bracket structure", async () => {
    const plugin = await loadPlugin();
    for (const count of [3, 4]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const state = instance.state;
      assert.strictEqual(state.maxRounds, 2, `${count}: two brackets`);
      submitAnswers(plugin, instance, players);
      assert.strictEqual(state.duels.length, count - 1, `${count}: bracket shape`);
    }
  });

  test("four players keep the uncapped 1600 path", async () => {
    const plugin = await loadPlugin();
    const players = mk(4);
    const instance = plugin.onStart(room(players), players);
    const state = instance.state;

    submitAnswers(plugin, instance, players);
    assert.strictEqual(state.duels.length, 3, "two semis and a final");

    const semiA = resolvedSides(state, 0);
    const champion = authorOf(state, semiA.a);
    const aOpponent = authorOf(state, semiA.b);
    const semiB = resolvedSides(state, 1);
    const bA = authorOf(state, semiB.a);
    const bB = authorOf(state, semiB.b);

    // Semi A: only the other semi's players vote, so the champion's side wins.
    plugin.onInput(instance, players[bA].id, { choice: "a" });
    plugin.onInput(instance, players[bB].id, { choice: "a" });
    assert.strictEqual(state.scores[champion], 500, "semi win is 500");
    assert.strictEqual(state.scores[bA], 100, "a correct voter earns 100");

    // Semi B: the champion is free to vote and backs the winner for 100.
    plugin.onInput(instance, players[champion].id, { choice: "a" });
    plugin.onInput(instance, players[aOpponent].id, { choice: "a" });
    assert.strictEqual(state.scores[champion], 600, "semi win plus a correct parallel vote");

    // Final: the champion beats the other semi winner for 1000 more.
    const final = resolvedSides(state, 2);
    const championSide = authorOf(state, final.a) === champion ? "a" : "b";
    plugin.onInput(instance, players[aOpponent].id, { choice: championSide });
    plugin.onInput(instance, players[bB].id, { choice: championSide });

    assert.strictEqual(state.scores[champion], 1600, "500 + 100 + 1000 survives uncapped");
    assert.strictEqual(state.roundGain[champion], 1600, "the 3-4 round is uncapped");
    assert.strictEqual(state.phase, "reveal");
  });

  test("the 1500 cap binds only from five players", async () => {
    const plugin = await loadPlugin();
    for (const count of [5, 6]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const state = instance.state;

      submitAnswers(plugin, instance, players);
      const champion = authorOf(state, resolvedSides(state, 0).a);
      playBracket(plugin, instance, players, champion);

      assert.strictEqual(state.phase, "reveal", `${count}: round ends in a reveal`);
      const wins = state.stats[`${players[champion].id}:duelWins`];
      const votes = state.stats[`${players[champion].id}:votesCorrect`];
      const uncapped = 1000 + 500 * (wins - 1) + 100 * votes;
      assert.ok(uncapped > MAX_ROUND_SCORE, `${count}: the uncapped path is ${uncapped}`);
      assert.strictEqual(state.scores[champion], MAX_ROUND_SCORE, `${count}: capped at 1500`);
      assert.strictEqual(state.roundGain[champion], MAX_ROUND_SCORE, `${count}: round gain capped`);
      for (const gain of state.roundGain) {
        assert.ok(gain <= MAX_ROUND_SCORE, `${count}: ${gain} exceeds ${MAX_ROUND_SCORE}`);
        assert.ok(withinRoundBound(gain), `${count}: sanity helper rejected ${gain}`);
      }
    }
  });

  test("waitingOn, caption, sound and results describe the current beat", async () => {
    const plugin = await loadPlugin();
    const players = mk(4);
    const instance = plugin.onStart(room(players), players);
    const state = instance.state;

    const writing = plugin.screenState(instance);
    assert.deepStrictEqual(writing.waitingOn, NAMES.slice(0, 4));
    assert.strictEqual(writing.caption, null);
    assert.strictEqual(writing.sound, null);
    assert.strictEqual(writing.playerCount, 4);

    plugin.onInput(instance, players[0].id, { text: "first answer" });
    assert.deepStrictEqual(plugin.screenState(instance).waitingOn, NAMES.slice(1, 4));

    submitAnswers(plugin, instance, players.slice(1));
    const voting = plugin.screenState(instance);
    assert.strictEqual(voting.phase, "voting");
    const sides = resolvedSides(state, 0);
    const voters = players
      .map((_, i) => i)
      .filter((seat) => seat !== authorOf(state, sides.a) && seat !== authorOf(state, sides.b))
      .map((seat) => players[seat].name)
      .sort();
    assert.deepStrictEqual([...voting.waitingOn].sort(), voters, "waitingOn lists the eligible voters");

    playBracket(plugin, instance, players, authorOf(state, sides.a));
    const reveal = plugin.screenState(instance);
    assert.strictEqual(reveal.phase, "reveal");
    assert.strictEqual(reveal.sound, "reveal");
    assert.deepStrictEqual(reveal.waitingOn, []);
    assert.ok(typeof reveal.caption === "string" && reveal.caption.length > 0, "the final reveal has a caption");

    const result = plugin.results?.(instance);
    assert.ok(result, "bracket exposes results()");
    assert.strictEqual(result.standings.length, 4);
    for (const player of players) {
      assert.ok(Number.isFinite(result.stats[`${player.id}:duelWins`]), "duelWins stat per player");
      assert.ok(Number.isFinite(result.stats[`${player.id}:votesCorrect`]), "votesCorrect stat per player");
    }
    assert.strictEqual(
      players.reduce((total, player) => total + result.stats[`${player.id}:duelWins`], 0),
      3,
      "every match win is recorded",
    );
  });
});

describe("bracket brawl: TV layout", () => {
  /** Minimal recording context: every unknown canvas method is a no-op. */
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

  test("every match gets a non-overlapping card at 1080p and 720p", () => {
    for (const count of [3, 4, 5, 6]) {
      const matches = buildBracket(count);
      const rounds = bracketRounds(matches);
      const duels = matches.map((_, index) => ({ round: rounds[index] }));

      for (const [width, height] of [[1920, 1080], [1280, 720]] as const) {
        const cards = bracketCardLayout(width, height, duels);
        assert.strictEqual(cards.length, count - 1, `${count}@${width}: one card per match`);

        for (const card of cards) {
          assert.ok(card.width > 0 && card.height > 0, `${count}@${width}: positive card size`);
          assert.ok(card.x >= 0 && card.y >= 0, `${count}@${width}: card starts on screen`);
          assert.ok(card.x + card.width <= width + 0.5, `${count}@${width}: card fits horizontally`);
          assert.ok(card.y + card.height <= height + 0.5, `${count}@${width}: card fits vertically`);
        }

        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i];
            const b = cards[j];
            const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
            const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
            assert.ok(!(overlapX && overlapY), `${count}@${width}: cards ${a.index}/${b.index} overlap`);
          }
        }
      }
    }
  });

  test("a six-player bracket draws in voting, reveal and finished states", async () => {
    const plugin = await loadPlugin();
    const players = mk(6);
    const instance = plugin.onStart(room(players), players);
    const state = instance.state;

    submitAnswers(plugin, instance, players);
    const votingScreen = plugin.screenState(instance);
    const sides = resolvedSides(state, 0);
    playBracket(plugin, instance, players, authorOf(state, sides.a));
    assert.strictEqual(state.phase, "reveal");
    const revealScreen = plugin.screenState(instance);

    let guard = 0;
    while (state.phase !== "finished" && guard++ < 50) plugin.onTick(instance, 5000);
    const finishedScreen = plugin.screenState(instance);

    for (const screen of [votingScreen, revealScreen, finishedScreen]) {
      for (const [width, height] of [[1920, 1080], [1280, 720]] as const) {
        const ctx = recordingContext();
        assert.doesNotThrow(
          () => renderBracket(ctx, width, height, screen),
          `render threw at ${width}x${height} in ${screen.phase}`,
        );
      }
    }
    assert.strictEqual(finishedScreen.duels.length, 5, "all six-player matches are on the TV");
    assert.ok(finishedScreen.duels.every((duel: any) => typeof duel.aPlayer === "string"));
  });
});
