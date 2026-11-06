/**
 * Shared modules are served to browsers as well as Node. Accessing `process`
 * there throws `ReferenceError: process is not defined` and takes the whole
 * client down — which is exactly what an unguarded env override in
 * shared/constants.js did once.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["shared/constants.js"];

describe("shared modules are browser-safe", () => {
  for (const rel of FILES) {
    test(`${rel} never touches process without a guard`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const use = src.indexOf("process.env");
      if (use === -1) return;
      const guard = src.indexOf('typeof process !== "undefined"');
      assert.ok(guard !== -1, `${rel}: uses process.env with no typeof guard`);
      assert.ok(guard < use, `${rel}: the typeof guard must come before process.env`);
    });

    test(`${rel} has no CommonJS or Node-only globals`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      for (const banned of ["require(", "module.exports", "__dirname", "__filename"]) {
        assert.ok(!src.includes(banned), `${rel}: ${banned} is not available in the browser`);
      }
    });
  }
});
