/** Every game must ship a tutorial and a visual identity. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const gamesDir = join(process.cwd(), "games");
const ids = readdirSync(gamesDir).filter((d) => existsSync(join(gamesDir, d, "server.ts"))).sort();

const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(path, "utf8"));

describe("game metadata", () => {
  test("every game ships a howTo tutorial", () => {
    assert.ok(ids.length >= 30, `expected a full roster, found ${ids.length}`);
    for (const id of ids) {
      const man = readJson(join(gamesDir, id, "manifest.json"));
      assert.strictEqual(typeof man.howTo, "string", `${id}: howTo missing`);
      assert.ok(man.howTo.length > 20, `${id}: howTo is too short to teach anything`);
    }
  });

  test("every game ships a theme.json with a full palette", () => {
    for (const id of ids) {
      const theme = readJson(join(gamesDir, id, "theme.json"));
      assert.strictEqual(theme.gameId, id, `${id}: theme is for the wrong game`);
      for (const key of ["background", "primary", "accent", "surface", "text"]) {
        assert.strictEqual(typeof theme.palette?.[key], "string", `${id}: palette.${key} missing`);
      }
      assert.ok(theme.animationProfile?.easings, `${id}: animation profile missing`);
    }
  });

  test("manifest copy matches the plugin id", () => {
    for (const id of ids) {
      const man = readJson(join(gamesDir, id, "manifest.json"));
      assert.strictEqual(man.id, id, `${id}: manifest id mismatch`);
      assert.ok(man.minPlayers <= man.maxPlayers, `${id}: impossible player range`);
    }
  });
});
