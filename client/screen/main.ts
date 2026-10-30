/**
 * Screen client — runs on laptop, displays shared game state.
 * Connects to WebSocket, renders lobby QR, then game canvas.
 */

import type { ServerMessage } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";

const wsUrl = `ws://${location.host}`;
let ws: WebSocket;
let roomId = "";
let playerId = "";
let currentGameState: { screen: unknown; controller: unknown } | null = null;

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const lobby = document.getElementById("lobby")!;
const playing = document.getElementById("playing")!;
const qrImg = document.getElementById("qrCode") as HTMLImageElement;
const urlFallback = document.getElementById("urlFallback")!;
const roomCodeEl = document.getElementById("roomCode")!;
const playersList = document.getElementById("playersList")!;
const startBtn = document.getElementById("startGameBtn")!;

function connect() {
  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("[Screen] Connected");
    // Request LAN URLs for QR
    fetch("/api/lan-urls").then(r => r.json()).then(data => {
      if (data.urls.length > 0) {
        const joinUrl = `${data.urls[0]}/controller`;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(joinUrl)}`;
        qrImg.classList.remove("hidden");
        urlFallback.textContent = `Or open: ${joinUrl}`;
      }
    });
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log("[Screen] Disconnected, reconnecting in 3s...");
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case MESSAGE_TYPES.JOINED:
      roomId = msg.roomId;
      playerId = msg.playerId;
      roomCodeEl.textContent = msg.payload.roomState.code;
      updatePlayers(msg.payload.roomState);
      break;
    case MESSAGE_TYPES.ROOM_STATE:
      roomCodeEl.textContent = msg.payload.code;
      updatePlayers(msg.payload);
      if (msg.payload.status === "playing") {
        showPlaying();
      } else {
        showLobby();
      }
      break;
    case MESSAGE_TYPES.GAME_STATE:
      currentGameState = msg.payload as { screen: unknown; controller: unknown };
      showPlaying();
      renderGame(currentGameState.screen);
      break;
    case MESSAGE_TYPES.ERROR:
      console.error("[Screen] Error:", msg.payload);
      break;
  }
}

function updatePlayers(room: { players: Array<{ id: string; name: string; connected: boolean }> }) {
  playersList.innerHTML = "";
  for (const p of room.players) {
    const el = document.createElement("div");
    el.className = "player-badge";
    el.style.borderLeft = `4px solid ${getPlayerColor(room.players.indexOf(p))}`;
    el.textContent = `${p.name} ${p.connected ? "🟢" : "🔴"}`;
    playersList.appendChild(el);
  }
  // Show start button only for host
  const isHost = room.players[0]?.id === playerId;
  startBtn.classList.toggle("hidden", !isHost || room.status !== "lobby");
}

function showLobby() {
  lobby.classList.remove("hidden");
  playing.classList.add("hidden");
}

function showPlaying() {
  lobby.classList.add("hidden");
  playing.classList.remove("hidden");
  resizeCanvas();
}

function renderGame(screenState: unknown) {
  // Clear
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // TODO: Implement per-game rendering based on screenState
  // For tap-counter demo:
  if (screenState && typeof screenState === "object" && "players" in screenState) {
    const data = screenState as { players: Array<{ name: string; taps: number }> };
    ctx.font = "48px Inter";
    ctx.fillStyle = "#F8FAFC";
    ctx.textAlign = "center";
    data.players.forEach((p, i) => {
      const y = 150 + i * 100;
      ctx.fillText(`${p.name}: ${p.taps} taps`, canvas.width / 2, y);
    });
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  if (currentGameState) renderGame(currentGameState.screen);
}

window.addEventListener("resize", resizeCanvas);

startBtn.addEventListener("click", () => {
  // For demo, just start the dummy game
  // In real implementation, host picks game from list
  fetch(`/api/rooms/${roomId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "tap-counter" }),
  });
});

function getPlayerColor(index: number): string {
  const colors = ["#2E7DFF", "#FF6B35", "#10B981", "#F59E0B"];
  return colors[index % colors.length];
}

connect();