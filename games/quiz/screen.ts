/**
 * Quiz — paper-and-ink screen renderer (V3 reference).
 * DOM/CSS is the only path; the old synthwave canvas renderer is deleted.
 */
import {
  createMox,
  fitText,
  moxLine,
  sound,
  tokenMarkup,
  type MoxElement,
} from "../../client/kit/index.ts";

interface QuizScreenState {
  phase: "waiting" | "question" | "reveal" | "finished";
  question: { text: string; options: Array<{ id: string; label: string }>; correct: string | null } | null;
  currentQuestion: number;
  totalQuestions: number;
  timeLeft: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

// --- Paper-and-ink DOM renderer (V3) ---

interface QuizDomState {
  scene: HTMLElement;
  mox: MoxElement;
  key: string;
  timer: HTMLElement | null;
}

const quizDomStates = new WeakMap<HTMLElement, QuizDomState>();

function ensureQuizCss(): void {
  if (document.getElementById("quiz-paper-css")) return;
  const link = document.createElement("link");
  link.id = "quiz-paper-css";
  link.rel = "stylesheet";
  link.href = "/games/quiz/screen.css";
  document.head.appendChild(link);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderDom(root: HTMLElement, raw: unknown): void {
  ensureQuizCss();
  const state = raw as QuizScreenState;
  if (!state) return;

  let dom = quizDomStates.get(root);
  if (!dom) {
    root.className = "qz-paper";
    const scene = document.createElement("div");
    scene.className = "qz-scene";
    scene.style.display = "contents";
    const moxWrap = document.createElement("div");
    moxWrap.className = "qz-mox";
    const mox = createMox({ outfit: "party", pitch: 1.12, bank: "buzzer" });
    moxWrap.appendChild(mox);
    root.append(scene, moxWrap);
    dom = { scene, mox, key: "", timer: null };
    quizDomStates.set(root, dom);
  }

  const key = [
    state.phase,
    state.currentQuestion,
    state.question?.correct ?? "",
    state.scores.map((s) => `${s.name}:${s.score}`).join("|"),
    state.finished ? "1" : "0",
  ].join("~");

  if (key !== dom.key) {
    dom.key = key;
    dom.scene.innerHTML = buildQuizScene(state);
    dom.timer = dom.scene.querySelector<HTMLElement>(".qz-timer");
    window.setTimeout(() => fitQuizText(dom.scene), 80);

    if (state.phase === "question") {
      dom.mox.mox.say(moxLine("quizQuestion", { round: state.currentQuestion }, String(state.currentQuestion)), { holdMs: 2400 });
      sound.play("slide", { bank: "buzzer" });
    } else if (state.phase === "reveal") {
      const correct = state.question?.correct
        ? state.question.options.find((o) => o.id === state.question?.correct)?.label
        : "That one";
      dom.mox.mox.say(moxLine("quizReveal", { answer: correct ?? "That one" }, String(state.currentQuestion)), { expression: "smug", holdMs: 2800 });
      sound.play("reveal", { bank: "buzzer" });
    } else if (state.finished) {
      dom.mox.mox.say(moxLine("winner"), { expression: "celebrate" });
      sound.play("win", { bank: "buzzer" });
    }
  }

  if (dom.timer) {
    const seconds = Math.max(0, Math.ceil(state.timeLeft / 1000));
    dom.timer.textContent = String(seconds);
    dom.timer.classList.toggle("low", state.phase === "question" && seconds <= 5);
  }
}

function buildQuizScene(state: QuizScreenState): string {
  const question = state.question;
  const reveal = state.phase === "reveal";
  const head = `
    <header class="qz-head">
      <div class="qz-mast">QUIZ</div>
      <div class="qz-sub">Question ${Math.min(state.currentQuestion, state.totalQuestions)} of ${state.totalQuestions}<br><span class="qz-progress">${state.finished ? "Final scores" : reveal ? "Reveal" : "Pick on your phone"}</span></div>
      <div class="qz-spacer"></div>
      ${state.finished ? "" : `<div class="qz-timer" aria-live="off">${Math.ceil(state.timeLeft / 1000)}</div>`}
    </header>
  `;

  if (state.finished) {
    const winner = state.winner?.name ?? "Nobody";
    const tags = state.scores
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((s) => `<span class="score-tag">${escapeHtml(s.name)} — ${s.score}</span>`)
      .join("");
    return `${head}
      <section class="qz-final">
        <span class="k">Tonight's champion</span>
        <h2>${escapeHtml(winner)}</h2>
        <div class="score-list">${tags}</div>
      </section>`;
  }

  const options = (question?.options ?? []).map((option, i) => {
    const correct = reveal && option.id === question?.correct;
    const wrong = reveal && !correct;
    return `<div class="qz-option${correct ? " correct" : ""}${wrong ? " wrong" : ""}" role="listitem">
      <span class="qz-letter">${String.fromCharCode(65 + i)}</span>
      <span class="qz-label">${escapeHtml(option.label)}</span>
    </div>`;
  }).join("");

  const scores = state.scores.map((score, i) => {
    const max = Math.max(...state.scores.map((s) => s.score));
    return `<div class="qz-score">
      ${tokenMarkup(i, score.name)}
      <span class="nm">${escapeHtml(score.name)}</span>
      <span class="pts"${score.score === max && max > 0 ? ' style="color:var(--ink-2)"' : ""}>${score.score}</span>
    </div>`;
  }).join("");

  return `${head}
    <div class="qz-props" aria-hidden="true">
      <img class="qz-pin" src="/assets/props/pin.svg" alt="">
      <img class="qz-coffee" src="/assets/props/coffee-ring.svg" alt="">
      <img class="qz-star" src="/assets/props/star.svg" alt="">
    </div>
    <section class="qz-main">
      <div class="qz-question"><p>${escapeHtml(question?.text ?? "Waiting for the question…")}</p></div>
      <div class="qz-options" role="list">${options}</div>
    </section>
    <aside class="qz-scores" aria-label="Scores">
      <div class="qz-score-head">Scores</div>
      ${scores}
    </aside>`;
}

function fitQuizText(scene: HTMLElement): void {
  for (const label of scene.querySelectorAll<HTMLElement>(".qz-label")) {
    fitText(label, { min: 14, max: 30, lineHeight: 1.12 });
  }
}
