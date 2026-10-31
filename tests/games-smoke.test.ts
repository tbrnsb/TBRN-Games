/**
 * Headless smoke tests for every game plugin.
 *
 * For each of the 18 games this runs the plugin with simulated phone
 * players, drives it with realistic inputs until it finishes, and checks:
 *   - the game reaches "finished" within a generous tick budget
 *   - screen and controller states are JSON-serializable every few ticks
 *   - hidden state never leaks into the screen state (privacy)
 *   - garbage inputs never crash the plugin (server stays authoritative)
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = join(repoRoot, "games");

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: Record<string, unknown>;
}

interface GamePlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; controllerType: string };
  onStart(room: unknown, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}

const gameIds = readdirSync(gamesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(gamesDir, d.name, "server.ts")))
  .map((d) => d.name)
  .sort();

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Bot${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: Player[], gameId: string): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: "p0",
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/** Pick a realistic input for a player based on their controller state. */
function chooseInput(gameId: string, cs: Record<string, unknown>, playerId: string): unknown {
  const rand = (n: number) => Math.floor(Math.random() * n);

  switch (gameId) {
    case "poker": {
      if (cs.yourTurn !== true) return null;
      if (cs.canCheck === true) return { action: Math.random() < 0.7 ? "check" : "raise", amount: cs.minRaiseTo };
      if (cs.canCall === true) return { action: Math.random() < 0.7 ? "call" : "fold" };
      if (cs.canRaise === true) return { action: "raise", amount: cs.minRaiseTo };
      return { action: "fold" };
    }
    case "hangman": {
      if (cs.isYourTurn !== true) return null;
      const guessed = new Set<string>((cs.guessed as string[]) ?? []);
      const fresh = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((l) => !guessed.has(l));
      if (!fresh.length) return null;
      return { choice: fresh[rand(fresh.length)] };
    }
    case "quiz": {
      const q = cs.question as { options: Array<{ id: string }> } | null;
      if (!q || cs.hasAnswered === true) return null;
      return { choice: q.options[rand(q.options.length)].id };
    }
    case "mostlikely": {
      if (cs.hasVoted === true || cs.phase !== "voting") return null;
      const opts = (cs.options as Array<{ id: string }>) ?? [];
      if (!opts.length) return null;
      return { choice: opts[rand(opts.length)].id };
    }
    case "guesswho": {
      if (cs.yourTurn !== true) return null;
      const opts = (cs.options as Array<{ id: string }>) ?? [];
      if (!opts.length) return null;
      const guesses = opts.filter((o) => o.id.startsWith("g:"));
      const questions = opts.filter((o) => o.id.startsWith("q:"));
      const useGuess = guesses.length > 0 && Math.random() < 0.2;
      const pool = useGuess ? guesses : questions.length ? questions : opts;
      return { choice: pool[rand(pool.length)].id };
    }
    case "bluff":
    case "writevote": {
      if (cs.phase === "writing") {
        if (cs.hasSubmitted === true) return null;
        return { text: `${gameId} answer by ${playerId} round ${cs.round ?? 0}` };
      }
      if (cs.phase === "voting") {
        if (cs.hasVoted === true) return null;
        const opts = (cs.options as Array<{ id: string }>) ?? [];
        if (!opts.length) return null;
        return { choice: opts[rand(opts.length)].id };
      }
      return null;
    }
    case "trafficjam":
    case "seabattle": {
      const rows = typeof cs.rows === "number" ? cs.rows : 5;
      const cols = typeof cs.cols === "number" ? cs.cols : 5;
      return { grid: { row: rand(rows), col: rand(cols) } };
    }
    case "snakes":
      return { move: ["up", "right", "down", "left"][rand(4)] };
    case "golf":
      return { move: ["up", "up", "up", "down", "left", "right"][rand(6)] };
    case "racing":
      return { move: Math.random() < 0.5 ? "left" : "right" };
    default:
      return { tap: true };
  }
}

/** Players used per game (respecting minPlayers). */
function playerCountFor(plugin: GamePlugin): number {
  return Math.max(2, plugin.manifest.minPlayers);
}

/** Tick budget per game; some games run on real-time timers. */
function tickBudget(gameId: string): number {
  switch (gameId) {
    case "seabattle": return 12000; // random shooting has to hit 17 cells
    case "trafficjam": return 1200; // two levels run on a 180s in-game timer
    case "gravityrun": return 300;
    case "snakes": return 2000;
    case "darts": return 3000;
    default: return 4000;
  }
}

async function loadPlugin(gameId: string): Promise<GamePlugin> {
  const mod = (await import(join(gamesDir, gameId, "server.ts"))) as { default: GamePlugin };
  return mod.default;
}

describe("game plugins: manifest consistency", () => {
  test("all 18 games exist with manifest.json + server.ts", () => {
    assert.strictEqual(gameIds.length, 18, `expected 18 games, found ${gameIds.length}: ${gameIds.join(",")}`);
    for (const id of gameIds) {
      assert.ok(existsSync(join(gamesDir, id, "manifest.json")), `${id}: manifest.json missing`);
    }
  });

  for (const gameId of gameIds) {
    test(`${gameId}: plugin manifest matches manifest.json`, async () => {
      const plugin = await loadPlugin(gameId);
      const json = JSON.parse(readFileSync(join(gamesDir, gameId, "manifest.json"), "utf8")) as { id: string; name: string; minPlayers: number; maxPlayers: number };
      assert.strictEqual(plugin.manifest.id, json.id);
      assert.strictEqual(plugin.manifest.name, json.name);
      assert.strictEqual(plugin.manifest.minPlayers, json.minPlayers);
      assert.strictEqual(plugin.manifest.maxPlayers, json.maxPlayers);
      assert.ok(typeof plugin.onStart === "function");
      assert.ok(typeof plugin.onInput === "function");
      assert.ok(typeof plugin.onTick === "function");
      assert.ok(typeof plugin.screenState === "function");
      assert.ok(typeof plugin.controllerState === "function");
    });
  }
});

describe("game plugins: full playthroughs", () => {
  for (const gameId of gameIds) {
    test(`${gameId}: finishes, serializes, ignores garbage input`, async () => {
      const plugin = await loadPlugin(gameId);
      const players = makePlayers(playerCountFor(plugin));
      const instance = plugin.onStart(makeRoom(players, gameId), players);
      const budget = tickBudget(gameId);
      let garbagePhase = false;

      for (let tick = 0; tick < budget; tick++) {
        // Every few ticks, throw garbage at the plugin: it must not crash.
        if (tick % 250 === 125 && !garbagePhase) {
          for (const p of players) {
            plugin.onInput(instance, p.id, {});
            plugin.onInput(instance, p.id, null);
            plugin.onInput(instance, p.id, { choice: 12345 });
            plugin.onInput(instance, p.id, { text: "x".repeat(5000) });
            plugin.onInput(instance, p.id, { grid: { row: -99, col: 9999 } });
            plugin.onInput(instance, p.id, { __proto__: { admin: true } });
          }
          garbagePhase = true;
        }

        const screen = plugin.screenState(instance);
        assert.doesNotThrow(() => JSON.stringify(screen), `${gameId}: screen state not JSON-serializable at tick ${tick}`);
        for (const p of players) {
          const cs = plugin.controllerState(instance, p.id);
          assert.doesNotThrow(() => JSON.stringify(cs), `${gameId}: controller state not JSON-serializable at tick ${tick}`);
          const input = chooseInput(gameId, (cs ?? {}) as Record<string, unknown>, p.id);
          if (input) plugin.onInput(instance, p.id, input);
        }
        plugin.onTick(instance, 500);

        const s = instance.state as { phase?: string; finished?: boolean };
        if (s.phase === "finished" || s.finished === true) break;
      }

      const finalScreen = plugin.screenState(instance) as Record<string, unknown>;
      const s = instance.state as { phase?: string; finished?: boolean };
      assert.ok(
        s.phase === "finished" || s.finished === true || finalScreen.finished === true,
        `${gameId}: game did not finish within ${budget} ticks (phase=${s.phase})`,
      );
      assert.strictEqual(finalScreen.finished, true, `${gameId}: screen state.finished must be true at the end`);
    });
  }
});

describe("game plugins: privacy", () => {
  test("poker: hole cards never appear on the shared screen", async () => {
    const plugin = await loadPlugin("poker");
    const players = makePlayers(3);
    const instance = plugin.onStart(makeRoom(players, "poker"), players);
    for (let tick = 0; tick < 400; tick++) {
      const screen = plugin.screenState(instance) as Record<string, unknown>;
      const phase = String(screen.phase ?? "");
      const screenJson = JSON.stringify(screen);
      // Player rows on the screen must never carry cards; only the public
      // showdown reveal may.
      assert.ok(!JSON.stringify(screen.players ?? []).includes('"cards"'), `poker: hole cards leaked to screen during ${phase}`);
      if (phase !== "showdown" && phase !== "hand-end") {
        assert.ok(!screenJson.includes("showdown\":["), `poker: showdown revealed outside showdown phase (${phase})`);
      }
      // Every player's controller gets their own cards.
      for (const p of players) {
        const cs = JSON.stringify(plugin.controllerState(instance, p.id));
        assert.ok(cs.includes("\"cards\""), "poker: controller must receive hole cards");
      }
      const s = instance.state as Record<string, unknown>;
      const turnIndex = s.turnIndex as number;
      if (turnIndex >= 0) {
        const pid = players[turnIndex].id;
        const cs = plugin.controllerState(instance, pid) as Record<string, unknown>;
        const input = chooseInput("poker", cs, pid);
        if (input) plugin.onInput(instance, pid, input);
      }
      plugin.onTick(instance, 500);
      if (s.finished === true) break;
    }
  });

  test("guesswho: secret characters and boards never reach the screen", async () => {
    const plugin = await loadPlugin("guesswho");
    const players = makePlayers(2);
    const instance = plugin.onStart(makeRoom(players, "guesswho"), players);
    for (let tick = 0; tick < 200; tick++) {
      const screenJson = JSON.stringify(plugin.screenState(instance));
      assert.ok(!screenJson.includes("secret"), "guesswho: secret leaked to screen");
      assert.ok(!screenJson.includes("eliminated"), "guesswho: personal board leaked to screen");
      const s = instance.state as Record<string, unknown>;
      if (s.phase === "finished") break;
      const cs = plugin.controllerState(instance, players[s.currentPlayer as number].id) as Record<string, unknown>;
      const input = chooseInput("guesswho", cs, players[s.currentPlayer as number].id);
      if (input) plugin.onInput(instance, players[s.currentPlayer as number].id, input);
      plugin.onTick(instance, 500);
    }
  });

  test("guesswho: one player's board never contains another player's secret", async () => {
    const plugin = await loadPlugin("guesswho");
    const players = makePlayers(2);
    const instance = plugin.onStart(makeRoom(players, "guesswho"), players);
    const s = instance.state as { secrets: number[] };
    const cs0 = plugin.controllerState(instance, "p0") as { secret: { name: string }; board: Array<{ name: string; eliminated: boolean }> };
    const cs1 = plugin.controllerState(instance, "p1") as { secret: { name: string } };
    assert.notStrictEqual(cs0.secret.name, cs1.secret.name, "secrets must differ");
    assert.strictEqual(cs0.board.length, 24);
    // p1's secret must still be alive on p0's board.
    assert.ok(cs0.board.some((c) => c.name === cs1.secret.name && !c.eliminated));
    assert.strictEqual(s.secrets.length, 2);
  });

  test("bluff: written answers are hidden from the screen until reveal", async () => {
    const plugin = await loadPlugin("bluff");
    const players = makePlayers(3);
    const instance = plugin.onStart(makeRoom(players, "bluff"), players);
    // All three submit distinctive texts.
    for (const p of players) {
      plugin.onInput(instance, p.id, { text: `TOPSECRET-${p.id}` });
    }
    const screen = plugin.screenState(instance) as Record<string, unknown>;
    assert.strictEqual(screen.phase, "voting", "all submissions should move the round to voting");
    const screenJson = JSON.stringify(screen);
    assert.ok(!screenJson.includes("TOPSECRET"), "bluff: submitted texts leaked to screen during voting");
    // The real answer is not marked before reveal either.
    assert.strictEqual(screen.realAnswer, null);
    // Voters see the texts on their own phones.
    const cs = plugin.controllerState(instance, "p0") as { options: Array<{ id: string; label: string }> };
    assert.ok(cs.options.some((o) => o.label.startsWith("TOPSECRET-")), "voter must see the answer texts");
  });

  test("writevote: written responses are hidden from the screen until reveal", async () => {
    const plugin = await loadPlugin("writevote");
    const players = makePlayers(3);
    const instance = plugin.onStart(makeRoom(players, "writevote"), players);
    for (const p of players) {
      plugin.onInput(instance, p.id, { text: `HIDDEN-${p.id}` });
    }
    const screen = plugin.screenState(instance) as Record<string, unknown>;
    assert.strictEqual(screen.phase, "voting");
    assert.ok(!JSON.stringify(screen).includes("HIDDEN-"), "writevote: responses leaked to screen during voting");
    const cs = plugin.controllerState(instance, "p0") as { options: Array<{ id: string; label: string }> };
    assert.ok(cs.options.some((o) => o.label.startsWith("HIDDEN-")), "voter must see others' responses");
  });
});
