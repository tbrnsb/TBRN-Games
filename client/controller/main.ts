/**
 * Controller client — runs on phone, sends inputs, receives private game state.
 * Uses shared controller layouts from shared/controllers.ts
 */

import type { ClientMessage, ServerMessage, ControllerType } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";
import { getLayout } from "../../shared/controllers.ts";

const wsUrl = `ws://${location.host}`;
let ws: WebSocket;
let roomId = "";
let playerId = "";
let rejoinToken = "";
let currentControllerType: ControllerType = "one-button";
let currentLayout = getLayout(currentControllerType);

const joinForm = document.getElementById("joinForm")!;
const controllerArea = document.getElementById("controllerArea")!;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const joinBtn = document.getElementById("joinBtn")!;
const playerNameEl = document.getElementById("playerName")!;
const statusEl = document.getElementById("status")!;
const controllerContainer = document.getElementById("controllerContainer")!;

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
      // Update controller type from game state if provided
      if (payload.controller && typeof payload.controller === "object" && "controllerType" in payload.controller) {
        const newType = (payload.controller as { controllerType: ControllerType }).controllerType;
        if (newType !== currentControllerType) {
          currentControllerType = newType;
          currentLayout = getLayout(currentControllerType);
          controllerContainer.innerHTML = "";
          currentLayout.render(controllerContainer, payload.controller, sendInput);
        }
      }
      currentLayout.update(controllerContainer, payload.controller);
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

// --- Event Listeners ---
joinBtn.addEventListener("click", () => sendJoin());
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendJoin(); });

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