/**
 * Preset Rumbles run every game in `rumble` mode with the catalog's shorter
 * round count (PLATFORM_EXPANSION_BRIEF section 6, section 3.4).
 *
 * Two things are covered:
 *
 *  1. TABLE — every enabled game maps its own round field (`maxRounds`,
 *     `maxHands`, question list, prompts list, ...) and lands on
 *     `GAME_CATALOG[id].scale(n, "rumble").rounds` when `onStart` receives the
 *     injected options, while no options keeps the standalone value. The
 *     mapping is fail-closed: a newly enabled game fails until classified.
 *  2. INTEGRATION — the real server's preset start/next path injects the
 *     options: slot options survive (Quiz keeps a slot's `mode`) and the game
 *     that starts has the Rumble round count.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { RUMBLE_PRESETS } from "../shared/rumble-presets.ts";
import { rumbleSlotOptions } from "../server/session.ts";
import { createBots, type BotClient } from "./bot-client.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";
import { connectScreen, hostHeaders } from "./fixtures/screen-client.ts";
import { MESSAGE_TYPES } from "../shared/constants.js";

const GAMES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "games");

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface Instance {
  players: Player[];
  state: Record<string, unknown>;
}

interface Plugin {
  manifest: { id: string; minPlayers: number; maxPlayers: number };
  onStart(room: Record<string, unknown>, players: Player[], options?: Record<string, unknown>): Instance;
}

type ModuleNs = { default: Plugin } & Record<string, unknown>;

const moduleCache = new Map<string, ModuleNs>();

async function loadPlugin(gameId: string): Promise<Plugin> {
  let mod = moduleCache.get(gameId);
  if (!mod) {
    mod = (await import(join(GAMES_DIR, gameId, "server.ts"))) as ModuleNs;
    moduleCache.set(gameId, mod);
  }
  return mod.default;
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Bot ${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: Player[], gameId: string): Record<string, unknown> {
  return {
    id: "room-rumble-mode",
    code: "TEST1",
    hostPlayerId: players[0]?.id ?? null,
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/**
 * Where each enabled game stores the number of rounds it will run. This is the
 * fail-closed table: a new game must add its field here and in `READ`.
 */
const ROUND_FIELD: Record<string, string> = {
  bluff: "prompts.length",
  writevote: "prompts.length",
  splitroom: "maxRounds",
  survive: "maxRounds",
  frankenanswers: "maxRounds",
  bracket: "maxRounds",
  dumbinventions: "maxRounds",
  mostlikely: "prompts.length",
  stowaway: "maxRounds",
  fakin: "maxRounds",
  guessimposter: "maxRounds",
  blather: "maxRounds",
  slideroulette: "maxRounds",
  drawful: "maxRounds",
  sloganshirts: "maxRounds",
  quiz: "questions.length",
  mindmeld: "maxRounds",
  percentile: "maxRounds",
  darts: "maxRounds",
  arena: "rounds",
  poker: "maxHands",
  racing: "maxRaces",
};

const READ: Record<string, (state: Record<string, unknown>) => number> = {
  bluff: (s) => (s.prompts as unknown[]).length,
  writevote: (s) => (s.prompts as unknown[]).length,
  splitroom: (s) => s.maxRounds as number,
  survive: (s) => s.maxRounds as number,
  frankenanswers: (s) => s.maxRounds as number,
  bracket: (s) => s.maxRounds as number,
  dumbinventions: (s) => s.maxRounds as number,
  mostlikely: (s) => (s.prompts as unknown[]).length,
  stowaway: (s) => s.maxRounds as number,
  fakin: (s) => s.maxRounds as number,
  guessimposter: (s) => s.maxRounds as number,
  blather: (s) => s.maxRounds as number,
  slideroulette: (s) => s.maxRounds as number,
  drawful: (s) => s.maxRounds as number,
  sloganshirts: (s) => s.maxRounds as number,
  quiz: (s) => (s.questions as unknown[]).length,
  mindmeld: (s) => s.maxRounds as number,
  percentile: (s) => s.maxRounds as number,
  darts: (s) => s.maxRounds as number,
  arena: (s) => s.rounds as number,
  poker: (s) => s.maxHands as number,
  racing: (s) => s.maxRaces as number,
};

const ENABLED = Object.values(GAME_CATALOG).filter((entry) => entry.enabled);
const MATRIX = [3, 4, 5, 8];

function countsFor(gameId: string): number[] {
  const entry = GAME_CATALOG[gameId];
  return MATRIX.filter((n) => n >= entry.minPlayers && n <= entry.maxPlayers);
}

describe("preset Rumble round counts", () => {
  test("every enabled game maps a round field, and no stale entry remains", () => {
    const enabledIds = ENABLED.map((entry) => entry.id).sort();
    assert.deepStrictEqual(
      Object.keys(ROUND_FIELD).sort(),
      enabledIds,
      "a newly enabled game must add its round field to ROUND_FIELD/READ (fail-closed)",
    );
  });

  test("rumble options make every enabled game run the catalog's Rumble rounds", async () => {
    for (const entry of ENABLED) {
      const plugin = await loadPlugin(entry.id);
      const read = READ[entry.id];
      for (const count of countsFor(entry.id)) {
        const players = makePlayers(count);
        const rounds = entry.scale(count, "rumble").rounds;
        const instance = plugin.onStart(makeRoom(players, entry.id), players, {
          rumble: true,
          mode: "rumble",
          rounds,
        });
        assert.strictEqual(
          read(instance.state),
          rounds,
          `${entry.id} at ${count} players must run ${rounds} Rumble rounds, not ${read(instance.state)}`,
        );
      }
    }
  });

  test("no options keeps every enabled game's standalone rounds", async () => {
    // Covers the games whose standalone and Rumble counts differ (bluff,
    // writevote, survive, mostlikely, stowaway, fakin, blather, slideroulette,
    // sloganshirts, percentile, mindmeld, drawful, quiz, poker, darts,
    // racing, arena) and the rest of the roster.
    for (const entry of ENABLED) {
      const plugin = await loadPlugin(entry.id);
      const read = READ[entry.id];
      for (const count of countsFor(entry.id)) {
        const players = makePlayers(count);
        const instance = plugin.onStart(makeRoom(players, entry.id), players);
        const standalone = entry.scale(count, "standalone").rounds;
        assert.strictEqual(
          read(instance.state),
          standalone,
          `${entry.id} at ${count} players must keep its standalone ${standalone} rounds`,
        );
      }
    }
  });

  test("slot options survive injection: Quiz keeps Fast and takes six questions", async () => {
    const preset = RUMBLE_PRESETS.find((candidate) => candidate.id === "friday-night-at-mos");
    assert.ok(preset, "the Friday Night preset must exist");
    const slot = preset.slots.find((candidate) => candidate.gameId === "quiz");
    assert.ok(slot, "Friday Night must include Quiz");
    assert.strictEqual(slot.options?.mode, "fast");

    const options = rumbleSlotOptions("quiz", slot.options, 4);
    assert.strictEqual(options.mode, "fast", "the slot's Fast mode must not be overwritten");
    assert.strictEqual(options.rounds, GAME_CATALOG.quiz.scale(4, "rumble").rounds);
    assert.strictEqual(options.rounds, 6);

    const quiz = await loadPlugin("quiz");
    const players = makePlayers(4);
    const instance = quiz.onStart(makeRoom(players, "quiz"), players, options);
    assert.strictEqual(instance.state.mode, "fast");
    assert.strictEqual((instance.state.questions as unknown[]).length, 6);
  });
});

interface GameStateMessage {
  type: string;
  payload: { screen: { totalPrompts?: number; totalQuestions?: number; mode?: string } | null };
}

describe("preset Rumble server injection", () => {
  let fixture: ServerFixture;
  let rumbleDir: string;

  before(async () => {
    rumbleDir = mkdtempSync(join(tmpdir(), "tbrn-rumble-mode-"));
    fixture = await startServer({ TBRN_RUMBLE_DIR: rumbleDir });
  });

  after(() => {
    fixture?.stop();
    rmSync(rumbleDir, { recursive: true, force: true });
  });

  /** First screen frame after starting the next Rumble slot. */
  function nextSlotScreen(bot: BotClient): Promise<GameStateMessage["payload"]["screen"]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("game state timeout")), 8000);
      bot.on(MESSAGE_TYPES.GAME_STATE, (msg) => {
        if (msg.type !== MESSAGE_TYPES.GAME_STATE) return;
        clearTimeout(timer);
        bot.off(MESSAGE_TYPES.GAME_STATE);
        resolve((msg as GameStateMessage).payload.screen);
      });
    });
  }

  async function startPresetAndNext(
    presetId: string,
    count: number,
  ): Promise<{ gameId: string; screen: GameStateMessage["payload"]["screen"] }> {
    const bots = await createBots(count, fixture.wsUrl, "RumbleMode");
    const screen = await connectScreen(fixture.wsUrl, bots[0].roomId);
    try {
      const startRes = await fetch(`${fixture.httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
        method: "POST",
        headers: hostHeaders(screen),
        body: JSON.stringify({ presetId }),
      });
      assert.strictEqual(startRes.status, 200, `${presetId} must start`);

      const screenState = nextSlotScreen(bots[0]);
      const nextRes = await fetch(`${fixture.httpUrl}/api/rooms/${bots[0].roomId}/session/next`, {
        method: "POST",
        headers: hostHeaders(screen),
      });
      assert.strictEqual(nextRes.status, 200, `${presetId} must start its first slot`);
      const nextBody = (await nextRes.json()) as { gameId: string };
      return { gameId: nextBody.gameId, screen: await screenState };
    } finally {
      screen.close();
      for (const bot of bots) bot.disconnect();
    }
  }

  test("mostlikely starts with the catalog Rumble rounds (five at four players)", async () => {
    const { gameId, screen } = await startPresetAndNext("friday-night-at-mos", 4);
    assert.strictEqual(gameId, "mostlikely");
    assert.strictEqual(
      screen?.totalPrompts,
      GAME_CATALOG.mostlikely.scale(4, "rumble").rounds,
      "the started game must use the Rumble round count, not the standalone eight",
    );
    assert.strictEqual(screen?.totalPrompts, 5);
  });

  test("starting a Rumble slot through /start also injects rumble mode", async () => {
    const bots = await createBots(4, fixture.wsUrl, "RumbleStart");
    const screen = await connectScreen(fixture.wsUrl, bots[0].roomId);
    try {
      const startRes = await fetch(`${fixture.httpUrl}/api/rooms/${bots[0].roomId}/session/start`, {
        method: "POST",
        headers: hostHeaders(screen),
        body: JSON.stringify({ presetId: "friday-night-at-mos" }),
      });
      assert.strictEqual(startRes.status, 200, "the preset session must start");

      const screenState = nextSlotScreen(bots[0]);
      const playRes = await fetch(`${fixture.httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: hostHeaders(screen),
        body: JSON.stringify({ gameId: "mostlikely" }),
      });
      assert.strictEqual(playRes.status, 200, "the current slot must start through /start");
      const playBody = (await playRes.json()) as { gameId: string };
      assert.strictEqual(playBody.gameId, "mostlikely");
      assert.strictEqual(
        (await screenState)?.totalPrompts,
        GAME_CATALOG.mostlikely.scale(4, "rumble").rounds,
        "/start must inject the Rumble round count just like /session/next",
      );
    } finally {
      screen.close();
      for (const bot of bots) bot.disconnect();
    }
  });

  test("quiz starts with the Rumble question count while keeping the slot's mode", async () => {
    const { gameId, screen } = await startPresetAndNext("big-brain-sunday", 4);
    assert.strictEqual(gameId, "quiz");
    assert.strictEqual(screen?.mode, "standard", "the Big Brain slot asks for Standard");
    assert.strictEqual(
      screen?.totalQuestions,
      GAME_CATALOG.quiz.scale(4, "rumble").rounds,
      "the started quiz must use the Rumble question count",
    );
    assert.strictEqual(screen?.totalQuestions, 6);
  });
});
