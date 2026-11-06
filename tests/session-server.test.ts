/**
 * Royal Rumble end-to-end: real server, real sockets, HTTP host endpoints.
 * Covers preset starts, the interlude/next boundary, host skip, end-early and
 * the retired vote message.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBots } from "./bot-client.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";
import { connectScreen, hostHeaders } from "./fixtures/screen-client.ts";
import { MESSAGE_TYPES } from "../shared/constants.js";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { RUMBLE_PRESETS } from "../shared/rumble-presets.ts";
import type { SessionView } from "../shared/types.ts";

interface StartResponse {
  session: SessionView;
}

describe("Royal Rumble server flow", () => {
  let fixture: ServerFixture;
  let wsUrl: string;
  let httpUrl: string;
  let rumbleDir: string;

  before(async () => {
    rumbleDir = mkdtempSync(join(tmpdir(), "tbrn-rumble-flow-"));
    fixture = await startServer({ TBRN_RUMBLE_DIR: rumbleDir });
    wsUrl = fixture.wsUrl;
    httpUrl = fixture.httpUrl;
  });

  after(() => {
    fixture?.stop();
    rmSync(rumbleDir, { recursive: true, force: true });
  });

  function assertValidSlots(view: SessionView, playerCount: number): void {
    assert.strictEqual(view.slots.length, 8, "a preset always exposes eight slot positions");
    const used = new Set<string>();
    let playable = 0;
    for (const slot of view.slots) {
      if (!slot.gameId) continue;
      playable++;
      const entry = GAME_CATALOG[slot.gameId];
      assert.ok(entry, `unknown slot game "${slot.gameId}"`);
      assert.strictEqual(entry.enabled, true, `"${slot.gameId}" is disabled`);
      assert.ok(
        playerCount >= entry.minPlayers && playerCount <= entry.maxPlayers,
        `"${slot.gameId}" does not fit ${playerCount} players`,
      );
      assert.strictEqual(used.has(slot.gameId), false, `"${slot.gameId}" appears twice`);
      used.add(slot.gameId);
    }
    assert.ok(playable >= 6, "at least six of the eight slots must survive resolution");
  }

  test("every preset starts with eight valid slots at 3 and at 8 players", async () => {
    for (const count of [3, 8]) {
      const bots = await createBots(count, wsUrl, `Preset${count}`);
      const screen = await connectScreen(wsUrl, bots[0].roomId);
      try {
        for (const preset of RUMBLE_PRESETS) {
          const res = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
            method: "POST",
            headers: hostHeaders(screen),
            body: JSON.stringify({ presetId: preset.id }),
          });
          assert.strictEqual(res.status, 200, `${preset.id} at ${count} players`);
          const body = (await res.json()) as StartResponse;
          assert.strictEqual(body.session.presetId, preset.id);
          assert.strictEqual(body.session.status, "interlude");
          assertValidSlots(body.session, count);

          // Clear so the next preset can start in the same room.
          const clear = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/end`, {
            method: "POST",
            headers: hostHeaders(screen),
          });
          assert.strictEqual(clear.status, 200);
        }

        const invalid = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
          method: "POST",
          headers: hostHeaders(screen),
          body: JSON.stringify({ presetId: "not-a-preset" }),
        });
        assert.strictEqual(invalid.status, 400);
        const invalidBody = (await invalid.json()) as { code: string };
        assert.strictEqual(invalidBody.code, "INVALID_PRESET");
      } finally {
        screen.close();
        for (const bot of bots) bot.disconnect();
      }
    }
  });

  test("finish, interlude, next, skip, vote no-op and end-early", async () => {
    const bots = await createBots(3, wsUrl, "RumbleBot");
    const screen = await connectScreen(wsUrl, bots[0].roomId);
    const host = hostHeaders(screen);

    try {
      // Sleepover Hours keeps racing on the bench, so a host skip can safely
      // promote it to the first slot without duplicating a playlist game.
      const startRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ presetId: "sleepover-hours" }),
      });
      assert.strictEqual(startRes.status, 200);
      const started = (await startRes.json()) as StartResponse;
      assert.strictEqual(started.session.status, "interlude");

      const beforeVote = JSON.stringify(bots[0].lastSession?.session);
      const voteError = new Promise<string>((resolve, reject) => {
        bots[0].on(MESSAGE_TYPES.ERROR, (msg) => {
          if (msg.type !== MESSAGE_TYPES.ERROR) return;
          resolve(msg.payload.code);
        });
        setTimeout(() => reject(new Error("vote no-op timeout")), 3000);
      });
      bots[0].sendSessionVote("racing");
      assert.strictEqual(await voteError, "SESSION_SELECTION_CLOSED");
      bots[0].off(MESSAGE_TYPES.ERROR);
      assert.strictEqual(
        JSON.stringify(bots[0].lastSession?.session),
        beforeVote,
        "the retired vote message must not change the preset playlist",
      );

      // Skip swaps the upcoming slot and records a visible announcement.
      const skipRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/skip`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ gameId: "racing" }),
      });
      assert.strictEqual(skipRes.status, 200);
      const skipped = (await skipRes.json()) as {
        from: string;
        to: string;
        announcement: string;
        session: SessionView;
      };
      assert.strictEqual(skipped.to, "racing");
      assert.ok(skipped.announcement.includes("Tap Race") || skipped.announcement.includes("racing"));
      assert.strictEqual(skipped.session.slots[0]?.gameId, "racing");
      assert.ok(skipped.session.slots[0]?.announcement);

      // Start the current resolved slot.
      const playRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({}),
      });
      assert.strictEqual(playRes.status, 200);
      const playing = await bots[0].waitForSession((payload) => payload.session?.status === "playing");
      assert.strictEqual(playing.session?.currentGameId, "racing");

      // Tap Race ends once a car reaches the finish line.
      let finished = false;
      bots[0].on(MESSAGE_TYPES.GAME_STATE, (msg) => {
        if (msg.type !== MESSAGE_TYPES.GAME_STATE) return;
        const screenState = msg.payload.screen as { finished?: boolean } | null;
        if (screenState?.finished === true) finished = true;
      });
      const deadline = Date.now() + 20000;
      while (!finished && Date.now() < deadline) {
        for (const bot of bots) bot.sendInput({ tap: true });
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.strictEqual(finished, true, "Tap Race should report a finished screen");

      const interlude = await bots[0].waitForSession(
        (payload) => payload.session?.status === "interlude" && payload.session?.round === 2,
        8000,
      );
      assert.strictEqual(interlude.session?.rounds.length, 1);
      assert.deepStrictEqual(
        interlude.session?.standings.map((standing) => standing.points).sort((a, b) => b - a),
        [10, 6, 3],
        "the finished round pays the unchanged placement points",
      );
      assert.strictEqual(interlude.session?.currentGameId, "mostlikely");

      const nextRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/next`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(nextRes.status, 200);
      const nextBody = (await nextRes.json()) as { gameId: string; session: SessionView };
      assert.strictEqual(nextBody.gameId, "mostlikely");
      assert.strictEqual(nextBody.session.status, "playing");
      assert.strictEqual(nextBody.session.currentGameId, "mostlikely");

      // End early keeps the finale: champion, trophies and awards, and clears
      // the running room back to the lobby.
      const endRes = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/end`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(endRes.status, 200);
      const ended = (await endRes.json()) as { session: SessionView };
      assert.strictEqual(ended.session.status, "finished");
      assert.ok(ended.session.champion, "ending early must crown the current leader");
      assert.ok((ended.session.champion?.points ?? 0) > 0);
      assert.ok(Array.isArray(ended.session.trophies));
      assert.ok(Array.isArray(ended.session.awards));
      await bots[0].waitForSession((payload) => payload.session?.status === "finished");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(bots[0].roomState?.status, "lobby", "the room returns to the lobby");
    } finally {
      screen.close();
      for (const bot of bots) bot.disconnect();
    }
  });
});
