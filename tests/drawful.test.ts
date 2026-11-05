/**
 * Drawful: 3-8 player flow, the 3-4 parity rounds, seat-order drawings at 5-8,
 * scaled scoring, the TV privacy boundary, host skip/hide and result stats.
 *
 * The 3-4 cases intentionally pin the original numbers: artist 500 per true
 * vote, 250 per bluff vote, three drawings with the drawer in seat order.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, scalePayout, withinRoundBound } from "../shared/scoring.ts";
import { voteLayout } from "../shared/vote-options.ts";
import drawfulPlugin, { drawfulPlan } from "../games/drawful/server.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface TestRoom {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: TestPlayer[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

interface DrawfulState {
  round: number;
  maxRounds: number;
  artists: number[];
  prompts: string[];
  phase: "drawing" | "bluffing" | "voting" | "reveal" | "finished";
  drawer: number;
  prompt: string;
  strokes: Array<{ points: Array<[number, number]>; color: string }>;
  bluffs: Array<string | null>;
  votes: Array<string | null>;
  order: string[];
  scores: number[];
  timerMs: number;
  reveal: { realVotes: number; bluffVotes: number[] } | null;
  drawingHidden: boolean;
  stats: Record<string, number>;
}

interface DrawfulInstance {
  roomId: string;
  players: TestPlayer[];
  state: DrawfulState;
}

interface TVOption {
  id: string;
  label: string;
  correct?: boolean;
  votes?: number;
}

interface TVScreen {
  phase: string;
  round: number;
  maxRounds: number;
  drawingNumber: number;
  totalDrawings: number;
  drawerName: string;
  artistName: string;
  strokes: Array<{ points: Array<[number, number]>; color: string }>;
  drawingHidden: boolean;
  options: TVOption[];
  optionColumns: number;
  realPrompt: string | null;
  reveal: { realVotes: number; bluffVotes: number[] } | null;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  timerMs: number;
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: string | null;
}

interface ControllerState {
  mode: string;
  round?: number;
  maxRounds?: number;
  options: Array<{ id: string; label: string }>;
  hasSubmitted?: boolean;
  hasVoted?: boolean;
  canvas?: { prompt: string };
  info?: string;
}

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: TestPlayer[]): TestRoom {
  return {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0]?.id ?? null,
    players,
    gameId: "drawful",
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

function startGame(
  count: number,
  mode?: "standalone" | "rumble",
): { players: TestPlayer[]; inst: DrawfulInstance } {
  const players = makePlayers(count);
  const options = mode ? { mode } : undefined;
  const inst = drawfulPlugin.onStart(makeRoom(players), players, options) as unknown as DrawfulInstance;
  return { players, inst };
}

function screenOf(inst: DrawfulInstance): TVScreen {
  return drawfulPlugin.screenState(inst) as TVScreen;
}

function controllerOf(inst: DrawfulInstance, player: TestPlayer): ControllerState {
  return drawfulPlugin.controllerState(inst, player.id) as ControllerState;
}

/** The opaque ballot id a viewer sees for an internal reference. */
function idForRef(inst: DrawfulInstance, seat: number, ref: string): string {
  const entry = inst.state.order
    .map((candidate, index) => ({ id: `o${index}`, ref: candidate }))
    .filter((candidate) => candidate.ref !== `b:${seat}`)
    .find((candidate) => candidate.ref === ref);
  assert.ok(entry, `seat ${seat} should see ${ref}`);
  return entry.id;
}

/**
 * Play one full drawing: the artist draws and submits, everyone else bluffs,
 * then every non-artist votes for the reference `voteFor` returns.
 */
function playRound(
  inst: DrawfulInstance,
  players: TestPlayer[],
  voteFor: (seat: number, artist: number) => string,
): number {
  assert.strictEqual(inst.state.phase, "drawing", "a drawing starts in the drawing phase");
  const artist = inst.state.drawer;

  drawfulPlugin.onInput(inst, players[artist].id, {
    stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111111" },
  });
  assert.strictEqual(inst.state.strokes.length, 1, "the artist's stroke reaches the server");
  drawfulPlugin.onInput(inst, players[artist].id, { action: "action" });
  assert.strictEqual(inst.state.phase, "bluffing", "the artist ends the drawing");

  players.forEach((player, seat) => {
    if (seat === artist) return;
    drawfulPlugin.onInput(inst, player.id, { text: `A fake title from ${player.name}` });
  });
  assert.strictEqual(inst.state.phase, "voting", "the last bluff opens the vote");

  players.forEach((player, seat) => {
    if (seat === artist) return;
    drawfulPlugin.onInput(inst, player.id, { choice: idForRef(inst, seat, voteFor(seat, artist)) });
  });
  assert.strictEqual(inst.state.phase, "reveal", "the last vote settles the drawing");
  return artist;
}

/** Advance the server clock past the reveal into the next drawing (or the end). */
function advanceFromReveal(inst: DrawfulInstance): void {
  for (let i = 0; i < 10 && inst.state.phase === "reveal"; i++) {
    drawfulPlugin.onTick(inst, 2000);
  }
}

function roundGains(before: number[], after: number[]): number[] {
  return after.map((score, i) => score - before[i]);
}

describe("drawful", () => {
  test("the catalog and both manifests report 3-8 players and the scaled rounds", () => {
    const entry = GAME_CATALOG.drawful;
    assert.strictEqual(entry.minPlayers, 3);
    assert.strictEqual(entry.maxPlayers, 8);
    assert.strictEqual(entry.idealMin, 4);
    assert.strictEqual(entry.idealMax, 8);

    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "games", "drawful", "manifest.json"), "utf8"),
    ) as { minPlayers: number; maxPlayers: number };
    assert.strictEqual(manifest.minPlayers, 3);
    assert.strictEqual(manifest.maxPlayers, 8);
    assert.strictEqual(drawfulPlugin.manifest.minPlayers, 3);
    assert.strictEqual(drawfulPlugin.manifest.maxPlayers, 8);

    for (let count = 3; count <= 8; count++) {
      const standalone = entry.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, count <= 4 ? 3 : count, `${count}: standalone rounds`);
      assert.strictEqual(standalone.timers?.draw, 60, `${count}: draw timer unchanged`);
      assert.strictEqual(standalone.timers?.bluff, 35, `${count}: bluff timer unchanged`);
      assert.strictEqual(standalone.timers?.vote, 25, `${count}: vote timer unchanged`);
      assert.strictEqual(standalone.timers?.reveal, 9, `${count}: reveal timer unchanged`);
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one title per seat`);

      const rumble = entry.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, count <= 4 ? 3 : 4, `${count}: rumble rounds`);
      assert.deepStrictEqual(rumble.timers, standalone.timers, `${count}: rumble timers changed`);
    }
  });

  test("the round plan keeps 3-4 parity and gives 5-8 one drawing per seat", () => {
    for (const count of [3, 4]) {
      const plan = drawfulPlan(count);
      assert.strictEqual(plan.rounds, 3, `${count}: three drawings`);
      assert.deepStrictEqual(plan.artists, [0, 1, 2], `${count}: seat order`);
      assert.strictEqual(plan.prompts.length, 3);
    }

    for (let count = 5; count <= 8; count++) {
      const plan = drawfulPlan(count);
      assert.strictEqual(plan.rounds, count, `${count}: one drawing per seat`);
      assert.deepStrictEqual(
        plan.artists,
        Array.from({ length: count }, (_, index) => index),
        `${count}: drawing in seat order`,
      );
      assert.strictEqual(new Set(plan.prompts).size, count, `${count}: prompts are unique`);
    }

    // Rumble: four drawings chosen by secure random, three at 3-4 for parity.
    for (let count = 3; count <= 8; count++) {
      const plan = drawfulPlan(count, "rumble");
      assert.strictEqual(plan.rounds, count <= 4 ? 3 : 4, `${count}: rumble drawings`);
      assert.strictEqual(plan.artists.length, plan.rounds);
      assert.strictEqual(new Set(plan.artists).size, plan.rounds, `${count}: artists are distinct`);
      assert.ok(plan.artists.every((seat) => seat >= 0 && seat < count), `${count}: artist in range`);
    }

    const rumbleStart = startGame(8, "rumble");
    assert.strictEqual(rumbleStart.inst.state.maxRounds, 4, "onStart honours the rumble mode");
    const standaloneStart = startGame(8);
    assert.strictEqual(standaloneStart.inst.state.maxRounds, 8, "standalone gives one drawing per seat");
  });

  test("playthrough at three players: three drawings, seat-order artists, clean finish", () => {
    const { players, inst } = startGame(3);
    assert.strictEqual(inst.state.maxRounds, 3);

    for (let round = 0; round < 3; round++) {
      assert.strictEqual(inst.state.round, round);
      assert.strictEqual(inst.state.drawer, round, `drawing ${round + 1}: the artist is seat ${round}`);
      const screen = screenOf(inst);
      assert.strictEqual(screen.drawingNumber, round + 1);
      assert.strictEqual(screen.totalDrawings, 3);
      assert.strictEqual(screen.artistName, players[round].name);

      playRound(inst, players, () => "real");
      const reveal = screenOf(inst);
      assert.strictEqual(reveal.sound, "reveal");
      assert.ok(reveal.caption && reveal.caption.length > 0, "the reveal has a public caption");
      assert.strictEqual(reveal.realPrompt, inst.state.prompt, "the truth is public at the reveal");
      assert.ok(inst.state.scores.every((score) => Number.isFinite(score) && score >= 0));

      advanceFromReveal(inst);
    }

    assert.strictEqual(inst.state.phase, "finished");
    const final = screenOf(inst);
    assert.strictEqual(final.finished, true);
    assert.ok(final.winner && final.winner.length > 0);
  });

  test("playthrough at eight players: eight drawings and a readable final vote", () => {
    const { players, inst } = startGame(8);
    assert.strictEqual(inst.state.maxRounds, 8);
    assert.deepStrictEqual(inst.state.artists, [0, 1, 2, 3, 4, 5, 6, 7]);

    for (let round = 0; round < 8; round++) {
      assert.strictEqual(inst.state.drawer, round, `drawing ${round + 1}: seat ${round} draws`);
      playRound(inst, players, () => "real");

      const reveal = screenOf(inst);
      assert.strictEqual(reveal.options.length, 8, "seven bluffs plus the real title");
      assert.strictEqual(reveal.optionColumns, 2, "eight options use the two-column layout");
      assert.strictEqual(voteLayout(8).columns, 2);
      assert.deepStrictEqual(voteLayout(8).letters, ["A", "B", "C", "D", "E", "F", "G", "H"]);
      assert.ok(inst.state.scores.every((score) => Number.isFinite(score) && score >= 0));

      advanceFromReveal(inst);
    }

    assert.strictEqual(inst.state.phase, "finished");
    assert.strictEqual(screenOf(inst).finished, true);
  });

  test("at eight the TV ballot has eight options and each phone seven", () => {
    const { players, inst } = startGame(8);
    const artist = inst.state.drawer;

    drawfulPlugin.onInput(inst, players[artist].id, {
      stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111111" },
    });
    drawfulPlugin.onInput(inst, players[artist].id, { action: "action" });
    players.forEach((player, seat) => {
      if (seat === artist) return;
      drawfulPlugin.onInput(inst, player.id, { text: `Bluff from ${player.name}` });
    });
    assert.strictEqual(inst.state.phase, "voting");

    const screen = screenOf(inst);
    assert.strictEqual(screen.options.length, 8, "the TV lists the real title and seven bluffs");
    assert.strictEqual(screen.optionColumns, 2);
    assert.strictEqual(voteLayout(screen.options.length).columns, 2);
    assert.ok(!screen.options.some((option) => option.id === "real"), "no option id names the truth");

    for (const [seat, player] of players.entries()) {
      if (seat === artist) continue;
      const controller = controllerOf(inst, player);
      assert.strictEqual(controller.options.length, 7, `seat ${seat}: own bluff is excluded`);
      assert.ok(controller.options.every((option) => /^o\d+$/.test(option.id)), "phone ids are opaque");
    }
  });

  test("scoring at three and four players is exactly 500 and 250 per vote", () => {
    for (const count of [3, 4]) {
      const { players, inst } = startGame(count);
      const before = [...inst.state.scores];
      playRound(inst, players, () => "real");
      const gains = roundGains(before, inst.state.scores);
      assert.strictEqual(gains[0], (count - 1) * 500, `${count}: the artist takes 500 per true vote`);
      assert.ok(gains.slice(1).every((gain) => gain === 0), `${count}: bluffs with no votes pay nothing`);
    }

    const { players, inst } = startGame(4);
    const before = [...inst.state.scores];
    playRound(inst, players, (seat) => (seat === 1 ? "b:2" : seat === 2 ? "b:1" : "real"));
    assert.deepStrictEqual(
      roundGains(before, inst.state.scores),
      [500, 250, 250, 0],
      "one true vote and one vote per bluff pay the original 500/250",
    );
  });

  test("scoring scales above four players", () => {
    for (let count = 5; count <= 8; count++) {
      const { players, inst } = startGame(count);
      const before = [...inst.state.scores];
      playRound(inst, players, () => "real");
      const gains = roundGains(before, inst.state.scores);
      assert.strictEqual(
        gains[0],
        (count - 1) * scalePayout(500, count),
        `${count}: every voter pays the scaled true-title value`,
      );
      assert.ok(gains.slice(1).every((gain) => gain === 0), `${count}: no votes, no bluff pay`);
    }

    for (let count = 5; count <= 8; count++) {
      const { players, inst } = startGame(count);
      const before = [...inst.state.scores];
      // Seat 1's bluff is believed by everyone except its author, who votes true.
      playRound(inst, players, (seat) => (seat === 1 ? "real" : "b:1"));
      const gains = roundGains(before, inst.state.scores);
      assert.strictEqual(gains[0], scalePayout(500, count), `${count}: one scaled true vote`);
      assert.strictEqual(
        gains[1],
        (count - 2) * scalePayout(250, count),
        `${count}: each bluff vote pays the scaled 250`,
      );
    }
  });

  test("one player's maximum round gain stays inside the 1500 bound at 3-8", () => {
    for (let count = 3; count <= 8; count++) {
      const { players, inst } = startGame(count);
      const before = [...inst.state.scores];
      playRound(inst, players, () => "real");
      const gains = roundGains(before, inst.state.scores);
      const top = Math.max(...gains);
      assert.ok(top <= MAX_ROUND_SCORE, `${count}: ${top} exceeds the round bound`);
      assert.ok(withinRoundBound(top), `${count}: ${top} fails the shared helper`);

      // Even if every possible bluff vote lands on one author, the payout is
      // below the artist's maximum and inside the same bound.
      const bluffCeiling = (count - 2) * scalePayout(250, count);
      assert.ok(bluffCeiling <= MAX_ROUND_SCORE, `${count}: bluff ceiling ${bluffCeiling}`);
    }
  });

  test("the prompt and bluffs stay off the TV until they are allowed", () => {
    const { players, inst } = startGame(8);
    const artist = inst.state.drawer;

    // Drawing: no prompt or future prompt reaches the shared screen.
    const drawing = screenOf(inst);
    const drawingJson = JSON.stringify(drawing);
    assert.strictEqual(drawing.realPrompt, null);
    for (const prompt of inst.state.prompts) {
      assert.ok(!drawingJson.includes(prompt), "no drawing prompt reaches the TV before the reveal");
    }
    assert.ok(
      JSON.stringify(controllerOf(inst, players[artist])).includes(inst.state.prompt),
      "the artist sees the prompt on their phone",
    );
    for (const [seat, player] of players.entries()) {
      if (seat === artist) continue;
      assert.ok(
        !JSON.stringify(controllerOf(inst, player)).includes(inst.state.prompt),
        `seat ${seat}: a non-artist never receives the prompt`,
      );
    }

    drawfulPlugin.onInput(inst, players[artist].id, {
      stroke: { points: [[0.1, 0.2], [0.8, 0.9]], color: "#111111" },
    });
    drawfulPlugin.onInput(inst, players[artist].id, { action: "action" });
    drawfulPlugin.onInput(inst, players[1].id, { text: "TOPSECRET-BLUFF" });
    const bluffing = screenOf(inst);
    assert.strictEqual(bluffing.phase, "bluffing");
    assert.ok(!JSON.stringify(bluffing).includes("TOPSECRET-BLUFF"), "bluffs stay off the TV before the vote");
    assert.deepStrictEqual(bluffing.waitingOn, players.slice(2).map((player) => player.name));

    // Everyone else bluffs; the vote opens and only then may titles appear.
    players.slice(2).forEach((player) => {
      drawfulPlugin.onInput(inst, player.id, { text: `Bluff from ${player.name}` });
    });
    assert.strictEqual(inst.state.phase, "voting");
    const voting = screenOf(inst);
    assert.strictEqual(voting.realPrompt, null, "the real title is not labelled before the reveal");
    assert.ok(!voting.options.some((option) => option.correct !== undefined), "no correctness marker before reveal");
    assert.strictEqual(voting.options.length, 8);
    assert.strictEqual(voting.optionColumns, 2);

    // Finish the vote: the reveal names the real title and marks its option.
    players.forEach((player, seat) => {
      if (seat === artist) return;
      drawfulPlugin.onInput(inst, player.id, { choice: idForRef(inst, seat, "real") });
    });
    const reveal = screenOf(inst);
    assert.strictEqual(reveal.realPrompt, inst.state.prompt, "the truth is public only at the reveal");
    const correct = reveal.options.filter((option) => option.correct === true);
    assert.strictEqual(correct.length, 1, "exactly one option is the real title");
    assert.strictEqual(correct[0].label, inst.state.prompt);
    assert.strictEqual(reveal.sound, "reveal");
    assert.ok(reveal.caption && reveal.caption.length > 0);
  });

  test("waitingOn lists the seats still to bluff and vote", () => {
    const { players, inst } = startGame(4);
    assert.deepStrictEqual(screenOf(inst).waitingOn, [], "drawing has no waiting list");

    drawfulPlugin.onInput(inst, players[0].id, {
      stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111111" },
    });
    drawfulPlugin.onInput(inst, players[0].id, { action: "action" });
    assert.strictEqual(inst.state.phase, "bluffing");
    drawfulPlugin.onInput(inst, players[1].id, { text: "one bluff" });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[2].name, players[3].name]);
    drawfulPlugin.onInput(inst, players[2].id, { text: "two bluff" });
    drawfulPlugin.onInput(inst, players[3].id, { text: "three bluff" });
    assert.strictEqual(inst.state.phase, "voting");
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[1].name, players[2].name, players[3].name]);

    drawfulPlugin.onInput(inst, players[1].id, { choice: idForRef(inst, 1, "real") });
    assert.deepStrictEqual(screenOf(inst).waitingOn, [players[2].name, players[3].name]);
    drawfulPlugin.onInput(inst, players[2].id, { choice: idForRef(inst, 2, "real") });
    drawfulPlugin.onInput(inst, players[3].id, { choice: idForRef(inst, 3, "real") });
    assert.strictEqual(inst.state.phase, "reveal");
    assert.deepStrictEqual(screenOf(inst).waitingOn, []);
  });

  test("host hide and skip act on the server state, not the client", () => {
    const { players, inst } = startGame(8);
    drawfulPlugin.onInput(inst, players[0].id, {
      stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111111" },
    });
    assert.strictEqual(screenOf(inst).strokes.length, 1);

    assert.strictEqual(drawfulPlugin.onHostAction!(inst, "hide-drawing"), true);
    const hidden = screenOf(inst);
    assert.strictEqual(hidden.drawingHidden, true);
    assert.deepStrictEqual(hidden.strokes, [], "the TV payload no longer carries the hidden strokes");
    assert.ok(
      JSON.stringify(controllerOf(inst, players[0])).includes(inst.state.prompt),
      "hiding never touches the artist's phone",
    );

    assert.strictEqual(drawfulPlugin.onHostAction!(inst, "show-drawing"), true);
    assert.strictEqual(screenOf(inst).drawingHidden, false);
    assert.strictEqual(screenOf(inst).strokes.length, 1, "showing restores the received strokes");

    assert.strictEqual(drawfulPlugin.onHostAction!(inst, "hide-drawing"), true);
    assert.strictEqual(drawfulPlugin.onHostAction!(inst, "skip-drawing"), true);
    assert.strictEqual(inst.state.phase, "drawing", "skip starts the next drawing");
    assert.strictEqual(inst.state.round, 1, "the next drawing is round two");
    assert.strictEqual(screenOf(inst).drawingHidden, false, "a new drawing starts visible");
    assert.ok(inst.state.scores.every((score) => score === 0), "a skipped drawing scores nothing");

    assert.strictEqual(drawfulPlugin.onHostAction!(inst, "launch-rockets"), false, "unknown actions are refused");

    // Skipping every remaining drawing ends the game cleanly.
    for (let i = 0; i < 10 && !screenOf(inst).finished; i++) {
      drawfulPlugin.onHostAction!(inst, "skip-drawing");
    }
    assert.strictEqual(inst.state.phase, "finished");
    assert.strictEqual(drawfulPlugin.onHostAction!(inst, "skip-drawing"), false, "a finished game refuses actions");
  });

  test("results reports standings plus votes received and fooled votes", () => {
    const { players, inst } = startGame(4);
    playRound(inst, players, (seat) => (seat === 1 ? "b:2" : seat === 2 ? "b:1" : "real"));

    const result = drawfulPlugin.results!(inst);
    assert.strictEqual(result.standings.length, 4);
    assert.deepStrictEqual(
      result.standings.map((standing) => standing.playerId).sort(),
      players.map((player) => player.id).sort(),
    );
    for (const standing of result.standings) {
      assert.ok(Number.isFinite(standing.raw));
      assert.ok(standing.rank >= 1 && standing.rank <= 4);
    }
    assert.strictEqual(result.stats[`${players[0].id}:votesReceived`], 1, "the artist's true vote");
    assert.strictEqual(result.stats[`${players[0].id}:fooledVotes`], 0);
    assert.strictEqual(result.stats[`${players[1].id}:votesReceived`], 1);
    assert.strictEqual(result.stats[`${players[1].id}:fooledVotes`], 1);
    assert.strictEqual(result.stats[`${players[2].id}:votesReceived`], 1);
    assert.strictEqual(result.stats[`${players[2].id}:fooledVotes`], 1);
    assert.strictEqual(result.stats[`${players[3].id}:votesReceived`], 0);
    assert.strictEqual(result.stats[`${players[3].id}:fooledVotes`], 0);
  });
});

// --- Host-token endpoint ---------------------------------------------------

interface Phone {
  ws: WebSocket;
  playerId: string;
  token: string;
  hostToken: string;
  roomId: string;
  room: any;
  game: any;
}

function joinPhone(wsUrl: string, name: string, roomId = "", rejoinToken = ""): Promise<Phone> {
  const ws = new WebSocket(wsUrl);
  const phone: Phone = { ws, playerId: "", token: "", hostToken: "", roomId: "", room: null, game: null };
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "joined") {
      phone.playerId = msg.payload.playerId;
      phone.token = msg.payload.rejoinToken;
      phone.roomId = msg.roomId;
      if (typeof msg.payload.hostToken === "string") phone.hostToken = msg.payload.hostToken;
    }
    if (msg.type === "roomState") phone.room = msg.payload;
    if (msg.type === "gameState") phone.game = msg.payload;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 4000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${label}`);
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

describe("drawful host controls endpoint", () => {
  let fixture: ServerFixture;

  before(async () => {
    fixture = await startServer();
  });

  after(() => fixture?.stop());

  test("host-authenticated hide and skip reach the running drawing", async () => {
    const a = await joinPhone(fixture.wsUrl, "Ana");
    await sleep(120);
    const roomId = a.roomId;
    const b = await joinPhone(fixture.wsUrl, "Ben", roomId);
    const c = await joinPhone(fixture.wsUrl, "Cara", roomId);
    await sleep(250);
    const screenToken = await connectScreen(fixture.wsUrl, roomId);
    assert.strictEqual(a.hostToken, screenToken, "the first phone holds the host token");

    // No game yet: the endpoint refuses before touching a plugin.
    const lobby = await post(fixture.httpUrl, roomId, "host-action", a.hostToken, { action: "hide-drawing" });
    assert.strictEqual(lobby.status, 409);
    assert.strictEqual(lobby.body.code, "NO_ACTIVE_GAME");

    const started = await post(fixture.httpUrl, roomId, "start", a.hostToken, { gameId: "drawful" });
    assert.strictEqual(started.status, 200);
    await waitFor(() => a.game?.screen?.drawingNumber === 1, 3000, "first drawing frame");

    // Auth: no token and a rejoin token are both refused.
    const unauthenticated = await post(fixture.httpUrl, roomId, "host-action", undefined, { action: "hide-drawing" });
    assert.strictEqual(unauthenticated.status, 403);
    const nonHost = await post(fixture.httpUrl, roomId, "host-action", b.token, { action: "hide-drawing" });
    assert.strictEqual(nonHost.status, 403);

    // Unknown action: refused, not silently ignored.
    const unknown = await post(fixture.httpUrl, roomId, "host-action", a.hostToken, { action: "launch-rockets" });
    assert.strictEqual(unknown.status, 400);
    assert.strictEqual(unknown.body.code, "HOST_ACTION_UNSUPPORTED");

    // The artist (seat 0, player a) sends a stroke so hiding has something to hide.
    a.ws.send(JSON.stringify({
      type: "input",
      roomId,
      timestamp: Date.now(),
      payload: { stroke: { points: [[0.1, 0.1], [0.5, 0.5]], color: "#111111" } },
    }));
    await waitFor(() => (a.game?.screen?.strokes?.length ?? 0) > 0, 3000, "artist stroke on the TV");

    const hidden = await post(fixture.httpUrl, roomId, "host-action", a.hostToken, { action: "hide-drawing" });
    assert.strictEqual(hidden.status, 200);
    await waitFor(
      () => a.game?.screen?.drawingHidden === true && a.game.screen.strokes.length === 0,
      3000,
      "the drawing hidden from the TV",
    );

    const shown = await post(fixture.httpUrl, roomId, "host-action", a.hostToken, { action: "show-drawing" });
    assert.strictEqual(shown.status, 200);
    await waitFor(
      () => a.game?.screen?.drawingHidden === false && a.game.screen.strokes.length > 0,
      3000,
      "the drawing restored",
    );

    const skipped = await post(fixture.httpUrl, roomId, "host-action", a.hostToken, { action: "skip-drawing" });
    assert.strictEqual(skipped.status, 200);
    await waitFor(() => a.game?.screen?.drawingNumber === 2, 3000, "the next drawing");

    a.ws.close();
    b.ws.close();
    c.ws.close();
  });
});
