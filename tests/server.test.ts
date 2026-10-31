import { test, before, after, describe } from "node:test";
import assert from "node:assert";
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

    // Start the game via HTTP endpoint
    const startRes = await fetch(`${httpUrl}/api/rooms/${bot1.roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "darts" }),
    });
    assert.strictEqual(startRes.status, 200);

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
});
