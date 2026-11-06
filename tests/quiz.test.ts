/**
 * Quiz: 1-8 player playthroughs in both modes, the standard and fast scoring
 * formulas, question/timer counts, reveal-only distribution, the round sanity
 * bound and the result stats.
 */
import { describe, test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { playerStatKey } from "../shared/results.ts";
import { MAX_ROUND_SCORE, withinRoundBound } from "../shared/scoring.ts";
import quizPlugin, {
  fastPoints,
  standardPoints,
  type QuizMode,
} from "../games/quiz/server.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface TestQuestion {
  id: string;
  text: string;
  options: Array<{ id: string; label: string }>;
  correct: string;
  explanation: string;
}

interface TestAnswer {
  optionId: string;
  timeMs: number;
}

interface QuizState {
  mode: QuizMode;
  questions: TestQuestion[];
  currentQuestion: number;
  timeLeft: number;
  phase: "waiting" | "question" | "reveal" | "finished";
  scores: number[];
  answers: Map<number, Map<string, TestAnswer>>;
  questionElapsedMs: number;
  questionTimeMs: number;
  stats: Record<string, number>;
  packId: string;
}

interface QuizInstance {
  roomId: string;
  players: TestPlayer[];
  state: QuizState;
}

interface TVScreen {
  mode: QuizMode;
  phase: string;
  question: {
    text: string;
    options: Array<{ id: string; label: string }>;
    correct: string | null;
  } | null;
  currentQuestion: number;
  totalQuestions: number;
  timeLeft: number;
  questionTimeMs: number;
  scores: Array<{ name: string; score: number }>;
  distribution: Array<{ id: string; count: number }> | null;
  answeredCount: number;
  playerCount: number;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface ControllerState {
  options: Array<{ id: string; label: string; selected?: boolean }>;
  hasAnswered: boolean;
  hasVoted: boolean;
  yourAnswer: string | null;
  correctAnswer: string | null;
  yourScore: number;
  timeLeft: number;
  questionTimeMs: number;
  phase: string;
  finished: boolean;
  youWon: boolean;
}

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `Player ${index + 1}`,
    joinedAt: 0,
    rejoinToken: `t${index}`,
    connected: true,
  }));
}

function startGame(count: number, mode?: QuizMode): { players: TestPlayer[]; inst: QuizInstance } {
  const players = makePlayers(count);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0].id,
    players,
    gameId: "quiz",
    gameState: null,
    createdAt: 0,
    status: "playing" as const,
  };
  const options = mode ? { mode } : undefined;
  const inst = quizPlugin.onStart(room, players, options) as unknown as QuizInstance;
  return { players, inst };
}

function screenOf(inst: QuizInstance): TVScreen {
  return quizPlugin.screenState(inst) as TVScreen;
}

function controllerOf(inst: QuizInstance, player: TestPlayer): ControllerState {
  return quizPlugin.controllerState(inst, player.id) as ControllerState;
}

function currentQuestion(inst: QuizInstance): TestQuestion {
  return inst.state.questions[inst.state.currentQuestion];
}

/** Leave the initial title beat and reach question one. */
function begin(inst: QuizInstance): void {
  if (inst.state.phase === "waiting") quizPlugin.onTick(inst, 0);
}

/** Close the current question and enter reveal. */
function advanceToReveal(inst: QuizInstance): void {
  quizPlugin.onTick(inst, inst.state.timeLeft + 1);
}

/** Leave reveal and start the next question, or finish the game. */
function advanceFromReveal(inst: QuizInstance): void {
  quizPlugin.onTick(inst, inst.state.timeLeft + 1);
}

function answerCorrect(inst: QuizInstance, player: TestPlayer): void {
  quizPlugin.onInput(inst, player.id, { choice: currentQuestion(inst).correct });
}

function answerWrong(inst: QuizInstance, player: TestPlayer): void {
  const question = currentQuestion(inst);
  const wrong = question.options.find((option) => option.id !== question.correct);
  assert.ok(wrong, "every question offers a wrong option");
  quizPlugin.onInput(inst, player.id, { choice: wrong.id });
}

/** Answer every question (right or wrong) and tick through to a finish. */
function playToEnd(players: TestPlayer[], inst: QuizInstance, correct: boolean): void {
  begin(inst);
  let guard = 0;
  while (inst.state.phase !== "finished" && guard++ < 400) {
    if (inst.state.phase === "question") {
      for (const player of players) {
        if (correct) answerCorrect(inst, player);
        else answerWrong(inst, player);
      }
      advanceToReveal(inst);
    } else if (inst.state.phase === "reveal") {
      advanceFromReveal(inst);
    } else if (inst.state.phase === "waiting") {
      begin(inst);
    }
  }
  assert.equal(inst.state.phase, "finished", "played through to the end");
}

describe("quiz modes and playthroughs", () => {
  test("standard is the default and runs 10 questions at 15 seconds", () => {
    const { inst } = startGame(3);
    begin(inst);
    const screen = screenOf(inst);
    assert.equal(screen.mode, "standard");
    assert.equal(screen.totalQuestions, 10);
    assert.equal(screen.questionTimeMs, 15000);
    assert.equal(screen.timeLeft, 15000);
    assert.equal(controllerOf(inst, inst.players[0]).questionTimeMs, 15000);
  });

  test("fast mode runs 6 questions at 10 seconds with four options", () => {
    const { inst } = startGame(3, "fast");
    begin(inst);
    const screen = screenOf(inst);
    assert.equal(screen.mode, "fast");
    assert.equal(screen.totalQuestions, 6);
    assert.equal(screen.questionTimeMs, 10000);
    assert.equal(screen.timeLeft, 10000);
    assert.equal(screen.question?.options.length, 4);
    assert.equal(controllerOf(inst, inst.players[0]).options.length, 4);
  });

  for (const count of [1, 8]) {
    test(`standard playthrough finishes at ${count} player(s)`, () => {
      const { players, inst } = startGame(count, "standard");
      playToEnd(players, inst, true);

      const screen = screenOf(inst);
      assert.equal(screen.phase, "finished");
      assert.equal(screen.totalQuestions, 10);
      assert.equal(screen.scores.length, count);
      for (const row of screen.scores) assert.equal(row.score, 15000);

      const result = quizPlugin.results?.(inst);
      assert.ok(result);
      assert.equal(result.standings.length, count);
      for (const player of players) {
        assert.equal(result.stats[playerStatKey(player.id, "correct")], 10);
        assert.equal(result.stats[playerStatKey(player.id, "answered")], 10);
        assert.equal(result.stats[playerStatKey(player.id, "fastestMs")], 0);
      }
    });

    test(`fast playthrough finishes at ${count} player(s)`, () => {
      const { players, inst } = startGame(count, "fast");
      playToEnd(players, inst, true);

      const screen = screenOf(inst);
      assert.equal(screen.phase, "finished");
      assert.equal(screen.totalQuestions, 6);
      assert.equal(screen.scores.length, count);
      for (const row of screen.scores) assert.equal(row.score, 6000);

      const result = quizPlugin.results?.(inst);
      assert.ok(result);
      for (const player of players) {
        assert.equal(result.stats[playerStatKey(player.id, "correct")], 6);
        assert.equal(result.stats[playerStatKey(player.id, "answered")], 6);
        assert.equal(result.stats[playerStatKey(player.id, "fastestMs")], 0);
      }
    });
  }

  test("fast mode still finishes when every answer is wrong", () => {
    const { players, inst } = startGame(4, "fast");
    playToEnd(players, inst, false);
    assert.equal(inst.state.phase, "finished");
    for (const row of screenOf(inst).scores) assert.equal(row.score, 0);
  });
});

describe("quiz scoring", () => {
  test("standard keeps the old rank bonuses at 3 and 4 players", () => {
    for (const count of [3, 4]) {
      const { players, inst } = startGame(count, "standard");
      begin(inst);

      // Stagger the answers by one second so the ranks are unambiguous.
      players.forEach((player, rank) => {
        if (rank > 0) quizPlugin.onTick(inst, 1000);
        answerCorrect(inst, player);
      });
      advanceToReveal(inst);

      const expected = [1500, 1400, 1300, 1200];
      players.forEach((player, rank) => {
        assert.equal(
          controllerOf(inst, player).yourScore,
          expected[rank],
          `${count} players rank ${rank}`,
        );
      });
    }
  });

  test("standard uses the linear clock bonus from five players", () => {
    assert.equal(standardPoints(0, 15000), 1500);
    assert.equal(standardPoints(5000, 15000), 1333);
    assert.equal(standardPoints(15000, 15000), 1000);

    for (let count = 5; count <= 8; count++) {
      const { players, inst } = startGame(count, "standard");
      begin(inst);

      players.forEach((player, index) => {
        if (index > 0) quizPlugin.onTick(inst, 1000);
        answerCorrect(inst, player);
      });
      advanceToReveal(inst);

      players.forEach((player, index) => {
        assert.equal(
          controllerOf(inst, player).yourScore,
          standardPoints(index * 1000, 15000),
          `${count} players rank ${index}`,
        );
      });
    }
  });

  test("standard pays 0 for a wrong answer", () => {
    const { players, inst } = startGame(3, "standard");
    begin(inst);
    quizPlugin.onTick(inst, 5000);
    answerWrong(inst, players[0]);
    answerCorrect(inst, players[1]);
    answerCorrect(inst, players[2]);
    advanceToReveal(inst);

    assert.equal(controllerOf(inst, players[0]).yourScore, 0);
    assert.equal(controllerOf(inst, players[1]).yourScore, 1500);
    assert.equal(controllerOf(inst, players[2]).yourScore, 1400);
  });

  test("standard pays 0 when nobody answers before the deadline", () => {
    const { players, inst } = startGame(3, "standard");
    begin(inst);
    advanceToReveal(inst);

    for (const player of players) {
      assert.equal(controllerOf(inst, player).yourScore, 0);
    }
  });

  test("fast formula at 0, 5 and 10 seconds with a 100 floor", () => {
    assert.equal(fastPoints(0), 1000);
    assert.equal(fastPoints(999), 1000);
    assert.equal(fastPoints(1000), 910);
    assert.equal(fastPoints(5000), 550);
    assert.equal(fastPoints(10000), 100);
    assert.equal(fastPoints(20000), 100);
    assert.equal(fastPoints(-1), 0);
  });

  test("fast scoring uses the server clock at 5 seconds", () => {
    const { players, inst } = startGame(3, "fast");
    begin(inst);
    quizPlugin.onTick(inst, 5000);
    for (const player of players) answerCorrect(inst, player);
    advanceToReveal(inst);

    for (const player of players) {
      assert.equal(controllerOf(inst, player).yourScore, 550);
    }
  });

  test("fast pays 0 for a wrong answer", () => {
    const { players, inst } = startGame(3, "fast");
    begin(inst);
    quizPlugin.onTick(inst, 5000);
    answerWrong(inst, players[0]);
    answerCorrect(inst, players[1]);
    answerCorrect(inst, players[2]);
    advanceToReveal(inst);

    assert.equal(controllerOf(inst, players[0]).yourScore, 0);
    assert.equal(controllerOf(inst, players[1]).yourScore, 550);
  });

  test("one round never pays more than the 1500 bound at 1-8 players", () => {
    for (let count = 1; count <= 8; count++) {
      for (const mode of ["standard", "fast"] as const) {
        const { players, inst } = startGame(count, mode);
        begin(inst);
        for (const player of players) answerCorrect(inst, player);
        advanceToReveal(inst);

        for (const row of screenOf(inst).scores) {
          assert.ok(
            withinRoundBound(row.score),
            `${count}/${mode}: ${row.score} exceeds ${MAX_ROUND_SCORE}`,
          );
        }
      }
    }
  });
});

describe("quiz reveal and TV hooks", () => {
  test("distribution is hidden before the reveal and shown at the reveal", () => {
    const { players, inst } = startGame(3, "standard");
    begin(inst);
    const question = currentQuestion(inst);

    const wrong = question.options.filter((option) => option.id !== question.correct);
    quizPlugin.onInput(inst, players[0].id, { choice: wrong[0].id });
    answerCorrect(inst, players[1]);
    quizPlugin.onInput(inst, players[2].id, { choice: wrong[1].id });

    const before = screenOf(inst);
    assert.equal(before.phase, "question");
    assert.equal(before.distribution, null);
    assert.equal(before.question?.correct, null, "the answer stays off the shared screen");
    assert.equal(before.answeredCount, 3);
    assert.ok(!JSON.stringify(before).includes("p0"), "no player ids in the TV payload");

    advanceToReveal(inst);
    const revealed = screenOf(inst);
    assert.equal(revealed.phase, "reveal");
    assert.equal(revealed.question?.correct, question.correct);
    assert.ok(revealed.distribution);
    assert.equal(
      revealed.distribution?.find((entry) => entry.id === question.correct)?.count,
      1,
    );
    assert.equal(
      revealed.distribution?.reduce((sum, entry) => sum + entry.count, 0),
      3,
    );
    assert.deepEqual(
      new Set(revealed.distribution?.map((entry) => entry.id)),
      new Set(question.options.map((option) => option.id)),
    );
  });

  test("waitingOn lists every player without an answer", () => {
    const { players, inst } = startGame(3, "standard");
    begin(inst);
    assert.deepEqual(screenOf(inst).waitingOn, players.map((player) => player.name));

    answerCorrect(inst, players[0]);
    assert.deepEqual(screenOf(inst).waitingOn, players.slice(1).map((player) => player.name));
  });

  test("reveal publishes the sound cue and a caption, but the question does not", () => {
    const { players, inst } = startGame(3, "standard");
    begin(inst);

    const question = screenOf(inst);
    assert.equal(question.sound, null);
    assert.equal(question.caption, null);

    for (const player of players) answerCorrect(inst, player);
    advanceToReveal(inst);

    const reveal = screenOf(inst);
    assert.equal(reveal.sound, "reveal");
    assert.equal(typeof reveal.caption, "string");
    assert.ok((reveal.caption ?? "").length > 0);
  });

  test("the merged content pack gives fast mode enough four-option questions", () => {
    const pack = JSON.parse(
      readFileSync(join(process.cwd(), "packs", "quiz-questions.json"), "utf8"),
    ) as { questions: Array<{ text: string; options: string[] }> };

    assert.ok(pack.questions.length >= 16, "the pack keeps the original questions plus trivia's");
    assert.ok(pack.questions.every((question) => question.options.length === 4));
    assert.ok(
      pack.questions.some((question) => question.text === "Which planet has the most moons?"),
      "Quick Trivia's bank is merged in",
    );
  });
});
