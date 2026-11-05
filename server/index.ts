import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomInt } from "node:crypto";
import { join, normalize } from "node:path";
import { readFileSync } from "node:fs";
import {
  getLanUrls,
  ROOM_CODE_CHARS,
  ROOM_CODE_LENGTH,
  REJOIN_TOKEN_BYTES,
  PING_INTERVAL_MS,
  PLAYER_TIMEOUT_MS,
  DROPOUT_PAUSE_MS,
  MESSAGE_TYPES,
} from "../shared/constants.js";
import type {
  ClientMessage,
  ServerMessage,
  RoomState,
  Player,
  PlayerPresence,
  GameInstance,
  GamePlugin,
  GameManifest,
  SessionVoteMessage,
  ReactionMessage,
} from "../shared/types.ts";
import type { PluginLoader } from "./plugins.ts";
import { catalogEntry, isGameEnabled } from "../shared/game-catalog.ts";
import { seatForIndex, type SeatIdentity } from "../shared/seat-identity.ts";
import { sanitisePlayerName, uniquePlayerName } from "../shared/player-name.ts";
import { isReaction, reactionById, REACTION_COOLDOWN_MS } from "../shared/reactions.ts";
import {
  createSession,
  sessionView,
  recordVote,
  startRound,
  abortRound,
  completeRound,
  quizAccuracy,
  type SessionState,
} from "./session.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_ROOMS = 100; // Prevent unbounded room creation
const MAX_PLAYERS_PER_ROOM = 8; // Platform seat ceiling; games keep their own maxPlayers

// --- In-memory stores ---
const rooms = new Map<string, RoomState<any>>();
const plugins = new Map<string, GamePlugin<any, any, any, any>>();
const playerSockets = new Map<string, WebSocket>(); // playerId -> ws
const socketPlayers = new Map<WebSocket, string>(); // ws -> playerId
const playerRooms = new Map<string, string>(); // playerId -> roomId (for O(1) lookup)
const gameLoops = new Map<string, NodeJS.Timeout>(); // roomId -> interval
const roomScreens = new Map<string, Set<WebSocket>>(); // roomId -> screen sockets
const screenRooms = new Map<WebSocket, string>(); // screen ws -> roomId
const roomHostTokens = new Map<string, string>(); // roomId -> host (screen) token
const roomSessions = new Map<string, SessionState>(); // roomId -> Royal Rumble session
const lastReactionAt = new Map<string, number>(); // playerId -> server-clock ms

/** Host token for a room; created on first screen join, reused afterwards. */
function hostTokenFor(roomId: string): string {
  let token = roomHostTokens.get(roomId);
  if (!token) {
    token = randomBytes(16).toString("hex");
    roomHostTokens.set(roomId, token);
  }
  return token;
}

// --- Helpers ---
function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[randomInt(0, ROOM_CODE_CHARS.length)];
  }
  return code;
}

function generateRejoinToken(): string {
  return randomBytes(REJOIN_TOKEN_BYTES).toString("hex");
}

function generatePlayerId(): string {
  return randomBytes(8).toString("hex");
}

function findRoomByPlayerId(playerId: string): RoomState | undefined {
  const roomId = playerRooms.get(playerId);
  if (roomId) return rooms.get(roomId);
  return undefined;
}

function broadcast(room: RoomState, message: ServerMessage, excludePlayerId?: string): void {
  const data = JSON.stringify(message);
  for (const player of room.players) {
    if (player.id === excludePlayerId) continue;
    const ws = playerSockets.get(player.id);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
  // The laptop screen is a spectator: it receives room messages too.
  const screens = roomScreens.get(room.id);
  if (screens) {
    for (const ws of screens) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

/**
 * User-facing game name: the catalog's displayName when it has one, otherwise
 * the manifest name. Everything sent to the TV or a phone uses this.
 */
function gameDisplayName(manifest: GameManifest): string {
  return manifest.displayName ?? manifest.name;
}

/**
 * Send the public screen state to the laptop screen sockets of a room.
 * Screens never receive controller (private) state.
 */
function sendScreenGameState(room: RoomState, plugin: GamePlugin, screen: unknown): void {
  const screens = roomScreens.get(room.id);
  if (!screens) return;
  for (const ws of screens) {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, {
        type: MESSAGE_TYPES.GAME_STATE,
        roomId: room.id,
        timestamp: Date.now(),
        payload: { screen: withSeatIdentity(room, screen), controller: null, gameId: room.gameId, gameName: gameDisplayName(plugin.manifest) },
      });
    }
  }
}

// --- Royal Rumble session transport ---
function sessionMessage(room: RoomState, viewerId: string): ServerMessage {
  const session = roomSessions.get(room.id) ?? null;
  const yourVote = viewerId && session ? session.votes[viewerId] ?? null : null;
  const canVote =
    !!viewerId &&
    !!session &&
    session.status === "voting" &&
    session.selection === "vote" &&
    session.candidates.length > 0 &&
    !yourVote;
  const yourPoints = viewerId && session ? session.stats[viewerId]?.points ?? 0 : 0;
  return {
    type: MESSAGE_TYPES.SESSION,
    roomId: room.id,
    playerId: viewerId || undefined,
    timestamp: Date.now(),
    payload: {
      session: session ? sessionView(session) : null,
      yourVote,
      canVote,
      yourPoints,
    },
  };
}

function broadcastSession(room: RoomState): void {
  const screens = roomScreens.get(room.id);
  if (screens) {
    const data = JSON.stringify(sessionMessage(room, ""));
    for (const ws of screens) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
  for (const player of room.players) {
    const ws = playerSockets.get(player.id);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(sessionMessage(room, player.id)));
    }
  }
}

/** True when the request carries the host token for this room (screen or first phone). */
function requireHost(req: IncomingMessage, res: ServerResponse, room: RoomState): boolean {
  const screens = roomScreens.get(room.id);
  if (!screens || screens.size === 0) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_HOST_SCREEN", message: "No host screen connected to this room" }));
    return false;
  }
  const provided = String(req.headers["x-host-token"] ?? "");
  const expected = roomHostTokens.get(room.id) ?? "";
  if (!expected || provided !== expected) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "HOST_AUTH_REQUIRED", message: "Request must come from the host screen or host phone" }));
    return false;
  }
  return true;
}

function readJsonBody(req: IncomingMessage, limit = 8192): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
      if (body.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) as Record<string, unknown> : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Attach platform identity (seat, presence) to the player-shaped arrays inside
 * a game payload.
 *
 * Games build their own screen/controller states, and most copy just a name or
 * id per player. Rather than editing every game, enrich the platform-owned
 * collections at the socket boundary. Unknown entries are left untouched, so
 * the existing payload shape keeps working.
 */
function withSeatIdentity(room: RoomState, payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  interface Identity {
    seat: SeatIdentity;
    presence: PlayerPresence;
  }
  const byId = new Map<string, Identity>();
  const byName = new Map<string, Identity>();
  room.players.forEach((player, index) => {
    const identity: Identity = {
      seat: player.seat ?? seatForIndex(index),
      presence: player.presence ?? "active",
    };
    byId.set(player.id, identity);
    byName.set(player.name, identity);
  });

  const source = payload as Record<string, unknown>;
  let result: Record<string, unknown> | null = null;

  for (const key of ["players", "scores", "racers", "standings"]) {
    const collection = source[key];
    if (!Array.isArray(collection)) continue;

    let changed = false;
    const enriched = collection.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const record = entry as Record<string, unknown>;

      const identity =
        (typeof record.playerId === "string" ? byId.get(record.playerId) : undefined) ??
        (typeof record.id === "string" ? byId.get(record.id) : undefined) ??
        (typeof record.name === "string" ? byName.get(record.name) : undefined);
      if (!identity) return entry;

      const needsSeat = !record.seat;
      const needsPresence = record.presence === undefined;
      if (!needsSeat && !needsPresence) return entry;

      changed = true;
      return {
        ...record,
        ...(needsSeat ? { seat: identity.seat } : {}),
        ...(needsPresence ? { presence: identity.presence } : {}),
      };
    });

    if (changed) {
      result ??= { ...source };
      result[key] = enriched;
    }
  }

  return result ?? payload;
}

/**
 * Per-player game state message, including the public game identity.
 * A game may set its own `controllerType` in the controller state to switch
 * layouts mid-game (e.g. text input while writing, choice while voting);
 * otherwise the manifest type is used.
 */
function gameStateMessage(
  room: RoomState,
  plugin: GamePlugin,
  playerId: string,
  screen: unknown,
  controller: unknown,
): ServerMessage {
  let payloadController: unknown;
  if (controller && typeof controller === "object") {
    const c = controller as Record<string, unknown>;
    payloadController =
      typeof c.controllerType === "string" && c.controllerType.length > 0
        ? controller
        : { ...controller, controllerType: plugin.manifest.controllerType };
  } else {
    payloadController = { controllerType: plugin.manifest.controllerType };
  }
  return {
    type: MESSAGE_TYPES.GAME_STATE,
    roomId: room.id,
    playerId,
    timestamp: Date.now(),
    payload: {
      screen: withSeatIdentity(room, screen),
      controller: withSeatIdentity(room, payloadController),
      gameId: room.gameId,
      gameName: gameDisplayName(plugin.manifest),
      howTo: (plugin.manifest as { howTo?: string }).howTo,
    },
  };
}

/**
 * Controller payload for one phone.
 *
 * Spectators and players who left never get a playable controller: the game
 * instance does not contain them, so a real controller would be meaningless
 * and could leak state. They get an inert payload instead.
 */
function controllerStateFor(plugin: GamePlugin<any, any, any, any>, instance: unknown, player: Player): unknown {
  if (player.spectator) return { spectator: true };
  if (player.presence === "left") return { spectator: true, presence: "left" };
  return plugin.controllerState(instance as GameInstance<Record<string, unknown>>, player.id);
}

/** Send one current game frame to a specific phone. */
function sendGameStateTo(
  room: RoomState,
  plugin: GamePlugin<any, any, any, any>,
  player: Player,
  instance: unknown,
  screen: unknown,
): void {
  const ws = playerSockets.get(player.id);
  if (ws?.readyState !== WebSocket.OPEN) return;
  let controller: unknown;
  try {
    controller = controllerStateFor(plugin, instance, player);
  } catch (e) {
    console.error("[Server] Plugin controllerState error:", e);
    return;
  }
  send(ws, gameStateMessage(room, plugin, player.id, screen, controller));
}

/** Send the current game frame to a phone that has just (re)joined. */
function sendCurrentGameFrame(room: RoomState, player: Player): void {
  const plugin = room.gameId ? plugins.get(room.gameId) : undefined;
  const instance = room.gameState;
  if (!plugin || !instance) return;
  try {
    const screen = plugin.screenState(instance as { roomId: string; players: Player[]; state: unknown });
    sendGameStateTo(room, plugin, player, instance, screen);
  } catch (e) {
    console.error("[Server] Plugin screenState error:", e);
  }
}

/**
 * Room copy with the live game instance stripped out.
 * room.gameState contains private per-player data (hole cards, boards,
 * secret characters) and must never be sent to clients.
 */
function publicRoom(room: RoomState): RoomState {
  return { ...room, gameState: null };
}

/**
 * Clear spectator flags when a room returns to the lobby. A phone that joined
 * mid-game gets a normal seat for the next game.
 */
function promoteSpectators(room: RoomState): void {
  for (const player of room.players) {
    if (player.spectator) delete player.spectator;
  }
}

/** Broadcast the public room state (pause included) to phones and the TV. */
function broadcastRoomState(room: RoomState): void {
  broadcast(room, {
    type: MESSAGE_TYPES.ROOM_STATE,
    roomId: room.id,
    timestamp: Date.now(),
    payload: publicRoom(room),
  });
}

/** Connected players who actually hold a playable seat in the running game. */
function connectedParticipantCount(room: RoomState): number {
  return room.players.filter((p) => p.connected && !p.spectator).length;
}

/**
 * Start or clear the below-minimum pause for a running game.
 *
 * The pause starts once and is never extended here: only the host's Wait
 * button moves the deadline. Enough players reconnecting clear it at once.
 * After the deadline the pause stays put, so the host offer also stays up.
 */
function updatePause(room: RoomState, minPlayers: number, now: number): void {
  const belowMinimum = connectedParticipantCount(room) < minPlayers;
  if (belowMinimum && !room.pause) {
    room.pause = { reason: "players", startedAt: now, until: now + DROPOUT_PAUSE_MS };
    broadcastRoomState(room);
    return;
  }
  if (!belowMinimum && room.pause) {
    room.pause = null;
    broadcastRoomState(room);
  }
}

// --- Plugin loader ---
let pluginLoader: PluginLoader;

async function loadPlugins(): Promise<void> {
  const { createPluginLoader } = await import("./plugins.ts");
  pluginLoader = await createPluginLoader(join(process.cwd(), "games"));
  const loaded = pluginLoader.loadAll();

  // manifest.json is the source of truth for metadata (howTo, copy, limits).
  // Merge it over the module's inline manifest so the two cannot drift.
  for (const [id, plugin] of loaded) {
    try {
      const raw = readFileSync(join(process.cwd(), "games", id, "manifest.json"), "utf8");
      const meta = JSON.parse(raw) as Partial<GameManifest>;
      plugin.manifest = { ...plugin.manifest, ...meta, id: plugin.manifest.id };
    } catch {
      /* manifest.json is optional; the inline manifest still works */
    }

    // The catalog supplies the platform fields; JSON still owns id/name/limits
    // and the copy. New fields are optional on GameManifest so an unlisted game
    // still loads (and stays hidden, because isGameEnabled() defaults to false).
    const entry = catalogEntry(id);
    if (entry) {
      plugin.manifest = {
        ...plugin.manifest,
        displayName: entry.displayName,
        enabled: entry.enabled,
        kind: entry.kind,
        idealMin: entry.idealMin,
        idealMax: entry.idealMax,
        minutes: { ...entry.minutes },
        dropoutPolicy: entry.dropoutPolicy,
        contentPacks: [...entry.contentPacks],
        scale: entry.scale,
      };
    }
    plugins.set(id, plugin);
  }

  // Fallback: keep tap-counter if no plugins loaded
  if (plugins.size === 0) {
    const dummyManifest: GameManifest = {
      id: "tap-counter",
      name: "Tap Counter",
      minPlayers: 1,
      maxPlayers: 4,
      controllerType: "one-button",
      description: "Tap as fast as you can",
    };

    const dummyPlugin: GamePlugin = {
      manifest: dummyManifest,
      onStart(room, players) {
        return { roomId: room.id, players, state: { taps: new Map<string, number>() } };
      },
      onInput(instance, playerId, input) {
        if (input && typeof input === "object" && "tap" in input) {
          const taps = (instance.state as { taps: Map<string, number> }).taps;
          taps.set(playerId, (taps.get(playerId) ?? 0) + 1);
        }
      },
      onTick(_instance, _deltaMs) {},
      screenState(instance) {
        const taps = (instance.state as { taps: Map<string, number> }).taps;
        return { players: instance.players.map((p) => ({ name: p.name, taps: taps.get(p.id) ?? 0 })) };
      },
      controllerState(instance, playerId) {
        const taps = (instance.state as { taps: Map<string, number> }).taps;
        return { yourTaps: taps.get(playerId) ?? 0 };
      },
    };

    plugins.set(dummyManifest.id, dummyPlugin);
  }
}

// --- HTTP(S) server for static files + health ---
// Optional TLS: set TLS_CERT and TLS_KEY to run HTTPS/WSS (needed for some PWA
// features). Without both, the server runs plain HTTP on the LAN as before.
const tlsCertPath = process.env.TLS_CERT;
const tlsKeyPath = process.env.TLS_KEY;
let tlsOptions: { key: Buffer; cert: Buffer } | null = null;
if (tlsCertPath && tlsKeyPath) {
  try {
    tlsOptions = { key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath) };
  } catch (e) {
    console.error("[Server] Could not read TLS_CERT/TLS_KEY; falling back to HTTP", e);
  }
} else if (tlsCertPath || tlsKeyPath) {
  console.warn("[Server] Set both TLS_CERT and TLS_KEY for HTTPS; falling back to HTTP");
}
const SCHEME = tlsOptions ? "https" : "http";

const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }

  if (url.pathname === "/api/lan-urls") {
    const urls = await getLanUrls(PORT, SCHEME);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ urls }));
    return;
  }

  // Public list of enabled games (manifests only). Disabled games stay in the
  // tree but are not offered to the lobby or the Rumble.
  if (url.pathname === "/api/games") {
    const games = [...plugins.values()]
      .filter((p) => isGameEnabled(p.manifest.id))
      .map((p) => p.manifest);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ games }));
    return;
  }

  // Generate QR code locally (no external API)
  if (url.pathname === "/api/qr") {
    const data = url.searchParams.get("data");
    if (!data) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "MISSING_DATA", message: "Missing 'data' query parameter" }));
      return;
    }
    try {
      const QRCode = await import("qrcode");
      const pngBuffer = await QRCode.toBuffer(data, {
        width: 256,
        margin: 1,
        color: { dark: "#0F172A", light: "#F8FAFC" },
      });
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(pngBuffer);
    } catch (e) {
      console.error("[Server] QR generation failed:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "QR_FAILED", message: "QR code generation failed" }));
    }
    return;
  }

  // Handle Royal Rumble session control (host-token protected)
  if (await handleSessionStart(req, res, url)) {
    return;
  }
  if (handleSessionEnd(req, res, url)) {
    return;
  }
  if (handlePause(req, res, url)) {
    return;
  }
  if (handleResume(req, res, url)) {
    return;
  }
  if (handleEndGame(req, res, url)) {
    return;
  }

  // Handle start game
  if (handleStartGame(req, res, url)) {
    return;
  }

  // Serve static client files (screen + controller), shared browser modules
  // and per-game screen modules. TypeScript sources are stripped on the fly
  // so the browser can run them without a build step.
  if (serveStatic(url.pathname, res)) {
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
};

const httpServer = tlsOptions
  ? createHttpsServer(tlsOptions, requestHandler)
  : createServer(requestHandler);

/**
 * Serve a client/shared/game module to the browser.
 * Returns true when the request was handled.
 */
function serveStatic(pathname: string, res: ServerResponse): boolean {
  let rel = "";
  if (pathname === "/favicon.ico") {
    rel = "client/assets/favicon.svg";
  } else if (pathname === "/" || pathname === "/screen" || pathname === "/screen/") {
    rel = "client/screen/index.html";
  } else if (pathname.startsWith("/screen/")) {
    rel = "client/screen/" + pathname.slice("/screen/".length);
  } else if (pathname === "/controller" || pathname === "/controller/") {
    rel = "client/controller/index.html";
  } else if (pathname.startsWith("/controller/")) {
    rel = "client/controller/" + pathname.slice("/controller/".length);
  } else if (pathname.startsWith("/shared/")) {
    rel = "shared/" + pathname.slice("/shared/".length);
  } else if (pathname.startsWith("/games/")) {
    rel = "games/" + pathname.slice("/games/".length);
  } else if (pathname.startsWith("/client/")) {
    // Browser-side modules (screen renderers import the shared kit from here).
    rel = pathname.slice(1);
  } else if (pathname.startsWith("/assets/")) {
    rel = "client/assets/" + pathname.slice("/assets/".length);
  } else {
    return false;
  }

  // Reject traversal before join() has a chance to normalize it away.
  if (rel.includes("..") || rel.includes("\0")) {
    return false;
  }

  const cwd = process.cwd();
  const full = join(cwd, rel);
  if (!normalize(full).startsWith(cwd)) {
    return false;
  }

  try {
    const content = readFileSync(full);
    const ext = full.split(".").pop()?.toLowerCase();
    let body: string | Buffer = content;
    let mime = "application/octet-stream";

    if (ext === "ts") {
      body = stripTypeScriptTypes(content.toString("utf8"), { mode: "strip" });
      mime = "application/javascript; charset=utf-8";
    } else if (ext === "js" || ext === "mjs") {
      mime = "application/javascript; charset=utf-8";
    } else if (ext === "html") {
      mime = "text/html; charset=utf-8";
    } else if (ext === "css") {
      mime = "text/css; charset=utf-8";
    } else if (ext === "json") {
      mime = "application/json; charset=utf-8";
    } else if (ext === "svg") {
      mime = "image/svg+xml";
    }

    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(body);
    return true;
  } catch {
    return false; // fall through to 404
  }
}

// --- WebSocket server ---
const wss = new WebSocketServer({ server: httpServer });

// --- Rate limiting ---
// Two buckets per client:
//   * per connection: 50 msg/s (protects gameplay throughput)
//   * per IP:        200 msg/s, kept across reconnects so a reconnect cannot
//                    reset the counter (protects against floods)
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_PER_CONNECTION = 50;
const RATE_LIMIT_PER_IP = 200;
const RATE_LIMIT_IP_TTL_MS = 60_000;
const ipMessageCounts = new Map<string, { count: number; windowStart: number }>();

function hitRateBucket(
  bucket: { count: number; windowStart: number },
  max: number,
  now: number,
): { limited: boolean; bucket: { count: number; windowStart: number } } {
  if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    return { limited: false, bucket: { count: 1, windowStart: now } };
  }
  const count = bucket.count + 1;
  return { limited: count > max, bucket: { count, windowStart: bucket.windowStart } };
}

function pruneIpRateLimits(now: number): void {
  if (ipMessageCounts.size < 512) return;
  for (const [ip, bucket] of ipMessageCounts) {
    if (now - bucket.windowStart > RATE_LIMIT_IP_TTL_MS) ipMessageCounts.delete(ip);
  }
}

function getClientIP(ws: WebSocket): string {
  // ws._socket and ws.socket are non-standard properties
  // Use type assertion to access them
  const socket = (ws as any)._socket || (ws as any).socket;
  if (!socket) return "unknown";
  const remoteAddress = socket.remoteAddress || "unknown";
  // Normalize IPv6 mapped IPv4 addresses
  return remoteAddress.replace(/^::ffff:/, "");
}

wss.on("connection", (ws) => {
  const clientIP = getClientIP(ws);
  // Per-connection bucket lives only as long as the socket.
  let connBucket = { count: 0, windowStart: 0 };
  let pingTimer: NodeJS.Timeout;

  const startPing = () => {
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        send(ws, { type: MESSAGE_TYPES.PONG, roomId: "", timestamp: Date.now() });
      } else {
        clearInterval(pingTimer);
      }
    }, PING_INTERVAL_MS);
  };

  ws.on("message", (data) => {
    const now = Date.now();

    const connResult = hitRateBucket(connBucket, RATE_LIMIT_PER_CONNECTION, now);
    connBucket = connResult.bucket;
    if (connResult.limited) {
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId: "", timestamp: Date.now(), payload: { code: "RATE_LIMITED", message: "Too many messages, slow down" } });
      ws.close(1009, "Rate limited");
      return;
    }

    const ipResult = hitRateBucket(
      ipMessageCounts.get(clientIP) ?? { count: 0, windowStart: now },
      RATE_LIMIT_PER_IP,
      now,
    );
    ipMessageCounts.set(clientIP, ipResult.bucket);
    pruneIpRateLimits(now);
    if (ipResult.limited) {
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId: "", timestamp: Date.now(), payload: { code: "RATE_LIMITED", message: "Too many messages from this network" } });
      ws.close(1009, "Rate limited");
      return;
    }

    try {
      const raw = data.toString();
      const msg = JSON.parse(raw) as ClientMessage;

      switch (msg.type) {
        case MESSAGE_TYPES.JOIN:
          handleJoin(ws, msg);
          break;
        case MESSAGE_TYPES.LEAVE:
          handleLeave(ws, msg);
          break;
        case MESSAGE_TYPES.INPUT:
          handleInput(ws, msg);
          break;
        case MESSAGE_TYPES.SESSION_VOTE:
          handleSessionVote(ws, msg as SessionVoteMessage);
          break;
        case MESSAGE_TYPES.REACTION:
          handleReaction(ws, msg as ReactionMessage);
          break;
        case MESSAGE_TYPES.PING:
          send(ws, { type: MESSAGE_TYPES.PONG, roomId: msg.roomId, timestamp: Date.now() });
          break;
        default: {
          // Every known ClientMessage variant is handled above, so msg is
          // narrowed to never here; recover the envelope for the reply.
          const badMsg = msg as ClientMessage;
          send(ws, { type: MESSAGE_TYPES.ERROR, roomId: badMsg.roomId, timestamp: Date.now(), payload: { code: "UNKNOWN_MESSAGE", message: `Unknown message type: ${String(badMsg.type)}` } });
        }
      }
    } catch (e) {
      console.error("[Server] Parse error:", e, "raw:", data.toString());
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId: "", timestamp: Date.now(), payload: { code: "PARSE_ERROR", message: "Invalid JSON" } });
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });
  ws.on("error", () => {
    handleDisconnect(ws);
  });

  startPing();
});

/**
 * Lowest free seat index. Seats are assigned on join and stay with the player
 * until they are reaped, so a player's colour and shape never swap mid-game.
 */
function nextSeatIndex(room: RoomState): number {
  const taken = new Set<number>();
  for (const player of room.players) {
    if (typeof player.seat?.index === "number") taken.add(player.seat.index);
  }
  for (let index = 0; index < MAX_PLAYERS_PER_ROOM; index++) {
    if (!taken.has(index)) return index;
  }
  return 0;
}

function handleJoin(ws: WebSocket, msg: ClientMessage & { type: "join" }): void {
  const { roomId: initialRoomId, payload } = msg;
  let roomId = initialRoomId;
  const { name, rejoinToken } = payload;

  // Trim, then cap at 12 characters. Empty names and control characters take
  // the existing INVALID_NAME path; long names are truncated, not rejected.
  const rawName = typeof name === "string" ? name : "";
  const cleanedName = sanitisePlayerName(rawName);
  if (cleanedName === null) {
    send(ws, {
      type: MESSAGE_TYPES.ERROR,
      roomId: roomId ?? "",
      timestamp: Date.now(),
      payload: {
        code: "INVALID_NAME",
        message: rawName.trim().length === 0 ? "Name is required" : "Name contains invalid characters",
      },
    });
    return;
  }

  // The laptop screen joins as a spectator: it owns the room but does not
  // occupy one of the player seats and never receives controller state.
  if (payload.role === "screen") {
    let screenRoom: RoomState | undefined;
    if (roomId && typeof roomId === "string") {
      // Try to find existing room by internal ID or code
      if (/^[a-f0-9]{12}$/.test(roomId)) {
        screenRoom = rooms.get(roomId);
      } else if (/^[A-Z0-9]{5}$/.test(roomId)) {
        for (const r of rooms.values()) {
          if (r.code === roomId) {
            screenRoom = r;
            break;
          }
        }
      }
    }
    if (!screenRoom) {
      // Create new room for screen
      screenRoom = {
        id: randomBytes(6).toString("hex"),
        code: generateRoomCode(),
        hostPlayerId: null,
        players: [],
        gameId: null,
        gameState: null,
        createdAt: Date.now(),
        status: "lobby",
        pause: null,
      };
      rooms.set(screenRoom.id, screenRoom);
    }
    let set = roomScreens.get(screenRoom.id);
    if (!set) {
      set = new Set();
      roomScreens.set(screenRoom.id, set);
    }
    set.add(ws);
    screenRooms.set(ws, screenRoom.id);

    send(ws, {
      type: MESSAGE_TYPES.JOINED,
      roomId: screenRoom.id,
      playerId: "",
      timestamp: Date.now(),
      payload: {
        playerId: "",
        rejoinToken: "",
        roomState: publicRoom(screenRoom),
        hostToken: hostTokenFor(screenRoom.id),
      },
    });
    send(ws, { type: MESSAGE_TYPES.ROOM_STATE, roomId: screenRoom.id, timestamp: Date.now(), payload: publicRoom(screenRoom) });
    send(ws, sessionMessage(screenRoom, ""));
    return;
  }

  // For non-screen players: validate roomId format if provided
  if (roomId && typeof roomId === "string") {
    let targetRoom: RoomState | undefined;
    if (/^[a-f0-9]{12}$/.test(roomId)) {
      // 12-char hex internal room ID
      targetRoom = rooms.get(roomId);
    } else if (/^[A-Z0-9]{5}$/.test(roomId)) {
      // 5-char room code (e.g., "WJA6W")
      for (const r of rooms.values()) {
        if (r.code === roomId) {
          targetRoom = r;
          break;
        }
      }
    }
    if (!targetRoom) {
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId, timestamp: Date.now(), payload: { code: "ROOM_NOT_FOUND", message: "Room not found" } });
      return;
    }
    roomId = targetRoom.id;
  }

  let room: RoomState | undefined;

  if (rejoinToken) {
    // Find room by rejoin token
    for (const r of rooms.values()) {
      const player = r.players.find((p) => p.rejoinToken === rejoinToken);
      if (player) {
        room = r;
        player.connected = true;
        player.presence = "active";
        // Old seats and fixtures may predate seat identity; backfill once.
        if (!player.seat) player.seat = seatForIndex(nextSeatIndex(room));
        playerSockets.set(player.id, ws);
        socketPlayers.set(ws, player.id);
        playerRooms.set(player.id, room.id);

        send(ws, {
          type: MESSAGE_TYPES.JOINED,
          roomId: room.id,
          playerId: player.id,
          timestamp: Date.now(),
          payload: {
            playerId: player.id,
            rejoinToken: player.rejoinToken,
            roomState: publicRoom(room),
            ...(room.hostPlayerId === player.id ? { hostToken: hostTokenFor(room.id) } : {}),
          },
        });
        // Also send ROOM_STATE to the reconnecting player
        send(ws, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) });
        send(ws, sessionMessage(room, player.id));
        // A token rejoin puts a spectator back in the audience, not the game.
        if (room.status === "playing") {
          sendCurrentGameFrame(room, player);
        }
        broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) }, player.id);
        return;
      }
    }
    // The token no longer matches a seat: it was reaped, or the room was
    // recycled between rounds. If the link still names a room, recover by
    // taking a fresh seat instead of locking the phone out for the rest of the
    // night; mid-game that recovery seat is a spectator seat.
    const recoverRoom = roomId ? rooms.get(roomId) : undefined;
    if (!recoverRoom) {
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId, timestamp: Date.now(), payload: { code: "INVALID_TOKEN", message: "Invalid or expired rejoin token" } });
      return;
    }
    room = recoverRoom;
  }

  // New join - find or create room
  if (roomId) {
    room = rooms.get(roomId);
  }

  if (!room) {
    // Enforce max room limit
    if (rooms.size >= MAX_ROOMS) {
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId: roomId ?? "", timestamp: Date.now(), payload: { code: "ROOM_LIMIT", message: "Server at room capacity, try again later" } });
      return;
    }
    // Create new room
    const id = randomBytes(6).toString("hex");
    const code = generateRoomCode();
    room = {
      id,
      code,
      hostPlayerId: null,
      players: [],
      gameId: null,
      gameState: null,
      createdAt: Date.now(),
      status: "lobby",
      pause: null,
    };
    rooms.set(id, room);
  }

  // A rumble has already fixed its roster and score table. A brand-new seat
  // would never be scored, so keep it out until the rumble ends. Reconnects
  // with a rejoin token are handled above and still work. Checked before the
  // spectator path: a mid-Rumble join waits for the Rumble, not for the game.
  const activeSession = roomSessions.get(room.id);
  if (activeSession && activeSession.status !== "finished") {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "SESSION_IN_PROGRESS", message: "Royal Rumble in progress — wait for it to finish" } });
    return;
  }

  // The lobby has eight seats. Game manifests keep their own maxPlayers and
  // are checked at game start, so a small game can still be picked here.
  // Spectators take a real seat, so they count toward this ceiling too.
  if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "ROOM_FULL", message: `Room is full (max ${MAX_PLAYERS_PER_ROOM} players)` } });
    return;
  }

  // A phone that arrives mid-game becomes a spectator: it keeps a seat for the
  // next game, sees the TV state, and cannot affect the running game. Its seat
  // is not part of the game instance, which was sized at start.
  const spectator = room.status === "playing";

  const playerId = generatePlayerId();
  const token = generateRejoinToken();
  const player: Player = {
    id: playerId,
    name: uniquePlayerName(room.players.map((p) => p.name), cleanedName),
    joinedAt: Date.now(),
    rejoinToken: token,
    connected: true,
    presence: "active",
    seat: seatForIndex(nextSeatIndex(room)),
    ...(spectator ? { spectator: true } : {}),
  };

  room.players.push(player);
  const isHostPlayer = !room.hostPlayerId;
  if (isHostPlayer) room.hostPlayerId = playerId;

  playerSockets.set(playerId, ws);
  socketPlayers.set(ws, playerId);
  playerRooms.set(playerId, room.id);

  send(ws, {
    type: MESSAGE_TYPES.JOINED,
    roomId: room.id,
    playerId,
    timestamp: Date.now(),
    payload: {
      playerId,
      rejoinToken: token,
      roomState: publicRoom(room),
      // The first phone is the host: it may drive the same host endpoints as
      // the laptop screen.
      ...(isHostPlayer ? { hostToken: hostTokenFor(room.id) } : {}),
    },
  });
  // Also send ROOM_STATE to the joining player so they have full room state
  send(ws, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) });
  send(ws, sessionMessage(room, playerId));
  if (spectator) sendCurrentGameFrame(room, player);
  broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) }, playerId);
}

/**
 * A player chooses to leave. The room row and this game's score stay; the
 * seat is only dropped by the existing reap path or when the next game starts.
 */
function handleLeave(ws: WebSocket, msg: ClientMessage & { type: "leave" }): void {
  const playerId = socketPlayers.get(ws);
  if (!playerId) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "NOT_JOINED", message: "Not joined to a room" } });
    return;
  }
  // A stale socket from a replaced phone must not change the live seat.
  if (playerSockets.get(playerId) !== ws) return;
  const room = findRoomByPlayerId(playerId);
  if (!room) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "ROOM_NOT_FOUND", message: "Room not found" } });
    return;
  }
  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.presence === "left") return;

  player.presence = "left";
  player.connected = false;
  lastReactionAt.delete(playerId);
  broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) });
  scheduleSeatReap(room, playerId);
}

/**
 * Audience reaction: any active seat may send one allowed id per cooldown.
 * Spectators are active and welcome; away/left players are not.
 */
function handleReaction(ws: WebSocket, msg: ReactionMessage): void {
  const playerId = socketPlayers.get(ws);
  if (!playerId) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "NOT_JOINED", message: "Not joined to a room" } });
    return;
  }
  // A stale socket from a replaced phone must not react for the live seat.
  if (playerSockets.get(playerId) !== ws) return;
  const room = findRoomByPlayerId(playerId);
  if (!room) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "ROOM_NOT_FOUND", message: "Room not found" } });
    return;
  }
  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "NOT_IN_ROOM", message: "You are not at this table" } });
    return;
  }
  const id = msg.payload?.id;
  if (!isReaction(id)) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "REACTION_INVALID", message: "That reaction is not available" } });
    return;
  }
  if (player.presence !== "active") {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "REACTION_NOT_ALLOWED", message: "Rejoin the table to react" } });
    return;
  }
  const now = Date.now();
  const previous = lastReactionAt.get(playerId) ?? 0;
  if (now - previous < REACTION_COOLDOWN_MS) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: now, payload: { code: "REACTION_RATE_LIMITED", message: "Wait a moment between reactions" } });
    return;
  }
  lastReactionAt.set(playerId, now);

  const reaction = reactionById(id);
  if (!reaction) return;
  const seat = player.seat ?? seatForIndex(room.players.indexOf(player));
  broadcast(room, {
    type: MESSAGE_TYPES.REACTION,
    roomId: room.id,
    playerId,
    timestamp: now,
    payload: { playerId, name: player.name, seat, id: reaction.id, emoji: reaction.emoji },
  });
}

function handleSessionVote(ws: WebSocket, msg: SessionVoteMessage): void {
  const playerId = socketPlayers.get(ws);
  if (!playerId) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "NOT_JOINED", message: "Not joined to a room" } });
    return;
  }
  const room = findRoomByPlayerId(playerId);
  if (!room) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "ROOM_NOT_FOUND", message: "Room not found" } });
    return;
  }
  const session = roomSessions.get(room.id);
  const gameId = typeof msg.payload?.gameId === "string" ? msg.payload.gameId : "";
  if (!session || !gameId || !recordVote(session, playerId, gameId)) {
    send(ws, {
      type: MESSAGE_TYPES.ERROR,
      roomId: room.id,
      timestamp: Date.now(),
      payload: { code: "VOTE_REJECTED", message: "That game cannot be voted for right now" },
    });
    return;
  }
  broadcastSession(room);
}

function handleInput(ws: WebSocket, msg: ClientMessage & { type: "input" }): void {
  const playerId = socketPlayers.get(ws);
  if (!playerId) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "NOT_JOINED", message: "Not joined to a room" } });
    return;
  }

  const room = findRoomByPlayerId(playerId);
  if (!room || room.status !== "playing" || !room.gameId) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "NO_ACTIVE_GAME", message: "No active game" } });
    return;
  }

  // Spectators watch and react; they never affect the game. A player who left
  // mid-game is also inert. Drop the input silently: a spectator tapping a
  // leftover control should not surface an error.
  const sender = room.players.find((p) => p.id === playerId);
  if (sender?.spectator || sender?.presence === "left") return;

  const plugin = plugins.get(room.gameId);
  if (!plugin) return;

  // Validate input structure
  if (msg.payload === undefined || msg.payload === null) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "INVALID_INPUT", message: "Input payload required" } });
    return;
  }

  // Safe instance access with type guard
  const gameState = room.gameState;
  if (!gameState || typeof gameState !== "object" || !("roomId" in gameState) || !("players" in gameState) || !("state" in gameState)) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "INVALID_GAME_STATE", message: "Game state corrupted" } });
    return;
  }
  const instance = gameState as { roomId: string; players: Player[]; state: unknown };

  try {
    plugin.onInput(instance, playerId, msg.payload);
  } catch (e) {
    console.error("[Server] Plugin onInput error:", e);
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "PLUGIN_ERROR", message: "Input processing failed" } });
    return;
  }

  // Send updated game state
  let screen: unknown;
  try {
    screen = plugin.screenState(instance);
  } catch (e) {
    console.error("[Server] Plugin screenState error:", e);
    return;
  }

  for (const player of room.players) {
    sendGameStateTo(room, plugin, player, instance, screen);
  }
  sendScreenGameState(room, plugin, screen);
}

function handleDisconnect(ws: WebSocket): void {
  // Detach a spectator screen connection.
  const screenRoomId = screenRooms.get(ws);
  if (screenRoomId) {
    screenRooms.delete(ws);
    const set = roomScreens.get(screenRoomId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) roomScreens.delete(screenRoomId);
    }
    // Delete rooms that have neither players nor a screen.
    const r = rooms.get(screenRoomId);
    if (r && r.players.length === 0 && !roomScreens.has(screenRoomId)) {
      rooms.delete(screenRoomId);
      gameLoops.delete(screenRoomId);
      roomHostTokens.delete(screenRoomId);
      roomSessions.delete(screenRoomId);
    }
    return;
  }

  const playerId = socketPlayers.get(ws);
  if (!playerId) return;

  // Prevent stale socket close from clobbering a fresh reconnect socket
  if (playerSockets.get(playerId) !== ws) {
    return;
  }

  socketPlayers.delete(ws);
  playerSockets.delete(playerId);
  const playerRoomId = playerRooms.get(playerId);
  playerRooms.delete(playerId);
  if (!playerRoomId) return;

  const room = rooms.get(playerRoomId);
  if (!room) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;

  // Mark the seat away immediately, well inside the five-second budget, so the
  // TV and the other phones grey it out without waiting for the grace timer.
  // An explicit leave keeps saying "left".
  player.connected = false;
  if (player.presence !== "left") player.presence = "away";
  broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) });
  scheduleSeatReap(room, playerId);
}

/**
 * Keep a non-connected seat for the rejoin grace window, then remove it when
 * nobody else is left. Reuses the existing reap behaviour: as long as somebody
 * is still connected the seat is kept and pruned at the next game start.
 */
function scheduleSeatReap(room: RoomState, playerId: string): void {
  const disconnectedRoomId = room.id;
  setTimeout(() => {
    const currentRoom = rooms.get(disconnectedRoomId);
    if (!currentRoom) return;
    const currentPlayer = currentRoom.players.find((p) => p.id === playerId);
    if (!currentPlayer || currentPlayer.connected) return;

    if (currentRoom.players.some((p) => p.connected)) {
      // Somebody is still here, so keep the seat even if this player never
      // comes back. Phones drop their socket constantly (screen lock,
      // app switch); deleting the seat is what made one player vanish from
      // every lobby and locked them out with INVALID_TOKEN. The seat is
      // pruned at game start instead, where an absent player would stall
      // the turn order.
      broadcast(currentRoom, { type: MESSAGE_TYPES.ROOM_STATE, roomId: currentRoom.id, timestamp: Date.now(), payload: publicRoom(currentRoom) });
      return;
    }

    if (currentRoom.status === "playing") {
      // Nobody is left: tear the session down instead of running forever.
      const loop = gameLoops.get(currentRoom.id);
      if (loop) {
        clearInterval(loop);
        gameLoops.delete(currentRoom.id);
      }
      currentRoom.status = "lobby";
      promoteSpectators(currentRoom);
      currentRoom.pause = null;
      currentRoom.gameId = null;
      currentRoom.gameState = null;
    }

    // Remove the seat in place. Reassigning the array would break every
    // game instance that still holds a reference to it.
    const seat = currentRoom.players.indexOf(currentPlayer);
    if (seat !== -1) currentRoom.players.splice(seat, 1);
    playerRooms.delete(playerId);
    playerSockets.delete(playerId);
    lastReactionAt.delete(playerId);

    const session = roomSessions.get(currentRoom.id);
    if (session) {
      delete session.votes[playerId];
      if (currentRoom.players.length > 0) broadcastSession(currentRoom);
    }

    if (currentRoom.players.length === 0) {
      rooms.delete(currentRoom.id);
      gameLoops.delete(currentRoom.id);
      roomHostTokens.delete(currentRoom.id);
      roomSessions.delete(currentRoom.id);
      return;
    }
    if (currentRoom.hostPlayerId === playerId) {
      const connectedPlayers = currentRoom.players.filter((p) => p.connected);
      currentRoom.hostPlayerId = (connectedPlayers[0] ?? currentRoom.players[0]).id;
    }
    broadcast(currentRoom, { type: MESSAGE_TYPES.ROOM_STATE, roomId: currentRoom.id, timestamp: Date.now(), payload: publicRoom(currentRoom) });
  }, PLAYER_TIMEOUT_MS);
}

// --- Game Loop ---
function startGameLoop(roomId: string): void {
  if (gameLoops.has(roomId)) return;

  const room = rooms.get(roomId);
  if (!room || !room.gameId) return;

  const plugin = plugins.get(room.gameId);
  if (!plugin) return;

  const gameState = room.gameState;
  if (!gameState || typeof gameState !== "object" || !("roomId" in gameState) || !("players" in gameState) || !("state" in gameState)) {
    return;
  }
  const _instance = gameState as { roomId: string; players: Player[]; state: unknown };

  let lastTick = Date.now();

  const interval = setInterval(() => {
    const now = Date.now();

    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.status !== "playing" || !currentRoom.gameId) {
      clearInterval(interval);
      gameLoops.delete(roomId);
      return;
    }

    const currentPlugin = plugins.get(currentRoom.gameId);
    if (!currentPlugin) return;

    const currentGameState = currentRoom.gameState;
    if (!currentGameState || typeof currentGameState !== "object" || !("roomId" in currentGameState) || !("players" in currentGameState) || !("state" in currentGameState)) {
      return;
    }
    const currentInstance = currentGameState as { roomId: string; players: Player[]; state: unknown };

    // Below its minimum the game freezes: no tick, no timer advance and no new
    // frames. The room state (pause included) is broadcast when it changes.
    updatePause(currentRoom, currentPlugin.manifest.minPlayers, now);
    if (currentRoom.pause) {
      // Drop the paused wall time so resuming cannot feed it into the game.
      lastTick = now;
      return;
    }

    const deltaMs = Math.min(now - lastTick, 2000); // Cap delta
    lastTick = now;

    try {
      currentPlugin.onTick(currentInstance, deltaMs);
    } catch (e) {
      console.error("[Server] Plugin onTick error:", e);
      return;
    }

    let screen: unknown;
    try {
      screen = currentPlugin.screenState(currentInstance);
    } catch (e) {
      console.error("[Server] Plugin screenState error:", e);
      return;
    }

    // When a game reports finished, return the room to the lobby so the
    // host can start the next game. This tick still delivers the final state.
    if (
      screen &&
      typeof screen === "object" &&
      "finished" in screen &&
      (screen as { finished?: unknown }).finished === true &&
      currentRoom.status === "playing"
    ) {
      currentRoom.pause = null;
      currentRoom.status = "lobby";
      promoteSpectators(currentRoom);
      broadcast(currentRoom, {
        type: MESSAGE_TYPES.ROOM_STATE,
        roomId: currentRoom.id,
        timestamp: Date.now(),
        payload: publicRoom(currentRoom),
      });
    }
    for (const player of currentRoom.players) {
      sendGameStateTo(currentRoom, currentPlugin, player, currentInstance, screen);
    }
    sendScreenGameState(currentRoom, currentPlugin, screen);

    // The result has been delivered; release the finished game so the lobby is
    // not capped by the last game's player limit.
    if (currentRoom.status === "lobby") {
      const session = roomSessions.get(currentRoom.id);
      if (session && session.status === "playing") {
        completeRound(
          session,
          currentPlugin.manifest.id,
          gameDisplayName(currentPlugin.manifest),
          screen,
          currentRoom.players,
          currentPlugin.manifest.id === "quiz" ? quizAccuracy(currentInstance) : undefined,
        );
        broadcastSession(currentRoom);
      }
      currentRoom.gameId = null;
      currentRoom.gameState = null;
    }
  }, 16); // ~60fps

  gameLoops.set(roomId, interval);
}

function _stopGameLoop(roomId: string): void {
  const interval = gameLoops.get(roomId);
  if (interval) {
    clearInterval(interval);
    gameLoops.delete(roomId);
  }
}

// HTTP endpoint to start a game
function roomByParam(paramId: string): RoomState | undefined {
  let room = rooms.get(paramId);
  if (!room) {
    for (const r of rooms.values()) {
      if (r.code === paramId) {
        room = r;
        break;
      }
    }
  }
  return room;
}

async function handleSessionStart(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method !== "POST" || !/^\/api\/rooms\/[^/]+\/session\/start$/.test(url.pathname)) {
    return false;
  }
  const room = roomByParam(url.pathname.split("/")[3]);
  if (!room) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "ROOM_NOT_FOUND", message: "Room not found" }));
    return true;
  }
  if (!requireHost(req, res, room)) return true;
  if (room.status !== "lobby") {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "GAME_IN_PROGRESS", message: "Finish the current game first" }));
    return true;
  }
  if (roomSessions.has(room.id)) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "SESSION_EXISTS", message: "A rumble is already running" }));
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "INVALID_BODY", message: "Invalid JSON body" }));
    return true;
  }

  const length = Number(body.length);
  if (![5, 8, 18].includes(length)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "INVALID_LENGTH", message: "Rumble length must be 5, 8 or 18" }));
    return true;
  }
  const selection = body.selection === "random" ? "random" : "vote";
  const active = room.players.filter((p) => p.connected);
  if (active.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_PLAYERS", message: "No players are connected" }));
    return true;
  }

  const games = [...plugins.values()]
    .filter((p) => isGameEnabled(p.manifest.id))
    .map((p) => ({
      id: p.manifest.id,
      name: gameDisplayName(p.manifest),
      description: p.manifest.description,
      minPlayers: p.manifest.minPlayers,
      maxPlayers: p.manifest.maxPlayers,
    }));
  const session = createSession(active, games, length, selection);
  if (session.candidates.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_GAMES", message: "No games fit the current player count" }));
    return true;
  }

  roomSessions.set(room.id, session);
  broadcastSession(room);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ session: sessionView(session) }));
  return true;
}

function handleSessionEnd(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (req.method !== "POST" || !/^\/api\/rooms\/[^/]+\/session\/end$/.test(url.pathname)) {
    return false;
  }
  const room = roomByParam(url.pathname.split("/")[3]);
  if (!room) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "ROOM_NOT_FOUND", message: "Room not found" }));
    return true;
  }
  if (!requireHost(req, res, room)) return true;
  roomSessions.delete(room.id);
  broadcastSession(room);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
  return true;
}

function handlePause(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (req.method !== "POST" || !/^\/api\/rooms\/[^/]+\/pause$/.test(url.pathname)) {
    return false;
  }
  const room = roomByParam(url.pathname.split("/")[3]);
  if (!room) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "ROOM_NOT_FOUND", message: "Room not found" }));
    return true;
  }
  if (!requireHost(req, res, room)) return true;
  if (room.status !== "playing" || !room.gameId) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_ACTIVE_GAME", message: "No game is running" }));
    return true;
  }
  if (!room.pause) {
    // Nothing to extend. A running game that is not paused stays as it is; the
    // spec only requires 409 when no game is running.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, pause: null }));
    return true;
  }

  // Wait: give the table another full grace window from now.
  room.pause.until = Date.now() + DROPOUT_PAUSE_MS;
  broadcastRoomState(room);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, pause: room.pause }));
  return true;
}

function handleResume(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (req.method !== "POST" || !/^\/api\/rooms\/[^/]+\/resume$/.test(url.pathname)) {
    return false;
  }
  const room = roomByParam(url.pathname.split("/")[3]);
  if (!room) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "ROOM_NOT_FOUND", message: "Room not found" }));
    return true;
  }
  if (!requireHost(req, res, room)) return true;
  if (room.status !== "playing" || !room.gameId) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_ACTIVE_GAME", message: "No game is running" }));
    return true;
  }

  const plugin = plugins.get(room.gameId);
  const minPlayers = plugin?.manifest.minPlayers ?? 0;
  const connected = connectedParticipantCount(room);
  if (connected < minPlayers) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      code: "BELOW_MINIMUM",
      message: `Need ${minPlayers} players; ${connected} connected`,
      minPlayers,
      connected,
    }));
    return true;
  }

  if (room.pause) {
    room.pause = null;
    broadcastRoomState(room);
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
  return true;
}

function handleEndGame(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (req.method !== "POST" || !/^\/api\/rooms\/[^/]+\/end-game$/.test(url.pathname)) {
    return false;
  }
  const room = roomByParam(url.pathname.split("/")[3]);
  if (!room) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "ROOM_NOT_FOUND", message: "Room not found" }));
    return true;
  }
  if (!requireHost(req, res, room)) return true;
  if (room.status !== "playing") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_ACTIVE_GAME", message: "No game is running" }));
    return true;
  }

  _stopGameLoop(room.id);
  room.status = "lobby";
  promoteSpectators(room);
  room.pause = null;
  room.gameId = null;
  room.gameState = null;
  const session = roomSessions.get(room.id);
  if (session && session.status === "playing") {
    abortRound(session);
    broadcastSession(room);
  }
  broadcast(room, {
    type: MESSAGE_TYPES.ROOM_STATE,
    roomId: room.id,
    timestamp: Date.now(),
    payload: publicRoom(room),
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
  return true;
}

function handleStartGame(req: any, res: any, url: URL): boolean {
  if (req.method !== "POST" || !url.pathname.startsWith("/api/rooms/") || !url.pathname.endsWith("/start")) {
    return false;
  }

  const paramId = url.pathname.split("/")[3];
  let room = rooms.get(paramId);
  // Also accept 5-char room code
  if (!room) {
    for (const r of rooms.values()) {
      if (r.code === paramId) {
        room = r;
        break;
      }
    }
  }
  if (!room) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "ROOM_NOT_FOUND", message: "Room not found" }));
    return true;
  }

  // Verify the request comes from the host screen.
  if (!requireHost(req, res, room)) return true;

  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk; });
  req.on("end", () => {
    try {
      const { gameId, options } = JSON.parse(body) as { gameId: string; options?: Record<string, unknown> };
      const plugin = plugins.get(gameId);
      if (!plugin) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "INVALID_GAME", message: "Game not found" }));
        return;
      }

      // Retired games stay loadable but can never be started.
      if (!isGameEnabled(gameId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "GAME_DISABLED", message: "That game is not available" }));
        return;
      }

      // Drop seats for players who left while the room sat in the lobby, so
      // the game starts with exactly the connected phones.
      for (let i = room.players.length - 1; i >= 0; i--) {
        if (!room.players[i].connected) {
          const goneId = room.players[i].id;
          playerRooms.delete(goneId);
          playerSockets.delete(goneId);
          lastReactionAt.delete(goneId);
          room.players.splice(i, 1);
        }
      }
      if (room.hostPlayerId && !room.players.some((p) => p.id === room.hostPlayerId)) {
        room.hostPlayerId = room.players[0]?.id ?? null;
      }

      // Spectators are audience only: never part of the game instance, even if
      // a stale flag survives a lobby transition.
      const participants = room.players.filter((p) => !p.spectator);

      if (participants.length < plugin.manifest.minPlayers) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "NOT_ENOUGH_PLAYERS", message: `Need at least ${plugin.manifest.minPlayers} players` }));
        return;
      }

      if (participants.length > plugin.manifest.maxPlayers) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "TOO_MANY_PLAYERS", message: `Maximum ${plugin.manifest.maxPlayers} players allowed` }));
        return;
      }

      const session = roomSessions.get(room.id);
      if (session) {
        if (session.status !== "voting") {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: "SESSION_NOT_VOTING", message: "The rumble is not ready for another game" }));
          return;
        }
        if (!session.candidates.some((g) => g.id === gameId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: "SESSION_GAME_INVALID", message: "That game is not in this rumble round" }));
          return;
        }
      }

      room.gameId = gameId;
      room.status = "playing";
      room.pause = null;
      room.gameState = plugin.onStart(room, participants, options);
      if (session) {
        startRound(session, gameId);
        broadcastSession(room);
      }

      // Set controllerType on each player from manifest
      for (const player of participants) {
        player.controllerType = plugin.manifest.controllerType;
      }

      // Broadcast initial game state
      const screen = plugin.screenState(room.gameState as { roomId: string; players: Player[]; state: unknown });
      for (const player of room.players) {
        sendGameStateTo(room, plugin, player, room.gameState, screen);
      }
      sendScreenGameState(room, plugin, screen);

      // Start game loop
      startGameLoop(room.id);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      console.error("[Server] Error starting game:", e);
      if (!res.writableEnded) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "INVALID_REQUEST", message: "Invalid request body" }));
      }
    }
  });

  return true;
}

// --- Start ---
async function start() {
  await loadPlugins();
  const urls = await getLanUrls(PORT, SCHEME);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`TBRN-Games server listening on port ${PORT} (${SCHEME})`);
    console.log("LAN URLs:");
    for (const url of urls) {
      console.log(`  ${url}`);
    }
    console.log("Share one of these URLs or the QR code with phones on the same network");
  });
}

// Cleanup on process exit
function shutdown(): void {
  console.log("Shutting down...");
  for (const [, interval] of gameLoops) {
    clearInterval(interval);
  }
  gameLoops.clear();
  httpServer.close(() => {
    process.exit(0);
  });
  // Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});

// stripTypeScriptTypes is experimental and warns on every request; keep the
// warning once instead of flooding the log, but pass other warnings through.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.includes("stripTypeScriptTypes")) {
    console.warn("[warn] node:module stripTypeScriptTypes is experimental (client TS served without a build step)");
    return;
  }
  console.warn(warning);
});

start();