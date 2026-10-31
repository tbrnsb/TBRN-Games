/**
 * Test fixture: spawns the real server on an ephemeral port and waits for
 * its health endpoint. Tests run standalone (including in CI) without a
 * pre-running server. Set TBRN_TEST_URL to use an external server instead.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ServerFixture {
  wsUrl: string; // ws://127.0.0.1:<port>
  httpUrl: string; // http://127.0.0.1:<port>
  stop: () => void;
  external: boolean;
}

async function waitForHealth(httpUrl: string, proc: ChildProcess | null, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (proc && proc.exitCode !== null) {
      throw new Error(`server process exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(`${httpUrl}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`server did not become healthy at ${httpUrl}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function startServer(): Promise<ServerFixture> {
  const external = process.env.TBRN_TEST_URL;
  if (external) {
    const httpUrl = external.replace(/^ws/, "http");
    await waitForHealth(httpUrl, null, 5000);
    return { wsUrl: external, httpUrl, stop: () => {}, external: true };
  }

  // Ephemeral port in a range unlikely to clash with dev servers.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const httpUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ["server/index.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text.includes("ExperimentalWarning") && !text.includes("stripTypeScriptTypes")) {
      console.error(`[server:${port}]`, text.trimEnd());
    }
  });

  try {
    await waitForHealth(httpUrl, proc, 20000);
  } catch (e) {
    proc.kill();
    throw e;
  }

  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    httpUrl,
    stop: () => {
      proc.kill();
    },
    external: false,
  };
}
