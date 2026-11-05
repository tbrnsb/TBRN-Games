/**
 * Controller client — runs on phone, sends inputs, receives private game state.
 * Uses shared controller layouts from shared/controllers.ts.
 *
 * The layout re-renders when the controller type or the layout signature
 * changes, and does cheap updates otherwise. The rejoin token is persisted
 * on JOINED so a refresh or dropped connection can rejoin the same room.
 */

import type { ClientMessage, ServerMessage, ControllerType, PlayerPresence, SessionView } from "../../shared/types.ts";
import { MESSAGE_TYPES } from "../../shared/constants.js";
import { getLayout } from "../../shared/controllers.ts";
import type { ControllerLayout } from "../../shared/controllers.ts";
import type { SeatIdentity } from "../../shared/seat-identity.ts";
import { REACTIONS, REACTION_COOLDOWN_MS, type ReactionId } from "../../shared/reactions.ts";

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
let inGame = false;
let roomStatus = "lobby";
let sessionPayload: {
  session: SessionView | null;
  yourVote: string | null;
  canVote: boolean;
  yourPoints: number;
} | null = null;
let myPresence: PlayerPresence = "active";
let mySpectator = false;
let reactionReadyAt = 0;
let reactionTicker: ReturnType<typeof setInterval> | null = null;

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
const seatBadgeEl = document.getElementById("seatBadge")!;
const connDot = document.getElementById("connDot")!;
const gameLabel = document.getElementById("gameLabel")!;
const coach = document.getElementById("coach")!;
const idle = document.getElementById("idle")!;
const statusEl = document.getElementById("status")!;
const controllerContainer = document.getElementById("controllerContainer")!;
const sessionCard = document.getElementById("sessionCard")!;
const tableNote = document.getElementById("tableNote")!;
const tableNoteTitle = document.getElementById("tableNoteTitle")!;
const tableNoteCopy = document.getElementById("tableNoteCopy")!;
const reactionBar = document.getElementById("reactionBar")!;
const reactionHint = document.getElementById("reactionHint")!;
const leaveBtn = document.getElementById("leaveBtn") as HTMLButtonElement;

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
      const me = msg.payload.roomState.players.find((p) => p.id === playerId);
      const seatName = me?.name ?? nameInput.value.trim() ?? "Player";
      myPresence = me?.presence ?? "active";
      mySpectator = me?.spectator === true;
      // Persist so a refresh or network drop can rejoin this room.
      try {
        localStorage.setItem("tbrn_rejoin_token", rejoinToken);
        localStorage.setItem("tbrn_room_id", roomId);
        localStorage.setItem("tbrn_player_name", seatName);
      } catch (e) {
        console.warn("[Controller] Could not persist rejoin token", e);
      }
      playerNameEl.textContent = seatName;
      applySeatBadge(me?.seat);
      connDot.className = "dot on";
      inGame = false;
      sessionPayload = null;
      joinForm.classList.add("hidden");
      controllerArea.classList.remove("hidden");
      idle.classList.remove("hidden");
      statusEl.textContent = "Waiting for the host to start…";
      coach.classList.remove("your-turn");
      renderSeatState(false);
      break;
    }
    case MESSAGE_TYPES.ROOM_STATE:
      roomStatus = msg.payload.status;
      applySeatBadge(msg.payload.players.find((p) => p.id === playerId)?.seat);
      {
        const me = msg.payload.players.find((p) => p.id === playerId);
        myPresence = me?.presence ?? (me?.connected === false ? "away" : "active");
        mySpectator = me?.spectator === true;
      }
      if (msg.payload.status !== "playing") {
        document.getElementById("howTo")?.classList.add("hidden");
      }
      inGame = msg.payload.status === "playing" && !!msg.payload.gameId;
      if (msg.payload.status === "playing" && msg.payload.gameId) {
        statusEl.textContent = mySpectator ? "Spectating this game" : gameName ? `Playing ${gameName}` : "Game in progress";
        sessionCard.classList.add("hidden");
      } else {
        // Back in the lobby (game over or not started yet).
        gameName = "";
        gameLabel.textContent = "";
        controllerContainer.innerHTML = "";
        idle.classList.remove("hidden");
        lastSignature = "";
        currentControllerType = "one-button";
        currentLayout = getLayout(currentControllerType);
        statusEl.textContent = myPresence === "left" ? "You left the table" : "Waiting for the host to start…";
        coach.classList.remove("your-turn");
        renderSessionCard();
      }
      renderSeatState(inGame);
      break;
    case MESSAGE_TYPES.GAME_STATE: {
      const payload = msg.payload as {
        screen: unknown;
        controller: Record<string, unknown> | null;
        gameName?: string;
        howTo?: string;
      };
      const howToEl = document.getElementById("howTo");
      if (howToEl && typeof payload.howTo === "string" && payload.howTo) {
        howToEl.textContent = payload.howTo;
        howToEl.classList.remove("hidden");
      }
      const controller = payload.controller ?? {};
      // The server returns the room to the lobby before it sends the final
      // frame of a finished game. Do not re-enter the game view on that frame.
      const screenFinished =
        !!payload.screen && typeof payload.screen === "object" &&
        (payload.screen as { finished?: unknown }).finished === true;
      if (roomStatus === "lobby" && (controller.finished === true || screenFinished)) {
        break;
      }
      if (payload.gameName) {
        gameName = payload.gameName;
      }
      if (myPresence === "left") {
        statusEl.textContent = "You left the table";
        renderSeatState(true);
        break;
      }
      // Spectators receive the TV state and an inert controller: never build a
      // playable view for them.
      if (controller.spectator === true || mySpectator) {
        inGame = true;
        gameLabel.textContent = gameName;
        statusEl.textContent = gameName ? `Watching ${gameName}` : "Spectating";
        coach.classList.remove("your-turn");
        sessionCard.classList.add("hidden");
        renderSeatState(true);
        break;
      }
      hideTableNote();
      controllerContainer.classList.remove("hidden");
      gameLabel.textContent = gameName;
      inGame = true;
      sessionCard.classList.add("hidden");
      idle.classList.add("hidden");
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
      renderSeatState(true);
      break;
    }
    case MESSAGE_TYPES.SESSION: {
      const payload = msg.payload as unknown as {
        session: SessionView | null;
        yourVote: string | null;
        canVote: boolean;
        yourPoints: number;
      };
      sessionPayload = payload;
      renderSessionCard();
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
            : code === "SESSION_IN_PROGRESS"
              ? "A Royal Rumble is running. Wait for it to finish."
              : code === "REACTION_RATE_LIMITED"
                ? "Easy — one reaction every couple of seconds."
                : `${message}`;
      statusEl.textContent = friendly;
      if (code === "REACTION_RATE_LIMITED") {
        // The server is the clock of record; align the phone's buttons to it.
        reactionReadyAt = Date.now() + REACTION_COOLDOWN_MS;
        renderReactionBar();
      }
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

/** Show this phone's seat colour and shape next to its name. */
function applySeatBadge(seat: SeatIdentity | undefined | null): void {
  if (!seat) {
    seatBadgeEl.classList.add("hidden");
    seatBadgeEl.textContent = "";
    seatBadgeEl.removeAttribute("style");
    seatBadgeEl.removeAttribute("title");
    return;
  }
  seatBadgeEl.classList.remove("hidden");
  seatBadgeEl.textContent = seat.emoji;
  seatBadgeEl.style.background = seat.color;
  seatBadgeEl.title = `Seat ${seat.index + 1}: ${seat.shape}`;
}

// --- Presence, spectating and reactions ---

function showTableNote(title: string, copy: string): void {
  tableNoteTitle.textContent = title;
  tableNoteCopy.textContent = copy;
  tableNote.classList.remove("hidden");
}

function hideTableNote(): void {
  tableNote.classList.add("hidden");
  tableNoteTitle.textContent = "";
  tableNoteCopy.textContent = "";
}

/**
 * Render this phone's seat status: normal player controls, a spectator note
 * during someone else's game, or the left state. The reaction bar stays for
 * spectators and disappears for a player who left.
 */
function renderSeatState(playing: boolean): void {
  const left = myPresence === "left";
  const spectating = !left && mySpectator && playing;

  if (left) {
    idle.classList.add("hidden");
    controllerContainer.classList.add("hidden");
    sessionCard.classList.add("hidden");
    showTableNote("You left the table", "Your score stays on the board. Rejoin from the laptop to play again.");
  } else if (spectating) {
    idle.classList.add("hidden");
    controllerContainer.classList.add("hidden");
    sessionCard.classList.add("hidden");
    showTableNote("Spectating", "The game is in progress. You're in the next one — react below.");
  } else {
    hideTableNote();
    if (!playing) controllerContainer.classList.remove("hidden");
  }

  const canReact = !!playerId && !left;
  reactionBar.classList.toggle("hidden", !canReact);
  reactionHint.classList.toggle("hidden", !canReact);
  leaveBtn.classList.toggle("hidden", !playerId || left);
  if (canReact) renderReactionBar();
}

function setupReactions(): void {
  reactionBar.innerHTML = REACTIONS.map(
    (reaction) => `<button class="reaction-btn" type="button" data-reaction="${reaction.id}" aria-label="${escapeHtml(reaction.label)}" title="${escapeHtml(reaction.label)}">${reaction.emoji}</button>`,
  ).join("");
  reactionBar.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button[data-reaction]") as HTMLButtonElement | null;
    if (!button) return;
    sendReaction(button.dataset.reaction as ReactionId);
  });
  renderReactionBar();
}

function sendReaction(id: ReactionId): void {
  if (!playerId || !ws || ws.readyState !== WebSocket.OPEN) return;
  if (Date.now() < reactionReadyAt) return;
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.REACTION,
    roomId,
    playerId,
    timestamp: Date.now(),
    payload: { id },
  };
  ws.send(JSON.stringify(msg));
  reactionReadyAt = Date.now() + REACTION_COOLDOWN_MS;
  renderReactionBar();
}

/** Disable the bar and show the same two-second cooldown the server enforces. */
function renderReactionBar(): void {
  const remaining = reactionReadyAt - Date.now();
  const cooling = remaining > 0;
  for (const button of reactionBar.querySelectorAll<HTMLButtonElement>("button[data-reaction]")) {
    button.disabled = cooling;
  }
  reactionHint.textContent = cooling
    ? `Next reaction in ${(remaining / 1000).toFixed(1)}s`
    : "Tap to react on the big screen";
  if (cooling && !reactionTicker) {
    reactionTicker = setInterval(() => {
      if (Date.now() >= reactionReadyAt) {
        if (reactionTicker) clearInterval(reactionTicker);
        reactionTicker = null;
      }
      renderReactionBar();
    }, 100);
  }
}

leaveBtn.addEventListener("click", () => {
  if (!playerId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.LEAVE,
    roomId,
    playerId,
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(msg));
  myPresence = "left";
  statusEl.textContent = "You left the table";
  renderSeatState(inGame);
});

/** Royal Rumble card: voting, live points, or the final trophy board. */
function renderSessionCard(): void {
  const payload = sessionPayload;
  if (!payload?.session || inGame || payload.session.status === "playing") {
    sessionCard.classList.add("hidden");
    sessionCard.innerHTML = "";
    if (!inGame) idle.classList.remove("hidden");
    return;
  }

  const session = payload.session;
  sessionCard.classList.remove("hidden");
  idle.classList.add("hidden");
  const esc = escapeHtml;
  const parts: string[] = [];

  if (session.status === "finished") {
    const standings = session.standings;
    const me = standings.findIndex((s) => s.playerId === playerId);
    parts.push(`
      <div class="session-head">
        <span class="session-kicker">Royal Rumble</span>
        <span class="session-round">Final</span>
      </div>
      <div class="session-champion">
        <span class="session-kicker">Champion</span>
        <strong>${esc(session.champion?.name ?? "No champion")}</strong>
        <span class="pts">${session.champion ? `${session.champion.points} points` : ""}</span>
        ${me >= 0 ? `<span class="session-copy">You finished #${me + 1} with ${standings[me].points} points.</span>` : ""}
      </div>
      <div class="session-trophies">
        ${session.trophies.map((t) => `
          <div class="trophy-row">
            <span class="t">${esc(t.name)}</span>
            <span class="p">${esc(t.playerName)}</span>
            <span class="d">${esc(t.detail)}</span>
          </div>
        `).join("")}
      </div>
    `);
  } else {
    const leader = session.leadingGameId
      ? session.candidates.find((g) => g.id === session.leadingGameId) ?? null
      : null;
    const maxVotes = Math.max(1, ...session.votes.map((v) => v.count));

    let voteBody = "";
    if (session.selection === "vote") {
      const rows = session.votes.map((candidate) => {
        const yours = payload.yourVote === candidate.gameId;
        const leading = candidate.gameId === session.leadingGameId && candidate.count > 0;
        return `
          <button class="vote-btn${leading ? " leading" : ""}${yours ? " yours" : ""}"
                  type="button" data-vote="${esc(candidate.gameId)}"${payload.canVote ? "" : " disabled"}>
            <span class="vote-top">
              <span class="vote-name">${esc(candidate.name)}</span>
              <span class="vote-count">${yours ? "your vote" : `${candidate.count}`}</span>
            </span>
            <span class="vote-bar"><i style="width:${Math.round((candidate.count / maxVotes) * 100)}%"></i></span>
          </button>
        `;
      }).join("");
      voteBody = `<div class="vote-list">${rows}</div>`;
    }

    const votedName = payload.yourVote
      ? session.candidates.find((g) => g.id === payload.yourVote)?.name ?? "that game"
      : null;
    const copy =
      session.selection === "random"
        ? `The wheel picks each round.${leader ? ` Next up: ${esc(leader.name)}.` : ""}`
        : payload.yourVote
          ? `You voted ${esc(votedName)}. Waiting for the host.`
          : payload.canVote
            ? "Tap a game to vote. One vote each round."
            : "Voting is closed. Waiting for the host.";

    parts.push(`
      <div class="session-head">
        <span class="session-kicker">Royal Rumble</span>
        <span class="session-round">Round ${Math.min(session.round, session.length)} of ${session.length}</span>
      </div>
      <div class="session-points">
        <strong>${payload.yourPoints}</strong>
        <span>points so far</span>
      </div>
      <p class="session-copy">${copy}</p>
      ${voteBody}
    `);
  }

  sessionCard.innerHTML = parts.join("");
  for (const button of sessionCard.querySelectorAll<HTMLButtonElement>("button[data-vote]")) {
    button.addEventListener("click", () => {
      const gameId = button.dataset.vote;
      if (gameId) sendSessionVote(gameId);
    });
  }
}

function sendSessionVote(gameId: string): void {
  if (!playerId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = {
    type: MESSAGE_TYPES.SESSION_VOTE,
    roomId,
    playerId,
    timestamp: Date.now(),
    payload: { gameId },
  };
  ws.send(JSON.stringify(msg));
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  if (controller.hasVoted === true) {
    return controller.canChangeVote === true
      ? "Vote cast — tap another to change it"
      : "Vote locked in — waiting for others…";
  }
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

setupReactions();

if (!roomId) {
  codeInput.focus();
} else if (linkedFromQr) {
  nameInput.focus();
}

connect();
