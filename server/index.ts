import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
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
  MESSAGE_TYPES,
} from "../shared/constants.js";
import type {
  ClientMessage,
  ServerMessage,
  RoomState,
  Player,
  GamePlugin,
  GameManifest,
} from "../shared/types.ts";
import type { PluginLoader } from "./plugins.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_ROOMS = 100; // Prevent unbounded room creation
const MAX_PLAYERS_PER_ROOM = 4; // Hard ceiling used only when no manifest exists

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
        payload: { screen, controller: null, gameId: room.gameId, gameName: plugin.manifest.name },
      });
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
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
    payload: { screen, controller: payloadController, gameId: room.gameId, gameName: plugin.manifest.name },
  };
}

/**
 * Room copy with the live game instance stripped out.
 * room.gameState contains private per-player data (hole cards, boards,
 * secret characters) and must never be sent to clients.
 */
function publicRoom(room: RoomState): RoomState {
  return { ...room, gameState: null };
}

// --- Plugin loader ---
let pluginLoader: PluginLoader;

async function loadPlugins(): Promise<void> {
  const { createPluginLoader } = await import("./plugins.ts");
  pluginLoader = await createPluginLoader(join(process.cwd(), "games"));
  const loaded = pluginLoader.loadAll();

  // Copy to plugins map for compatibility
  for (const [id, plugin] of loaded) {
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

// --- HTTP server for static files + health ---
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }

  if (url.pathname === "/api/lan-urls") {
    const urls = await getLanUrls(PORT);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ urls }));
    return;
  }

  // Public list of installed games (manifests only)
  if (url.pathname === "/api/games") {
    const games = [...plugins.values()].map((p) => p.manifest);
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
});

/**
 * Serve a client/shared/game module to the browser.
 * Returns true when the request was handled.
 */
function serveStatic(pathname: string, res: ServerResponse): boolean {
  let rel = "";
  if (pathname === "/" || pathname === "/screen" || pathname === "/screen/") {
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
        case MESSAGE_TYPES.INPUT:
          handleInput(ws, msg);
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

function handleJoin(ws: WebSocket, msg: ClientMessage & { type: "join" }): void {
  const { roomId: initialRoomId, payload } = msg;
  let roomId = initialRoomId;
  const { name, rejoinToken } = payload;

  // Validate name
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: roomId ?? "", timestamp: Date.now(), payload: { code: "INVALID_NAME", message: "Name is required" } });
    return;
  }
  if (name.length > 32) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: roomId ?? "", timestamp: Date.now(), payload: { code: "NAME_TOO_LONG", message: "Name must be 32 characters or less" } });
    return;
  }
  // Sanitize name - remove control characters
  const sanitizedName = name
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join("")
    .trim();
  if (sanitizedName !== name) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: roomId ?? "", timestamp: Date.now(), payload: { code: "INVALID_NAME", message: "Name contains invalid characters" } });
    return;
  }

  // The laptop screen joins as a spectator: it owns the room but does not
  // occupy one of the four player seats and never receives controller state.
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
        playerSockets.set(player.id, ws);
        socketPlayers.set(ws, player.id);
        playerRooms.set(player.id, room.id);

        send(ws, {
          type: MESSAGE_TYPES.JOINED,
          roomId: room.id,
          playerId: player.id,
          timestamp: Date.now(),
          payload: { playerId: player.id, rejoinToken: player.rejoinToken, roomState: publicRoom(room) },
        });
        // Also send ROOM_STATE to the reconnecting player
        send(ws, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) });
        broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) }, player.id);
        return;
      }
    }
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId, timestamp: Date.now(), payload: { code: "INVALID_TOKEN", message: "Invalid or expired rejoin token" } });
    return;
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
    };
    rooms.set(id, room);
  }

  // Reject brand-new joins while a game is running. Per-player arrays in the
  // running game state are sized at start, so a late seat would corrupt them.
  if (room.status === "playing") {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "GAME_IN_PROGRESS", message: "Game in progress — wait for the next round" } });
    return;
  }

  // Seat cap comes from the game manifest when a game is selected, otherwise
  // the platform ceiling.
  const maxPlayers = room.gameId
    ? (plugins.get(room.gameId)?.manifest.maxPlayers ?? MAX_PLAYERS_PER_ROOM)
    : MAX_PLAYERS_PER_ROOM;
  if (room.players.length >= maxPlayers) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "ROOM_FULL", message: `Room is full (max ${maxPlayers} players)` } });
    return;
  }

  const playerId = generatePlayerId();
  const token = generateRejoinToken();
  const player: Player = {
    id: playerId,
    name,
    joinedAt: Date.now(),
    rejoinToken: token,
    connected: true,
  };

  room.players.push(player);
  if (!room.hostPlayerId) room.hostPlayerId = playerId;

  playerSockets.set(playerId, ws);
  socketPlayers.set(ws, playerId);
  playerRooms.set(playerId, room.id);

  send(ws, {
    type: MESSAGE_TYPES.JOINED,
    roomId: room.id,
    playerId,
    timestamp: Date.now(),
    payload: { playerId, rejoinToken: token, roomState: publicRoom(room) },
  });
  // Also send ROOM_STATE to the joining player so they have full room state
  send(ws, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) });
  broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: publicRoom(room) }, playerId);
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
    let controller: unknown;
    try {
      controller = plugin.controllerState(instance, player.id);
    } catch (e) {
      console.error("[Server] Plugin controllerState error:", e);
      continue;
    }
    const pws = playerSockets.get(player.id);
    if (pws?.readyState === WebSocket.OPEN) {
      send(pws, gameStateMessage(room, plugin, player.id, screen, controller));
    }
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
  // Capture roomId before deleting from playerRooms (needed for cleanup timeout)
  const playerRoomId = playerRooms.get(playerId);
  playerRooms.delete(playerId);
  if (!playerRoomId) return;

  const room = rooms.get(playerRoomId);
  if (room) {
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.connected = false;
      // Schedule cleanup if no reconnect within timeout.
      const disconnectedRoomId = room.id;
      setTimeout(() => {
        const currentRoom = rooms.get(disconnectedRoomId);
        if (!currentRoom) return;
        const currentPlayer = currentRoom.players.find((p) => p.id === playerId);
        if (!currentPlayer || currentPlayer.connected) return;

        if (currentRoom.status === "playing") {
          // Keep the seat while others are still playing: per-player arrays in
          // the running game state are indexed by seat, so removing a player
          // here would desynchronise them from room.players.
          if (currentRoom.players.some((p) => p.connected)) {
            broadcast(currentRoom, { type: MESSAGE_TYPES.ROOM_STATE, roomId: currentRoom.id, timestamp: Date.now(), payload: publicRoom(currentRoom) });
            return;
          }
          // Nobody is left: tear the session down instead of running forever.
          const loop = gameLoops.get(currentRoom.id);
          if (loop) {
            clearInterval(loop);
            gameLoops.delete(currentRoom.id);
          }
          currentRoom.status = "lobby";
          currentRoom.gameId = null;
          currentRoom.gameState = null;
        }

        // Remove the seat in place. Reassigning the array would break every
        // game instance that still holds a reference to it.
        const seat = currentRoom.players.indexOf(currentPlayer);
        if (seat !== -1) currentRoom.players.splice(seat, 1);
        playerRooms.delete(playerId);
        playerSockets.delete(playerId);

        if (currentRoom.players.length === 0) {
          rooms.delete(currentRoom.id);
          gameLoops.delete(currentRoom.id);
          roomHostTokens.delete(currentRoom.id);
          return;
        }
        if (currentRoom.hostPlayerId === playerId) {
          const connectedPlayers = currentRoom.players.filter((p) => p.connected);
          currentRoom.hostPlayerId = (connectedPlayers[0] ?? currentRoom.players[0]).id;
        }
        broadcast(currentRoom, { type: MESSAGE_TYPES.ROOM_STATE, roomId: currentRoom.id, timestamp: Date.now(), payload: publicRoom(currentRoom) });
      }, PLAYER_TIMEOUT_MS);
    }
  }
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
    const deltaMs = Math.min(now - lastTick, 2000); // Cap delta
    lastTick = now;

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
      currentRoom.status = "lobby";
      broadcast(currentRoom, {
        type: MESSAGE_TYPES.ROOM_STATE,
        roomId: currentRoom.id,
        timestamp: Date.now(),
        payload: publicRoom(currentRoom),
      });
    }
    for (const player of currentRoom.players) {
      let controller: unknown;
      try {
        controller = currentPlugin.controllerState(currentInstance, player.id);
      } catch (e) {
        console.error("[Server] Plugin controllerState error:", e);
        continue;
      }
      const pws = playerSockets.get(player.id);
      if (pws?.readyState === WebSocket.OPEN) {
        send(pws, gameStateMessage(currentRoom, currentPlugin, player.id, screen, controller));
      }
    }
    sendScreenGameState(currentRoom, currentPlugin, screen);

    // The result has been delivered; release the finished game so the lobby is
    // not capped by the last game's player limit.
    if (currentRoom.status === "lobby") {
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
  const screens = roomScreens.get(room.id);
  if (!screens || screens.size === 0) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "NO_HOST_SCREEN", message: "No host screen connected to this room" }));
    return true;
  }

  // The screen receives a host token on join; a start request must present it.
  // This stops any other client on the LAN from starting a game.
  const providedToken = String(req.headers["x-host-token"] ?? "");
  const expectedToken = roomHostTokens.get(room.id) ?? "";
  if (!expectedToken || providedToken !== expectedToken) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "HOST_AUTH_REQUIRED", message: "Start request must come from the host screen" }));
    return true;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk; });
  req.on("end", () => {
    try {
      const { gameId } = JSON.parse(body);
      const plugin = plugins.get(gameId);
      if (!plugin) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "INVALID_GAME", message: "Game not found" }));
        return;
      }

      // Drop seats for players who left while the room sat in the lobby, so
      // the game starts with exactly the connected phones.
      for (let i = room.players.length - 1; i >= 0; i--) {
        if (!room.players[i].connected) {
          playerRooms.delete(room.players[i].id);
          playerSockets.delete(room.players[i].id);
          room.players.splice(i, 1);
        }
      }
      if (room.hostPlayerId && !room.players.some((p) => p.id === room.hostPlayerId)) {
        room.hostPlayerId = room.players[0]?.id ?? null;
      }

      if (room.players.length < plugin.manifest.minPlayers) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "NOT_ENOUGH_PLAYERS", message: `Need at least ${plugin.manifest.minPlayers} players` }));
        return;
      }

      if (room.players.length > plugin.manifest.maxPlayers) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "TOO_MANY_PLAYERS", message: `Maximum ${plugin.manifest.maxPlayers} players allowed` }));
        return;
      }

      room.gameId = gameId;
      room.status = "playing";
      room.gameState = plugin.onStart(room, room.players);

      // Set controllerType on each player from manifest
      for (const player of room.players) {
        player.controllerType = plugin.manifest.controllerType;
      }

      // Broadcast initial game state
      const screen = plugin.screenState(room.gameState as { roomId: string; players: Player[]; state: unknown });
      for (const player of room.players) {
        const controller = plugin.controllerState(room.gameState as { roomId: string; players: Player[]; state: unknown }, player.id);
        const pws = playerSockets.get(player.id);
        if (pws?.readyState === WebSocket.OPEN) {
          send(pws, gameStateMessage(room, plugin, player.id, screen, controller));
        }
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
  const urls = await getLanUrls(PORT);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`TBRN-Games server listening on port ${PORT}`);
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