/**
 * Shared controller rendering utilities.
 * Used by both screen (for debugging) and controller clients.
 *
 * Each layout exposes:
 *   render(container, state, onInput)  - build the DOM for a state
 *   update(container, state)           - cheap update of dynamic values
 *   signature(state)                   - structural fingerprint; when it
 *                                        changes the client re-renders
 *                                        instead of updating
 *
 * A game's controller state may include a `labels` object to customize
 * button captions (e.g. dpad: { up: "+ Power", down: "Shoot" }).
 * All text coming from game state is HTML-escaped before rendering.
 */

import { optionLetter } from "./vote-options.ts";

export type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand"
  | "slider"
  | "dual-slider"
  | "pad"
  | "aim"
  | "tap-race"
  | "board"
  | "numpad"
  | "canvas"
  | "chat"
  | "rank"
  | "role";

export interface ControllerLayout {
  type: ControllerType;
  render: (container: HTMLElement, state: unknown, onInput: (input: unknown) => void) => void;
  update: (container: HTMLElement, state: unknown) => void;
  signature: (state: unknown) => string;
}

// Escape text that originates from game state (players can type answer
// text that ends up in other players' choice lists).
export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function labelsOf(state: unknown): Record<string, string> {
  if (state && typeof state === "object" && "labels" in state) {
    const labels = (state as { labels?: unknown }).labels;
    if (labels && typeof labels === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(labels as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  }
  return {};
}

// --- One Button ---
export function createOneButtonLayout(): ControllerLayout {
  return {
    type: "one-button",
    render(container, state, onInput) {
      const label = escapeHtml(labelsOf(state).button ?? "TAP");
      container.innerHTML = `
        <button class="btn-one" data-action="tap">
          <span class="btn-label">${label}</span>
          <span class="btn-count" id="tapCount"></span>
        </button>
      `;
      const btn = container.querySelector(".btn-one")!;
      btn.addEventListener("click", () => onInput({ tap: true }));
      btn.addEventListener("touchstart", (e) => { e.preventDefault(); onInput({ tap: true }); }, { passive: false });
      this.update(container, state);
    },
    update(container, state) {
      const countEl = container.querySelector("#tapCount");
      if (!countEl || !state || typeof state !== "object") return;
      if (typeof (state as { throttle?: unknown }).throttle === "boolean") {
        countEl.textContent = (state as { throttle: boolean }).throttle ? "ON" : "OFF";
      } else if ("yourTaps" in state) {
        countEl.textContent = String((state as { yourTaps: number }).yourTaps);
      }
    },
    signature(state) {
      return JSON.stringify(labelsOf(state).button ?? "TAP");
    },
  };
}

// --- Left-Right ---
export function createLeftRightLayout(): ControllerLayout {
  return {
    type: "left-right",
    render(container, state, onInput) {
      const labels = labelsOf(state);
      const left = escapeHtml(labels.left ?? "Left");
      const right = escapeHtml(labels.right ?? "Right");
      container.innerHTML = `
        <div class="lr-row">
          <button class="btn-lr left" data-input="left">${left}</button>
          <button class="btn-lr right" data-input="right">${right}</button>
        </div>
      `;
      container.querySelectorAll<HTMLButtonElement>(".btn-lr").forEach(btn => {
        btn.addEventListener("click", () => onInput({ move: btn.dataset.input }));
        btn.addEventListener("touchstart", (e) => { e.preventDefault(); onInput({ move: btn.dataset.input }); }, { passive: false });
      });
    },
    update(container, state) {
      // Visual feedback for position
      if (state && typeof state === "object" && "position" in state) {
        const pos = (state as { position: number }).position;
        container.style.setProperty("--position", String(pos));
      }
    },
    signature(state) {
      const labels = labelsOf(state);
      return JSON.stringify([labels.left ?? "Left", labels.right ?? "Right"]);
    },
  };
}

// --- D-Pad ---
export function createDpadLayout(): ControllerLayout {
  return {
    type: "dpad",
    render(container, state, onInput) {
      const labels = labelsOf(state);
      const glyphs: Record<string, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };
      const dirs = ["up", "left", "right", "down"] as const;
      container.innerHTML = `
        <div class="dpad">
          ${dirs.map((dir) => {
            const caption = labels[dir];
            return `<button class="dpad-btn ${dir}" data-input="${dir}"><span class="glyph">${glyphs[dir]}</span>${caption ? `<span class="cap">${escapeHtml(caption)}</span>` : ""}</button>`;
          }).join("")}
        </div>
      `;
      container.querySelectorAll<HTMLButtonElement>(".dpad-btn").forEach(btn => {
        btn.addEventListener("click", () => onInput({ move: btn.dataset.input }));
        btn.addEventListener("touchstart", (e) => { e.preventDefault(); onInput({ move: btn.dataset.input }); }, { passive: false });
      });
    },
    update(_container, _state) {},
    signature(state) {
      const labels = labelsOf(state);
      return JSON.stringify([labels.up ?? "", labels.down ?? "", labels.left ?? "", labels.right ?? ""]);
    },
  };
}

// --- Text Input ---
export function createTextLayout(): ControllerLayout {
  return {
    type: "text",
    render(container, state, onInput) {
      const placeholder = state && typeof state === "object" && "placeholder" in state
        ? String((state as { placeholder: string }).placeholder)
        : "Type your answer...";
      // Games may cap the field (short answers, chips). Default stays generous.
      const maxLength = state && typeof state === "object" && "maxLength" in state
        ? Math.min(280, Math.max(1, Math.floor(Number((state as { maxLength: unknown }).maxLength) || 200)))
        : 200;
      container.innerHTML = `
        <div class="text-input">
          <textarea id="textArea" placeholder="${escapeHtml(placeholder)}" maxlength="${maxLength}"></textarea>
          <button id="textSubmit" class="primary">Submit</button>
          <div class="char-count"><span id="charCount">0</span>/${maxLength}</div>
        </div>
      `;
      const textarea = container.querySelector("#textArea") as HTMLTextAreaElement;
      const submit = container.querySelector<HTMLButtonElement>("#textSubmit")!;
      const charCount = container.querySelector("#charCount")!;

      textarea.addEventListener("input", () => {
        charCount.textContent = String(textarea.value.length);
      });

      submit.addEventListener("click", () => {
        const text = textarea.value.trim();
        if (text) {
          onInput({ text });
          textarea.value = "";
          charCount.textContent = "0";
        }
      });

      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit.click();
        }
      });
    },
    update(_container, _state) {},
    signature(state) {
      const placeholder = state && typeof state === "object" && "placeholder" in state
        ? String((state as { placeholder: unknown }).placeholder)
        : "Type your answer...";
      const maxLength = state && typeof state === "object" && "maxLength" in state
        ? String((state as { maxLength: unknown }).maxLength)
        : "200";
      return `text:${placeholder}:${maxLength}`;
    },
  };
}

// --- Choice/Vote ---

/**
 * Whether the choice buttons must be locked.
 *
 * A turn flag is optional. Games that expose one (`yourTurn` / `isYourTurn`)
 * lock the buttons when it is somebody else's turn. Games that only report
 * "already answered" (`hasSubmitted` / `hasVoted`) stay tappable until the
 * player has answered — assuming it is not their turn would lock the whole
 * game away.
 */
export function choiceDisabled(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  // Voting games may keep the ballot open after the first pick so a player can
  // change their mind until everyone has voted. Honour the server's flag
  // rather than inventing a rule on the phone.
  if (s.canChangeVote === true) return false;
  const turn =
    typeof s.yourTurn === "boolean" ? s.yourTurn
      : typeof s.isYourTurn === "boolean" ? s.isYourTurn
        : null;
  const answered = s.hasSubmitted === true || s.hasVoted === true;
  return turn === false || answered;
}

export function createChoiceLayout(): ControllerLayout {
  return {
    type: "choice",
    render(container, state, onInput) {
      const options = state && typeof state === "object" && "options" in state
        ? (state as { options: Array<{ id: string; label: string }> }).options
        : [];
      const disabled = choiceDisabled(state);
      const compact = options.length > 8 && options.every((o) => o.label.length <= 2);
      // 7+ real vote options get the TV-matching letter badges and a dense
      // two-column phone grid. Single-character keypads (Hangman-style) keep
      // the existing compact auto-fill grid.
      const twoColumn = !compact && options.length >= 7;
      const layoutClass = compact
        ? "choices choices-grid"
        : twoColumn
          ? "choices two-column"
          : "choices";
      container.innerHTML = `
        <div class="${layoutClass}">
          ${options.map((opt, index) => `
            <button class="choice-btn" data-id="${escapeHtml(opt.id)}" ${disabled ? "disabled" : ""}>${twoColumn ? `<span class="choice-letter" aria-hidden="true">${optionLetter(index)}</span>` : ""}${escapeHtml(opt.label)}</button>
          `).join("")}
        </div>
      `;
      container.querySelectorAll<HTMLButtonElement>(".choice-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          onInput({ choice: btn.getAttribute("data-id") });
          container.querySelectorAll<HTMLButtonElement>(".choice-btn").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
        });
      });
    },
    update(container, state) {
      if (state && typeof state === "object" && "options" in state) {
        const options = (state as { options: Array<{ id: string; label: string; selected?: boolean }> }).options;
        container.querySelectorAll(".choice-btn").forEach(btn => {
          const id = btn.getAttribute("data-id");
          const opt = options.find(o => o.id === id);
          if (opt?.selected) btn.classList.add("selected");
          else btn.classList.remove("selected");
        });
      }
    },
    signature(state) {
      const options = state && typeof state === "object" && "options" in state
        ? (state as { options?: Array<{ id: string; label: string }> }).options ?? []
        : [];
      // The lock state belongs to the signature: a game that only flips
      // "your turn" (or "already voted") must re-render, not just update.
      return JSON.stringify([options.map(o => `${o.id}|${o.label}`), choiceDisabled(state)]);
    },
  };
}

// --- Private Grid ---
export function gridValueClass(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("[")) return "v-selected";
  if (raw === "X") return "v-X";
  if (raw === "o") return "v-o";
  if (raw === "S") return "v-S";
  return "v-fill";
}

export function createPrivateGridLayout(): ControllerLayout {
  return {
    type: "private-grid",
    render(container, state, onInput) {
      const raw = state && typeof state === "object"
        ? state as { rows?: number; cols?: number; cells?: unknown[][]; phase?: string }
        : {};
      const rows = raw.rows ?? 5;
      const cols = raw.cols ?? 5;
      const cells = raw.cells ?? [];
      const phase = raw.phase ?? "";
      const isBattle = rows === 20;

      const items: string[] = [];
      for (let i = 0; i < rows * cols; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        if (isBattle && r === 10 && c === 0) {
          items.push(`<div class="grid-divider">Enemy waters</div>`);
        }
        const value = String(cells[r]?.[c] ?? "");
        items.push(
          `<button class="grid-cell ${gridValueClass(value)}" data-row="${r}" data-col="${c}">${escapeHtml(value.replace(/[[\]]/g, ""))}</button>`,
        );
      }

      container.style.setProperty("--grid-cols", String(cols));
      container.innerHTML = `
        <div class="grid-frame">
          <div class="grid-label"><span>Your fleet</span><span>${isBattle ? "tap below to fire" : "tap a cell"}</span></div>
          <div class="grid-wrap">
            <div class="grid" style="grid-template-columns: repeat(${cols}, 1fr);">
              ${items.join("")}
            </div>
          </div>
          ${isBattle ? `
            <div class="grid-actions">
              <span class="pick" id="gridPick">Tap a target cell</span>
              <button class="primary" id="gridConfirm" disabled>${phase === "placing" ? "Place" : "Fire"}</button>
            </div>
          ` : ""}
        </div>
      `;

      const pick = container.querySelector<HTMLElement>("#gridPick");
      const confirm = container.querySelector<HTMLButtonElement>("#gridConfirm");

      const clearPick = () => {
        container.querySelectorAll(".grid-cell.v-picked").forEach((cell) => cell.classList.remove("v-picked"));
        container.dataset.row = "";
        container.dataset.col = "";
        if (pick) {
          pick.textContent = "Tap a target cell";
          pick.classList.remove("ready");
        }
        if (confirm) confirm.disabled = true;
      };

      const send = (row: number, col: number) => {
        onInput({ grid: { row, col } });
        clearPick();
      };

      container.querySelectorAll<HTMLButtonElement>(".grid-cell").forEach(cell => {
        cell.addEventListener("click", () => {
          const r = Number(cell.dataset.row);
          const c = Number(cell.dataset.col);
          if (!isBattle) {
            send(r, c);
            return;
          }
          // Only the half the server is asking for can be tapped.
          if (phase === "playing" && r < 10) return;
          if (phase === "placing" && r >= 10) return;

          container.querySelectorAll(".grid-cell.v-picked").forEach((el) => el.classList.remove("v-picked"));
          cell.classList.add("v-picked");
          container.dataset.row = String(r);
          container.dataset.col = String(c);

          const boardRow = phase === "placing" ? r + 1 : r - 9;
          const coord = `${String.fromCharCode(65 + c)}${boardRow}`;
          if (pick) {
            pick.textContent = `${phase === "placing" ? "Place at" : "Fire at"} ${coord}`;
            pick.classList.add("ready");
          }
          if (confirm) {
            confirm.disabled = false;
            confirm.textContent = phase === "placing" ? "Place" : "Fire";
          }
        });
      });

      confirm?.addEventListener("click", () => {
        const r = Number(container.dataset.row);
        const c = Number(container.dataset.col);
        if (Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0) send(r, c);
      });
    },
    update(container, state) {
      if (!state || typeof state !== "object" || !("cells" in state)) return;
      const { cells = [] } = state as { cells: unknown[][] };
      container.querySelectorAll<HTMLButtonElement>(".grid-cell").forEach(cell => {
        const r = Number(cell.dataset.row);
        const c = Number(cell.dataset.col);
        const value = String(cells[r]?.[c] ?? "");
        cell.textContent = value.replace(/[[\]]/g, "");
        const picked = cell.classList.contains("v-picked");
        cell.className = `grid-cell ${gridValueClass(value)}${picked ? " v-picked" : ""}`;
      });
    },
    signature(state) {
      const s = state && typeof state === "object"
        ? state as { rows?: number; cols?: number; phase?: string }
        : {};
      return `grid:${s.rows ?? 5}x${s.cols ?? 5}:${s.phase ?? ""}`;
    },
  };
}

// --- Card Hand ---
const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠"
};

export interface PokerActions {
  show: boolean;
  yourTurn: boolean;
  locked: boolean;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  raiseStep: number;
}

/**
 * Pure description of the action bar a card-hand controller should show.
 * Exported so the controller logic can be tested without a DOM.
 */
export function pokerActions(state: unknown): PokerActions {
  const s = state && typeof state === "object" ? state as Record<string, unknown> : {};
  const show =
    typeof s.yourTurn === "boolean" ||
    typeof s.canCheck === "boolean" ||
    typeof s.canCall === "boolean" ||
    typeof s.canRaise === "boolean";
  const yourTurn = s.yourTurn === true;
  return {
    show,
    yourTurn,
    locked: !yourTurn,
    canCheck: s.canCheck === true,
    canCall: s.canCall === true,
    canRaise: s.canRaise === true,
    callAmount: typeof s.callAmount === "number" ? s.callAmount : 0,
    minRaiseTo: typeof s.minRaiseTo === "number" ? s.minRaiseTo : 0,
    maxRaiseTo: typeof s.maxRaiseTo === "number" ? s.maxRaiseTo : 0,
    raiseStep: typeof s.raiseStep === "number" && s.raiseStep > 0 ? s.raiseStep : 1,
  };
}

export function createCardHandLayout(): ControllerLayout {
  return {
    type: "card-hand",
    render(container, state, onInput) {
      const s = state && typeof state === "object" ? state as Record<string, unknown> : {};
      const cards = Array.isArray(s.cards)
        ? (s.cards as Array<{ suit: string; rank: string; faceDown?: boolean }>)
        : [];
      const { show: hasActions, yourTurn, locked, canCheck, canCall, canRaise, callAmount, minRaiseTo, maxRaiseTo, raiseStep } =
        pokerActions(state);
      // Raise sizing lives on the phone: start at the minimum and step up.
      let raiseTo = minRaiseTo;
      const chips = typeof s.chips === "number" ? s.chips : null;
      const pot = typeof s.pot === "number" ? s.pot : null;
      const bet = typeof s.bet === "number" ? s.bet : null;
      const timeLeft = typeof s.timeLeft === "number" ? Math.max(0, Math.ceil(s.timeLeft / 1000)) : null;

      const info: string[] = [];
      if (chips !== null) info.push(`Stack ${chips}`);
      if (pot !== null) info.push(`Pot ${pot}`);
      if (bet !== null && bet > 0) info.push(`Your bet ${bet}`);
      if (timeLeft !== null && yourTurn) info.push(`${timeLeft}s`);

      container.innerHTML = `
        <div class="hand">
          ${cards.map((card, i) => `
            <div class="card ${card.suit === "hearts" || card.suit === "diamonds" ? "red" : ""} ${card.faceDown ? "face-down" : ""}" data-index="${i}">
              ${card.faceDown ? "?" : `<span class="rank">${escapeHtml(card.rank)}</span><span class="suit">${SUIT_SYMBOLS[card.suit] ?? "?"}</span>`}
            </div>
          `).join("")}
        </div>
        ${hasActions ? `
          ${info.length ? `<div class="table-info">${info.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>` : ""}
          <div class="actions">
            <button class="action-btn fold" data-act="fold" ${locked ? "disabled" : ""}>Fold</button>
            ${canCheck ? `<button class="action-btn" data-act="check" ${locked ? "disabled" : ""}>Check</button>` : ""}
            ${canCall ? `<button class="action-btn call" data-act="call" ${locked ? "disabled" : ""}>Call ${callAmount}</button>` : ""}
            ${canRaise ? `
              <div class="raise-row">
                <button class="raise-step" data-step="-1" ${locked ? "disabled" : ""}>-</button>
                <span class="raise-amount" id="raiseAmount">${minRaiseTo}</span>
                <button class="raise-step" data-step="1" ${locked ? "disabled" : ""}>+</button>
                <button class="action-btn raise" data-act="raise" ${locked ? "disabled" : ""}>Raise</button>
              </div>` : ""}
          </div>
          ${!yourTurn && typeof s.turnName === "string" && s.turnName ? `<p class="action-hint">Waiting for ${escapeHtml(s.turnName)}…</p>` : ""}
        ` : ""}
      `;

      // Hole cards are informational in poker; only attach a play handler when
      // the game actually exposes a card-play action.
      if (!hasActions) {
        container.querySelectorAll<HTMLDivElement>(".card:not(.face-down)").forEach(card => {
          card.addEventListener("click", () => {
            onInput({ playCard: Number(card.dataset.index) });
          });
        });
      }

      container.querySelectorAll<HTMLButtonElement>(".raise-step").forEach(btn => {
        btn.addEventListener("click", () => {
          const dir = Number(btn.dataset.step);
          const next = raiseTo + dir * raiseStep;
          raiseTo = Math.min(maxRaiseTo, Math.max(minRaiseTo, next));
          const label = container.querySelector("#raiseAmount");
          if (label) label.textContent = String(raiseTo);
        });
      });

      container.querySelectorAll<HTMLButtonElement>(".action-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          const action = btn.dataset.act;
          if (action === "raise") {
            onInput({ action: "raise", amount: raiseTo });
          } else {
            onInput({ action });
          }
        });
      });
    },
    update(container, state) {
      if (!state || typeof state !== "object" || !("cards" in state)) return;
      const cards = (state as { cards: Array<{ suit: string; rank: string; faceDown?: boolean }> }).cards;
      container.querySelectorAll(".card").forEach((card, i) => {
        const c = cards[i];
        if (c) {
          card.className = `card ${c.suit === "hearts" || c.suit === "diamonds" ? "red" : ""} ${c.faceDown ? "face-down" : ""}`;
          card.innerHTML = c.faceDown ? "?" : `<span class="rank">${escapeHtml(c.rank)}</span><span class="suit">${SUIT_SYMBOLS[c.suit] ?? "?"}</span>`;
        }
      });
    },
    signature(state) {
      const s = state && typeof state === "object" ? state as Record<string, unknown> : {};
      const cards = Array.isArray(s.cards)
        ? (s.cards as Array<{ suit: string; rank: string; faceDown?: boolean }>)
        : [];
      return JSON.stringify({
        cards: cards.map(c => `${c.suit}${c.rank}${c.faceDown ? "d" : "u"}`),
        turn: s.yourTurn ?? null,
        check: s.canCheck ?? null,
        call: s.canCall ?? null,
        raise: s.canRaise ?? null,
        amount: s.minRaiseTo ?? null,
        maxRaiseTo: s.maxRaiseTo ?? null,
        callAmount: s.callAmount ?? null,
        chips: s.chips ?? null,
        pot: s.pot ?? null,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Motion / value layouts.
//
// Sliders, joysticks, mash buttons, shared boards, numpads, drawing and private
// chat all talk to the server through a small, fixed set of input shapes:
//
//   { slider: { axis, value } }     axis "x" | "y", value 0..1
//   { pad:    { x, y } }            both -1..1, y positive is up
//   { action: string }              discrete button press
//   { tap: true }                   one mash
//   { board:  { id, action } }      "flip" | "pick"
//   { amount: number }              numpad submit
//   { stroke: { points, color } }   canvas stroke, points are 0..1
//   { chat:   { to, text } }        private message
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Shared pointer-drag plumbing: capture the pointer, throttle the stream. */
function dragValue(
  el: HTMLElement,
  compute: (e: PointerEvent) => { x: number; y: number },
  emit: (x: number, y: number, force: boolean) => void,
  paint: (x: number, y: number) => void,
  disabled: boolean,
): void {
  if (disabled) return;
  let last = 0;
  const fire = (x: number, y: number, force: boolean): void => {
    const now = Date.now();
    if (!force && now - last < 40) return;
    last = now;
    emit(x, y, force);
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.dataset.dragging = "1";
    const p = compute(e);
    paint(p.x, p.y);
    fire(p.x, p.y, true);
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const p = compute(e);
    paint(p.x, p.y);
    fire(p.x, p.y, false);
  });
  const end = (e: PointerEvent): void => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    el.releasePointerCapture(e.pointerId);
    delete el.dataset.dragging;
    const p = compute(e);
    paint(p.x, p.y);
    fire(p.x, p.y, true);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/** True while a pointer drag is in flight, so server echoes do not fight it. */
function isDragging(el: Element | null): boolean {
  return !!el && (el as HTMLElement).dataset.dragging === "1";
}

// --- Slider (one axis) ---

interface SliderView { axis: "x" | "y"; value: number; label: string; readout: string; disabled: boolean }

function sliderView(state: unknown): SliderView {
  const s = recordOf(recordOf(state).slider);
  const min = typeof s.min === "number" ? s.min : 0;
  const max = typeof s.max === "number" ? s.max : 100;
  const value = typeof s.value === "number" ? clamp01(s.value) : 0.5;
  return {
    axis: s.axis === "y" ? "y" : "x",
    value,
    label: typeof s.label === "string" ? s.label : "",
    readout: typeof s.readout === "string" ? s.readout : String(Math.round(min + (max - min) * value)),
    disabled: s.disabled === true,
  };
}

function paintSlider(track: HTMLElement, value: number): void {
  track.style.setProperty("--v", String(value));
  const knob = track.querySelector<HTMLElement>(".slider-knob");
  if (knob) knob.style.setProperty("--v", String(value));
}

function attachSlider(track: HTMLElement, axis: "x" | "y", onInput: (input: unknown) => void, disabled: boolean): void {
  dragValue(
    track,
    (e) => {
      const r = track.getBoundingClientRect();
      return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) };
    },
    (x, y, force) => onInput({ slider: { axis, value: Number((axis === "x" ? x : y).toFixed(4)) }, force }),
    (x, y) => paintSlider(track, axis === "x" ? x : y),
    disabled,
  );
}

function renderSliderBlock(cls: string, axis: "x" | "y", value: number, label: string, readout: string, disabled: boolean): string {
  return `
    <div class="slider-wrap ${axis} ${cls}">
      ${label ? `<div class="slider-label">${escapeHtml(label)}</div>` : ""}
      <div class="slider-track ${disabled ? "is-disabled" : ""}" style="--v:${value}">
        <div class="slider-fill"></div>
        <div class="slider-knob" style="--v:${value}"></div>
      </div>
      <div class="slider-readout">${escapeHtml(readout)}</div>
    </div>`;
}

export function createSliderLayout(): ControllerLayout {
  return {
    type: "slider",
    render(container, state, onInput) {
      const v = sliderView(state);
      container.innerHTML = renderSliderBlock("", v.axis, v.value, v.label, v.readout, v.disabled);
      const track = container.querySelector<HTMLElement>(".slider-track");
      if (track) attachSlider(track, v.axis, onInput, v.disabled);
    },
    update(container, state) {
      const v = sliderView(state);
      const track = container.querySelector<HTMLElement>(".slider-track");
      if (track && !isDragging(track)) paintSlider(track, v.value);
      const readout = container.querySelector(".slider-readout");
      if (readout) readout.textContent = v.readout;
    },
    signature(state) {
      const v = sliderView(state);
      return `slider:${v.axis}:${v.label}:${v.disabled}`;
    },
  };
}

// --- Dual slider (horizontal + vertical, darts) ---

function dualView(state: unknown): { x: SliderView; y: SliderView; actionLabel: string; disabled: boolean; hint: string } {
  const s = recordOf(recordOf(state).sliders);
  const read = (axis: "x" | "y"): SliderView => sliderView({ slider: { axis, ...recordOf(s[axis]) } });
  return {
    x: read("x"),
    y: read("y"),
    actionLabel: typeof s.actionLabel === "string" ? s.actionLabel : "THROW",
    disabled: s.disabled === true,
    hint: typeof s.hint === "string" ? s.hint : "",
  };
}

export function createDualSliderLayout(): ControllerLayout {
  return {
    type: "dual-slider",
    render(container, state, onInput) {
      const v = dualView(state);
      container.innerHTML = `
        <div class="dual-slider">
          ${v.hint ? `<div class="dual-hint">${escapeHtml(v.hint)}</div>` : ""}
          ${renderSliderBlock("axis-x", "x", v.x.value, v.x.label, v.x.readout, v.disabled)}
          ${renderSliderBlock("axis-y", "y", v.y.value, v.y.label, v.y.readout, v.disabled)}
          <button class="action-btn primary dual-action" ${v.disabled ? "disabled" : ""}>${escapeHtml(v.actionLabel)}</button>
        </div>`;
      const tracks = container.querySelectorAll<HTMLElement>(".slider-track");
      tracks.forEach((track) => {
        const axis = track.parentElement?.classList.contains("axis-y") ? "y" : "x";
        attachSlider(track, axis, onInput, v.disabled);
      });
      container.querySelector(".dual-action")?.addEventListener("click", () => {
        if (!v.disabled) onInput({ action: "action" });
      });
    },
    update(container, state) {
      const v = dualView(state);
      const tracks = Array.from(container.querySelectorAll<HTMLElement>(".slider-track"));
      for (const track of tracks) {
        const axis = track.parentElement?.classList.contains("axis-y") ? "y" : "x";
        if (!isDragging(track)) paintSlider(track, axis === "y" ? v.y.value : v.x.value);
      }
      const readouts = container.querySelectorAll(".slider-readout");
      readouts.forEach((el, i) => { el.textContent = i === 1 ? v.y.readout : v.x.readout; });
    },
    signature(state) {
      const v = dualView(state);
      return `dual:${v.x.label}:${v.y.label}:${v.actionLabel}:${v.disabled}`;
    },
  };
}

// --- Joystick pad ---

interface PadView { x: number; y: number; label: string; disabled: boolean }

function padView(state: unknown): PadView {
  const p = recordOf(recordOf(state).pad);
  return {
    x: typeof p.x === "number" ? clamp11(p.x) : 0,
    y: typeof p.y === "number" ? clamp11(p.y) : 0,
    label: typeof p.label === "string" ? p.label : "",
    disabled: p.disabled === true,
  };
}

function attachPad(zone: HTMLElement, onInput: (input: unknown) => void, disabled: boolean): void {
  const knob = (): HTMLElement | null => zone.querySelector<HTMLElement>(".pad-knob");
  const paint = (x: number, y: number): void => {
    zone.style.setProperty("--kx", String(x));
    zone.style.setProperty("--ky", String(-y));
    const k = knob();
    if (k) { k.style.setProperty("--kx", String(x)); k.style.setProperty("--ky", String(-y)); }
  };
  dragValue(
    zone,
    (e) => {
      const r = zone.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const radius = Math.max(1, Math.min(r.width, r.height) / 2);
      let x = (e.clientX - cx) / radius;
      let y = -(e.clientY - cy) / radius;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      return { x: clamp11(x), y: clamp11(y) };
    },
    (x, y, force) => onInput({ pad: { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }, force }),
    paint,
    disabled,
  );
}

export function createPadLayout(): ControllerLayout {
  return {
    type: "pad",
    render(container, state, onInput) {
      const v = padView(state);
      container.innerHTML = `
        <div class="pad-wrap">
          ${v.label ? `<div class="pad-label">${escapeHtml(v.label)}</div>` : ""}
          <div class="pad ${v.disabled ? "is-disabled" : ""}" style="--kx:${v.x};--ky:${-v.y}">
            <div class="pad-cross"></div>
            <div class="pad-knob" style="--kx:${v.x};--ky:${-v.y}"></div>
          </div>
        </div>`;
      const zone = container.querySelector<HTMLElement>(".pad");
      if (zone) attachPad(zone, onInput, v.disabled);
    },
    update(container, state) {
      const v = padView(state);
      const zone = container.querySelector<HTMLElement>(".pad");
      if (!zone || isDragging(zone)) return;
      zone.style.setProperty("--kx", String(v.x));
      zone.style.setProperty("--ky", String(-v.y));
      const knob = zone.querySelector<HTMLElement>(".pad-knob");
      if (knob) { knob.style.setProperty("--kx", String(v.x)); knob.style.setProperty("--ky", String(-v.y)); }
    },
    signature(state) {
      const v = padView(state);
      return `pad:${v.label}:${v.disabled}`;
    },
  };
}

// --- Aim: joystick + power slider + action button (golf) ---

function aimView(state: unknown): { x: number; y: number; power: number; actionLabel: string; hint: string; disabled: boolean } {
  const a = recordOf(recordOf(state).aim);
  return {
    x: typeof a.x === "number" ? clamp11(a.x) : 0,
    y: typeof a.y === "number" ? clamp11(a.y) : 1,
    power: typeof a.power === "number" ? clamp01(a.power) : 0,
    actionLabel: typeof a.actionLabel === "string" ? a.actionLabel : "SHOOT",
    hint: typeof a.hint === "string" ? a.hint : "",
    disabled: a.disabled === true,
  };
}

export function createAimLayout(): ControllerLayout {
  return {
    type: "aim",
    render(container, state, onInput) {
      const v = aimView(state);
      const powerTrack = `
        <div class="slider-wrap y aim-power">
          <div class="slider-label">Power</div>
          <div class="slider-track ${v.disabled ? "is-disabled" : ""}" style="--v:${v.power}">
            <div class="slider-fill"></div>
            <div class="slider-knob" style="--v:${v.power}"></div>
          </div>
        </div>`;
      container.innerHTML = `
        <div class="aim">
          ${v.hint ? `<div class="aim-hint">${escapeHtml(v.hint)}</div>` : ""}
          <div class="aim-row">
            <div class="pad aim-pad" style="--kx:${v.x};--ky:${-v.y}">
              <div class="pad-cross"></div>
              <div class="pad-knob" style="--kx:${v.x};--ky:${-v.y}"></div>
            </div>
            ${powerTrack}
          </div>
          <button class="action-btn primary aim-action" ${v.disabled ? "disabled" : ""}>${escapeHtml(v.actionLabel)}</button>
        </div>`;
      const zone = container.querySelector<HTMLElement>(".aim-pad");
      if (zone) attachPad(zone, onInput, v.disabled);
      const track = container.querySelector<HTMLElement>(".aim-power .slider-track");
      if (track) attachSlider(track, "y", onInput, v.disabled);
      container.querySelector(".aim-action")?.addEventListener("click", () => {
        if (!v.disabled) onInput({ action: "action" });
      });
    },
    update(container, state) {
      const v = aimView(state);
      const zone = container.querySelector<HTMLElement>(".aim-pad");
      if (zone && !isDragging(zone)) {
        zone.style.setProperty("--kx", String(v.x));
        zone.style.setProperty("--ky", String(-v.y));
        const knob = zone.querySelector<HTMLElement>(".pad-knob");
        if (knob) { knob.style.setProperty("--kx", String(v.x)); knob.style.setProperty("--ky", String(-v.y)); }
      }
      const track = container.querySelector<HTMLElement>(".aim-power .slider-track");
      if (track && !isDragging(track)) paintSlider(track, v.power);
    },
    signature(state) {
      const v = aimView(state);
      return `aim:${v.actionLabel}:${v.hint}:${v.disabled}`;
    },
  };
}

// --- Tap race (mash) ---

function raceView(state: unknown): {
  taps: number; progress: number; label: string; opponent: string; opponentTaps: number;
  finished: boolean; disabled: boolean;
} {
  const r = recordOf(recordOf(state).race);
  return {
    taps: typeof r.taps === "number" ? r.taps : 0,
    progress: typeof r.progress === "number" ? clamp01(r.progress) : 0,
    label: typeof r.label === "string" ? r.label : "TAP!",
    opponent: typeof r.opponentName === "string" ? r.opponentName : "",
    opponentTaps: typeof r.opponentTaps === "number" ? r.opponentTaps : 0,
    finished: r.finished === true,
    disabled: r.disabled === true || r.finished === true,
  };
}

export function createTapRaceLayout(): ControllerLayout {
  return {
    type: "tap-race",
    render(container, state, onInput) {
      const v = raceView(state);
      container.innerHTML = `
        <div class="race">
          <div class="race-meter"><div class="race-fill" style="width:${Math.round(v.progress * 100)}%"></div></div>
          <button class="race-btn" ${v.disabled ? "disabled" : ""}>${escapeHtml(v.label)}</button>
          <div class="race-stats">
            <span class="race-count">${v.taps}</span>
            ${v.opponent ? `<span class="race-rival">${escapeHtml(v.opponent)}: ${v.opponentTaps}</span>` : ""}
          </div>
        </div>`;
      const btn = container.querySelector<HTMLButtonElement>(".race-btn");
      const hit = (e: Event): void => {
        e.preventDefault();
        if (btn?.disabled) return;
        onInput({ tap: true });
        const count = container.querySelector(".race-count");
        if (count) count.textContent = String(Number(count.textContent ?? 0) + 1);
      };
      btn?.addEventListener("pointerdown", hit);
      btn?.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") hit(e); });
    },
    update(container, state) {
      const v = raceView(state);
      const fill = container.querySelector<HTMLElement>(".race-fill");
      if (fill) fill.style.width = `${Math.round(v.progress * 100)}%`;
      const count = container.querySelector(".race-count");
      if (count) count.textContent = String(v.taps);
      const rival = container.querySelector(".race-rival");
      if (rival && v.opponent) rival.textContent = `${v.opponent}: ${v.opponentTaps}`;
      const btn = container.querySelector<HTMLButtonElement>(".race-btn");
      if (btn) btn.disabled = v.disabled;
    },
    signature(state) {
      const v = raceView(state);
      return `race:${v.label}`;
    },
  };
}

// --- Board (shared tile grid: guess who, card tables, any pick-and-mark game) ---

interface BoardTile { id: string; label: string; image?: string; marked?: boolean; selected?: boolean }

function boardView(state: unknown): {
  title: string; subtitle: string; hint: string; tiles: BoardTile[];
  choices: Array<{ id: string; label: string }>; mode: "flip" | "pick"; disabled: boolean;
} {
  const b = recordOf(recordOf(state).board);
  const tiles = Array.isArray(b.tiles)
    ? (b.tiles as Array<Record<string, unknown>>).map((t) => ({
        id: String(t.id ?? ""),
        label: String(t.label ?? t.id ?? ""),
        image: typeof t.image === "string" ? t.image : undefined,
        marked: t.marked === true,
        selected: t.selected === true,
      }))
    : [];
  const choices = Array.isArray(b.choices)
    ? (b.choices as Array<Record<string, unknown>>).map((c) => ({ id: String(c.id ?? ""), label: String(c.label ?? "") }))
    : [];
  return {
    title: typeof b.title === "string" ? b.title : "",
    subtitle: typeof b.subtitle === "string" ? b.subtitle : "",
    hint: typeof b.hint === "string" ? b.hint : "",
    tiles,
    choices,
    mode: b.mode === "pick" ? "pick" : "flip",
    disabled: b.disabled === true,
  };
}

export function createBoardLayout(): ControllerLayout {
  return {
    type: "board",
    render(container, state, onInput) {
      const v = boardView(state);
      container.innerHTML = `
        <div class="board">
          ${v.title ? `<div class="board-title">${escapeHtml(v.title)}</div>` : ""}
          ${v.subtitle ? `<div class="board-subtitle">${escapeHtml(v.subtitle)}</div>` : ""}
          ${v.hint ? `<div class="board-hint">${escapeHtml(v.hint)}</div>` : ""}
          <div class="board-grid">
            ${v.tiles.map((t) => `
              <button class="board-tile ${t.marked ? "marked" : ""} ${t.selected ? "selected" : ""}"
                data-id="${escapeHtml(t.id)}" ${v.disabled ? "disabled" : ""}>
                ${t.image
                  ? `<img class="board-img" src="${escapeHtml(t.image)}" alt="${escapeHtml(t.label)}" />`
                  : `<span class="board-initial">${escapeHtml(t.label.slice(0, 2))}</span>`}
                <span class="board-name">${escapeHtml(t.label)}</span>
              </button>`).join("")}
          </div>
          ${v.choices.length ? `
            <div class="board-choices">
              ${v.choices.map((c) => `<button class="choice-btn" data-choice="${escapeHtml(c.id)}" ${v.disabled ? "disabled" : ""}>${escapeHtml(c.label)}</button>`).join("")}
            </div>` : ""}
        </div>`;
      container.querySelectorAll<HTMLButtonElement>(".board-tile").forEach((tile) => {
        tile.addEventListener("click", () => {
          if (v.disabled) return;
          onInput({ board: { id: tile.dataset.id, action: v.mode } });
        });
      });
      container.querySelectorAll<HTMLButtonElement>(".board-choices .choice-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (v.disabled) return;
          onInput({ choice: btn.dataset.choice });
        });
      });
    },
    update(container, state) {
      const v = boardView(state);
      const tiles = container.querySelectorAll<HTMLButtonElement>(".board-tile");
      tiles.forEach((tile) => {
        const t = v.tiles.find((x) => x.id === tile.dataset.id);
        if (!t) return;
        tile.classList.toggle("marked", !!t.marked);
        tile.classList.toggle("selected", !!t.selected);
        tile.disabled = v.disabled;
      });
      const title = container.querySelector(".board-title");
      if (title && v.title) title.textContent = v.title;
      const hint = container.querySelector(".board-hint");
      if (hint && v.hint) hint.textContent = v.hint;
    },
    signature(state) {
      const v = boardView(state);
      return JSON.stringify({
        t: v.tiles.map((t) => `${t.id}|${t.label}|${t.image ?? ""}`),
        c: v.choices.map((c) => `${c.id}|${c.label}`),
        mode: v.mode,
        disabled: v.disabled,
      });
    },
  };
}

// --- Numpad (poker bets and any stack/amount entry) ---

function numpadView(state: unknown): {
  label: string; min: number; max: number; value: number; presets: number[]; disabled: boolean;
} {
  const n = recordOf(recordOf(state).numpad);
  const min = typeof n.min === "number" ? Math.max(0, Math.floor(n.min)) : 0;
  const max = typeof n.max === "number" ? Math.max(min, Math.floor(n.max)) : 999;
  const value = typeof n.value === "number" ? Math.min(max, Math.max(min, Math.floor(n.value))) : min;
  return {
    label: typeof n.label === "string" ? n.label : "Amount",
    min,
    max,
    value,
    presets: Array.isArray(n.presets) ? (n.presets as unknown[]).filter((x): x is number => typeof x === "number") : [],
    disabled: n.disabled === true,
  };
}

export function createNumpadLayout(): ControllerLayout {
  return {
    type: "numpad",
    render(container, state, onInput) {
      const v = numpadView(state);
      container.innerHTML = `
        <div class="numpad" data-value="${v.value}">
          <div class="numpad-label">${escapeHtml(v.label)}</div>
          <div class="numpad-display"><span class="numpad-value">${v.value}</span><span class="numpad-range">${v.min}–${v.max}</span></div>
          ${v.presets.length ? `<div class="numpad-presets">${v.presets.map((p) => `<button class="numpad-preset" data-preset="${p}" ${v.disabled ? "disabled" : ""}>${p}</button>`).join("")}</div>` : ""}
          <div class="numpad-keys">
            ${["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"].map((k) => `<button class="numpad-key" data-key="${k}" ${v.disabled ? "disabled" : ""}>${k}</button>`).join("")}
          </div>
          <button class="action-btn primary numpad-submit" ${v.disabled ? "disabled" : ""}>Confirm</button>
        </div>`;

      const root = container.querySelector<HTMLElement>(".numpad")!;
      const display = container.querySelector<HTMLElement>(".numpad-value")!;
      const setValue = (next: number): void => {
        const clamped = Math.min(v.max, Math.max(v.min, Math.floor(next)));
        root.dataset.value = String(clamped);
        display.textContent = String(clamped);
      };
      const current = (): number => Number(root.dataset.value ?? v.value);

      container.querySelectorAll<HTMLButtonElement>(".numpad-key").forEach((key) => {
        key.addEventListener("click", () => {
          if (v.disabled) return;
          const k = key.dataset.key ?? "";
          if (k === "C") setValue(v.min);
          else if (k === "<") setValue(Math.floor(current() / 10));
          else setValue(current() * 10 + Number(k));
        });
      });
      container.querySelectorAll<HTMLButtonElement>(".numpad-preset").forEach((preset) => {
        preset.addEventListener("click", () => {
          if (v.disabled) return;
          setValue(Number(preset.dataset.preset ?? v.min));
        });
      });
      container.querySelector(".numpad-submit")?.addEventListener("click", () => {
        if (!v.disabled) onInput({ amount: current() });
      });
    },
    update(_container, _state) {},
    signature(state) {
      const v = numpadView(state);
      return `numpad:${v.label}:${v.min}:${v.max}:${v.presets.join(",")}:${v.disabled}`;
    },
  };
}

// --- Canvas (vector strokes, never raster) ---

function canvasView(state: unknown): { prompt: string; color: string; disabled: boolean } {
  const c = recordOf(recordOf(state).canvas);
  return {
    prompt: typeof c.prompt === "string" ? c.prompt : "",
    color: typeof c.color === "string" ? c.color : "#111111",
    disabled: c.disabled === true,
  };
}

export function createCanvasLayout(): ControllerLayout {
  return {
    type: "canvas",
    render(container, state, onInput) {
      const v = canvasView(state);
      container.innerHTML = `
        <div class="canvas-wrap">
          ${v.prompt ? `<div class="canvas-prompt">${escapeHtml(v.prompt)}</div>` : ""}
          <canvas class="draw-surface" width="600" height="600" ${v.disabled ? 'style="opacity:.45"' : ""}></canvas>
          <div class="canvas-tools">
            <div class="canvas-colors">
              ${["#111111", "#e23b3b", "#f0a500", "#2f9e44", "#2f6fed", "#8e44ad"].map((c, i) => `
                <button class="canvas-swatch ${i === 0 ? "active" : ""}" data-color="${c}" style="--swatch:${c}" aria-label="Colour ${i + 1}"></button>`).join("")}
            </div>
            <div class="canvas-sizes">
              ${[3, 6, 12].map((w, i) => `<button class="canvas-size ${i === 1 ? "active" : ""}" data-width="${w}"><span style="--dot:${w}px"></span></button>`).join("")}
            </div>
            <button class="action-btn clear-drawing" ${v.disabled ? "disabled" : ""}>Clear</button>
            <button class="action-btn primary canvas-done" ${v.disabled ? "disabled" : ""}>Done</button>
          </div>
        </div>`;

      const canvas = container.querySelector<HTMLCanvasElement>(".draw-surface")!;
      const ctx = canvas.getContext("2d")!;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let colour = v.color;
      let width = 6;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;

      container.querySelectorAll<HTMLButtonElement>(".canvas-swatch").forEach((swatch) => {
        swatch.addEventListener("click", () => {
          colour = swatch.dataset.color ?? colour;
          ctx.strokeStyle = colour;
          container.querySelectorAll(".canvas-swatch").forEach((s2) => s2.classList.remove("active"));
          swatch.classList.add("active");
        });
      });
      container.querySelectorAll<HTMLButtonElement>(".canvas-size").forEach((size) => {
        size.addEventListener("click", () => {
          width = Number(size.dataset.width ?? 6);
          ctx.lineWidth = width;
          container.querySelectorAll(".canvas-size").forEach((s2) => s2.classList.remove("active"));
          size.classList.add("active");
        });
      });

      let points: Array<[number, number]> = [];
      let drawing = false;

      const pos = (e: PointerEvent): [number, number] => {
        const r = canvas.getBoundingClientRect();
        return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
      };
      const redraw = (): void => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        points.forEach(([x, y], i) => {
          const px = x * canvas.width;
          const py = y * canvas.height;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      };

      canvas.addEventListener("pointerdown", (e) => {
        if (v.disabled) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        points = [pos(e)];
        redraw();
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drawing) return;
        points.push(pos(e));
        redraw();
      });
      const finish = (): void => {
        if (!drawing) return;
        drawing = false;
        if (points.length < 2) return;
        const rounded = points.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);
        points = [];
        onInput({ stroke: { points: rounded, color: colour, width } });
      };
      canvas.addEventListener("pointerup", finish);
      canvas.addEventListener("pointercancel", finish);
      container.querySelector(".clear-drawing")?.addEventListener("click", () => {
        points = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onInput({ stroke: { points: [], color: v.color } });
      });
      container.querySelector(".canvas-done")?.addEventListener("click", () => {
        onInput({ action: "action" });
      });
    },
    update(_container, _state) {},
    signature(state) {
      const v = canvasView(state);
      return `canvas:${v.prompt}:${v.color}:${v.disabled}`;
    },
  };
}

// --- Chat (private per-player messages) ---

function chatView(state: unknown): {
  contacts: Array<{ id: string; name: string }>;
  thread: Array<{ from: string; text: string }>;
  remaining: number;
  disabled: boolean;
  placeholder: string;
} {
  const c = recordOf(recordOf(state).chat);
  const contacts = Array.isArray(c.contacts)
    ? (c.contacts as Array<Record<string, unknown>>).map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? "") }))
    : [];
  const thread = Array.isArray(c.thread)
    ? (c.thread as Array<Record<string, unknown>>).map((m) => ({ from: String(m.from ?? ""), text: String(m.text ?? "") }))
    : [];
  return {
    contacts,
    thread,
    remaining: typeof c.remaining === "number" ? c.remaining : -1,
    disabled: c.disabled === true,
    placeholder: typeof c.placeholder === "string" ? c.placeholder : "Message…",
  };
}

export function createChatLayout(): ControllerLayout {
  return {
    type: "chat",
    render(container, state, onInput) {
      const v = chatView(state);
      const first = v.contacts[0];
      container.innerHTML = `
        <div class="chat" data-to="${escapeHtml(first?.id ?? "")}">
          <div class="chat-contacts">
            ${v.contacts.map((c, i) => `<button class="chat-contact ${i === 0 ? "active" : ""}" data-id="${escapeHtml(c.id)}" ${v.disabled ? "disabled" : ""}>${escapeHtml(c.name)}</button>`).join("")}
          </div>
          <div class="chat-thread"></div>
          <div class="chat-compose">
            <input class="chat-input" type="text" maxlength="180" placeholder="${escapeHtml(v.placeholder)}" ${v.disabled ? "disabled" : ""} />
            <button class="action-btn primary chat-send" ${v.disabled ? "disabled" : ""}>Send</button>
          </div>
          ${v.remaining >= 0 ? `<div class="chat-remaining">${v.remaining} messages left</div>` : ""}
        </div>`;

      const root = container.querySelector<HTMLElement>(".chat")!;
      const threadEl = container.querySelector<HTMLElement>(".chat-thread")!;
      const input = container.querySelector<HTMLInputElement>(".chat-input")!;

      const paintThread = (messages: Array<{ from: string; text: string }>): void => {
        threadEl.innerHTML = messages.map((m) => `<div class="chat-msg"><b>${escapeHtml(m.from)}</b> ${escapeHtml(m.text)}</div>`).join("");
        threadEl.scrollTop = threadEl.scrollHeight;
      };
      paintThread(v.thread);

      container.querySelectorAll<HTMLButtonElement>(".chat-contact").forEach((btn) => {
        btn.addEventListener("click", () => {
          container.querySelectorAll(".chat-contact").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          root.dataset.to = btn.dataset.id ?? "";
        });
      });
      const sendMessage = (): void => {
        const text = input.value.trim();
        const to = root.dataset.to ?? "";
        if (!text || !to || v.disabled) return;
        onInput({ chat: { to, text } });
        input.value = "";
      };
      container.querySelector(".chat-send")?.addEventListener("click", sendMessage);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });
    },
    update(container, state) {
      const v = chatView(state);
      const threadEl = container.querySelector<HTMLElement>(".chat-thread");
      if (threadEl) {
        threadEl.innerHTML = v.thread.map((m) => `<div class="chat-msg"><b>${escapeHtml(m.from)}</b> ${escapeHtml(m.text)}</div>`).join("");
        threadEl.scrollTop = threadEl.scrollHeight;
      }
      const remaining = container.querySelector(".chat-remaining");
      if (remaining && v.remaining >= 0) remaining.textContent = `${v.remaining} messages left`;
    },
    signature(state) {
      const v = chatView(state);
      return JSON.stringify({ c: v.contacts.map((x) => `${x.id}|${x.name}`), d: v.disabled, r: v.remaining });
    },
  };
}


// --- Rank (build an ordering by tapping items in sequence) ---

interface RankView {
  items: Array<{ id: string; label: string }>;
  order: string[];
  submitLabel: string;
  disabled: boolean;
  hasSubmitted: boolean;
  min: number;
  max: number;
}

function rankView(state: unknown): RankView {
  const r = recordOf(recordOf(state).rank);
  const items = Array.isArray(r.items)
    ? (r.items as Array<Record<string, unknown>>).map((x) => ({ id: String(x.id ?? ""), label: String(x.label ?? x.id ?? "") }))
    : [];
  const order = Array.isArray(r.order) ? (r.order as unknown[]).map(String) : [];
  return {
    items,
    order: order.filter((id) => items.some((i) => i.id === id)),
    submitLabel: typeof r.submitLabel === "string" ? r.submitLabel : "Submit",
    disabled: r.disabled === true,
    hasSubmitted: r.hasSubmitted === true,
    min: typeof r.min === "number" ? Math.max(1, Math.floor(r.min)) : items.length,
    max: typeof r.max === "number" ? Math.max(1, Math.floor(r.max)) : items.length,
  };
}

export function createRankLayout(): ControllerLayout {
  return {
    type: "rank",
    render(container, state, onInput) {
      const v = rankView(state);
      let order = [...v.order];

      const paint = (): void => {
        const placed = order
          .map((id, i) => {
            const item = v.items.find((x) => x.id === id);
            return `<button class="rank-slot" data-id="${escapeHtml(id)}"><span class="rank-pos">${i + 1}</span><span class="rank-name">${escapeHtml(item?.label ?? id)}</span></button>`;
          })
          .join("");
        const pool = v.items
          .filter((item) => !order.includes(item.id))
          .map((item) => `<button class="rank-item" data-id="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`)
          .join("");
        container.innerHTML = `
          <div class="rank">
            <div class="rank-slots">${placed || `<div class="rank-empty">${v.disabled ? "…" : "Tap items below in order"}</div>`}</div>
            ${pool ? `<div class="rank-pool">${pool}</div>` : ""}
            <div class="rank-actions">
              <button class="action-btn rank-reset" ${v.disabled ? "disabled" : ""}>Reset</button>
              <button class="action-btn primary rank-submit" ${v.disabled || order.length < v.min || order.length > v.max ? "disabled" : ""}>${escapeHtml(v.submitLabel)}</button>
            </div>
          </div>`;

        container.querySelectorAll<HTMLButtonElement>(".rank-item").forEach((btn) => {
          btn.addEventListener("click", () => {
            if (v.disabled) return;
            const id = btn.dataset.id ?? "";
            if (id && !order.includes(id)) { order.push(id); paint(); }
          });
        });
        container.querySelectorAll<HTMLButtonElement>(".rank-slot").forEach((btn) => {
          btn.addEventListener("click", () => {
            if (v.disabled) return;
            const id = btn.dataset.id ?? "";
            order = order.filter((x) => x !== id);
            paint();
          });
        });
        container.querySelector(".rank-reset")?.addEventListener("click", () => {
          if (v.disabled) return;
          order = [];
          paint();
        });
        container.querySelector(".rank-submit")?.addEventListener("click", () => {
          if (v.disabled || order.length < v.min || order.length > v.max) return;
          onInput({ rank: { order } });
        });
      };

      paint();
    },
    update(_container, _state) {},
    signature(state) {
      const v = rankView(state);
      return JSON.stringify({ items: v.items.map((i) => `${i.id}|${i.label}`), d: v.disabled, min: v.min, max: v.max });
    },
  };
}


// --- Role (a private card revealed only while the button is held) ---

interface RoleView { title: string; body: string; holdLabel: string; secret: boolean }

function roleView(state: unknown): RoleView {
  const r = recordOf(recordOf(state).role);
  return {
    title: typeof r.title === "string" ? r.title : "Your card",
    body: typeof r.body === "string" ? r.body : "",
    holdLabel: typeof r.holdLabel === "string" ? r.holdLabel : "HOLD TO VIEW",
    secret: r.secret === true,
  };
}

export function createRoleLayout(): ControllerLayout {
  return {
    type: "role",
    render(container, state) {
      const v = roleView(state);
      container.innerHTML = `
        <div class="role ${v.secret ? "secret" : ""}">
          <div class="role-card">
            <div class="role-title">${escapeHtml(v.title)}</div>
            <div class="role-body">${escapeHtml(v.body)}</div>
          </div>
          <button class="role-hold">${escapeHtml(v.holdLabel)}</button>
          <div class="role-hint">Only you can see this. Keep it covered.</div>
        </div>`;
      const hold = container.querySelector<HTMLElement>(".role-hold");
      const card = container.querySelector<HTMLElement>(".role-card");
      const show = (): void => { card?.classList.add("visible"); };
      const hide = (): void => { card?.classList.remove("visible"); };
      hold?.addEventListener("pointerdown", (e) => { e.preventDefault(); show(); });
      hold?.addEventListener("pointerup", hide);
      hold?.addEventListener("pointerleave", hide);
      hold?.addEventListener("pointercancel", hide);
    },
    update(_container, _state) {},
    signature(state) {
      const v = roleView(state);
      return `role:${v.title}:${v.body}:${v.secret}`;
    },
  };
}

// --- Registry ---
export const controllerLayouts = new Map<ControllerType, ControllerLayout>([
  ["one-button", createOneButtonLayout()],
  ["left-right", createLeftRightLayout()],
  ["dpad", createDpadLayout()],
  ["text", createTextLayout()],
  ["choice", createChoiceLayout()],
  ["private-grid", createPrivateGridLayout()],
  ["card-hand", createCardHandLayout()],
  ["slider", createSliderLayout()],
  ["dual-slider", createDualSliderLayout()],
  ["pad", createPadLayout()],
  ["aim", createAimLayout()],
  ["tap-race", createTapRaceLayout()],
  ["board", createBoardLayout()],
  ["numpad", createNumpadLayout()],
  ["canvas", createCanvasLayout()],
  ["chat", createChatLayout()],
  ["rank", createRankLayout()],
  ["role", createRoleLayout()],
]);

export function getLayout(type: ControllerType): ControllerLayout {
  return controllerLayouts.get(type) ?? createOneButtonLayout();
}
