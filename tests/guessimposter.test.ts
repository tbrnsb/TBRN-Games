/**
 * Guess the Imposter - server rules, scoring, secrecy and disconnects.
 *
 * The tests drive the real plugin through full scripted games with simulated
 * phones, then inspect both the authoritative state and the two payloads the
 * platform ships (TV screen state and per-phone controller state).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";
import plugin, {
  DISCONNECT_GRACE_MS,
  FINAL_GUESS_OPTIONS,
  MAX_CLUE_CHARS,
  PEEK_MS,
  REVEAL_MS,
  VOTE_BONUS_CAP,
  VOTE_REVEAL_MS,
  applyOrderRules,
  buildFinalGuessOptions,
  buildTurnOrder,
  cleanClueWord,
  maxEjectionsFor,
  settingsFromOptions,
  type ImposterState,
} from "../games/guessimposter/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  presence?: "active" | "away" | "left";
}

interface TestInstance {
  roomId: string;
  players: TestPlayer[];
  state: ImposterState;
}

interface ScreenState {
  phase: string;
  round: number;
  maxRounds: number;
  playerCount: number;
  activePlayer: { seat: number; id: string; name: string } | null;
  order: Array<{ seat: number; id: string; name: string; done: boolean; active: boolean }>;
  clues: Array<{ seat: number; text: string }>;
  vote: Record<string, unknown> | null;
  voteReveal: {
    ejected: { seat: number; side: string | null } | null;
    nobodyOut: boolean;
    secondTie: boolean;
  } | null;
  finalGuess: { seat: number; name: string } | null;
  ejected: Array<{ seat: number; side: string | null }>;
  finalReveal: {
    word: string;
    lookalike: string;
    category: string;
    winner: string;
    reason: string;
    imposters: Array<{ seat: number; name: string }>;
    larper: { seat: number; name: string; word: string } | null;
  } | null;
  playerCountRows?: unknown;
  finished: boolean;
  winner: string | null;
}

interface ControllerState {
  mode: string;
  controllerType: string;
  options: Array<{ id: string; label: string; selected?: boolean }>;
  role?: {
    title: string;
    body: string;
    category: string | null;
    holdLabel: string;
    secret: boolean;
  };
  hasVoted?: boolean;
  spectator?: boolean;
  info?: string;
  isYourTurn?: boolean;
  timerMs?: number | null;
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

function startGame(
  count: number,
  options?: Record<string, unknown>,
): { players: TestPlayer[]; inst: TestInstance } {
  const players = makePlayers(count);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0].id,
    players,
    gameId: "guessimposter",
    gameState: null,
    createdAt: 0,
    status: "playing" as const,
  };
  const inst = plugin.onStart(room, players, options) as unknown as TestInstance;
  return { players, inst };
}

function screenOf(inst: TestInstance): ScreenState {
  return plugin.screenState(inst) as unknown as ScreenState;
}

function controllerOf(inst: TestInstance, seat: number): ControllerState {
  return plugin.controllerState(inst, inst.players[seat].id) as unknown as ControllerState;
}

function tickExact(inst: TestInstance, ms: number): void {
  let remaining = Math.max(0, Math.floor(ms));
  let guard = 0;
  while (remaining > 0 && guard < 2000) {
    const step = Math.min(2000, remaining);
    plugin.onTick(inst, step);
    remaining -= step;
    guard += 1;
  }
}

function tickUntil(inst: TestInstance, phase: string, maxTicks = 400): void {
  for (let i = 0; i < maxTicks; i++) {
    if (inst.state.phase === phase || inst.state.phase === "finished" || inst.state.phase === "reveal") return;
    plugin.onTick(inst, 2000);
  }
}

function liveSeats(inst: TestInstance): number[] {
  const state = inst.state;
  return state.active.map((_, seat) => seat).filter((seat) => state.active[seat] && !state.removed[seat]);
}

function sendBallots(
  inst: TestInstance,
  ballots: Array<{ seat: number; target: number | "skip" }>,
): void {
  for (const ballot of ballots) {
    plugin.onInput(inst, inst.players[ballot.seat].id, {
      choice: ballot.target === "skip" ? "skip" : `p:${ballot.target}`,
    });
  }
}

/** Cast a ballot for every live voter, voting the target out. */
function voteOut(inst: TestInstance, target: number): void {
  const ballots: Array<{ seat: number; target: number | "skip" }> = [];
  for (const seat of liveSeats(inst)) {
    if (seat === target) {
      const other = liveSeats(inst).find((candidate) => candidate !== seat);
      if (other !== undefined) ballots.push({ seat, target: other });
      else if (inst.state.settings.allowSkipVotes) ballots.push({ seat, target: "skip" });
    } else {
      ballots.push({ seat, target });
    }
  }
  sendBallots(inst, ballots);
  if (inst.state.phase === "vote") tickExact(inst, 20100);
}

/** Complete the active clue turn, whatever the clue mode. */
function completeClueTurn(inst: TestInstance): void {
  const state = inst.state;
  const seat = state.order[state.turnIndex];
  if (seat === undefined) return;
  const input = state.settings.clueMode === "typed" ? { text: "hint" } : { action: "done" };
  plugin.onInput(inst, inst.players[seat].id, input);
}

/** Finish the whole clue cycle (all clue rounds). */
function finishClues(inst: TestInstance): void {
  for (let guard = 0; guard < 500 && inst.state.phase === "clue"; guard++) {
    completeClueTurn(inst);
  }
}

/** Complete exactly one clue round, stopping as soon as the next one begins. */
function completeOneClueRound(inst: TestInstance): void {
  const state = inst.state;
  const round = state.clueRound;
  for (let guard = 0; guard < 200; guard++) {
    if (state.phase !== "clue" || state.clueRound !== round) return;
    completeClueTurn(inst);
  }
}

/** Drive from any phase up to the vote phase. */
function reachVote(inst: TestInstance): void {
  for (let guard = 0; guard < 40; guard++) {
    const phase = inst.state.phase;
    if (phase === "vote") return;
    if (phase === "clue") {
      finishClues(inst);
      continue;
    }
    if (phase === "discussion") {
      tickUntil(inst, "vote");
      continue;
    }
    if (phase === "countdown" || phase === "peek") {
      tickUntil(inst, "clue");
      continue;
    }
    return;
  }
}

function resolveFinalGuess(inst: TestInstance, correct: boolean): void {
  const state = inst.state;
  const guess = state.finalGuess;
  if (!guess || guess.resolved) return;
  const word = state.roles.entry.word;
  const index = correct
    ? guess.options.indexOf(word)
    : guess.options.findIndex((option) => option !== word);
  assert.ok(index >= 0, "final guess must offer a wrong option");
  plugin.onInput(inst, inst.players[guess.seat].id, { choice: `o:${index}` });
}

type Strategy = "crewWin" | "steal" | "survival";

/** Play one word to its reveal (or finished) according to the strategy. */
function playWord(inst: TestInstance, strategy: Strategy): void {
  const state = inst.state;
  for (let guard = 0; guard < 120; guard++) {
    switch (state.phase) {
      case "countdown":
      case "peek":
        tickUntil(inst, "clue");
        break;
      case "clue":
        finishClues(inst);
        break;
      case "discussion":
        tickUntil(inst, "vote");
        break;
      case "vote": {
        const imposters = liveSeats(inst).filter((seat) => state.roles.imposters.includes(seat));
        if (strategy === "survival" || imposters.length === 0) {
          const crew = liveSeats(inst).find((seat) => !state.roles.imposters.includes(seat));
          if (crew === undefined) return;
          voteOut(inst, crew);
        } else {
          voteOut(inst, imposters[0]);
        }
        break;
      }
      case "voteReveal":
        tickExact(inst, VOTE_REVEAL_MS + 100);
        break;
      case "finalGuess":
        resolveFinalGuess(inst, strategy === "steal");
        break;
      case "reveal":
      case "finished":
        return;
      default:
        return;
    }
  }
}

function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return keyPaths(value[0], `${prefix}[*]`);
  }
  if (!value || typeof value !== "object") return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path, ...keyPaths(child, path));
  }
  return paths.sort();
}

function assertNoScreenSecrets(inst: TestInstance, label: string): void {
  const state = inst.state;
  const screen = screenOf(inst);
  const json = JSON.stringify(screen);
  for (const secret of [state.roles.entry.word, state.roles.entry.lookalike, state.roles.entry.category]) {
    assert.ok(!json.includes(secret), `${label}: TV leaked ${secret}`);
  }
  assert.ok(!/imposter/i.test(json), `${label}: TV leaked the imposter role`);
  assert.ok(!/larper/i.test(json), `${label}: TV leaked the larper role`);
  assert.strictEqual(screen.finalReveal, null, `${label}: final reveal arrived early`);
}

describe("guess the imposter settings", () => {
  test("defaults match the brief at six players", () => {
    const settings = settingsFromOptions(undefined, 6);
    assert.strictEqual(settings.mode, "standalone");
    assert.strictEqual(settings.rounds, 3);
    assert.strictEqual(settings.clueMode, "spoken");
    assert.strictEqual(settings.clueRounds, 2);
    assert.strictEqual(settings.turnTimerMs, 20000);
    assert.strictEqual(settings.discussionMs, 90000);
    assert.strictEqual(settings.imposterNotFirst, true);
    assert.strictEqual(settings.imposterNotLast, false);
    assert.strictEqual(settings.rerandomiseOrder, true);
    assert.strictEqual(settings.includeLarper, false);
    assert.strictEqual(settings.announceLarper, false);
    assert.strictEqual(settings.imposterSeesCategory, true);
    assert.strictEqual(settings.imposters, 1);
    assert.strictEqual(settings.allowSkipVotes, false);
    assert.strictEqual(settings.spokenAnnouncements, true);
  });

  test("rumble defaults to two words", () => {
    assert.strictEqual(settingsFromOptions({ mode: "rumble" }, 6).rounds, 2);
    assert.strictEqual(settingsFromOptions({ mode: "standalone" }, 6).rounds, 3);
  });

  test("player-count rules clamp the Larper and the second Imposter", () => {
    assert.strictEqual(settingsFromOptions({ includeLarper: true }, 4).includeLarper, false);
    assert.strictEqual(settingsFromOptions({ includeLarper: true }, 5).includeLarper, true);
    assert.strictEqual(settingsFromOptions({ includeLarper: true }, 3).announceLarper, false);

    assert.strictEqual(settingsFromOptions({ imposters: 2 }, 6).imposters, 1);
    assert.strictEqual(settingsFromOptions({ imposters: 2 }, 7).imposters, 2);
    assert.strictEqual(settingsFromOptions({ imposters: 1 }, 8).imposters, 1);
  });

  test("timers and round counts clamp to the legal settings", () => {
    assert.strictEqual(settingsFromOptions({ rounds: 0 }, 6).rounds, 1);
    assert.strictEqual(settingsFromOptions({ rounds: 9 }, 6).rounds, 5);
    assert.strictEqual(settingsFromOptions({ clueRounds: 9 }, 6).clueRounds, 3);
    assert.strictEqual(settingsFromOptions({ clueMode: "typed" }, 6).clueMode, "typed");
    assert.strictEqual(settingsFromOptions({ turnTimerSec: 10 }, 6).turnTimerMs, 10000);
    assert.strictEqual(settingsFromOptions({ turnTimerMs: 30000 }, 6).turnTimerMs, 30000);
    assert.strictEqual(settingsFromOptions({ turnTimerSec: 0 }, 6).turnTimerMs, 0);
    assert.strictEqual(settingsFromOptions({ turnTimer: "off" }, 6).turnTimerMs, 0);
    assert.strictEqual(settingsFromOptions({ discussionSec: 30 }, 6).discussionMs, 30000);
    assert.strictEqual(settingsFromOptions({ discussionMs: 180000 }, 6).discussionMs, 180000);
    assert.strictEqual(settingsFromOptions({ discussionSec: 5 }, 6).discussionMs, 30000);
    assert.strictEqual(settingsFromOptions({ discussionSec: 999 }, 6).discussionMs, 180000);
  });

  test("a requested Larper is dropped at three players", () => {
    const { inst } = startGame(3, { includeLarper: true, imposters: 2 });
    assert.strictEqual(inst.state.roles.larper, null);
    assert.strictEqual(inst.state.roles.imposters.length, 1);
  });
});

describe("guess the imposter clue text", () => {
  test("one word, twenty characters, controls removed", () => {
    assert.strictEqual(cleanClueWord("hello"), "hello");
    assert.strictEqual(cleanClueWord("  hello\nworld  "), "hello");
    assert.strictEqual(cleanClueWord("one two three"), "one");
    assert.strictEqual(cleanClueWord("a".repeat(40)), "a".repeat(MAX_CLUE_CHARS));
    assert.strictEqual(cleanClueWord("!!! ???"), null);
    assert.strictEqual(cleanClueWord("<script>"), "script");
    assert.strictEqual(cleanClueWord(42), null);
    assert.strictEqual(cleanClueWord(null), null);
    assert.strictEqual(cleanClueWord("café"), "café");
  });
});

describe("guess the imposter turn order", () => {
  test("the repair keeps a permutation and honours first/last rules", () => {
    for (let count = 3; count <= 8; count++) {
      const seats = Array.from({ length: count }, (_, seat) => seat);
      for (const imposters of [[0], [0, 1]]) {
        if (imposters.some((seat) => seat >= count)) continue;
        // Both end rules need at least two non-imposters to be satisfiable.
        if (count - imposters.length < 2) continue;
        for (let attempt = 0; attempt < 100; attempt++) {
          const order = buildTurnOrder(seats, imposters, { imposterNotFirst: true, imposterNotLast: true });
          assert.deepStrictEqual([...order].sort((a, b) => a - b), seats, `${count}: not a permutation`);
          assert.ok(!imposters.includes(order[0]), `${count}: imposter first`);
          assert.ok(!imposters.includes(order[order.length - 1]), `${count}: imposter last`);
        }
      }
    }
  });

  test("at three players both rules force the imposter into the middle", () => {
    const order = applyOrderRules([0, 1, 2], [0], { imposterNotFirst: true, imposterNotLast: true });
    assert.strictEqual(order[1], 0, "the imposter must sit between the two crew seats");
    assert.deepStrictEqual([...order].sort((a, b) => a - b), [0, 1, 2]);
  });

  test("the rules can be switched off", () => {
    const order = applyOrderRules([0, 1, 2], [0], { imposterNotFirst: false, imposterNotLast: false });
    assert.deepStrictEqual(order, [0, 1, 2]);
  });
});

describe("guess the imposter final guess options", () => {
  test("six distinct options always include the real word", () => {
    const { inst } = startGame(5);
    const entry = inst.state.roles.entry;
    const options = buildFinalGuessOptions(entry);
    assert.strictEqual(options.length, FINAL_GUESS_OPTIONS);
    assert.strictEqual(new Set(options).size, FINAL_GUESS_OPTIONS);
    assert.ok(options.includes(entry.word));
    assert.ok(options.includes(entry.decoys[0]));
  });
});

describe("guess the imposter playthroughs", () => {
  test("three players: crew catch, steal and survival in one full game", () => {
    const { players, inst } = startGame(3);
    const strategies: Strategy[] = ["crewWin", "steal", "survival"];
    const seen: number[][] = [];

    for (let round = 0; round < 3; round++) {
      seen.push([...inst.state.roles.imposters]);
      playWord(inst, strategies[round]);
      assert.strictEqual(inst.state.phase, "reveal", `round ${round + 1}: no reveal`);
      assert.ok(inst.state.wordResult, `round ${round + 1}: no word result`);
      for (const score of inst.state.roundScores) {
        assert.ok(withinRoundBound(score), `round ${round + 1}: round score ${score}`);
      }
      tickExact(inst, REVEAL_MS + 100);
    }

    assert.strictEqual(inst.state.phase, "finished");
    assert.strictEqual(inst.state.maxRounds, 3);
    const screen = screenOf(inst);
    assert.strictEqual(screen.finished, true);
    assert.strictEqual(screen.maxRounds, 3);
    assert.ok(screen.winner);
    for (const score of inst.state.scores) {
      assert.ok(Number.isFinite(score) && score >= 0, `bad final score ${score}`);
    }
    for (let i = 1; i < seen.length; i++) {
      const overlap = seen[i].filter((seat) => seen[i - 1].includes(seat));
      assert.deepStrictEqual(overlap, [], `round ${i + 1}: imposter repeated`);
    }

    const results = plugin.results?.(inst);
    assert.ok(results, "results() must be published");
    assert.strictEqual(results.standings.length, 3);
    assert.deepStrictEqual(
      results.standings.map((standing) => standing.playerId).sort(),
      players.map((player) => player.id).sort(),
    );
    for (const standing of results.standings) {
      assert.ok(standing.rank >= 1 && standing.rank <= 3);
      assert.ok(Number.isFinite(standing.raw));
    }
  });

  test("eight players: crew catch, steal and numbers in one full game", () => {
    const { inst } = startGame(8);
    const strategies: Strategy[] = ["crewWin", "steal", "survival"];
    const seen: number[][] = [];

    for (let round = 0; round < 3; round++) {
      seen.push([...inst.state.roles.imposters]);
      playWord(inst, strategies[round]);
      assert.strictEqual(inst.state.phase, "reveal", `round ${round + 1}: no reveal`);
      const result = inst.state.wordResult;
      assert.ok(result, `round ${round + 1}: no result`);
      if (strategies[round] === "crewWin") assert.strictEqual(result.winner, "crew");
      if (strategies[round] === "steal") {
        assert.strictEqual(result.winner, "imposters");
        assert.strictEqual(result.reason, "finalGuess");
      }
      if (strategies[round] === "survival") {
        assert.strictEqual(result.winner, "imposters");
        assert.strictEqual(result.reason, "numbers");
      }
      for (const score of inst.state.roundScores) {
        assert.ok(withinRoundBound(score), `round ${round + 1}: round score ${score}`);
      }
      tickExact(inst, REVEAL_MS + 100);
    }

    assert.strictEqual(inst.state.phase, "finished");
    for (const score of inst.state.scores) {
      assert.ok(Number.isFinite(score) && score >= 0, `bad final score ${score}`);
    }
    for (let i = 1; i < seen.length; i++) {
      const overlap = seen[i].filter((seat) => seen[i - 1].includes(seat));
      assert.deepStrictEqual(overlap, [], `round ${i + 1}: imposter repeated`);
    }
  });

  test("a caught imposter gets one final guess and can steal the word", () => {
    const { inst } = startGame(5, { rounds: 1 });
    reachVote(inst);
    const imposter = inst.state.roles.imposters[0];
    voteOut(inst, imposter);
    assert.strictEqual(inst.state.phase, "voteReveal");
    tickExact(inst, VOTE_REVEAL_MS + 100);
    assert.strictEqual(inst.state.phase, "finalGuess");

    const guess = inst.state.finalGuess;
    assert.ok(guess);
    const controller = controllerOf(inst, imposter);
    assert.strictEqual(controller.mode, "choice");
    assert.strictEqual(controller.options.length, FINAL_GUESS_OPTIONS);

    const tv = screenOf(inst);
    assert.strictEqual(tv.finalGuess?.seat, imposter);
    assert.ok(!JSON.stringify(tv).includes(inst.state.roles.entry.word), "TV saw the word before the reveal");

    resolveFinalGuess(inst, true);
    assert.strictEqual(inst.state.phase, "reveal");
    const result = inst.state.wordResult;
    assert.ok(result);
    assert.strictEqual(result.winner, "imposters");
    assert.strictEqual(result.reason, "finalGuess");
    assert.strictEqual(inst.state.scores[imposter], 700, "a correct steal pays 700");
    // Every crew voter named the imposter, so each still gets the vote bonus.
    for (let seat = 0; seat < 5; seat++) {
      if (seat === imposter) continue;
      assert.strictEqual(inst.state.scores[seat], 100, `seat ${seat}: correct-vote bonus`);
    }
  });

  test("a wrong final guess hands the word to the crew", () => {
    const { inst } = startGame(5, { rounds: 1 });
    reachVote(inst);
    const imposter = inst.state.roles.imposters[0];
    voteOut(inst, imposter);
    tickExact(inst, VOTE_REVEAL_MS + 100);
    assert.strictEqual(inst.state.phase, "finalGuess");
    resolveFinalGuess(inst, false);
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.wordResult?.winner, "crew");
    assert.strictEqual(inst.state.wordResult?.reason, "caught");
    for (let seat = 0; seat < 5; seat++) {
      if (seat === imposter) continue;
      assert.strictEqual(inst.state.scores[seat], 500, `seat ${seat}: 400 + one correct vote`);
    }
    assert.strictEqual(inst.state.scores[imposter], 0);
  });

  test("two imposters at seven players: catching both wins for the crew", () => {
    const { inst } = startGame(7, { rounds: 1, imposters: 2 });
    assert.strictEqual(inst.state.roles.imposters.length, 2);

    playWord(inst, "crewWin");
    assert.strictEqual(inst.state.phase, "reveal");
    const result = inst.state.wordResult;
    assert.ok(result);
    assert.strictEqual(result.winner, "crew");
    assert.strictEqual(result.reason, "caught");
    assert.strictEqual(result.imposters.length, 2);
    assert.strictEqual(inst.state.ejected.filter((entry) => entry.side === "imposter").length, 2);
  });
});

describe("guess the imposter elimination and win conditions", () => {
  test("typed clue turns submit one sanitised word and reach the vote", () => {
    const { inst } = startGame(5, { rounds: 1, clueMode: "typed" });
    tickUntil(inst, "clue");
    const seat = inst.state.order[inst.state.turnIndex];
    const controller = controllerOf(inst, seat);
    assert.strictEqual(controller.mode, "text");
    assert.strictEqual(controller.controllerType, "text");

    plugin.onInput(inst, inst.players[seat].id, { text: `  ${"x".repeat(40)}\nsecond word  ` });
    const entry = inst.state.clueHistory[0];
    assert.ok(entry);
    assert.strictEqual(entry.text, "x".repeat(MAX_CLUE_CHARS));
    assert.ok(screenOf(inst).clues.some((clue) => clue.text === entry.text), "the TV did not show the clue");

    finishClues(inst);
    assert.strictEqual(inst.state.phase, "discussion");
    assert.strictEqual(inst.state.clueHistory.length, 10, "two clue rounds at five players");
  });

  test("three players: ejecting a crew member ends the word for the imposter", () => {
    const { inst } = startGame(3, { rounds: 1 });
    reachVote(inst);
    const crew = liveSeats(inst).find((seat) => !inst.state.roles.imposters.includes(seat));
    assert.ok(crew !== undefined);
    voteOut(inst, crew);
    tickExact(inst, VOTE_REVEAL_MS + 100);
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.wordResult?.winner, "imposters");
    assert.strictEqual(inst.state.wordResult?.reason, "numbers");
    assert.strictEqual(inst.state.ejected.length, 1);
    assert.strictEqual(inst.state.ejected[0]?.side, "crew");
  });

  test("an ejection cap of N-1 is declared for every count", () => {
    for (let count = 3; count <= 8; count++) {
      assert.strictEqual(maxEjectionsFor(count), count - 1);
      const { inst } = startGame(count);
      assert.strictEqual(inst.state.maxVoteAttempts, count - 1);
    }
  });

  test("after N-1 nobody-out vote attempts the word ends for the imposter", () => {
    const { inst } = startGame(3, { rounds: 1 });
    const imposter = inst.state.roles.imposters[0];

    for (let attempt = 0; attempt < 2; attempt++) {
      reachVote(inst);
      const crew = liveSeats(inst).find((seat) => seat !== imposter);
      assert.ok(crew !== undefined);
      sendBallots(inst, [
        { seat: imposter, target: crew },
        { seat: crew, target: imposter },
      ]);
      tickExact(inst, 20100);
      assert.strictEqual(inst.state.phase, "vote", `attempt ${attempt + 1}: expected a revote`);
      assert.strictEqual(inst.state.revote, true);

      sendBallots(inst, [
        { seat: imposter, target: crew },
        { seat: crew, target: imposter },
      ]);
      tickExact(inst, 20100);
      assert.strictEqual(inst.state.phase, "voteReveal");
      assert.strictEqual(inst.state.voteReveal?.ejectedSeat, null);
      assert.strictEqual(inst.state.voteReveal?.secondTie, true);
      tickExact(inst, VOTE_REVEAL_MS + 100);
    }

    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.wordResult?.winner, "imposters");
    assert.strictEqual(inst.state.wordResult?.reason, "cap");
    assert.strictEqual(inst.state.voteAttempts, 2);
  });

  test("a tie triggers a revote and a decisive revote ejects the top seat", () => {
    const { inst } = startGame(5, { rounds: 1 });
    reachVote(inst);
    const imposter = inst.state.roles.imposters[0];
    const crewSeats = liveSeats(inst).filter((seat) => seat !== imposter);
    const tiedCrew = crewSeats[0];
    const abstainer = crewSeats[2];
    assert.ok(abstainer !== undefined);

    sendBallots(inst, [
      { seat: imposter, target: tiedCrew },
      { seat: tiedCrew, target: imposter },
      { seat: crewSeats[1], target: tiedCrew },
      { seat: abstainer, target: imposter },
    ]);
    tickExact(inst, 20100);
    assert.strictEqual(inst.state.phase, "vote");
    assert.strictEqual(inst.state.revote, true);
    assert.deepStrictEqual([...inst.state.tiedSeats].sort(), [imposter, tiedCrew].sort());

    // A revote only accepts the tied players as targets.
    const outsider = crewSeats.find((seat) => seat !== tiedCrew && seat !== abstainer);
    assert.ok(outsider !== undefined);
    plugin.onInput(inst, inst.players[abstainer].id, { choice: `p:${outsider}` });
    assert.strictEqual(inst.state.votes[abstainer], null, "revote accepted a non-tied target");

    sendBallots(inst, [
      { seat: imposter, target: tiedCrew },
      { seat: tiedCrew, target: imposter },
      { seat: crewSeats[1], target: imposter },
      { seat: abstainer, target: imposter },
    ]);
    tickExact(inst, 20100);
    assert.strictEqual(inst.state.phase, "voteReveal");
    assert.strictEqual(inst.state.ejected[0]?.seat, imposter);
    assert.strictEqual(inst.state.ejected[0]?.side, "imposter");
  });

  test("a ballot can change before the vote closes", () => {
    const { inst } = startGame(4, { rounds: 1 });
    reachVote(inst);
    const seat = liveSeats(inst)[0];
    const targets = liveSeats(inst).filter((target) => target !== seat);
    assert.ok(targets.length >= 2);
    plugin.onInput(inst, inst.players[seat].id, { choice: `p:${targets[0]}` });
    assert.strictEqual(inst.state.votes[seat], targets[0]);
    plugin.onInput(inst, inst.players[seat].id, { choice: `p:${targets[1]}` });
    assert.strictEqual(inst.state.votes[seat], targets[1], "a later pick must replace the first");
    assert.strictEqual(controllerOf(inst, seat).hasVoted, true);
  });

  test("skip votes are off by default and accepted only when enabled", () => {
    const off = startGame(4, { rounds: 1 });
    reachVote(off.inst);
    const seat = liveSeats(off.inst)[0];
    plugin.onInput(off.inst, off.inst.players[seat].id, { choice: "skip" });
    assert.strictEqual(off.inst.state.votes[seat], null, "skip must be rejected by default");

    const on = startGame(4, { rounds: 1, allowSkipVotes: true });
    reachVote(on.inst);
    const seatOn = liveSeats(on.inst)[0];
    const controller = controllerOf(on.inst, seatOn);
    assert.ok(controller.options.some((option) => option.id === "skip"));
    plugin.onInput(on.inst, on.inst.players[seatOn].id, { choice: "skip" });
    assert.strictEqual(on.inst.state.votes[seatOn], -1);
  });
});

describe("guess the imposter larper", () => {
  test("the larper payload has exactly the crew shape and the lookalike word", () => {
    const { inst } = startGame(5, { includeLarper: true, rounds: 1 });
    tickUntil(inst, "peek");
    assert.strictEqual(inst.state.phase, "peek");
    const larper = inst.state.roles.larper;
    assert.ok(larper !== null);
    const crew = liveSeats(inst).find(
      (seat) => seat !== larper && !inst.state.roles.imposters.includes(seat),
    );
    assert.ok(crew !== undefined);

    const crewPayload = controllerOf(inst, crew);
    const larperPayload = controllerOf(inst, larper);
    assert.deepStrictEqual(keyPaths(crewPayload), keyPaths(larperPayload), "larper payload shape drifted");
    assert.strictEqual(crewPayload.role?.title, larperPayload.role?.title);
    assert.ok(crewPayload.role?.body.startsWith(inst.state.roles.entry.word));
    assert.ok(crewPayload.role?.body.includes(inst.state.roles.entry.category));
    assert.ok(larperPayload.role?.body.startsWith(inst.state.roles.entry.lookalike));
    assert.ok(larperPayload.role?.body.includes(inst.state.roles.entry.category));
    assert.ok(!JSON.stringify(larperPayload).includes(inst.state.roles.entry.word));
    assert.ok(!/larper/i.test(JSON.stringify(larperPayload)), "the larper must not know their role");
  });

  test("a surviving larper scores 400 + 200 plus the vote bonus", () => {
    const { inst } = startGame(5, { includeLarper: true, rounds: 1 });
    const larper = inst.state.roles.larper;
    assert.ok(larper !== null);
    const imposter = inst.state.roles.imposters[0];

    reachVote(inst);
    voteOut(inst, imposter);
    tickExact(inst, VOTE_REVEAL_MS + 100);
    resolveFinalGuess(inst, false);

    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.scores[larper], 700, "larper: 400 + 200 + one correct vote");
    for (const seat of liveSeats(inst)) {
      if (seat === imposter || seat === larper) continue;
      assert.strictEqual(inst.state.scores[seat], 500, `crew ${seat}: 400 + one correct vote`);
    }
    const results = plugin.results?.(inst);
    assert.ok(results);
    assert.strictEqual(results.stats[`${inst.players[larper].id}:roundsUndetected`], 1);
  });

  test("the TV calls an ejected larper crew and never names the larper", () => {
    const { inst } = startGame(5, { includeLarper: true, rounds: 1 });
    const larper = inst.state.roles.larper;
    assert.ok(larper !== null);
    reachVote(inst);
    voteOut(inst, larper);
    assert.strictEqual(inst.state.phase, "voteReveal");
    const screen = screenOf(inst);
    assert.strictEqual(inst.state.ejected[0]?.side, "larper");
    assert.strictEqual(screen.ejected[0]?.side, "crew");
    assert.ok(!/larper/i.test(JSON.stringify(screen)));
    assert.strictEqual(controllerOf(inst, larper).spectator, true, "the ejected larper must be a spectator");
  });
});

describe("guess the imposter order settings in play", () => {
  test("the imposter is never first or last when both rules are on", () => {
    const { inst } = startGame(8, {
      rounds: 1,
      imposterNotFirst: true,
      imposterNotLast: true,
      rerandomiseOrder: true,
    });
    tickUntil(inst, "clue");
    const imposter = inst.state.roles.imposters[0];
    for (let round = 0; round < 2 && inst.state.phase === "clue"; round++) {
      const order = inst.state.order;
      assert.notStrictEqual(order[0], imposter, "imposter first");
      assert.notStrictEqual(order[order.length - 1], imposter, "imposter last");
      completeOneClueRound(inst);
    }
  });

  test("re-randomising off keeps the same order; on rebuilds it", () => {
    const off = startGame(8, { rounds: 1, rerandomiseOrder: false });
    tickUntil(off.inst, "clue");
    const firstOff = [...off.inst.state.order];
    completeOneClueRound(off.inst);
    assert.strictEqual(off.inst.state.phase, "clue");
    assert.deepStrictEqual(off.inst.state.order, firstOff, "order changed with re-randomise off");
    assert.strictEqual(off.inst.state.orderBuilds, 1);

    const on = startGame(8, { rounds: 1, rerandomiseOrder: true });
    tickUntil(on.inst, "clue");
    const firstOn = [...on.inst.state.order];
    completeOneClueRound(on.inst);
    assert.strictEqual(on.inst.state.phase, "clue");
    assert.ok(on.inst.state.orderBuilds > 1, "order was not rebuilt");
    assert.deepStrictEqual(
      [...on.inst.state.order].sort((a, b) => a - b),
      Array.from({ length: 8 }, (_, seat) => seat),
      "rebuilt order is not a permutation",
    );
    assert.ok(firstOn.length === 8);
  });

  test("the first/last rules still hold after an ejection with re-randomising off", () => {
    const { inst } = startGame(5, {
      rounds: 1,
      rerandomiseOrder: false,
      imposterNotFirst: true,
      imposterNotLast: true,
    });
    tickUntil(inst, "clue");
    const imposter = inst.state.roles.imposters[0];
    const firstSeat = inst.state.order[0];
    assert.notStrictEqual(firstSeat, imposter);

    finishClues(inst);
    tickUntil(inst, "vote");
    voteOut(inst, firstSeat);
    tickExact(inst, VOTE_REVEAL_MS + 100);
    assert.strictEqual(inst.state.phase, "clue", "the word should continue after a crew ejection");
    assert.notStrictEqual(inst.state.order[0], imposter, "the repair must survive an ejection");
    assert.notStrictEqual(inst.state.order[inst.state.order.length - 1], imposter);
  });

  test("spoken turn announcements follow the host setting", () => {
    const on = startGame(5, { rounds: 1 });
    tickUntil(on.inst, "clue");
    const active = on.inst.state.order[on.inst.state.turnIndex];
    const announced = plugin.screenState(on.inst) as unknown as Record<string, unknown>;
    assert.strictEqual(announced.announce, `${on.inst.players[active].name}, you're up`);

    const off = startGame(5, { rounds: 1, spokenAnnouncements: false });
    tickUntil(off.inst, "clue");
    const silent = plugin.screenState(off.inst) as unknown as Record<string, unknown>;
    assert.strictEqual(silent.announce, null);
  });
});

describe("guess the imposter scoring", () => {
  test("crew win pays 400 to remaining crew, 200 to the wrongly ejected and 100 per correct vote", () => {
    const { inst } = startGame(5, { rounds: 1 });
    const imposter = inst.state.roles.imposters[0];
    const crew = liveSeats(inst).filter((seat) => seat !== imposter);
    const ejectedCrew = crew[0];
    const remaining = crew.slice(1);

    // First vote: eject a crew member. Nobody votes for an imposter, so no bonus.
    reachVote(inst);
    const firstBallots: Array<{ seat: number; target: number }> = [];
    for (const seat of liveSeats(inst)) {
      if (seat === ejectedCrew) firstBallots.push({ seat, target: remaining[0] });
      else firstBallots.push({ seat, target: ejectedCrew });
    }
    sendBallots(inst, firstBallots);
    tickExact(inst, VOTE_REVEAL_MS + 100);
    assert.strictEqual(inst.state.phase, "clue", "the word should continue after a crew ejection");

    // Second vote: eject the imposter; the final guess misses.
    reachVote(inst);
    voteOut(inst, imposter);
    tickExact(inst, VOTE_REVEAL_MS + 100);
    resolveFinalGuess(inst, false);

    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.scores[ejectedCrew], 200, "wrongly ejected crew gets 200");
    assert.strictEqual(inst.state.scores[imposter], 0);
    for (const seat of remaining) {
      assert.strictEqual(inst.state.scores[seat], 500, `remaining crew ${seat}: 400 + 100`);
    }
    for (const score of inst.state.roundScores) {
      assert.ok(withinRoundBound(score), `round score ${score}`);
    }
  });

  test("imposter survival pays 1000 and everyone else only earns correct-vote bonuses", () => {
    const { inst } = startGame(5, { rounds: 1 });
    playWord(inst, "survival");
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.wordResult?.winner, "imposters");
    assert.strictEqual(inst.state.wordResult?.reason, "numbers");
    const imposter = inst.state.roles.imposters[0];
    assert.strictEqual(inst.state.scores[imposter], 1000);
    for (let seat = 0; seat < 5; seat++) {
      if (seat === imposter) continue;
      // Crew can only earn the 100-per-correct-vote bonus on an imposter win.
      assert.ok(inst.state.scores[seat] % 100 === 0, `crew ${seat}: stray score`);
      assert.ok(
        inst.state.scores[seat] <= VOTE_BONUS_CAP * 100,
        `crew ${seat}: vote bonus above the cap`,
      );
    }
    assert.strictEqual(VOTE_BONUS_CAP, 5);
    assert.ok(1000 + VOTE_BONUS_CAP * 100 <= MAX_ROUND_SCORE);
  });

  test("results reports correct accusations and rounds undetected", () => {
    const caught = startGame(3, { rounds: 1 });
    reachVote(caught.inst);
    const imposter = caught.inst.state.roles.imposters[0];
    voteOut(caught.inst, imposter);
    tickExact(caught.inst, VOTE_REVEAL_MS + 100);
    resolveFinalGuess(caught.inst, false);
    const caughtResults = plugin.results?.(caught.inst);
    assert.ok(caughtResults);
    for (let seat = 0; seat < 3; seat++) {
      const key = `${caught.inst.players[seat].id}:correctAccusations`;
      assert.strictEqual(caughtResults.stats[key], seat === imposter ? 0 : 1, `seat ${seat} accusations`);
    }
    assert.strictEqual(
      caughtResults.stats[`${caught.inst.players[imposter].id}:roundsUndetected`],
      0,
      "a caught imposter did not survive",
    );

    const survived = startGame(5, { rounds: 1 });
    playWord(survived.inst, "survival");
    const survivedResults = plugin.results?.(survived.inst);
    assert.ok(survivedResults);
    const survivor = survived.inst.state.roles.imposters[0];
    assert.strictEqual(
      survivedResults.stats[`${survived.inst.players[survivor].id}:roundsUndetected`],
      1,
      "a surviving imposter earns Master of Disguise credit",
    );
  });
});

describe("guess the imposter disconnects", () => {
  test("an imposter away for more than thirty seconds hands the word to the crew", () => {
    const { inst } = startGame(5, { rounds: 1 });
    const imposter = inst.state.roles.imposters[0];
    inst.players[imposter].connected = false;
    tickExact(inst, DISCONNECT_GRACE_MS + 100);
    assert.strictEqual(inst.state.phase, "reveal");
    assert.strictEqual(inst.state.wordResult?.winner, "crew");
    assert.strictEqual(inst.state.wordResult?.reason, "disconnect");
    assert.strictEqual(inst.state.scores[imposter], 0);
    for (let seat = 0; seat < 5; seat++) {
      if (seat === imposter) continue;
      assert.strictEqual(inst.state.scores[seat], 400, "remaining crew still get 400");
    }
    const results = plugin.results?.(inst);
    assert.ok(results);
    assert.strictEqual(
      results.stats[`${inst.players[imposter].id}:roundsUndetected`],
      0,
      "a disconnected imposter did not survive",
    );
  });

  test("a disconnected clue-turn player is skipped immediately", () => {
    const { inst } = startGame(5, { rounds: 1 });
    tickUntil(inst, "clue");
    const active = inst.state.order[inst.state.turnIndex];
    assert.ok(active !== undefined);
    const before = inst.state.turnIndex;
    inst.players[active].connected = false;
    plugin.onTick(inst, 500);
    assert.ok(
      inst.state.phase !== "clue" || inst.state.turnIndex !== before,
      "the disconnected player kept the turn",
    );
    if (inst.state.phase === "clue") {
      const next = inst.state.order[inst.state.turnIndex];
      assert.notStrictEqual(next, active);
    }
  });

  test("a disconnected larper is removed quietly without ending the word", () => {
    const { inst } = startGame(5, { includeLarper: true, rounds: 1 });
    const larper = inst.state.roles.larper;
    assert.ok(larper !== null);
    inst.players[larper].connected = false;
    tickExact(inst, DISCONNECT_GRACE_MS + 100);
    assert.strictEqual(inst.state.removed[larper], true);
    assert.strictEqual(inst.state.active[larper], false);
    assert.ok(!inst.state.ejected.some((entry) => entry.seat === larper));
    assert.notStrictEqual(inst.state.phase, "reveal", "the larper removal must not end the word");
  });
});

describe("guess the imposter payload secrecy", () => {
  test("every hidden phase keeps the word, lookalike, roles and votes off the TV", () => {
    const { inst } = startGame(5, { rounds: 1, includeLarper: true });
    assertNoScreenSecrets(inst, "countdown");
    tickUntil(inst, "peek");
    assertNoScreenSecrets(inst, "peek");
    assert.ok(inst.state.phase === "peek");
    tickExact(inst, PEEK_MS + 100);
    assert.strictEqual(inst.state.phase, "clue");
    assertNoScreenSecrets(inst, "clue");

    // The private cards are only on the phones; nobody gets somebody else's.
    const imposter = inst.state.roles.imposters[0];
    const imposterJson = JSON.stringify(controllerOf(inst, imposter));
    assert.ok(!imposterJson.includes(inst.state.roles.entry.word));
    assert.ok(!imposterJson.includes(inst.state.roles.entry.lookalike));

    finishClues(inst);
    assertNoScreenSecrets(inst, "discussion");
    tickUntil(inst, "vote");
    assert.strictEqual(inst.state.phase, "vote");
    assertNoScreenSecrets(inst, "vote");
    const screenDuringVote = screenOf(inst);
    assert.strictEqual(screenDuringVote.voteReveal, null);
    assert.ok(!JSON.stringify(screenDuringVote.vote ?? {}).includes('"target"'), "ballot targets leaked");

    voteOut(inst, imposter);
    assert.strictEqual(inst.state.phase, "voteReveal");
    // Votes are public now, but the imposter's side and the word are not.
    assert.ok(!JSON.stringify(screenOf(inst)).includes(inst.state.roles.entry.word));
    assert.strictEqual(screenOf(inst).voteReveal?.ejected?.side, null);

    tickExact(inst, VOTE_REVEAL_MS + 100);
    assert.strictEqual(inst.state.phase, "finalGuess");
    assertNoScreenSecrets(inst, "finalGuess");

    resolveFinalGuess(inst, false);
    assert.strictEqual(inst.state.phase, "reveal");
    const reveal = screenOf(inst).finalReveal;
    assert.ok(reveal);
    assert.strictEqual(reveal.word, inst.state.roles.entry.word);
    assert.strictEqual(reveal.lookalike, inst.state.roles.entry.lookalike);
    assert.deepStrictEqual(
      reveal.imposters.map((entry) => entry.seat),
      inst.state.roles.imposters,
    );
    assert.strictEqual(reveal.larper?.seat, inst.state.roles.larper);
  });

  test("the imposter card hides the category when that setting is off", () => {
    const { inst } = startGame(5, { rounds: 1, imposterSeesCategory: false });
    tickUntil(inst, "peek");
    const imposter = inst.state.roles.imposters[0];
    const controller = controllerOf(inst, imposter);
    assert.strictEqual(controller.role?.category, null);
    assert.ok(!JSON.stringify(controller).includes(inst.state.roles.entry.category));
    assert.match(controller.role?.title ?? "", /IMPOSTER/);
  });

  test("a crew phone never contains the imposter card or another player's word", () => {
    const { inst } = startGame(5, { rounds: 1, includeLarper: true });
    tickUntil(inst, "peek");
    const crew = liveSeats(inst).find(
      (seat) => seat !== inst.state.roles.larper && !inst.state.roles.imposters.includes(seat),
    );
    assert.ok(crew !== undefined);
    const json = JSON.stringify(controllerOf(inst, crew));
    assert.ok(!/IMPOSTER/.test(json));
    assert.ok(json.includes(inst.state.roles.entry.word));
  });
});

describe("guess the imposter catalog entry", () => {
  test("the catalog reports the brief's range, kind, duration and settings scale", () => {
    const entry = GAME_CATALOG.guessimposter;
    assert.ok(entry, "catalog entry missing");
    assert.strictEqual(entry.enabled, true);
    assert.strictEqual(entry.kind, "deduction");
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 5);
    assert.strictEqual(entry.idealMax, 8);
    assert.deepStrictEqual(entry.minutes, { standalone: 12, rumble: 7 });
    assert.strictEqual(entry.dropoutPolicy, "pause");
    assert.deepStrictEqual(entry.contentPacks, ["words"]);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 3, `${count}: standalone rounds`);
      assert.strictEqual(standalone.timers?.turn, 20);
      assert.strictEqual(standalone.timers?.discuss, 90);
      assert.strictEqual(standalone.optionCaps?.finalGuess, 6);
      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 2, `${count}: rumble rounds`);
    }
  });
});
