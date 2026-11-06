/**
 * Royal Rumble transport details: slot options reach the plugin, late joiners
 * enter at the right boundary, and the on-disk snapshot is safe to write.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotClient, createBots } from "./bot-client.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";
import { connectScreen, hostHeaders } from "./fixtures/screen-client.ts";
import { MESSAGE_TYPES } from "../shared/constants.js";
import { RUMBLE_PRESETS } from "../shared/rumble-presets.ts";
import { createSession, sessionView } from "../server/session.ts";
import quizPlugin from "../games/quiz/server.ts";
import bluffPlugin from "../games/bluff/server.ts";
import type { Player, SessionView } from "../shared/types.ts";

const testPlayers = [
  { id: "p0", name: "Ana" },
  { id: "p1", name: "Ben" },
  { id: "p2", name: "Cleo" },
];

function sharedPlayers(): Player[] {
  return testPlayers.map((player, index) => ({
    ...player,
    joinedAt: 0,
    rejoinToken: `token-${index}`,
    connected: true,
    presence: "active",
  }));
}

function fakeRoom() {
  return {
    id: "room",
    code: "ROOM1",
    hostPlayerId: null,
    players: [],
    gameId: null,
    gameState: null,
    createdAt: 0,
    status: "lobby" as const,
    pause: null,
  };
}

interface StartResponse {
  session: SessionView;
}

describe("Royal Rumble server transport", () => {
  let fixture: ServerFixture;
  let wsUrl: string;
  let httpUrl: string;
  let rumbleDir: string;

  before(async () => {
    rumbleDir = mkdtempSync(join(tmpdir(), "tbrn-rumble-transport-"));
    fixture = await startServer({ TBRN_RUMBLE_DIR: rumbleDir });
    wsUrl = fixture.wsUrl;
    httpUrl = fixture.httpUrl;
  });

  after(() => {
    fixture?.stop();
    rmSync(rumbleDir, { recursive: true, force: true });
  });

  /** Play Tap Race through to its finish so the session reaches an interlude. */
  async function finishRacing(bots: BotClient[], http: string, headers: Record<string, string>): Promise<void> {
    // Sleepover Hours keeps racing on the bench, so promoting it cannot
    // duplicate a game that is already elsewhere in the playlist.
    const start = await fetch(`${http}/api/rooms/${bots[0].roomId}/session/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ presetId: "sleepover-hours" }),
    });
    assert.strictEqual(start.status, 200);

    const skip = await fetch(`${http}/api/rooms/${bots[0].roomId}/session/skip`, {
      method: "POST",
      headers,
      body: JSON.stringify({ gameId: "racing" }),
    });
    assert.strictEqual(skip.status, 200);

    const play = await fetch(`${http}/api/rooms/${bots[0].roomId}/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    assert.strictEqual(play.status, 200);

    let finished = false;
    bots[0].on(MESSAGE_TYPES.GAME_STATE, (msg) => {
      if (msg.type !== MESSAGE_TYPES.GAME_STATE) return;
      const screen = msg.payload.screen as { finished?: boolean } | null;
      if (screen?.finished === true) finished = true;
    });
    const deadline = Date.now() + 20000;
    while (!finished && Date.now() < deadline) {
      for (const bot of bots) bot.sendInput({ tap: true });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.strictEqual(finished, true, "Tap Race should finish");

    await bots[0].waitForSession(
      (payload) => payload.session?.status === "interlude" && payload.session?.round === 2,
      8000,
    );
  }

  test("a started Rumble game receives the slot's options", async () => {
    const bots = await createBots(3, wsUrl, "OptionBot");
    const screen = await connectScreen(wsUrl, bots[0].roomId);
    const host = hostHeaders(screen);

    try {
      const start = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ presetId: "big-brain-sunday" }),
      });
      assert.strictEqual(start.status, 200);
      const started = (await start.json()) as StartResponse;
      const quizSlot = started.session.slots[0];
      assert.strictEqual(quizSlot.gameId, "quiz");
      assert.deepStrictEqual(quizSlot.options, { mode: "standard" });

      const framePromise = bots[0].waitForGameState();
      const play = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({}),
      });
      assert.strictEqual(play.status, 200);
      const frame = await framePromise;
      const screenState = frame.screen as { mode?: string };
      assert.strictEqual(
        screenState.mode,
        quizSlot.options?.mode,
        "the started game must use the slot options, not its own defaults",
      );
    } finally {
      screen.close();
      for (const bot of bots) bot.disconnect();
    }
  });

  test("option slots drive Quiz fast mode and Bluff's dictionary pack", () => {
    // Friday Night at Mo's carries Fast Quiz at slot 2 and Bluff (Facts) next.
    const session = createSession(testPlayers, RUMBLE_PRESETS[0]);
    const view = sessionView(session);
    const quizSlot = view.slots[1];
    assert.strictEqual(quizSlot.gameId, "quiz");
    assert.deepStrictEqual(quizSlot.options, { mode: "fast" });

    const quiz = quizPlugin.onStart(fakeRoom(), sharedPlayers(), quizSlot.options);
    const quizScreen = quizPlugin.screenState(quiz) as { mode?: string; totalQuestions?: number };
    assert.strictEqual(quizScreen.mode, "fast");
    assert.strictEqual(quizScreen.totalQuestions, 6);

    // Big Brain Sunday puts Bluff (Dictionary) at slot 3.
    const dictionary = createSession(testPlayers, RUMBLE_PRESETS[3]);
    const bluffSlot = sessionView(dictionary).slots[2];
    assert.strictEqual(bluffSlot.gameId, "bluff");
    assert.deepStrictEqual(bluffSlot.options, { contentPack: "dictionary" });
    const bluff = bluffPlugin.onStart(fakeRoom(), sharedPlayers(), bluffSlot.options);
    const bluffScreen = bluffPlugin.screenState(bluff) as { contentPack?: string };
    assert.strictEqual(bluffScreen.contentPack, "dictionary");
  });

  test("interlude joiners enter at the lowest score; mid-game joiners wait", async () => {
    const bots = await createBots(3, wsUrl, "LateBot");
    const screen = await connectScreen(wsUrl, bots[0].roomId);
    const host = hostHeaders(screen);
    let late: BotClient | null = null;
    let mid: BotClient | null = null;

    try {
      await finishRacing(bots, httpUrl, host);

      late = new BotClient({
        name: "Late",
        roomUrl: wsUrl,
        roomId: bots[0].roomId,
      });
      await late.connect();
      const latePlayer = late.player;
      assert.ok(latePlayer);
      const lateSession = await late.waitForSession(
        (payload) => payload.session?.standings.some((standing) => standing.playerId === latePlayer.id) === true,
      );
      const lateRow = lateSession.session?.standings.find((standing) => standing.playerId === latePlayer.id);
      assert.strictEqual(lateRow?.points, 3, "a between-games joiner starts on the lowest current score");

      const next = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/session/next`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(next.status, 200);

      mid = new BotClient({
        name: "Mid",
        roomUrl: wsUrl,
        roomId: bots[0].roomId,
      });
      await mid.connect();
      const midPlayer = mid.player;
      assert.ok(midPlayer);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const midRoom = mid.roomState?.players.find((player) => player.id === midPlayer.id);
      assert.strictEqual(midRoom?.spectator, true, "a mid-game joiner is a spectator");
      assert.strictEqual(
        mid.lastSession?.session?.standings.some((standing) => standing.playerId === midPlayer.id),
        false,
        "a mid-game joiner is not added until the interlude",
      );

      // Aborting the round returns to the interlude and admits the spectator.
      const abort = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/end-game`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(abort.status, 200);
      const admitted = await bots[0].waitForSession(
        (payload) =>
          payload.session?.status === "interlude" &&
          payload.session?.standings.some((standing) => standing.playerId === midPlayer.id) === true,
      );
      const admittedRow = admitted.session?.standings.find((standing) => standing.playerId === midPlayer.id);
      assert.strictEqual(admittedRow?.points, 3, "the mid-game joiner starts at the lowest score too");
    } finally {
      late?.disconnect();
      mid?.disconnect();
      screen.close();
      for (const bot of bots) bot.disconnect();
    }
  });

  test("the on-disk snapshot exists after starts and ends and carries no tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tbrn-rumble-"));
    const local = await startServer({ TBRN_RUMBLE_DIR: dir });
    const bots = await createBots(3, local.wsUrl, "StoreBot");
    const screen = await connectScreen(local.wsUrl, bots[0].roomId);
    const host = hostHeaders(screen);

    try {
      const start = await fetch(`${local.httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({ presetId: "sleepover-hours" }),
      });
      assert.strictEqual(start.status, 200);

      const code = bots[0].roomState?.code;
      assert.ok(code, "the room code is needed for the snapshot filename");
      const file = join(dir, `${code}.json`);

      const play = await fetch(`${local.httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: host,
        body: JSON.stringify({}),
      });
      assert.strictEqual(play.status, 200);

      const end = await fetch(`${local.httpUrl}/api/rooms/${bots[0].roomId}/end-game`, {
        method: "POST",
        headers: host,
      });
      assert.strictEqual(end.status, 200);

      const raw = readFileSync(file, "utf8");
      const saved = JSON.parse(raw) as { code: string; presetId: string; summary: { presetId: string } };
      assert.strictEqual(saved.code, code);
      assert.strictEqual(saved.presetId, "sleepover-hours");
      assert.strictEqual(saved.summary.presetId, "sleepover-hours");
      assert.strictEqual(raw.includes("rejoinToken"), false);
      assert.strictEqual(raw.includes("hostToken"), false);
      for (const bot of bots) {
        assert.ok(bot.player?.rejoinToken);
        assert.strictEqual(raw.includes(bot.player.rejoinToken), false, "rejoin tokens never reach the disk");
      }
    } finally {
      screen.close();
      for (const bot of bots) bot.disconnect();
      local.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
