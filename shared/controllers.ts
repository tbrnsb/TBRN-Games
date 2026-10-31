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
      if (countEl && state && typeof state === "object" && "yourTaps" in state) {
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
      const left = escapeHtml(labels.left ?? "◀ LEFT");
      const right = escapeHtml(labels.right ?? "RIGHT ▶");
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
      return JSON.stringify([labels.left ?? "◀ LEFT", labels.right ?? "RIGHT ▶"]);
    },
  };
}

// --- D-Pad ---
export function createDpadLayout(): ControllerLayout {
  return {
    type: "dpad",
    render(container, state, onInput) {
      const labels = labelsOf(state);
      const up = escapeHtml(labels.up ?? "▲");
      const down = escapeHtml(labels.down ?? "▼");
      const left = escapeHtml(labels.left ?? "◀");
      const right = escapeHtml(labels.right ?? "▶");
      container.innerHTML = `
        <div class="dpad">
          <button class="dpad-btn up" data-input="up">${up}</button>
          <button class="dpad-btn left" data-input="left">${left}</button>
          <button class="dpad-btn right" data-input="right">${right}</button>
          <button class="dpad-btn down" data-input="down">${down}</button>
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
      return JSON.stringify([labels.up ?? "▲", labels.down ?? "▼", labels.left ?? "◀", labels.right ?? "▶"]);
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
      container.innerHTML = `
        <div class="text-input">
          <textarea id="textArea" placeholder="${escapeHtml(placeholder)}" maxlength="200"></textarea>
          <button id="textSubmit">Submit</button>
          <div class="char-count"><span id="charCount">0</span>/200</div>
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
      return `text:${placeholder}`;
    },
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
            <button class="choice-btn" data-id="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</button>
          `).join("")}
        </div>
      `;
      container.querySelectorAll(".choice-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          onInput({ choice: btn.getAttribute("data-id") });
          container.querySelectorAll(".choice-btn").forEach(b => b.classList.remove("selected"));
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
      return JSON.stringify(options.map(o => `${o.id}|${o.label}`));
    },
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
            const value = escapeHtml(cells[r]?.[c] ?? "");
            return `<button class="grid-cell" data-row="${r}" data-col="${c}">${value}</button>`;
          }).join("")}
        </div>
      `;
      container.querySelectorAll<HTMLButtonElement>(".grid-cell").forEach(cell => {
        cell.addEventListener("click", () => {
          onInput({ grid: { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } });
        });
      });
    },
    update(container, state) {
      if (!state || typeof state !== "object" || !("cells" in state)) return;
      const { cells = [] } = state as { cells: unknown[][] };
      container.querySelectorAll<HTMLButtonElement>(".grid-cell").forEach(cell => {
        const r = Number(cell.dataset.row);
        const c = Number(cell.dataset.col);
        cell.textContent = String(cells[r]?.[c] ?? "");
      });
    },
    signature(state) {
      const { rows = 5, cols = 5 } = state && typeof state === "object"
        ? state as { rows?: number; cols?: number }
        : {};
      return `grid:${rows}x${cols}`;
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
              ${card.faceDown ? "?" : `<span class="rank">${escapeHtml(card.rank)}</span><span class="suit">${SUIT_SYMBOLS[card.suit] ?? "?"}</span>`}
            </div>
          `).join("")}
        </div>
      `;
      container.querySelectorAll<HTMLDivElement>(".card:not(.face-down)").forEach(card => {
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
          card.innerHTML = c.faceDown ? "?" : `<span class="rank">${escapeHtml(c.rank)}</span><span class="suit">${SUIT_SYMBOLS[c.suit] ?? "?"}</span>`;
        }
      });
    },
    signature(state) {
      const cards = state && typeof state === "object" && "cards" in state
        ? (state as { cards?: Array<{ suit: string; rank: string; faceDown?: boolean }> }).cards ?? []
        : [];
      return JSON.stringify(cards.map(c => `${c.suit}${c.rank}${c.faceDown ? "d" : "u"}`));
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
]);

export function getLayout(type: ControllerType): ControllerLayout {
  return controllerLayouts.get(type) ?? createOneButtonLayout();
}
