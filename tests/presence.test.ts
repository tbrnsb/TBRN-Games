/**
 * Presence, mid-game spectators and audience reactions (Phase 2, piece 5a).
 *
 * A phone that drops is marked `away` immediately and keeps its seat for the
 * existing 30-second grace. A phone that chooses `leave` is marked `left` but
 * keeps its room row and score. A phone that joins while a game is running
 * becomes a spectator: it sees the TV state, gets no playable controller and
 * cannot affect the game, but it can send reactions.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";
import { REACTIONS, isReaction, reactionById } from "../shared/reactions.ts";

interface Phone {
  ws: WebSocket;
  playerId: string;
  token: string;
  roomId: string;
  errors: string[];
  room: any;
  game: any;
  reactions: any[];
}

function joinPhone(wsUrl: string, name: string, roomId = "", rejoinToken = ""): Promise<Phone> {
  const ws = new WebSocket(wsUrl);
  const phone: Phone = { ws, playerId: "", token: "", roomId: "", errors: [], room: null, game: null, reactions: [] };
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "joined") {
      phone.playerId = msg.payload.playerId;
      phone.token = msg.payload.rejoinToken;
      phone.roomId = msg.roomId;
    }
    if (msg.type === "roomState") phone.room = msg.payload;
    if (msg.type === "gameState") phone.game = msg.payload;
    if (msg.type === "reaction") phone.reactions.push(msg.payload);
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

async function waitFor(check: () => boolean, timeoutMs = 4000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function playerIn(phone: Phone, playerId: string): any {
  return phone.room?.players?.find((p: any) => p.id === playerId);
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

async function startGame(httpUrl: string, roomId: string, gameId: string, hostToken: string): Promise<number> {
  const res = await fetch(`${httpUrl}/api/rooms/${roomId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-token": hostToken },
    body: JSON.stringify({ gameId }),
  });
  return res.status;
}

async function endGame(httpUrl: string, roomId: string, hostToken: string): Promise<number> {
  const res = await fetch(`${httpUrl}/api/rooms/${roomId}/end-game`, {
    method: "POST",
    headers: { "x-host-token": hostToken },
  });
  return res.status;
}

function sendReaction(phone: Phone, id: string): void {
  phone.ws.send(JSON.stringify({
    type: "reaction",
    roomId: phone.roomId,
    playerId: phone.playerId,
    timestamp: Date.now(),
    payload: { id },
  }));
}

function sendLeave(phone: Phone): void {
  phone.ws.send(JSON.stringify({
    type: "leave",
    roomId: phone.roomId,
    playerId: phone.playerId,
    timestamp: Date.now(),
  }));
}

function closeAll(phones: Phone[]): void {
  for (const p of phones) p.ws.close();
}

describe("audience reactions module", () => {
  test("exactly eight unique reactions are allowed", () => {
    assert.strictEqual(REACTIONS.length, 8);
    assert.strictEqual(new Set(REACTIONS.map((r) => r.id)).size, 8);
    for (const reaction of REACTIONS) {
      assert.ok(reaction.emoji.length > 0, "every reaction has an emoji");
      assert.ok(isReaction(reaction.id), `${reaction.id} is allowed`);
    }
    assert.strictEqual(isReaction("nope"), false);
    assert.strictEqual(isReaction(undefined), false);
    assert.strictEqual(reactionById("nope"), null);
  });
});

describe("presence, spectators and reactions", () => {
  let fixture: ServerFixture;

  before(async () => {
    fixture = await startServer({ PLAYER_TIMEOUT_MS: "1000" });
  });

  after(() => fixture?.stop());

  test("a socket close marks the player away and a token rejoin restores active", async () => {
    const a = await joinPhone(fixture.wsUrl, "Ana");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Ben", roomId);
    await sleep(200);

    b.ws.close();
    await waitFor(() => playerIn(a, b.playerId)?.presence === "away", 1000, "away presence");
    assert.strictEqual(playerIn(a, b.playerId).connected, false, "away keeps connected=false");

    const b2 = await joinPhone(fixture.wsUrl, "Ben", roomId, b.token);
    await waitFor(() => playerIn(a, b.playerId)?.presence === "active", 1000, "active presence");
    assert.strictEqual(b2.playerId, b.playerId, "the token returns to the same seat");
    assert.strictEqual(playerIn(a, b.playerId).connected, true);

    closeAll([a, b2]);
  });

  test("an explicit leave marks the player left and keeps the room row and score", async () => {
    const a = await joinPhone(fixture.wsUrl, "Cara");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Dev", roomId);
    await sleep(200);

    const hostToken = await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(await startGame(fixture.httpUrl, roomId, "mindmeld", hostToken), 200);
    await waitFor(() => !!a.game?.screen?.scores, 2000, "first game frame");

    sendLeave(b);
    await waitFor(() => playerIn(a, b.playerId)?.presence === "left", 1000, "left presence");
    assert.strictEqual(playerIn(a, b.playerId).connected, false);
    assert.strictEqual(a.room.players.length, 2, "the row stays in the room list");
    assert.ok(
      a.game.screen.scores.some((row: any) => row.name === "Dev"),
      "the score row stays on the board",
    );

    // A player who left cannot react.
    sendReaction(b, "laugh");
    await waitFor(() => b.errors.includes("REACTION_NOT_ALLOWED"), 1000, "reaction rejection for left player");
    assert.strictEqual(b.reactions.length, 0);

    closeAll([a, b]);
  });

  test("a phone joining mid-game is a spectator with no playable controller", async () => {
    const a = await joinPhone(fixture.wsUrl, "Eve");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Finn", roomId);
    await sleep(200);

    const hostToken = await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(await startGame(fixture.httpUrl, roomId, "mindmeld", hostToken), 200);
    await waitFor(() => !!a.game?.screen?.phase, 2000, "game running");

    const c = await joinPhone(fixture.wsUrl, "Gia", roomId);
    await waitFor(() => playerIn(c, c.playerId)?.spectator === true, 1000, "spectator seat");
    assert.deepStrictEqual(c.errors, [], "no GAME_IN_PROGRESS for a mid-game join");
    assert.strictEqual(playerIn(c, c.playerId).presence, "active");

    await waitFor(() => c.game?.controller?.spectator === true, 1000, "spectator controller payload");
    assert.ok(c.game.screen && typeof c.game.screen === "object", "spectator receives the TV screen state");

    // A spectator input is ignored: it never turns into a playable controller.
    c.ws.send(JSON.stringify({
      type: "input",
      roomId,
      playerId: c.playerId,
      timestamp: Date.now(),
      payload: { text: "hijack" },
    }));
    await sleep(300);
    assert.deepStrictEqual(c.errors, [], "a spectator input is dropped silently");
    assert.strictEqual(c.game?.controller?.spectator, true, "the spectator stays a spectator");

    closeAll([a, b, c]);
  });

  test("spectators count toward the eight-seat ceiling and a ninth join is ROOM_FULL", async () => {
    const players = [];
    const first = await joinPhone(fixture.wsUrl, "Hana");
    await sleep(150);
    players.push(first);
    for (const name of ["Ivo", "Jun", "Kai"]) {
      players.push(await joinPhone(fixture.wsUrl, name, first.roomId));
      await sleep(80);
    }
    await sleep(200);

    const hostToken = await connectScreen(fixture.wsUrl, first.roomId);
    assert.strictEqual(await startGame(fixture.httpUrl, first.roomId, "mindmeld", hostToken), 200);

    for (const name of ["Lea", "Moe", "Nia", "Oli"]) {
      players.push(await joinPhone(fixture.wsUrl, name, first.roomId));
      await sleep(80);
    }
    await waitFor(() => first.room?.players.length === 8, 2000, "eight seats with spectators");

    const ninth = await joinPhone(fixture.wsUrl, "Pia", first.roomId);
    await waitFor(() => ninth.errors.includes("ROOM_FULL"), 1000, "ninth seat rejected");

    closeAll([...players, ninth]);
  });

  test("the lobby clears spectator flags and promotes them for the next game", async () => {
    const a = await joinPhone(fixture.wsUrl, "Quin");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Rae", roomId);
    await sleep(200);

    const hostToken = await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(await startGame(fixture.httpUrl, roomId, "mindmeld", hostToken), 200);

    const c = await joinPhone(fixture.wsUrl, "Sol", roomId);
    await waitFor(() => playerIn(c, c.playerId)?.spectator === true, 1500, "spectator seat");

    assert.strictEqual(await endGame(fixture.httpUrl, roomId, hostToken), 200);
    await waitFor(() => c.room?.status === "lobby", 1500, "back in the lobby");
    assert.notStrictEqual(playerIn(c, c.playerId)?.spectator, true, "spectator flag is cleared");

    // The promoted seat can play the next game.
    assert.strictEqual(await startGame(fixture.httpUrl, roomId, "mindmeld", hostToken), 200);
    await waitFor(() => !!c.game?.controller && c.game.controller.spectator !== true, 2000, "playable controller");
    assert.strictEqual(typeof c.game.controller.hasSubmitted, "boolean", "the promoted phone gets a real player payload");

    closeAll([a, b, c]);
  });

  test("reactions validate the id, allow spectators and enforce the two-second limit", async () => {
    const a = await joinPhone(fixture.wsUrl, "Tara");
    await sleep(150);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Ulf", roomId);
    await sleep(200);

    const hostToken = await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(await startGame(fixture.httpUrl, roomId, "mindmeld", hostToken), 200);

    const c = await joinPhone(fixture.wsUrl, "Vik", roomId);
    await waitFor(() => playerIn(c, c.playerId)?.spectator === true, 1500, "spectator seat");

    // Unknown ids are rejected.
    sendReaction(a, "not-a-reaction");
    await waitFor(() => a.errors.includes("REACTION_INVALID"), 1000, "invalid reaction error");
    await sleep(100);
    assert.strictEqual(b.reactions.length, 0, "nothing broadcast for an invalid id");

    // A player reaction reaches the TV and the phones, with the seat identity.
    const laugh = reactionById("laugh")!;
    sendReaction(a, laugh.id);
    await waitFor(() => b.reactions.length === 1, 1000, "player reaction broadcast");
    assert.strictEqual(b.reactions[0].playerId, a.playerId);
    assert.strictEqual(b.reactions[0].name, "Tara");
    assert.strictEqual(b.reactions[0].id, laugh.id);
    assert.strictEqual(b.reactions[0].emoji, laugh.emoji);
    assert.ok(b.reactions[0].seat && typeof b.reactions[0].seat.color === "string", "reaction carries the seat colour");
    await waitFor(() => c.reactions.length === 1, 1000, "spectator phone receives the reaction");

    // The second reaction inside two seconds is refused.
    sendReaction(a, "fire");
    await waitFor(() => a.errors.includes("REACTION_RATE_LIMITED"), 1000, "rate limit error");
    await sleep(100);
    assert.strictEqual(b.reactions.length, 1, "no second broadcast inside the cooldown");

    // Spectators may react.
    sendReaction(c, "fire");
    await waitFor(() => b.reactions.length === 2, 1000, "spectator reaction broadcast");
    assert.strictEqual(b.reactions[1].playerId, c.playerId);

    // After the cooldown the player can react again on the server clock.
    await sleep(2100);
    sendReaction(a, "clap");
    await waitFor(() => b.reactions.length === 3, 1500, "reaction after the cooldown");
    assert.strictEqual(b.reactions[2].playerId, a.playerId);

    closeAll([a, b, c]);
  });
});
