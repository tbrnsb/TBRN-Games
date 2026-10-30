import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { createBots, BotClient } from "./bot-client.ts";

const BASE_URL = process.env.TBRN_TEST_URL ?? "ws://localhost:3000";
// let serverProcess: unknown; // For future use

describe("TBRN-Games Server", () => {
  before(async () => {
    // Server should already be running for these tests
    // In CI, we'd start it here
  });

  after(async () => {
    // Cleanup
  });

  test("4 bots can join and receive room state", async () => {
    const bots = await createBots(4, BASE_URL, "TestBot");
    assert.strictEqual(bots.length, 4);

    // Wait for all to get room state
    for (const bot of bots) {
      const roomState = await bot.waitForRoomState();
      assert.ok(roomState);
      assert.strictEqual(roomState.players.length, 4);
    }

    // Cleanup
    for (const bot of bots) bot.disconnect();
  });

  test("bot can reconnect with rejoin token", async () => {
    const bots = await createBots(1, BASE_URL, "RejoinBot");
    const bot = bots[0];
    const token = bot.player?.rejoinToken;
    assert.ok(token);

    bot.disconnect();

    // Reconnect
    const newBot = new BotClient({ name: "RejoinBot-1", roomUrl: BASE_URL, rejoinToken: token });
    await newBot.connect();
    assert.strictEqual(newBot.player?.id, bot.player?.id);

    newBot.disconnect();
  });

  test("tap-counter game: bots can send inputs and receive game state", async () => {
    const bots = await createBots(2, BASE_URL, "GameBot");
    const [bot1, bot2] = bots;

    // Wait for game to start (in real test, we'd trigger game start)
    // For now, just verify we can send inputs
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