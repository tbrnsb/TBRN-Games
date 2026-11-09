#!/usr/bin/env node
// Boot the real server on a free loopback port and check that it serves the
// app, then shut it down. No test framework and no shell, so this runs the
// same way on Linux, macOS and Windows.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_GAME_COUNT = 22;

const output = [];
const MAX_OUTPUT = 16_000;

function record(chunk) {
  output.push(chunk);
  while (output.length > MAX_OUTPUT) output.shift();
}

function serverOutput() {
  return output.join("").trim() || "(server produced no output)";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ask the OS for an unused port, then release it for the server to bind. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error("could not read the free port the OS picked"));
      });
    });
  });
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 20_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/games`, { signal: AbortSignal.timeout(1000) });
      await res.arrayBuffer();
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`server did not answer /api/games within 20s (${lastError})\n${serverOutput()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await Promise.race([exited, delay(4000)]);
  clearTimeout(forceTimer);
}

async function fetchBody(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
  const body = await res.text();
  return { res, body };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const failures = [];

  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", record);
  child.stderr.on("data", record);

  async function check(name, run) {
    try {
      await run();
      console.log(`OK   ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.error(`FAIL ${name}: ${message}`);
    }
  }

  try {
    await waitForServer(baseUrl);
    console.log(`OK   server booted and answered on port ${port}`);

    await check("/ serves the screen shell", async () => {
      const { res, body } = await fetchBody(baseUrl, "/");
      expect(res.status === 200, `expected 200, got ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      expect(type.includes("text/html"), `expected an HTML content type, got "${type}"`);
      expect(body.includes('id="lobby"'), "screen shell marker id=\"lobby\" is missing");
      expect(body.includes("<title>TBRN-Games</title>"), "screen title is missing");
    });

    await check("/controller serves the controller shell", async () => {
      const { res, body } = await fetchBody(baseUrl, "/controller");
      expect(res.status === 200, `expected 200, got ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      expect(type.includes("text/html"), `expected an HTML content type, got "${type}"`);
      expect(body.includes('id="controllerContainer"'), "controller shell marker is missing");
    });

    await check("/api/games serves the enabled roster", async () => {
      const { res, body } = await fetchBody(baseUrl, "/api/games");
      expect(res.status === 200, `expected 200, got ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      expect(type.includes("application/json"), `expected JSON, got "${type}"`);
      const payload = JSON.parse(body);
      expect(Array.isArray(payload.games), "games is not an array");
      const ids = payload.games.map((game) => game.id);
      expect(ids.length === EXPECTED_GAME_COUNT, `expected ${EXPECTED_GAME_COUNT} games, got ${ids.length}`);
      expect(new Set(ids).size === ids.length, "game ids are not unique");
      expect(ids.includes("darts"), "darts is missing from the roster");
      expect(!ids.includes("archery"), "retired archery still appears in the roster");
    });

    await check("/assets/fonts/inter-latin-400-normal.woff2 serves a font", async () => {
      const { res } = await fetchBody(baseUrl, "/assets/fonts/inter-latin-400-normal.woff2");
      expect(res.status === 200, `expected 200, got ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      expect(type.startsWith("font/"), `expected a font content type, got "${type}"`);
    });

    await check("/games/darts/screen.ts is type-stripped for the browser", async () => {
      const { res, body } = await fetchBody(baseUrl, "/games/darts/screen.ts");
      expect(res.status === 200, `expected 200, got ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      expect(type.includes("javascript"), `expected JavaScript, got "${type}"`);
      expect(body.length > 0, "darts screen module is empty");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(message);
    console.error(`FAIL ${message}`);
  } finally {
    await stopServer(child);
  }

  if (failures.length > 0) {
    console.error("");
    console.error("Server output:");
    console.error(serverOutput());
    return 1;
  }
  console.log("");
  console.log(`All smoke checks passed (${port}).`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    console.error(serverOutput());
    process.exit(1);
  });
