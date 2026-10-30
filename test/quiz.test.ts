import assert from "node:assert/strict";
import test from "node:test";

import { GameSession } from "../src/server/games/session.js";
import {
  createQuizGame,
  type QuizController,
  type QuizScreen,
  type QuizAnswerAction,
} from "../src/server/games/quiz/index.js";

const alice = { id: "p1", name: "Alice" };
const bob = { id: "p2", name: "Bob" };
const carol = { id: "p3", name: "Carol" };
const players = [alice, bob, carol];

function createSession(
  options: { now?: () => number; packId?: string; questionCount?: number } = {},
): GameSession {
  return new GameSession(
    createQuizGame({ packId: options.packId, questionCount: options.questionCount }),
    players,
    options.now ? { now: options.now, random: () => 0.5 } : { random: () => 0.5 },
  );
}

function screen(session: GameSession): QuizScreen {
  return session.screenView() as QuizScreen;
}

function controller(
  session: GameSession,
  player: { id: string },
): QuizController {
  return session.controllerView(player.id) as QuizController;
}

function answer(
  session: GameSession,
  player: { id: string },
  optionIndex: number,
) {
  return session.apply(player.id, { type: "answer", optionIndex });
}

test("starts with first question and answer window", () => {
  const session = createSession({ now: () => 1_000 });
  const view = screen(session);

  assert.equal(view.phase, "question");
  assert.equal(view.questionIndex, 0);
  assert.equal(view.totalQuestions, 15);
  assert.equal(view.question.text, "What is the capital of Australia?");
  assert.equal(view.question.options.length, 4);
  assert.equal(view.deadline, 21_000); // 20s window from 1000
  assert.equal(session.deadline(), 21_000);
});

test("scores correct answers with speed bonus when all answer", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  // All three answer correctly at 5 seconds in (15s remaining)
  now = 6_000;
  answer(session, alice, 2);
  answer(session, bob, 2);
  answer(session, carol, 2);

  const view = screen(session);
  assert.equal(view.phase, "reveal");
  assert.equal(view.correctIndex, 2);

  const aliceCtrl = controller(session, alice);
  // Base 1000 + speed bonus (15000/20000 * 1000 = 750)
  assert.equal(aliceCtrl.myScore, 1750);
});

test("scores zero for wrong answers when all answer", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  now = 6_000;
  // Wrong answer (Sydney = 0)
  answer(session, alice, 0);
  answer(session, bob, 2);
  answer(session, carol, 2);

  const aliceCtrl = controller(session, alice);
  assert.equal(aliceCtrl.myScore, 0);
  
  const bobCtrl = controller(session, bob);
  assert.ok(bobCtrl.myScore > 0);
});

test("rejects duplicate answers", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  now = 6_000;
  answer(session, alice, 2);

  assert.deepEqual(answer(session, alice, 1), {
    ok: false,
    code: "invalid_action",
    message: "You have already answered this question.",
  });
});

test("advances to next question after all players answer or deadline", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  now = 6_000;
  answer(session, alice, 2);
  answer(session, bob, 2);
  answer(session, carol, 2);

  const reveal = screen(session);
  assert.equal(reveal.phase, "reveal");
  assert.equal(reveal.questionIndex, 0);

  // Host advances
  const next = session.applyHostAction({ type: "next_question" });
  assert.deepEqual(next, { ok: true, finished: false });

  const nextView = screen(session);
  assert.equal(nextView.phase, "question");
  assert.equal(nextView.questionIndex, 1);
  assert.equal(nextView.question.text, "Which planet is known as the Red Planet?");
});

test("closes on deadline and treats non-answerers as wrong", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  now = 6_000;
  answer(session, alice, 2); // only Alice answers

  now = 25_000; // past 20s deadline
  assert.deepEqual(session.handleDeadline(), { ok: true, finished: false });

  const reveal = screen(session);
  assert.equal(reveal.phase, "reveal");
  assert.equal(reveal.correctIndex, 2);

  const aliceCtrl = controller(session, alice);
  const bobCtrl = controller(session, bob);
  // Alice answered at 6000, question started at 1000, so deltaMs = 5000
  // Score = 1000 + 1000 * (1 - 5000/20000) = 1000 + 1000 * 0.75 = 1750
  assert.equal(aliceCtrl.myScore, 1750);
  assert.equal(bobCtrl.myScore, 0);
});

test("rejects answers after deadline", () => {
  let now = 1_000;
  const session = createSession({ now: () => now });

  now = 25_000;
  assert.deepEqual(answer(session, alice, 2), {
    ok: false,
    code: "invalid_action",
    message: "Answer window is closed.",
  });
});

test("plays all questions and reports winners", () => {
  let now = 1_000;
  const session = createSession({ now: () => now, questionCount: 3 });

  for (let q = 0; q < 3; q++) {
    now += 5_000;
    for (const player of players) {
      answer(session, player, 2); // All answer Canberra (correct for q1), Mars (correct for q2), etc.
    }

    if (q < 2) {
      assert.deepEqual(session.applyHostAction({ type: "next_question" }), { ok: true, finished: false });
    }
  }

  assert.equal(session.finished, true);
  const finished = screen(session);
  assert.equal(finished.phase, "finished");
  assert.equal(finished.questionIndex, 2);
  assert.ok(finished.winners.length > 0);
});

test("respects questionCount limit", () => {
  const session = createSession({ questionCount: 5 });
  const view = screen(session);
  assert.equal(view.totalQuestions, 5);
});

test("uses only questions from specified pack", () => {
  const session = createSession({ packId: "quiz-questions" });
  const view = screen(session);
  // First question from the pack
  assert.equal(view.question.text, "What is the capital of Australia?");
});

test("solo game works correctly", () => {
  let now = 1_000;
  const session = new GameSession(
    createQuizGame({ questionCount: 3 }),
    [alice],
    { now: () => now, random: () => 0.5 },
  );

  for (let q = 0; q < 3; q++) {
    now += 5_000;
    answer(session, alice, 2);

    const reveal = screen(session);
    assert.equal(reveal.phase, "reveal");

    if (q < 2) {
      assert.deepEqual(session.applyHostAction({ type: "next_question" }), { ok: true, finished: false });
    }
  }

  assert.equal(session.finished, true);
  const finished = screen(session);
  assert.equal(finished.phase, "finished");
  assert.equal(finished.winners.length, 1);
});

test("speed bonus decreases as time passes", () => {
  let now = 1_000;
  const session = new GameSession(
    createQuizGame({ questionCount: 1 }),
    [alice],
    { now: () => now, random: () => 0.5 },
  );

  // Answer immediately at start (0ms elapsed)
  now = 1_000;
  answer(session, alice, 2);

  const reveal = screen(session);
  const aliceCtrl = controller(session, alice);
  // deltaMs = 0, score = 1000 + 1000 * 1 = 2000
  assert.equal(aliceCtrl.myScore, 2000);
});

test("scores zero when answered after deadline would have passed", () => {
  let now = 1_000;
  const session = new GameSession(
    createQuizGame({ questionCount: 1 }),
    [alice],
    { now: () => now, random: () => 0.5 },
  );

  // Answer after 25 seconds (past 20s deadline) - but we call handleDeadline first
  now = 25_000;
  // Since alice hasn't answered, deadline handler runs with empty answers
  session.handleDeadline();

  const reveal = screen(session);
  const aliceCtrl = controller(session, alice);
  // No answer recorded, score should be 0
  assert.equal(aliceCtrl.myScore, 0);
});