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

const wsUrl = `ws://${location.host}`;let ws: WebSocket;
let roomId = "";
let hostToken = "";
let currentScreen: unknown = null;
let currentGameId: string | null = null;
let currentGameName = "";
let selectedGameId: string | null = null;
let playerCount = 0;
let resultsHoldUntil = 0;
let resultsTimer: ReturnType<typeof setTimeout> | null = null;

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
const lobbyStage = document.getElementById("lobbyStage")!;
const playing = document.getElementById("playing")!;
const qrImg = document.getElementById("qrCode") as HTMLImageElement;
const urlFallback = document.getElementById("urlFallback")!;
let qrGenerated = false;
const _roomCodeEl = document.getElementById("roomCode")!;
const _playersList = document.getElementById("playersList")!;
const startBtn = document.getElementById("startGameBtn") as HTMLButtonElement;
const picker = document.getElementById("gamePicker")!;
const playerCountEl = document.getElementById("playerCount")!;
const selectedGameEl = document.getElementById("selectedGame")!;
const gameCountEl = document.getElementById("gameCount")!;

function getPlayersList(): HTMLElement {
  return _playersList;
}

function getRoomCodeEl(): HTMLElement {
  return _roomCodeEl;
}

startBtn.disabled = true;

let manifests: GameManifestLite[] = [];

async function loadGames(): Promise<void> {
  try {
    const res = await fetch("/api/games");
    const data = (await res.json()) as { games: GameManifestLite[] };
    manifests = data.games ?? [];
    gameCountEl.textContent = `${manifests.length} installed`;
    renderPicker();
    updateLaunchBar();
  } catch (e) {
    console.error("[Screen] Failed to load games", e);
    gameCountEl.textContent = "Games unavailable";
  }
}

function renderPicker(): void {
  picker.innerHTML = "";

  for (const g of manifests) {
    const enough = playerCount >= g.minPlayers;
    const selected = selectedGameId === g.id;

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `game-tile${selected ? " selected" : ""}`;
    tile.disabled = !enough;
    tile.dataset.game = g.id;
    if (!enough) tile.title = `Needs ${g.minPlayers} players — ${playerCount} at the table`;

    const dots = Array.from(
      { length: g.maxPlayers },
      (_, i) => `<i class="${i < g.minPlayers ? "on" : ""}"></i>`,
    ).join("");

    const meta = enough
      ? `<span class="dots" aria-hidden="true">${dots}</span><span>${g.minPlayers}–${g.maxPlayers}</span>`
      : `<span>Needs ${g.minPlayers}</span>`;

    tile.innerHTML = `
      <span class="name">${escapeHtml(g.name)}</span>
      <span class="meta">${meta}</span>
      <span class="desc">${escapeHtml(g.description)}</span>
    `;

    tile.addEventListener("click", () => {
      selectedGameId = g.id;
      renderPicker();
      updateLaunchBar();
    });
    picker.appendChild(tile);
  }
}

function updateLaunchBar(): void {
  const game = manifests.find((m) => m.id === selectedGameId) ?? null;
  const reachable = selectedGameReachable();

  selectedGameEl.textContent = game ? game.name : "No game picked";

  if (!game) {
    startBtn.textContent = "Pick a game";
    startBtn.disabled = true;
    return;
  }

  if (!reachable) {
    startBtn.textContent = `Needs ${game.minPlayers} players`;
    startBtn.disabled = true;
    return;
  }

  startBtn.textContent = `Start ${game.name}`;
  startBtn.disabled = false;
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

/**
 * The server returns the room to the lobby on the same tick that a game
 * reports "finished". Keep the final frame on screen for a few seconds so the
 * victory screen can actually play, then fall back to the lobby.
 */
function beginResultsHold(ms: number): void {
  resultsHoldUntil = performance.now() + ms;
  if (resultsTimer) clearTimeout(resultsTimer);
  resultsTimer = setTimeout(() => {
    resultsTimer = null;
    resultsHoldUntil = 0;
    currentGameId = null;
    currentScreen = null;
    showLobby();
  }, ms);
}

function clearResultsHold(): void {
  resultsHoldUntil = 0;
  if (resultsTimer) {
    clearTimeout(resultsTimer);
    resultsTimer = null;
  }
}

function handleMessage(msg: ServerMessage) {
  if (msg.type === MESSAGE_TYPES.JOINED) {    const m = msg as ServerMessage & { type: "joined"; payload: { playerId: string; rejoinToken: string; roomState: RoomState; hostToken?: string } };
    roomId = m.roomId;
    if (typeof m.payload.hostToken === "string" && m.payload.hostToken) {
      hostToken = m.payload.hostToken;
    }
    try {
      localStorage.setItem("tbrn_screen_room_id", roomId);
    } catch { /* ignore */ }
    const roomState = m.payload.roomState;
    const codeEl = getRoomCodeEl();
    codeEl.textContent = roomState.code ?? "----";
    updatePlayers(roomState.players ?? [], roomState.status ?? "lobby", roomState.gameId ?? null);
    // Generate the QR once. `img.src` is already the page URL for src="", so
    // use an explicit flag instead of checking the property.
    if (!qrGenerated) {
      fetch("/api/lan-urls").then(r => r.json()).then(data => {
        const urls: string[] = data.urls ?? [];
        if (urls.length > 0 && roomId) {
          const joinUrl = `${urls[0]}/controller?room=${encodeURIComponent(roomId)}`;
          qrImg.src = `/api/qr?data=${encodeURIComponent(joinUrl)}`;
          qrImg.classList.remove("hidden");
          qrGenerated = true;
          // Show the address without the scheme; the room code above already
          // carries the part a person needs to read out loud.
          urlFallback.textContent = joinUrl.replace(/^https?:\/\//, "");
        }
      }).catch(e => console.error("[Screen] LAN URL fetch failed", e));
    }
  } else if (msg.type === MESSAGE_TYPES.ROOM_STATE) {
    const m = msg as ServerMessage & { type: "roomState"; payload: RoomState | { roomState?: RoomState } };
    const rs = m.payload;
    const roomState = (rs as { roomState?: RoomState }).roomState ?? (rs as RoomState);
    const codeEl = getRoomCodeEl();
    codeEl.textContent = roomState.code ?? "----";
    updatePlayers(roomState.players ?? [], roomState.status ?? "lobby", roomState.gameId ?? null);
    // A finished game immediately reports a lobby room state; keep the result
    // up until the hold expires instead of flashing back to the lobby.
    if (roomState.status === "lobby" && performance.now() < resultsHoldUntil) {
      return;
    }
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

    const finished = !!payload.screen && typeof payload.screen === "object" && (payload.screen as { finished?: unknown }).finished === true;
    if (finished) beginResultsHold(7000);
    else clearResultsHold();

    showPlaying();
    renderGame();
  } else if (msg.type === MESSAGE_TYPES.ERROR) {
    const m = msg as ServerMessage & { type: "error"; payload: { code: string; message: string } };
    console.error("[Screen] Error:", m.payload);
    // Show error to user - reuse single toast element to prevent stacking
    let errorDiv = document.getElementById("screen-error-toast");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.id = "screen-error-toast";
      errorDiv.className = "error-toast";
      errorDiv.style.cssText = "position:fixed;top:1rem;right:1rem;padding:1rem;background:#EF4444;color:white;border-radius:0.5rem;z-index:1000;max-width:80%;";
      document.body.appendChild(errorDiv);
    }
    errorDiv.textContent = `${m.payload.code}: ${m.payload.message}`;
    errorDiv.style.display = "block";
    clearTimeout((errorDiv as any)._hideTimeout);
    (errorDiv as any)._hideTimeout = setTimeout(() => {
      errorDiv.style.display = "none";
    }, 5000);
  }
}

function updatePlayers(
  players: Array<{ id: string; name: string; connected: boolean }>,
  status: string,
  gameId: string | null,
): void {
  playerCount = players.length;
  playerCountEl.textContent = String(playerCount);

  const list = getPlayersList();
  list.innerHTML = "";
  const seatCount = Math.max(4, players.length);
  for (let i = 0; i < seatCount; i++) {
    const p = players[i];
    const el = document.createElement("div");
    if (p) {
      const color = getPlayerColor(i);
      el.className = "seat filled";
      el.innerHTML = `
        <span class="swatch" style="background:${color}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
        <span class="nm">${escapeHtml(p.name)}</span>
        <span class="st">${p.connected ? "connected" : "away"}</span>
      `;
    } else {
      el.className = "seat empty";
      el.innerHTML = `<span class="swatch">+</span><span class="nm">Empty seat</span>`;
    }
    list.appendChild(el);
  }

  // The screen owns the room: it can start a game whenever the lobby is open
  // and enough phones have joined for the selected game.
  startBtn.classList.toggle("hidden", status !== "lobby");
  updateLaunchBar();
  if (manifests.length > 0) {
    gameCountEl.textContent =
      playerCount === 0
        ? `${manifests.length} games. Scan to unlock.`
        : `${manifests.length} installed`;
  }
  if (status === "lobby") {
    renderPicker();
  }
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
  fitLobby();
}

/** Scale the 1280×666 lobby stage to the space the page gives it. */
function fitLobby(): void {
  const rect = lobby.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const scale = Math.min(rect.width / 1280, rect.height / 666);
  lobbyStage.style.transform = `scale(${scale})`;
}

function showPlaying() {
  const wasHidden = playing.classList.contains("hidden");
  lobby.classList.add("hidden");
  playing.classList.remove("hidden");
  if (wasHidden) resizeCanvas();
}

startBtn.addEventListener("click", async () => {
  if (!selectedGameId || !roomId) return;
  startBtn.disabled = true;
  try {
    const res = await fetch(`/api/rooms/${roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": hostToken },
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
const rendererLoading = new Set<string>();

async function loadCustomRenderer(gameId: string): Promise<ScreenRenderer | null> {
  if (rendererCache.has(gameId)) return rendererCache.get(gameId) ?? null;
  try {
    const mod = (await import(`/games/${gameId}/screen.ts`)) as Record<string, unknown>;
    const cap = gameId.charAt(0).toUpperCase() + gameId.slice(1);
    const candidates = ["render", `render${cap}`];
    let fn: ScreenRenderer | null = null;
    for (const name of candidates) {
      if (typeof mod[name] === "function") {
        fn = mod[name] as ScreenRenderer;
        break;
      }
    }
    // Multi-word ids (seabattle → renderSeaBattle) cannot be derived from the
    // directory name; accept the module's single `render*` export instead.
    if (!fn) {
      const renderExports = Object.entries(mod).filter(
        ([name, value]) => name.startsWith("render") && typeof value === "function",
      );
      if (renderExports.length === 1) {
        fn = renderExports[0][1] as ScreenRenderer;
      }
    }
    rendererCache.set(gameId, fn);
    return fn;
  } catch (e) {
    // Most games legitimately have no custom renderer; log at debug level so
    // real failures stay visible without flooding the console.
    console.debug(`[Screen] No custom renderer for ${gameId}`, e);
    rendererCache.set(gameId, null);
    return null;
  }
}

const renderErrors = new Set<string>();

function renderGame(): void {
  const dpr = devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  // Start loading a renderer once; never re-enter the dynamic import per frame.
  if (currentGameId && !rendererCache.has(currentGameId) && !rendererLoading.has(currentGameId)) {
    const gameId = currentGameId;
    rendererLoading.add(gameId);
    void loadCustomRenderer(gameId).finally(() => rendererLoading.delete(gameId));
  }

  const fn = currentGameId ? (rendererCache.get(currentGameId) ?? null) : null;

  // Always draw in CSS-pixel space. Renderers may translate for shake and may
  // throw halfway through, so the DPR transform is restored for every frame and
  // the whole call is wrapped in save/restore.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  try {
    if (fn && currentScreen !== null) {
      fn(ctx, width, height, currentScreen);
    } else {
      renderGeneric(width, height);
    }
  } catch (e) {
    if (currentGameId && !renderErrors.has(currentGameId)) {
      renderErrors.add(currentGameId);
      console.error(`[Screen] Custom renderer for ${currentGameId} failed, using generic`, e);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderGeneric(width, height);
  } finally {
    ctx.restore();
  }
}

/** Continuous frame loop so particles, cards and victory screens animate smoothly. */
function frameLoop(): void {
  if (!playing.classList.contains("hidden")) {
    renderGame();
  }
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

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
  // Fit a 16:9 stage inside the space the page actually gives us. Both CSS
  // size and backing-store size are set explicitly so the canvas can never
  // overflow the viewport or feed back into its own layout.
  const host = canvas.parentElement;
  const availW = Math.max(1, host?.clientWidth ?? window.innerWidth);
  const availH = Math.max(1, host?.clientHeight ?? window.innerHeight);
  const ratio = 16 / 9;

  let cssW = availW;
  let cssH = cssW / ratio;
  if (cssH > availH) {
    cssH = availH;
    cssW = cssH * ratio;
  }

  const dpr = devicePixelRatio || 1;
  canvas.style.width = `${Math.floor(cssW)}px`;
  canvas.style.height = `${Math.floor(cssH)}px`;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (currentScreen !== null) renderGame();
}

function getPlayerColor(index: number): string {
  // Same palette the game renderers use, so a player keeps their colour from
  // the lobby into the game.
  const colors = ["#FF2E97", "#00E5FF", "#FFE45E", "#3DFFA2"];
  return colors[index % colors.length];
}

window.addEventListener("resize", () => {
  if (playing.classList.contains("hidden")) fitLobby();
  else resizeCanvas();
});

// Restore the screen's room (keeps the room code stable across refreshes).
try {
  const storedRoom = localStorage.getItem("tbrn_screen_room_id");
  if (storedRoom) roomId = storedRoom;
} catch { /* ignore */ }

loadGames();
fitLobby();
connect();
