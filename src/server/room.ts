import { randomBytes, randomUUID } from "node:crypto";

import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  SEAT_TTL_MS,
  type ErrorCode,
  type PublicPlayer,
  type RoomLobbyState,
} from "../shared/protocol.js";

interface Player {
  id: string;
  name: string;
  token: string;
  connected: boolean;
  expiresAt: number | null;
}

export interface RoomOptions {
  maxPlayers?: number;
  seatTtlMs?: number;
  now?: () => number;
  generateId?: () => string;
  generateToken?: () => string;
}

export type JoinResult =
  | { ok: true; player: PublicPlayer; token: string }
  | { ok: false; code: ErrorCode; message: string };

export type ResumeResult =
  | { ok: true; player: PublicPlayer; token: string }
  | { ok: false; code: ErrorCode; message: string };

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function toPublicPlayer(player: Player): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
  };
}

function normalizeName(rawName: unknown):
  | { ok: true; name: string }
  | { ok: false; message: string } {
  if (typeof rawName !== "string") {
    return { ok: false, message: "Name must be text." };
  }

  const name = rawName.trim();

  if (name.length === 0) {
    return { ok: false, message: "Name is required." };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      message: `Name must be 1-${MAX_NAME_LENGTH} characters.`,
    };
  }

  if (hasControlCharacter(name)) {
    return { ok: false, message: "Name must not contain control characters." };
  }

  return { ok: true, name };
}

export class Room {
  private readonly maxPlayers: number;
  private readonly seatTtlMs: number;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly generateToken: () => string;
  private readonly seats: Player[] = [];
  private currentHostId: string | null = null;

  constructor(options: RoomOptions = {}) {
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
    this.seatTtlMs = options.seatTtlMs ?? SEAT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? (() => randomUUID());
    this.generateToken =
      options.generateToken ?? (() => randomBytes(32).toString("base64url"));
  }

  join(rawName: unknown): JoinResult {
    this.pruneExpired();

    const normalized = normalizeName(rawName);

    if (!normalized.ok) {
      return { ok: false, code: "invalid_name", message: normalized.message };
    }

    if (this.seats.length >= this.maxPlayers) {
      return {
        ok: false,
        code: "room_full",
        message: `Room is full. ${this.maxPlayers} players are already seated.`,
      };
    }

    const player: Player = {
      id: this.generateId(),
      name: normalized.name,
      token: this.generateToken(),
      connected: true,
      expiresAt: null,
    };

    this.seats.push(player);
    this.ensureHost();

    return { ok: true, player: toPublicPlayer(player), token: player.token };
  }

  resume(rawToken: unknown): ResumeResult {
    this.pruneExpired();

    if (typeof rawToken !== "string") {
      return {
        ok: false,
        code: "invalid_token",
        message: "Invalid or expired resume token.",
      };
    }

    const player = this.seats.find((seat) => seat.token === rawToken);

    if (!player) {
      return {
        ok: false,
        code: "invalid_token",
        message: "Invalid or expired resume token.",
      };
    }

    if (player.connected) {
      return {
        ok: false,
        code: "seat_connected",
        message: "That seat is already connected.",
      };
    }

    player.connected = true;
    player.expiresAt = null;
    this.ensureHost();

    return { ok: true, player: toPublicPlayer(player), token: player.token };
  }

  disconnect(playerId: string): boolean {
    const player = this.seats.find((seat) => seat.id === playerId);

    if (!player || !player.connected) {
      return false;
    }

    player.connected = false;
    player.expiresAt = this.now() + this.seatTtlMs;
    this.ensureHost();

    return true;
  }

  pruneExpired(now: number = this.now()): string[] {
    const removed: string[] = [];
    const remaining: Player[] = [];

    for (const player of this.seats) {
      if (
        !player.connected &&
        player.expiresAt !== null &&
        player.expiresAt <= now
      ) {
        removed.push(player.id);
      } else {
        remaining.push(player);
      }
    }

    this.seats.length = 0;
    this.seats.push(...remaining);
    this.ensureHost();

    return removed;
  }

  hostId(): string | null {
    return this.currentHostId;
  }

  connectedPlayers(): PublicPlayer[] {
    return this.seats.filter((player) => player.connected).map(toPublicPlayer);
  }

  playerById(playerId: string): PublicPlayer | undefined {
    const player = this.seats.find((seat) => seat.id === playerId);

    return player ? toPublicPlayer(player) : undefined;
  }

  private ensureHost(): void {
    const current = this.seats.find(
      (player) => player.id === this.currentHostId,
    );

    if (current?.connected) {
      return;
    }

    const nextHost = this.seats.find((player) => player.connected);
    this.currentHostId = nextHost?.id ?? null;
  }

  publicState(): RoomLobbyState {
    return {
      phase: "lobby",
      maxPlayers: this.maxPlayers,
      hostId: this.currentHostId,
      players: this.seats.map(toPublicPlayer),
    };
  }
}
