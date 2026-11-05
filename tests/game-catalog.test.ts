/**
 * Platform registry + catalog foundation.
 *
 * Checks that shared/game-catalog.ts is the single source of truth for the new
 * manifest fields: it covers every shipped game, keeps the enabled/retired
 * split honest, agrees with each manifest.json hard range, and that the HTTP
 * registry only offers enabled games.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  GAME_CATALOG,
  catalogEntry,
  gameAvailability,
  isGameEnabled,
  type DropoutPolicy,
  type GameKind,
} from "../shared/game-catalog.ts";
import { createBots } from "./bot-client.ts";
import { startServer, type ServerFixture } from "./fixtures/server-fixture.ts";

const gamesDir = join(process.cwd(), "games");

const gameDirs = readdirSync(gamesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(gamesDir, d.name, "server.ts")))
  .map((d) => d.name)
  .sort();

const ENABLED = [
  "bluff",
  "writevote",
  "splitroom",
  "survive",
  "frankenanswers",
  "bracket",
  "dumbinventions",
  "mostlikely",
  "stowaway",
  "fakin",
  "blather",
  "slideroulette",
  "drawful",
  "sloganshirts",
  "quiz",
  "mindmeld",
  "percentile",
  "archery",
  "arena",
  "poker",
  "racing",
].sort();

const DISABLED = [
  "darts",
  "golf",
  "knifethrow",
  "spinwar",
  "snakes",
  "trivia",
  "wordchain",
  "mindreader",
  "dictionarium",
  "wordspud",
  "bdate",
  "mashup",
  "lastseat",
  "hangman",
  "guesswho",
].sort();

const KINDS: GameKind[] = ["writing", "drawing", "deduction", "trivia", "skill", "party", "cards"];
const DROPOUT_POLICIES: DropoutPolicy[] = ["continue", "pause", "void-round", "forfeit"];

const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(path, "utf8"));

describe("game catalog", () => {
  test("covers every game directory that ships a server.ts", () => {
    assert.ok(gameDirs.length >= 36, `expected the full roster, found ${gameDirs.length}`);
    assert.deepStrictEqual(Object.keys(GAME_CATALOG).sort(), gameDirs);
  });

  test("enabled roster is exactly the 21 existing games", () => {
    const enabled = Object.keys(GAME_CATALOG).filter((id) => GAME_CATALOG[id].enabled).sort();
    assert.deepStrictEqual(enabled, ENABLED);
  });

  test("disabled roster is exactly the 15 retired games", () => {
    const disabled = Object.keys(GAME_CATALOG).filter((id) => !GAME_CATALOG[id].enabled).sort();
    assert.deepStrictEqual(disabled, DISABLED);
  });

  test("every entry has the full manifest surface", () => {
    for (const [id, entry] of Object.entries(GAME_CATALOG)) {
      assert.strictEqual(entry.id, id, `${id}: id mismatch`);
      assert.ok(entry.displayName.length > 0, `${id}: displayName missing`);
      assert.ok(KINDS.includes(entry.kind), `${id}: unknown kind ${entry.kind}`);
      assert.ok(DROPOUT_POLICIES.includes(entry.dropoutPolicy), `${id}: unknown dropoutPolicy`);
      assert.ok(Number.isInteger(entry.idealMin), `${id}: idealMin not an integer`);
      assert.ok(Number.isInteger(entry.idealMax), `${id}: idealMax not an integer`);
      assert.ok(entry.idealMin >= entry.minPlayers, `${id}: idealMin below the hard minimum`);
      assert.ok(entry.idealMin <= entry.idealMax, `${id}: inverted ideal range`);
      assert.ok(entry.minutes.standalone > 0, `${id}: standalone minutes missing`);
      assert.ok(entry.minutes.rumble > 0, `${id}: rumble minutes missing`);
      assert.ok(entry.minutes.rumble <= entry.minutes.standalone, `${id}: rumble is longer than standalone`);
      assert.ok(Array.isArray(entry.contentPacks), `${id}: contentPacks missing`);
      for (const pack of entry.contentPacks) {
        assert.strictEqual(typeof pack, "string", `${id}: content pack id must be a string`);
      }
      assert.strictEqual(typeof entry.scale, "function", `${id}: scale missing`);
    }
  });

  test("hard player ranges match each manifest.json", () => {
    for (const id of gameDirs) {
      const manifest = readJson(join(gamesDir, id, "manifest.json"));
      const entry = GAME_CATALOG[id];
      assert.strictEqual(entry.minPlayers, manifest.minPlayers, `${id}: minPlayers drifts from manifest.json`);
      assert.strictEqual(entry.maxPlayers, manifest.maxPlayers, `${id}: maxPlayers drifts from manifest.json`);
    }
  });

  test("scale returns a usable round structure at every player count", () => {
    for (const entry of Object.values(GAME_CATALOG)) {
      for (let n = 1; n <= 8; n++) {
        for (const mode of ["standalone", "rumble"] as const) {
          const scale = entry.scale(n, mode);
          assert.ok(Number.isInteger(scale.rounds) && scale.rounds >= 1, `${entry.id}: bad rounds at ${n}/${mode}`);
          for (const seconds of Object.values(scale.timers ?? {})) {
            assert.ok(seconds > 0, `${entry.id}: non-positive timer at ${n}/${mode}`);
          }
          for (const cap of Object.values(scale.optionCaps ?? {})) {
            assert.ok(cap >= 1, `${entry.id}: non-positive option cap at ${n}/${mode}`);
          }
        }
      }
    }
  });

  test("scale reports today's round counts, not a redesign", () => {
    const roundsAtFour: Record<string, number> = {
      bluff: 6,
      writevote: 5,
      splitroom: 4,
      survive: 3,
      frankenanswers: 3,
      bracket: 2,
      dumbinventions: 3,
      mostlikely: 8,
      stowaway: 3,
      fakin: 5,
      blather: 4,
      slideroulette: 4,
      drawful: 3,
      sloganshirts: 2,
      quiz: 10,
      mindmeld: 6,
      percentile: 5,
      archery: 5,
      arena: 3,
      poker: 12,
      racing: 1,
    };
    for (const [id, rounds] of Object.entries(roundsAtFour)) {
      assert.strictEqual(GAME_CATALOG[id].scale(4, "standalone").rounds, rounds, `${id}: rounds changed`);
    }
    // Presenter/artist counts follow the room size.
    assert.strictEqual(GAME_CATALOG.slideroulette.scale(3, "standalone").rounds, 3);
    assert.strictEqual(GAME_CATALOG.drawful.scale(8, "standalone").rounds, 8);
  });

  test("bracket plays two brackets at 3-4 and one full bracket at 5-6", () => {
    for (const count of [3, 4]) {
      assert.strictEqual(GAME_CATALOG.bracket.scale(count, "standalone").rounds, 2, `${count}: standalone`);
      assert.strictEqual(GAME_CATALOG.bracket.scale(count, "rumble").rounds, 2, `${count}: rumble`);
    }
    for (const count of [5, 6]) {
      assert.strictEqual(GAME_CATALOG.bracket.scale(count, "standalone").rounds, 1, `${count}: standalone`);
      assert.strictEqual(GAME_CATALOG.bracket.scale(count, "rumble").rounds, 1, `${count}: rumble`);
    }
  });

  test("sloganshirts plays two rounds at 3-4 and one cycle from five", () => {
    for (const count of [3, 4]) {
      assert.strictEqual(GAME_CATALOG.sloganshirts.scale(count, "standalone").rounds, 2, `${count}: standalone`);
      assert.strictEqual(GAME_CATALOG.sloganshirts.scale(count, "rumble").rounds, 2, `${count}: rumble`);
      assert.strictEqual(
        GAME_CATALOG.sloganshirts.scale(count, "rumble").optionCaps?.options,
        count,
        `${count}: every shirt fits`,
      );
    }
    for (const count of [5, 6, 7, 8]) {
      const standalone = GAME_CATALOG.sloganshirts.scale(count, "standalone");
      assert.strictEqual(standalone.rounds, 1, `${count}: one full cycle`);
      assert.strictEqual(standalone.optionCaps?.options, count, `${count}: one shirt per player`);
      const rumble = GAME_CATALOG.sloganshirts.scale(count, "rumble");
      assert.strictEqual(rumble.rounds, 1, `${count}: one rumble round`);
      assert.strictEqual(rumble.optionCaps?.options, 4, `${count}: four rumble shirts`);
    }
  });
});

describe("gameAvailability", () => {
  test("a game that fits returns null at every count in range", () => {
    for (const entry of Object.values(GAME_CATALOG)) {
      for (let n = entry.minPlayers; n <= entry.maxPlayers; n++) {
        assert.strictEqual(gameAvailability(entry, n), null, `${entry.id}: ${n} players should fit`);
      }
    }
  });

  test("wide games ask for a minimum with a plus", () => {
    const wide = { minPlayers: 3, maxPlayers: 8 };
    assert.strictEqual(gameAvailability(wide, 2), "needs 3+");
    assert.strictEqual(gameAvailability(wide, 3), null);
    assert.strictEqual(gameAvailability(wide, 8), null);
    assert.strictEqual(gameAvailability(wide, 9), "max 8");
  });

  test("narrow games show the whole range", () => {
    const narrow = { minPlayers: 3, maxPlayers: 6 };
    assert.strictEqual(gameAvailability(narrow, 2), "needs 3-6");
    assert.strictEqual(gameAvailability(narrow, 3), null);
    assert.strictEqual(gameAvailability(narrow, 6), null);
    assert.strictEqual(gameAvailability(narrow, 7), "max 6");
  });

  test("current hard caps are reported honestly", () => {
    const bluff = GAME_CATALOG.bluff;
    assert.strictEqual(gameAvailability(bluff, 2), "needs 3+");
    assert.strictEqual(gameAvailability(bluff, 3), null);
    assert.strictEqual(gameAvailability(bluff, 8), null);
    assert.strictEqual(gameAvailability(bluff, 9), "max 8");
  });

  test("writevote moved from 3-4 to 3-8", () => {
    const writevote = GAME_CATALOG.writevote;
    assert.strictEqual(gameAvailability(writevote, 2), "needs 3+");
    assert.strictEqual(gameAvailability(writevote, 3), null);
    assert.strictEqual(gameAvailability(writevote, 4), null);
    assert.strictEqual(gameAvailability(writevote, 8), null);
    assert.strictEqual(gameAvailability(writevote, 9), "max 8");
  });

  test("splitroom moved from 3-4 to 3-8", () => {
    const splitroom = GAME_CATALOG.splitroom;
    assert.strictEqual(gameAvailability(splitroom, 2), "needs 3+");
    assert.strictEqual(gameAvailability(splitroom, 3), null);
    assert.strictEqual(gameAvailability(splitroom, 4), null);
    assert.strictEqual(gameAvailability(splitroom, 8), null);
    assert.strictEqual(gameAvailability(splitroom, 9), "max 8");
  });

  test("sloganshirts moved from 3-4 to 3-8", () => {
    const sloganshirts = GAME_CATALOG.sloganshirts;
    assert.strictEqual(gameAvailability(sloganshirts, 2), "needs 3+");
    assert.strictEqual(gameAvailability(sloganshirts, 3), null);
    assert.strictEqual(gameAvailability(sloganshirts, 4), null);
    assert.strictEqual(gameAvailability(sloganshirts, 8), null);
    assert.strictEqual(gameAvailability(sloganshirts, 9), "max 8");
  });

  test("mostlikely moved from 3-4 to 3-8", () => {
    const mostlikely = GAME_CATALOG.mostlikely;
    assert.strictEqual(gameAvailability(mostlikely, 2), "needs 3+");
    assert.strictEqual(gameAvailability(mostlikely, 3), null);
    assert.strictEqual(gameAvailability(mostlikely, 4), null);
    assert.strictEqual(gameAvailability(mostlikely, 8), null);
    assert.strictEqual(gameAvailability(mostlikely, 9), "max 8");
  });

  test("survive moved from 3-4 to 3-6", () => {
    const survive = GAME_CATALOG.survive;
    assert.strictEqual(gameAvailability(survive, 2), "needs 3-6");
    assert.strictEqual(gameAvailability(survive, 3), null);
    assert.strictEqual(gameAvailability(survive, 4), null);
    assert.strictEqual(gameAvailability(survive, 6), null);
    assert.strictEqual(gameAvailability(survive, 7), "max 6");
  });

  test("frankenanswers moved from 3-4 to 3-6", () => {
    const frankenanswers = GAME_CATALOG.frankenanswers;
    assert.strictEqual(gameAvailability(frankenanswers, 2), "needs 3-6");
    assert.strictEqual(gameAvailability(frankenanswers, 3), null);
    assert.strictEqual(gameAvailability(frankenanswers, 4), null);
    assert.strictEqual(gameAvailability(frankenanswers, 6), null);
    assert.strictEqual(gameAvailability(frankenanswers, 7), "max 6");
  });

  test("bracket moved from 3-4 to 3-6", () => {
    const bracket = GAME_CATALOG.bracket;
    assert.strictEqual(gameAvailability(bracket, 2), "needs 3-6");
    assert.strictEqual(gameAvailability(bracket, 3), null);
    assert.strictEqual(gameAvailability(bracket, 4), null);
    assert.strictEqual(gameAvailability(bracket, 6), null);
    assert.strictEqual(gameAvailability(bracket, 7), "max 6");
  });

  test("solo and fixed-seat games stay sane", () => {
    assert.strictEqual(gameAvailability({ minPlayers: 1, maxPlayers: 8 }, 1), null);
    assert.strictEqual(gameAvailability({ minPlayers: 1, maxPlayers: 8 }, 0), "needs 1+");
    assert.strictEqual(gameAvailability({ minPlayers: 2, maxPlayers: 2 }, 1), "needs 2");
    assert.strictEqual(gameAvailability({ minPlayers: 2, maxPlayers: 2 }, 3), "max 2");
  });

  test("unknown ids and the helpers", () => {
    assert.strictEqual(catalogEntry("bluff")?.displayName, "Bluff");
    assert.strictEqual(catalogEntry("not-a-game"), undefined);
    assert.strictEqual(isGameEnabled("bluff"), true);
    assert.strictEqual(isGameEnabled("darts"), false);
    assert.strictEqual(isGameEnabled("not-a-game"), false);
  });
});

describe("game registry over HTTP", () => {
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

  test("/api/games lists only enabled games with the new manifest fields", async () => {
    const res = await fetch(`${httpUrl}/api/games`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { games: Array<Record<string, unknown>> };
    const ids = body.games.map((g) => String(g.id)).sort();

    assert.deepStrictEqual(ids, ENABLED);
    for (const disabled of DISABLED) {
      assert.ok(!ids.includes(disabled), `${disabled}: disabled game must not be listed`);
    }

    for (const game of body.games) {
      const id = String(game.id);
      assert.strictEqual(typeof game.displayName, "string", `${id}: displayName missing`);
      assert.strictEqual(game.enabled, true, `${id}: enabled flag missing`);
      assert.ok(KINDS.includes(game.kind as GameKind), `${id}: kind missing`);
      assert.strictEqual(typeof game.idealMin, "number", `${id}: idealMin missing`);
      assert.strictEqual(typeof game.idealMax, "number", `${id}: idealMax missing`);
      assert.ok(game.minutes && typeof game.minutes === "object", `${id}: minutes missing`);
      assert.ok(DROPOUT_POLICIES.includes(game.dropoutPolicy as DropoutPolicy), `${id}: dropoutPolicy missing`);
      assert.ok(Array.isArray(game.contentPacks), `${id}: contentPacks missing`);
      assert.strictEqual(typeof game.name, "string", `${id}: legacy name field lost`);
      assert.strictEqual(typeof game.minPlayers, "number", `${id}: legacy minPlayers field lost`);
      assert.strictEqual(typeof game.maxPlayers, "number", `${id}: legacy maxPlayers field lost`);
    }
  });

  test("starting a disabled game returns GAME_DISABLED", async () => {
    const bots = await createBots(1, wsUrl, "DisabledBot");
    const screen = await connectScreen(bots[0].roomId);
    try {
      const res = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-host-token": screen.hostToken },
        body: JSON.stringify({ gameId: "darts" }),
      });
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { code?: string };
      assert.strictEqual(body.code, "GAME_DISABLED");

      // An enabled game with too few players is still a player-count error,
      // not a licensing one.
      const tooFew = await fetch(`${httpUrl}/api/rooms/${bots[0].roomId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-host-token": screen.hostToken },
        body: JSON.stringify({ gameId: "bluff" }),
      });
      assert.strictEqual(tooFew.status, 400);
      assert.strictEqual(((await tooFew.json()) as { code?: string }).code, "NOT_ENOUGH_PLAYERS");
    } finally {
      screen.ws.close();
      for (const bot of bots) bot.disconnect();
    }
  });
});
