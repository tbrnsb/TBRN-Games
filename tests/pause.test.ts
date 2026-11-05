/**
 * Below-minimum pause and host controls (Phase 2, piece 5b).
 *
 * A running game whose connected non-spectator players fall below the game's
 * minimum freezes: no plugin tick, no timer advance. The room carries a pause
 * record, enough reconnecting phones clear it, and the host can wait, resume
 * or end the game from either the screen or the first player's phone.
 *
 * The server is spawned with a short DROPOUT_PAUSE_MS so the suite stays fast.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

const DROPOUT_PAUSE_MS = 800;
// Most Likely To is enabled, needs three players and has a 15-second round
// timer, so a frozen timer is easy to observe.
const GAME_ID = "mostlikely";

interface Phone {
  ws: WebSocket;
  playerId: string;
  token: string;
  hostToken: string;
  roomId: string;
  errors: string[];
  room: any;
  game: any;
  frames: number;
}

function joinPhone(wsUrl: string, name: string, roomId = "", rejoinToken = ""): Promise<Phone> {
  const ws = new WebSocket(wsUrl);
  const phone: Phone = { ws, playerId: "", token: "", hostToken: "", roomId: "", errors: [], room: null, game: null, frames: 0 };
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "joined") {
      phone.playerId = msg.payload.playerId;
      phone.token = msg.payload.rejoinToken;
      phone.roomId = msg.roomId;
      if (typeof msg.payload.hostToken === "string") phone.hostToken = msg.payload.hostToken;
    }
    if (msg.type === "roomState") phone.room = msg.payload;
    if (msg.type === "gameState") {
      phone.game = msg.payload;
      phone.frames += 1;
    }
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
    await sleep(20);
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

async function post(
  httpUrl: string,
  roomId: string,
  action: string,
  hostToken?: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${httpUrl}/api/rooms/${roomId}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(hostToken ? { "x-host-token": hostToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function startGame(fixture: ServerFixture, roomId: string, hostToken: string, gameId = GAME_ID): Promise<number> {
  return post(fixture.httpUrl, roomId, "start", hostToken, { gameId }).then((r) => r.status);
}

function closeAll(phones: Phone[]): void {
  for (const p of phones) p.ws.close();
}

describe("below-minimum pause and host controls", () => {
  let fixture: ServerFixture;

  before(async () => {
    fixture = await startServer({ DROPOUT_PAUSE_MS: String(DROPOUT_PAUSE_MS), PLAYER_TIMEOUT_MS: "1500" });
  });

  after(() => fixture?.stop());

  test("a drop below the minimum pauses the clock and a reconnect resumes it", async () => {
    const a = await joinPhone(fixture.wsUrl, "Ana");
    await sleep(120);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Ben", roomId);
    const c = await joinPhone(fixture.wsUrl, "Cara", roomId);
    await sleep(250);

    const screenToken = await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(a.hostToken, screenToken, "the first phone gets the screen's host token");
    assert.strictEqual(b.hostToken, "", "a later phone is not a host");

    assert.strictEqual(await startGame(fixture, roomId, a.hostToken), 200);
    await waitFor(() => typeof a.game?.screen?.timeLeft === "number", 2000, "first game frame");

    // Ben's phone drops: 2 connected players against a minimum of 3.
    b.ws.close();
    await waitFor(() => a.room?.pause?.reason === "players", 2500, "below-minimum pause");

    const pause = a.room.pause;
    assert.strictEqual(typeof pause.startedAt, "number");
    assert.strictEqual(pause.until - pause.startedAt, DROPOUT_PAUSE_MS, "until uses the configured pause length");

    // The frozen frame must not advance while the game is paused.
    const frozenTimeLeft = a.game.screen.timeLeft;
    await sleep(450);
    assert.strictEqual(a.game.screen.timeLeft, frozenTimeLeft, "the game clock does not tick while paused");
    assert.strictEqual(a.game.screen.phase, "voting", "the screen stays on the same phase");

    // Resume is refused while the table is still short.
    const refused = await post(fixture.httpUrl, roomId, "resume", a.hostToken);
    assert.strictEqual(refused.status, 409);
    assert.strictEqual(refused.body.code, "BELOW_MINIMUM");

    // The deadline passing does not end the game: the pause and host offer stay.
    await waitFor(
      () => a.room?.pause && a.room.pause.until <= Date.now(),
      3000,
      "pause deadline passed",
    );
    assert.ok(a.room?.pause, "the pause stays up after its deadline");
    assert.strictEqual(a.room.pause.reason, "players");

    // Host Wait pushes the deadline out.
    const beforeUntil = a.room.pause.until;
    const waited = await post(fixture.httpUrl, roomId, "pause", a.hostToken, { action: "wait" });
    assert.strictEqual(waited.status, 200);
    assert.strictEqual(waited.body.success, true);
    await waitFor(() => a.room?.pause && a.room.pause.until > beforeUntil, 1500, "extended deadline");
    assert.ok(a.room.pause.until - Date.now() > DROPOUT_PAUSE_MS / 2, "the deadline is now in the future again");

    // Ben comes back with his rejoin token: the pause clears by itself.
    const b2 = await joinPhone(fixture.wsUrl, "Ben", roomId, b.token);
    await waitFor(() => b2.playerId === b.playerId, 1500, "rejoin the same seat");
    assert.strictEqual(b2.playerId, b.playerId, "the token returns to the same seat");
    await waitFor(() => a.room?.pause === null, 2500, "automatic resume");
    await waitFor(() => playerIn(a, b.playerId)?.presence === "active", 2000, "active seat");
    await waitFor(() => typeof a.game?.screen?.timeLeft === "number", 2000, "resumed frames");

    const resumedTimeLeft = a.game.screen.timeLeft;
    assert.strictEqual(a.game.screen.phase, "voting", "the game resumes in the same phase");
    assert.ok(
      frozenTimeLeft - resumedTimeLeft < 400,
      `the paused wall time is not fed into the game (frozen ${frozenTimeLeft}, resumed ${resumedTimeLeft})`,
    );

    closeAll([a, b2, c]);
  });

  test("host end-game works from a paused game", async () => {
    const a = await joinPhone(fixture.wsUrl, "Dana");
    await sleep(120);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Eli", roomId);
    const c = await joinPhone(fixture.wsUrl, "Fay", roomId);
    await sleep(250);

    await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(await startGame(fixture, roomId, a.hostToken), 200);
    await waitFor(() => typeof a.game?.screen?.timeLeft === "number", 2000, "game running");

    c.ws.close();
    await waitFor(() => a.room?.pause?.reason === "players", 2500, "pause before end-game");

    const ended = await post(fixture.httpUrl, roomId, "end-game", a.hostToken);
    assert.strictEqual(ended.status, 200);
    await waitFor(() => a.room?.status === "lobby", 2000, "back in the lobby");
    assert.strictEqual(a.room.pause, null, "the pause is cleared with the game");

    closeAll([a, b, c]);
  });

  test("host endpoints reject a non-host phone and refuse a lobby pause", async () => {
    const a = await joinPhone(fixture.wsUrl, "Gus");
    await sleep(120);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Hana", roomId);
    const c = await joinPhone(fixture.wsUrl, "Ivo", roomId);
    await sleep(250);

    await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(b.hostToken, "", "only the first phone is host");
    assert.strictEqual(b.token.length > 0, true, "a non-host still has a rejoin token");

    // No game is running yet.
    const lobbyPause = await post(fixture.httpUrl, roomId, "pause", a.hostToken, { action: "wait" });
    assert.strictEqual(lobbyPause.status, 409);
    assert.strictEqual(lobbyPause.body.code, "NO_ACTIVE_GAME");

    assert.strictEqual(await startGame(fixture, roomId, a.hostToken), 200);
    await waitFor(() => !!a.game?.screen?.prompt, 2000, "game running");

    // A rejoin token is not a host token, and no header is not either.
    for (const action of ["pause", "resume", "end-game"]) {
      const withToken = await post(fixture.httpUrl, roomId, action, b.token, action === "pause" ? { action: "wait" } : undefined);
      assert.strictEqual(withToken.status, 403, `${action} rejects a non-host phone`);
      const withNothing = await post(fixture.httpUrl, roomId, action);
      assert.strictEqual(withNothing.status, 403, `${action} rejects an unauthenticated call`);
    }

    const framesAfterRejects = a.frames;
    await sleep(150);
    assert.ok(a.frames > framesAfterRejects, "the rejected calls did not end the running game");
    const ended = await post(fixture.httpUrl, roomId, "end-game", a.hostToken);
    assert.strictEqual(ended.status, 200, "the host token still works");
    await waitFor(() => a.room?.status === "lobby", 2000, "the host end-game returns to the lobby");

    closeAll([a, b, c]);
  });
});
