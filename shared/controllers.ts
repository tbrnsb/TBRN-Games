/**
 * Shared controller rendering utilities.
 * Used by both screen (for debugging) and controller clients.
 */

export type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand";

export interface ControllerLayout {
  type: ControllerType;
  render: (container: HTMLElement, state: unknown, onInput: (input: unknown) => void) => void;
  update: (container: HTMLElement, state: unknown) => void;
}

// --- One Button ---
export function createOneButtonLayout(): ControllerLayout {
  return {
    type: "one-button",
    render(container, state, onInput) {
      container.innerHTML = `
        <button class="btn-one" data-action="tap">
          <span class="btn-label">TAP</span>
          <span class="btn-count" id="tapCount">0</span>
        </button>
      `;
      const btn = container.querySelector(".btn-one")!;
      btn.addEventListener("click", () => onInput({ tap: true }));
      btn.addEventListener("touchstart", (e) => { e.preventDefault(); onInput({ tap: true }); }, { passive: false });
    },
    update(container, state) {
      const countEl = container.querySelector("#tapCount");
      if (countEl && state && typeof state === "object" && "yourTaps" in state) {
        countEl.textContent = String((state as { yourTaps: number }).yourTaps);
      }
    }
  };
}

// --- Left-Right ---
export function createLeftRightLayout(): ControllerLayout {
  return {
    type: "left-right",
    render(container, state, onInput) {
      container.innerHTML = `
        <div class="lr-row">
          <button class="btn-lr left" data-input="left">◀ LEFT</button>
          <button class="btn-lr right" data-input="right">RIGHT ▶</button>
        </div>
      `;
      container.querySelectorAll(".btn-lr").forEach(btn => {
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
    }
  };
}

// --- D-Pad ---
export function createDpadLayout(): ControllerLayout {
  return {
    type: "dpad",
    render(container, state, onInput) {
      container.innerHTML = `
        <div class="dpad">
          <button class="dpad-btn up" data-input="up">▲</button>
          <button class="dpad-btn left" data-input="left">◀</button>
          <button class="dpad-btn right" data-input="right">▶</button>
          <button class="dpad-btn down" data-input="down">▼</button>
        </div>
      `;
      container.querySelectorAll(".dpad-btn").forEach(btn => {
        btn.addEventListener("click", () => onInput({ move: btn.dataset.input }));
        btn.addEventListener("touchstart", (e) => { e.preventDefault(); onInput({ move: btn.dataset.input }); }, { passive: false });
      });
    },
    update(_container, _state) {}
  };
}

// --- Text Input ---
export function createTextLayout(): ControllerLayout {
  return {
    type: "text",
    render(container, state, onInput) {
      const placeholder = state && typeof state === "object" && "placeholder" in state
        ? (state as { placeholder: string }).placeholder
        : "Type your answer...";
      container.innerHTML = `
        <div class="text-input">
          <textarea id="textArea" placeholder="${placeholder}" maxlength="200"></textarea>
          <button id="textSubmit">Submit</button>
          <div class="char-count"><span id="charCount">0</span>/200</div>
        </div>
      `;
      const textarea = container.querySelector("#textArea") as HTMLTextAreaElement;
      const submit = container.querySelector("#textSubmit")!;
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
    update(_container, _state) {}
  };
}

// --- Choice/Vote ---
export function createChoiceLayout(): ControllerLayout {
  return {
    type: "choice",
    render(container, state, onInput) {
      const options = state && typeof state === "object" && "options" in state
        ? (state as { options: Array<{ id: string; label: string }> }).options
        : [];
      container.innerHTML = `
        <div class="choices">
          ${options.map(opt => `
            <button class="choice-btn" data-id="${opt.id}">${opt.label}</button>
          `).join("")}
        </div>
      `;
      container.querySelectorAll(".choice-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          onInput({ choice: btn.dataset.id });
          container.querySelectorAll(".choice-btn").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
        });
      });
    },
    update(container, state) {
      if (state && typeof state === "object" && "options" in state) {
        const options = (state as { options: Array<{ id: string; label: string; selected?: boolean }> }).options;
        container.querySelectorAll(".choice-btn").forEach(btn => {
          const opt = options.find(o => o.id === btn.dataset.id);
          if (opt?.selected) btn.classList.add("selected");
          else btn.classList.remove("selected");
        });
      }
    }
  };
}

// --- Private Grid ---
export function createPrivateGridLayout(): ControllerLayout {
  return {
    type: "private-grid",
    render(container, state, onInput) {
      const { rows = 5, cols = 5, cells = [] } = state && typeof state === "object"
        ? state as { rows: number; cols: number; cells: unknown[][] }
        : { rows: 5, cols: 5, cells: [] };

      container.style.setProperty("--grid-cols", String(cols));
      container.innerHTML = `
        <div class="grid" style="grid-template-columns: repeat(${cols}, 1fr);">
          ${Array.from({ length: rows * cols }, (_, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const value = cells[r]?.[c] ?? "";
            return `<button class="grid-cell" data-row="${r}" data-col="${c}">${value}</button>`;
          }).join("")}
        </div>
      `;
      container.querySelectorAll(".grid-cell").forEach(cell => {
        cell.addEventListener("click", () => {
          onInput({ grid: { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } });
        });
      });
    },
    update(container, state) {
      if (!state || typeof state !== "object" || !("cells" in state)) return;
      const { cells = [] } = state as { cells: unknown[][] };
      container.querySelectorAll(".grid-cell").forEach(cell => {
        const r = Number(cell.dataset.row);
        const c = Number(cell.dataset.col);
        cell.textContent = String(cells[r]?.[c] ?? "");
      });
    }
  };
}

// --- Card Hand ---
const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠"
};

export function createCardHandLayout(): ControllerLayout {
  return {
    type: "card-hand",
    render(container, state, onInput) {
      const cards = state && typeof state === "object" && "cards" in state
        ? (state as { cards: Array<{ suit: string; rank: string; faceDown?: boolean }> }).cards
        : [];

      container.innerHTML = `
        <div class="hand">
          ${cards.map((card, i) => `
            <div class="card ${card.suit === "hearts" || card.suit === "diamonds" ? "red" : ""} ${card.faceDown ? "face-down" : ""}" data-index="${i}">
              ${card.faceDown ? "?" : `<span class="rank">${card.rank}</span><span class="suit">${SUIT_SYMBOLS[card.suit]}</span>`}
            </div>
          `).join("")}
        </div>
      `;
      container.querySelectorAll(".card:not(.face-down)").forEach(card => {
        card.addEventListener("click", () => {
          onInput({ playCard: Number(card.dataset.index) });
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
          card.innerHTML = c.faceDown ? "?" : `<span class="rank">${c.rank}</span><span class="suit">${SUIT_SYMBOLS[c.suit]}</span>`;
        }
      });
    }
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
]);

export function getLayout(type: ControllerType): ControllerLayout {
  return controllerLayouts.get(type) ?? createOneButtonLayout();
}