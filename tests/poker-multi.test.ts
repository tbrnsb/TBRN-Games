/**
 * Texas Hold'em at two and eight players.
 *
 * Covers the widened 2-8 range, side pots (two and three all-in levels),
 * dealer / blind rules heads-up versus multiway, the 25-second auto-action,
 * reverse-elimination finishing order, chip conservation, and the rule that
 * hole cards never reach the TV or another player's phone.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pokerSeatLayout, renderPoker } from "../games/poker/screen.ts";

type Suit = "hearts" | "diamonds" | "clubs" | "spades";
interface Card {
  suit: Suit;
  rank: number;
}
interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}
interface Instance {
  players: Player[];
  state: Record<string, unknown>;
}
interface Plugin {
  manifest: { minPlayers: number; maxPlayers: number };
  onStart(room: unknown, players: Player[], options?: Record<string, unknown>): Instance;
  onInput(instance: Instance, playerId: string, input: unknown): void;
  onTick(instance: Instance, deltaMs: number): void;
  screenState(instance: Instance): Record<string, unknown>;
  controllerState(instance: Instance, playerId: string): Record<string, unknown>;
  results?(instance: Instance): {
    standings: Array<{ playerId: string; rank: number; raw: number }>;
    stats: Record<string, number>;
  };
}

const c = (rank: number, suit: Suit = "hearts"): Card => ({ suit, rank });

const mk = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));

const room = (players: Player[]) => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: players[0]?.id ?? null,
  players,
  gameId: "poker",
  gameState: null,
  createdAt: 0,
  status: "playing" as const,
});

async function loadPlugin(): Promise<Plugin> {
  const mod = (await import("../games/poker/server.ts")) as { default: Plugin };
  return mod.default;
}

const stateOf = (instance: Instance) => instance.state as any;

/** Check when possible, otherwise call, otherwise fold: a passive, safe bot. */
function passiveAction(plugin: Plugin, instance: Instance): void {
  const s = stateOf(instance);
  if (s.finished) return;
  if (s.turnIndex < 0) {
    plugin.onTick(instance, 500);
    return;
  }
  const player = instance.players[s.turnIndex];
  const cs = plugin.controllerState(instance, player.id);
  if (cs.yourTurn !== true) {
    plugin.onTick(instance, 500);
    return;
  }
  if (cs.canCheck === true) plugin.onInput(instance, player.id, { action: "check" });
  else if (cs.canCall === true) plugin.onInput(instance, player.id, { action: "call" });
  else plugin.onInput(instance, player.id, { action: "fold" });
}

/** Fold every acting player until one seat is left, then run the hand out. */
function foldHandOut(plugin: Plugin, instance: Instance): void {
  for (let guard = 0; guard < 200; guard++) {
    const s = stateOf(instance);
    if (s.phase === "showdown" || s.phase === "hand-end" || s.phase === "finished") break;
    if (s.turnIndex < 0) {
      plugin.onTick(instance, 500);
      continue;
    }
    const live = s.seats.filter((seat: any) => !seat.folded).length;
    if (live <= 1) break;
    const player = instance.players[s.turnIndex];
    plugin.onInput(instance, player.id, { action: "fold" });
  }
  // showdown 6 s + hand-end 6 s, then the next hand starts.
  for (let i = 0; i < 10; i++) {
    if (stateOf(instance).phase === "finished") break;
    plugin.onTick(instance, 2000);
  }
}

/**
 * Replace the live hand with a controlled river showdown.
 * `contributions[i]` is seat i's total chips committed this hand.
 */
function injectShowdown(
  instance: Instance,
  community: Card[],
  holeCards: Card[][],
  contributions: number[],
  chipsAtHandStart: number[],
): void {
  const s = stateOf(instance);
  s.phase = "river";
  s.community = community;
  s.showdown = null;
  s.potBreakdown = null;
  s.results = null;
  s.pot = 0;
  s.currentBet = 0;
  s.turnIndex = -1;
  s.awaitingTransition = "deal-next";
  s.transitionTimerMs = 1;
  s.handStartChips = [...chipsAtHandStart];
  s.wonThisHand = s.seats.map(() => false);
  instance.state.seats = s.seats;
  s.seats.forEach((seat: any, i: number) => {
    const cards = holeCards[i] ?? [];
    seat.cards = cards;
    seat.bet = 0;
    seat.totalBet = contributions[i] ?? 0;
    seat.chips = 0;
    seat.folded = cards.length === 0;
    seat.allIn = true;
    seat.acted = true;
    seat.lastAction = null;
  });
}

describe("poker: player range", () => {
  test("manifest and plugin agree on a 2-8 hard range", async () => {
    const plugin = await loadPlugin();
    assert.strictEqual(plugin.manifest.minPlayers, 2);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);
    const json = JSON.parse(readFileSync(join(process.cwd(), "games/poker/manifest.json"), "utf8"));
    assert.strictEqual(json.minPlayers, 2);
    assert.strictEqual(json.maxPlayers, 8);
  });

  test("an eight-player table starts with eight seats", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players);
    const screen = plugin.screenState(instance);
    assert.strictEqual((screen.players as unknown[]).length, 8);
    assert.strictEqual((screen.community as unknown[]).length, 0);
    assert.ok(Array.isArray(screen.pots));
  });

  test("the phone payload carries the stack and whose turn it is", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players);
    const s = stateOf(instance);
    const actor = plugin.controllerState(instance, players[s.turnIndex].id);
    assert.strictEqual(actor.chips, 1000);
    assert.strictEqual(actor.turnName, players[s.turnIndex].name);
    assert.strictEqual(actor.yourTurn, true);
  });
});

describe("poker: dealer button and blinds", () => {
  test("heads-up dealer posts the small blind and acts first preflop", async () => {
    const plugin = await loadPlugin();
    const players = mk(2);
    const instance = plugin.onStart(room(players), players);
    const s = stateOf(instance);
    assert.strictEqual(s.dealerIndex, 0);
    assert.strictEqual(s.sbIndex, s.dealerIndex, "dealer is the small blind");
    assert.strictEqual(s.bbIndex, 1, "the other seat is the big blind");
    assert.strictEqual(s.turnIndex, s.dealerIndex, "dealer acts first preflop");
    assert.strictEqual(s.seats[s.sbIndex].bet, 10);
    assert.strictEqual(s.seats[s.bbIndex].bet, 20);
  });

  test("three to eight handed blinds follow the button: SB then BB, UTG acts first", async () => {
    const plugin = await loadPlugin();
    for (let count = 3; count <= 8; count++) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const s = stateOf(instance);
      assert.strictEqual(s.dealerIndex, 0, `${count}: first hand button`);
      assert.strictEqual(s.sbIndex, 1, `${count}: small blind is left of the button`);
      assert.strictEqual(s.bbIndex, 2, `${count}: big blind is left of the small blind`);
      assert.strictEqual(
        s.turnIndex,
        (s.bbIndex + 1) % count,
        `${count}: under the gun acts first preflop`,
      );
      assert.strictEqual(s.seats[s.sbIndex].bet, 10, `${count}: small blind size`);
      assert.strictEqual(s.seats[s.bbIndex].bet, 20, `${count}: big blind size`);
    }
  });

  test("the button rotates to the next seat after a hand at two, three and eight", async () => {
    const plugin = await loadPlugin();
    for (const count of [2, 3, 8]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const before = stateOf(instance).dealerIndex;
      foldHandOut(plugin, instance);
      const s = stateOf(instance);
      assert.strictEqual(s.phase === "finished", false, `${count}: game should still be running`);
      assert.strictEqual(s.handNumber, 2, `${count}: a second hand should start`);
      assert.strictEqual(s.dealerIndex, (before + 1) % count, `${count}: button moves one seat`);
      if (count === 2) {
        assert.strictEqual(s.sbIndex, s.dealerIndex, "heads-up dealer still posts SB");
      } else {
        assert.notStrictEqual(s.sbIndex, s.dealerIndex, "multiway SB is not the dealer");
        assert.strictEqual(s.bbIndex, (s.sbIndex + 1) % count);
      }
    }
  });

  test("a short-stacked heads-up small blind cannot freeze the action", async () => {
    const plugin = await loadPlugin();
    const players = mk(2);
    const instance = plugin.onStart(room(players), players);
    const s = stateOf(instance);

    // Finish hand one with seat 0 taking the pot, leaving seat 1 on 8 chips so
    // it becomes the short-stacked dealer/small blind in hand two.
    plugin.onInput(instance, players[s.turnIndex].id, { action: "call" });
    s.seats[1].chips = 8;
    plugin.onInput(instance, players[s.turnIndex].id, { action: "fold" });
    for (let i = 0; i < 10; i++) plugin.onTick(instance, 2000);

    assert.strictEqual(s.handNumber, 2);
    assert.strictEqual(s.dealerIndex, 1);
    assert.strictEqual(s.sbIndex, 1);
    assert.strictEqual(s.seats[1].allIn, true, "the short small blind is all-in");
    assert.notStrictEqual(s.turnIndex, 1, "the all-in small blind is skipped");
    assert.strictEqual(s.turnIndex, 0, "the big blind acts instead");

    // The hand must keep moving and complete rather than sit on a dead timer.
    // If the short stack loses the pot it busts and the game ends instead of
    // dealing hand three.
    for (let i = 0; i < 40; i++) plugin.onTick(instance, 2000);
    assert.ok(
      s.phase === "finished" || s.handNumber >= 3,
      "the short all-in hand completes and the game progresses",
    );
  });
});

describe("poker: Rumble defaults", () => {
  test("rumble mode runs eight hands and doubles the blinds at hand five", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players, { mode: "rumble" });
    assert.strictEqual(stateOf(instance).maxHands, 8);
    assert.strictEqual(stateOf(instance).smallBlind, 10);

    for (let hand = 1; hand < 5; hand++) {
      foldHandOut(plugin, instance);
      assert.strictEqual(stateOf(instance).handNumber, hand + 1);
    }
    const s = stateOf(instance);
    assert.strictEqual(s.handNumber, 5);
    assert.strictEqual(s.smallBlind, 20);
    assert.strictEqual(s.bigBlind, 40);
  });

  test("host maxHands and startingStack override the rumble defaults", async () => {
    const plugin = await loadPlugin();
    const players = mk(4);
    const instance = plugin.onStart(room(players), players, {
      mode: "rumble",
      maxHands: 3,
      startingStack: 2500,
    });
    const s = stateOf(instance);
    assert.strictEqual(s.maxHands, 3);
    assert.ok(s.seats.every((seat: any) => seat.chips + seat.bet === 2500));
  });
});

describe("poker: side pots", () => {
  test("two all-in levels: three players, three pots", async () => {
    const plugin = await loadPlugin();
    const players = mk(3);
    const instance = plugin.onStart(room(players), players);
    injectShowdown(
      instance,
      [c(2, "clubs"), c(7, "diamonds"), c(9, "spades"), c(11, "hearts"), c(4, "clubs")],
      [
        [c(14, "spades"), c(14, "diamonds")], // aces: main pot
        [c(13, "spades"), c(13, "diamonds")], // kings: first side pot
        [c(12, "spades"), c(12, "diamonds")], // queens: uncalled top-up returned
      ],
      [100, 300, 600],
      [100, 300, 600],
    );
    plugin.onTick(instance, 50);
    const s = stateOf(instance);
    assert.strictEqual(s.phase, "showdown");
    const pots = s.potBreakdown as Array<{ amount: number; winners: string[] }>;
    assert.deepStrictEqual(pots.map((pot) => pot.amount), [300, 400, 300]);
    assert.deepStrictEqual(pots.map((pot) => pot.winners), [["P1"], ["P2"], ["P3"]]);
    assert.deepStrictEqual(s.seats.map((seat: any) => seat.chips), [300, 400, 300]);
  });

  test("three all-in levels: four players, four pots", async () => {
    const plugin = await loadPlugin();
    const players = mk(4);
    const instance = plugin.onStart(room(players), players);
    injectShowdown(
      instance,
      [c(2, "clubs"), c(7, "diamonds"), c(9, "spades"), c(6, "hearts"), c(4, "clubs")],
      [
        [c(14, "spades"), c(14, "diamonds")],
        [c(13, "spades"), c(13, "diamonds")],
        [c(12, "spades"), c(12, "diamonds")],
        [c(11, "spades"), c(11, "diamonds")],
      ],
      [100, 300, 600, 1000],
      [100, 300, 600, 1000],
    );
    plugin.onTick(instance, 50);
    const s = stateOf(instance);
    const pots = s.potBreakdown as Array<{ amount: number; winners: string[] }>;
    assert.deepStrictEqual(pots.map((pot) => pot.amount), [400, 600, 600, 400]);
    assert.deepStrictEqual(pots.map((pot) => pot.winners), [["P1"], ["P2"], ["P3"], ["P4"]]);
    assert.deepStrictEqual(s.seats.map((seat: any) => seat.chips), [400, 600, 600, 400]);
    const screen = plugin.screenState(instance);
    assert.deepStrictEqual(
      (screen.pots as Array<{ amount: number }>).map((pot) => pot.amount),
      [400, 600, 600, 400],
      "the TV receives every pot",
    );
  });
});

describe("poker: eight-seat TV layout", () => {
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean =>
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;

  /** Minimal recording 2D context, same shape the renderer smoke test uses. */
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
      get(object, property) {
        if (property in object) return object[property as string];
        return () => undefined;
      },
      set(object, property, value) {
        object[property as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  }

  for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
    test(`${width}x${height}: every table size fits without overlapping panels`, () => {
      for (let count = 2; count <= 8; count++) {
        const boxes = pokerSeatLayout(count, width, height);
        assert.strictEqual(boxes.length, count);
        for (const box of boxes) {
          assert.ok(box.x >= 0 && box.y >= 0, `${count}: panel starts inside the screen`);
          assert.ok(
            box.x + box.width <= width && box.y + box.height <= height,
            `${count}: panel stays inside the screen`,
          );
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            assert.ok(!overlaps(boxes[i], boxes[j]), `${count}: seats ${i} and ${j} overlap`);
          }
        }
      }
    });
  }

  test("eight seats and side pots draw at 720p and 1080p", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players);
    injectShowdown(
      instance,
      [c(2, "clubs"), c(7, "diamonds"), c(9, "spades"), c(6, "hearts"), c(4, "clubs")],
      [
        [c(14, "spades"), c(14, "diamonds")],
        [c(13, "spades"), c(13, "diamonds")],
        [c(12, "spades"), c(12, "diamonds")],
        [c(11, "spades"), c(11, "diamonds")],
        [],
        [],
        [],
        [],
      ],
      [20, 100, 300, 600, 20, 20, 20, 20],
      [20, 100, 300, 600, 20, 20, 20, 20],
    );
    plugin.onTick(instance, 50);
    const screen = plugin.screenState(instance);
    assert.ok((screen.pots as unknown[]).length > 1, "the TV state carries side pots");

    const ctx = recordingContext();
    assert.doesNotThrow(() => renderPoker(ctx, 1280, 720, screen as never));
    assert.doesNotThrow(() => renderPoker(ctx, 1920, 1080, screen as never));
  });
});

describe("poker: elimination order and ranking", () => {
  test("busted players finish newest-out first and become spectators", async () => {
    const plugin = await loadPlugin();
    const players = mk(3);
    const instance = plugin.onStart(room(players), players);
    injectShowdown(
      instance,
      [c(2, "clubs"), c(7, "diamonds"), c(9, "spades"), c(11, "hearts"), c(4, "clubs")],
      [
        [c(13, "spades"), c(13, "diamonds")], // P1, stack 300, busts second
        [c(12, "spades"), c(12, "diamonds")], // P2, stack 100, busts first
        [c(14, "spades"), c(14, "diamonds")], // P3, stack 600, wins
      ],
      [300, 100, 600],
      [300, 100, 600],
    );
    plugin.onTick(instance, 50);
    const s = stateOf(instance);
    assert.deepStrictEqual(s.eliminationOrder, [1, 0], "shortest stack is out first");

    const screen = plugin.screenState(instance);
    const rows = screen.players as Array<{ name: string; out: boolean }>;
    assert.strictEqual(rows[0].out, true);
    assert.strictEqual(rows[1].out, true);
    assert.strictEqual(rows[2].out, false);

    const spectator = plugin.controllerState(instance, "p0");
    assert.strictEqual(spectator.spectator, true, "a busted player gets no playable controls");
    assert.strictEqual(spectator.out, true);
    assert.ok(!("cards" in spectator), "a spectator payload carries no hole cards");
    assert.strictEqual(plugin.controllerState(instance, "p2").spectator, undefined);

    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.playerId),
      ["p2", "p0", "p1"],
      "live stack first, then newest out, then the first player eliminated",
    );
    assert.deepStrictEqual(result.standings.map((standing) => standing.rank), [1, 2, 3]);
    assert.deepStrictEqual(result.standings.map((standing) => standing.raw), [1000, 0, 0]);
  });

  test("equal live stacks share a rank and the next busted rank skips the tie", async () => {
    const plugin = await loadPlugin();
    const players = mk(4);
    const instance = plugin.onStart(room(players), players, { maxHands: 1 });
    const s = stateOf(instance);
    s.finished = true;
    s.phase = "finished";
    s.turnIndex = -1;
    s.seats[0].chips = 500;
    s.seats[1].chips = 500;
    s.seats[2].chips = 0;
    s.seats[3].chips = 0;
    // Seat 2 went out first, seat 3 newest out.
    s.eliminationOrder = [2, 3];
    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.deepStrictEqual(result.standings.map((standing) => standing.rank), [1, 1, 3, 4]);
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.playerId),
      ["p0", "p1", "p3", "p2"],
    );
  });

  test("results report handsWon and biggestPot for the awards", async () => {
    const plugin = await loadPlugin();
    const players = mk(4);
    const instance = plugin.onStart(room(players), players);
    injectShowdown(
      instance,
      [c(2, "clubs"), c(7, "diamonds"), c(9, "spades"), c(6, "hearts"), c(4, "clubs")],
      [
        [c(14, "spades"), c(14, "diamonds")],
        [c(13, "spades"), c(13, "diamonds")],
        [c(12, "spades"), c(12, "diamonds")],
        [c(11, "spades"), c(11, "diamonds")],
      ],
      [100, 300, 600, 1000],
      [100, 300, 600, 1000],
    );
    plugin.onTick(instance, 50);
    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.stats["p0:handsWon"], 1, "winning any pot wins the hand once");
    assert.strictEqual(result.stats["p1:handsWon"], 1);
    assert.strictEqual(result.stats["p2:handsWon"], 1);
    assert.strictEqual(result.stats["p3:handsWon"], 1);
    assert.strictEqual(result.stats["p0:biggestPot"], 400);
    assert.strictEqual(result.stats["p2:biggestPot"], 600);
    assert.strictEqual(result.stats.biggestPot, 600);
  });
});

describe("poker: action timer", () => {
  test("a 25-second timeout folds when there is a bet to call at two and eight", async () => {
    const plugin = await loadPlugin();
    for (const count of [2, 8]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const s = stateOf(instance);
      const actor = s.turnIndex as number;
      for (let elapsed = 0; elapsed < 26000; elapsed += 2000) plugin.onTick(instance, 2000);
      assert.strictEqual(
        s.seats[actor].folded,
        true,
        `${count}: the timer folds a player facing a bet`,
      );
      if (count === 8) {
        // At two players the fold ends the hand and collectBets clears the
        // label; eight-handed the next player acts and the label survives.
        assert.strictEqual(s.seats[actor].lastAction, "fold (timeout)");
      }
    }
  });

  test("a 25-second timeout checks when the actor can match the bet", async () => {
    const plugin = await loadPlugin();
    for (const count of [2, 8]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players);
      const s = stateOf(instance);
      const actor = s.turnIndex as number;
      // Give the actor a matched bet so a check is legal.
      s.seats[actor].bet = s.currentBet;
      s.seats[actor].totalBet += s.currentBet;
      s.seats[actor].acted = false;
      for (let elapsed = 0; elapsed < 26000; elapsed += 2000) plugin.onTick(instance, 2000);
      assert.strictEqual(
        s.seats[actor].lastAction,
        "check (timeout)",
        `${count}: the timer checks when that is possible`,
      );
    }
  });
});

describe("poker: privacy", () => {
  test("hole cards never appear in the TV payload at any phase", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players);
    let sawShowdown = false;

    for (let tick = 0; tick < 4000; tick++) {
      const screen = plugin.screenState(instance);
      const json = JSON.stringify(screen);
      assert.ok(!json.includes('"cards"'), `TV payload leaked hole cards in ${String(screen.phase)}`);
      if (screen.phase === "showdown") {
        sawShowdown = true;
        assert.ok(Array.isArray(screen.showdown), "showdown still publishes hand names");
        assert.ok(
          (screen.showdown as Array<Record<string, unknown>>).every((row) => !("cards" in row)),
          "showdown rows carry no cards",
        );
      }
      if (screen.finished === true) break;
      passiveAction(plugin, instance);
      plugin.onTick(instance, 500);
    }
    assert.ok(sawShowdown, "the playthrough should reach at least one showdown");
  });

  test("one phone never receives another player's hole cards", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players);
    const own = plugin.controllerState(instance, "p0").cards as Array<{ suit: string; rank: string }>;
    assert.strictEqual(own.length, 2);
    const needle = JSON.stringify(own[0]);

    for (const player of players.slice(1)) {
      const other = JSON.stringify(plugin.controllerState(instance, player.id));
      assert.ok(!other.includes(needle), `${player.id} must not see P1's hole cards`);
    }
    assert.ok(
      JSON.stringify(plugin.controllerState(instance, "p0")).includes(needle),
      "your own cards stay on your phone",
    );
  });
});

describe("poker: chip conservation", () => {
  test("chips plus the live pot are constant through a hand at two and eight", async () => {
    const plugin = await loadPlugin();
    for (const count of [2, 8]) {
      const players = mk(count);
      const instance = plugin.onStart(room(players), players, { startingStack: 1000 });
      const total = count * 1000;
      const hand = stateOf(instance).handNumber as number;

      for (let tick = 0; tick < 4000; tick++) {
        const screen = plugin.screenState(instance);
        const s = stateOf(instance);
        const chips = (screen.players as Array<{ chips: number }>).reduce(
          (sum, player) => sum + player.chips,
          0,
        );
        assert.ok(Number.isFinite(chips), `${count}: chips must stay finite`);
        assert.ok(chips >= 0, `${count}: chips must never go negative`);
        assert.strictEqual(chips + Number(screen.pot), total, `${count}: chips are conserved`);
        if (screen.phase !== "showdown" && screen.phase !== "hand-end" && screen.finished !== true) {
          const pots = screen.pots as Array<{ amount: number }>;
          assert.strictEqual(
            pots.reduce((sum, pot) => sum + pot.amount, 0),
            Number(screen.pot),
            `${count}: the main pot plus side pots equals the live pot`,
          );
        }
        if (s.handNumber !== hand || screen.finished === true) break;
        passiveAction(plugin, instance);
        plugin.onTick(instance, 500);
      }
    }
  });
});

describe("poker: eight-player playthrough", () => {
  test("reaches finished with finite, non-negative chips and full results", async () => {
    const plugin = await loadPlugin();
    const players = mk(8);
    const instance = plugin.onStart(room(players), players, { startingStack: 1000 });

    for (let tick = 0; tick < 40000; tick++) {
      const s = stateOf(instance);
      if (s.finished === true) break;
      passiveAction(plugin, instance);
      plugin.onTick(instance, 500);
    }

    const screen = plugin.screenState(instance);
    assert.strictEqual(screen.finished, true, "the game must finish");
    const rows = screen.players as Array<{ chips: number; out: boolean; isDealer: boolean; lastAction: string | null }>;
    assert.strictEqual(rows.length, 8);
    for (const row of rows) {
      assert.ok(Number.isFinite(row.chips), "chips must be finite");
      assert.ok(row.chips >= 0, "chips must never be negative");
      assert.strictEqual(typeof row.out, "boolean");
      assert.strictEqual(typeof row.isDealer, "boolean");
      assert.ok("lastAction" in row);
    }
    assert.strictEqual(rows.reduce((sum, row) => sum + row.chips, 0), 8000);

    const result = plugin.results?.(instance);
    assert.ok(result);
    assert.strictEqual(result.standings.length, 8);
    assert.deepStrictEqual(
      [...new Set(result.standings.map((standing) => standing.playerId))].length,
      8,
    );
    for (const standing of result.standings) {
      assert.ok(Number.isFinite(standing.raw));
      assert.ok(standing.rank >= 1);
    }
    for (const key of ["p0:handsWon", "p0:biggestPot"]) {
      assert.strictEqual(typeof result.stats[key], "number", `${key} is reported`);
    }
  });
});
