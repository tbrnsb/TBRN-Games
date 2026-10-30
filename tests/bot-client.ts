import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Player } from "../shared/types.ts";
import { MESSAGE_TYPES } from "../shared/constants.js";

export interface BotConfig {
  name: string;
  roomUrl: string; // ws://host:port
  rejoinToken?: string;
}

export interface BotPlayer extends Player {
  ws: WebSocket;
  connected: boolean;
  lastPing: number;
}

export class BotClient {
  public player: BotPlayer | null = null;
  public roomId: string = "";
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, (msg: ServerMessage) => void> = new Map();
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
        this.player = {
          id: msg.payload.playerId,
          name: this.config.name,
          joinedAt: Date.now(),
          rejoinToken: msg.payload.rejoinToken,
          connected: true,
        };
        this.roomId = msg.roomId;
        resolve(this.player);
      });

      // Timeout
      setTimeout(() => reject(new Error("Connection timeout")), 10000);
    });
  }

  private handleMessage(msg: ServerMessage): void {
    const handler = this.messageHandlers.get(msg.type);
    if (handler) {
      handler(msg);
      this.messageHandlers.delete(msg.type);
    }

    // Handle pong
    if (msg.type === MESSAGE_TYPES.PONG && this.player) {
      this.player.lastPing = Date.now();
    }
  }

  once(type: string, handler: (msg: ServerMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  on(type: string, handler: (msg: ServerMessage) => void): void {
    // For persistent handlers, wrap to re-register
    const wrapper = (msg: ServerMessage) => {
      handler(msg);
      this.messageHandlers.set(type, wrapper);
    };
    this.messageHandlers.set(type, wrapper);
  }

  private sendJoin(): void {
    const msg: ClientMessage = {
      type: MESSAGE_TYPES.JOIN,
      roomId: "",
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
        resolve(msg.payload as { screen: unknown; controller: unknown });
      });
      setTimeout(() => reject(new Error("Game state timeout")), timeoutMs);
    });
  }

  waitForRoomState(timeoutMs = 5000): Promise<ServerMessage["payload"]> {
    return new Promise((resolve, reject) => {
      this.once(MESSAGE_TYPES.ROOM_STATE, (msg) => {
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
  for (let i = 0; i < count; i++) {
    const bot = new BotClient({ name: `${namePrefix}-${i + 1}`, roomUrl: baseUrl });
    await bot.connect();
    bots.push(bot);
  }
  return bots;
}