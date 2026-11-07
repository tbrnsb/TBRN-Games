import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const out = join(root, process.env.SHOT_OUT || "design/host-shots");
const port = 24000 + Math.floor(Math.random() * 4000);
const base = `http://127.0.0.1:${port}`;
const chrome = process.env.CHROME_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

const server = spawn(process.execPath, ["server/index.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DROPOUT_PAUSE_MS: "1200" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr?.on("data", (chunk) => {
  const text = String(chunk);
  if (!text.includes("ExperimentalWarning") && !text.includes("stripTypeScriptTypes")) process.stderr.write(text);
});

async function waitForHealth() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

try {
  await waitForHealth();
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#audioStart").click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const roomId = localStorage.getItem("tbrn_screen_room_id");
    const wsUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host;
    const open = (payload) => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => ws.send(JSON.stringify({ type: "join", roomId, timestamp: Date.now(), payload }));
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "joined") resolve({ ws, msg: m }); };
      ws.onerror = reject;
    });
    const screen = await open({ name: "Host", role: "screen" });
    window.__token = screen.msg.payload.hostToken;
    window.__bots = [];
    for (let i = 0; i < 8; i++) window.__bots.push((await open({ name: "Player " + (i + 1) })).ws);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(out, "lobby-1280.png") });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, "lobby-1920.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  await page.locator("#rumbleBtn").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, "rumble-presets-1280.png") });
  await page.locator("#rumbleStart").click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, "rumble-session-1280.png") });
  await page.evaluate(async () => {
    const roomId = localStorage.getItem("tbrn_screen_room_id");
    await fetch(`/api/rooms/${roomId}/session/end`, { method: "POST", headers: { "x-host-token": window.__token } });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "finale-1280.png") });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "finale-1920.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#settingsBtn").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, "settings-1280.png") });
  await page.locator("#settingsClose").click();
  await page.waitForTimeout(200);
  await page.locator("#sessionClose").click();
  await page.waitForTimeout(500);

  // A real between-game interlude: run Most Likely To with auto-voting bots.
  if (process.env.SKIP_INTERLUDE !== "1") {
  await page.evaluate(async () => {
    const roomId = localStorage.getItem("tbrn_screen_room_id");
    const hdr = { "Content-Type": "application/json", "x-host-token": window.__token };
    await fetch(`/api/rooms/${roomId}/session/start`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({ presetId: "friday-night-at-mos" }),
    });
    await fetch(`/api/rooms/${roomId}/start`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({ gameId: "mostlikely" }),
    });
    const bots = window.__bots || [];
    const seen = new WeakMap();
    bots.forEach((ws, i) => {
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type !== "gameState") return;
        const controller = msg.payload?.controller || {};
        if (!Array.isArray(controller.options) || controller.options.length === 0) return;
        const key = `${controller.prompt || ""}|${controller.round ?? ""}|${controller.phase ?? ""}`;
        if (seen.get(ws) === key) return;
        seen.set(ws, key);
        setTimeout(() => {
          try {
            ws.send(JSON.stringify({
              type: "input",
              roomId,
              timestamp: Date.now(),
              payload: { choice: String((i + 1) % bots.length) },
            }));
          } catch { /* socket closed */ }
        }, 120);
      };
    });
  });
  await page.waitForFunction(
    () => !document.querySelector("#interlude")?.classList.contains("hidden"),
    { timeout: 120000 },
  ).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "interlude-1280.png") });
  }

  // Below-minimum pause: three seats, then one leaves.
  await page.evaluate(() => localStorage.clear());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#audioStart").click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const roomId = localStorage.getItem("tbrn_screen_room_id");
    const wsUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host;
    const open = (payload) => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => ws.send(JSON.stringify({ type: "join", roomId, timestamp: Date.now(), payload }));
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "joined") resolve({ ws, msg: m }); };
      ws.onerror = reject;
    });
    const screen = await open({ name: "Host", role: "screen" });
    window.__token = screen.msg.payload.hostToken;
    window.__bots = [];
    for (let i = 0; i < 3; i++) window.__bots.push((await open({ name: "Player " + (i + 1) })).ws);
    await fetch(`/api/rooms/${roomId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-host-token": window.__token },
      body: JSON.stringify({ gameId: "bluff" }),
    });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__bots?.[2]?.close());
  await page.waitForFunction(
    () => !document.querySelector("#pauseOverlay")?.classList.contains("hidden"),
    { timeout: 8000 },
  ).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, "pause-1280.png") });
  await browser.close();
  console.log(`[host-shots] wrote ${out}`);
} finally {
  server.kill("SIGTERM");
}
