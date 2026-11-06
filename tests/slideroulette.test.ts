/**
 * Slide Roulette: 3-8 player range, one presenter per player, the secure
 * caption shuffle, the unchanged star scoring, the round sanity bound, the TV
 * privacy rule around caption authors, and the reveal hooks / result stats.
 *
 * The 3-4 cases intentionally pin the original numbers: `round(200 * average)`
 * for the presenter and a flat 100 per caption author at an average of 4+.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";
import plugin, {
  averageRating,
  deckFor,
  presenterPoints,
  slideRounds,
} from "../games/slideroulette/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface TestRoom {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: TestPlayer[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "playing";
}

interface SlideState {
  mode: "standalone" | "rumble";
  round: number;
  maxRounds: number;
  phase: "writing" | "presenting" | "rating" | "reveal" | "finished";
  presenter: number;
  topic: string;
  submissions: Array<string | null>;
  deck: Array<{ author: number; text: string }>;
  slideIndex: number;
  ratings: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { average: number; presenterPoints: number } | null;
  presented: number[];
  starTotal: number[];
  captionsRated4: number[];
}

interface SlideInstance {
  roomId: string;
  players: TestPlayer[];
  state: SlideState;
}

interface TVScreen {
  phase: string;
  round: number;
  maxRounds: number;
  topic: string;
  presenterName: string;
  slide: string | null;
  slideNumber: number;
  slideCount: number;
  slidesLeft: number;
  captions: Array<{ text: string; author: string }> | null;
  reveal: { average: number; presenterPoints: number } | null;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  timerMs: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: string | null;
}

interface ControllerState {
  mode: string;
  options: Array<{ id: string; label: string }>;
  hasSubmitted?: boolean;
  hasVoted?: boolean;
}

interface TestPlugin {
  manifest: { id: string; minPlayers: number; maxPlayers: number };
  onStart(room: TestRoom, players: TestPlayer[], options?: Record<string, unknown>): SlideInstance;
  onInput(instance: SlideInstance, playerId: string, input: unknown): void;
  onTick(instance: SlideInstance, deltaMs: number): void;
  screenState(instance: SlideInstance): TVScreen;
  controllerState(instance: SlideInstance, playerId: string): ControllerState;
  results(instance: SlideInstance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const game = plugin as unknown as TestPlugin;

const mk = (n: number): TestPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));

const room = (players: TestPlayer[]): TestRoom => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: players[0]?.id ?? null,
  players,
  gameId: "slideroulette",
  gameState: null,
  createdAt: 0,
  status: "playing",
});

function startGame(
  count: number,
  mode?: "standalone" | "rumble",
): { players: TestPlayer[]; inst: SlideInstance } {
  const players = mk(count);
  const options = mode ? { mode } : undefined;
  const inst = game.onStart(room(players), players, options);
  return { players, inst };
}

const screenOf = (inst: SlideInstance): TVScreen => game.screenState(inst);
const controllerOf = (inst: SlideInstance, player: TestPlayer): ControllerState =>
  game.controllerState(inst, player.id);

/** Every non-presenter writes one caption; the last submission opens the deck. */
function writeCaptions(inst: SlideInstance, players: TestPlayer[]): void {
  players.forEach((player, seat) => {
    if (seat === inst.state.presenter) return;
    game.onInput(inst, player.id, { text: `caption from ${player.name}` });
  });
  assert.strictEqual(inst.state.phase, "presenting", "all captions build the deck");
}

/** The presenter taps through every caption in the deck. */
function presentDeck(inst: SlideInstance, players: TestPlayer[]): void {
  const presenter = players[inst.state.presenter];
  let remaining = inst.state.deck.length;
  while (remaining > 0) {
    game.onInput(inst, presenter.id, { choice: "next" });
    remaining--;
  }
  assert.strictEqual(inst.state.phase, "rating", "the deck is spent");
}

/** Every non-presenter rates; the last rating settles the round. */
function rateAll(inst: SlideInstance, players: TestPlayer[], stars: number): void {
  players.forEach((player, seat) => {
    if (seat === inst.state.presenter) return;
    game.onInput(inst, player.id, { choice: String(stars) });
  });
  assert.strictEqual(inst.state.phase, "reveal", "the last rating settles the round");
}

function playRound(inst: SlideInstance, players: TestPlayer[], stars = 5): void {
  writeCaptions(inst, players);
  presentDeck(inst, players);
  rateAll(inst, players, stars);
}

function advanceFromReveal(inst: SlideInstance): void {
  for (let i = 0; i < 10 && inst.state.phase === "reveal"; i++) {
    game.onTick(inst, 2000);
  }
}

const roundGains = (before: number[], after: number[]): number[] => after.map((score, i) => score - before[i]);

describe("slide roulette", () => {
  test("the catalog and both manifests report 3-8 players and the round split", () => {
    const entry = GAME_CATALOG.slideroulette;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);

    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "games", "slideroulette", "manifest.json"), "utf8"),
    ) as { minPlayers: number; maxPlayers: number };
    assert.strictEqual(manifest.minPlayers, 3);
    assert.strictEqual(manifest.maxPlayers, 8);
    assert.strictEqual(game.manifest.minPlayers, 3);
    assert.strictEqual(game.manifest.maxPlayers, 8);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, count, `${count}: one presenter per player`);
      assert.deepStrictEqual(standalone.timers, { write: 30, slide: 15, rate: 20, reveal: 8 });

      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 3, `${count}: the rumble runs three presenters`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);

      assert.strictEqual(slideRounds(count), count, `${count}: standalone rounds`);
      assert.strictEqual(slideRounds(count, "rumble"), 3, `${count}: rumble rounds`);
    }
  });

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
    const players = mk(3);
    const inst = game.onStart(room(players), players);

    assert.strictEqual(inst.state.presenter, 0, "first presenter");
    game.onInput(inst, "p0", { text: "presenters do not write" });
    assert.strictEqual(inst.state.submissions[0], null, "the presenter cannot submit a slide");

    game.onInput(inst, "p1", { text: "slide one" });
    game.onInput(inst, "p2", { text: "slide two" });
    assert.strictEqual(inst.state.phase, "presenting");
    assert.strictEqual(inst.state.deck.length, 2, "one slide per non-presenter");

    // Presenter taps through the deck.
    game.onInput(inst, "p0", { choice: "next" });
    assert.strictEqual(inst.state.slideIndex, 1);
    game.onInput(inst, "p0", { choice: "next" });
    assert.strictEqual(inst.state.phase, "rating");

    game.onInput(inst, "p0", { choice: "5" });
    assert.strictEqual(inst.state.ratings[0], null, "the presenter cannot rate themselves");
    game.onInput(inst, "p1", { choice: "5" });
    game.onInput(inst, "p2", { choice: "5" });

    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.reveal?.average, 5);
    assert.strictEqual(inst.state.scores[0], 1000, "presenter earns 200 per star");
    assert.strictEqual(inst.state.scores[1], 100, "slide authors earn 100 at 4+ stars");
    assert.strictEqual(inst.state.scores[2], 100);
  });

  test("deckFor keeps one caption per non-presenter and applies the shuffle", () => {
    const reversed = deckFor(["a", "b", "c"], 0, (items) => [...items].reverse());
    assert.deepStrictEqual(reversed, [
      { author: 2, text: "c" },
      { author: 1, text: "b" },
    ], "the shuffle decides the slide order");

    const withPresenter = deckFor(["presenter", "b", "c"], 0, (items) => items);
    assert.deepStrictEqual(withPresenter.map((slide) => slide.author), [1, 2], "the presenter writes no caption");

    const empty = deckFor([null, null, null], 1, (items) => items);
    assert.deepStrictEqual(empty, [{ author: 1, text: "no slide was written" }], "the fallback slide");

    // The real game uses a secure shuffle: every author still appears once.
    const { players, inst } = startGame(8);
    writeCaptions(inst, players);
    const authors = inst.state.deck.map((slide) => slide.author).sort((a, b) => a - b);
    assert.deepStrictEqual(authors, [1, 2, 3, 4, 5, 6, 7], "seven distinct caption authors");
  });

  test("scoring is exact at 3-4 players and unchanged at 8", () => {
    // Three players, round 1 is seat 0 presenting. 5 + 4 stars = 4.5 average.
    const three = startGame(3);
    writeCaptions(three.inst, three.players);
    presentDeck(three.inst, three.players);
    game.onInput(three.inst, "p1", { choice: "5" });
    game.onInput(three.inst, "p2", { choice: "4" });
    assert.strictEqual(three.inst.state.reveal?.average, 4.5);
    assert.deepStrictEqual(three.inst.state.scores, [900, 100, 100], "3 players: 200 x average, 100 per author");

    // Four players at a flat four stars: 800 presenter, 100 per author.
    const four = startGame(4);
    playRound(four.inst, four.players, 4);
    assert.strictEqual(four.inst.state.reveal?.average, 4);
    assert.deepStrictEqual(four.inst.state.scores, [800, 100, 100, 100], "4 players");

    // Below four stars the author bonus disappears; the presenter keeps 200 x average.
    const low = startGame(3);
    writeCaptions(low.inst, low.players);
    presentDeck(low.inst, low.players);
    game.onInput(low.inst, "p1", { choice: "3" });
    game.onInput(low.inst, "p2", { choice: "4" });
    assert.strictEqual(low.inst.state.reveal?.average, 3.5);
    assert.deepStrictEqual(low.inst.state.scores, [700, 0, 0], "no author bonus below a 4-star average");

    // Eight players at five stars: the presenter still caps at 1000, seven authors get 100.
    const eight = startGame(8);
    playRound(eight.inst, eight.players, 5);
    assert.deepStrictEqual(
      eight.inst.state.scores,
      [1000, 100, 100, 100, 100, 100, 100, 100],
      "8 players: unchanged presenter rule and one bonus per caption",
    );
  });

  test("every player presents once in an eight-player standalone game", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(inst.state.maxRounds, 8, "one round per player");

    const presenters: number[] = [];
    for (let round = 0; round < 8; round++) {
      assert.strictEqual(inst.state.round, round);
      presenters.push(inst.state.presenter);
      playRound(inst, players, 5);
      assert.strictEqual(inst.state.deck.length, 7, `round ${round}: seven captions`);
      advanceFromReveal(inst);
    }

    assert.deepStrictEqual(presenters, [0, 1, 2, 3, 4, 5, 6, 7], "seat order rotation");
    assert.strictEqual(new Set(presenters).size, 8, "every player presents exactly once");
    assert.strictEqual(inst.state.phase, "finished", "the game ends after the last reveal");
    assert.strictEqual(screenOf(inst).finished, true);
    assert.strictEqual(game.results(inst).standings.length, 8);
  });

  test("a three-player playthrough stays three rounds and finishes cleanly", () => {
    const { players, inst } = startGame(3);
    assert.strictEqual(inst.state.maxRounds, 3);

    for (let round = 0; round < 3; round++) {
      assert.strictEqual(inst.state.round, round);
      playRound(inst, players, 5);
      const reveal = screenOf(inst);
      assert.strictEqual(reveal.sound, "reveal");
      assert.ok(reveal.caption && reveal.caption.length > 0, "the reveal has a public caption");
      assert.deepStrictEqual(reveal.waitingOn, []);
      advanceFromReveal(inst);
    }

    assert.strictEqual(inst.state.phase, "finished");
    assert.ok(inst.state.scores.every((score) => Number.isFinite(score) && score >= 0));
    assert.strictEqual(game.results(inst).standings.length, 3);
  });

  test("one player's maximum round gain stays at or below 1500 for N 3..8", () => {
    assert.strictEqual(MAX_ROUND_SCORE, 1500);

    for (let count = 3; count <= 8; count++) {
      const { players, inst } = startGame(count);
      playRound(inst, players, 5);
      const gains = roundGains(new Array<number>(count).fill(0), inst.state.scores);
      for (const gain of gains) {
        assert.ok(withinRoundBound(gain), `${count}: ${gain} exceeds the round bound`);
        assert.ok(gain <= MAX_ROUND_SCORE, `${count}: ${gain} above 1500`);
      }
      assert.strictEqual(gains[0], 1000, `${count}: the presenter maximum is 200 x 5`);
      assert.strictEqual(Math.max(...gains), 1000, `${count}: nothing pays more than the presenter`);
    }
  });

  test("the TV payload never reveals caption authors before the reveal", () => {
    const { players, inst } = startGame(4);
    assert.strictEqual(screenOf(inst).captions, null, "writing: no caption list");

    writeCaptions(inst, players);
    const presenting = screenOf(inst);
    assert.strictEqual(presenting.captions, null, "presenting: no authors");
    assert.strictEqual(presenting.slide, inst.state.deck[0].text, "the current caption is large on the TV");
    assert.ok(presenting.presenterName.length > 0, "the presenter's name is public");
    assert.strictEqual(presenting.slidesLeft, 3, "three slides left at the start of the deck");
    assert.ok(!JSON.stringify(presenting).includes('"author"'), "no author key on the TV");

    game.onInput(inst, players[0].id, { choice: "next" });
    assert.strictEqual(screenOf(inst).slidesLeft, 2, "the counter decrements");

    presentDeck(inst, players);
    assert.strictEqual(screenOf(inst).captions, null, "rating: no authors");
    assert.strictEqual(screenOf(inst).slidesLeft, 0, "no slides left");

    rateAll(inst, players, 5);
    const reveal = screenOf(inst);
    assert.ok(reveal.captions, "the reveal publishes the caption credits");
    assert.strictEqual(reveal.captions?.length, 3);
    assert.deepStrictEqual(
      reveal.captions?.map((entry) => entry.author).sort(),
      [players[1].name, players[2].name, players[3].name],
      "every caption author is revealed exactly once",
    );
  });

  test("eight players: seven phones write captions and all five star buttons exist", () => {
    const { players, inst } = startGame(8);
    const writing = players.map((player) => controllerOf(inst, player));
    assert.strictEqual(writing.filter((controller) => controller.mode === "text").length, 7, "seven authors");
    assert.strictEqual(
      controllerOf(inst, players[inst.state.presenter]).mode,
      "wait",
      "the presenter does not write",
    );
    assert.deepStrictEqual(screenOf(inst).waitingOn, players.slice(1).map((player) => player.name));

    writeCaptions(inst, players);
    presentDeck(inst, players);
    const voters = players.filter((_, seat) => seat !== inst.state.presenter);
    for (const voter of voters) {
      const controller = controllerOf(inst, voter);
      assert.strictEqual(controller.mode, "choice");
      assert.deepStrictEqual(controller.options.map((option) => option.id), ["1", "2", "3", "4", "5"]);
    }
  });

  test("waitingOn follows the phase and the presenter", () => {
    const { players, inst } = startGame(4);
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[1].name, players[2].name, players[3].name]);

    game.onInput(inst, players[1].id, { text: "first" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[2].name, players[3].name]);

    game.onInput(inst, players[2].id, { text: "second" });
    game.onInput(inst, players[3].id, { text: "third" });
    assert.strictEqual(inst.state.phase, "presenting");
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[0].name], "the presenter drives the deck");

    presentDeck(inst, players);
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[1].name, players[2].name, players[3].name]);

    game.onInput(inst, players[1].id, { choice: "5" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[2].name, players[3].name]);
    game.onInput(inst, players[2].id, { choice: "5" });
    game.onInput(inst, players[3].id, { choice: "5" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [], "reveal waits on nobody");
  });

  test("results reports standings plus averageStars and captionsRated4", () => {
    const { players, inst } = startGame(3);
    playRound(inst, players, 5);

    const result = game.results(inst);
    assert.strictEqual(result.standings.length, 3);
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.raw),
      [1000, 100, 100],
    );
    assert.strictEqual(result.stats[`${players[0].id}:averageStars`], 5);
    assert.strictEqual(result.stats[`${players[0].id}:captionsRated4`], 0, "the presenter wrote no caption");
    assert.strictEqual(result.stats[`${players[1].id}:captionsRated4`], 1);
    assert.strictEqual(result.stats[`${players[2].id}:captionsRated4`], 1);
    assert.strictEqual(result.stats[`${players[1].id}:averageStars`], 0, "not presented yet");
  });

  test("a rumble starts with three rounds at any player count", () => {
    for (let count = 3; count <= 8; count++) {
      const { inst } = startGame(count, "rumble");
      assert.strictEqual(inst.state.mode, "rumble");
      assert.strictEqual(inst.state.maxRounds, 3, `${count}: three presenters`);
    }
  });
});
