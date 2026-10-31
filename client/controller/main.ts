/**
 * Controller client — runs on phone, sends inputs, receives private game state.
 * Uses shared controller layouts from shared/controllers.ts.
 *
 * The layout re-renders when the controller type or the layout signature
 * changes, and does cheap updates otherwise. The rejoin token is persisted
 * on JOINED so a refresh or dropped connection can rejoin the same room.
 */

import type { ClientMessage, ServerMessage, ControllerType } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";
import { getLayout } from "../../shared/controllers.ts";
import type { ControllerLayout } from "../../shared/controllers.ts";

const wsUrl = `ws://${location.host}`;
let ws: WebSocket;
let roomId = "";
let playerId = "";
let rejoinToken = "";
let currentControllerType: ControllerType = "one-button";
let currentLayout: ControllerLayout = getLayout(currentControllerType);
let lastSignature = "";
let gameName = "";

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
    if (rejoinToken && roomId) {
      sendJoin(true);
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log("[Controller] Disconnected, reconnecting in 3s...");
    statusEl.textContent = "Reconnecting...";
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case MESSAGE_TYPES.JOINED:
      roomId = msg.roomId;
      playerId = msg.payload.playerId;
      rejoinToken = msg.payload.rejoinToken;
      // Persist so a refresh or network drop can rejoin this room.
      try {
        localStorage.setItem("tbrn_rejoin_token", rejoinToken);
        localStorage.setItem("tbrn_room_id", roomId);
      } catch (e) {
        console.warn("[Controller] Could not persist rejoin token", e);
      }
      playerNameEl.textContent = `You: ${nameInput.value || "Player"}`;
      joinForm.classList.add("hidden");
      controllerArea.classList.remove("hidden");
      statusEl.textContent = "Waiting for host to start...";
      break;
    case MESSAGE_TYPES.ROOM_STATE:
      if (msg.payload.status === "playing" && msg.payload.gameId) {
        statusEl.textContent = gameName ? `Playing: ${gameName}` : "Game in progress";
      } else {
        // Back in the lobby (game over or not started yet).
        gameName = "";
        controllerContainer.innerHTML = "";
        lastSignature = "";
        currentControllerType = "one-button";
        currentLayout = getLayout(currentControllerType);
        statusEl.textContent = "Waiting for host to start...";
      }
      break;
    case MESSAGE_TYPES.GAME_STATE: {
      const payload = msg.payload as {
        screen: unknown;
        controller: Record<string, unknown> | null;
        gameName?: string;
      };
      if (payload.gameName) {
        gameName = payload.gameName;
      }
      const controller = payload.controller ?? {};
      const newType =
        typeof controller.controllerType === "string"
          ? (controller.controllerType as ControllerType)
          : currentControllerType;

      // Re-render only when the layout type or its structure changed.
      const signature = newType === currentControllerType
        ? currentLayout.signature(controller)
        : "";
      if (newType !== currentControllerType || signature !== lastSignature) {
        currentControllerType = newType;
        currentLayout = getLayout(newType);
        lastSignature = signature;
        controllerContainer.innerHTML = "";
        currentLayout.render(controllerContainer, controller, sendInput);
      } else {
        currentLayout.update(controllerContainer, controller);
      }

      statusEl.textContent = statusFrom(controller);
      break;
    }
    case MESSAGE_TYPES.ERROR:
      console.error("[Controller] Error:", msg.payload);
      statusEl.textContent = `Error: ${(msg.payload as { message?: string }).message ?? "unknown"}`;
      break;
  }
}

/** Human-readable status line from the controller state. */
function statusFrom(controller: Record<string, unknown>): string {
  if (typeof controller.info === "string" && controller.info) return controller.info;
  if (controller.yourTurn === true || controller.isYourTurn === true) return "Your turn!";
  if (controller.yourTime === true) return "Time to write!";
  if (controller.hasSubmitted === true) return "Answer locked in — waiting for others...";
  if (controller.hasVoted === true) return "Vote locked in — waiting for others...";
  if (controller.yourTurn === false || controller.isYourTurn === false) {
    const turnName = controller.turnName;
    if (typeof turnName === "string" && turnName) return `Waiting for ${turnName}...`;
  }
  if (gameName) return `Playing: ${gameName}`;
  return "Waiting for host to start...";
}

function sendJoin(rejoin = false) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!rejoin && !roomId) {
    statusEl.textContent = "Open the join link or QR code from the host's screen.";
    return;
  }
  if (!rejoin) {
    // A fresh join replaces any previous room membership.
    try {
      localStorage.removeItem("tbrn_rejoin_token");
      localStorage.removeItem("tbrn_room_id");
    } catch {
      /* storage unavailable: rejoin after refresh will not work */
    }
    rejoinToken = "";
  }
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.JOIN,
    roomId,
    timestamp: Date.now(),
    payload: {
      name: nameInput.value.trim() || `Player-${Math.random().toString(36).slice(2, 6)}`,
      rejoinToken: rejoin ? rejoinToken : undefined,
    },
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

// Room id from the QR link wins; otherwise fall back to the last room so a
// refresh rejoins the same game.
try {
  const paramRoom = new URLSearchParams(location.search).get("room");
  if (paramRoom) {
    roomId = paramRoom;
  } else {
    const storedToken = localStorage.getItem("tbrn_rejoin_token");
    const storedRoom = localStorage.getItem("tbrn_room_id");
    if (storedToken && storedRoom) {
      rejoinToken = storedToken;
      roomId = storedRoom;
    }
  }
} catch {
  /* storage unavailable */
}

connect();
