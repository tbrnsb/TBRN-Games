/**
 * Capture the lobby, every game and the phone controller.
 *
 * Run: npm run shots
 * One game: SHOT_GAMES=quiz npm run shots
 * Output: design/shots/<game>/screen-1280.png, screen-1920.png, controller-390.png
 * Plus design/shots/index.html
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const outRoot = join(root, process.env.SHOT_OUT || join("design", "shots"));
const port = 21000 + Math.floor(Math.random() * 8000);
const base = `http://127.0.0.1:${port}`;
const chrome = process.env.CHROME_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const screenW = 1280;
const screenH = 720;

const server = spawn(process.execPath, ["server/index.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr?.on("data", (chunk) => {
  const text = String(chunk);
  if (!text.includes("ExperimentalWarning") && !text.includes("stripTypeScriptTypes")) {
    process.stderr.write(`[server] ${text}`);
  }
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

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

try {
  await waitForHealth();
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const screen = await browser.newPage({ viewport: { width: screenW, height: screenH } });
  const errors = [];
  screen.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  screen.on("pageerror", (err) => errors.push(err.message));

  await screen.goto(base, { waitUntil: "networkidle" });
  await screen.locator("#audioStart").click({ timeout: 3000 }).catch(() => {});
  await screen.waitForTimeout(800);

  const roomId = await screen.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      const id = localStorage.getItem("tbrn_screen_room_id");
      if (id) return id;
      await new Promise((r) => setTimeout(r, 100));
    }
    return "";
  });
  if (!roomId) throw new Error("screen did not join a room");

  await screen.evaluate(async ({ roomId }) => {
    const wsUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host;
    const join = (payload) => new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let done = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: "join", roomId, timestamp: Date.now(), payload }));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "joined" && !done) { done = true; resolve({ ws, msg }); }
      };
      ws.onerror = reject;
    });
    const tokenScreen = await join({ name: "Shots", role: "screen" });
    const bots = [];
    for (const name of ["Ana", "Ben", "Cleo"]) {
      bots.push((await join({ name })).ws);
    }
    window.__shots = { token: tokenScreen.msg.payload.hostToken, bots };
  }, { roomId });

  // A real phone has its own browser storage. Using the TV's context would
  // leak the host token into the controller and stack host controls over the
  // game layout, which is not what players see.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  await phone.goto(`${base}/controller?room=${roomId}`, { waitUntil: "networkidle" });
  await phone.fill("#nameInput", "Dee");
  await phone.click("#joinBtn");
  await phone.waitForTimeout(700);

  const gamesRes = await fetch(`${base}/api/games`);
  const allGames = (await gamesRes.json()).games;
  const wanted = process.env.SHOT_GAMES?.split(",").map((s) => s.trim()).filter(Boolean);
  const games = wanted?.length ? allGames.filter((g) => wanted.includes(g.id)) : allGames;

  await screen.screenshot({ path: join(outRoot, "lobby-1280.png") });
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.waitForTimeout(300);
  await screen.screenshot({ path: join(outRoot, "lobby-1920.png") });
  await screen.setViewportSize({ width: screenW, height: screenH });

  const index = [];
  for (const game of games) {
    const dir = join(outRoot, safeName(game.id));
    await mkdir(dir, { recursive: true });
    const started = await screen.evaluate(async ({ gameId }) => {
      const { token } = window.__shots;
      const res = await fetch(`/api/rooms/${localStorage.getItem("tbrn_screen_room_id")}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-host-token": token },
        body: JSON.stringify({ gameId }),
      });
      return res.status;
    }, { gameId: game.id });
    if (started !== 200) {
      index.push({ game: game.name, id: game.id, error: started });
      continue;
    }
    await screen.waitForTimeout(600);
    await screen.screenshot({ path: join(dir, "screen-start-1280.png") });
    await screen.setViewportSize({ width: 1920, height: 1080 });
    await screen.waitForTimeout(250);
    await screen.screenshot({ path: join(dir, "screen-start-1920.png") });
    await screen.setViewportSize({ width: screenW, height: screenH });
    await screen.waitForTimeout(3300);
    await screen.screenshot({ path: join(dir, "screen-1280.png") });
    await screen.setViewportSize({ width: 1920, height: 1080 });
    await screen.waitForTimeout(250);
    await screen.screenshot({ path: join(dir, "screen-1920.png") });
    await screen.setViewportSize({ width: screenW, height: screenH });
    await phone.screenshot({ path: join(dir, "controller-390.png") });
    index.push({ game: game.name, id: game.id, dir: safeName(game.id) });
    await screen.evaluate(async () => {
      const { token } = window.__shots;
      await fetch(`/api/rooms/${localStorage.getItem("tbrn_screen_room_id")}/end-game`, {
        method: "POST",
        headers: { "x-host-token": token },
      });
    });
    await screen.waitForTimeout(350);
  }

  const html = `<!doctype html><meta charset="utf-8"><title>TBRN shots</title>
<style>body{font-family:system-ui;background:#1d1b26;color:#f4ebd9;padding:24px}figure{display:inline-block;vertical-align:top;width:30%;margin:10px;background:#f4ebd9;color:#1d1b26;padding:8px;border:3px solid #1d1b26}img{width:100%;display:block;border:1px solid #1d1b26}h1{font-size:32px}figcaption{font-weight:700;margin:6px 0}.error{color:#f0453a}</style>
<h1>TBRN shots</h1><p>${errors.length ? `Console errors: ${errors.length}` : "No console errors"} · ${games.length} games</p>
${index.map((entry) => entry.error
    ? `<figure><figcaption class="error">${entry.game}: start failed (${entry.error})</figcaption></figure>`
    : `<figure><figcaption>${entry.game}</figcaption><a href="${entry.dir}/screen-1920.png"><img src="${entry.dir}/screen-1920.png"></a><p><a href="${entry.dir}/screen-start-1920.png">start</a> · <a href="${entry.dir}/screen-1920.png">live</a> · <a href="${entry.dir}/controller-390.png">phone</a></p></figure>`).join("\n")}
`;
  await writeFile(join(outRoot, "index.html"), html);

  if (errors.length) {
    console.error(`[shots] console errors:\n${errors.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`[shots] wrote ${games.length} games to ${outRoot}`);
  }
  await phoneContext.close();
  await browser.close();
} finally {
  server.kill();
}
