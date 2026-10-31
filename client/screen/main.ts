/**
 * Screen client — runs on laptop, displays shared game state.
 * Joins the room as a spectator (role "screen"), never as a player.
 * Lobby shows a game picker fetched from /api/games; the QR code links
 * phones to /controller?room=<roomId>.
 *
 * Rendering: if games/<id>/screen.ts exports a render function it is used;
 * otherwise a generic renderer draws the standard screen-state fields.
 */

import type { ServerMessage, RoomState } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";

console.log("[Screen] Module loaded");

const wsUrl = `ws://${location.host}`;
let ws: WebSocket;
let roomId = "";
let currentScreen: unknown = null;
let currentGameId: string | null = null;
let currentGameName = "";
let selectedGameId: string | null = null;
let playerCount = 0;

interface GameManifestLite {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  description: string;
}

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const lobby = document.getElementById("lobby")!;
const playing = document.getElementById("playing")!;
const qrImg = document.getElementById("qrCode") as HTMLImageElement;
const urlFallback = document.getElementById("urlFallback")!;
const _roomCodeEl = document.getElementById("roomCode")!;
const _playersList = document.getElementById("playersList")!;
const startBtn = document.getElementById("startGameBtn") as HTMLButtonElement;

function getPlayersList(): HTMLElement {
  return _playersList;
}

function getRoomCodeEl(): HTMLElement {
  return _roomCodeEl;
}

// --- Game picker (built dynamically; lobby HTML has no picker element) ---
const picker = document.createElement("div");
picker.id = "gamePicker";
picker.style.cssText =
  "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;width:100%;max-width:900px;margin:16px 0;";
startBtn.parentElement?.insertBefore(picker, startBtn);
startBtn.textContent = "Start Game";
startBtn.disabled = true;

let manifests: GameManifestLite[] = [];

async function loadGames(): Promise<void> {
  try {
    const res = await fetch("/api/games");
    const data = (await res.json()) as { games: GameManifestLite[] };
    manifests = data.games ?? [];
    console.log("[Screen] loadGames:", manifests.length, "games");
    renderPicker();
  } catch (e) {
    console.error("[Screen] Failed to load games", e);
  }
}

function renderPicker(): void {
  console.log("[Screen] renderPicker called, playerCount:", playerCount);
  picker.innerHTML = "";
  for (const g of manifests) {
    const card = document.createElement("button");
    card.type = "button";
    card.style.cssText = `
      text-align:left;padding:12px;border-radius:8px;cursor:pointer;font-family:inherit;
      border:2px solid ${selectedGameId === g.id ? "#2E7DFF" : "#334155"};
      background:#1E293B;color:#F8FAFC;
    `;
    const enough = playerCount >= g.minPlayers;
    card.disabled = !enough;
    card.style.opacity = enough ? "1" : "0.45";
    card.innerHTML = `
      <div style="font-weight:600;font-size:1rem;">${escapeHtml(g.name)}</div>
      <div style="color:#94A3B8;font-size:0.8rem;margin-top:4px;">${g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}-${g.maxPlayers}`} players</div>
      <div style="color:#94A3B8;font-size:0.8rem;margin-top:6px;">${escapeHtml(g.description)}</div>
    `;
    card.addEventListener("click", () => {
      selectedGameId = g.id;
      startBtn.disabled = false;
      renderPicker();
    });
    picker.appendChild(card);
  }
  console.log("[Screen] renderPicker done, picker children:", picker.children.length);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- Connection ---
function connect() {
  console.log("[Screen] Connecting to", wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[Screen] WebSocket open");
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.JOIN,
      roomId,
      timestamp: Date.now(),
      payload: { name: "Screen", role: "screen" },
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as ServerMessage;
      console.log("[Screen] Received:", msg.type);
      handleMessage(msg);
    } catch (e) {
      console.error("[Screen] Parse error:", e);
    }
  };

  ws.onerror = (e) => {
    console.error("[Screen] WebSocket error:", e);
  };

  ws.onclose = () => {
    console.log("[Screen] Disconnected, reconnecting in 3s...");
    setTimeout(connect, 3000);
  };
}

function handleMessage(msg: ServerMessage) {
  console.log("[Screen] handleMessage:", msg.type);
  if (msg.type === MESSAGE_TYPES.JOINED) {
    const m = msg as ServerMessage & { type: "joined"; payload: { playerId: string; rejoinToken: string; roomState: RoomState } };
    roomId = m.roomId;
    try {
      localStorage.setItem("tbrn_screen_room_id", roomId);
    } catch { /* ignore */ }
    const roomState = m.payload.roomState;
    console.log("[Screen] JOINED roomState:", roomState);
    const codeEl = getRoomCodeEl();
    console.log("[Screen] codeEl:", codeEl);
    codeEl.textContent = roomState.code ?? "----";
    codeEl.style.background = "rgba(255,0,0,0.2)";
    codeEl.style.border = "2px solid lime";
    codeEl.style.fontFamily = "monospace";
    codeEl.style.fontSize = "2rem";
    codeEl.style.color = "#00FF00";
    codeEl.style.padding = "0.5rem 1rem";
    codeEl.style.display = "block";
    console.log("[Screen] set code to:", codeEl.textContent, "| computed:", getComputedStyle(codeEl).display, getComputedStyle(codeEl).visibility, getComputedStyle(codeEl).opacity, getComputedStyle(codeEl).color, getComputedStyle(codeEl).fontFamily);
    updatePlayers(roomState.players ?? [], roomState.status ?? "lobby", roomState.gameId ?? null);
    // Now we have the roomId — generate QR + show LAN URLs
    fetch("/api/lan-urls").then(r => r.json()).then(data => {
      const urls: string[] = data.urls ?? [];
      if (urls.length > 0 && roomId) {
        const joinUrl = `${urls[0]}/controller?room=${encodeURIComponent(roomId)}`;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(joinUrl)}`;
        qrImg.classList.remove("hidden");
        urlFallback.textContent = `Phones: open ${joinUrl}  (LAN: ${urls.join(", ")})`;
      }
    }).catch(e => console.error("[Screen] LAN URL fetch failed", e));
  } else if (msg.type === MESSAGE_TYPES.ROOM_STATE) {
    const m = msg as ServerMessage & { type: "roomState"; payload: RoomState | { roomState?: RoomState } };
    const rs = m.payload;
    const roomState = (rs as { roomState?: RoomState }).roomState ?? (rs as RoomState);
    const codeEl = getRoomCodeEl();
    codeEl.textContent = roomState.code ?? "----";
    codeEl.style.fontFamily = "monospace";
    codeEl.style.fontSize = "2rem";
    codeEl.style.color = "#00FF00";
    codeEl.style.padding = "0.5rem 1rem";
    codeEl.style.display = "block";
    updatePlayers(roomState.players ?? [], roomState.status ?? "lobby", roomState.gameId ?? null);
    if (roomState.status === "playing") {
      showPlaying();
    } else {
      showLobby();
    }
  } else if (msg.type === MESSAGE_TYPES.GAME_STATE) {
    const m = msg as ServerMessage & { type: "gameState"; payload: { screen: unknown; gameId?: string | null; gameName?: string } };
    const payload = m.payload;
    currentScreen = payload.screen;
    if (payload.gameId !== undefined) currentGameId = payload.gameId;
    if (payload.gameName) currentGameName = payload.gameName;
    showPlaying();
    renderGame();
  } else if (msg.type === MESSAGE_TYPES.ERROR) {
    const m = msg as ServerMessage & { type: "error"; payload: { code: string; message: string } };
    console.error("[Screen] Error:", m.payload);
  }
}

function updatePlayers(
  players: Array<{ id: string; name: string; connected: boolean }>,
  status: string,
  gameId: string | null,
): void {
  console.log("[Screen] updatePlayers:", players, "status:", status, "playerCount:", players.length);
  playerCount = players.length;
  const list = getPlayersList();
  list.innerHTML = "";
  players.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "player-badge";
    el.style.borderLeft = `4px solid ${getPlayerColor(i)}`;
    el.style.padding = "0.25rem 0.5rem";
    el.style.margin = "0.25rem 0";
    el.style.background = "rgba(255,255,255,0.05)";
    el.style.borderRadius = "4px";
    el.textContent = `${p.name} ${p.connected ? "🟢" : "🔴"}`;
    list.appendChild(el);
  });
  // The screen owns the room: it can start a game whenever the lobby is
  // open and enough phones have joined for at least one game.
  // Don't clear room code here — caller sets it
  startBtn.classList.toggle("hidden", status !== "lobby");
  startBtn.disabled = !selectedGameReachable();
  void gameId;
}

function selectedGameReachable(): boolean {
  if (!selectedGameId) return false;
  const g = manifests.find((m) => m.id === selectedGameId);
  return !!g && playerCount >= g.minPlayers;
}

function showLobby() {
  lobby.classList.remove("hidden");
  playing.classList.add("hidden");
  startBtn.classList.toggle("hidden", false);
}

function showPlaying() {
  lobby.classList.add("hidden");
  playing.classList.remove("hidden");
  resizeCanvas();
}

startBtn.addEventListener("click", async () => {
  if (!selectedGameId || !roomId) return;
  startBtn.disabled = true;
  try {
    const res = await fetch(`/api/rooms/${roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: selectedGameId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error("[Screen] Start failed:", body.message ?? res.status);
      startBtn.disabled = false;
    }
  } catch (e) {
    console.error("[Screen] Start request failed", e);
    startBtn.disabled = false;
  }
});

// --- Rendering ---
type ScreenRenderer = (ctx: CanvasRenderingContext2D, width: number, height: number, state: unknown) => void;
const rendererCache = new Map<string, ScreenRenderer | null>();

async function loadCustomRenderer(gameId: string): Promise<ScreenRenderer | null> {
  if (rendererCache.has(gameId)) return rendererCache.get(gameId) ?? null;
  try {
    const mod = (await import(`/games/${gameId}/screen.ts`)) as Record<string, unknown>;
    const cap = gameId.charAt(0).toUpperCase() + gameId.slice(1);
    const candidates = [`render${cap}`, "render"];
    let fn: ScreenRenderer | null = null;
    for (const name of candidates) {
      if (typeof mod[name] === "function") {
        fn = mod[name] as ScreenRenderer;
        break;
      }
    }
    rendererCache.set(gameId, fn);
    return fn;
  } catch {
    // No custom screen renderer for this game: use the generic one.
    rendererCache.set(gameId, null);
    return null;
  }
}

const renderErrors = new Set<string>();

function renderGame(): void {
  const dpr = devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  if (currentGameId) {
    loadCustomRenderer(currentGameId).then((fn) => {
      if (fn && currentScreen !== null) {
        try {
          fn(ctx, width, height, currentScreen);
          return;
        } catch (e) {
          if (!renderErrors.has(currentGameId!)) {
            renderErrors.add(currentGameId!);
            console.error(`[Screen] Custom renderer for ${currentGameId} failed, using generic`, e);
          }
        }
      }
      renderGeneric(width, height);
    });
    return;
  }
  renderGeneric(width, height);
}

/** Generic renderer: works with every game's standard screen-state fields. */
function renderGeneric(width: number, height: number): void {
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const state = (currentScreen ?? {}) as Record<string, unknown>;
  let y = 24;

  // Header: game name + phase/round + timer.
  ctx.fillStyle = "#F8FAFC";
  ctx.font = "600 32px Inter, sans-serif";
  ctx.fillText(currentGameName || "TBRN-Games", 32, y);
  y += 44;
  ctx.font = "400 20px Inter, sans-serif";
  ctx.fillStyle = "#94A3B8";
  const meta: string[] = [];
  if (typeof state.phase === "string") meta.push(String(state.phase));
  if (typeof state.round === "number" && typeof state.totalRounds === "number") {
    meta.push(`Round ${state.round}/${state.totalRounds}`);
  }
  if (typeof state.round === "number" && typeof state.maxRounds === "number") {
    meta.push(`Round ${state.round + 1}/${state.maxRounds}`);
  }
  if (typeof state.holeNumber === "number" && typeof state.maxHoles === "number") {
    meta.push(`Hole ${state.holeNumber}/${state.maxHoles}`);
  }
  if (typeof state.level === "number" && typeof state.totalLevels === "number") {
    meta.push(`Level ${state.level}/${state.totalLevels}`);
  }
  if (typeof state.timeLeft === "number" && state.timeLeft > 0) {
    meta.push(`${Math.ceil((state.timeLeft as number) / 1000)}s`);
  }
  if (meta.length) {
    ctx.fillText(meta.join("  ·  "), 32, y);
    y += 32;
  }

  // Big text: prompt, info or last event.
  const bigText = [state.prompt, state.info, state.lastEvent].find(
    (t) => typeof t === "string" && t.length > 0,
  ) as string | undefined;
  if (bigText) {
    ctx.fillStyle = "#F8FAFC";
    ctx.font = "600 26px Inter, sans-serif";
    y = drawWrapped(ctx, bigText, 32, y, width - 64, 32) + 16;
  }

  // Grid (traffic jam, sea battle style screen states).
  if (Array.isArray(state.cells) && Array.isArray(state.cells[0])) {
    y = drawCellGrid(ctx, state.cells as string[][], 32, y, height - y - 260) + 16;
  }

  // Scores / players table.
  const players = Array.isArray(state.players) ? (state.players as Array<Record<string, unknown>>) : [];
  if (players.length) {
    ctx.font = "400 22px Inter, sans-serif";
    for (let i = 0; i < players.length && y < height - 120; i++) {
      const p = players[i];
      const name = String(p.name ?? `Player ${i + 1}`);
      const bits: string[] = [];
      for (const key of ["score", "chips", "totalStrokes", "taps", "shipsLeft", "remaining", "lives", "speed"]) {
        if (typeof p[key] === "number") bits.push(`${key === "score" ? "score" : key}: ${p[key]}`);
      }
      if (p.out === true || p.eliminated === true) bits.push("OUT");
      if (p.folded === true) bits.push("folded");
      if (p.alive === false) bits.push("out");
      ctx.fillStyle = getPlayerColor(i);
      ctx.fillRect(32, y + 4, 14, 14);
      ctx.fillStyle = "#F8FAFC";
      ctx.fillText(`${name}  ${bits.join("  ")}`, 56, y);
      y += 30;
    }
  }

  // Winner banner.
  if (state.finished === true) {
    const winner = state.winner as { name?: string; score?: number } | null;
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(0, height / 2 - 90, width, 180);
    ctx.textAlign = "center";
    ctx.fillStyle = "#F59E0B";
    ctx.font = "700 56px Inter, sans-serif";
    ctx.fillText(winner?.name ? `${winner.name} wins!` : "Game over!", width / 2, height / 2 - 50);
    ctx.textAlign = "left";
  }
}

function drawWrapped(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxWidth && line) {
      c.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    c.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function drawCellGrid(
  c: CanvasRenderingContext2D,
  cells: string[][],
  x: number,
  y: number,
  maxHeight: number,
): number {
  const rows = cells.length;
  const cols = Math.max(...cells.map((r) => r.length), 1);
  const size = Math.max(14, Math.min(44, Math.floor(maxHeight / rows), Math.floor((1200 - x * 2) / cols)));
  c.font = `600 ${Math.floor(size * 0.55)}px Inter, sans-serif`;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const value = String(cells[r]?.[col] ?? "");
      const cx = x + col * size;
      const cy = y + r * size;
      c.fillStyle = value ? "#334155" : "#1E293B";
      c.fillRect(cx, cy, size - 2, size - 2);
      if (value) {
        c.fillStyle = value === "X" ? "#EF4444" : value === "o" ? "#94A3B8" : "#F8FAFC";
        c.fillText(value, cx + 4, cy + 4);
      }
    }
  }
  return y + rows * size;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (currentScreen !== null) renderGame();
}

function getPlayerColor(index: number): string {
  const colors = ["#2E7DFF", "#FF6B35", "#10B981", "#F59E0B"];
  return colors[index % colors.length];
}

window.addEventListener("resize", resizeCanvas);

// Restore the screen's room (keeps the room code stable across refreshes).
try {
  const storedRoom = localStorage.getItem("tbrn_screen_room_id");
  if (storedRoom) roomId = storedRoom;
} catch { /* ignore */ }

loadGames();
connect();
