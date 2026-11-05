/**
 * Slogan Shirts: 3-8 player range, the 3-4 parity rounds, one full cycle from
 * five players, the cyclic slogan shift, scaled scoring, the round cap, the
 * eight-shirt TV grid, the phone ballot, reveal hooks and result stats.
 *
 * The 3-4 cases intentionally pin the original numbers: two rounds, a winning
 * shirt that pays both authors 1000, and 100 per vote for every other shirt.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, scalePayout, withinRoundBound } from "../shared/scoring.ts";
import plugin, {
  buildShirts,
  scoreShirts,
  shirtLayout,
  shirtPlan,
} from "../games/sloganshirts/server.ts";

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

interface ShirtState {
  mode: "standalone" | "rumble";
  round: number;
  maxRounds: number;
  designers: number[];
  phase: "draw" | "slogan" | "vote" | "reveal" | "finished";
  designs: Array<Array<{ points: Array<[number, number]>; color: string }> | null>;
  slogans: Array<string | null>;
  done: boolean[];
  shirts: Array<{ design: number; slogan: number }>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { winners: number[]; rows: Array<{ text: string; votes: number }> } | null;
  stats: Record<string, number>;
}

interface ShirtInstance {
  roomId: string;
  players: TestPlayer[];
  state: ShirtState;
}

interface TVShirt {
  id: string;
  design: Array<{ points: Array<[number, number]>; color: string }>;
  slogan: string;
  votes: number | null;
  author: string | null;
  sloganAuthor: string | null;
}

interface TVScreen {
  phase: string;
  round: number;
  maxRounds: number;
  shirtNumber: number;
  totalShirts: number;
  columns: number;
  rows: number;
  shirts: TVShirt[];
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
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

const mk = (n: number): TestPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));

const room = (players: TestPlayer[]): TestRoom => ({
  id: "r1",
  code: "ABCDE",
  hostPlayerId: players[0]?.id ?? null,
  players,
  gameId: "sloganshirts",
  gameState: null,
  createdAt: 0,
  status: "playing",
});

function startGame(count: number, mode?: "standalone" | "rumble"): { players: TestPlayer[]; inst: ShirtInstance } {
  const players = mk(count);
  const options = mode ? { mode } : undefined;
  const inst = plugin.onStart(room(players), players, options) as unknown as ShirtInstance;
  return { players, inst };
}

const screenOf = (inst: ShirtInstance): TVScreen => plugin.screenState(inst) as TVScreen;
const controllerOf = (inst: ShirtInstance, player: TestPlayer): ControllerState =>
  plugin.controllerState(inst, player.id) as ControllerState;

/** Draw in every design seat, then write a slogan on every phone. */
function drawAndWrite(inst: ShirtInstance, players: TestPlayer[]): void {
  for (const seat of inst.state.designers) {
    plugin.onInput(inst, players[seat].id, { stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111" } });
    plugin.onInput(inst, players[seat].id, { action: "action" });
  }
  assert.strictEqual(inst.state.phase, "slogan", "all designs submitted");

  for (const player of players) {
    plugin.onInput(inst, player.id, { text: `slogan ${player.name}` });
  }
  assert.strictEqual(inst.state.phase, "vote", "all slogans submitted");
}

/** One vote per player; `targets[seat]` is the shirt index that seat backs. */
function castVotes(inst: ShirtInstance, players: TestPlayer[], targets: number[]): void {
  targets.forEach((target, seat) => {
    assert.notStrictEqual(
      inst.state.shirts[target]?.design,
      seat,
      `seat ${seat} must not vote for their own design`,
    );
    plugin.onInput(inst, players[seat].id, { choice: `s:${target}` });
  });
  assert.strictEqual(inst.state.phase, "reveal", "the last vote settles the round");
}

function playRound(inst: ShirtInstance, players: TestPlayer[], targets: number[]): void {
  drawAndWrite(inst, players);
  castVotes(inst, players, targets);
}

function advanceFromReveal(inst: ShirtInstance): void {
  for (let i = 0; i < 10 && inst.state.phase === "reveal"; i++) {
    plugin.onTick(inst, 2000);
  }
}

const roundGains = (before: number[], after: number[]): number[] => after.map((score, i) => score - before[i]);

describe("slogan shirts", () => {
  test("the catalog and both manifests report 3-8 players and the round split", () => {
    const entry = GAME_CATALOG.sloganshirts;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);

    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "games", "sloganshirts", "manifest.json"), "utf8"),
    ) as { minPlayers: number; maxPlayers: number };
    assert.strictEqual(manifest.minPlayers, 3);
    assert.strictEqual(manifest.maxPlayers, 8);
    assert.strictEqual(plugin.manifest.minPlayers, 3);
    assert.strictEqual(plugin.manifest.maxPlayers, 8);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, count <= 4 ? 2 : 1, `${count}: standalone rounds`);
      assert.deepStrictEqual(standalone.timers, { draw: 60, slogan: 30, vote: 25, reveal: 9 });
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one shirt per design`);

      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, count <= 4 ? 2 : 1, `${count}: rumble rounds`);
      assert.strictEqual(
        rumble.optionCaps?.options,
        Math.min(count, 4),
        `${count}: the rumble caps the TV at four shirts`,
      );
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
    }
  });

  test("nobody is ever paired with their own slogan (3-8)", () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const shirts = buildShirts(n);
      assert.strictEqual(shirts.length, n);
      for (const shirt of shirts) {
        assert.notStrictEqual(shirt.design, shirt.slogan, `player ${shirt.design} got their own slogan`);
        assert.strictEqual(shirt.slogan, (shirt.design + 1) % n, "the shift is exactly one seat");
      }
      assert.strictEqual(new Set(shirts.map((shirt) => shirt.slogan)).size, n, "every slogan is used once");
    }

    // A Rumble subset still shifts by one and never pairs a design with itself.
    const subset = buildShirts(8, [7, 0, 5, 2]);
    assert.deepStrictEqual(
      subset.map((shirt) => shirt.design),
      [0, 2, 5, 7],
      "subset shirts keep seat order",
    );
    for (const shirt of subset) {
      assert.notStrictEqual(shirt.design, shirt.slogan);
      assert.strictEqual(shirt.slogan, (shirt.design + 1) % 8);
    }
  });

  test("the winning shirt pays both authors 1000, others 100 per vote", () => {
    const shirts = buildShirts(3); // design i, slogan i+1
    const points = scoreShirts([1, 1, 0], shirts, 3);
    // shirt 1 has 2 votes and wins: design 1 and slogan 2 each get 1000.
    // shirt 0 has 1 vote: design 0 and slogan 1 each get 100.
    assert.deepStrictEqual(points, [100, 1100, 1000]);
  });

  test("shirtPlan keeps 3-4 parity and gives 5-8 one full cycle", () => {
    for (const count of [3, 4]) {
      const plan = shirtPlan(count);
      assert.strictEqual(plan.rounds, 2, `${count}: two standalone rounds`);
      assert.deepStrictEqual(plan.designers, Array.from({ length: count }, (_, i) => i));
      assert.strictEqual(shirtPlan(count, "rumble").rounds, 2, `${count}: rumble parity`);
    }

    for (const count of [5, 6, 7, 8]) {
      const plan = shirtPlan(count);
      assert.strictEqual(plan.rounds, 1, `${count}: one full cycle`);
      assert.deepStrictEqual(
        plan.designers,
        Array.from({ length: count }, (_, i) => i),
        `${count}: every seat designs`,
      );

      const rumble = shirtPlan(count, "rumble");
      assert.strictEqual(rumble.rounds, 1, `${count}: rumble is one round`);
      assert.strictEqual(rumble.designers.length, 4, `${count}: four rumble shirts`);
      assert.strictEqual(new Set(rumble.designers).size, 4, `${count}: distinct designers`);
      assert.ok(rumble.designers.every((seat) => seat >= 0 && seat < count), `${count}: designer in range`);
    }

    assert.strictEqual(startGame(8).inst.state.maxRounds, 1, "the standalone start runs one cycle");
    const rumble = startGame(8, "rumble").inst;
    assert.strictEqual(rumble.state.maxRounds, 1);
    assert.strictEqual(rumble.state.designers.length, 4);
  });

  test("scoring: fixed 1000 winners and f(N)-scaled 100 per vote", () => {
    for (let count = 3; count <= 8; count++) {
      const shirts = buildShirts(count);
      const per = count <= 4 ? 100 : scalePayout(100, count);
      if (count <= 4) assert.strictEqual(per, 100, `${count}: exactly 100 per vote`);

      // Seat 0 cannot back shirt 0, so it backs shirt 1; everyone else backs
      // shirt 0. Shirt 0 wins outright with N-1 votes; shirt 1 has one vote.
      const votes: Array<number | null> = Array.from({ length: count }, (_, seat) => (seat === 0 ? 1 : 0));
      const points = scoreShirts(votes, shirts, count);
      assert.strictEqual(points[0], 1000, `${count}: the design author of the winner`);
      assert.strictEqual(points[1], 1000 + per, `${count}: the slogan author of the winner`);
      assert.strictEqual(points[2], per, `${count}: one vote on a non-winning shirt`);
      for (let seat = 3; seat < count; seat++) {
        assert.strictEqual(points[seat], 0, `${count}: seat ${seat} has no votes`);
      }
    }
  });

  test("3-4 players keep the old two-round totals exactly", () => {
    // Three players: each round seats 0 and 2 back shirt 1 and seat 1 backs
    // shirt 2, so shirt 1 wins. Old gains were [100, 1000, 1100] per round.
    const three = startGame(3);
    assert.strictEqual(three.inst.state.maxRounds, 2);
    playRound(three.inst, three.players, [1, 2, 1]);
    assert.deepStrictEqual(roundGains([0, 0, 0], three.inst.state.scores), [100, 1000, 1100]);
    advanceFromReveal(three.inst);
    playRound(three.inst, three.players, [1, 2, 1]);
    advanceFromReveal(three.inst);
    assert.deepStrictEqual(three.inst.state.scores, [200, 2000, 2200], "3-player fixture");
    assert.strictEqual(three.inst.state.phase, "finished");

    // Four players: round one is an all-shirt tie (2000 each), round two has
    // shirt 0 winning outright (1000/1100/100/0).
    const four = startGame(4);
    playRound(four.inst, four.players, [1, 2, 3, 0]);
    assert.deepStrictEqual(four.inst.state.scores, [2000, 2000, 2000, 2000], "every tied shirt pays 1000");
    advanceFromReveal(four.inst);
    playRound(four.inst, four.players, [1, 0, 0, 0]);
    advanceFromReveal(four.inst);
    assert.deepStrictEqual(four.inst.state.scores, [3000, 3100, 2100, 2000], "4-player fixture");
    assert.strictEqual(four.inst.state.phase, "finished");
  });

  test("no cap at 3-4; from five players a round gain is capped at 1500", () => {
    // An all-shirt tie pays each design author and each slogan author 1000, so
    // every player would take 2000. 3-4 keep that old total; 5-8 cap it.
    const four = startGame(4);
    playRound(four.inst, four.players, [1, 2, 3, 0]);
    assert.deepStrictEqual(four.inst.state.scores, [2000, 2000, 2000, 2000]);
    assert.ok(four.inst.state.scores.some((score) => score > MAX_ROUND_SCORE), "3-4 stays uncapped");

    for (let count = 5; count <= 8; count++) {
      const { players, inst } = startGame(count);
      playRound(inst, players, Array.from({ length: count }, (_, seat) => (seat + 1) % count));
      for (const score of inst.state.scores) {
        assert.ok(withinRoundBound(score), `${count}: ${score} exceeds the round bound`);
        assert.ok(score <= MAX_ROUND_SCORE, `${count}: ${score} above 1500`);
      }
      assert.deepStrictEqual(
        inst.state.scores,
        new Array<number>(count).fill(MAX_ROUND_SCORE),
        `${count}: the uncapped 2000 is clamped to 1500`,
      );
    }
  });

  test("playthrough at three: two rounds, reveal hooks and a clean finish", () => {
    const { players, inst } = startGame(3);
    assert.strictEqual(inst.state.maxRounds, 2);

    for (let round = 0; round < 2; round++) {
      assert.strictEqual(inst.state.round, round);
      assert.strictEqual(screenOf(inst).shirtNumber, round + 1);
      assert.strictEqual(screenOf(inst).totalShirts, 2);
      playRound(inst, players, [1, 2, 0]);

      const reveal = screenOf(inst);
      assert.strictEqual(reveal.sound, "reveal");
      assert.ok(reveal.caption && reveal.caption.length > 0, "the reveal has a public caption");
      assert.deepStrictEqual(reveal.waitingOn, []);
      assert.ok(inst.state.scores.every((score) => Number.isFinite(score) && score >= 0));
      advanceFromReveal(inst);
    }

    assert.strictEqual(inst.state.phase, "finished");
    const final = screenOf(inst);
    assert.strictEqual(final.finished, true);
    assert.ok(final.winner && final.winner.length > 0);
    assert.strictEqual(plugin.results!(inst).standings.length, 3);
  });

  test("eight shirts use the 4x2 grid and each phone has seven options", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(inst.state.maxRounds, 1);
    assert.strictEqual(inst.state.designers.length, 8);

    drawAndWrite(inst, players);
    const screen = screenOf(inst);
    assert.strictEqual(screen.shirts.length, 8, "eight shirts on the TV");
    assert.strictEqual(screen.columns, 4, "four columns");
    assert.strictEqual(screen.rows, 2, "two rows");
    assert.deepStrictEqual(shirtLayout(8), { columns: 4, rows: 2 });
    assert.deepStrictEqual(shirtLayout(3), { columns: 3, rows: 1 });
    assert.deepStrictEqual(shirtLayout(4), { columns: 4, rows: 1 });
    assert.deepStrictEqual(shirtLayout(5), { columns: 4, rows: 2 });

    for (const [seat, player] of players.entries()) {
      const controller = controllerOf(inst, player);
      assert.strictEqual(controller.mode, "choice");
      assert.strictEqual(controller.options.length, 7, `seat ${seat}: own design excluded`);
      const ownShirt = inst.state.shirts.findIndex((shirt) => shirt.design === seat);
      assert.ok(!controller.options.some((option) => option.id === `s:${ownShirt}`), `seat ${seat}: own shirt`);
    }
  });

  test("playthrough at eight: one cycle, eight shirts and a clean finish", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(inst.state.maxRounds, 1);
    assert.strictEqual(screenOf(inst).columns, 4);
    assert.strictEqual(screenOf(inst).rows, 2);

    playRound(inst, players, Array.from({ length: 8 }, (_, seat) => (seat + 1) % 8));
    const reveal = screenOf(inst);
    assert.strictEqual(reveal.shirts.length, 8);
    assert.ok(reveal.shirts.every((shirt) => shirt.slogan.length > 0), "every shirt carries a slogan");
    assert.ok(reveal.shirts.every((shirt) => typeof shirt.author === "string"), "design author at the reveal");
    assert.ok(reveal.shirts.every((shirt) => typeof shirt.sloganAuthor === "string"), "slogan author at the reveal");
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption && reveal.caption.length > 0);

    advanceFromReveal(inst);
    assert.strictEqual(inst.state.phase, "finished");
    assert.strictEqual(screenOf(inst).finished, true);
    assert.strictEqual(plugin.results!(inst).standings.length, 8);
  });

  test("authors stay off the TV until the reveal", () => {
    const { players, inst } = startGame(4);
    drawAndWrite(inst, players);

    const voting = screenOf(inst);
    assert.strictEqual(voting.phase, "vote");
    assert.ok(voting.shirts.every((shirt) => shirt.author === null), "no design author before the reveal");
    assert.ok(voting.shirts.every((shirt) => shirt.sloganAuthor === null), "no slogan author before the reveal");
    assert.ok(voting.shirts.every((shirt) => shirt.votes === null), "no tally before the reveal");

    castVotes(inst, players, [1, 2, 3, 0]);
    const reveal = screenOf(inst);
    reveal.shirts.forEach((shirt, index) => {
      assert.strictEqual(shirt.author, players[index].name, "shirt i is design i");
      assert.strictEqual(shirt.sloganAuthor, players[(index + 1) % 4].name, "shirt i carries slogan i + 1");
      assert.strictEqual(typeof shirt.votes, "number");
    });
  });

  test("a vote for your own design or an invalid shirt is ignored", () => {
    const { players, inst } = startGame(3);
    drawAndWrite(inst, players);

    const ownShirt = inst.state.shirts.findIndex((shirt) => shirt.design === 2);
    plugin.onInput(inst, "p2", { choice: `s:${ownShirt}` });
    assert.strictEqual(inst.state.votes[2], null, "own shirt rejected");
    plugin.onInput(inst, "p2", { choice: "s:99" });
    assert.strictEqual(inst.state.votes[2], null, "out-of-range shirt rejected");
  });

  test("waitingOn lists the seats still to draw, write and vote", () => {
    const { players, inst } = startGame(4);
    assert.deepStrictEqual(screenOf(inst).waitingOn, players.map((player) => player.name));

    plugin.onInput(inst, players[0].id, { stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111" } });
    plugin.onInput(inst, players[0].id, { action: "action" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[1].name, players[2].name, players[3].name]);
    for (const player of players.slice(1)) {
      plugin.onInput(inst, player.id, { action: "action" });
    }
    assert.strictEqual(inst.state.phase, "slogan");
    assert.deepStrictEqual(screenOf(inst).waitingOn, players.map((player) => player.name));

    plugin.onInput(inst, players[0].id, { text: "first" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[1].name, players[2].name, players[3].name]);
    for (const player of players.slice(1)) plugin.onInput(inst, player.id, { text: `from ${player.name}` });
    assert.strictEqual(inst.state.phase, "vote");

    plugin.onInput(inst, players[0].id, { choice: "s:1" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[1].name, players[2].name, players[3].name]);
    plugin.onInput(inst, players[1].id, { choice: "s:2" });
    plugin.onInput(inst, players[2].id, { choice: "s:3" });
    plugin.onInput(inst, players[3].id, { choice: "s:0" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, []);
  });

  test("a rumble at eight draws four shirts and only waits on their designers", () => {
    const { players, inst } = startGame(8, "rumble");
    assert.strictEqual(inst.state.maxRounds, 1);
    assert.strictEqual(inst.state.designers.length, 4);

    const designers = inst.state.designers;
    assert.deepStrictEqual(screenOf(inst).waitingOn, designers.map((seat) => players[seat].name));
    for (const [seat, player] of players.entries()) {
      if (designers.includes(seat)) continue;
      assert.strictEqual(controllerOf(inst, player).mode, "wait", "a non-designer does not draw");
    }

    drawAndWrite(inst, players);
    assert.strictEqual(inst.state.shirts.length, 4, "four shirts in the rumble");
    assert.strictEqual(screenOf(inst).columns, 4);
    assert.strictEqual(screenOf(inst).rows, 1);
  });

  test("results reports standings plus votesReceived and shirtsWon", () => {
    const { players, inst } = startGame(3);
    playRound(inst, players, [1, 2, 1]);

    const result = plugin.results!(inst);
    assert.strictEqual(result.standings.length, 3);
    result.standings.forEach((standing) => {
      assert.ok(Number.isFinite(standing.raw));
      assert.ok(Number.isInteger(standing.rank) && standing.rank >= 1);
    });

    // Shirt 1 (design 1, slogan 2) wins with 2 votes; shirt 2 has 1 vote.
    assert.strictEqual(result.stats[`${players[0].id}:votesReceived`], 1);
    assert.strictEqual(result.stats[`${players[1].id}:votesReceived`], 2);
    assert.strictEqual(result.stats[`${players[2].id}:votesReceived`], 3);
    assert.strictEqual(result.stats[`${players[0].id}:shirtsWon`], 0);
    assert.strictEqual(result.stats[`${players[1].id}:shirtsWon`], 1);
    assert.strictEqual(result.stats[`${players[2].id}:shirtsWon`], 1);
  });
});
