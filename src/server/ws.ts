import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import type {
  ClientMessage,
  ErrorCode,
  PrivateControllerState,
  PublicPlayer,
  ServerMessage,
} from "../shared/protocol.js";
import { Room, type RoomOptions } from "./room.js";

export interface GameSocketOptions extends RoomOptions {
  room?: Room;
  sweepIntervalMs?: number;
}

export interface GameSocket {
  wss: WebSocketServer;
  room: Room;
  close: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value.type === "join" && typeof value.name === "string") {
    return { type: "join", name: value.name };
  }

  if (value.type === "resume" && typeof value.token === "string") {
    return { type: "resume", token: value.token };
  }

  return null;
}

function controllerState(player: PublicPlayer): PrivateControllerState {
  return {
    playerId: player.id,
    name: player.name,
  };
}

export function attachGameSocket(
  server: Server,
  options: GameSocketOptions = {},
): GameSocket {
  const { room: providedRoom, sweepIntervalMs = 5_000, ...roomOptions } = options;
  const room = providedRoom ?? new Room(roomOptions);
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4_096,
  });
  const playerBySocket = new Map<WebSocket, string>();

  function sendJson(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendError(
    socket: WebSocket,
    code: ErrorCode,
    message: string,
  ): void {
    sendJson(socket, { type: "error", code, message });
  }

  function sendController(socket: WebSocket, player: PublicPlayer): void {
    sendJson(socket, { type: "controller", state: controllerState(player) });
  }

  function broadcastLobby(): void {
    const message: ServerMessage = {
      type: "lobby",
      state: room.publicState(),
    };

    for (const socket of wss.clients) {
      sendJson(socket, message);
    }
  }

  function handleMessage(socket: WebSocket, raw: string): void {
    const message = parseClientMessage(raw);

    if (!message) {
      sendError(socket, "invalid_message", "Invalid message.");
      return;
    }

    if (playerBySocket.has(socket)) {
      sendError(socket, "already_joined", "This connection has already joined.");
      return;
    }

    if (message.type === "join") {
      const result = room.join(message.name);

      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }

      playerBySocket.set(socket, result.player.id);
      sendJson(socket, {
        type: "joined",
        playerId: result.player.id,
        token: result.token,
      });
      broadcastLobby();
      sendController(socket, result.player);
      return;
    }

    const result = room.resume(message.token);

    if (!result.ok) {
      sendError(socket, result.code, result.message);
      return;
    }

    playerBySocket.set(socket, result.player.id);
    sendJson(socket, {
      type: "joined",
      playerId: result.player.id,
      token: result.token,
    });
    broadcastLobby();
    sendController(socket, result.player);
  }

  wss.on("connection", (socket) => {
    sendJson(socket, { type: "lobby", state: room.publicState() });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        sendError(socket, "invalid_message", "Invalid message.");
        return;
      }

      handleMessage(socket, data.toString());
    });

    socket.on("close", () => {
      const playerId = playerBySocket.get(socket);

      if (playerId === undefined) {
        return;
      }

      playerBySocket.delete(socket);

      if (room.disconnect(playerId)) {
        broadcastLobby();
      }
    });

    socket.on("error", () => {
      // The close event performs the seat cleanup.
    });
  });

  const sweep = setInterval(() => {
    if (room.pruneExpired().length > 0) {
      broadcastLobby();
    }
  }, sweepIntervalMs);
  sweep.unref();

  return {
    wss,
    room,
    close(): void {
      clearInterval(sweep);
      wss.close();
    },
  };
}
