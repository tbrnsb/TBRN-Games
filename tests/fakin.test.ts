/**
 * Fakin' It: 3-8 player flow, the secure-random Faker rotation without repeats,
 * the brief's payouts, TV secrecy before the reveal and the result stats.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, scalePayout, withinRoundBound } from "../shared/scoring.ts";
import { voteLayout } from "../shared/vote-options.ts";
import fakinPlugin, { buildFakerCycle, tallyFakerVotes } from "../games/fakin/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface TVOption {
  id: string;
  label: string;
  votes: number;
  selected: boolean;
}

interface TVScreen {
  phase: string;
  round: number;
  maxRounds: number;
  playerCount: number;
  prompt: string | null;
  instruction: string | null;
  fakerName: string | null;
  options: TVOption[];
  optionColumns: number;
  showVoteCounts: boolean;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  reveal: { accused: number | null; caught: boolean } | null;
  timerMs: number;
  players: Array<{ name: string; score: number }>;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: string | null;
}

interface FakinState {
  round: number;
  maxRounds: number;
  phase: string;
  faker: number;
  fakerOrder: number[];
  fakerCursor: number;
  realPrompt: string;
  fakePrompt: string;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { accused: number | null; caught: boolean } | null;
  stats: Record<string, number>;
}

interface FakinInstance {
  roomId: string;
  players: TestPlayer[];
  state: FakinState;
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

function startGame(count: number): { players: TestPlayer[]; inst: FakinInstance } {
  const players = makePlayers(count);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0].id,
    players,
    gameId: "fakin",
    gameState: null,
    createdAt: 0,
    status: "playing" as const,
  };
  return { players, inst: fakinPlugin.onStart(room, players) as unknown as FakinInstance };
}

/** Advance the clock until `phase`, the game finishes, or a step budget ends. */
function advanceTo(inst: FakinInstance, phase: string): void {
  for (let i = 0; i < 200 && inst.state.phase !== phase && inst.state.phase !== "finished"; i++) {
    fakinPlugin.onTick(inst, 2000);
  }
}

/** Every non-Faker votes for the real Faker, so the accusation lands. */
function castCaughtVotes(inst: FakinInstance, players: TestPlayer[]): void {
  const faker = inst.state.faker;
  players.forEach((player, i) => {
    if (i === faker) return;
    fakinPlugin.onInput(inst, player.id, { choice: `p:${faker}` });
  });
}

/**
 * Every vote lands on an innocent seat, so the Faker always escapes: one
 * innocent takes every other vote and the remaining voter is the only one
 * naming a different player.
 */
function castEscapeVotes(inst: FakinInstance, players: TestPlayer[]): void {
  const faker = inst.state.faker;
  const innocents = players.map((_, i) => i).filter((i) => i !== faker);
  const target = innocents[0];
  const fallback = innocents[1] ?? innocents[0];
  for (const voter of innocents) {
    const choice = voter === target ? fallback : target;
    fakinPlugin.onInput(inst, players[voter].id, { choice: `p:${choice}` });
  }
}

/** Play one round from acting through voting, leaving the instance at the reveal. */
function playRound(inst: FakinInstance, players: TestPlayer[], caught: boolean): void {
  advanceTo(inst, "voting");
  assert.strictEqual(inst.state.phase, "voting", "the acting clock must reach voting");
  if (caught) castCaughtVotes(inst, players);
  else castEscapeVotes(inst, players);
  assert.strictEqual(inst.state.phase, "reveal", "the ballot must close into the reveal");
}

const screenOf = (inst: FakinInstance): TVScreen => fakinPlugin.screenState(inst) as TVScreen;

describe("fakin", () => {
  test("the catalog reports 3-8 players, 3/5 standalone rounds, 3 rumble and the 25-second acting timer", () => {
    const entry = GAME_CATALOG.fakin;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      // The pre-expansion baseline keeps three rounds at 3-4; the brief's five
      // start at five players.
      assert.strictEqual(standalone.rounds, count <= 4 ? 3 : 5, `${count}: standalone rounds`);
      assert.deepStrictEqual(
        standalone.timers,
        { act: 25, vote: 20, reveal: 8 },
        `${count}: timers unchanged`,
      );
      assert.strictEqual(standalone.optionCaps?.options, count - 1, `${count}: phone options`);

      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 3, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
    }
  });

  test("the accusation needs more than half of the ballots", () => {
    assert.deepStrictEqual(tallyFakerVotes([1, 1, 0, 0], 1), { accused: 1, caught: false }, "2 of 4 is not a majority");
    assert.deepStrictEqual(tallyFakerVotes([1, 1, 1, 0, 0], 1), { accused: 1, caught: true }, "3 of 5 is");
    assert.deepStrictEqual(tallyFakerVotes([1, 2, null, null], 1), { accused: 1, caught: false }, "a tie never catches");
    assert.deepStrictEqual(tallyFakerVotes([null, null, null], 0), { accused: null, caught: false });
    assert.deepStrictEqual(tallyFakerVotes([-5, 99, null], 0), { accused: null, caught: false }, "garbage votes are ignored");
    assert.deepStrictEqual(tallyFakerVotes([1, 1], 1), { accused: 1, caught: true }, "every ballot catches");
  });

  test("a plurality that falls short of a majority does not catch the Faker", () => {
    const { players, inst } = startGame(5);
    advanceTo(inst, "voting");
    const faker = inst.state.faker;
    const voters = players.map((_, i) => i).filter((i) => i !== faker);

    // Two of four ballots name the Faker; the other two split, so the Faker
    // leads but has no strict majority.
    const ballots: Array<[number, number]> = [
      [voters[0], faker],
      [voters[1], faker],
      [voters[2], voters[0]],
      [voters[3], voters[1]],
    ];
    for (const [voter, target] of ballots) {
      fakinPlugin.onInput(inst, players[voter].id, { choice: `p:${target}` });
    }

    assert.strictEqual(inst.state.votes.filter((vote) => vote !== null).length, 4);
    assert.strictEqual(inst.state.phase, "reveal");
    assert.deepStrictEqual(inst.state.reveal, { accused: faker, caught: false });
    assert.strictEqual(inst.state.scores[faker], 500, "the Faker escapes");
    assert.strictEqual(inst.state.scores[voters[0]], 0, "a correct voter scores nothing on an escape");
  });

  test("the Faker rotation is a secure-random permutation of every seat", () => {
    for (let count = 3; count <= 8; count++) {
      for (let draw = 0; draw < 10; draw++) {
        const cycle = buildFakerCycle(count);
        assert.strictEqual(cycle.length, count, `${count}: cycle length`);
        assert.deepStrictEqual(
          [...cycle].sort((a, b) => a - b),
          Array.from({ length: count }, (_, seat) => seat),
          `${count}: every seat appears exactly once`,
        );
      }
    }
    assert.deepStrictEqual(buildFakerCycle(0), [], "an empty table has no cycle");
  });

  test("the rotation order differs across draws and rounds where secure random allows", () => {
    const orders = new Set<string>();
    for (let draw = 0; draw < 30; draw++) orders.add(JSON.stringify(buildFakerCycle(8)));
    assert.ok(orders.size > 1, "the order must not be fixed across cycles");

    const firstSeats = new Set<number>();
    for (let game = 0; game < 30; game++) firstSeats.add(startGame(8).inst.state.faker);
    assert.ok(firstSeats.size > 1, "round 1 must not always land on the same seat");
  });

  test("eight rounds at eight players cover every seat exactly once before any repeat", () => {
    const { players, inst } = startGame(8);
    inst.state.maxRounds = 8;
    const seen: number[] = [];

    for (let round = 0; round < 8; round++) {
      assert.strictEqual(inst.state.phase, "acting", `round ${round + 1}: starts in acting`);
      const faker = inst.state.faker;
      assert.ok(!seen.includes(faker), `round ${round + 1}: seat ${faker} repeated too early`);
      seen.push(faker);
      // Catch them every round so the round always reaches the reveal.
      playRound(inst, players, true);
      if (round < 7) advanceTo(inst, "acting");
    }

    assert.deepStrictEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(seen, inst.state.fakerOrder, "the round order is the drawn cycle");

    // Round 9 draws a fresh cycle instead of restarting the same one.
    inst.state.maxRounds = 9;
    advanceTo(inst, "acting");
    assert.strictEqual(inst.state.fakerOrder.length, 8);
    assert.strictEqual(inst.state.fakerCursor, 1);
    assert.strictEqual(inst.state.faker, inst.state.fakerOrder[0], "the new cycle starts at its first seat");
    assert.deepStrictEqual(
      [...inst.state.fakerOrder].sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7],
      "the fresh cycle is still a full permutation",
    );
  });

  test("playthrough at three players: three rounds, three different seats and the payouts", () => {
    const { players, inst } = startGame(3);
    assert.strictEqual(inst.state.maxRounds, 3, "3-4 players keep the baseline three rounds");
    const seen: number[] = [];

    for (let round = 0; round < 3; round++) {
      assert.strictEqual(inst.state.phase, "acting");
      seen.push(inst.state.faker);
      const before = [...inst.state.scores];
      const escaped = round === 1;
      playRound(inst, players, !escaped);

      for (let i = 0; i < 3; i++) {
        const gain = inst.state.scores[i] - before[i];
        if (i === seen[round]) {
          assert.strictEqual(gain, escaped ? 500 : 0, `round ${round + 1}: Faker ${i}`);
        } else {
          assert.strictEqual(gain, escaped ? 0 : 200, `round ${round + 1}: voter ${i}`);
        }
      }
      if (round < 2) advanceTo(inst, "acting");
    }

    assert.strictEqual(new Set(seen).size, 3, "three rounds use three different seats");

    advanceTo(inst, "finished");
    assert.strictEqual(inst.state.phase, "finished");
    const screen = screenOf(inst);
    assert.strictEqual(screen.finished, true);
    assert.strictEqual(typeof screen.winner, "string");
    // Two caught rounds pay 2 x 200 to each of two voters; the escaped round
    // pays the Faker 500.
    assert.strictEqual(inst.state.scores.reduce((sum, score) => sum + score, 0), 1300);
  });

  test("playthrough at eight players: eight seats, seven phone options, two TV columns", () => {
    const { players, inst } = startGame(8);
    const seen: number[] = [];

    for (let round = 0; round < 5; round++) {
      seen.push(inst.state.faker);

      // During acting each phone only knows its own instruction.
      const acting = fakinPlugin.controllerState(inst, players[0].id) as { info: string };
      assert.ok(acting.info.length > 0, "the acting phone shows an instruction");
      const actingScreen = screenOf(inst);
      assert.strictEqual(actingScreen.prompt, inst.state.realPrompt, "the TV shows the shared instruction");
      assert.strictEqual(actingScreen.players.length, 8, "the TV lists all eight seats");
      assert.strictEqual(actingScreen.options.length, 0, "no ballot before voting opens");

      advanceTo(inst, "voting");
      for (const [index, player] of players.entries()) {
        const controller = fakinPlugin.controllerState(inst, player.id) as {
          options: Array<{ id: string; label: string }>;
        };
        assert.strictEqual(controller.options.length, 7, `${index}: a phone offers seven other seats`);
        assert.ok(
          controller.options.every((option) => option.id !== `p:${index}`),
          `${index}: a phone never offers its own seat`,
        );
      }

      const screen = screenOf(inst);
      assert.strictEqual(screen.playerCount, 8);
      assert.strictEqual(screen.options.length, 8, "the TV shows every acting seat");
      assert.strictEqual(screen.optionColumns, 2, "eight options use the 7-9 layout");
      assert.strictEqual(voteLayout(screen.options.length).columns, 2);
      assert.deepStrictEqual(voteLayout(8).letters, ["A", "B", "C", "D", "E", "F", "G", "H"]);
      assert.deepStrictEqual(
        screen.waitingOn,
        players.map((player) => player.name),
        "the waiting list starts with the whole table",
      );

      castCaughtVotes(inst, players);
      assert.strictEqual(inst.state.phase, "reveal");
      if (round < 4) advanceTo(inst, "acting");
    }

    assert.strictEqual(new Set(seen).size, 5, "five rounds use five different seats");
  });

  test("correct voters get exactly 200 at three and four players", () => {
    for (const count of [3, 4]) {
      const { players, inst } = startGame(count);
      playRound(inst, players, true);
      for (let i = 0; i < count; i++) {
        if (i === inst.state.faker) {
          assert.strictEqual(inst.state.scores[i], 0, `${count}: a caught Faker scores nothing`);
        } else {
          assert.strictEqual(inst.state.scores[i], 200, `${count}: correct voter ${i} gets exactly 200`);
        }
      }
      assert.strictEqual(scalePayout(200, count), 200);
    }
  });

  test("correct-voter payouts scale with f(N) at five to eight players", () => {
    const expected: Record<number, number> = { 5: 150, 6: 120, 7: 100, 8: 86 };
    for (const [countText, payout] of Object.entries(expected)) {
      const count = Number(countText);
      assert.strictEqual(scalePayout(200, count), payout, `${count}: f(N) payout`);
      const { players, inst } = startGame(count);
      playRound(inst, players, true);
      for (let i = 0; i < count; i++) {
        if (i === inst.state.faker) continue;
        assert.strictEqual(inst.state.scores[i], payout, `${count}: correct voter ${i}`);
      }
      assert.strictEqual(inst.state.scores[inst.state.faker], 0, `${count}: Faker scores nothing when caught`);
    }
  });

  test("an uncaught Faker takes 500 fixed and voters score nothing", () => {
    for (const count of [5, 6, 8]) {
      const { players, inst } = startGame(count);
      playRound(inst, players, false);
      assert.strictEqual(inst.state.reveal?.caught, false, `${count}: the Faker escapes`);
      assert.strictEqual(inst.state.scores[inst.state.faker], 500, `${count}: the Faker takes 500`);
      for (let i = 0; i < count; i++) {
        if (i === inst.state.faker) continue;
        assert.strictEqual(inst.state.scores[i], 0, `${count}: voter ${i} scores nothing`);
      }
    }
  });

  test("one player's maximum round gain stays inside the 1500 bound at 3-8", () => {
    for (let count = 3; count <= 8; count++) {
      const ceiling = Math.max(scalePayout(200, count), 500);
      assert.ok(ceiling <= MAX_ROUND_SCORE, `${count}: ${ceiling} exceeds the round bound`);
      assert.ok(withinRoundBound(ceiling), `${count}: ${ceiling} fails the shared helper`);

      const caught = startGame(count);
      playRound(caught.inst, caught.players, true);
      for (let i = 0; i < count; i++) {
        const gain = caught.inst.state.scores[i];
        assert.ok(gain <= MAX_ROUND_SCORE, `${count}: caught round gain for ${i}`);
        assert.ok(withinRoundBound(gain), `${count}: caught round helper for ${i}`);
      }

      const escaped = startGame(count);
      playRound(escaped.inst, escaped.players, false);
      for (let i = 0; i < count; i++) {
        const gain = escaped.inst.state.scores[i];
        assert.ok(gain <= MAX_ROUND_SCORE, `${count}: escaped round gain for ${i}`);
        assert.ok(withinRoundBound(gain), `${count}: escaped round helper for ${i}`);
      }
    }
  });

  test("the TV never names the Faker, the fake prompt or the votes before the reveal", () => {
    const { players, inst } = startGame(8);
    const faker = inst.state.faker;
    const fakePrompt = inst.state.fakePrompt;

    const checkHidden = (label: string): void => {
      const screen = screenOf(inst);
      assert.strictEqual(screen.fakerName, null, `${label}: the Faker must not be named`);
      assert.strictEqual(screen.reveal, null, `${label}: the tally must stay hidden`);
      assert.strictEqual(screen.showVoteCounts, false, `${label}: vote counts must stay hidden`);
      assert.ok(
        screen.options.every((option) => option.votes === 0),
        `${label}: every option keeps a zero count`,
      );
      const payload = JSON.stringify(screen);
      assert.ok(!payload.includes("You are the Faker"), `${label}: the fake prompt leaked`);
      assert.ok(!payload.includes(fakePrompt), `${label}: the fake prompt text leaked`);
    };

    checkHidden("acting");
    advanceTo(inst, "voting");
    checkHidden("voting");
    assert.strictEqual(screenOf(inst).waitingOn.length, 8, "the Faker is not singled out by omission");

    castCaughtVotes(inst, players);
    assert.strictEqual(inst.state.phase, "reveal");
    const reveal = screenOf(inst);
    assert.strictEqual(reveal.fakerName, players[faker].name);
    assert.strictEqual(reveal.sound, "reveal");
    assert.match(reveal.prompt ?? "", /was the Faker/, "the reveal line names the role");
    assert.strictEqual(typeof reveal.caption, "string");
    assert.ok(reveal.caption && reveal.caption.length > 0);
    assert.strictEqual(reveal.showVoteCounts, true);
    assert.deepStrictEqual(reveal.reveal, { accused: faker, caught: true });
    assert.strictEqual(reveal.options[faker].votes, 7);
  });

  test("results reports standings plus correct votes and rounds undetected", () => {
    const { players, inst } = startGame(5);

    // Round 1: caught, so four voters named the real Faker.
    playRound(inst, players, true);
    const firstFaker = inst.state.faker;
    advanceTo(inst, "acting");

    // Round 2: nobody names the new Faker, who survives undetected.
    const secondFaker = inst.state.faker;
    playRound(inst, players, false);

    const results = fakinPlugin.results;
    assert.ok(results, "Fakin' It must publish results()");
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
    for (let i = 1; i < result.standings.length; i++) {
      assert.ok(result.standings[i - 1].raw >= result.standings[i].raw, "standings are highest first");
    }

    const correctFor = (id: string): number => result.stats[`${id}:correctVotes`] ?? 0;
    for (let i = 0; i < players.length; i++) {
      if (i === firstFaker) {
        assert.strictEqual(correctFor(players[i].id), 0, "the Faker never votes for themselves");
      } else {
        assert.strictEqual(correctFor(players[i].id), 1, `${players[i].id}: one correct vote`);
      }
    }

    assert.strictEqual(result.stats[`${players[secondFaker].id}:roundsUndetected`], 1);
    assert.strictEqual(result.stats[`${players[firstFaker].id}:roundsUndetected`], 0);
  });
});
