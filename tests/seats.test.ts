/**
 * Phase 2 — 8-seat rooms and colour-blind-safe seat identity.
 *
 * Covers the platform ceiling (8 phones, 9th rejected), the seat identity list
 * (8 unique colours AND 8 unique shapes), and the server-side name rules
 * (12-character cap, automatic deduplication, empty-name rejection).
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { SEATS, SEAT_COUNT, seatForIndex, seatForPlayer } from "../shared/seat-identity.ts";
import type { RoomStateAny } from "../shared/types.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

interface RawJoin {
  ws: WebSocket;
  playerId?: string;
  roomState?: RoomStateAny;
  code?: string;
}

/** Join the real server over the phone protocol and resolve on the first reply. */
function rawJoin(
  wsUrl: string,
  roomId: string,
  name: string,
  timeoutMs = 5000,
): Promise<RawJoin> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`join timeout for ${name}`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "join",
        roomId,
        timestamp: Date.now(),
        payload: { name },
      }));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as {
        type: string;
        payload?: { playerId?: string; roomState?: RoomStateAny; code?: string };
      };
      if (msg.type === "joined") {
        clearTimeout(timer);
        resolve({ ws, playerId: msg.payload?.playerId, roomState: msg.payload?.roomState });
      } else if (msg.type === "error") {
        clearTimeout(timer);
        resolve({ ws, code: msg.payload?.code });
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("seat identity", () => {
  test("has eight seats with unique colours, shapes and glyphs", () => {
    assert.strictEqual(SEAT_COUNT, 8);
    assert.strictEqual(SEATS.length, 8);
    assert.strictEqual(new Set(SEATS.map((seat) => seat.color)).size, 8);
    assert.strictEqual(new Set(SEATS.map((seat) => seat.shape)).size, 8);
    assert.strictEqual(new Set(SEATS.map((seat) => seat.emoji)).size, 8);

    for (const seat of SEATS) {
      assert.strictEqual(seatForIndex(seat.index), seat);
      assert.match(seat.color, /^#[0-9A-F]{6}$/i);
      assert.ok(seat.emoji.length > 0);
    }
  });

  test("wraps seat indexes and finds a player's seat", () => {
    assert.strictEqual(seatForIndex(8), SEATS[0]);
    assert.strictEqual(seatForIndex(-1), SEATS[7]);
    assert.strictEqual(seatForIndex(3.9), SEATS[3]);

    const players = [
      { id: "a", seat: SEATS[2] },
      { id: "b", seat: SEATS[5] },
    ];
    assert.strictEqual(seatForPlayer(players, "b")?.shape, SEATS[5].shape);
    assert.strictEqual(seatForPlayer(players, "missing"), null);
  });
});

describe("8-seat rooms", () => {
  let fixture: ServerFixture;
  let wsUrl: string;

  before(async () => {
    fixture = await startServer();
    wsUrl = fixture.wsUrl;
  });

  after(() => {
    fixture?.stop();
  });

  test("eight phones fill the lobby and the ninth gets ROOM_FULL", async () => {
    const joined: RawJoin[] = [];
    try {
      const first = await rawJoin(wsUrl, "", "P1");
      assert.ok(first.roomState, "first join must return room state");
      const roomId = first.roomState.id;
      joined.push(first);

      for (let i = 2; i <= 8; i++) {
        joined.push(await rawJoin(wsUrl, roomId, `P${i}`));
      }

      const room = joined[joined.length - 1].roomState;
      assert.ok(room);
      assert.strictEqual(room.players.length, 8);

      const seats = room.players.map((player) => player.seat);
      assert.ok(seats.every((seat) => !!seat), "every player carries a seat");
      assert.deepStrictEqual(
        seats.map((seat) => seat!.index).sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7],
      );
      assert.strictEqual(new Set(seats.map((seat) => seat!.color)).size, 8);
      assert.strictEqual(new Set(seats.map((seat) => seat!.shape)).size, 8);

      const ninth = await rawJoin(wsUrl, roomId, "P9");
      assert.strictEqual(ninth.code, "ROOM_FULL");
      ninth.ws.close();
    } finally {
      for (const join of joined) join.ws.close();
    }
  });

  test("joining three players called Ana produces deduplicated names", async () => {
    const joined: RawJoin[] = [];
    try {
      const first = await rawJoin(wsUrl, "", "Ana");
      assert.ok(first.roomState);
      const roomId = first.roomState.id;
      joined.push(first);

      joined.push(await rawJoin(wsUrl, roomId, "Ana"));
      const third = await rawJoin(wsUrl, roomId, "Ana");
      joined.push(third);

      assert.deepStrictEqual(
        third.roomState?.players.map((player) => player.name),
        ["Ana", "Ana 2", "Ana 3"],
      );
      // Names are trimmed before the cap and the suffix.
      const fourth = await rawJoin(wsUrl, roomId, "  Bo  ");
      joined.push(fourth);
      assert.strictEqual(
        fourth.roomState?.players.find((player) => player.id === fourth.playerId)?.name,
        "Bo",
      );
    } finally {
      for (const join of joined) join.ws.close();
    }
  });

  test("a 20-character name is capped to 12 characters", async () => {
    const joined = await rawJoin(wsUrl, "", "ABCDEFGHIJKLMNOPQRST");
    try {
      const player = joined.roomState?.players.find((p) => p.id === joined.playerId);
      assert.ok(player);
      assert.strictEqual(player.name, "ABCDEFGHIJKL");
      assert.strictEqual(Array.from(player.name).length, 12);
    } finally {
      joined.ws.close();
    }
  });

  test("an empty name is rejected with the existing INVALID_NAME path", async () => {
    const joined = await rawJoin(wsUrl, "", "   ");
    try {
      assert.strictEqual(joined.code, "INVALID_NAME");
    } finally {
      joined.ws.close();
    }
  });
});
