/**
 * Royal Rumble end-to-end: real server, real sockets, HTTP host endpoints.
 * Covers voting transport, starting a round, aborting with End game, finishing
 * a round for placement points, and clearing the session.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { createBots } from "./bot-client.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";
import { MESSAGE_TYPES } from "../shared/constants.js";
import type { ServerMessage } from "../shared/types.ts";

describe("Royal Rumble server flow", () => {
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

    let hostToken = "";
    await new Promise<void>((resolve, reject) => {
      let joined = false;
      screen.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
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

  test("votes pick the round, End game aborts it, and a finished round scores", async () => {
    const bots = await createBots(3, wsUrl, "RumbleBot");
    const screen = await connectScreen(bots[0].roomId);
    const host = { "Content-Type": "application/json", "x-host-token": screen.hostToken };

    try {
      const startRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ length: 5, selection: "vote" }),
      });
      assert.strictEqual(startRes.status, 200);
      const started = (await startRes.json()) as { session: { length: number; status: string } };
      assert.strictEqual(started.session.length, 5);
      assert.strictEqual(started.session.status, "voting");

      // A brand-new seat cannot join mid-rumble (it would never be scored).
      const late = new WebSocket(wsUrl);
      const lateError = await new Promise<string>((resolve, reject) => {
        late.on("open", () => {
          late.send(JSON.stringify({
            type: "join",
            roomId: bots[0].roomId,
            timestamp: Date.now(),
            payload: { name: "Latecomer" },
          }));
        });
        late.on("message", (data) => {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          if (msg.type === "error") resolve(msg.payload.code);
        });
        late.on("error", reject);
        setTimeout(() => reject(new Error("late join timeout")), 5000);
      });
      assert.strictEqual(lateError, "SESSION_IN_PROGRESS");
      late.close();

      // Every phone can vote; the shared view counts them.
      for (const bot of bots) bot.sendSessionVote("racing");
      const voted = await bots[0].waitForSession(
        (payload) => payload.session?.votes.find((v) => v.gameId === "racing")?.count === 3,
      );
      assert.strictEqual(voted.session?.leadingGameId, "racing");
      assert.strictEqual(voted.session?.voted, 3);

      // A game outside the catalogue is rejected by the host endpoint.
      const outsider = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ gameId: "not-a-game" }),
      });
      assert.strictEqual(outsider.status, 400);

      // Start the winning candidate.
      const playRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ gameId: "racing" }),
      });
      assert.strictEqual(playRes.status, 200);
      const playing = await bots[0].waitForSession(
        (payload) => payload.session?.status === "playing",
      );
      assert.strictEqual(playing.session?.currentGameId, "racing");

      // Host aborts the running round: back to voting, still round 1, no points.
      const endRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/end-game`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(endRes.status, 200);
      const aborted = await bots[0].waitForSession(
        (payload) => payload.session?.status === "voting" && payload.session?.round === 1,
      );
      assert.strictEqual(aborted.session?.votes.every((v) => v.count === 0), true);
      assert.strictEqual(aborted.session?.standings.every((s) => s.points === 0), true);
      assert.strictEqual(aborted.session?.played.length, 0);

      // Play it through: the final state awards 10/6/3 by placement.
      const replay = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ gameId: "racing" }),
      });
      assert.strictEqual(replay.status, 200);
      await bots[0].waitForSession((payload) => payload.session?.status === "playing");

      let finished = false;
      bots[0].on(MESSAGE_TYPES.GAME_STATE, (msg) => {
        if (msg.type !== MESSAGE_TYPES.GAME_STATE) return;
        const screen = msg.payload.screen as { finished?: boolean };
        if (screen?.finished === true) finished = true;
      });

      // Tap Race ends on the tick it crosses the line and stops broadcasting
      // afterwards, so watch a persistent listener instead of racing the last
      // state. 25 ms between taps stays under the server's 50 msg/s limit.
      const deadline = Date.now() + 20000;
      while (!finished && Date.now() < deadline) {
        for (const bot of bots) bot.sendInput({ tap: true });
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.strictEqual(finished, true, "tap race should report a finished screen");

      const scored = await bots[0].waitForSession(
        (payload) => payload.session?.round === 2 && payload.session?.status === "voting",
        8000,
      );
      const points = scored.session?.standings.map((s) => s.points) ?? [];
      assert.deepStrictEqual(points, [10, 6, 3]);
      assert.strictEqual(scored.session?.played[0], "racing");
      assert.strictEqual(
        scored.session?.candidates.some((g) => g.id === "racing"),
        false,
        "played games drop out of the candidate list",
      );

      // Clearing the session returns phones and host to the normal lobby.
      const clearRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/end`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(clearRes.status, 200);
      const cleared = await bots[0].waitForSession((payload) => payload.session === null);
      assert.strictEqual(cleared.session, null);
    } finally {
      screen.ws.close();
      for (const bot of bots) bot.disconnect();
    }
  });
});
