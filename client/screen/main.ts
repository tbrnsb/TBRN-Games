/**
 * Screen client — runs on laptop, displays shared game state.
 * Joins the room as a spectator (role "screen"), never as a player.
 * Lobby shows a game picker fetched from /api/games; the QR code links
 * phones to /controller?room=<roomId>.
 *
 * Rendering: if games/<id>/screen.ts exports a render function it is used;
 * otherwise a generic renderer draws the standard screen-state fields.
 */

import type { ServerMessage, RoomState, RoomPause, SessionView, Player } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";
import { GAME_CATALOG, gameAvailability } from "../../shared/game-catalog.ts";
import { SEATS, seatForIndex, type SeatIdentity } from "../../shared/seat-identity.ts";
import { interludeCard, standingsMovement, type MovementDirection } from "../../shared/interlude.ts";
import { stageScale } from "./layout.ts";
import { drawVoteOptions, type VoteOption } from "./kit/vote.ts";
import { scaleForViewport } from "./kit/theme.ts";
import {
  createWatchOverlay,
  drawWatchOverlay,
  revealTextFromScreen,
  tickerRowsFromScreen,
  updateWatchOverlay,
  waitingNamesFromScreen,
  type WatchOverlayState,
  type WatchTickerRow,
} from "./kit/ticker.ts";
import {
  cueSignature,
  cuesFromScreen,
  loadSoundEnabled,
  playCue,
  saveSoundEnabled,
  unlockAudio,
} from "./sound.ts";
import {
  announce,
  cancelSpeech,
  loadSpeechEnabled,
  saveSpeechEnabled,
  shouldAnnounce,
  speechSupported,
} from "./speech.ts";
import type { SettingsStorage } from "./settings.ts";

console.log("[Screen] Module loaded");

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${wsProtocol}://${location.host}`;let ws: WebSocket;
let roomId = "";
let hostToken = "";
let currentScreen: unknown = null;
let currentGameId: string | null = null;
let currentGameName = "";
let selectedGameId: string | null = null;
let playerCount = 0;
let resultsHoldUntil = 0;
let resultsTimer: ReturnType<typeof setTimeout> | null = null;
let sessionView: SessionView | null = null;
let rumbleLength = 5;
let rumbleMode: "vote" | "random" = "vote";
let endConfirmTimer: ReturnType<typeof setTimeout> | null = null;
let roomPause: RoomPause | null = null;
let pauseTicker: ReturnType<typeof setInterval> | null = null;

/** Live room players, kept for the between-game card and interlude badges. */
let roomPlayers: Player[] = [];
/** Standings captured when the current game started, for up/down movement. */
let standingsBeforeGame: StandingRow[] | null = null;
/** Final standings of the last standalone game, so the next one can show movement. */
let lastStandings: StandingRow[] | null = null;
let snapshotGameId: string | null = null;
let interludeTimer: ReturnType<typeof setTimeout> | null = null;
let interludeTicker: ReturnType<typeof setInterval> | null = null;

/** Never-a-dead-screen canvas layer, shared across the whole game loop. */
const watchOverlay: WatchOverlayState = createWatchOverlay();
const reducedMotionQuery =
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
let prefersReducedMotion = reducedMotionQuery?.matches ?? false;
if (reducedMotionQuery) {
  reducedMotionQuery.addEventListener("change", (event) => {
    prefersReducedMotion = event.matches;
  });
}

interface StandingRow {
  playerId: string;
  name: string;
  points: number;
}

/** Seat lookup for scoreboards, refreshed from every room state. */
const seatByPlayerId = new Map<string, SeatIdentity>();
const seatByPlayerName = new Map<string, SeatIdentity>();
const playerIdByName = new Map<string, string>();

interface GameManifestLite {
  id: string;
  name: string;
  displayName?: string;
  minPlayers: number;
  maxPlayers: number;
  description: string;
}

/** User-facing name for a game: catalog display name, then manifest name. */
function gameName(game: GameManifestLite): string {
  return GAME_CATALOG[game.id]?.displayName ?? game.displayName ?? game.name;
}

/** Why this game cannot be played right now, or null when it fits. */
function unavailableReason(game: GameManifestLite): string | null {
  const entry = GAME_CATALOG[game.id];
  if (entry) return gameAvailability(entry, playerCount);
  return gameAvailability(game, playerCount);
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
const launchBar = document.getElementById("launchBar")!;
const shelfHead = document.getElementById("shelfHead")!;
const endGameBtn = document.getElementById("endGameBtn") as HTMLButtonElement;
const rumbleBtn = document.getElementById("rumbleBtn") as HTMLButtonElement;
const rumbleSetup = document.getElementById("rumbleSetup")!;
const rumbleLengthEl = document.getElementById("rumbleLength")!;
const rumbleModeEl = document.getElementById("rumbleMode")!;
const rumbleCancel = document.getElementById("rumbleCancel") as HTMLButtonElement;
const rumbleStart = document.getElementById("rumbleStart") as HTMLButtonElement;
const rumbleError = document.getElementById("rumbleError")!;
const sessionPanel = document.getElementById("sessionPanel")!;
const sessionRoundEl = document.getElementById("sessionRound")!;
const sessionEndBtn = document.getElementById("sessionEnd") as HTMLButtonElement;
const sessionCandidatesEl = document.getElementById("sessionCandidates")!;
const sessionVoteLabel = document.getElementById("sessionVoteLabel")!;
const sessionStandingsEl = document.getElementById("sessionStandings")!;
const sessionHint = document.getElementById("sessionHint")!;
const sessionStartBtn = document.getElementById("sessionStart") as HTMLButtonElement;
const sessionFinal = document.getElementById("sessionFinal")!;
const championName = document.getElementById("championName")!;
const championPoints = document.getElementById("championPoints")!;
const sessionTrophiesEl = document.getElementById("sessionTrophies")!;
const sessionCloseBtn = document.getElementById("sessionClose") as HTMLButtonElement;
const sessionNewBtn = document.getElementById("sessionNew") as HTMLButtonElement;
const pauseOverlay = document.getElementById("pauseOverlay")!;
const pauseTitle = document.getElementById("pauseTitle")!;
const pauseCountdown = document.getElementById("pauseCountdown")!;
const pauseWaitBtn = document.getElementById("pauseWait") as HTMLButtonElement;
const pauseEndBtn = document.getElementById("pauseEnd") as HTMLButtonElement;
const interludeEl = document.getElementById("interlude")!;
const interludeKicker = document.getElementById("interludeKicker")!;
const interludeTitle = document.getElementById("interludeTitle")!;
const interludeStandingsEl = document.getElementById("interludeStandings")!;
const interludeGameEl = document.getElementById("interludeGame")!;
const interludeRuleEl = document.getElementById("interludeRule")!;
const interludeCountEl = document.getElementById("interludeCount")!;
const interludeCountdownEl = document.getElementById("interludeCountdown")!;
const interludeSkipBtn = document.getElementById("interludeSkip") as HTMLButtonElement;
const settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;
const settingsPanel = document.getElementById("settingsPanel")!;
const settingsCloseBtn = document.getElementById("settingsClose") as HTMLButtonElement;
const soundToggle = document.getElementById("soundToggle") as HTMLInputElement;
const speechToggle = document.getElementById("speechToggle") as HTMLInputElement;
const speechNote = document.getElementById("speechNote")!;

/** localStorage can throw in private mode; settings then live for this page. */
const settingsStorage: SettingsStorage | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const speechOk = speechSupported();
/** Sound on by default; speech only when this browser can actually speak. */
let soundEnabled = loadSoundEnabled(settingsStorage);
let speechEnabled = loadSpeechEnabled(settingsStorage, speechOk);

function getPlayersList(): HTMLElement {
  return _playersList;
}

function getRoomCodeEl(): HTMLElement {
  return _roomCodeEl;
}

startBtn.disabled = true;

// --- Host settings (sound + speech) ---

/** Reflect the current preferences and capabilities in the settings panel. */
function applySettingControls(): void {
  soundToggle.checked = soundEnabled;
  speechToggle.checked = speechEnabled;
  speechToggle.disabled = !speechOk;
  speechNote.classList.toggle("hidden", speechOk);
}

function openSettings(): void {
  applySettingControls();
  settingsPanel.classList.remove("hidden");
  settingsBtn.setAttribute("aria-expanded", "true");
  document.body.classList.add("settings-open");
  soundToggle.focus();
}

function closeSettings(): void {
  settingsPanel.classList.add("hidden");
  settingsBtn.setAttribute("aria-expanded", "false");
  document.body.classList.remove("settings-open");
  settingsBtn.focus();
}

function toggleSettings(): void {
  if (settingsPanel.classList.contains("hidden")) openSettings();
  else closeSettings();
}

settingsBtn.addEventListener("click", toggleSettings);
settingsCloseBtn.addEventListener("click", closeSettings);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsPanel.classList.contains("hidden")) {
    closeSettings();
  }
});

soundToggle.addEventListener("change", () => {
  soundEnabled = soundToggle.checked;
  saveSoundEnabled(settingsStorage, soundEnabled);
  // Audible confirmation that the setting took effect.
  if (soundEnabled) playCue("vote");
});

speechToggle.addEventListener("change", () => {
  speechEnabled = speechToggle.checked;
  saveSpeechEnabled(settingsStorage, speechEnabled);
  if (!speechEnabled) cancelSpeech();
});

applySettingControls();

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
    const reason = unavailableReason(g);
    const available = reason === null;
    const selected = selectedGameId === g.id;

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `game-tile${selected ? " selected" : ""}`;
    tile.disabled = !available;
    tile.dataset.game = g.id;
    if (reason) tile.title = `${capitalise(reason)} — ${playerCount} at the table`;

    const dots = Array.from(
      { length: g.maxPlayers },
      (_, i) => `<i class="${i < g.minPlayers ? "on" : ""}"></i>`,
    ).join("");

    const meta = available
      ? `<span class="dots" aria-hidden="true">${dots}</span><span>${g.minPlayers}–${g.maxPlayers}</span>`
      : `<span>${capitalise(reason)}</span>`;

    tile.innerHTML = `
      <span class="name">${escapeHtml(gameName(g))}</span>
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

function capitalise(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function updateLaunchBar(): void {
  const game = manifests.find((m) => m.id === selectedGameId) ?? null;
  const reachable = selectedGameReachable();

  selectedGameEl.textContent = game ? gameName(game) : "No game picked";
  // Poker is the only game with host-tunable settings so far.
  document.getElementById("stackField")?.classList.toggle("hidden", game?.id !== "poker");

  if (!game) {
    startBtn.textContent = "Pick a game";
    startBtn.disabled = true;
    return;
  }

  if (!reachable) {
    startBtn.textContent = capitalise(unavailableReason(game) ?? "not playable");
    startBtn.disabled = true;
    return;
  }

  startBtn.textContent = `Start ${gameName(game)}`;
  startBtn.disabled = false;
}

// --- Royal Rumble ---

/** Show the session panel, the final trophy board, or the normal game shelf. */
function applySession(view: SessionView | null): void {
  const hadSession = sessionView !== null;
  sessionView = view;
  // Standalone movement never compares across a Rumble boundary.
  if (view === null || !hadSession) lastStandings = null;
  // Ending a paused Rumble round skips to the next game instead of ending it.
  pauseEndBtn.textContent = view?.status === "playing" ? "Skip to next game" : "End game";
  const inSession = view !== null;
  picker.classList.toggle("hidden", inSession);
  launchBar.classList.toggle("hidden", inSession);
  shelfHead.classList.toggle("hidden", inSession);
  rumbleBtn.classList.toggle("hidden", inSession);
  gameCountEl.classList.toggle("hidden", inSession);
  rumbleSetup.classList.add("hidden");

  if (!view) {
    sessionPanel.classList.add("hidden");
    sessionFinal.classList.add("hidden");
    return;
  }

  if (view.status === "finished") {
    sessionPanel.classList.add("hidden");
    sessionFinal.classList.remove("hidden");
    renderFinal(view);
    return;
  }

  sessionFinal.classList.add("hidden");
  sessionPanel.classList.remove("hidden");
  renderSession(view);
}

function renderSession(view: SessionView): void {
  const total = view.length;
  sessionRoundEl.textContent =
    view.status === "playing"
      ? `Game ${view.round} of ${total} in play`
      : `Round ${Math.min(view.round, total)} of ${total}`;

  const leader = view.leadingGameId
    ? view.candidates.find((g) => g.id === view.leadingGameId) ?? null
    : null;

  sessionVoteLabel.textContent =
    view.selection === "random"
      ? "Random pick for this round"
      : "Phones vote for the next game";

  const maxVotes = Math.max(1, ...view.votes.map((v) => v.count));
  sessionCandidatesEl.innerHTML = "";
  for (const candidate of view.votes) {
    const row = document.createElement("div");
    const leading = candidate.gameId === view.leadingGameId && view.selection === "vote" && candidate.count > 0;
    row.className = `candidate${leading ? " leading" : ""}`;
    row.innerHTML = `
      <span class="nm">${escapeHtml(candidate.name)}</span>
      <span class="ct">${view.selection === "vote" ? candidate.count : ""}</span>
      <span class="bar"><i style="width:${Math.round((candidate.count / maxVotes) * 100)}%"></i></span>
    `;
    sessionCandidatesEl.appendChild(row);
  }

  sessionStandingsEl.innerHTML = "";
  for (const standing of view.standings) {
    const row = document.createElement("div");
    row.className = "standing";
    const seat = seatByPlayerId.get(standing.playerId) ?? seatByPlayerName.get(standing.name);
    const badge = seat
      ? `<span class="badge" style="background:${seat.color}" title="${escapeHtml(seat.shape)}" aria-hidden="true">${seat.emoji}</span>`
      : "";
    row.innerHTML = `
      ${badge}
      <span class="nm">${escapeHtml(standing.name)}</span>
      <span class="pts">${standing.points}</span>
    `;
    sessionStandingsEl.appendChild(row);
  }

  if (view.selection === "random") {
    sessionHint.textContent = leader
      ? `The wheel picked ${leader.name}.`
      : "Waiting for a random pick…";
  } else if (view.voted === 0) {
    sessionHint.textContent = `${playerCount} ${playerCount === 1 ? "phone" : "phones"} can vote.`;
  } else {
    sessionHint.textContent =
      `${view.voted} of ${playerCount} voted` + (leader ? ` · ${leader.name} leads` : "");
  }

  sessionStartBtn.disabled = !leader;
  sessionStartBtn.textContent = leader ? `Start ${leader.name}` : "Waiting for votes";
}

function renderFinal(view: SessionView): void {
  championName.textContent = view.champion?.name ?? "No champion";
  championPoints.textContent = view.champion ? `${view.champion.points} points` : "";

  sessionTrophiesEl.innerHTML = "";
  for (const trophy of view.trophies) {
    const card = document.createElement("div");
    card.className = "trophy";
    card.innerHTML = `
      <span class="t">${escapeHtml(trophy.name)}</span>
      <span class="p">${escapeHtml(trophy.playerName)}</span>
      <span class="d">${escapeHtml(trophy.detail)}</span>
    `;
    sessionTrophiesEl.appendChild(card);
  }
}

async function startRumble(): Promise<void> {
  if (!roomId) return;
  rumbleStart.disabled = true;
  rumbleError.textContent = "";
  rumbleError.classList.remove("error");
  try {
    const res = await fetch(`/api/rooms/${roomId}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": hostToken },
      body: JSON.stringify({ length: rumbleLength, selection: rumbleMode }),
    });
    const body = (await res.json().catch(() => ({}))) as { session?: SessionView; message?: string };
    if (!res.ok || !body.session) {
      rumbleError.textContent = body.message ?? "Could not start the rumble.";
      rumbleError.classList.add("error");
      return;
    }
    applySession(body.session);
  } catch (e) {
    console.error("[Screen] Rumble start failed", e);
    rumbleError.textContent = "Could not reach the server.";
    rumbleError.classList.add("error");
  } finally {
    rumbleStart.disabled = false;
  }
}

async function endRumble(): Promise<void> {
  if (!roomId) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/session/end`, {
      method: "POST",
      headers: { "x-host-token": hostToken },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error("[Screen] End rumble failed:", body.message ?? res.status);
      return;
    }
    applySession(null);
  } catch (e) {
    console.error("[Screen] End rumble request failed", e);
  }
}

/** Host-tunable settings for the few games that take them. */
function hostOptionsFor(gameId: string): Record<string, unknown> {
  if (gameId !== "poker") return {};
  const stack = Number((document.getElementById("stackInput") as HTMLInputElement | null)?.value);
  const hands = Number((document.getElementById("handsInput") as HTMLInputElement | null)?.value);
  const options: Record<string, unknown> = {};
  if (Number.isFinite(stack)) options.startingStack = stack;
  if (Number.isFinite(hands)) options.maxHands = hands;
  return options;
}

async function startSessionGame(gameId: string): Promise<void> {
  if (!roomId || !gameId) return;
  sessionStartBtn.disabled = true;
  try {
    const res = await fetch(`/api/rooms/${roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": hostToken },
      body: JSON.stringify({ gameId, options: hostOptionsFor(gameId) }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      sessionHint.textContent = body.message ?? "Could not start that game.";
      sessionStartBtn.disabled = false;
    }
  } catch (e) {
    console.error("[Screen] Start rumble game failed", e);
    sessionStartBtn.disabled = false;
  }
}

function resetEndGameButton(): void {
  if (endConfirmTimer) {
    clearTimeout(endConfirmTimer);
    endConfirmTimer = null;
  }
  endGameBtn.classList.remove("confirm");
  endGameBtn.textContent = "End game";
}

async function endGame(): Promise<void> {
  if (!roomId) return;
  resetEndGameButton();
  try {
    const res = await fetch(`/api/rooms/${roomId}/end-game`, {
      method: "POST",
      headers: { "x-host-token": hostToken },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error("[Screen] End game failed:", body.message ?? res.status);
    }
  } catch (e) {
    console.error("[Screen] End game request failed", e);
  }
}

function openRumbleSetup(): void {
  rumbleError.textContent = "";
  rumbleError.classList.remove("error");
  rumbleSetup.classList.remove("hidden");
}

function closeRumbleSetup(): void {
  rumbleSetup.classList.add("hidden");
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
 * victory screen can actually play, then show the between-game interlude.
 */
function beginResultsHold(ms: number): void {
  resultsHoldUntil = performance.now() + ms;
  if (resultsTimer) clearTimeout(resultsTimer);
  resultsTimer = setTimeout(() => {
    resultsTimer = null;
    resultsHoldUntil = 0;
    // The interlude needs the final screen and game name; clear them after.
    const finishedScreen = currentScreen;
    const finishedName = currentGameName;
    currentGameId = null;
    currentScreen = null;
    showLobby();
    beginInterlude(finishedScreen, finishedName);
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
    updatePauseOverlay(roomState);
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
    updatePauseOverlay(roomState);
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
    if (payload.gameId !== undefined && payload.gameId !== currentGameId) {
      // A new game starts with a clean cue/announce baseline.
      resetAudioHooks();
    }
    currentScreen = payload.screen;
    if (payload.gameId !== undefined) currentGameId = payload.gameId;
    if (payload.gameName) currentGameName = payload.gameName;

    // Snapshot the standings once per game so the interlude can show movement.
    // A Rumble uses its own points; a standalone game compares with the
    // previous standalone finish, and has no baseline on the first game.
    if (currentGameId && currentGameId !== snapshotGameId) {
      snapshotGameId = currentGameId;
      if (sessionView && sessionView.standings.length > 0) {
        standingsBeforeGame = sessionView.standings.map((standing) => ({
          playerId: standing.playerId,
          name: standing.name,
          points: standing.points,
        }));
      } else {
        standingsBeforeGame = lastStandings ? lastStandings.map((row) => ({ ...row })) : null;
      }
    }

    const finished = !!payload.screen && typeof payload.screen === "object" && (payload.screen as { finished?: unknown }).finished === true;
    if (finished) beginResultsHold(7000);
    else clearResultsHold();

    showPlaying();
    renderGame();
  } else if (msg.type === MESSAGE_TYPES.SESSION) {
    const m = msg as ServerMessage & { type: "session"; payload: { session: SessionView | null } };
    applySession(m.payload.session ?? null);
  } else if (msg.type === MESSAGE_TYPES.REACTION) {
    const m = msg as ServerMessage & {
      type: "reaction";
      payload: { playerId: string; name: string; seat: SeatIdentity | null; id: string; emoji: string };
    };
    showReaction(m.payload);
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

// --- Audience reactions ---
const reactionLayer = document.getElementById("reactionLayer");

/**
 * Float one reaction up the screen. Several can run at once; old ones are
 * culled so a spammy room cannot accumulate DOM nodes.
 */
function showReaction(payload: { name: string; seat: SeatIdentity | null; emoji: string }): void {
  if (!reactionLayer) return;
  while (reactionLayer.childElementCount >= 12) {
    reactionLayer.firstElementChild?.remove();
  }
  const el = document.createElement("div");
  el.className = "reaction-float";
  // Spread the floats across the middle of the stage, never at the edges.
  el.style.left = `${10 + Math.random() * 80}%`;
  if (payload.seat?.color) el.style.color = payload.seat.color;
  el.innerHTML = `
    <span class="emoji">${escapeHtml(payload.emoji)}</span>
    <span class="who">${escapeHtml(payload.name)}</span>
  `;
  reactionLayer.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// --- Below-minimum pause overlay ---

/**
 * Show the host offer while a running game waits for players. Names are the
 * seats that are away or left, so the table can see who it is waiting on.
 */
function updatePauseOverlay(roomState: RoomState): void {
  const pause = roomState.pause ?? null;
  roomPause = pause;
  if (!pause || roomState.status !== "playing") {
    hidePauseOverlay();
    return;
  }

  const names = roomState.players
    .filter((p) => !p.spectator && (p.presence ?? (p.connected ? "active" : "away")) !== "active")
    .map((p) => p.name);

  pauseTitle.textContent = names.length
    ? `Waiting for players — ${names.join(", ")}`
    : "Waiting for players";
  pauseEndBtn.textContent = sessionView?.status === "playing" ? "Skip to next game" : "End game";
  pauseOverlay.classList.remove("hidden");
  updatePauseCountdown();
  if (!pauseTicker) pauseTicker = setInterval(updatePauseCountdown, 250);
}

function hidePauseOverlay(): void {
  pauseOverlay.classList.add("hidden");
  if (pauseTicker) {
    clearInterval(pauseTicker);
    pauseTicker = null;
  }
}

function updatePauseCountdown(): void {
  if (!roomPause) return;
  const remaining = Math.max(0, Math.ceil((roomPause.until - Date.now()) / 1000));
  pauseCountdown.textContent = remaining > 0 ? `${remaining}s` : "Paused";
}

function updatePlayers(
  players: Player[],
  status: string,
  gameId: string | null,
): void {
  playerCount = players.length;
  playerCountEl.textContent = String(playerCount);
  roomPlayers = players;

  seatByPlayerId.clear();
  seatByPlayerName.clear();
  playerIdByName.clear();
  const bySeat = new Map<number, (typeof players)[number]>();
  players.forEach((player, index) => {
    const seat = player.seat ?? seatForIndex(index);
    seatByPlayerId.set(player.id, seat);
    seatByPlayerName.set(player.name, seat);
    playerIdByName.set(player.name, player.id);
    bySeat.set(seat.index, player);
  });

  const list = getPlayersList();
  list.innerHTML = "";
  // Always show all eight seats so the table layout does not jump as phones
  // join. Seats are addressed by their stable index, not array position.
  for (let i = 0; i < SEATS.length; i++) {
    const p = bySeat.get(i);
    const el = document.createElement("div");
    if (p) {
      const seat = p.seat ?? seatForIndex(i);
      const presence = p.presence ?? (p.connected ? "active" : "away");
      // Away and left seats stay on the board, greyed and labelled.
      el.className = `seat filled${presence === "active" ? "" : ` ${presence}`}`;
      el.innerHTML = `
        <span class="swatch" style="background:${seat.color}" title="${escapeHtml(seat.shape)}" aria-label="Seat ${seat.index + 1}: ${escapeHtml(seat.shape)}">${seat.emoji}</span>
        <span class="nm" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        <span class="st">${presence === "active" ? "" : presence}</span>
      `;
    } else {
      el.className = "seat empty";
      el.innerHTML = `<span class="swatch">+</span><span class="nm">Empty seat</span>`;
    }
    list.appendChild(el);
  }

  // The screen owns the room: it can start a game whenever the lobby is open
  // and enough phones have joined for the selected game.
  startBtn.classList.toggle("hidden", status !== "lobby" || sessionView !== null);
  endGameBtn.classList.toggle("hidden", status !== "playing");
  if (status !== "playing") resetEndGameButton();
  updateLaunchBar();
  if (sessionView && sessionView.status !== "finished") renderSession(sessionView);
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
  return !!g && unavailableReason(g) === null;
}

// --- Between-game interlude ---

/** Standings from whichever score table the finished game published. */
function standingsFromScreen(screen: unknown): StandingRow[] {
  return tickerRowsFromScreen(screen)
    .map((row) => ({
      playerId: playerIdByName.get(row.name) ?? row.name,
      name: row.name,
      points: row.score,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/**
 * Current standings for the interlude. A Rumble's own table wins because it
 * already carries placement points; otherwise the finished game's final scores
 * are read from the screen, and the bare seat list is the last resort.
 */
function currentStandingRows(screen: unknown): StandingRow[] {
  if (sessionView && sessionView.standings.length > 0) {
    return sessionView.standings.map((standing) => ({
      playerId: standing.playerId,
      name: standing.name,
      points: standing.points,
    }));
  }
  const fromScreen = standingsFromScreen(screen);
  if (fromScreen.length > 0) return fromScreen;
  return roomPlayers
    .filter((player) => !player.spectator)
    .map((player) => ({ playerId: player.id, name: player.name, points: 0 }));
}

/** The next game to headline: the Rumble leader, else the lobby's pick. */
function nextGameForInterlude(): { name: string; description?: string } | null {
  if (sessionView) {
    const wanted = sessionView.leadingGameId ?? sessionView.currentGameId;
    const candidate =
      sessionView.candidates.find((game) => game.id === wanted) ?? sessionView.candidates[0] ?? null;
    if (candidate) return { name: candidate.name, description: candidate.description };
    return null;
  }
  const game = manifests.find((manifest) => manifest.id === selectedGameId) ?? null;
  return game ? { name: gameName(game), description: game.description } : null;
}

function movementGlyph(direction: MovementDirection): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  if (direction === "new") return "NEW";
  return "–";
}

function renderInterludeStandings(rows: StandingRow[], movement: Map<string, MovementDirection>): void {
  interludeStandingsEl.innerHTML = "";
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "interlude-empty";
    empty.textContent = "Waiting for players";
    interludeStandingsEl.appendChild(empty);
    return;
  }

  for (const row of rows.slice(0, 8)) {
    const direction = movement.get(row.playerId) ?? "same";
    const seat = seatByPlayerId.get(row.playerId) ?? seatByPlayerName.get(row.name);
    const el = document.createElement("div");
    el.className = "il-row";
    el.innerHTML = `
      <span class="il-move ${direction}" aria-label="${direction === "new" ? "new" : direction}">${movementGlyph(direction)}</span>
      ${seat ? `<span class="badge" style="background:${seat.color}" title="${escapeHtml(seat.shape)}" aria-hidden="true">${seat.emoji}</span>` : ""}
      <span class="nm">${escapeHtml(row.name)}</span>
      <span class="pts">${row.points}</span>
    `;
    interludeStandingsEl.appendChild(el);
  }
}

/**
 * Show the 15-second between-game card: standings movement, next game, live
 * player count, a visible countdown and a host Skip button. The lobby sits
 * behind it, so skipping lands straight back on the picker or voting panel.
 */
function beginInterlude(screen: unknown, gameLabel: string): void {
  const activePlayers = roomPlayers.filter(
    (player) => !player.spectator && (player.presence ?? (player.connected ? "active" : "away")) === "active",
  );

  // The finale and an empty room are not between-game moments.
  if (sessionView?.status === "finished" || activePlayers.length === 0) {
    standingsBeforeGame = null;
    return;
  }

  const card = interludeCard({
    session: sessionView,
    nextGame: nextGameForInterlude(),
    players: roomPlayers,
  });

  const current = currentStandingRows(screen);
  const previous = standingsBeforeGame ?? current;
  const movement = new Map(standingsMovement(previous, current).map((item) => [item.playerId, item.direction]));

  interludeTitle.textContent = card.title;
  interludeKicker.textContent = sessionView
    ? `Round ${Math.max(1, sessionView.round - 1)} of ${sessionView.length}${gameLabel ? ` · ${gameLabel}` : ""}`
    : gameLabel || "Between games";
  renderInterludeStandings(current, movement);

  interludeGameEl.textContent = card.gameName;
  interludeRuleEl.textContent = card.rule;
  interludeCountEl.textContent =
    card.playerCount > 0
      ? `Playing with ${card.playerCount} ${card.playerCount === 1 ? "player" : "players"}`
      : "Waiting for players";

  // Remember this finish for the next standalone game's movement. An all-zero
  // fallback table is not a real result, so it never becomes the new baseline.
  if (current.some((row) => row.points !== 0)) lastStandings = current;
  standingsBeforeGame = null;

  if (interludeTimer) clearTimeout(interludeTimer);
  if (interludeTicker) clearInterval(interludeTicker);
  interludeEl.classList.remove("hidden");

  const startedAt = performance.now();
  const total = card.durationMs;
  interludeCountdownEl.textContent = `${Math.ceil(total / 1000)}s`;
  interludeTicker = setInterval(() => {
    const left = Math.max(0, total - (performance.now() - startedAt));
    interludeCountdownEl.textContent = `${Math.ceil(left / 1000)}s`;
  }, 250);
  interludeTimer = setTimeout(dismissInterlude, total);
}

function dismissInterlude(): void {
  interludeEl.classList.add("hidden");
  if (interludeTimer) {
    clearTimeout(interludeTimer);
    interludeTimer = null;
  }
  if (interludeTicker) {
    clearInterval(interludeTicker);
    interludeTicker = null;
  }
}

function showLobby() {
  lobby.classList.remove("hidden");
  playing.classList.add("hidden");
  endGameBtn.classList.add("hidden");
  resetEndGameButton();
  fitLobby();
}

/** Scale the 1280×666 lobby stage to the space the page gives it. */
function fitLobby(): void {
  const rect = lobby.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  lobbyStage.style.transform = `scale(${stageScale(rect.width, rect.height)})`;
}

function showPlaying() {
  dismissInterlude();
  const wasHidden = playing.classList.contains("hidden");
  lobby.classList.add("hidden");
  playing.classList.remove("hidden");
  endGameBtn.classList.remove("hidden");
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

// --- Rumble controls ---
rumbleBtn.addEventListener("click", () => {
  if (rumbleSetup.classList.contains("hidden")) openRumbleSetup();
  else closeRumbleSetup();
});

rumbleLengthEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button[data-len]") as HTMLButtonElement | null;
  if (!button) return;
  rumbleLength = Number(button.dataset.len ?? 5);
  for (const btn of rumbleLengthEl.querySelectorAll("button")) {
    btn.classList.toggle("on", btn === button);
  }
});

rumbleModeEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button[data-mode]") as HTMLButtonElement | null;
  if (!button) return;
  rumbleMode = button.dataset.mode === "random" ? "random" : "vote";
  for (const btn of rumbleModeEl.querySelectorAll("button")) {
    btn.classList.toggle("on", btn === button);
  }
});

rumbleCancel.addEventListener("click", closeRumbleSetup);
rumbleStart.addEventListener("click", () => void startRumble());
sessionEndBtn.addEventListener("click", () => void endRumble());
sessionStartBtn.addEventListener("click", () => {
  const view = sessionView;
  if (!view?.leadingGameId) return;
  void startSessionGame(view.leadingGameId);
});
sessionCloseBtn.addEventListener("click", () => void endRumble());
sessionNewBtn.addEventListener("click", async () => {
  await endRumble();
  openRumbleSetup();
});

endGameBtn.addEventListener("click", () => {
  if (!endGameBtn.classList.contains("confirm")) {
    endGameBtn.classList.add("confirm");
    endGameBtn.textContent = "Tap again to end";
    endConfirmTimer = setTimeout(resetEndGameButton, 4000);
    return;
  }
  void endGame();
});

// --- Pause overlay controls ---
pauseWaitBtn.addEventListener("click", async () => {
  if (!roomId) return;
  pauseWaitBtn.disabled = true;
  try {
    const res = await fetch(`/api/rooms/${roomId}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": hostToken },
      body: JSON.stringify({ action: "wait" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      console.error("[Screen] Wait failed:", body.message ?? res.status);
    }
  } catch (e) {
    console.error("[Screen] Wait request failed", e);
  } finally {
    pauseWaitBtn.disabled = false;
  }
});
pauseEndBtn.addEventListener("click", () => void endGame());

// The screen already holds the host token; skipping is a local dismiss because
// the lobby (or the Rumble voting panel) is already rendered behind the card.
interludeSkipBtn.addEventListener("click", dismissInterlude);

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

  // Never-a-dead-screen layer, on top of the game's own renderer.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  try {
    drawWatchLayer(width, height);
  } catch (e) {
    console.debug("[Screen] Watch overlay failed", e);
  } finally {
    ctx.restore();
  }
}

/**
 * Draw the ticker, waiting banner, caption and reveal flash from the current
 * screen state. A finished game is skipped so the victory screen stays clean.
 */
function drawWatchLayer(width: number, height: number): void {
  const state = (currentScreen ?? {}) as Record<string, unknown>;
  const finished = state.finished === true;
  if (finished) return;

  const rows: WatchTickerRow[] = tickerRowsFromScreen(state).map((row) => ({
    name: row.name,
    seat: seatByPlayerName.get(row.name) ?? seatForIndex(0),
    score: row.score,
  }));

  const now = performance.now();
  const caption = typeof state.caption === "string" && state.caption.trim() ? state.caption : null;
  updateWatchOverlay(watchOverlay, {
    rows,
    waitingNames: waitingNamesFromScreen(state),
    timeLeft: typeof state.timeLeft === "number" && Number.isFinite(state.timeLeft) ? state.timeLeft : null,
    caption,
    reveal: revealTextFromScreen(state),
    now,
    reducedMotion: prefersReducedMotion,
  });
  drawWatchOverlay(ctx, width, height, watchOverlay, now, prefersReducedMotion);
}

/** Continuous frame loop so particles, cards and victory screens animate smoothly. */
function frameLoop(): void {
  syncAudioHooks();
  if (!playing.classList.contains("hidden")) {
    renderGame();
  }
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// --- Optional sound and speech hooks (brief 3.8) ---

let lastCueSignature = "";
let lastCaption = "";
let lastAnnouncement = "";

function resetAudioHooks(): void {
  lastCueSignature = "";
  lastCaption = "";
  lastAnnouncement = "";
}

/**
 * Play the cues and speak the line the current screen state asks for. Runs
 * once per frame but only acts when a published value changes, so a game can
 * hold `sound` or `announce` on screen without replaying it every frame.
 *
 * Generic by design: games publish `sound`, `announce` and `caption`; the
 * screen owns the synth, the speech and the mute toggles.
 */
function syncAudioHooks(): void {
  const state = currentScreen;
  if (!state || typeof state !== "object") {
    resetAudioHooks();
    return;
  }
  const record = state as Record<string, unknown>;

  const cues = cuesFromScreen(record);
  const signature = cueSignature(cues);
  if (signature !== lastCueSignature) {
    lastCueSignature = signature;
    for (const cue of cues) playCue(cue, { enabled: soundEnabled });
  }

  // A new caption is a reveal moment, even when the game published no cue.
  const caption = typeof record.caption === "string" ? record.caption.trim() : "";
  if (!caption) {
    lastCaption = "";
  } else if (caption !== lastCaption) {
    lastCaption = caption;
    if (!cues.includes("reveal")) playCue("reveal", { enabled: soundEnabled });
  }

  const line = typeof record.announce === "string" ? record.announce : "";
  if (shouldAnnounce(lastAnnouncement, line)) {
    lastAnnouncement = line.trim();
    announce(line, { enabled: speechEnabled });
  } else if (!line.trim()) {
    lastAnnouncement = "";
  }
}

// Browsers only release audio after a gesture; the first click or key press
// unlocks it, and the settings toggle doubles as a gesture when it is flipped.
window.addEventListener("pointerdown", () => {
  if (soundEnabled) unlockAudio();
}, { once: true });
window.addEventListener("keydown", () => {
  if (soundEnabled) unlockAudio();
}, { once: true });

/** Normalise a game's screen `options` array into the kit's VoteOption shape. */
function readVoteOptions(state: Record<string, unknown>): VoteOption[] {
  if (!Array.isArray(state.options)) return [];
  const options: VoteOption[] = [];
  for (const raw of state.options) {
    if (typeof raw === "string") {
      options.push({ id: raw, label: raw });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label =
      typeof record.label === "string"
        ? record.label
        : typeof record.text === "string"
          ? record.text
          : "";
    if (!label) continue;
    options.push({
      id: typeof record.id === "string" ? record.id : String(options.length),
      label,
      votes: typeof record.votes === "number" ? record.votes : undefined,
      selected: record.selected === true,
    });
  }
  return options;
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

  // Vote options: use the shared layout whenever a game exposes one, even if
  // it has no custom renderer. This keeps letter badges and type sizes
  // consistent with the phone controllers.
  const voteOptions = readVoteOptions(state);
  if (voteOptions.length > 0) {
    const rect = {
      x: 32,
      y,
      width: width - 64,
      height: Math.max(120, height - y - 24),
    };
    drawVoteOptions(ctx, rect, voteOptions, {
      scale: scaleForViewport(width, height),
      selectedId: typeof state.selectedId === "string" ? state.selectedId : null,
      showVoteCounts: state.showVoteCounts === true,
      // A composed-text game may split six long answers into two columns.
      minColumns: state.optionColumns === 2 ? 2 : 1,
    });
    y = rect.y + rect.height;
  }

  // Grid (traffic jam, sea battle style screen states).
  if (voteOptions.length === 0 && Array.isArray(state.cells) && Array.isArray(state.cells[0])) {
    y = drawCellGrid(ctx, state.cells as string[][], 32, y, height - y - 260) + 16;
  }

  // Scores / players table.
  const players = Array.isArray(state.players) ? (state.players as Array<Record<string, unknown>>) : [];
  if (voteOptions.length === 0 && players.length) {
    for (let i = 0; i < players.length && y < height - 120; i++) {
      const p = players[i];
      const seat = (p.seat as SeatIdentity | undefined) ?? seatForIndex(i);
      const rawName = String(p.name ?? `Player ${i + 1}`);
      const presence = typeof p.presence === "string" ? p.presence : "active";
      const bits: string[] = [];
      for (const key of ["score", "chips", "totalStrokes", "taps", "shipsLeft", "remaining", "lives", "speed"]) {
        if (typeof p[key] === "number") bits.push(`${key === "score" ? "score" : key}: ${p[key]}`);
      }
      if (p.out === true || p.eliminated === true) bits.push("OUT");
      if (p.folded === true) bits.push("folded");
      if (p.alive === false) bits.push("out");
      // Away/left players keep their row, greyed and labelled.
      if (presence !== "active") bits.push(presence);

      // Colour + shape badge: never colour alone.
      ctx.fillStyle = seat.color;
      ctx.fillRect(32, y + 2, 18, 18);
      ctx.fillStyle = "#0F172A";
      ctx.font = "700 12px Inter, sans-serif";
      ctx.fillText(seat.emoji, 36, y + 3);

      ctx.fillStyle = presence === "active" ? "#F8FAFC" : "#64748B";
      ctx.font = "400 22px Inter, sans-serif";
      const name = ellipsize(ctx, rawName, Math.max(120, width - 360));
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

/** Clip a canvas label to maxWidth, ending with an ellipsis. */
function ellipsize(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (c.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && c.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
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
