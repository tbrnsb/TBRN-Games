/**
 * Regression tests for the "one player randomly disappears" bug.
 *
 * Phones drop their WebSocket constantly (screen lock, app switch, WiFi
 * hiccup). The server used to delete the seat after PLAYER_TIMEOUT_MS, which
 * meant a phone that locked itself in the lobby was gone for the rest of the
 * night: the rejoin token no longer matched anything, so it got INVALID_TOKEN
 * and the host started games with one fewer player. With Bluff/Write & Vote
 * (min 3) the game then refused to start at all.
 *
 * These tests use a 250 ms timeout so the reap path runs in milliseconds.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

interface Phone {
  ws: WebSocket;
  playerId: string;
  token: string;
  roomId: string;
  errors: string[];
  room: any;
}

function joinPhone(wsUrl: string, name: string, roomId = "", rejoinToken = ""): Promise<Phone> {
  const ws = new WebSocket(wsUrl);
  const phone: Phone = { ws, playerId: "", token: "", roomId: "", errors: [], room: null };
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "joined") {
      phone.playerId = msg.payload.playerId;
      phone.token = msg.payload.rejoinToken;
      phone.roomId = msg.roomId;
    }
    if (msg.type === "roomState") phone.room = msg.payload;
    if (msg.type === "error") phone.errors.push(msg.payload.code);
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "join",
        roomId,
        timestamp: Date.now(),
        payload: { name, rejoinToken: rejoinToken || undefined },
      }));
      resolve(phone);
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("phone connect timeout")), 5000);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startGame(httpUrl: string, roomId: string, gameId: string, hostToken: string) {
  return fetch(`${httpUrl}/api/rooms/${roomId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-token": hostToken },
    body: JSON.stringify({ gameId }),
  });
}

async function connectScreen(wsUrl: string, roomId: string): Promise<string> {
  const ws = new WebSocket(wsUrl);
  let hostToken = "";
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", roomId, timestamp: Date.now(), payload: { name: "Screen", role: "screen" } }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "joined" && typeof msg.payload?.hostToken === "string") hostToken = msg.payload.hostToken;
      if (msg.type === "roomState" && hostToken) resolve();
    });
    setTimeout(() => reject(new Error("screen timeout")), 5000);
  });
  return hostToken;
}

describe("phone reconnection", () => {
  let fixture: ServerFixture;

  before(async () => {
    fixture = await startServer({ PLAYER_TIMEOUT_MS: "250" });
  });

  after(() => fixture?.stop());

  test("a phone that drops in the lobby keeps its seat past the timeout", async () => {
    const a = await joinPhone(fixture.wsUrl, "Alice");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Bob", roomId);
    const c = await joinPhone(fixture.wsUrl, "Carol", roomId);
    await sleep(250);

    assert.strictEqual(c.room.players.length, 3, "three seats before the drop");

    // Carol's screen locks.
    c.ws.close();
    await sleep(700); // well past PLAYER_TIMEOUT_MS

    const last = a.room;
    assert.strictEqual(last.players.length, 3, "seat must survive the reap timeout");
    const carol = last.players.find((p: any) => p.name === "Carol");
    assert.ok(carol, "Carol is still in the room");
    assert.strictEqual(carol.connected, false, "Carol is marked away");

    // She comes back with her token.
    const c2 = await joinPhone(fixture.wsUrl, "Carol", roomId, c.token);
    await sleep(250);
    assert.deepStrictEqual(c2.errors, [], "no INVALID_TOKEN on reconnect");
    assert.strictEqual(c2.playerId, c.playerId, "she gets her original seat back");
    assert.strictEqual(a.room.players.filter((p: any) => p.connected).length, 3, "all three connected again");

    for (const p of [a, b, c2]) p.ws.close();
  });

  test("a stale token recovers into a lobby room instead of locking the phone out", async () => {
    const a = await joinPhone(fixture.wsUrl, "Dana");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Eli", roomId);
    await sleep(200);

    // A token from some previous night.
    const stale = await joinPhone(fixture.wsUrl, "Dana", roomId, "deadbeefdeadbeefdeadbeef");
    await sleep(250);

    assert.deepStrictEqual(stale.errors, [], "stale token must not be fatal in a lobby");
    assert.ok(stale.playerId, "the phone is seated");
    assert.strictEqual(a.room.players.length, 3, "recovered as a new seat");

    for (const p of [a, b, stale]) p.ws.close();
  });

  test("Bluff starts when all three phones are connected", async () => {
    const a = await joinPhone(fixture.wsUrl, "Fay");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Gus", roomId);
    const c = await joinPhone(fixture.wsUrl, "Hal", roomId);
    await sleep(250);

    const hostToken = await connectScreen(fixture.wsUrl, roomId);
    const res = await startGame(fixture.httpUrl, roomId, "bluff", hostToken);
    assert.strictEqual(res.status, 200, `bluff must start with 3 players (got ${res.status})`);

    for (const p of [a, b, c]) p.ws.close();
  });
});
