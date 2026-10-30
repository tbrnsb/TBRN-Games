/**
 * Controller client — runs on phone, sends inputs, receives private game state.
 * Supports multiple controller types: one-button, left-right, dpad, text, choice, private-grid, card-hand.
 */

import type { ClientMessage, ServerMessage, ControllerType } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";

const wsUrl = `ws://${location.host}`;
let ws: WebSocket;
let roomId = "";
let playerId = "";
let rejoinToken = "";
const controllerType: ControllerType = "one-button";

const joinForm = document.getElementById("joinForm")!;
const controllerArea = document.getElementById("controllerArea")!;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const joinBtn = document.getElementById("joinBtn")!;
const playerNameEl = document.getElementById("playerName")!;
const statusEl = document.getElementById("status")!;

// Controller elements
const btnOne = document.getElementById("btnOne") as HTMLButtonElement;
const lrRow = document.getElementById("lrRow")!;
const dpad = document.getElementById("dpad")!;
const textInput = document.getElementById("textInput")!;
const textArea = document.getElementById("textArea") as HTMLTextAreaElement;
const textSubmit = document.getElementById("textSubmit")!;
const choices = document.getElementById("choices")!;
const grid = document.getElementById("grid")!;
const hand = document.getElementById("hand")!;

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[Controller] Connected");
    if (rejoinToken) {
      sendJoin(true);
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log("[Controller] Disconnected, reconnecting in 3s...");
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case MESSAGE_TYPES.JOINED:
      roomId = msg.roomId;
      playerId = msg.playerId;
      rejoinToken = msg.payload.rejoinToken;
      playerNameEl.textContent = `You: ${nameInput.value || "Player"}`;
      joinForm.classList.add("hidden");
      controllerArea.classList.remove("hidden");
      statusEl.textContent = "Waiting for host to start...";
      break;
    case MESSAGE_TYPES.ROOM_STATE:
      if (msg.payload.status === "playing" && msg.payload.gameId) {
        statusEl.textContent = `Playing: ${msg.payload.gameId}`;
      }
      break;
    case MESSAGE_TYPES.GAME_STATE: {
      const payload = msg.payload as { screen: unknown; controller: unknown };
      renderController(payload.controller);
      statusEl.textContent = "Your turn";
      break;
    }
    case MESSAGE_TYPES.ERROR:
      console.error("[Controller] Error:", msg.payload);
      statusEl.textContent = `Error: ${msg.payload.message}`;
      break;
  }
}

function sendJoin(rejoin = false) {
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.JOIN,
    roomId,
    timestamp: Date.now(),
    payload: { name: nameInput.value || `Player-${Math.random().toString(36).slice(2, 6)}`, rejoinToken: rejoin ? rejoinToken : undefined },
  };
  ws.send(JSON.stringify(msg));
}

function sendInput(input: unknown) {
  if (!playerId) return;
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.INPUT,
    roomId,
    playerId,
    timestamp: Date.now(),
    payload: input,
  };
  ws.send(JSON.stringify(msg));
}

function renderController(controllerState: unknown) {
  // Hide all controllers first
  [btnOne, lrRow, dpad, textInput, choices, grid, hand].forEach(el => el.classList.add("hidden"));

  // Determine controller type from state or default
  // In real implementation, this comes from game manifest
  if (controllerType === "one-button") {
    btnOne.classList.remove("hidden");
  } else if (controllerType === "left-right") {
    lrRow.classList.remove("hidden");
  } else if (controllerType === "dpad") {
    dpad.classList.remove("hidden");
  } else if (controllerType === "text") {
    textInput.classList.remove("hidden");
  } else if (controllerType === "choice") {
    renderChoices(controllerState as Array<{ id: string; label: string }>);
  } else if (controllerType === "private-grid") {
    renderGrid(controllerState as { rows: number; cols: number; cells: unknown[][] });
  } else if (controllerType === "card-hand") {
    renderHand(controllerState as Array<{ suit: string; rank: string }>);
  }
}

function renderChoices(options: Array<{ id: string; label: string }>) {
  choices.innerHTML = "";
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = opt.label;
    btn.dataset.id = opt.id;
    btn.addEventListener("click", () => sendInput({ choice: opt.id }));
    choices.appendChild(btn);
  }
  choices.classList.remove("hidden");
}

function renderGrid(state: { rows: number; cols: number; cells: unknown[][] }) {
  grid.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
  grid.innerHTML = "";
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.textContent = String(state.cells[r][c] ?? "");
      cell.addEventListener("click", () => sendInput({ grid: { row: r, col: c } }));
      grid.appendChild(cell);
    }
  }
  grid.classList.remove("hidden");
}

function renderHand(cards: Array<{ suit: string; rank: string }>) {
  hand.innerHTML = "";
  for (const card of cards) {
    const el = document.createElement("div");
    el.className = `card ${card.suit === "hearts" || card.suit === "diamonds" ? "red" : ""}`;
    el.textContent = `${card.rank} ${card.suit === "hearts" ? "♥" : card.suit === "diamonds" ? "♦" : card.suit === "clubs" ? "♣" : "♠"}`;
    el.addEventListener("click", () => sendInput({ playCard: card }));
    hand.appendChild(el);
  }
  hand.classList.remove("hidden");
}

// --- Event Listeners ---
joinBtn.addEventListener("click", () => sendJoin());
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendJoin(); });

// One-button
btnOne.addEventListener("click", () => sendInput({ tap: true }));

// Left-Right
lrRow.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", () => sendInput({ move: btn.dataset.input }));
});

// D-Pad
dpad.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", () => sendInput({ move: btn.dataset.input }));
});

// Text
textSubmit.addEventListener("click", () => {
  const text = textArea.value.trim();
  if (text) { sendInput({ text }); textArea.value = ""; }
});
textArea.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textSubmit.click(); } });

// Restore rejoin token from localStorage on load
const storedToken = localStorage.getItem("tbrn_rejoin_token");
const storedRoom = localStorage.getItem("tbrn_room_id");
if (storedToken && storedRoom) {
  rejoinToken = storedToken;
  roomId = storedRoom;
}

// Save token on join
ws.addEventListener("open", () => {
  if (rejoinToken && roomId) {
    localStorage.setItem("tbrn_rejoin_token", rejoinToken);
    localStorage.setItem("tbrn_room_id", roomId);
  }
});

connect();