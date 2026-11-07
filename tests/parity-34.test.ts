/**
 * Score parity at 3 and 4 players vs recorded pre-expansion fixtures.
 *
 * Every enabled game that existed at baseline commit 085eeec is replayed
 * through the SAME deterministic driver (tests/parity-driver.ts) against the
 * current tree. Three-way coverage (fail closed — a newly enabled game with
 * no entry fails the catalog test):
 *
 *   - EXACT:   deep-equal against the fixture recorded from the baseline
 *              worktree (tests/fixtures/parity/<game>-<n>p.json);
 *   - EXEMPT:  current rules deliberately differ from the baseline. The game
 *              sits in the EXEMPT table with a MANDATORY written reason
 *              (citing the brief/decision). An exemption skips ONLY the exact
 *              seeded-score comparison: the run must still finish, produce
 *              the baseline round count and keep every per-round gain inside
 *              the game's uncapped ceiling, and the game answers scripted
 *              single-round payout probes at 3 and 4 players (plus a
 *              five-player cap probe for the games that cap from five up);
 *   - SKIPPED: baseline-absent (new in a later phase), no fixture exists.
 *
 * Fixtures are baseline truth: never edit them by hand. Regenerate only via
 *   node tests/tools/regen-parity-fixtures.ts --root <baselineWorktree>
 * (see that script's header for the worktree commands).
 *
 * The driver is spawned as a subprocess per game+count — the exact way the
 * fixtures were recorded — so both sides run in a fresh process with fresh
 * module state, seeded PRNG (Math.random + node:crypto.randomInt) and a
 * fixed input strategy. The probes below drive the game plugins in-process,
 * like the per-game suites, with scripted inputs and read-only access to the
 * instance state (secrets such as the Faker seat are fine in a test).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE } from "../shared/scoring.ts";
import {
  PARITY_GAMES,
  fixtureFileName,
  type ParityFixture,
  type ParityRun,
  type ParityScoreSnapshot,
} from "./parity-driver.ts";
import dumbinventionsPlugin from "../games/dumbinventions/server.ts";
import fakinPlugin from "../games/fakin/server.ts";
import stowawayPlugin from "../games/stowaway/server.ts";
import survivePlugin from "../games/survive/server.ts";
import bracketPlugin from "../games/bracket/server.ts";
import quizPlugin from "../games/quiz/server.ts";
import sloganshirtsPlugin from "../games/sloganshirts/server.ts";
import dartsPlugin, { AIM_SWEEP_MS, DARTBOARD_RADIUS } from "../games/darts/server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRIVER = join(ROOT, "tests", "parity-driver.ts");
const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "parity");
const COUNTS: readonly number[] = [3, 4];

/**
 * Enabled games with no pre-expansion baseline. Each one must exist in the
 * current enabled catalog (a stale entry fails the catalog test) and must
 * have NO fixture (there is nothing to compare against).
 */
const SKIPPED: Record<string, string> = {
  guessimposter:
    "new in phase 4 (commit 4b7f136+); the game did not exist at baseline 085eeec",
};

/**
 * Exemption table (human decision 2026-11-06, .orchestrator/STATE.md
 * "Parity test rework", decision 3): every game whose rules or content
 * deliberately differ from baseline `085eeec` at 3-4 players, each with a
 * written reason. Fail closed: an entry without a reason, a stale entry or a
 * game missing from the baseline set fails the suite, and a baseline game
 * absent from this table is exact-compared.
 *
 * An exemption skips ONLY the exact seeded-score comparison. Round counts,
 * caps and payout formulas are still asserted for every entry below.
 */
const EXEMPT: Record<string, string> = {
  dumbinventions:
    "Brief 4 removed the -200 unused-chip penalty (baseline roundPoints " +
    "subtracted 200 per pitch missing both chips); the brief-ordered rule " +
    "stays in effect at every count with the 3-4 deviation logged " +
    "(docs/DECISIONS.md 'Dumb Inventions cap' and the Parity row).",
  fakin:
    "Brief 4 strict-majority catch plus the secure-shuffle Faker rotation " +
    "cycle, and the round-1 init fix (onStart now calls fakinBegin so round " +
    "1 has prompts and a drawn Faker; baseline round 1 started empty). " +
    "Brief-ordered rules kept at all counts, deviation logged " +
    "(docs/DECISIONS.md \"Fakin' range\" and the Parity row).",
  stowaway:
    "Round-1 init fix: onStart now calls stowBegin so round 1 has its " +
    "category, decoys and rotating seat (baseline round 1 had an empty " +
    "category — a bug). The restored four-round baseline at 3-4 is asserted " +
    "from the run (docs/DECISIONS.md 'Stowaway range' and the Parity row).",
  survive:
    "Brief 4 secure derangement pairing and the N-2 ballot (nobody may vote " +
    "a pairing they are part of), plus the round-gain cap that now applies " +
    "from five players only; the 3-4 deviation and the cap fix are logged " +
    "(docs/DECISIONS.md 'Survive scoring' and the Parity row).",
  bracket:
    "Brief 4 secure-random bracket draw and byes (baseline seeded the " +
    "bracket in fixed order); the brief-ordered rule stays in effect at " +
    "every count with the 3-4 deviation logged (docs/DECISIONS.md 'Bracket " +
    "scoring' and the Parity row).",
  quiz:
    "Content pack grew from 11 to 23 questions in the phase-4 content pack, " +
    "so the seeded question list can never match baseline; the 3-4 rank " +
    "bonus stays the baseline formula and is probed exactly " +
    "(docs/DECISIONS.md 'Quiz scoring').",
  sloganshirts:
    "Draw-phase advance fix: baseline could advance to the slogan phase " +
    "mid-draw, now every designer must tap done before the vote opens " +
    "(bugfix logged in .orchestrator/STATE.md parity run; scoring row " +
    "docs/DECISIONS.md 'Slogan Shirts scoring and cap').",
  darts:
    "Aim mechanic rebuilt at the human's 2026-11-08 request: the free dual " +
    "sliders became a constant-speed two-stage timing lock (X then Y, " +
    "AIM_SWEEP_MS = 1200, commit 087285d). The 501 scoring maths is unchanged, " +
    "so the seeded run differs only because the input path changed. Darts is " +
    "a countdown game: the suite measures points scored (previous - current, " +
    "clamped >= 0) per round against the 180 ceiling (3 darts x 60), and the " +
    "scripted probe pins bull 50, outer bull 25, triple 20 = 60, double 20 = " +
    "40 and a miss 0.",
};

/** Baseline round count every exempt game must still run at 3-4 players. */
const EXEMPT_ROUNDS: Record<string, number> = {
  dumbinventions: 2,
  fakin: 3,
  stowaway: 4,
  survive: 3,
  bracket: 2,
  quiz: 10,
  sloganshirts: 2,
  darts: 20,
};

/**
 * Uncapped per-round ceiling each exempt game must stay at or below in the
 * driver runs at 3-4 players: the maximum one seat can gain under the
 * CURRENT decided rules with no cap applied (the caps only bind from five
 * players up, which the five-player probes prove separately).
 */
const EXEMPT_CEILINGS: Record<string, (players: number) => number> = {
  dumbinventions: (players) => (players - 1) * 1000,
  fakin: () => 500,
  stowaway: () => 1000,
  survive: (players) => (players - 2) * 700 + 300,
  bracket: (players) => (players === 4 ? 1600 : 1500),
  quiz: () => 1500,
  sloganshirts: () => 2000,
  darts: () => 180,
};

/** Baseline games compared deep-equal: everything on the baseline, minus the exemptions. */
const EXACT: readonly string[] = PARITY_GAMES.filter((game) => !(game in EXEMPT));

function spawnDriver(game: string, players: number): ParityRun {
  const result = spawnSync(
    process.execPath,
    [DRIVER, "--root", ROOT, "--game", game, "--players", String(players)],
    { encoding: "utf8", timeout: 60_000, cwd: ROOT },
  );
  const line = (result.stdout ?? "")
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith("{"));
  assert.ok(
    line,
    `driver produced no JSON for ${game} ${players}p (status ${String(result.status)}): ${result.stderr ?? ""}`,
  );
  return JSON.parse(line) as ParityRun;
}

function loadFixture(game: string, players: number): ParityFixture {
  const path = join(FIXTURE_DIR, fixtureFileName(game, players));
  assert.ok(
    existsSync(path),
    `missing fixture ${fixtureFileName(game, players)} — regenerate with ` +
      `node tests/tools/regen-parity-fixtures.ts --root <baselineWorktree>`,
  );
  return JSON.parse(readFileSync(path, "utf8")) as ParityFixture;
}

/** Anti-vacuity: a fixture must carry a full, sane score vector. */
function assertSaneScores(label: string, scores: unknown, players: number): asserts scores is number[] {
  assert.ok(Array.isArray(scores), `${label}: scores must be an array`);
  assert.equal(scores.length, players, `${label}: expected ${players} scores, got ${scores.length}`);
  scores.forEach((value, index) => {
    assert.equal(typeof value, "number", `${label}: score ${index} is not a number`);
    assert.ok(Number.isFinite(value), `${label}: score ${index} is not finite (${String(value)})`);
    assert.ok(value >= 0, `${label}: score ${index} is negative (${value})`);
  });
}

function assertSaneStandings(label: string, standings: unknown, players: number): void {
  assert.ok(Array.isArray(standings), `${label}: standings must be an array`);
  assert.equal(standings.length, players, `${label}: expected ${players} standings`);
  for (const entry of standings as Array<{ playerId?: unknown; rank?: unknown; raw?: unknown }>) {
    assert.equal(typeof entry.playerId, "string", `${label}: standing playerId must be a string`);
    const rank = entry.rank;
    assert.equal(typeof rank, "number", `${label}: standing rank must be a number`);
    assert.ok(typeof rank === "number" && rank >= 1, `${label}: standing rank must be >= 1`);
    const raw = entry.raw;
    assert.equal(typeof raw, "number", `${label}: standing raw must be a number`);
    assert.ok(
      typeof raw === "number" && Number.isFinite(raw) && raw >= 0,
      `${label}: standing raw must be finite and non-negative (${String(raw)})`,
    );
  }
}

interface RoundGains {
  round: number;
  gains: number[];
}

/**
 * Countdown games score by subtracting from a starting total, so the suite's
 * usual "score after - score before" gain is negative for them. These games
 * are measured as points SCORED instead: previous total minus current total,
 * clamped at zero, with the first round measured against the game's starting
 * total. Only darts is a countdown game today; every other game keeps the
 * ordinary gain metric.
 */
const COUNTDOWN_GAMES = new Set<string>(["darts"]);
const COUNTDOWN_START: Record<string, number> = { darts: 501 };

/**
 * Fold the driver's tagged score snapshots into per-seat gains per round:
 * every snapshot in one round tag contributes its own delta, so a round that
 * scores in two steps (Stowaway's catch guess) is still checked as steps
 * while a round's total is the sum of its group against the previous group.
 */
function perRoundGains(history: readonly ParityScoreSnapshot[], players: number, game: string): RoundGains[] {
  const countdown = COUNTDOWN_GAMES.has(game);
  const groups: Array<{ round: number; last: number[] }> = [];
  for (const entry of history) {
    const top = groups[groups.length - 1];
    if (top && top.round === entry.round) top.last = entry.scores;
    else groups.push({ round: entry.round, last: [...entry.scores] });
  }
  const start = countdown ? (COUNTDOWN_START[game] ?? 0) : 0;
  let previous: number[] = new Array<number>(players).fill(start);
  return groups.map((group) => {
    const gains = group.last.map((score, index) =>
      countdown ? Math.max(0, previous[index] - score) : score - previous[index],
    );
    previous = group.last;
    return { round: group.round, gains };
  });
}

// ---------------------------------------------------------------------------
// Coverage matrix (fail closed)
// ---------------------------------------------------------------------------

test("parity set matches the current enabled catalog exactly", () => {
  const enabled = Object.entries(GAME_CATALOG)
    .filter(([, entry]) => entry.enabled)
    .map(([id]) => id)
    .sort();
  const expected = [...PARITY_GAMES, ...Object.keys(SKIPPED)].sort();
  assert.deepEqual(
    enabled,
    expected,
    "enabled catalog and parity coverage drifted — a new enabled game must be " +
      "exact-compared (in PARITY_GAMES, not EXEMPT), exempt (EXEMPT with a " +
      "written reason), or baseline-absent (SKIPPED with a reason)",
  );
  // Three-way split: exempt and skipped entries live inside the parity set,
  // and exact + exempt + skipped cover the catalog without overlap.
  for (const game of Object.keys(EXEMPT)) {
    assert.ok(PARITY_GAMES.includes(game), `${game}: exemptions may only cover baseline parity games`);
    assert.ok(!(game in SKIPPED), `${game}: cannot be exempt and baseline-absent at once`);
  }
  const split = new Set([...EXACT, ...Object.keys(EXEMPT), ...Object.keys(SKIPPED)]);
  assert.equal(
    split.size,
    enabled.length,
    "exact + exempt + skipped must partition the enabled catalog",
  );
  assert.equal(
    EXACT.length + Object.keys(EXEMPT).length,
    PARITY_GAMES.length,
    "every baseline game is either exact-compared or exempt",
  );
});

test("exemption entries are enabled baseline games with a written reason", () => {
  assert.ok(Object.keys(EXEMPT).length > 0, "the exemption table must not be empty");
  for (const [game, reason] of Object.entries(EXEMPT)) {
    assert.ok(
      (reason ?? "").length >= 20,
      `${game}: an exemption entry needs a written reason citing the brief/decision`,
    );
    assert.equal(GAME_CATALOG[game]?.enabled, true, `${game}: exemption entry is stale (game not enabled)`);
    assert.ok(PARITY_GAMES.includes(game), `${game}: exemptions may only cover baseline parity games`);
    assert.ok(!(game in SKIPPED), `${game}: cannot be exempt and baseline-absent at once`);
    assert.equal(EXEMPT_ROUNDS[game] !== undefined, true, `${game}: exemption needs a baseline round count`);
    assert.equal(typeof EXEMPT_CEILINGS[game], "function", `${game}: exemption needs a cap ceiling`);
    for (const players of COUNTS) {
      const path = join(FIXTURE_DIR, fixtureFileName(game, players));
      assert.ok(
        existsSync(path),
        `${game} is exempt but its baseline fixture ${fixtureFileName(game, players)} is missing`,
      );
    }
  }
});

test("skipped games are enabled but have no fixtures", () => {
  for (const [game, reason] of Object.entries(SKIPPED)) {
    assert.ok(reason.length > 10, `${game}: skip reason must explain why`);
    assert.equal(GAME_CATALOG[game]?.enabled, true, `${game}: skip entry is stale (not enabled)`);
    for (const players of COUNTS) {
      const path = join(FIXTURE_DIR, fixtureFileName(game, players));
      assert.ok(!existsSync(path), `${game} is skipped (${reason}) but a fixture exists`);
    }
  }
});

test("driver is deterministic on this tree (two runs agree)", () => {
  for (const game of ["poker", "stowaway"]) {
    const first = spawnDriver(game, 4);
    const second = spawnDriver(game, 4);
    assert.deepEqual(
      { finished: first.finished, scores: first.scores, standings: first.standings },
      { finished: second.finished, scores: second.scores, standings: second.standings },
      `${game} 4p: two runs of the same driver on the same tree must be identical`,
    );
  }
});

// ---------------------------------------------------------------------------
// Exact comparison (non-exempt baseline games)
// ---------------------------------------------------------------------------

for (const game of EXACT) {
  for (const players of COUNTS) {
    test(`${game} @ ${players}p scores match the baseline fixture`, () => {
      const fixture = loadFixture(game, players);
      assert.equal(fixture.game, game, "fixture game id mismatch");
      assert.equal(fixture.players, players, "fixture player count mismatch");
      assert.equal(fixture.finished, true, "fixture must record a finished game");
      assertSaneScores(`${game} ${players}p fixture`, fixture.scores, players);
      assertSaneStandings(`${game} ${players}p fixture`, fixture.standings, players);

      const current = spawnDriver(game, players);
      assert.equal(
        current.finished,
        true,
        `${game} ${players}p current run did not finish: ${String(current.error)}`,
      );
      const scores = current.scores;
      assertSaneScores(`${game} ${players}p current`, scores, players);
      assertSaneStandings(`${game} ${players}p current`, current.standings, players);
      assert.ok(
        current.screenFields >= 1,
        `${game} ${players}p: the finished screen must not be empty`,
      );

      assert.deepEqual(
        scores,
        fixture.scores,
        `${game} ${players}p: current scores differ from the baseline fixture ` +
          `(baseline=${JSON.stringify(fixture.scores)} current=${JSON.stringify(scores)})`,
      );
      assert.deepEqual(
        current.standings,
        fixture.standings,
        `${game} ${players}p: current standings differ from the baseline fixture ` +
          `(baseline=${JSON.stringify(fixture.standings)} current=${JSON.stringify(current.standings)})`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Exempt games: round count + caps from ONE driver run per game and count
// ---------------------------------------------------------------------------

for (const game of Object.keys(EXEMPT)) {
  const expectedRounds = EXEMPT_ROUNDS[game];
  const ceilingFor = EXEMPT_CEILINGS[game];
  for (const players of COUNTS) {
    test(`exempt ${game} @ ${players}p runs ${expectedRounds} rounds within the uncapped ceiling`, () => {
      const run = spawnDriver(game, players);
      assert.equal(
        run.finished,
        true,
        `${game} ${players}p exempt run must still finish: ${String(run.error)}`,
      );
      assertSaneScores(`${game} ${players}p exempt run`, run.scores, players);
      assertSaneStandings(`${game} ${players}p exempt run`, run.standings, players);
      assert.ok(run.screenFields >= 1, `${game} ${players}p: the finished screen must not be empty`);

      // Round count from the run's own state, never from the catalog.
      assert.equal(
        run.roundsCompleted,
        expectedRounds,
        `${game} ${players}p: rounds run must be the baseline count`,
      );
      assert.equal(
        run.roundsTotal,
        expectedRounds,
        `${game} ${players}p: configured rounds must be the baseline count`,
      );

      const gains = perRoundGains(run.scoreHistory, players, game);
      assert.ok(gains.length >= 1, `${game} ${players}p: the run must produce scored rounds`);
      if (game !== "quiz") {
        // Every non-quiz round settles with a payout, so each round must show.
        assert.equal(
          gains.length,
          expectedRounds,
          `${game} ${players}p: every round must score (got ${gains.length} scored rounds)`,
        );
      }

      const ceiling = ceilingFor(players);
      for (const { round, gains: roundGains } of gains) {
        roundGains.forEach((gain, seat) => {
          assert.ok(
            gain >= 0,
            `${game} ${players}p round ${round}: seat ${seat} lost ${-gain} points`,
          );
          assert.ok(
            gain <= ceiling,
            `${game} ${players}p round ${round}: seat ${seat} gained ${gain}, above the ` +
              `uncapped ceiling ${ceiling}`,
          );
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Scripted payout probes (exempt games): exact deltas under the decided rules
// ---------------------------------------------------------------------------

interface ProbePlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

/** Game states are read loosely here; every probe asserts exact numbers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProbeState = Record<string, any>;

interface ProbeInstance {
  players: ProbePlayer[];
  state: ProbeState;
}

interface ProbePlugin {
  onStart(room: Record<string, unknown>, players: ProbePlayer[]): ProbeInstance;
  onInput(instance: ProbeInstance, playerId: string, input: unknown): void;
  onTick(instance: ProbeInstance, deltaMs: number): void;
  screenState(instance: ProbeInstance): unknown;
  controllerState(instance: ProbeInstance, playerId: string): unknown;
}

/** Narrow a game's default export to the shared probe interface. */
function probePlugin(plugin: unknown): ProbePlugin {
  return plugin as ProbePlugin;
}

const probe: Record<string, ProbePlugin> = {
  dumbinventions: probePlugin(dumbinventionsPlugin),
  fakin: probePlugin(fakinPlugin),
  stowaway: probePlugin(stowawayPlugin),
  survive: probePlugin(survivePlugin),
  bracket: probePlugin(bracketPlugin),
  quiz: probePlugin(quizPlugin),
  sloganshirts: probePlugin(sloganshirtsPlugin),
  darts: probePlugin(dartsPlugin),
};

function makeProbePlayers(count: number): ProbePlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function probeRoom(gameId: string, players: ProbePlayer[]): Record<string, unknown> {
  return {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0]?.id ?? null,
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

function startProbe(gameId: string, count: number): { players: ProbePlayer[]; inst: ProbeInstance } {
  const plugin = probe[gameId];
  assert.ok(plugin, `no probe plugin registered for ${gameId}`);
  const players = makeProbePlayers(count);
  return { players, inst: plugin.onStart(probeRoom(gameId, players), players) };
}

/** Tick until `phase` (or a finish), with a step budget; fails if never reached. */
function advanceTo(gameId: string, inst: ProbeInstance, phase: string, budget = 400): void {
  const plugin = probe[gameId];
  for (let i = 0; i < budget && inst.state.phase !== phase && inst.state.phase !== "finished"; i++) {
    plugin.onTick(inst, 2000);
  }
  assert.equal(
    inst.state.phase,
    phase,
    `${gameId}: expected phase "${phase}", got "${String(inst.state.phase)}"`,
  );
}

function zeros(count: number): number[] {
  return new Array<number>(count).fill(0);
}

/** A pitch that deliberately contains neither dealt chip, verified at runtime. */
function chiplessPitch(chips: readonly string[]): string {
  const candidates = ["nothing at all", "plain text here", "quiet gadget", "123 456"];
  const pitch = candidates.find((candidate) =>
    chips.every((chip) => !candidate.toLowerCase().includes(chip.toLowerCase())),
  );
  assert.ok(pitch, `no chip-free pitch among the candidates for chips ${chips.join(", ")}`);
  return pitch;
}

test("probe: dumbinventions @ 3p pays 1000 per vote with no -200 chip penalty", () => {
  const count = 3;
  const { players, inst } = startProbe("dumbinventions", count);
  const state = inst.state;
  players.forEach((player, seat) => {
    probe.dumbinventions.onInput(inst, player.id, { text: `Gadget ${seat}` });
    probe.dumbinventions.onInput(inst, player.id, { text: chiplessPitch(state.chips[seat] as string[]) });
  });
  assert.equal(state.phase, "vote", "all pitches submitted");
  // Seats 1..N-1 stack on seat 0; seat 0 (who cannot vote for itself) votes
  // seat 1, so every ballot lands and the round settles.
  players.forEach((player, seat) => {
    probe.dumbinventions.onInput(inst, player.id, { choice: `p:${seat === 0 ? 1 : 0}` });
  });
  assert.equal(state.phase, "reveal", "the stacked ballot settles the round");
  const expected = zeros(count);
  expected[0] = (count - 1) * 1000;
  expected[1] = 1000;
  assert.deepEqual(
    state.scores,
    expected,
    "1000 per vote for chip-less pitches — baseline paid count*1000 - 200 for " +
      "chip-less pitches and -200 to vote-less authors (seat 2 stays at 0)",
  );
});

test("probe: dumbinventions @ 4p pays 1000 per vote with no -200 chip penalty", () => {
  const count = 4;
  const { players, inst } = startProbe("dumbinventions", count);
  const state = inst.state;
  players.forEach((player, seat) => {
    probe.dumbinventions.onInput(inst, player.id, { text: `Gadget ${seat}` });
    probe.dumbinventions.onInput(inst, player.id, { text: chiplessPitch(state.chips[seat] as string[]) });
  });
  assert.equal(state.phase, "vote", "all pitches submitted");
  players.forEach((player, seat) => {
    probe.dumbinventions.onInput(inst, player.id, { choice: `p:${seat === 0 ? 1 : 0}` });
  });
  assert.equal(state.phase, "reveal", "the stacked ballot settles the round");
  const expected = zeros(count);
  expected[0] = (count - 1) * 1000;
  expected[1] = 1000;
  assert.deepEqual(
    state.scores,
    expected,
    "3000 for three chip-less votes plus one vote elsewhere — nobody penalised",
  );
});

test("probe: dumbinventions @ 5p caps the stacked round at exactly 1500", () => {
  const count = 5;
  const { players, inst } = startProbe("dumbinventions", count);
  const state = inst.state;
  players.forEach((player, seat) => {
    probe.dumbinventions.onInput(inst, player.id, { text: `Gadget ${seat}` });
    probe.dumbinventions.onInput(inst, player.id, { text: chiplessPitch(state.chips[seat] as string[]) });
  });
  players.forEach((player, seat) => {
    probe.dumbinventions.onInput(inst, player.id, { choice: `p:${seat === 0 ? 1 : 0}` });
  });
  assert.equal(state.phase, "reveal", "the stacked ballot settles the round");
  const uncapped = (count - 1) * 750; // scalePayout(1000, 5) = 750 per vote
  assert.ok(uncapped > MAX_ROUND_SCORE, `uncapped stacked gain ${uncapped} must exceed the bound`);
  const expected = zeros(count);
  expected[0] = MAX_ROUND_SCORE;
  expected[1] = 750; // the single vote seat 0 cast, below the bound
  assert.deepEqual(state.scores, expected, "the stacked seat lands on exactly MAX_ROUND_SCORE");
});

function fakinExpected(count: number, faker: number, caught: boolean): number[] {
  return Array.from({ length: count }, (_, seat) => {
    if (caught) return seat === faker ? 0 : 200;
    return seat === faker ? 500 : 0;
  });
}

test("probe: fakin @ 3p catches a clear majority and pays 200 per correct voter", () => {
  const count = 3;
  const { players, inst } = startProbe("fakin", count);
  advanceTo("fakin", inst, "voting");
  const faker = inst.state.faker as number;
  players.forEach((player, seat) => {
    if (seat !== faker) probe.fakin.onInput(inst, player.id, { choice: `p:${faker}` });
  });
  assert.equal(inst.state.phase, "reveal", "the unanimous accusation settles the round");
  assert.equal(inst.state.reveal?.caught, true, "a clear majority must catch the Faker");
  assert.deepEqual(inst.state.scores, fakinExpected(count, faker, true), "200 per correct voter, Faker 0");
});

test("probe: fakin @ 4p catches a clear majority and pays 200 per correct voter", () => {
  const count = 4;
  const { players, inst } = startProbe("fakin", count);
  advanceTo("fakin", inst, "voting");
  const faker = inst.state.faker as number;
  players.forEach((player, seat) => {
    if (seat !== faker) probe.fakin.onInput(inst, player.id, { choice: `p:${faker}` });
  });
  assert.equal(inst.state.phase, "reveal", "the unanimous accusation settles the round");
  assert.equal(inst.state.reveal?.caught, true, "a clear majority must catch the Faker");
  assert.deepEqual(inst.state.scores, fakinExpected(count, faker, true), "200 per correct voter, Faker 0");
});

function castFakinEscapeVotes(inst: ProbeInstance, players: ProbePlayer[]): void {
  const faker = inst.state.faker as number;
  const innocents = players.map((_, i) => i).filter((i) => i !== faker);
  const target = innocents[0];
  const fallback = innocents[1];
  for (const voter of innocents) {
    const choice = voter === target ? fallback : target;
    probe.fakin.onInput(inst, players[voter].id, { choice: `p:${choice}` });
  }
}

test("probe: fakin @ 3p split ballot escapes for 500", () => {
  const count = 3;
  const { players, inst } = startProbe("fakin", count);
  advanceTo("fakin", inst, "voting");
  const faker = inst.state.faker as number;
  castFakinEscapeVotes(inst, players);
  assert.equal(inst.state.phase, "reveal", "the split ballot settles the round");
  assert.equal(inst.state.reveal?.caught, false, "a tie/split never catches the Faker");
  assert.deepEqual(inst.state.scores, fakinExpected(count, faker, false), "the escape pays the Faker 500");
});

test("probe: fakin @ 4p split ballot escapes for 500", () => {
  const count = 4;
  const { players, inst } = startProbe("fakin", count);
  advanceTo("fakin", inst, "voting");
  const faker = inst.state.faker as number;
  castFakinEscapeVotes(inst, players);
  assert.equal(inst.state.phase, "reveal", "the split ballot settles the round");
  assert.equal(inst.state.reveal?.caught, false, "an innocent top pick never catches the Faker");
  assert.deepEqual(inst.state.scores, fakinExpected(count, faker, false), "the escape pays the Faker 500");
});

function startStowawayRound(count: number): { players: ProbePlayer[]; inst: ProbeInstance } {
  const started = startProbe("stowaway", count);
  advanceTo("stowaway", started.inst, "clue");
  for (const player of started.players) {
    probe.stowaway.onInput(started.inst, player.id, { text: "salt water" });
  }
  assert.equal(started.inst.state.phase, "discussion", "all clues submitted");
  advanceTo("stowaway", started.inst, "vote");
  return started;
}

test("probe: stowaway @ 3p pays 500 per correct voter and 500 for a correct catch guess", () => {
  const count = 3;
  const { players, inst } = startStowawayRound(count);
  const stow = inst.state.stowaway as number;
  assert.equal(stow, 0, "round 1 always rotates the seat-0 Stowaway");
  players.forEach((player, seat) => {
    if (seat !== stow) probe.stowaway.onInput(inst, player.id, { choice: `p:${stow}` });
  });
  assert.equal(inst.state.phase, "catchguess", "the unanimous accusation catches the Stowaway");
  probe.stowaway.onInput(inst, players[stow].id, { choice: inst.state.category as string });
  assert.equal(inst.state.phase, "reveal", "the correct category guess opens the reveal");
  assert.deepEqual(
    inst.state.scores,
    new Array<number>(count).fill(500),
    "each correct voter +500 and the caught Stowaway +500 for the guess",
  );
});

test("probe: stowaway @ 4p pays 500 per correct voter and 500 for a correct catch guess", () => {
  const count = 4;
  const { players, inst } = startStowawayRound(count);
  const stow = inst.state.stowaway as number;
  players.forEach((player, seat) => {
    if (seat !== stow) probe.stowaway.onInput(inst, player.id, { choice: `p:${stow}` });
  });
  assert.equal(inst.state.phase, "catchguess", "the unanimous accusation catches the Stowaway");
  probe.stowaway.onInput(inst, players[stow].id, { choice: inst.state.category as string });
  assert.equal(inst.state.phase, "reveal", "the correct category guess opens the reveal");
  assert.deepEqual(
    inst.state.scores,
    new Array<number>(count).fill(500),
    "each correct voter +500 and the caught Stowaway +500 for the guess",
  );
});

function castStowawayEscapeVotes(inst: ProbeInstance, players: ProbePlayer[]): void {
  const stow = inst.state.stowaway as number;
  const innocents = players.map((_, i) => i).filter((i) => i !== stow);
  const target = innocents[0];
  const fallback = innocents[1];
  for (const voter of innocents) {
    const choice = voter === target ? fallback : target;
    probe.stowaway.onInput(inst, players[voter].id, { choice: `p:${choice}` });
  }
}

test("probe: stowaway @ 3p uncaught Stowaway takes 1000", () => {
  const count = 3;
  const { players, inst } = startStowawayRound(count);
  const stow = inst.state.stowaway as number;
  castStowawayEscapeVotes(inst, players);
  assert.equal(inst.state.phase, "reveal", "the split ballot settles the round");
  assert.equal(inst.state.reveal?.caught, false, "a tie never catches the Stowaway");
  const expected = zeros(count);
  expected[stow] = 1000;
  assert.deepEqual(inst.state.scores, expected, "an uncaught Stowaway takes the fixed 1000");
});

test("probe: stowaway @ 4p uncaught Stowaway takes 1000", () => {
  const count = 4;
  const { players, inst } = startStowawayRound(count);
  const stow = inst.state.stowaway as number;
  castStowawayEscapeVotes(inst, players);
  assert.equal(inst.state.phase, "reveal", "the split ballot settles the round");
  assert.equal(inst.state.reveal?.caught, false, "an innocent top pick never catches the Stowaway");
  const expected = zeros(count);
  expected[stow] = 1000;
  assert.deepEqual(inst.state.scores, expected, "an uncaught Stowaway takes the fixed 1000");
});

function startSurviveRound(count: number): { players: ProbePlayer[]; inst: ProbeInstance } {
  const started = startProbe("survive", count);
  for (const player of started.players) {
    probe.survive.onInput(started.inst, player.id, { text: `answer ${player.id}` });
  }
  assert.equal(started.inst.state.phase, "twisting", "all answers submitted");
  for (const player of started.players) {
    probe.survive.onInput(started.inst, player.id, { text: `headline ${player.id}` });
  }
  assert.equal(started.inst.state.phase, "voting", "all twists submitted");
  return started;
}

test("probe: survive @ 3p pays 700 writer + 300 quoted per vote on the N-2 ballot", () => {
  const count = 3;
  const { players, inst } = startSurviveRound(count);
  const pairing = inst.state.pairing as number[];
  const writer = 0;
  const quoted = pairing[writer];
  // The N-2 ballot: one slot per pairing minus the writer and the quoted seat.
  const eligible = players.map((_, i) => i).filter((i) => i !== writer && i !== quoted);
  assert.equal(eligible.length, count - 2, "exactly N-2 seats may vote this pairing");
  for (const seat of eligible) {
    probe.survive.onInput(inst, players[seat].id, { choice: `t:${writer}` });
  }
  // Close the ballot on the timer with this partial vote.
  inst.state.timerMs = 0;
  probe.survive.onTick(inst, 500);
  assert.equal(inst.state.phase, "reveal", "the expired ballot settles the round");
  const expected = zeros(count);
  expected[writer] = 700 * eligible.length;
  expected[quoted] += 300 * eligible.length;
  assert.deepEqual(
    inst.state.scores,
    expected,
    "700 to the headline writer and 300 to the quoted answer per vote",
  );
});

test("probe: survive @ 4p pays 700 writer + 300 quoted per vote on the N-2 ballot", () => {
  const count = 4;
  const { players, inst } = startSurviveRound(count);
  const pairing = inst.state.pairing as number[];
  const writer = 0;
  const quoted = pairing[writer];
  const eligible = players.map((_, i) => i).filter((i) => i !== writer && i !== quoted);
  assert.equal(eligible.length, count - 2, "exactly N-2 seats may vote this pairing");
  for (const seat of eligible) {
    probe.survive.onInput(inst, players[seat].id, { choice: `t:${writer}` });
  }
  inst.state.timerMs = 0;
  probe.survive.onTick(inst, 500);
  assert.equal(inst.state.phase, "reveal", "the expired ballot settles the round");
  const expected = zeros(count);
  expected[writer] = 700 * eligible.length;
  expected[quoted] += 300 * eligible.length;
  assert.deepEqual(
    inst.state.scores,
    expected,
    "two stacked votes pay 1400 to the writer and 600 to the quoted answer — uncapped at 4p",
  );
});

test("probe: survive @ 5p caps a stacked writer+quoted round at exactly 1500", () => {
  const count = 5;
  const { players, inst } = startSurviveRound(count);
  const pairing = inst.state.pairing as number[];
  const quotedWriter = pairing.indexOf(0); // the seat whose headline quotes seat 0
  const votes = new Array<number>(count).fill(-1);
  const chooseVote = (seat: number, prefer: (writer: number) => boolean): number => {
    const options = pairing
      .map((_, writer) => writer)
      .filter((writer) => writer !== seat && pairing[writer] !== seat);
    assert.ok(options.length > 0, `seat ${seat} has no legal ballot slot`);
    return options.find(prefer) ?? options[0];
  };
  for (let seat = 0; seat < count; seat++) {
    if (seat !== 0 && pairing[0] !== seat) {
      votes[seat] = 0; // everyone except the writer and the quoted seat stacks on seat 0
    }
  }
  // The quoted seat backs the pairing that quotes seat 0 when legal; seat 0
  // votes a pairing it is not part of.
  votes[pairing[0]] = chooseVote(pairing[0], (writer) => writer === quotedWriter);
  votes[0] = chooseVote(0, () => false);
  for (let seat = 0; seat < count; seat++) {
    assert.ok(votes[seat] >= 0, `seat ${seat} must have a vote`);
    probe.survive.onInput(inst, players[seat].id, { choice: `t:${votes[seat]}` });
  }
  assert.equal(inst.state.phase, "reveal", "the full ballot settles the round");

  // Decided rule at 5p: scalePayout(700, 5) = 525 writer, scalePayout(300, 5)
  // = 225 quoted, each seat's round gain capped at MAX_ROUND_SCORE.
  const counts = zeros(count);
  for (const vote of votes) counts[vote] += 1;
  const uncapped = zeros(count);
  counts.forEach((tally, writer) => {
    uncapped[writer] += tally * 525;
    uncapped[pairing[writer]] += tally * 225;
  });
  assert.ok(
    uncapped[0] > MAX_ROUND_SCORE,
    `the stacked seat would take ${uncapped[0]} without the cap`,
  );
  const expected = uncapped.map((gain) => Math.min(gain, MAX_ROUND_SCORE));
  assert.equal(expected[0], MAX_ROUND_SCORE, "the capped expectation lands on exactly 1500");
  assert.deepEqual(inst.state.scores, expected, "every seat matches the capped formula");
  assert.equal(inst.state.scores[0], MAX_ROUND_SCORE, "the stacked seat lands on exactly 1500");
});

// --- Bracket probes ---------------------------------------------------------

function bracketAuthorOf(state: ProbeState, entry: number): number {
  if (entry < 0) return -1;
  return (state.entries[entry]?.author as number) ?? -1;
}

function bracketResolvedSides(state: ProbeState, index: number): { a: number; b: number } {
  const resolve = (slot: number): number =>
    slot >= 0 ? slot : ((state.duels[-slot - 1]?.winner as number) ?? -1);
  return { a: resolve(state.duels[index].a), b: resolve(state.duels[index].b) };
}

/** Vote through one duel, steering `champion` to win every duel it is in. */
function steerBracketDuel(inst: ProbeInstance, players: ProbePlayer[], champion: number): void {
  const state = inst.state;
  const index = state.current as number;
  const sides = bracketResolvedSides(state, index);
  const aAuthor = bracketAuthorOf(state, sides.a);
  const bAuthor = bracketAuthorOf(state, sides.b);
  const side = aAuthor === champion ? "a" : bAuthor === champion ? "b" : "a";
  const duel = state.duels[index];
  for (let seat = 0; seat < players.length; seat++) {
    if (seat === aAuthor || seat === bAuthor) continue;
    if (duel.votes[seat] !== null) continue;
    probe.bracket.onInput(inst, players[seat].id, { choice: side });
  }
}

/**
 * Points one bracket round must pay under the decided rule: 500 per
 * non-final duel win, 1000 for the final, 100 to each voter who backed the
 * winner. Computed from the finished duels with the literals — a payout
 * change in production fails this.
 */
function bracketRoundExpected(state: ProbeState, count: number): number[] {
  const expected = zeros(count);
  state.duels.forEach((duel: { winner: number; votes: Array<string | null> }, index: number) => {
    const sides = bracketResolvedSides(state, index);
    const aAuthor = bracketAuthorOf(state, sides.a);
    const bAuthor = bracketAuthorOf(state, sides.b);
    const winnerAuthor = bracketAuthorOf(state, duel.winner);
    const winningSide = duel.winner === sides.a ? "a" : "b";
    const isFinal = index === state.duels.length - 1;
    if (winnerAuthor >= 0) expected[winnerAuthor] += isFinal ? 1000 : 500;
    for (let seat = 0; seat < count; seat++) {
      if (seat === aAuthor || seat === bAuthor) continue;
      if (duel.votes[seat] === winningSide) expected[seat] += 100;
    }
  });
  return expected;
}

test("probe: bracket @ 3p pays 500 duel / 1000 final / 100 voter, uncapped", () => {
  const count = 3;
  const { players, inst } = startProbe("bracket", count);
  for (const player of players) {
    probe.bracket.onInput(inst, player.id, { text: `answer ${player.id}` });
  }
  assert.equal(inst.state.phase, "voting", "all entries start the bracket");
  const champion = bracketAuthorOf(inst.state, 0);
  assert.ok(champion >= 0, "entry 0 has an author");
  let guard = 0;
  while (inst.state.phase === "voting" && guard++ < 30) steerBracketDuel(inst, players, champion);
  assert.equal(inst.state.phase, "reveal", "round 1 ends on the reveal");
  const expected = bracketRoundExpected(inst.state, count);
  assert.deepEqual(inst.state.scores, expected, "500/duel + 1000/final + 100/voter");
  assert.equal(
    inst.state.scores[champion],
    1500,
    "the champion takes 500 (duel) + 1000 (final) with no voter points — uncapped at 3p",
  );
});

test("probe: bracket @ 4p pays 500 duel / 1000 final / 100 voter, uncapped", () => {
  const count = 4;
  const { players, inst } = startProbe("bracket", count);
  for (const player of players) {
    probe.bracket.onInput(inst, player.id, { text: `answer ${player.id}` });
  }
  assert.equal(inst.state.phase, "voting", "all entries start the bracket");
  const champion = bracketAuthorOf(inst.state, 0);
  assert.ok(champion >= 0, "entry 0 has an author");
  let guard = 0;
  while (inst.state.phase === "voting" && guard++ < 30) steerBracketDuel(inst, players, champion);
  assert.equal(inst.state.phase, "reveal", "round 1 ends on the reveal");
  const expected = bracketRoundExpected(inst.state, count);
  assert.deepEqual(inst.state.scores, expected, "500/duel + 1000/final + 100/voter");
  assert.equal(
    inst.state.scores[champion],
    1600,
    "the champion takes 500 (semi) + 100 (backing the other semi) + 1000 (final) — uncapped at 4p",
  );
});

test("probe: bracket @ 5p caps the stacked champion at exactly 1500", () => {
  const count = 5;
  const { players, inst } = startProbe("bracket", count);
  const state = inst.state;
  for (const player of players) {
    probe.bracket.onInput(inst, player.id, { text: `answer ${player.id}` });
  }
  assert.equal(state.phase, "voting", "all entries start the bracket");
  const champion = bracketAuthorOf(state, 0);
  assert.ok(champion >= 0, "entry 0 has an author");
  let guard = 0;
  // String() keeps the earlier assert.equal("voting") narrowing out of the loop test.
  while (String(state.phase) !== "finished" && guard++ < 100) {
    if (state.phase === "voting") steerBracketDuel(inst, players, champion);
    else probe.bracket.onTick(inst, 2000);
  }
  assert.equal(state.phase, "finished", "one full bracket must finish");
  const uncapped = bracketRoundExpected(state, count);
  assert.ok(
    uncapped[champion] > MAX_ROUND_SCORE,
    `the stacked champion would take ${uncapped[champion]} without the cap`,
  );
  const expected = uncapped.map((gain) => Math.min(gain, MAX_ROUND_SCORE));
  assert.equal(expected[champion], MAX_ROUND_SCORE, "the capped expectation lands on exactly 1500");
  assert.deepEqual(state.scores, expected, "every seat matches the capped formula");
  assert.equal(state.scores[champion], MAX_ROUND_SCORE, "the stacked champion lands on exactly 1500");
});

// --- Quiz probe -------------------------------------------------------------

test("probe: quiz @ 3p standard pays 1000 + max(0, 500 - rank*100)", () => {
  const count = 3;
  const { players, inst } = startProbe("quiz", count);
  const state = inst.state;
  assert.equal(state.mode, "standard", "standalone quiz runs standard mode");
  assert.equal(state.questions.length, 10, "standard mode runs 10 questions");
  probe.quiz.onTick(inst, 0); // leave the title beat
  assert.equal(state.phase, "question", "question one started");
  players.forEach((player, rank) => {
    if (rank > 0) probe.quiz.onTick(inst, 1000);
    const question = state.questions[state.currentQuestion];
    probe.quiz.onInput(inst, player.id, { choice: question.correct });
  });
  probe.quiz.onTick(inst, (state.timeLeft as number) + 1);
  assert.equal(state.phase, "reveal", "the deadline closes the question");
  assert.deepEqual(
    state.scores,
    [1500, 1400, 1300],
    "rank 0..2 bonuses: 1500, 1400, 1300",
  );
});

test("probe: quiz @ 4p standard pays 1000 + max(0, 500 - rank*100)", () => {
  const count = 4;
  const { players, inst } = startProbe("quiz", count);
  const state = inst.state;
  assert.equal(state.mode, "standard", "standalone quiz runs standard mode");
  assert.equal(state.questions.length, 10, "standard mode runs 10 questions");
  probe.quiz.onTick(inst, 0);
  assert.equal(state.phase, "question", "question one started");
  players.forEach((player, rank) => {
    if (rank > 0) probe.quiz.onTick(inst, 1000);
    const question = state.questions[state.currentQuestion];
    probe.quiz.onInput(inst, player.id, { choice: question.correct });
  });
  probe.quiz.onTick(inst, (state.timeLeft as number) + 1);
  assert.equal(state.phase, "reveal", "the deadline closes the question");
  assert.deepEqual(
    state.scores,
    [1500, 1400, 1300, 1200],
    "rank 0..3 bonuses: 1500, 1400, 1300, 1200",
  );
});

// --- Slogan Shirts probes ---------------------------------------------------

function startSloganshirtsRound(count: number): { players: ProbePlayer[]; inst: ProbeInstance } {
  const started = startProbe("sloganshirts", count);
  for (const player of started.players) {
    probe.sloganshirts.onInput(started.inst, player.id, { action: "action" });
  }
  assert.equal(started.inst.state.phase, "slogan", "every designer tapped done");
  for (const player of started.players) {
    probe.sloganshirts.onInput(started.inst, player.id, { text: `slogan ${player.id}` });
  }
  assert.equal(started.inst.state.phase, "vote", "all slogans submitted");
  return started;
}

function castSloganshirtsVotes(inst: ProbeInstance, players: ProbePlayer[], targets: number[]): void {
  targets.forEach((shirt, seat) => {
    assert.notStrictEqual(
      inst.state.shirts[shirt]?.design,
      seat,
      `seat ${seat} must not vote for its own design`,
    );
    probe.sloganshirts.onInput(inst, players[seat].id, { choice: `s:${shirt}` });
  });
  assert.equal(inst.state.phase, "reveal", "the last vote settles the round");
}

test("probe: sloganshirts @ 3p pays 1000 to the winning shirt's authors and 100 per vote otherwise", () => {
  const count = 3;
  const { players, inst } = startSloganshirtsRound(count);
  // Shirt 0 wins with two votes; shirt 1 trails with one.
  castSloganshirtsVotes(inst, players, [1, 0, 0]);
  assert.deepEqual(
    inst.state.scores,
    [1000, 1100, 100],
    "winner authors 1000 each; shirt 1's single vote pays 100 to each of its authors",
  );
});

test("probe: sloganshirts @ 4p pays 1000 to the winning shirt's authors and 100 per vote otherwise", () => {
  const count = 4;
  const { players, inst } = startSloganshirtsRound(count);
  // Shirt 0 wins with two votes; shirts 1 and 2 trail with one each.
  castSloganshirtsVotes(inst, players, [2, 0, 0, 1]);
  assert.deepEqual(
    inst.state.scores,
    [1000, 1100, 200, 100],
    "winner authors 1000 each; trailing shirts pay 100 per vote to each author",
  );
});

test("probe: sloganshirts @ 5p caps a two-shirt author at exactly 1500", () => {
  const count = 5;
  const { players, inst } = startSloganshirtsRound(count);
  // Shirts 0 and 4 tie at the top: seat 0 authors both (design of shirt 0,
  // slogan of shirt 4) and would take 2000 uncapped.
  castSloganshirtsVotes(inst, players, [4, 0, 4, 1, 0]);
  const uncapped = 2000;
  assert.ok(uncapped > MAX_ROUND_SCORE, "the stacked author would take 2000 without the cap");
  assert.deepEqual(
    inst.state.scores,
    [MAX_ROUND_SCORE, 1075, 75, 0, 1000],
    "capped author 1500; tie authors 1000 each; the one-vote shirt pays 75 per author " +
      "(scalePayout(100, 5) = 75)",
  );
  assert.equal(inst.state.scores[0], MAX_ROUND_SCORE, "the stacked author lands on exactly 1500");
});

// --- Darts probes -----------------------------------------------------------

/** Marker position (0..1) for a board coordinate in units (±DARTBOARD_RADIUS). */
function dartsMarker(coordinate: number): number {
  return (coordinate / DARTBOARD_RADIUS + 1) / 2;
}

/**
 * Aim from rest at one board point and press once per axis. Both markers
 * reset to 0 after every throw, so a known tick delta positions a marker
 * exactly: a full 0..1 traverse is AIM_SWEEP_MS = 1200 ms.
 */
function dartsThrow(inst: ProbeInstance, x: number, y: number): number {
  const state = inst.state;
  const playerId = inst.players[state.currentPlayer as number].id;
  const markerX = dartsMarker(x);
  const markerY = dartsMarker(y);
  if (markerX > 0) probe.darts.onTick(inst, markerX * AIM_SWEEP_MS);
  probe.darts.onInput(inst, playerId, { action: "action" });
  if (markerY > 0) probe.darts.onTick(inst, markerY * AIM_SWEEP_MS);
  probe.darts.onInput(inst, playerId, { action: "action" });
  const throws = state.throws as Array<{ score: number }>;
  return throws[throws.length - 1].score;
}

for (const count of [3, 4]) {
  test(`probe: darts @ ${count}p maps locked positions to the board score`, () => {
    const { inst } = startProbe("darts", count);
    const state = inst.state;
    assert.equal(state.phase, "aimX", "a fresh dart starts on the horizontal sweep");

    // bull 50, outer bull 25, triple-20 60, double-20 40 and a miss 0.
    const targets: Array<[number, number, number]> = [
      [0, 0, 50],
      [10, 0, 25],
      [103, 0, 60],
      [166, 0, 40],
      [-170, 34, 0],
    ];
    const thrown = targets.map(([x, y, expected]) => {
      const score = dartsThrow(inst, x, y);
      assert.equal(score, expected, `dart at (${x}, ${y}) must score ${expected}`);
      return score;
    });
    assert.deepEqual(thrown, [50, 25, 60, 40, 0], "the throw-score mapping is exact");
    assert.deepEqual(
      (state.throws as Array<{ score: number }>).map((t) => t.score),
      [50, 25, 60, 40, 0],
      "every recorded throw keeps the mapped score",
    );

    // Three darts rotate the turn: seat 0 threw 50+25+60 and seat 1 threw
    // 40+0. Nobody checked out and no score went negative.
    const expectedScores = new Array<number>(count).fill(501);
    expectedScores[0] = 501 - 135;
    expectedScores[1] = 501 - 40;
    assert.deepEqual(state.scores, expectedScores, "501 minus the mapped throw scores");
    assert.equal(state.finished, false, "nobody checked out after five darts");
  });
}
