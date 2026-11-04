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

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${wsProtocol}://${location.host}`;
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
const codeInput = document.getElementById("codeInput") as HTMLInputElement;
const codeField = document.getElementById("codeField")!;
const roomLinked = document.getElementById("roomLinked")!;
const joinError = document.getElementById("joinError")!;
const joinHint = document.getElementById("joinHint")!;
const joinBtn = document.getElementById("joinBtn") as HTMLButtonElement;
const playerNameEl = document.getElementById("playerName")!;
const connDot = document.getElementById("connDot")!;
const gameLabel = document.getElementById("gameLabel")!;
const coach = document.getElementById("coach")!;
const idle = document.getElementById("idle")!;
const statusEl = document.getElementById("status")!;
const controllerContainer = document.getElementById("controllerContainer")!;

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // Green only once we actually hold a seat; the join screen stays neutral.
    connDot.className = playerId ? "dot on" : "dot";
    if (rejoinToken && roomId) {
      sendJoin(true);
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    handleMessage(msg);
  };

  ws.onclose = () => {
    connDot.className = "dot off";
    statusEl.textContent = "Reconnecting…";
    coach.classList.remove("your-turn");
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case MESSAGE_TYPES.JOINED: {
      roomId = msg.roomId;
      playerId = msg.payload.playerId;
      rejoinToken = msg.payload.rejoinToken;
      // The server may suffix a duplicate name; show the seat's real name.
      const seatName =
        msg.payload.roomState.players.find((p) => p.id === playerId)?.name ??
        nameInput.value.trim() ??
        "Player";
      // Persist so a refresh or network drop can rejoin this room.
      try {
        localStorage.setItem("tbrn_rejoin_token", rejoinToken);
        localStorage.setItem("tbrn_room_id", roomId);
        localStorage.setItem("tbrn_player_name", seatName);
      } catch (e) {
        console.warn("[Controller] Could not persist rejoin token", e);
      }
      playerNameEl.textContent = seatName;
      connDot.className = "dot on";
      joinForm.classList.add("hidden");
      controllerArea.classList.remove("hidden");
      idle.classList.remove("hidden");
      statusEl.textContent = "Waiting for the host to start…";
      coach.classList.remove("your-turn");
      break;
    }
    case MESSAGE_TYPES.ROOM_STATE:
      if (msg.payload.status === "playing" && msg.payload.gameId) {
        statusEl.textContent = gameName ? `Playing ${gameName}` : "Game in progress";
      } else {
        // Back in the lobby (game over or not started yet).
        gameName = "";
        gameLabel.textContent = "";
        controllerContainer.innerHTML = "";
        idle.classList.remove("hidden");
        lastSignature = "";
        currentControllerType = "one-button";
        currentLayout = getLayout(currentControllerType);
        statusEl.textContent = "Waiting for the host to start…";
        coach.classList.remove("your-turn");
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
      gameLabel.textContent = gameName;
      idle.classList.add("hidden");
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
        controllerContainer.dataset.layout = newType;
        currentLayout.render(controllerContainer, controller, sendInput);
      } else {
        currentLayout.update(controllerContainer, controller);
      }

      const isTurn =
        controller.yourTurn === true ||
        controller.isYourTurn === true ||
        controller.yourTime === true;
      coach.classList.toggle("your-turn", isTurn);
      statusEl.textContent = statusFrom(controller);
      break;
    }
    case MESSAGE_TYPES.ERROR: {
      console.error("[Controller] Error:", msg.payload);
      const payload = msg.payload as { message?: string; code?: string };
      const code = payload.code ?? "Error";
      const message = payload.message ?? "unknown";
      const friendly =
        code === "ROOM_NOT_FOUND"
          ? "That room code didn't match. Check the laptop screen and try again."
          : code === "NAME_TOO_LONG" || code === "INVALID_NAME"
            ? "Pick a shorter, simpler name."
            : `${message}`;
      statusEl.textContent = friendly;
      if (!playerId) {
        joinBtn.disabled = false;
        joinError.textContent = friendly;
        joinError.classList.add("error");
        if (code === "ROOM_NOT_FOUND") {
          roomId = "";
          codeInput.focus();
        }
      }
      break;
    }
  }
}

/** Human-readable status line from the controller state. */
function statusFrom(controller: Record<string, unknown>): string {
  if (typeof controller.info === "string" && controller.info) return controller.info;
  if (controller.spunOut === true) return "Spun out — wait for the car to recover";
  if (typeof controller.throttle === "boolean") {
    return controller.throttle ? "Throttle on — tap to release" : "Throttle off — tap to go";
  }
  if (controller.yourTurn === true || controller.isYourTurn === true) return "Your turn";
  if (controller.yourTime === true) return "Time to write";
  if (controller.hasSubmitted === true) return "Answer locked in — waiting for others…";
  if (controller.hasVoted === true) return "Vote locked in — waiting for others…";
  if (controller.yourTurn === false || controller.isYourTurn === false) {
    const turnName = controller.turnName;
    if (typeof turnName === "string" && turnName) return `Waiting for ${turnName}…`;
  }
  if (gameName) return `Playing ${gameName}`;
  return "Waiting for the host to start…";
}

function resolveRoom(): string {
  if (roomId) return roomId;
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    joinError.textContent = "Enter the 5-character room code from the laptop.";
    joinError.classList.add("error");
    codeInput.focus();
    return "";
  }
  roomId = code;
  return roomId;
}

function sendJoin(rejoin = false) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  joinError.textContent = "";
  joinError.classList.remove("error");

  const target = resolveRoom();
  if (!target) return;

  const name = nameInput.value.trim();
  if (!rejoin && !name) {
    joinError.textContent = "Enter a name so the table knows who you are.";
    joinError.classList.add("error");
    nameInput.focus();
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

  joinBtn.disabled = true;
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.JOIN,
    roomId,
    timestamp: Date.now(),
    payload: {
      name: name || `Player-${Math.random().toString(36).slice(2, 6)}`,
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
codeInput.addEventListener("input", () => {
  const clean = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (codeInput.value !== clean) codeInput.value = clean;
  joinError.textContent = "";
  joinError.classList.remove("error");
});
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (codeInput.value.length === 5) nameInput.focus();
  }
});

// Room id from the QR link wins; otherwise fall back to the last room so a
// refresh rejoins the same game.
let linkedFromQr = false;
try {
  const paramRoom = new URLSearchParams(location.search).get("room");
  const storedToken = localStorage.getItem("tbrn_rejoin_token");
  const storedRoom = localStorage.getItem("tbrn_room_id");
  const storedName = localStorage.getItem("tbrn_player_name");
  if (storedName) nameInput.value = storedName;

  if (paramRoom) {
    roomId = paramRoom;
    // A refresh on the same QR link should rejoin the existing seat, not
    // create a duplicate player.
    if (storedToken && storedRoom === paramRoom) rejoinToken = storedToken;
    if (/^[A-Z0-9]{5}$/.test(paramRoom)) {
      codeInput.value = paramRoom;
    } else {
      linkedFromQr = true;
      codeField.classList.add("hidden");
      roomLinked.classList.remove("hidden");
      joinHint.classList.add("hidden");
    }
  } else if (storedToken && storedRoom) {
    rejoinToken = storedToken;
    roomId = storedRoom;
  }
} catch {
  /* storage unavailable */
}

if (!roomId) {
  codeInput.focus();
} else if (linkedFromQr) {
  nameInput.focus();
}

connect();
