/**
 * Stowaway: accusation tally, 3-8 player flow, the three-word clue cap, the
 * brief's payouts, the rotating Stowaway seat and TV secrecy before the reveal.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import {
  MAX_ROUND_SCORE,
  scalePayout,
  withinRoundBound,
} from "../shared/scoring.ts";
import { voteLayout } from "../shared/vote-options.ts";
import stowawayPlugin, {
  CATEGORY_OPTIONS,
  MAX_CLUE_WORDS,
  cleanClue,
  stowawayFor,
  tallyAccusation,
} from "../games/stowaway/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface StowState {
  round: number;
  maxRounds: number;
  phase: string;
  stowaway: number;
  category: string;
  decoys: string[];
  clues: Array<string | null>;
  votes: Array<number | null>;
  catchChoice: string | null;
  scores: number[];
  reveal: { caught: boolean; accused: number | null; categoryGuess: string | null } | null;
  stats: Record<string, number>;
}

interface StowInstance {
  roomId: string;
  players: TestPlayer[];
  state: StowState;
}

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function startGame(count: number): { players: TestPlayer[]; inst: StowInstance } {
  const players = makePlayers(count);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0].id,
    players,
    gameId: "stowaway",
    gameState: null,
    createdAt: 0,
    status: "playing" as const,
  };
  return { players, inst: stowawayPlugin.onStart(room, players) as unknown as StowInstance };
}

/** Advance the clock until `phase`, the game finishes, or a step budget ends. */
function advanceTo(inst: StowInstance, phase: string): void {
  for (let i = 0; i < 200 && inst.state.phase !== phase && inst.state.phase !== "finished"; i++) {
    stowawayPlugin.onTick(inst, 2000);
  }
}

/**
 * Vote for a seat that is neither the voter nor the Stowaway: the accusation
 * lands on an innocent player, so the Stowaway always escapes.
 */
function innocentTarget(inst: StowInstance, voter: number): number | null {
  const stowaway = inst.state.stowaway;
  const options = inst.players
    .map((_, index) => index)
    .filter((index) => index !== voter && index !== stowaway);
  return options.length > 0 ? options[0] : null;
}

/**
 * Cast one vote per non-Stowaway seat. `target` receives the voter index and
 * returns the seat to accuse (or null to abstain).
 */
function castVotes(
  inst: StowInstance,
  players: TestPlayer[],
  target: (voter: number) => number | null,
): void {
  const stowaway = inst.state.stowaway;
  players.forEach((player, i) => {
    if (i === stowaway) return;
    const choice = target(i);
    if (choice === null) return;
    stowawayPlugin.onInput(inst, player.id, { choice: `p:${choice}` });
  });
}

/** Play one round from the brief, leaving the instance at the reveal. */
function playRound(
  inst: StowInstance,
  players: TestPlayer[],
  options: { caught?: boolean; guessCorrect?: boolean } = {},
): void {
  advanceTo(inst, "clue");
  for (const player of players) stowawayPlugin.onInput(inst, player.id, { text: "salt water" });
  advanceTo(inst, "vote");

  const stowaway = inst.state.stowaway;
  if (options.caught) {
    castVotes(inst, players, () => stowaway);
    if (inst.state.phase === "catchguess" && options.guessCorrect) {
      stowawayPlugin.onInput(inst, players[stowaway].id, { choice: inst.state.category });
    }
  } else {
    castVotes(inst, players, (voter) => innocentTarget(inst, voter));
  }
}

describe("stowaway", () => {
  test("a strict majority on the real Stowaway catches them", () => {
    assert.deepStrictEqual(tallyAccusation([1, 1, null, 1], 1), { accused: 1, caught: true });
  });

  test("a tie never catches anyone", () => {
    const result = tallyAccusation([1, 2, null, null], 1);
    assert.strictEqual(result.caught, false, "1-1 tie is not a catch");
  });

  test("no votes means nobody is accused", () => {
    assert.deepStrictEqual(tallyAccusation([null, null, null], 0), { accused: null, caught: false });
  });

  test("garbage votes are ignored, not counted", () => {
    const result = tallyAccusation([-5, 99, null], 0);
    assert.strictEqual(result.caught, false, "a single stray vote is not a majority");
  });

  test("scripted round: everyone clues, votes catch the Stowaway, category guess pays", async () => {
    const plugin = (await import("../games/stowaway/server.ts")).default;
    const players = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
    const room = { id: "r1", code: "ABCDE", hostPlayerId: "p0", players, gameId: "stowaway", gameState: null, createdAt: 0, status: "playing" as const };
    const inst = plugin.onStart(room, players) as any;
    const s = inst.state as any;

    // Skip the brief phase.
    for (let i = 0; i < 4 && s.phase === "brief"; i++) plugin.onTick(inst, 2000);
    assert.strictEqual(s.phase, "clue");

    for (const p of players) plugin.onInput(inst, p.id, { text: "water" });
    assert.strictEqual(s.phase, "discussion");

    for (let i = 0; i < 20 && s.phase === "discussion"; i++) plugin.onTick(inst, 2000);
    assert.strictEqual(s.phase, "vote");

    // Stowaway is p0 this round: p1 and p2 accuse them.
    plugin.onInput(inst, "p1", { choice: "p:0" });
    plugin.onInput(inst, "p2", { choice: "p:0" });
    assert.strictEqual(s.phase, "catchguess", "a majority catches the Stowaway");

    // The Stowaway guesses the real category.
    plugin.onInput(inst, "p0", { choice: s.category });
    assert.strictEqual(s.phase, "reveal");
    assert.strictEqual(s.scores[1], 500, "correct detective scores");
    assert.strictEqual(s.scores[2], 500, "correct detective scores");
    assert.strictEqual(s.scores[0], 500, "caught Stowaway still earns the category guess");
  });

  test("playthrough at three players: three rounds, distinct Stowaways, points land", () => {
    const { players, inst } = startGame(3);
    const seen: number[] = [];

    // Round 1: caught, the Stowaway names the category.
    seen.push(inst.state.stowaway);
    playRound(inst, players, { caught: true, guessCorrect: true });
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.scores[0], 500, "guess bonus");
    assert.strictEqual(inst.state.scores[1], 500);
    assert.strictEqual(inst.state.scores[2], 500);
    assert.ok(inst.state.reveal?.caught);

    // Round 2: escaped.
    advanceTo(inst, "brief");
    seen.push(inst.state.stowaway);
    const beforeEscape = [...inst.state.scores];
    playRound(inst, players, { caught: false });
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.reveal?.caught, false);
    assert.strictEqual(
      inst.state.scores[1] - beforeEscape[1],
      1000,
      "an uncaught Stowaway takes 1000",
    );

    // Round 3: caught but the catch phase times out with no guess.
    advanceTo(inst, "brief");
    seen.push(inst.state.stowaway);
    playRound(inst, players, { caught: true, guessCorrect: false });
    assert.strictEqual(inst.state.phase, "catchguess");
    const beforeTimeout = inst.state.scores[2];
    advanceTo(inst, "reveal");
    assert.strictEqual(inst.state.catchChoice, null, "no guess is a miss");
    assert.strictEqual(inst.state.scores[2], beforeTimeout, "a caught Stowaway with no guess scores nothing");

    advanceTo(inst, "finished");
    assert.strictEqual(inst.state.phase, "finished");
    assert.strictEqual(inst.state.maxRounds, 3);
    assert.deepStrictEqual(seen, [0, 1, 2], "the Stowaway rotates through every seat once");
  });

  test("playthrough at eight players: eight clues, eight TV options, three rounds", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(inst.state.maxRounds, 3, "standalone runs three rounds");

    const seen: number[] = [];
    for (let round = 0; round < 3; round++) {
      seen.push(inst.state.stowaway);
      advanceTo(inst, "clue");
      for (const player of players) {
        stowawayPlugin.onInput(inst, player.id, { text: `${player.name} clue` });
      }
      assert.strictEqual(inst.state.phase, "discussion");
      assert.strictEqual(inst.state.clues.filter((clue) => clue !== null).length, 8);

      const screen = stowawayPlugin.screenState(inst) as {
        clues: unknown[];
        options: Array<{ id: string; label: string; text: string; votes: number; selected: boolean }>;
        optionColumns: number;
      };
      assert.strictEqual(screen.clues.length, 8, "all eight clues reach the TV");
      assert.strictEqual(screen.options.length, 8, "all eight seats get an option");
      assert.strictEqual(screen.optionColumns, 2);
      assert.ok(
        screen.options.every((option) => typeof option.votes === "number" && option.votes === 0),
        "every option keeps a numeric votes key before the reveal",
      );
      assert.strictEqual(voteLayout(screen.options.length).columns, 2, "8 options use the 7-9 layout");
      assert.deepStrictEqual(voteLayout(8).letters, ["A", "B", "C", "D", "E", "F", "G", "H"]);

      advanceTo(inst, "vote");
      const controller = stowawayPlugin.controllerState(inst, players[0].id) as {
        options: Array<{ id: string; label: string }>;
      };
      assert.strictEqual(controller.options.length, 7, "a phone never offers its own seat");

      castVotes(inst, players, (voter) => innocentTarget(inst, voter));
      assert.strictEqual(inst.state.phase, "reveal");
      if (round < 2) advanceTo(inst, "brief");
    }

    assert.deepStrictEqual(seen, [0, 1, 2], "no Stowaway repeats inside the three rounds");
  });

  test("stowaway rotation covers every seat at eight players", () => {
    const seats = Array.from({ length: 8 }, (_, round) => stowawayFor(round, 8));
    assert.deepStrictEqual(seats, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.strictEqual(new Set(seats).size, 8, "no seat repeats in one cycle");

    const secondCycle = Array.from({ length: 8 }, (_, round) => stowawayFor(round + 8, 8));
    assert.deepStrictEqual(secondCycle, seats, "the second cycle repeats in the same order");

    for (let count = 3; count <= 8; count++) {
      const cycle = Array.from({ length: count }, (_, round) => stowawayFor(round, count));
      assert.strictEqual(new Set(cycle).size, count, `${count}: every seat is the Stowaway once per cycle`);
      assert.ok(cycle.every((seat) => seat >= 0 && seat < count), `${count}: seat in range`);
    }
    assert.strictEqual(stowawayFor(0, 0), 0, "an empty table never divides by zero");
  });

  test("a clue is capped at three words and cleaned of noise", () => {
    assert.strictEqual(MAX_CLUE_WORDS, 3);

    assert.strictEqual(cleanClue("water"), "water");
    assert.strictEqual(cleanClue("one two three four five"), "one two three", "extra words are truncated");
    assert.strictEqual(cleanClue("one two"), "one two");
    assert.strictEqual(cleanClue("  one\n\ntwo\tthree   "), "one two three", "whitespace and controls collapse");
    assert.strictEqual(cleanClue("one\u0000two\u007fthree"), "one two three", "control characters become spaces");
    assert.strictEqual(cleanClue("!!! --- ???"), null, "punctuation-only clue is rejected");
    assert.strictEqual(cleanClue("!! lighthouse !!! keeper"), "lighthouse keeper", "punctuation-only words are dropped");
    assert.strictEqual(cleanClue("hello, world!"), "hello, world!", "punctuation inside a word survives");
    assert.strictEqual(cleanClue("phosphorescent lighthouse"), "phosphorescent lighthouse", "the old 20-character cap is gone");
    assert.strictEqual(cleanClue(42), null);
    assert.strictEqual(cleanClue(null), null);
  });

  test("the server sanitises each submitted clue, not just the wire text", () => {
    const { players, inst } = startGame(3);
    advanceTo(inst, "clue");

    stowawayPlugin.onInput(inst, players[1].id, { text: "  salty\n\nwater!!!   bubbles   and more  " });
    assert.strictEqual(inst.state.clues[1], "salty water!!! bubbles", "three words, whitespace collapsed");

    stowawayPlugin.onInput(inst, players[2].id, { text: "!!! --- ???" });
    assert.strictEqual(inst.state.clues[2], null, "a punctuation-only clue is not accepted");

    stowawayPlugin.onInput(inst, players[2].id, { text: "fish" });
    assert.strictEqual(inst.state.clues[2], "fish");

    const clueController = stowawayPlugin.controllerState(inst, players[0].id) as {
      controllerType: string;
      placeholder: string;
      info: string;
    };
    assert.match(clueController.placeholder.toLowerCase(), /three words max/);
    assert.match(clueController.info.toLowerCase(), /three words max/);
  });

  test("correct voters get 500 exactly at three and four players", () => {
    for (const count of [3, 4]) {
      const { players, inst } = startGame(count);
      playRound(inst, players, { caught: true, guessCorrect: true });
      assert.strictEqual(inst.state.phase, "reveal");
      for (let i = 0; i < count; i++) {
        if (i === inst.state.stowaway) continue;
        assert.strictEqual(inst.state.scores[i], 500, `${count}: correct voter ${i} gets exactly 500`);
      }
      assert.strictEqual(scalePayout(500, count), 500);
    }
  });

  test("correct-voter payouts scale with f(N) at five to eight players", () => {
    const expected: Record<number, number> = { 5: 375, 6: 300, 7: 250, 8: 214 };
    for (const [countText, payout] of Object.entries(expected)) {
      const count = Number(countText);
      assert.strictEqual(scalePayout(500, count), payout, `${count}: f(N) payout`);
      const { players, inst } = startGame(count);
      playRound(inst, players, { caught: true, guessCorrect: true });
      for (let i = 0; i < count; i++) {
        if (i === inst.state.stowaway) continue;
        assert.strictEqual(inst.state.scores[i], payout, `${count}: correct voter ${i}`);
      }
      assert.strictEqual(inst.state.scores[inst.state.stowaway], 500, `${count}: fixed guess bonus`);
    }
  });

  test("an uncaught Stowaway takes 1000 fixed and voters score nothing", () => {
    const { players, inst } = startGame(6);
    playRound(inst, players, { caught: false });
    assert.strictEqual(inst.state.reveal?.caught, false);
    assert.strictEqual(inst.state.scores[inst.state.stowaway], 1000);
    for (let i = 0; i < players.length; i++) {
      if (i === inst.state.stowaway) continue;
      assert.strictEqual(inst.state.scores[i], 0, `${i}: a wrong voter scores nothing`);
    }
  });

  test("a caught Stowaway only scores the fixed 500 for the right category", () => {
    const right = startGame(5);
    playRound(right.inst, right.players, { caught: true, guessCorrect: true });
    assert.strictEqual(right.inst.state.scores[right.inst.state.stowaway], 500, "right guess pays 500");

    const wrong = startGame(5);
    playRound(wrong.inst, wrong.players, { caught: true, guessCorrect: false });
    assert.strictEqual(wrong.inst.state.phase, "catchguess", "the catch clock is still running");
    advanceTo(wrong.inst, "reveal");
    assert.strictEqual(wrong.inst.state.scores[wrong.inst.state.stowaway], 0, "no guess pays nothing");
  });

  test("one player's maximum round gain stays inside the 1500 bound at 3-8", () => {
    for (let count = 3; count <= 8; count++) {
      const possible = [scalePayout(500, count), 1000, 500];
      for (const gain of possible) {
        assert.ok(gain <= MAX_ROUND_SCORE, `${count}: ${gain} exceeds the round bound`);
        assert.ok(withinRoundBound(gain), `${count}: ${gain} fails the shared bound helper`);
      }
      assert.strictEqual(Math.max(...possible), 1000, `${count}: the uncaught 1000 is the ceiling`);

      // Measure a real caught round and a real uncaught round.
      const caught = startGame(count);
      playRound(caught.inst, caught.players, { caught: true, guessCorrect: true });
      for (let i = 0; i < count; i++) {
        assert.ok(caught.inst.state.scores[i] <= MAX_ROUND_SCORE, `${count}: caught round gain for ${i}`);
      }

      const escaped = startGame(count);
      playRound(escaped.inst, escaped.players, { caught: false });
      for (let i = 0; i < count; i++) {
        assert.ok(escaped.inst.state.scores[i] <= MAX_ROUND_SCORE, `${count}: escaped round gain for ${i}`);
      }
    }
  });

  test("the TV never sees the category or the Stowaway's role before the reveal", () => {
    const { players, inst } = startGame(8);
    const checkHidden = (label: string): void => {
      const screen = stowawayPlugin.screenState(inst) as {
        category: string | null;
        stowawayName: string | null;
        reveal: unknown;
        clues: unknown[];
        options: unknown[];
      };
      assert.strictEqual(screen.category, null, `${label}: category must be hidden`);
      assert.strictEqual(screen.stowawayName, null, `${label}: role must be hidden`);
      assert.strictEqual(screen.reveal, null, `${label}: the accusation must be hidden`);
      assert.ok(
        inst.state.category.length === 0 || !JSON.stringify(screen).includes(inst.state.category),
        `${label}: the category text must not appear anywhere in the payload`,
      );
      if (label !== "discussion" && label !== "vote") {
        assert.strictEqual(screen.clues.length, 0, `${label}: clues stay off the TV`);
        assert.strictEqual(screen.options.length, 0, `${label}: no ballot before the discussion`);
      }
    };

    checkHidden("brief");
    advanceTo(inst, "clue");
    checkHidden("clue");

    for (const player of players) stowawayPlugin.onInput(inst, player.id, { text: `${player.name} hint` });
    assert.strictEqual(inst.state.phase, "discussion");
    checkHidden("discussion");
    assert.strictEqual((stowawayPlugin.screenState(inst) as { clues: unknown[] }).clues.length, 8);

    advanceTo(inst, "vote");
    checkHidden("vote");

    // A caught round enters the category guess: still no role or answer leak.
    castVotes(inst, players, () => inst.state.stowaway);
    assert.strictEqual(inst.state.phase, "catchguess");
    checkHidden("catchguess");

    stowawayPlugin.onInput(inst, players[inst.state.stowaway].id, { choice: inst.state.category });
    assert.strictEqual(inst.state.phase, "reveal");
    const reveal = stowawayPlugin.screenState(inst) as {
      category: string | null;
      stowawayName: string | null;
      reveal: unknown;
      caption: string | null;
      sound: string | null;
    };
    assert.strictEqual(reveal.category, inst.state.category);
    assert.strictEqual(reveal.stowawayName, players[inst.state.stowaway].name);
    assert.ok(reveal.reveal);
    assert.strictEqual(typeof reveal.caption, "string");
    assert.strictEqual(reveal.sound, "reveal");
  });

  test("the category guess is one of six options", () => {
    const { players, inst } = startGame(6);
    playRound(inst, players, { caught: true, guessCorrect: false });
    assert.strictEqual(inst.state.phase, "catchguess");

    const stowaway = inst.state.stowaway;
    const controller = stowawayPlugin.controllerState(inst, players[stowaway].id) as {
      options: Array<{ id: string }>;
    };
    assert.strictEqual(CATEGORY_OPTIONS, 6);
    assert.strictEqual(controller.options.length, 6);
    assert.ok(controller.options.some((option) => option.id === inst.state.category));
    assert.strictEqual(inst.state.decoys.length, 5);
    assert.strictEqual(new Set([inst.state.category, ...inst.state.decoys]).size, 6, "six distinct choices");
  });

  test("results reports standings plus correct accusations and rounds undetected", () => {
    const { players, inst } = startGame(5);

    // Round 1 caught: four correct voters.
    playRound(inst, players, { caught: true, guessCorrect: false });
    advanceTo(inst, "brief");
    const firstStowaway = players[0].id;

    // Round 2 escaped: the new Stowaway survives undetected and no voter
    // accuses them, so round 1 is the only correct accusation.
    const secondStowaway = inst.state.stowaway;
    playRound(inst, players, { caught: false });

    const results = stowawayPlugin.results;
    assert.ok(results, "Stowaway must publish results()");
    const result = results(inst);
    assert.strictEqual(result.standings.length, 5);
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.playerId).sort(),
      players.map((player) => player.id).sort(),
    );
    for (const standing of result.standings) {
      assert.ok(standing.rank >= 1 && standing.rank <= 5);
      assert.ok(Number.isFinite(standing.raw));
    }

    const correctFor = (id: string): number => result.stats[`${id}:correctAccusations`] ?? 0;
    for (let i = 0; i < players.length; i++) {
      if (i === 0) continue;
      assert.strictEqual(correctFor(players[i].id), 1, `${players[i].id}: one correct accusation`);
    }
    assert.strictEqual(correctFor(firstStowaway), 0, "the Stowaway never accuses themselves");

    assert.strictEqual(result.stats[`${players[secondStowaway].id}:roundsUndetected`], 1);
    assert.strictEqual(result.stats[`${players[0].id}:roundsUndetected`], 0);
  });

  test("the catalog reports 3-8 players, 3/2 rounds and the unchanged timers", () => {
    const entry = GAME_CATALOG.stowaway;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 3, `${count}: standalone rounds`);
      assert.deepStrictEqual(
        standalone.timers,
        { brief: 6, clue: 45, discuss: 30, vote: 20, catch: 20, reveal: 8 },
        `${count}: timers unchanged`,
      );
      assert.strictEqual(standalone.optionCaps?.options, count);
      assert.strictEqual(standalone.optionCaps?.categories, 6);

      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 2, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
    }
  });
});
