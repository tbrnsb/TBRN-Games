import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
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

const PORT = Number(process.env.PORT ?? 3000);

// --- In-memory stores ---
const rooms = new Map<string, RoomState>();
const plugins = new Map<string, GamePlugin>();
const playerSockets = new Map<string, WebSocket>(); // playerId -> ws
const socketPlayers = new Map<WebSocket, string>(); // ws -> playerId

// --- Helpers ---
function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
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
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === playerId)) return room;
  }
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
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// --- Plugin loader ---
function loadPlugins(): void {
  // TODO: Load from games/ directory at runtime
  // For now, register a dummy plugin for testing
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
        const taps = instance.state.taps as Map<string, number>;
        taps.set(playerId, (taps.get(playerId) ?? 0) + 1);
      }
    },
    onTick(_instance, _deltaMs) {},
    screenState(instance) {
      const taps = instance.state.taps as Map<string, number>;
      return { players: instance.players.map((p) => ({ name: p.name, taps: taps.get(p.id) ?? 0 })) };
    },
    controllerState(instance, playerId) {
      const taps = instance.state.taps as Map<string, number>;
      return { yourTaps: taps.get(playerId) ?? 0 };
    },
  };

  plugins.set(dummyManifest.id, dummyPlugin);
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

  // Serve static client files (screen + controller)
  let filePath = "";
  if (url.pathname === "/" || url.pathname === "/screen") {
    filePath = join(process.cwd(), "client/screen/index.html");
  } else if (url.pathname.startsWith("/controller")) {
    filePath = join(process.cwd(), "client/controller/index.html");
  } else if (url.pathname.startsWith("/assets/")) {
    filePath = join(process.cwd(), "client", url.pathname);
  }

  if (filePath) {
    try {
      const content = readFileSync(filePath);
      const ext = filePath.split(".").pop();
      const mime = ext === "html" ? "text/html" : ext === "js" ? "application/javascript" : ext === "css" ? "text/css" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
      return;
    } catch {
      // fall through to 404
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
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
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;

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
        default:
          send(ws, { type: MESSAGE_TYPES.ERROR, roomId: msg.roomId, timestamp: Date.now(), payload: { code: "UNKNOWN_MESSAGE", message: `Unknown message type: ${msg.type}` } });
      }
    } catch {
      send(ws, { type: MESSAGE_TYPES.ERROR, roomId: "", timestamp: Date.now(), payload: { code: "PARSE_ERROR", message: "Invalid JSON" } });
    }
  });

  ws.on("close", () => handleDisconnect(ws));
  ws.on("error", () => handleDisconnect(ws));

  startPing();
});

function handleJoin(ws: WebSocket, msg: ClientMessage & { type: "join" }): void {
  const { roomId, payload } = msg;
  const { name, rejoinToken } = payload;

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

        send(ws, {
          type: MESSAGE_TYPES.JOINED,
          roomId: room.id,
          playerId: player.id,
          timestamp: Date.now(),
          payload: { playerId: player.id, rejoinToken: player.rejoinToken, roomState: room },
        });
        broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: room }, player.id);
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

  if (room.players.length >= 4) {
    send(ws, { type: MESSAGE_TYPES.ERROR, roomId: room.id, timestamp: Date.now(), payload: { code: "ROOM_FULL", message: "Room is full (max 4 players)" } });
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

  send(ws, {
    type: MESSAGE_TYPES.JOINED,
    roomId: room.id,
    playerId,
    timestamp: Date.now(),
    payload: { playerId, rejoinToken: token, roomState: room },
  });
  broadcast(room, { type: MESSAGE_TYPES.ROOM_STATE, roomId: room.id, timestamp: Date.now(), payload: room }, playerId);
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

  // Find game instance (stored in room.gameState)
  const instance = room.gameState as { roomId: string; players: Player[]; state: unknown };
  if (!instance) return;

  plugin.onInput(instance, playerId, msg.payload);

  // Send updated game state
  const screen = plugin.screenState(instance);
  for (const player of room.players) {
    const controller = plugin.controllerState(instance, player.id);
    const pws = playerSockets.get(player.id);
    if (pws?.readyState === WebSocket.OPEN) {
      send(pws, { type: MESSAGE_TYPES.GAME_STATE, roomId: room.id, playerId: player.id, timestamp: Date.now(), payload: { screen, controller } });
    }
  }
}

function handleDisconnect(ws: WebSocket): void {
  const playerId = socketPlayers.get(ws);
  if (!playerId) return;

  socketPlayers.delete(ws);
  playerSockets.delete(playerId);

  const room = findRoomByPlayerId(playerId);
  if (room) {
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.connected = false;
      // Schedule cleanup if no reconnect within timeout
      setTimeout(() => {
        const currentRoom = findRoomByPlayerId(playerId);
        if (currentRoom) {
          const currentPlayer = currentRoom.players.find((p) => p.id === playerId);
          if (currentPlayer && !currentPlayer.connected) {
            currentRoom.players = currentRoom.players.filter((p) => p.id !== playerId);
            if (currentRoom.players.length === 0) {
              rooms.delete(currentRoom.id);
            } else if (currentRoom.hostPlayerId === playerId) {
              currentRoom.hostPlayerId = currentRoom.players[0].id;
            }
            broadcast(currentRoom, { type: MESSAGE_TYPES.ROOM_STATE, roomId: currentRoom.id, timestamp: Date.now(), payload: currentRoom });
          }
        }
      }, PLAYER_TIMEOUT_MS);
    }
  }
}

// --- Start ---
loadPlugins();

async function start() {
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

start();