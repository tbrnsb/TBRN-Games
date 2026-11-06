/**
 * Record score-parity fixtures (test-only tooling).
 *
 * Fixtures capture the PRE-EXPANSION baseline's seeded scores for every
 * enabled game that existed at commit 085eeec, at 3 and 4 players. They are
 * regenerated ONLY through this script, never by hand:
 *
 *   git worktree add --detach <path> 085eeec
 *   node tests/tools/regen-parity-fixtures.ts --root <path>
 *   git worktree remove --force <path>
 *
 * `--root` is required on purpose: defaulting to the current tree would
 * silently record current behaviour as if it were the baseline. The driver
 * (tests/parity-driver.ts) is run as a subprocess per game+count so each
 * fixture comes from a fresh process, exactly how tests/parity-34.test.ts
 * replays them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PARITY_GAMES, fixtureFileName, toFixture, type ParityRun } from "../parity-driver.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "..", "parity-driver.ts");
const FIXTURE_DIR = join(HERE, "..", "fixtures", "parity");
const COUNTS = [3, 4] as const;

function parseRoot(argv: string[]): string | null {
  const index = argv.indexOf("--root");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value ? resolve(value) : null;
}

const root = parseRoot(process.argv.slice(2));
if (!root) {
  console.error("usage: node tests/tools/regen-parity-fixtures.ts --root <baselineTreeRoot>");
  process.exit(2);
}
if (!existsSync(join(root, "games"))) {
  console.error(`--root ${root} has no games/ directory`);
  process.exit(2);
}

mkdirSync(FIXTURE_DIR, { recursive: true });

let failures = 0;
for (const game of PARITY_GAMES) {
  for (const players of COUNTS) {
    const result = spawnSync(
      process.execPath,
      [DRIVER, "--root", root, "--game", game, "--players", String(players)],
      { encoding: "utf8", timeout: 120_000, cwd: dirname(HERE) },
    );
    const line = (result.stdout ?? "").split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
    if (!line) {
      failures++;
      console.error(`FAIL ${game} ${players}p: no JSON (status ${result.status}) stderr=${result.stderr ?? ""}`);
      continue;
    }
    const run = JSON.parse(line) as ParityRun;
    if (!run.finished || run.error) {
      failures++;
      console.error(`FAIL ${game} ${players}p: ${run.error ?? "not finished"}`);
      continue;
    }
    const path = join(FIXTURE_DIR, fixtureFileName(game, players));
    writeFileSync(path, `${JSON.stringify(toFixture(run), null, 2)}\n`, "utf8");
    console.log(`wrote ${fixtureFileName(game, players)} scores=${JSON.stringify(run.scores)}`);
  }
}

if (failures > 0) {
  console.error(`${failures} run(s) failed; fixtures NOT fully recorded`);
  process.exit(1);
}
console.log(`recorded ${PARITY_GAMES.length * COUNTS.length} fixtures into tests/fixtures/parity/`);
