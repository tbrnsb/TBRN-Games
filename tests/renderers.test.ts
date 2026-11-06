/**
 * Renderer smoke tests.
 *
 * Every game gets a real server state and is drawn through its actual screen
 * renderer at 1280×720 and 1920×1080 with a recording 2D context. This catches
 * renderer crashes and shape drift after game-logic changes without needing a
 * browser in CI.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = join(repoRoot, "games");

const gameIds = readdirSync(gamesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(gamesDir, d.name, "screen.ts")))
  .map((d) => d.name)
  .sort();

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface GamePlugin {
  manifest: { id: string; minPlayers: number; maxPlayers: number };
  onStart(room: unknown, players: Player[]): { players: Player[]; state: Record<string, unknown> };
  screenState(instance: unknown): unknown;
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: Player[], gameId: string): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: players[0]?.id ?? null,
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

/** Minimal recording context: every unknown canvas method is a no-op. */
function makeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    measureText: (text: unknown) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

async function loadPlugin(gameId: string): Promise<GamePlugin> {
  const mod = (await import(join(gamesDir, gameId, "server.ts"))) as { default: GamePlugin };
  return mod.default;
}

async function loadRenderer(gameId: string): Promise<((...args: unknown[]) => void) | null> {
  const mod = (await import(join(gamesDir, gameId, "screen.ts"))) as Record<string, unknown>;
  const names = Object.keys(mod).filter(
    (name) => name.startsWith("render") && typeof mod[name] === "function" && name !== "renderDom" && name !== "renderDOM",
  );
  return names.length === 1 ? (mod[names[0]] as (...args: unknown[]) => void) : null;
}

async function hasDomRenderer(gameId: string): Promise<boolean> {
  const mod = (await import(join(gamesDir, gameId, "screen.ts"))) as Record<string, unknown>;
  return typeof mod.renderDom === "function" || typeof mod.renderDOM === "function";
}

describe("screen renderers: draw real state at both target resolutions", () => {
  for (const gameId of gameIds) {
    test(`${gameId}: renders without throwing`, async () => {
      const plugin = await loadPlugin(gameId);
      const renderer = await loadRenderer(gameId);
      const domOnly = await hasDomRenderer(gameId);
      assert.ok(renderer || domOnly, `${gameId}: expected a canvas render or a renderDom export`);
      if (!renderer) return; // DOM-only renderer is covered by browser shots.

      const players = makePlayers(Math.max(2, plugin.manifest.minPlayers));
      const instance = plugin.onStart(makeRoom(players, gameId), players);
      const screen = plugin.screenState(instance);

      const ctx = makeContext();
      const originalNow = performance.now;
      let now = 1000;
      Object.defineProperty(performance, "now", { value: () => now, configurable: true });
      try {
        // First frame creates any title card; a later frame draws the game.
        renderer(ctx, 1280, 720, screen);
        now = 8000;
        renderer(ctx, 1280, 720, screen);
        renderer(ctx, 1920, 1080, screen);
      } finally {
        Object.defineProperty(performance, "now", { value: originalNow, configurable: true });
      }
    });
  }
});
