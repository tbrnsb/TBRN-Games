import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { createBots, BotClient } from "./bot-client.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

// The fixture spawns a real server on an ephemeral port (or reuses
// TBRN_TEST_URL when set), so these tests run standalone, including in CI.
describe("TBRN-Games Server", () => {
  let fixture: ServerFixture;
  let wsUrl: string;
  let httpUrl: string;

  before(async () => {
    fixture = await startServer();
    wsUrl = fixture.wsUrl;
    httpUrl = fixture.httpUrl;
  });

  async function connectScreen(roomId: string): Promise<{ ws: WebSocket; hostToken: string }> {
    const screen = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      screen.on("open", () => {
        screen.send(JSON.stringify({
          type: "join",
          roomId,
          timestamp: Date.now(),
          payload: { name: "Screen", role: "screen" },
        }));
        resolve();
      });
      screen.on("error", reject);
      setTimeout(() => reject(new Error("Screen connect timeout")), 5000);
    });
    // Wait for JOINED and ROOM_STATE, capturing the host token.
    let hostToken = "";
    await new Promise<void>((resolve, reject) => {
      let joined = false;
      screen.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "joined") {
          joined = true;
          if (typeof msg.payload?.hostToken === "string") hostToken = msg.payload.hostToken;
        }
        if (msg.type === "roomState" && joined) {
          screen.removeAllListeners("message");
          resolve();
        }
      });
      setTimeout(() => reject(new Error("Screen ready timeout")), 5000);
    });
    assert.ok(hostToken, "screen join must return a host token");
    return { ws: screen, hostToken };
  }

  after(() => {
    fixture?.stop();
  });

  test("4 bots can join and receive room state", async () => {
    const bots = await createBots(4, wsUrl, "TestBot");
    assert.strictEqual(bots.length, 4);

    // Wait a bit for all room state broadcasts to propagate
    await new Promise(r => setTimeout(r, 100));

    // Check all bots have room state (received during connect)
    for (const bot of bots) {
      const roomState = bot.roomState;
      assert.ok(roomState);
      assert.strictEqual(roomState.players.length, 4);
    }

    // Cleanup
    for (const bot of bots) bot.disconnect();
  });

  test("bot can reconnect with rejoin token", async () => {
    const bots = await createBots(1, wsUrl, "RejoinBot");
    const bot = bots[0];
    const token = bot.player?.rejoinToken;
    const originalPlayerId = bot.player?.id;
    assert.ok(token);
    assert.ok(originalPlayerId);

    bot.disconnect();

    // Reconnect
    const newBot = new BotClient({ name: "RejoinBot-1", roomUrl: wsUrl, rejoinToken: token });
    await newBot.connect();
    assert.strictEqual(newBot.player?.id, originalPlayerId);

    newBot.disconnect();
  });

  test("darts game: bots can send inputs and receive game state", async () => {
    const bots = await createBots(2, wsUrl, "GameBot");
    const [bot1, bot2] = bots;

    // Connect screen (required for game start auth)
    const screen = await connectScreen(bot1.roomId);

    // Start the game via HTTP endpoint
    const startRes = await fetch(`${httpUrl}/api/rooms/${bot1.roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": screen.hostToken },
      body: JSON.stringify({ gameId: "darts" }),
    });
    assert.strictEqual(startRes.status, 200);

    // Clean up screen after test
    screen.ws.close();

    // Wait a bit for game loop to start
    await new Promise(r => setTimeout(r, 100));

    // Send inputs (darts uses tap to throw)
    bot1.sendInput({ tap: true });
    bot2.sendInput({ tap: true });

    // Wait for game state update
    const state1 = await bot1.waitForGameState(3000);
    const state2 = await bot2.waitForGameState(3000);

    assert.ok(state1.controller);
    assert.ok(state2.controller);

    for (const bot of bots) bot.disconnect();
  });

  test("starting a game requires the host screen token", async () => {
    const bots = await createBots(1, wsUrl, "AuthBot");
    const bot = bots[0];
    const screen = await connectScreen(bot.roomId);

    const noToken = await fetch(`${httpUrl}/api/rooms/${bot.roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "darts" }),
    });
    assert.strictEqual(noToken.status, 403);

    const wrongToken = await fetch(`${httpUrl}/api/rooms/${bot.roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": "not-the-token" },
      body: JSON.stringify({ gameId: "darts" }),
    });
    assert.strictEqual(wrongToken.status, 403);

    screen.ws.close();
    bot.disconnect();
  });

  test("new players cannot join a room mid-game", async () => {
    const bots = await createBots(2, wsUrl, "MidGameBot");
    const [bot1] = bots;
    const screen = await connectScreen(bot1.roomId);

    const startRes = await fetch(`${httpUrl}/api/rooms/${bot1.roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": screen.hostToken },
      body: JSON.stringify({ gameId: "darts" }),
    });
    assert.strictEqual(startRes.status, 200);

    const late = new WebSocket(wsUrl);
    const code = await new Promise<string>((resolve, reject) => {
      late.on("open", () => {
        late.send(JSON.stringify({
          type: "join",
          roomId: bot1.roomId,
          timestamp: Date.now(),
          payload: { name: "LateJoiner" },
        }));
      });
      late.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "error") resolve(msg.payload.code);
      });
      late.on("error", reject);
      setTimeout(() => reject(new Error("no error reply")), 3000);
    });
    assert.strictEqual(code, "GAME_IN_PROGRESS");

    late.close();
    screen.ws.close();
    for (const bot of bots) bot.disconnect();
  });
});
