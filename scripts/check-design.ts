/**
 * Objective design checks: palette contrast, text-fit, overflow, console errors
 * and a rough frame-time sample. Run: npm run check:design
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { PAPERS, TYPE } from "../client/kit/theme.ts";

function lum(hex) {
  const n = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = parts.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const findings = [];
for (const [id, paper] of Object.entries(PAPERS)) {
  const ratio = contrast(paper.onPaper, paper.hex);
  if (ratio < 4.5) findings.push(`contrast ${id}: ${ratio.toFixed(2)}:1`);
}

const port = 22000 + Math.floor(Math.random() * 6000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr?.on("data", () => {});

try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* wait */ }
    if (Date.now() > deadline) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#audioStart").click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(700);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const heapBefore = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);

  const overflow = await page.evaluate(() => {
    const selectors = [".room-tag", ".launch .v", ".mox-caption", ".box-title", ".count", ".qz-mast", ".qz-question p", ".qz-label", ".qz-timer"];
    return selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, ok: true, missing: true };
      return {
        selector,
        ok: el.scrollWidth <= el.clientWidth + 1,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });
  });
  for (const item of overflow) {
    if (!item.ok) findings.push(`overflow ${item.selector} (${item.scrollWidth} > ${item.clientWidth})`);
  }

  const fit = await page.evaluate(async () => {
    const { fitText } = await import("/kit/textfit.ts");
    const results = [];
    for (const text of ["A", "x".repeat(100), "nospaces".repeat(14)]) {
      const parent = document.createElement("div");
      parent.style.cssText = "position:absolute;left:-9999px;width:220px;height:100px;overflow:hidden";
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = "display:block;white-space:normal;overflow-wrap:anywhere";
      parent.appendChild(el);
      document.body.appendChild(parent);
      fitText(el, { min: 12, max: 48, lineHeight: 1.15 });
      results.push({
        text: text.slice(0, 12),
        fits: el.scrollWidth <= parent.clientWidth + 1 && el.scrollHeight <= parent.clientHeight + 1,
        size: getComputedStyle(el).fontSize,
      });
      parent.remove();
    }
    return results;
  });
  for (const item of fit) {
    if (!item.fits) findings.push(`text-fit failed for "${item.text}" at ${item.size}`);
  }

  const frame = await page.evaluate(async () => {
    const times = [];
    let last = performance.now();
    const end = last + 2000;
    await new Promise((resolve) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    return { count: times.length, p95: times[Math.floor(times.length * 0.95)] ?? 0 };
  });
  if (frame.p95 > 20) findings.push(`frame p95 ${frame.p95.toFixed(1)}ms at 4x CPU throttle (target <20ms)`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  // A coarse leak check: reload three times and compare the heap.
  for (let i = 0; i < 3; i++) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
  }
  const heapAfter = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  if (heapBefore && heapAfter && heapAfter - heapBefore > 32 * 1024 * 1024) {
    findings.push(`heap grew ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(1)} MB across 3 reloads`);
  }

  if (errors.length) findings.push(`console errors: ${errors.join(" | ")}`);
  if (findings.length) {
    console.error("[check:design] FAIL");
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(`[check:design] PASS · ${Object.keys(PAPERS).length} papers, ${frame.count} frames, p95 ${frame.p95.toFixed(1)}ms`);
    console.log(`[check:design] type floor: body ${TYPE.min.body}px, label ${TYPE.min.label}px, score ${TYPE.min.score}px, title ${TYPE.min.title}px`);
  }
  await browser.close();
} finally {
  server.kill();
}
