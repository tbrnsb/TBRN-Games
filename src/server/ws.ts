import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import type {
  ClientMessage,
  ErrorCode,
  ServerMessage,
} from "../shared/protocol.js";
import { GameManager } from "./games/manager.js";
import { GameRegistry } from "./games/registry.js";
import { Room, type RoomOptions } from "./room.js";

export interface GameSocketOptions extends RoomOptions {
  room?: Room;
  registry?: GameRegistry;
  sweepIntervalMs?: number;
}

export interface GameSocket {
  wss: WebSocketServer;
  room: Room;
  manager: GameManager;
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

  if (value.type === "start_game" && typeof value.gameId === "string") {
    return { type: "start_game", gameId: value.gameId };
  }

  if (value.type === "game_action" && "action" in value) {
    return { type: "game_action", action: value.action };
  }

  if (value.type === "host_action" && "action" in value) {
    return { type: "host_action", action: value.action };
  }

  if (value.type === "return_to_lobby") {
    return { type: "return_to_lobby" };
  }

  return null;
}

export function attachGameSocket(
  server: Server,
  options: GameSocketOptions = {},
): GameSocket {
  const {
    room: providedRoom,
    registry,
    sweepIntervalMs = 5_000,
    ...roomOptions
  } = options;
  const now = roomOptions.now ?? Date.now;
  const room = providedRoom ?? new Room(roomOptions);
  const manager = new GameManager(room, registry ?? new GameRegistry(), {
    now,
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4_096,
  });
  const playerBySocket = new Map<WebSocket, string>();
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

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

  function broadcast(message: ServerMessage): void {
    for (const socket of wss.clients) {
      sendJson(socket, message);
    }
  }

  function sendController(socket: WebSocket, playerId: string): void {
    sendJson(socket, {
      type: "controller",
      state: manager.controllerState(playerId),
    });
  }

  function armDeadline(): void {
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }

    const deadline = manager.deadline();

    if (deadline === null) {
      return;
    }

    const delay = Math.max(0, deadline - now()) + 5;

    deadlineTimer = setTimeout(() => {
      deadlineTimer = null;

      const result = manager.handleDeadline();

      if (result.ok) {
        syncAll();
      } else {
        armDeadline();
      }
    }, delay);
    deadlineTimer.unref();
  }

  function syncAll(): void {
    const screen = manager.screenState();

    if (screen) {
      broadcast({ type: "screen", state: screen });
    } else {
      broadcast({ type: "lobby", state: manager.lobbyState() });
    }

    for (const [socket, playerId] of playerBySocket) {
      if (room.playerById(playerId)) {
        sendController(socket, playerId);
      }
    }

    armDeadline();
  }

  function handleMessage(socket: WebSocket, raw: string): void {
    const message = parseClientMessage(raw);

    if (!message) {
      sendError(socket, "invalid_message", "Invalid message.");
      return;
    }

    const playerId = playerBySocket.get(socket);

    if (message.type === "join" || message.type === "resume") {
      if (playerId !== undefined) {
        sendError(socket, "already_joined", "This connection has already joined.");
        return;
      }

      const result =
        message.type === "join"
          ? room.join(message.name)
          : room.resume(message.token);

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
      syncAll();
      return;
    }

    if (playerId === undefined) {
      sendError(socket, "not_joined", "Join the room first.");
      return;
    }

    if (message.type === "start_game") {
      const result = manager.startGame(playerId, message.gameId);

      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }

      syncAll();
      return;
    }

    if (message.type === "game_action") {
      const result = manager.applyAction(playerId, message.action);

      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }

      syncAll();
      return;
    }

    if (message.type === "host_action") {
      const result = manager.applyHostAction(playerId, message.action);

      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }

      syncAll();
      return;
    }

    const result = manager.returnToLobby(playerId);

    if (!result.ok) {
      sendError(socket, result.code, result.message);
      return;
    }

    syncAll();
  }

  wss.on("connection", (socket) => {
    const screen = manager.screenState();

    if (screen) {
      sendJson(socket, { type: "screen", state: screen });
    } else {
      sendJson(socket, { type: "lobby", state: manager.lobbyState() });
    }

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
        syncAll();
      }
    });

    socket.on("error", () => {
      // The close event performs the seat cleanup.
    });
  });

  const sweep = setInterval(() => {
    if (room.pruneExpired().length > 0) {
      syncAll();
    }
  }, sweepIntervalMs);
  sweep.unref();

  return {
    wss,
    room,
    manager,
    close(): void {
      clearInterval(sweep);

      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }

      wss.close();
    },
  };
}
