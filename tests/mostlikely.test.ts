/**
 * Most Likely To: 3-8 player flow, the unchanged top-vote scoring, the
 * eight-seat ballot and reveal, the round sanity bound, TV secrecy and the
 * result stats.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";
import mostlikelyPlugin from "../games/mostlikely/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface TVVote {
  name: string;
  count: number;
  seat: number;
  won: boolean;
}

interface TVScreen {
  prompt: string;
  currentPrompt: number;
  totalPrompts: number;
  phase: string;
  timeLeft: number;
  players: Array<{ name: string; score: number }>;
  votes: TVVote[] | null;
  roundWinner: string | null;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface ControllerState {
  phase: string;
  options: Array<{ id: string; label: string; selected?: boolean }>;
  hasVoted: boolean;
  canChangeVote: boolean;
  info: string;
  yourScore: number;
  finished: boolean;
  youWon: boolean;
}

interface MostLikelyState {
  prompts: string[];
  currentPrompt: number;
  phase: string;
  votes: Map<number, Map<string, string>>;
  scores: number[];
  timeLeft: number;
  roundWinner: number | null;
  stats: Record<string, number>;
}

interface MostLikelyInstance {
  roomId: string;
  players: TestPlayer[];
  state: MostLikelyState;
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

function startGame(count: number): { players: TestPlayer[]; inst: MostLikelyInstance } {
  const players = makePlayers(count);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0].id,
    players,
    gameId: "mostlikely",
    gameState: null,
    createdAt: 0,
    status: "playing" as const,
  };
  return { players, inst: mostlikelyPlugin.onStart(room, players) as unknown as MostLikelyInstance };
}

/** Advance the server clock until `phase`, the game finishes, or a step budget ends. */
function advanceTo(inst: MostLikelyInstance, phase: string): void {
  for (let i = 0; i < 200 && inst.state.phase !== phase && inst.state.phase !== "finished"; i++) {
    mostlikelyPlugin.onTick(inst, 2000);
  }
}

function screenOf(inst: MostLikelyInstance): TVScreen {
  return mostlikelyPlugin.screenState(inst) as TVScreen;
}

function controllerOf(inst: MostLikelyInstance, player: TestPlayer): ControllerState {
  return mostlikelyPlugin.controllerState(inst, player.id) as ControllerState;
}

/** Everyone votes once; the ballot closes into the tally as soon as the last phone votes. */
function castAllVotes(inst: MostLikelyInstance, players: TestPlayer[], target: (seat: number) => number): void {
  players.forEach((player, seat) => {
    mostlikelyPlugin.onInput(inst, player.id, { choice: String(target(seat)) });
  });
}

/** Play one round from voting through the result, leaving the instance at reveal. */
function playRound(inst: MostLikelyInstance, players: TestPlayer[], target: (seat: number) => number): void {
  assert.strictEqual(inst.state.phase, "voting", "a round starts in voting");
  castAllVotes(inst, players, target);
  assert.strictEqual(inst.state.phase, "tally", "the last ballot closes into the tally");
  advanceTo(inst, "reveal");
  assert.strictEqual(inst.state.phase, "reveal", "the tally always reaches the reveal");
}

describe("mostlikely", () => {
  test("the catalog and both manifests report 3-8 players and the scaled rounds", () => {
    const entry = GAME_CATALOG.mostlikely;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);

    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "games", "mostlikely", "manifest.json"), "utf8"),
    ) as { minPlayers: number; maxPlayers: number };
    assert.strictEqual(manifest.minPlayers, 3);
    assert.strictEqual(manifest.maxPlayers, 8);
    assert.strictEqual(mostlikelyPlugin.manifest.minPlayers, 3);
    assert.strictEqual(mostlikelyPlugin.manifest.maxPlayers, 8);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 8, `${count}: standalone rounds`);
      assert.strictEqual(standalone.timers?.vote, 15, `${count}: ballot timer unchanged`);
      assert.strictEqual(standalone.timers?.tally, 2, `${count}: drum-roll timer`);
      assert.strictEqual(standalone.timers?.reveal, 4, `${count}: result timer unchanged`);
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one option per seat`);

      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 5, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
    }
  });

  test("playthrough at three players: eight rounds, no crash and a final winner", () => {
    const { players, inst } = startGame(3);
    assert.strictEqual(inst.state.prompts.length, 8, "standalone runs eight rounds");

    for (let round = 0; round < 8; round++) {
      assert.strictEqual(inst.state.currentPrompt, round, `round ${round + 1}: prompt index`);
      playRound(inst, players, (seat) => (seat + 1) % 3);

      const screen = screenOf(inst);
      assert.strictEqual(screen.votes?.length, 3, "the reveal lists every seat");
      assert.strictEqual(screen.players.length, 3);
      assert.ok(screen.players.every((player) => Number.isFinite(player.score)));
      assert.ok(screen.players.every((player) => player.score >= 0), "scores never go negative");

      advanceTo(inst, "voting");
    }

    assert.strictEqual(inst.state.phase, "finished");
    const final = screenOf(inst);
    assert.strictEqual(final.finished, true);
    assert.ok(final.winner && final.winner.name.length > 0, "the finished game names a winner");
  });

  test("playthrough at eight players: eight options, a full tally and all eight seats", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(inst.state.prompts.length, 8, "standalone runs eight rounds");

    for (let round = 0; round < 8; round++) {
      for (const [seat, player] of players.entries()) {
        const controller = controllerOf(inst, player);
        assert.strictEqual(controller.options.length, 8, `${seat}: a phone offers every seat`);
        assert.ok(controller.canChangeVote, `${seat}: the ballot is open before voting`);
      }

      const before = [...inst.state.scores];
      playRound(inst, players, (seat) => (seat + 1) % 8);

      const screen = screenOf(inst);
      assert.strictEqual(screen.votes?.length, 8, "all eight seat badges are on the reveal");
      assert.strictEqual(
        screen.votes?.reduce((sum, vote) => sum + vote.count, 0),
        8,
        "every vote is counted once",
      );
      assert.deepStrictEqual(
        screen.votes?.map((vote) => vote.seat).sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7],
        "zero-vote seats stay on the board",
      );

      // Exactly one player scores per round, and only the top vote-getter.
      const gains = inst.state.scores.map((score, i) => score - before[i]);
      assert.strictEqual(gains.filter((gain) => gain > 0).length, 1, `round ${round + 1}: one scorer`);
      assert.strictEqual(Math.max(...gains), 10, "a single vote is worth ten points");

      advanceTo(inst, "voting");
    }

    assert.strictEqual(inst.state.phase, "finished");
    assert.strictEqual(screenOf(inst).finished, true);
  });

  test("scoring is unchanged at three and four players: max * 10 and no voter bonus", () => {
    for (const count of [3, 4]) {
      const { players, inst } = startGame(count);
      const before = [...inst.state.scores];
      playRound(inst, players, () => 1);

      const gains = inst.state.scores.map((score, i) => score - before[i]);
      assert.strictEqual(gains[1], count * 10, `${count}: the top vote-getter takes max * 10`);
      for (let i = 0; i < count; i++) {
        if (i === 1) continue;
        assert.strictEqual(gains[i], 0, `${count}: voter ${i} gets no bonus`);
      }

      const result = mostlikelyPlugin.results!(inst);
      const winnerId = players[1].id;
      assert.strictEqual(result.stats[`${winnerId}:votesReceived`], count, `${count}: votes received`);
      assert.strictEqual(result.stats[`${winnerId}:mostLikelyWins`], 1, `${count}: round win`);
    }
  });

  test("eight players: every phone offers all eight seats and self-voting is allowed", () => {
    const { players, inst } = startGame(8);
    const first = controllerOf(inst, players[0]);
    assert.strictEqual(first.options.length, 8);
    assert.ok(
      first.options.some((option) => option.id === "0" && option.label === players[0].name),
      "a phone offers its own seat",
    );
    assert.strictEqual(first.hasVoted, false);

    mostlikelyPlugin.onInput(inst, players[0].id, { choice: "0" });
    assert.strictEqual(
      inst.state.votes.get(0)?.get(players[0].id),
      players[0].id,
      "voting for yourself is stored",
    );
    const afterSelf = controllerOf(inst, players[0]);
    assert.strictEqual(afterSelf.hasVoted, true);
    assert.strictEqual(afterSelf.canChangeVote, true, "a vote can be changed until the ballot closes");
    assert.ok(afterSelf.options.find((option) => option.id === "0")?.selected, "the pick is marked");

    mostlikelyPlugin.onInput(inst, players[0].id, { choice: "3" });
    assert.strictEqual(
      inst.state.votes.get(0)?.get(players[0].id),
      players[3].id,
      "a later pick replaces the earlier vote",
    );
    assert.strictEqual(inst.state.phase, "voting", "a partial ballot stays open");
  });

  test("one player's maximum round gain stays inside the 1500 bound at 3-8", () => {
    for (let count = 3; count <= 8; count++) {
      const { players, inst } = startGame(count);
      playRound(inst, players, () => 2);

      const gains = inst.state.scores.map((score) => score);
      const top = Math.max(...gains);
      assert.strictEqual(top, count * 10, `${count}: the ceiling is N * 10`);
      assert.ok(top <= MAX_ROUND_SCORE, `${count}: ${top} exceeds the round bound`);
      assert.ok(withinRoundBound(top), `${count}: ${top} fails the shared helper`);
      for (const gain of gains) {
        assert.ok(gain <= MAX_ROUND_SCORE, `${count}: a single round gain is bounded`);
      }
    }
  });

  test("the tally stays off the TV until the reveal phase", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(screenOf(inst).votes, null, "voting hides the tally");

    // Three early ballots must not leak counts or the leading seat.
    for (let i = 0; i < 3; i++) {
      mostlikelyPlugin.onInput(inst, players[i].id, { choice: "4" });
    }
    const partial = screenOf(inst);
    assert.strictEqual(partial.phase, "voting");
    assert.strictEqual(partial.votes, null, "partial ballots stay hidden");
    assert.deepStrictEqual(partial.waitingOn, players.slice(3).map((player) => player.name));

    castAllVotes(inst, inst.players, (seat) => (seat < 4 ? 4 : 0));
    const tally = screenOf(inst);
    assert.strictEqual(tally.phase, "tally");
    assert.strictEqual(tally.votes, null, "the drum-roll beat still hides the tally");
    assert.strictEqual(tally.sound, "vote", "the tally plays the vote cue");
    assert.strictEqual(tally.roundWinner, null, "the winner is not named during the tally");
    assert.strictEqual(tally.caption, null, "no reveal caption during the tally");

    advanceTo(inst, "reveal");
    const reveal = screenOf(inst);
    assert.strictEqual(reveal.votes?.length, 8, "the reveal shows every seat");
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption && reveal.caption.length > 0, "the reveal has a public caption");
    assert.strictEqual(reveal.roundWinner, players[4].name, "the top vote-getter is named");
    assert.deepStrictEqual(reveal.waitingOn, [], "nobody is waited on after the ballot");
    const wonRows = reveal.votes?.filter((vote) => vote.won) ?? [];
    assert.strictEqual(wonRows.length, 1, "exactly one row is marked as the round win");
    assert.strictEqual(wonRows[0]?.name, players[4].name);
    assert.strictEqual(wonRows[0]?.count, 4);
  });

  test("results reports standings plus votes received and round wins", () => {
    const { players, inst } = startGame(4);
    playRound(inst, players, (seat) => (seat === 0 ? 0 : 2));

    const results = mostlikelyPlugin.results;
    assert.ok(results, "Most Likely To must publish results()");
    const result = results(inst);
    assert.strictEqual(result.standings.length, 4);
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.playerId).sort(),
      players.map((player) => player.id).sort(),
    );
    for (const standing of result.standings) {
      assert.ok(standing.rank >= 1 && standing.rank <= 4);
      assert.ok(Number.isFinite(standing.raw));
    }
    assert.strictEqual(result.stats[`${players[0].id}:votesReceived`], 1);
    assert.strictEqual(result.stats[`${players[2].id}:votesReceived`], 3);
    assert.strictEqual(result.stats[`${players[2].id}:mostLikelyWins`], 1);
    assert.strictEqual(result.stats[`${players[0].id}:mostLikelyWins`], 0);
  });
});
