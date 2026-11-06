/**
 * Disconnect/rejoin matrix (brief section 7, item 5).
 *
 * For Texas Hold'em (poker), Drawful, Bluff and Guess the Imposter this file
 * drops one phone mid-game and rejoins it with its rejoin token during EVERY
 * non-terminal phase, then performs one below-minimum drop per game.
 *
 * Design notes:
 * - One shared server fixture for the whole file with PLAYER_TIMEOUT_MS=250
 *   (the reap path runs in milliseconds, exactly like tests/reconnect.test.ts).
 *   Every test opens a fresh room and closes every socket in a finally block.
 * - The phase matrix runs at minimum+1 players (poker 3, the others 4), so a
 *   single drop never falls below the manifest minimum and must not pause the
 *   room. The below-min tests run at the manifest minimum instead (poker 2,
 *   the others 3) so one drop does pause.
 * - Client helper: the joinPhone pattern from tests/reconnect.test.ts and
 *   tests/pause.test.ts, extended with per-frame bookkeeping (game/frames/
 *   seen phases). tests/bot-client.ts cannot express drop+rejoin: its ws
 *   close handler nulls `player` while `reconnect()` reads
 *   `player.rejoinToken`, so a disconnect followed by a reconnect throws
 *   "No rejoin token" (no existing test calls BotClient.reconnect()).
 * - Declared phases are enumerated from each game's state machine
 *   (`games/<id>/server.ts`). A fail-closed coverage test per game asserts
 *   the observed phase set stays inside the declared list, so a phase added
 *   to a game later fails this suite until it is classified here.
 *   `finished` is the only skipped phase: it is terminal - the game has
 *   handed back to the lobby and no phone can act - so a drop/rejoin
 *   scenario there would prove nothing.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

type GameId = "poker" | "drawful" | "bluff" | "guessimposter";

interface Phone {
  ws: WebSocket;
  name: string;
  playerId: string;
  token: string;
  roomId: string;
  errors: string[];
  room: any;
  game: any;
  frames: number;
  seen: Set<string>;
}

interface Screen {
  ws: WebSocket;
  hostToken: string;
}

interface Table {
  phones: Phone[];
  screen: Screen;
  roomId: string;
}

/** Terminal phase: skipped by design, see the file header. */
const TERMINAL_SKIPPED = new Set(["finished"]);

/**
 * Non-terminal phases per game, from each game's own state machine:
 * - poker (`Phase` in games/poker/server.ts): preflop -> flop -> turn -> river
 *   -> showdown -> hand-end (-> next hand or finished).
 * - drawful (`DrawState.phase`): drawing -> bluffing -> voting -> reveal
 *   (-> next drawing or finished).
 * - bluff (`BluffState.phase`): writing -> voting -> reveal (-> next round or
 *   finished).
 * - guessimposter (`Phase`): countdown -> peek -> clue (two rounds) ->
 *   discussion -> vote -> voteReveal -> (finalGuess when an Imposter is
 *   ejected) -> reveal (-> next word or finished).
 */
const DECLARED: Record<GameId, string[]> = {
  poker: ["preflop", "flop", "turn", "river", "showdown", "hand-end"],
  drawful: ["drawing", "bluffing", "voting", "reveal"],
  bluff: ["writing", "voting", "reveal"],
  guessimposter: [
    "countdown",
    "peek",
    "clue",
    "discussion",
    "vote",
    "voteReveal",
    "finalGuess",
    "reveal",
  ],
};

/** Phases seen in game-state messages, collected live by every phone. */
const observed: Record<GameId, Set<string>> = {
  poker: new Set(),
  drawful: new Set(),
  bluff: new Set(),
  guessimposter: new Set(),
};

let fixture: ServerFixture;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  check: () => boolean,
  timeoutMs = 4000,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function joinPhone(
  wsUrl: string,
  name: string,
  seen: Set<string>,
  roomId = "",
  rejoinToken = "",
): Promise<Phone> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const phone: Phone = {
      ws,
      name,
      playerId: "",
      token: "",
      roomId: "",
      errors: [],
      room: null,
      game: null,
      frames: 0,
      seen,
    };
    const timer = setTimeout(() => {
      reject(new Error(`[${name}] join timeout (errors: ${phone.errors.join(",") || "none"})`));
    }, 5000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "joined") {
        phone.playerId = msg.payload.playerId;
        phone.token = msg.payload.rejoinToken;
        phone.roomId = msg.roomId;
        if (msg.payload.roomState) phone.room = msg.payload.roomState;
        clearTimeout(timer);
        resolve(phone);
      }
      if (msg.type === "roomState") phone.room = msg.payload;
      if (msg.type === "gameState") {
        phone.game = msg.payload;
        phone.frames += 1;
        const phase = msg.payload?.screen?.phase;
        if (typeof phase === "string") phone.seen.add(phase);
      }
      if (msg.type === "error") phone.errors.push(msg.payload.code);
    });
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          roomId,
          timestamp: Date.now(),
          payload: { name, rejoinToken: rejoinToken || undefined },
        }),
      );
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function connectScreen(wsUrl: string, roomId: string): Promise<Screen> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error("[screen] join timeout")), 5000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "joined" && typeof msg.payload?.hostToken === "string") {
        clearTimeout(timer);
        resolve({ ws, hostToken: msg.payload.hostToken });
      }
    });
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          roomId,
          timestamp: Date.now(),
          payload: { name: "Screen", role: "screen" },
        }),
      );
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendInput(phone: Phone, payload: unknown): void {
  if (phone.ws.readyState !== WebSocket.OPEN) return;
  phone.ws.send(
    JSON.stringify({
      type: "input",
      roomId: phone.roomId,
      playerId: phone.playerId,
      timestamp: Date.now(),
      payload,
    }),
  );
}

function closeAll(sockets: Array<Phone | Screen>): void {
  for (const s of sockets) {
    try {
      s.ws.close();
    } catch {
      /* already closed */
    }
  }
}

function otherPhone(phones: Phone[], playerId: string, label: string): Phone {
  const other = phones.find((p) => p.playerId !== playerId);
  assert.ok(other, `${label} at least one other phone must still be in the table`);
  return other;
}

function choiceOf(phone: Phone, label: string): string {
  const options = phone.game?.controller?.options;
  assert.ok(
    Array.isArray(options) && options.length > 0,
    `${label} ${phone.name} must have ballot options`,
  );
  return options[0].id;
}

function gameSeatOf(phone: Phone, playerId: string, label: string): number {
  const index = (phone.room?.players ?? []).findIndex((p: any) => p.id === playerId);
  assert.ok(index >= 0, `${label} player ${playerId} must be in the room list`);
  return index;
}

/** The plugin manifest is the source of truth for a game's minimum. */
async function gameMinPlayers(gameId: GameId): Promise<number> {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const mod = (await import(join(repoRoot, "games", gameId, "server.ts"))) as {
    default: { manifest: { minPlayers: number } };
  };
  return mod.default.manifest.minPlayers;
}

async function startGame(
  roomId: string,
  hostToken: string,
  gameId: GameId,
  options?: Record<string, unknown>,
): Promise<number> {
  const res = await fetch(`${fixture.httpUrl}/api/rooms/${roomId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-host-token": hostToken },
    body: JSON.stringify({ gameId, ...(options ? { options } : {}) }),
  });
  return res.status;
}

/**
 * Fresh room: join `count` phones, connect the TV screen (the host endpoints
 * require it) and start the game over HTTP.
 */
async function setupTable(
  gameId: GameId,
  count: number,
  expectAt: "min" | "minPlusOne",
  options: Record<string, unknown> | undefined,
  prefix: string,
): Promise<Table> {
  const min = await gameMinPlayers(gameId);
  if (expectAt === "min") {
    assert.strictEqual(count, min, `[${gameId}] the table starts at the manifest minimum (${min})`);
  } else {
    assert.strictEqual(
      count,
      min + 1,
      `[${gameId}] the phase matrix runs at minimum+1 (${min + 1})`,
    );
  }

  const seen = observed[gameId];
  const phones: Phone[] = [];
  let roomId = "";
  for (let i = 0; i < count; i++) {
    const phone = await joinPhone(fixture.wsUrl, `${prefix}${i + 1}`, seen, roomId);
    if (!roomId) roomId = phone.roomId;
    phones.push(phone);
  }
  const screen = await connectScreen(fixture.wsUrl, roomId);
  const status = await startGame(roomId, screen.hostToken, gameId, options);
  assert.strictEqual(status, 200, `[${gameId}] the game must start with ${count} players (HTTP ${status})`);
  return { phones, screen, roomId };
}

/**
 * Wait until EVERY phone of the table has received a frame for `phase`.
 * Phones sit on separate sockets, so one phone's frame can lag another's by
 * a tick; reading another phone's controller right after a transition on a
 * single phone would race. (One phone, one socket: after this returns, every
 * controller read in a scenario is from a frame of the current phase.)
 */
async function waitForPhaseEverywhere(
  phones: Phone[],
  phase: string,
  gameId: GameId,
  timeoutMs = 5000,
): Promise<void> {
  await waitFor(
    () => phones.every((p) => p.game?.screen?.phase === phase),
    timeoutMs,
    `[${gameId}] every phone reaches phase ${phase} (lagging: ${
      phones
        .filter((p) => p.game?.screen?.phase !== phase)
        .map((p) => `${p.name}=${String(p.game?.screen?.phase)}`)
        .join(", ") || "none"
    })`,
  );
}

/**
 * The shared drop/rejoin scenario:
 *  1. close one phone's socket,
 *  2. assert the server records the drop, keeps every seat, keeps producing
 *     game state for the other phones and does not pause (the table is at
 *     minimum+1),
 *  3. rejoin with the token and assert the same playerId and the same seat
 *     come back, no error is raised on any phone, and the rejoined phone
 *     receives a fresh game frame.
 *
 * Returns the rejoined phone (already substituted into `phones`).
 */
async function dropAndRejoin(
  gameId: GameId,
  phase: string,
  phones: Phone[],
  index: number,
): Promise<Phone> {
  const label = `[${gameId}/${phase}]`;
  const dropper = phones[index];
  const preSeat = dropper.room?.players?.find((p: any) => p.id === dropper.playerId)?.seat;
  assert.ok(preSeat, `${label} the dropping phone has a seat before the drop`);

  dropper.ws.close();

  const survivor = otherPhone(phones, dropper.playerId, label);
  await waitFor(
    () => survivor.room?.players?.find((p: any) => p.id === dropper.playerId)?.presence === "away",
    3000,
    `${label} the dropped phone is marked away`,
  );

  const row = survivor.room.players.find((p: any) => p.id === dropper.playerId);
  assert.strictEqual(row.connected, false, `${label} the dropped seat reads as disconnected`);
  assert.strictEqual(
    survivor.room.players.length,
    phones.length,
    `${label} no seat is lost when a phone drops`,
  );
  assert.strictEqual(
    survivor.room?.pause ?? null,
    null,
    `${label} a min+1 drop must not pause the room`,
  );

  // The server keeps producing game state while a phone is away.
  const frameFloor = survivor.frames;
  await waitFor(
    () => survivor.frames > frameFloor,
    2000,
    `${label} the server keeps producing game state after the drop`,
  );
  for (const p of phones) {
    if (p === dropper) continue;
    const peer = p.room?.players?.find((x: any) => x.id === p.playerId);
    assert.strictEqual(peer?.presence, "active", `${label} ${p.name} keeps an active seat`);
    assert.strictEqual(p.errors.length, 0, `${label} ${p.name} sees no error while a peer is away`);
  }

  const back = await joinPhone(fixture.wsUrl, dropper.name, dropper.seen, dropper.roomId, dropper.token);
  assert.strictEqual(back.playerId, dropper.playerId, `${label} the token restores the same playerId`);
  assert.deepStrictEqual(back.errors, [], `${label} no error code on rejoin`);
  await waitFor(
    () => back.room?.players?.find((p: any) => p.id === dropper.playerId)?.presence === "active",
    3000,
    `${label} the seat is active again after the rejoin`,
  );
  const restoredSeat = back.room?.players?.find((p: any) => p.id === dropper.playerId)?.seat;
  assert.deepStrictEqual(restoredSeat, preSeat, `${label} the same seat is restored`);
  await waitFor(() => back.frames > 0, 3000, `${label} the rejoined phone receives a game frame`);
  assert.deepStrictEqual(back.errors, [], `${label} no error after the rejoin frame`);
  for (const p of phones) {
    if (p === dropper) continue;
    assert.strictEqual(p.errors.length, 0, `${label} ${p.name} sees no error after the rejoin`);
  }

  phones[index] = back;
  return back;
}

function assertCoverage(gameId: GameId): void {
  const declared = DECLARED[gameId];
  const seen = [...observed[gameId]].sort();
  console.log(`[coverage] ${gameId} declared: ${declared.join(", ")} | observed: ${seen.join(", ")}`);

  const undeclared = seen.filter(
    (phase) => !declared.includes(phase) && !TERMINAL_SKIPPED.has(phase),
  );
  assert.deepStrictEqual(
    undeclared,
    [],
    `${gameId}: observed phases outside the declared list (classify them in DECLARED): ${undeclared.join(", ")}`,
  );
  const unexercised = declared.filter((phase) => !observed[gameId].has(phase));
  assert.deepStrictEqual(
    unexercised,
    [],
    `${gameId}: declared phases never exercised: ${unexercised.join(", ")}`,
  );
}

// --- Poker -----------------------------------------------------------------

function pokerInput(cs: any): unknown {
  if (cs.canCheck === true) return { action: "check" };
  if (cs.canCall === true) return { action: "call" };
  if (cs.canRaise === true) return { action: "raise", amount: cs.minRaiseTo };
  return { action: "fold" };
}

async function drivePokerTo(phones: Phone[], target: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const phase = phones[0].game?.screen?.phase;
    if (phase === target) return;
    if (phase === "finished") break;
    for (const p of phones) {
      const cs = p.game?.controller;
      if (cs && cs.yourTurn === true && cs.spectator !== true) {
        sendInput(p, pokerInput(cs));
      }
    }
    await sleep(20);
  }
  throw new Error(
    `[poker] timed out driving to ${target} (last phase ${String(phones[0].game?.screen?.phase)})`,
  );
}

async function pokerDropScenario(t: Table, phase: string): Promise<void> {
  const label = `[poker/${phase}]`;
  const phones = t.phones;
  const betting =
    phase === "preflop" || phase === "flop" || phase === "turn" || phase === "river";

  if (betting) {
    // Drop the phone that currently holds the action: the game must wait for
    // it (no crash, no skipped turn) and the rejoined phone must be able to
    // act as its subsequent valid input.
    const index = phones.findIndex((p) => p.game?.controller?.yourTurn === true);
    assert.notStrictEqual(index, -1, `${label} exactly one phone holds the turn before the drop`);
    const dropper = phones[index];
    const preCards = dropper.game.controller.cards;
    const preChips = dropper.game.controller.chips;
    const preFolded = dropper.game.controller.folded;
    const preAllIn = dropper.game.controller.allIn;
    const turnNameBefore = dropper.game.screen.turnName;
    assert.strictEqual(turnNameBefore, dropper.name, `${label} the acting phone owns the turn`);

    const back = await dropAndRejoin("poker", phase, phones, index);
    const survivor = otherPhone(phones, back.playerId, label);
    await waitFor(() => back.game?.controller != null, 3000, `${label} the rejoined controller frame`);

    const cs = back.game.controller;
    assert.deepStrictEqual(cs.cards, preCards, `${label} hole cards are unchanged after the rejoin`);
    assert.strictEqual(cs.chips, preChips, `${label} the stack is intact after the rejoin`);
    assert.strictEqual(cs.folded, preFolded, `${label} the folded flag is unchanged after the rejoin`);
    assert.strictEqual(cs.allIn, preAllIn, `${label} the all-in flag is unchanged after the rejoin`);
    assert.strictEqual(
      back.game.screen.phase,
      phase,
      `${label} the game is still in this phase after the rejoin`,
    );
    assert.strictEqual(
      survivor.game.screen.turnName,
      turnNameBefore,
      `${label} the turn waits for the dropped phone instead of auto-acting or skipping`,
    );
    assert.strictEqual(cs.yourTurn, true, `${label} the rejoined phone still owns the turn`);

    // Subsequent valid input: the acting phone's rejoin action is accepted.
    sendInput(back, pokerInput(cs));
    await waitFor(
      () => {
        const screen = back.game?.screen;
        return !!screen && (screen.turnName !== turnNameBefore || screen.phase !== phase);
      },
      3000,
      `${label} the rejoined phone's action is accepted (turn or street advances)`,
    );
    assert.deepStrictEqual(back.errors, [], `${label} no error from the accepted action`);
    return;
  }

  // showdown / hand-end: display-only phases. The server ignores player input
  // by design (onInput only accepts preflop/flop/turn/river), so the contract
  // here is: private state survives and a stray input raises no error.
  const dropper = phones[0];
  const preCards = dropper.game.controller.cards;
  const preChips = dropper.game.controller.chips;
  assert.ok(Array.isArray(preCards) && preCards.length === 2, `${label} the phone holds two hole cards`);

  const back = await dropAndRejoin("poker", phase, phones, 0);
  await waitFor(() => back.game?.controller != null, 3000, `${label} the rejoined controller frame`);
  assert.deepStrictEqual(
    back.game.controller.cards,
    preCards,
    `${label} hole cards survive the rejoin`,
  );
  assert.strictEqual(back.game.controller.chips, preChips, `${label} the stack survives the rejoin`);
  assert.strictEqual(
    back.game.screen.phase,
    phase,
    `${label} the game is still in this phase after the rejoin`,
  );

  const frameFloor = back.frames;
  sendInput(back, { action: "check" });
  await waitFor(
    () => back.frames > frameFloor,
    2000,
    `${label} the server keeps producing state after a display-only input`,
  );
  assert.deepStrictEqual(back.errors, [], `${label} display-only input raises no error`);
  assert.strictEqual(
    back.game.screen.phase,
    phase,
    `${label} the ignored input does not change the phase`,
  );
}

// --- Below-minimum shared scenario ----------------------------------------

async function belowMinimumScenario(
  gameId: GameId,
  count: number,
  timerKey: "timeLeft" | "timerMs",
  prefix: string,
): Promise<void> {
  const label = `[${gameId}]`;
  const t = await setupTable(gameId, count, "min", undefined, prefix);
  try {
    const observer = t.phones[0];
    await waitFor(
      () => typeof observer.game?.screen?.phase === "string",
      5000,
      `${label} the first game frame arrives (phase not known yet)`,
    );
    const phase0 = observer.game.screen.phase;
    const frozenTimer = observer.game.screen[timerKey];
    assert.strictEqual(
      typeof frozenTimer,
      "number",
      `${label}/${phase0} the screen exposes the ${timerKey} clock`,
    );

    // One drop takes the table from its minimum to minimum-1.
    const dropper = t.phones[1];
    dropper.ws.close();
    await waitFor(
      () => observer.room?.pause?.reason === "players",
      3000,
      `${label} a drop below ${count} players pauses the room`,
    );
    const pause = observer.room.pause;
    assert.strictEqual(typeof pause.startedAt, "number", `${label}/${phase0} the pause carries startedAt`);
    assert.ok(pause.until > pause.startedAt, `${label}/${phase0} the pause carries a future deadline`);
    assert.strictEqual(
      observer.room.players[1].connected,
      false,
      `${label}/${phase0} the dropped seat reads as disconnected`,
    );
    assert.strictEqual(
      observer.room.players.length,
      count,
      `${label}/${phase0} the away seat is kept during the pause`,
    );

    // Frozen: the platform sends no frames while paused, so the clock and
    // phase of the last delivered frame must not move.
    const frozenFrames = observer.frames;
    await sleep(400);
    assert.strictEqual(
      observer.frames,
      frozenFrames,
      `${label}/${phase0} no game frames are sent while the room is paused`,
    );
    assert.strictEqual(
      observer.game.screen[timerKey],
      frozenTimer,
      `${label}/${phase0} the ${timerKey} clock does not tick while paused`,
    );
    assert.strictEqual(
      observer.game.screen.phase,
      phase0,
      `${label} the game stays in ${phase0} while paused`,
    );

    // Rejoin: the pause clears by itself and play resumes in the same phase.
    const back = await joinPhone(
      fixture.wsUrl,
      dropper.name,
      dropper.seen,
      dropper.roomId,
      dropper.token,
    );
    assert.strictEqual(back.playerId, dropper.playerId, `${label}/${phase0} the token returns the same playerId`);
    assert.deepStrictEqual(back.errors, [], `${label}/${phase0} no error on the rejoin`);
    await waitFor(
      () => observer.room?.pause === null,
      3000,
      `${label}/${phase0} the pause clears when the phone rejoins`,
    );
    await waitFor(
      () => observer.frames > frozenFrames,
      3000,
      `${label}/${phase0} game frames resume after the rejoin`,
    );
    assert.strictEqual(
      observer.game.screen.phase,
      phase0,
      `${label} play resumes in ${phase0}`,
    );
    const resumedTimer = observer.game.screen[timerKey];
    assert.strictEqual(
      typeof resumedTimer,
      "number",
      `${label}/${phase0} the resumed frame still carries the ${timerKey} clock`,
    );
    assert.ok(
      frozenTimer - resumedTimer < 400,
      `${label}/${phase0} paused wall time is not fed into the game (frozen ${frozenTimer}, resumed ${resumedTimer})`,
    );
    await waitFor(() => back.frames > 0, 3000, `${label}/${phase0} the rejoined phone receives a frame`);
    assert.strictEqual(
      back.game.screen.phase,
      phase0,
      `${label} the rejoined phone sees the resumed ${phase0} frame`,
    );
    t.phones[1] = back;
  } finally {
    closeAll([...t.phones, t.screen]);
  }
}

// --- Suites ----------------------------------------------------------------

describe("disconnect matrix: drop and rejoin during every phase", () => {
  before(async () => {
    fixture = await startServer({ PLAYER_TIMEOUT_MS: "250" });
  });

  after(() => fixture?.stop());

  describe("poker", () => {
    test("poker: drop and rejoin in preflop, flop, turn, river, showdown and hand-end", async () => {
      const t = await setupTable("poker", 3, "minPlusOne", undefined, "Pk");
      try {
        await waitForPhaseEverywhere(t.phones, "preflop", "poker");
        for (const phase of DECLARED.poker) {
          await drivePokerTo(t.phones, phase);
          await waitForPhaseEverywhere(t.phones, phase, "poker");
          await pokerDropScenario(t, phase);
        }
      } finally {
        closeAll([...t.phones, t.screen]);
      }
    });

    test("poker: a drop below the two-player minimum pauses the game and a rejoin resumes it", async () => {
      await belowMinimumScenario("poker", 2, "timeLeft", "PkLow");
    });

    test("poker: phase coverage is fail-closed", () => {
      assertCoverage("poker");
    });
  });

  describe("drawful", () => {
    test("drawful: drop and rejoin while drawing, bluffing, voting and at reveal", async () => {
      const t = await setupTable("drawful", 4, "minPlusOne", undefined, "Dw");
      try {
        await waitForPhaseEverywhere(t.phones, "drawing", "drawful");

        // --- drawing: the artist drops; the canvas content must be untouched
        // and the artist must be able to keep drawing after the rejoin.
        const artistIndex = t.phones.findIndex((p) => p.game?.controller?.mode === "canvas");
        assert.notStrictEqual(artistIndex, -1, "[drawful/drawing] one phone holds the canvas at the start");
        const artist = t.phones[artistIndex];
        sendInput(artist, { stroke: { points: [[0.2, 0.2], [0.5, 0.5], [0.8, 0.4]], color: "#111111" } });
        await waitFor(
          () => artist.game?.screen?.strokes?.length === 1,
          3000,
          "[drawful/drawing] the first stroke lands",
        );
        const preStrokes = artist.game.screen.strokes;
        const prePrompt = artist.game.controller.canvas.prompt;

        const backArtist = await dropAndRejoin("drawful", "drawing", t.phones, artistIndex);
        const drawSurvivor = otherPhone(t.phones, backArtist.playerId, "[drawful/drawing]");
        assert.deepStrictEqual(
          drawSurvivor.game.screen.strokes,
          preStrokes,
          "[drawful/drawing] the canvas content is unchanged while the artist is away",
        );
        await waitFor(() => backArtist.game?.controller != null, 3000, "[drawful/drawing] the rejoined controller frame");
        assert.deepStrictEqual(
          backArtist.game.controller.canvas.prompt,
          prePrompt,
          "[drawful/drawing] the private prompt survives the rejoin",
        );
        assert.deepStrictEqual(
          backArtist.game.screen.strokes,
          preStrokes,
          "[drawful/drawing] the strokes are intact after the rejoin",
        );
        sendInput(backArtist, { stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#222222" } });
        await waitFor(
          () => backArtist.game?.screen?.strokes?.length === preStrokes.length + 1,
          3000,
          "[drawful/drawing] the rejoined artist can keep drawing",
        );
        assert.deepStrictEqual(backArtist.errors, [], "[drawful/drawing] no error from the post-rejoin stroke");
        sendInput(backArtist, { action: "action" });
        await waitForPhaseEverywhere(t.phones, "bluffing", "drawful");

        // --- bluffing: a submitted bluff survives; a phone that had not
        // submitted can submit as its post-rejoin input.
        const nonArtists = t.phones.filter((_, i) => i !== artistIndex);
        assert.strictEqual(nonArtists.length, 3, "[drawful/bluffing] three non-artists at four players");
        sendInput(nonArtists[0], { text: "a surprisingly believable lie" });
        await waitFor(
          () => nonArtists[0].game?.controller?.hasSubmitted === true,
          3000,
          "[drawful/bluffing] the first bluff lands",
        );
        const backA = await dropAndRejoin("drawful", "bluffing", t.phones, t.phones.indexOf(nonArtists[0]));
        assert.strictEqual(
          backA.game.controller.hasSubmitted,
          true,
          "[drawful/bluffing] hasSubmitted stays true after the rejoin",
        );
        const backB = await dropAndRejoin("drawful", "bluffing", t.phones, t.phones.indexOf(nonArtists[1]));
        assert.strictEqual(
          backB.game.controller.hasSubmitted,
          false,
          "[drawful/bluffing] an unsubmitted phone is still unsubmitted after the rejoin",
        );
        sendInput(backB, { text: "another equally believable lie" });
        await waitFor(
          () => backB.game?.controller?.hasSubmitted === true,
          3000,
          "[drawful/bluffing] the rejoined phone can submit its bluff",
        );
        sendInput(nonArtists[2], { text: "the third lie" });
        await waitForPhaseEverywhere(t.phones, "voting", "drawful");

        // --- voting: a vote cast before the drop survives; a rejoined phone
        // can still vote afterwards; the ballot counts all three votes.
        const voters = t.phones.filter((_, i) => i !== artistIndex);
        sendInput(voters[0], { choice: choiceOf(voters[0], "[drawful/voting]") });
        await waitFor(
          () => voters[0].game?.controller?.hasVoted === true,
          3000,
          "[drawful/voting] the first vote lands",
        );
        const backV0 = await dropAndRejoin("drawful", "voting", t.phones, t.phones.indexOf(voters[0]));
        assert.strictEqual(
          backV0.game.controller.hasVoted,
          true,
          "[drawful/voting] a vote cast before the drop survives the rejoin",
        );
        const backV1 = await dropAndRejoin("drawful", "voting", t.phones, t.phones.indexOf(voters[1]));
        assert.strictEqual(
          backV1.game.controller.hasVoted,
          false,
          "[drawful/voting] an unvoted phone is still unvoted after the rejoin",
        );
        sendInput(backV1, { choice: choiceOf(backV1, "[drawful/voting]") });
        await waitFor(
          () => backV1.game?.controller?.hasVoted === true,
          3000,
          "[drawful/voting] the rejoined phone's vote is accepted",
        );
        sendInput(voters[2], { choice: choiceOf(voters[2], "[drawful/voting]") });
        await waitForPhaseEverywhere(t.phones, "reveal", "drawful");
        const reveal = t.phones[0].game.screen.reveal;
        const counted =
          reveal.realVotes + reveal.bluffVotes.reduce((sum: number, n: number) => sum + n, 0);
        assert.strictEqual(
          counted,
          3,
          "[drawful/voting] the ballot counts all three non-artist votes, including the survived and the post-rejoin vote",
        );

        // --- reveal: display-only phase (onInput only accepts drawing,
        // bluffing and voting), so the contract is "state survives, no error".
        const preRealPrompt = t.phones[0].game.screen.realPrompt;
        const preReveal = t.phones[0].game.screen.reveal;
        const revealIndex = t.phones.length - 1;
        const preInfo = t.phones[revealIndex].game.controller.info;
        const backR = await dropAndRejoin("drawful", "reveal", t.phones, revealIndex);
        await waitFor(() => backR.game?.controller != null, 3000, "[drawful/reveal] the rejoined controller frame");
        assert.deepStrictEqual(
          backR.game.screen.reveal,
          preReveal,
          "[drawful/reveal] the reveal result is identical after the rejoin",
        );
        assert.strictEqual(
          backR.game.screen.realPrompt,
          preRealPrompt,
          "[drawful/reveal] the revealed prompt is identical after the rejoin",
        );
        assert.strictEqual(
          backR.game.controller.info,
          preInfo,
          "[drawful/reveal] the phone's reveal card survives the rejoin",
        );
        const frameFloor = backR.frames;
        sendInput(backR, { text: "ignored during reveal" });
        await waitFor(
          () => backR.frames > frameFloor,
          2000,
          "[drawful/reveal] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backR.errors, [], "[drawful/reveal] reveal ignores input without raising an error");
        assert.strictEqual(
          backR.game.screen.phase,
          "reveal",
          "[drawful/reveal] the ignored input does not change the phase",
        );
      } finally {
        closeAll([...t.phones, t.screen]);
      }
    });

    test("drawful: a drop below the three-player minimum pauses the game and a rejoin resumes it", async () => {
      await belowMinimumScenario("drawful", 3, "timerMs", "DwLow");
    });

    test("drawful: phase coverage is fail-closed", () => {
      assertCoverage("drawful");
    });
  });

  describe("bluff", () => {
    test("bluff: drop and rejoin while writing, voting and at reveal", async () => {
      const t = await setupTable("bluff", 4, "minPlusOne", undefined, "Bf");
      try {
        await waitForPhaseEverywhere(t.phones, "writing", "bluff");

        // --- writing: the submission survives, and the rejoined phone can
        // revise it (writing allows overwriting).
        sendInput(t.phones[0], { text: "my first convincing lie" });
        await waitFor(
          () => t.phones[0].game?.controller?.hasSubmitted === true,
          3000,
          "[bluff/writing] the first submission lands",
        );
        const preAnswer = t.phones[0].game.controller.yourAnswer;
        const back0 = await dropAndRejoin("bluff", "writing", t.phones, 0);
        assert.strictEqual(
          back0.game.controller.hasSubmitted,
          true,
          "[bluff/writing] hasSubmitted stays true after the rejoin",
        );
        assert.strictEqual(
          back0.game.controller.yourAnswer,
          preAnswer,
          "[bluff/writing] the written answer survives the rejoin",
        );
        sendInput(back0, { text: "my revised convincing lie" });
        await waitFor(
          () => back0.game?.controller?.yourAnswer === "my revised convincing lie",
          3000,
          "[bluff/writing] the rejoined phone can revise its submission",
        );
        assert.strictEqual(
          back0.game.screen.submitted,
          1,
          "[bluff/writing] the shared screen shows exactly the one revised submission",
        );
        for (let i = 1; i < t.phones.length; i++) {
          sendInput(t.phones[i], { text: `lie number ${i}` });
        }
        await waitForPhaseEverywhere(t.phones, "voting", "bluff");

        // --- voting: a vote cast before the drop survives; a phone that had
        // not voted can vote after its own drop/rejoin; every ballot counts.
        const cast1 = choiceOf(t.phones[1], "[bluff/voting]");
        sendInput(t.phones[1], { choice: cast1 });
        await waitFor(
          () => t.phones[1].game?.controller?.hasVoted === true,
          3000,
          "[bluff/voting] the first vote lands",
        );
        const back1 = await dropAndRejoin("bluff", "voting", t.phones, 1);
        assert.strictEqual(
          back1.game.controller.hasVoted,
          true,
          "[bluff/voting] hasVoted stays true after the rejoin",
        );
        const back2 = await dropAndRejoin("bluff", "voting", t.phones, 2);
        assert.strictEqual(
          back2.game.controller.hasVoted,
          false,
          "[bluff/voting] an unvoted phone is still unvoted after the rejoin",
        );
        sendInput(back2, { choice: choiceOf(back2, "[bluff/voting]") });
        await waitFor(
          () => back2.game?.controller?.hasVoted === true,
          3000,
          "[bluff/voting] the rejoined phone's vote is accepted",
        );
        const cast3 = choiceOf(t.phones[3], "[bluff/voting]");
        sendInput(t.phones[3], { choice: cast3 });
        sendInput(t.phones[0], { choice: choiceOf(t.phones[0], "[bluff/voting]") });
        await waitForPhaseEverywhere(t.phones, "reveal", "bluff");
        const answers = t.phones[0].game.screen.answers;
        const totalVotes = answers.reduce((sum: number, a: any) => sum + a.votes, 0);
        assert.strictEqual(
          totalVotes,
          4,
          "[bluff/voting] every ballot counts, including the vote cast before the drop",
        );
        const cast1Row = answers.find((a: any) => a.id === cast1);
        assert.ok(
          cast1Row && cast1Row.votes >= 1,
          `[bluff/voting] the pre-drop vote is counted for its answer (${cast1})`,
        );

        // --- reveal: display-only phase (onInput returns during reveal).
        const preResult = t.phones[0].game.controller.result;
        const preYouVoted = t.phones[3].game.controller.youVoted;
        const backR = await dropAndRejoin("bluff", "reveal", t.phones, 3);
        await waitFor(() => backR.game?.controller != null, 3000, "[bluff/reveal] the rejoined controller frame");
        assert.deepStrictEqual(
          backR.game.controller.result,
          preResult,
          "[bluff/reveal] the round result is identical after the rejoin",
        );
        assert.strictEqual(
          backR.game.controller.youVoted,
          preYouVoted,
          "[bluff/reveal] the vote recorded on the phone survives the rejoin",
        );
        assert.strictEqual(
          backR.game.controller.youVoted,
          cast3,
          "[bluff/reveal] the rejoined phone's ballot is still the one it cast",
        );
        const frameFloor = backR.frames;
        sendInput(backR, { choice: "real" });
        await waitFor(
          () => backR.frames > frameFloor,
          2000,
          "[bluff/reveal] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backR.errors, [], "[bluff/reveal] reveal ignores input without raising an error");
        assert.strictEqual(
          backR.game.screen.phase,
          "reveal",
          "[bluff/reveal] the ignored input does not change the phase",
        );
      } finally {
        closeAll([...t.phones, t.screen]);
      }
    });

    test("bluff: a drop below the three-player minimum pauses the game and a rejoin resumes it", async () => {
      await belowMinimumScenario("bluff", 3, "timeLeft", "BfLow");
    });

    test("bluff: phase coverage is fail-closed", () => {
      assertCoverage("bluff");
    });
  });

  describe("guessimposter", () => {
    test("guessimposter: drop and rejoin in countdown, peek, clue, discussion, vote, voteReveal, finalGuess and reveal", async () => {
      // Typed clues are recorded on the shared board (spoken clues are not),
      // and the discussion floor is cut to its 30 s minimum so the matrix
      // stays inside the suite budget.
      const t = await setupTable(
        "guessimposter",
        4,
        "minPlusOne",
        { clueMode: "typed", discussionSec: 30 },
        "Gi",
      );
      try {
        // --- countdown (3 s, display-only)
        await waitForPhaseEverywhere(t.phones, "countdown", "guessimposter");
        await waitFor(() => t.phones[3].game != null, 3000, "[guessimposter/countdown] all phones have a frame");
        const preCountdown = JSON.parse(JSON.stringify(t.phones[3].game.controller));
        const backCD = await dropAndRejoin("guessimposter", "countdown", t.phones, 3);
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(backCD.game.controller)),
          preCountdown,
          "[guessimposter/countdown] the countdown card is identical after the rejoin",
        );
        const cdFloor = backCD.frames;
        sendInput(backCD, { action: "done" });
        await waitFor(
          () => backCD.frames > cdFloor,
          2000,
          "[guessimposter/countdown] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backCD.errors, [], "[guessimposter/countdown] countdown ignores input without an error");
        assert.strictEqual(
          backCD.game.screen.phase,
          "countdown",
          "[guessimposter/countdown] the ignored input does not change the phase",
        );

        // --- peek (5 s): capture every private role card, then drop the
        // Imposter - the most sensitive private state.
        await waitForPhaseEverywhere(t.phones, "peek", "guessimposter", 8000);
        const roleCards = new Map<string, any>();
        for (const p of t.phones) {
          await waitFor(
            () => p.game?.controller?.role != null,
            3000,
            `[guessimposter/peek] ${p.name} receives the peek card`,
          );
          roleCards.set(p.playerId, JSON.parse(JSON.stringify(p.game.controller.role)));
        }
        const imposters = t.phones.filter(
          (p) => roleCards.get(p.playerId)?.title === "YOU ARE THE IMPOSTER",
        );
        assert.strictEqual(
          imposters.length,
          1,
          `[guessimposter/peek] exactly one Imposter card at four players (got ${imposters.length})`,
        );
        const impId = imposters[0].playerId;
        const backPeek = await dropAndRejoin(
          "guessimposter",
          "peek",
          t.phones,
          t.phones.indexOf(imposters[0]),
        );
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(backPeek.game.controller.role)),
          roleCards.get(backPeek.playerId),
          "[guessimposter/peek] the private peek card is identical after the rejoin",
        );
        const pkFloor = backPeek.frames;
        sendInput(backPeek, { action: "done" });
        await waitFor(
          () => backPeek.frames > pkFloor,
          2000,
          "[guessimposter/peek] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backPeek.errors, [], "[guessimposter/peek] peek ignores input without an error");
        assert.strictEqual(
          backPeek.game.screen.phase,
          "peek",
          "[guessimposter/peek] the ignored input does not change the phase",
        );

        // --- clue: drop the phone that currently holds the clue turn.
        await waitForPhaseEverywhere(t.phones, "clue", "guessimposter", 8000);
        const activeId0 = t.phones[0].game.screen.activePlayer.id;
        const activeIndex = t.phones.findIndex((p) => p.playerId === activeId0);
        assert.notStrictEqual(activeIndex, -1, "[guessimposter/clue] the active clue turn belongs to a seated phone");
        const activeName = t.phones[activeIndex].name;
        const backAct = await dropAndRejoin("guessimposter", "clue", t.phones, activeIndex);
        const clueSurvivor = otherPhone(t.phones, backAct.playerId, "[guessimposter/clue]");
        // Designed behaviour, reported as a finding: guessimposter does NOT
        // hold an absent player's clue turn - the next tick hands it to the
        // next seat. What must hold is that the game keeps running and the
        // rejoining phone gets its turn back in the next clue round.
        assert.notStrictEqual(
          clueSurvivor.game.screen.activePlayer?.name,
          activeName,
          "[guessimposter/clue] the clue turn hands over without crashing when its holder drops",
        );
        assert.strictEqual(
          backAct.game.controller.isYourTurn,
          false,
          "[guessimposter/clue] the rejoined phone no longer owns the forfeited turn",
        );
        assert.deepStrictEqual(backAct.errors, [], "[guessimposter/clue] no error on rejoin during the clue phase");

        const clueWords = new Map<string, string>();
        const hasClue = (playerId: string) => () =>
          (t.phones[0].game?.screen?.clues ?? []).some((c: any) => c.id === playerId);
        assert.strictEqual(
          hasClue(backAct.playerId)(),
          false,
          "[guessimposter/clue] the forfeited round-one clue never landed",
        );
        await driveClueTurns(t.phones, clueWords, hasClue(backAct.playerId), 10000);
        const mine = t.phones[0].game.screen.clues.find((c: any) => c.id === backAct.playerId);
        assert.ok(mine, "[guessimposter/clue] the rejoined phone's clue is accepted when its turn returns");
        assert.strictEqual(
          mine.text,
          clueWords.get(backAct.playerId),
          "[guessimposter/clue] the rejoined phone's clue text lands exactly as typed",
        );

        // A clue submitted before a drop survives the rejoin.
        const activeNow = t.phones[0].game.screen.activePlayer?.id ?? "";
        const cluesNow = t.phones[0].game.screen.clues;
        const qId = cluesNow.find((c: any) => c.id !== backAct.playerId && c.id !== activeNow)?.id;
        assert.ok(qId, "[guessimposter/clue] another phone already has a clue on the board");
        const preQ = JSON.parse(JSON.stringify(cluesNow.find((c: any) => c.id === qId)));
        const backQ = await dropAndRejoin(
          "guessimposter",
          "clue",
          t.phones,
          t.phones.findIndex((p) => p.playerId === qId),
        );
        const postQ = backQ.game.screen.clues.find((c: any) => c.id === qId);
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(postQ)),
          preQ,
          "[guessimposter/clue] a clue submitted before the drop survives the rejoin",
        );

        await driveClueTurns(
          t.phones,
          clueWords,
          () => t.phones[0].game?.screen?.phase !== "clue",
          10000,
        );
        assert.strictEqual(
          t.phones[0].game.screen.phase,
          "discussion",
          "[guessimposter/clue] the clue rounds hand over to the discussion",
        );

        // --- discussion (30 s floor, display-only)
        const backD = await dropAndRejoin("guessimposter", "discussion", t.phones, t.phones.length - 1);
        assert.strictEqual(backD.game.controller.mode, "wait", "[guessimposter/discussion] the discussion card survives the rejoin");
        assert.strictEqual(
          backD.game.controller.info,
          "Talk it out. Then vote.",
          "[guessimposter/discussion] the discussion card is identical after the rejoin",
        );
        const dFloor = backD.frames;
        sendInput(backD, { choice: "p:0" });
        await waitFor(
          () => backD.frames > dFloor,
          2000,
          "[guessimposter/discussion] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backD.errors, [], "[guessimposter/discussion] discussion ignores input without an error");
        assert.strictEqual(
          backD.game.screen.phase,
          "discussion",
          "[guessimposter/discussion] the ignored input does not change the phase",
        );
        await waitForPhaseEverywhere(t.phones, "vote", "guessimposter", 33000);

        // --- vote: a vote cast before the drop survives and is counted; a
        // phone that had not voted can vote after its drop/rejoin; the
        // unanimous ballot ejects the Imposter identified at peek.
        const impSeat = gameSeatOf(t.phones[0], impId, "[guessimposter/vote]");
        const crewPhones = t.phones.filter((p) => p.playerId !== impId);
        assert.strictEqual(crewPhones.length, 3, "[guessimposter/vote] three crew seats at four players");
        const impTarget = `p:${impSeat}`;
        sendInput(crewPhones[0], { choice: impTarget });
        await waitFor(
          () => crewPhones[0].game?.controller?.hasVoted === true,
          3000,
          "[guessimposter/vote] the first ballot lands",
        );
        const backVB = await dropAndRejoin(
          "guessimposter",
          "vote",
          t.phones,
          t.phones.indexOf(crewPhones[0]),
        );
        assert.strictEqual(
          backVB.game.controller.hasVoted,
          true,
          "[guessimposter/vote] a vote cast before the drop survives the rejoin",
        );
        const backVC = await dropAndRejoin(
          "guessimposter",
          "vote",
          t.phones,
          t.phones.indexOf(crewPhones[1]),
        );
        assert.strictEqual(
          backVC.game.controller.hasVoted,
          false,
          "[guessimposter/vote] an unvoted phone is still unvoted after the rejoin",
        );
        sendInput(backVC, { choice: impTarget });
        await waitFor(
          () => backVC.game?.controller?.hasVoted === true,
          3000,
          "[guessimposter/vote] the rejoined phone's vote is accepted",
        );
        sendInput(crewPhones[2], { choice: impTarget });
        const impPhone = t.phones.find((p) => p.playerId === impId);
        assert.ok(impPhone, "[guessimposter/vote] the Imposter's phone is still at the table");
        const impChoice = `p:${gameSeatOf(t.phones[0], crewPhones[2].playerId, "[guessimposter/vote]")}`;
        sendInput(impPhone, { choice: impChoice });
        await waitForPhaseEverywhere(t.phones, "voteReveal", "guessimposter", 8000);
        const voteReveal = t.phones[0].game.screen.voteReveal;
        const impRow = voteReveal.tally.find((r: any) => r.seat === impSeat);
        assert.strictEqual(
          impRow?.votes,
          3,
          "[guessimposter/vote] all three crew ballots count the Imposter, including the vote that survived a drop",
        );
        const ballotB = voteReveal.ballots.find((b: any) => b.id === backVB.playerId);
        assert.ok(
          ballotB?.target && ballotB.target.seat === impSeat,
          "[guessimposter/vote] the pre-drop ballot is recorded for its target at the reveal",
        );
        assert.strictEqual(
          voteReveal.ejected?.seat,
          impSeat,
          "[guessimposter/vote] the Imposter is ejected, which opens the final guess",
        );

        // --- voteReveal (6 s, display-only)
        const preVR = JSON.parse(JSON.stringify(t.phones[0].game.screen.voteReveal));
        const backVR = await dropAndRejoin("guessimposter", "voteReveal", t.phones, t.phones.length - 1);
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(backVR.game.screen.voteReveal)),
          preVR,
          "[guessimposter/voteReveal] the tally and ballots are identical after the rejoin",
        );
        const vrFloor = backVR.frames;
        sendInput(backVR, { choice: "p:0" });
        await waitFor(
          () => backVR.frames > vrFloor,
          2000,
          "[guessimposter/voteReveal] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backVR.errors, [], "[guessimposter/voteReveal] voteReveal ignores input without an error");
        assert.strictEqual(
          backVR.game.screen.phase,
          "voteReveal",
          "[guessimposter/voteReveal] the ignored input does not change the phase",
        );

        // --- finalGuess: the ejected Imposter holds the only action, so the
        // dropped phone must hold the game and answer after its rejoin.
        await waitForPhaseEverywhere(t.phones, "finalGuess", "guessimposter", 8000);
        const impNow = t.phones.find((p) => p.playerId === impId);
        assert.ok(impNow, "[guessimposter/finalGuess] the Imposter's phone is at the table");
        assert.strictEqual(
          impNow.game.controller.mode,
          "choice",
          "[guessimposter/finalGuess] the ejected Imposter receives the final-guess ballot",
        );
        const preOptions = JSON.parse(JSON.stringify(impNow.game.controller.options));
        assert.strictEqual(preOptions.length, 6, "[guessimposter/finalGuess] six options on the final ballot");
        const backFG = await dropAndRejoin(
          "guessimposter",
          "finalGuess",
          t.phones,
          t.phones.indexOf(impNow),
        );
        const fgSurvivor = otherPhone(t.phones, impId, "[guessimposter/finalGuess]");
        assert.strictEqual(
          fgSurvivor.game.screen.phase,
          "finalGuess",
          "[guessimposter/finalGuess] the game waits for the dropped guesser instead of resolving early",
        );
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(backFG.game.controller.options)),
          preOptions,
          "[guessimposter/finalGuess] the final-guess options are identical after the rejoin",
        );
        assert.strictEqual(
          backFG.game.controller.hasVoted,
          false,
          "[guessimposter/finalGuess] the guess is still pending after the rejoin",
        );
        sendInput(backFG, { choice: preOptions[0].id });
        await waitForPhaseEverywhere(t.phones, "reveal", "guessimposter", 5000);

        // --- reveal (8 s, display-only)
        const preFR = JSON.parse(JSON.stringify(t.phones[0].game.screen.finalReveal));
        assert.ok(preFR, "[guessimposter/reveal] the word result is on screen at the reveal");
        assert.ok(
          preFR.imposters.some((i: any) => i.id === impId),
          "[guessimposter/reveal] the reveal confirms the phone identified as the Imposter at peek",
        );
        const revealIndex = (t.phones.findIndex((p) => p.playerId === impId) + 1) % t.phones.length;
        const preRevealCard = JSON.parse(JSON.stringify(t.phones[revealIndex].game.controller.reveal));
        assert.ok(preRevealCard, "[guessimposter/reveal] the phone carries the private reveal card");
        const backRV = await dropAndRejoin("guessimposter", "reveal", t.phones, revealIndex);
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(backRV.game.screen.finalReveal)),
          preFR,
          "[guessimposter/reveal] the reveal payload is identical after the rejoin",
        );
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(backRV.game.controller.reveal)),
          preRevealCard,
          "[guessimposter/reveal] the private reveal card survives the rejoin",
        );
        const rvFloor = backRV.frames;
        sendInput(backRV, { tap: true });
        await waitFor(
          () => backRV.frames > rvFloor,
          2000,
          "[guessimposter/reveal] the server keeps producing state after a display-only input",
        );
        assert.deepStrictEqual(backRV.errors, [], "[guessimposter/reveal] reveal ignores input without an error");
        assert.strictEqual(
          backRV.game.screen.phase,
          "reveal",
          "[guessimposter/reveal] the ignored input does not change the phase",
        );
      } finally {
        closeAll([...t.phones, t.screen]);
      }
    });

    test("guessimposter: a drop below the three-player minimum pauses the game and a rejoin resumes it", async () => {
      await belowMinimumScenario("guessimposter", 3, "timerMs", "GiLow");
    });

    test("guessimposter: phase coverage is fail-closed", () => {
      assertCoverage("guessimposter");
    });
  });
});

/** Typed-clue words, one per seat index (each seat keeps its own word). */
const CLUE_WORDS = ["orbit", "meadow", "cinder", "harbor"];

/** Feed the clue turn of whichever phone currently owns it until `done`. */
async function driveClueTurns(
  phones: Phone[],
  words: Map<string, string>,
  done: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (done()) return;
    phones.forEach((p, i) => {
      const cs = p.game?.controller;
      if (cs && cs.mode === "text" && cs.isYourTurn === true) {
        const word = CLUE_WORDS[i % CLUE_WORDS.length];
        words.set(p.playerId, word);
        sendInput(p, { text: word });
      }
    });
    await sleep(20);
  }
  throw new Error("[guessimposter/clue] timed out driving the clue turns");
}
