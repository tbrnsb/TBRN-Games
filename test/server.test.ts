import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { createServer } from "../src/server/app.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

test("GET / serves the laptop page as HTML", async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-type")?.startsWith("text/html"));
  assert.match(body, /data-page="laptop"/);
});

test("GET /play serves the phone page as HTML", async () => {
  const response = await fetch(`${baseUrl}/play`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-type")?.startsWith("text/html"));
  assert.match(body, /data-page="phone"/);
});

test("GET /api/health reports server health as JSON", async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.ok(
    response.headers.get("content-type")?.startsWith("application/json"),
  );
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("unknown routes return 404", async () => {
  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);
  assert.match(await response.text(), /Not found/);
});

test("encoded path traversal attempts return 404 without leaking files", async () => {
  const paths = [
    "/%2e%2e/package.json",
    "/..%2fpackage.json",
    "/%2e%2e%2fpackage.json",
  ];

  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.text();

    assert.equal(response.status, 404, `expected 404 for ${path}`);
    assert.doesNotMatch(body, /tbrn-games/, `leaked file contents for ${path}`);
    assert.doesNotMatch(body, /devDependencies/, `leaked file contents for ${path}`);
  }
});
