import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, RoomStateMessage, Player, SessionMessage } from "../shared/types.ts";
import { MESSAGE_TYPES } from "../shared/constants.js";

export interface BotConfig {
  name: string;
  roomUrl: string; // ws://host:port
  rejoinToken?: string;
  roomId?: string; // If provided, join this room instead of creating new
}

export interface BotPlayer extends Player {
  ws: WebSocket;
  connected: boolean;
  lastPing: number;
}

export class BotClient {
  public player: BotPlayer | null = null;
  public roomId: string = "";
  public roomState: RoomStateMessage["payload"] | null = null;
  public lastSession: SessionMessage["payload"] | null = null;
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, (msg: ServerMessage) => void> = new Map();
  private onceHandlers: Map<string, (msg: ServerMessage) => void> = new Map();
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }> = new Map();
  private requestId = 0;
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
  }

  connect(): Promise<BotPlayer> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.roomUrl);

      this.ws.on("open", () => {
        console.log(`[${this.config.name}] Connected`);
        this.sendJoin();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          console.log(`[${this.config.name}] Received:`, msg.type);
          this.handleMessage(msg);
        } catch (e) {
          console.error(`[${this.config.name}] Parse error:`, e);
        }
      });

      this.ws.on("close", () => {
        console.log(`[${this.config.name}] Disconnected`);
        this.player = null;
      });

      this.ws.on("error", (err) => {
        console.error(`[${this.config.name}] Error:`, err);
        reject(err);
      });

      // Wait for joined message
      this.once(MESSAGE_TYPES.JOINED, (msg) => {
        if (msg.type !== MESSAGE_TYPES.JOINED) return;
        const player: BotPlayer = {
          id: msg.payload.playerId,
          name: this.config.name,
          joinedAt: Date.now(),
          rejoinToken: msg.payload.rejoinToken,
          connected: true,
          seat: msg.payload.roomState.players.find((p) => p.id === msg.payload.playerId)?.seat,
          ws: this.ws!,
          lastPing: 0,
        };
        this.player = player;
        this.roomId = msg.roomId;
        resolve(player);
      });

      // Timeout
      setTimeout(() => reject(new Error("Connection timeout")), 20000);
    });
  }

  private handleMessage(msg: ServerMessage): void {
    const once = this.onceHandlers.get(msg.type);
    if (once) {
      this.onceHandlers.delete(msg.type);
      once(msg);
    }

    const handler = this.messageHandlers.get(msg.type);
    if (handler) {
      handler(msg);
    }

    // Handle pong
    if (msg.type === MESSAGE_TYPES.PONG && this.player) {
      this.player.lastPing = Date.now();
    }

    // Store room state for immediate access
    if (msg.type === MESSAGE_TYPES.ROOM_STATE) {
      this.roomState = msg.payload;
    }
    if (msg.type === MESSAGE_TYPES.SESSION) {
      this.lastSession = msg.payload;
    }
  }

  once(type: string, handler: (msg: ServerMessage) => void): void {
    this.onceHandlers.set(type, handler);
  }

  on(type: string, handler: (msg: ServerMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  off(type: string): void {
    this.messageHandlers.delete(type);
  }

  private sendJoin(): void {
    const msg: ClientMessage = {
      type: MESSAGE_TYPES.JOIN,
      roomId: this.config.roomId ?? "",
      timestamp: Date.now(),
      payload: { name: this.config.name, rejoinToken: this.config.rejoinToken },
    };
    this.ws?.send(JSON.stringify(msg));
  }

  sendInput(input: unknown): void {
    if (!this.player) return;
    const msg: ClientMessage = {
      type: MESSAGE_TYPES.INPUT,
      roomId: this.roomId,
      playerId: this.player.id,
      timestamp: Date.now(),
      payload: input,
    };
    this.ws?.send(JSON.stringify(msg));
  }

  sendSessionVote(gameId: string): void {
    if (!this.player) return;
    const msg: ClientMessage = {
      type: MESSAGE_TYPES.SESSION_VOTE,
      roomId: this.roomId,
      playerId: this.player.id,
      timestamp: Date.now(),
      payload: { gameId },
    };
    this.ws?.send(JSON.stringify(msg));
  }

  /** Resolve with the next session payload that satisfies `predicate`. */
  waitForSession(
    predicate: (payload: SessionMessage["payload"]) => boolean = () => true,
    timeoutMs = 5000,
  ): Promise<SessionMessage["payload"]> {
    if (this.lastSession && predicate(this.lastSession)) {
      return Promise.resolve(this.lastSession);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(MESSAGE_TYPES.SESSION);
        reject(new Error("Session timeout"));
      }, timeoutMs);
      this.on(MESSAGE_TYPES.SESSION, (msg) => {
        if (msg.type !== MESSAGE_TYPES.SESSION) return;
        if (predicate(msg.payload)) {
          clearTimeout(timer);
          this.off(MESSAGE_TYPES.SESSION);
          resolve(msg.payload);
        }
      });
    });
  }

  sendPing(): void {
    if (!this.player) return;
    const msg: ClientMessage = {
      type: MESSAGE_TYPES.PING,
      roomId: this.roomId,
      playerId: this.player.id,
      timestamp: Date.now(),
    };
    this.ws?.send(JSON.stringify(msg));
  }

  waitForGameState(timeoutMs = 5000): Promise<{ screen: unknown; controller: unknown }> {
    return new Promise((resolve, reject) => {
      this.once(MESSAGE_TYPES.GAME_STATE, (msg) => {
        if (msg.type !== MESSAGE_TYPES.GAME_STATE) return;
        resolve(msg.payload as { screen: unknown; controller: unknown });
      });
      setTimeout(() => reject(new Error("Game state timeout")), timeoutMs);
    });
  }

  waitForRoomState(timeoutMs = 5000): Promise<RoomStateMessage["payload"]> {
    return new Promise((resolve, reject) => {
      this.once(MESSAGE_TYPES.ROOM_STATE, (msg) => {
        if (msg.type !== MESSAGE_TYPES.ROOM_STATE) return;
        resolve(msg.payload);
      });
      setTimeout(() => reject(new Error("Room state timeout")), timeoutMs);
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  async reconnect(): Promise<BotPlayer> {
    if (!this.player?.rejoinToken) throw new Error("No rejoin token");
    this.config.rejoinToken = this.player.rejoinToken;
    return this.connect();
  }
}

export async function createBots(count: number, baseUrl: string, namePrefix = "Bot"): Promise<BotClient[]> {
  const bots: BotClient[] = [];
  let roomId = "";
  
  for (let i = 0; i < count; i++) {
    const config: BotConfig = { name: `${namePrefix}-${i + 1}`, roomUrl: baseUrl };
    if (i > 0 && roomId) {
      config.roomId = roomId;
    }
    const bot = new BotClient(config);
    await bot.connect();
    if (i === 0) {
      roomId = bot.roomId;
    }
    bots.push(bot);
  }
  return bots;
}