/**
 * Deterministic cross-tree score-parity driver (test-only tooling).
 *
 * Runs one game plugin to completion with:
 *   - a fixed input strategy (probe-style, seeded choices only),
 *   - a seeded PRNG behind BOTH `Math.random` and `node:crypto.randomInt`
 *     (which `shared/secure-random.ts` uses for every shuffle),
 *   - a fixed 500 ms tick and no wall-clock reads in any scoring decision.
 *
 * The driver imports nothing from the repository: it loads
 * `<root>/games/<id>/server.ts` from the `--root` tree it is given, so the
 * SAME file runs against the pre-expansion baseline worktree and the current
 * tree with byte-identical driver logic. Plugin-relative imports (content
 * packs, shared modules) resolve inside whichever tree the plugin lives in.
 *
 * CLI (one game per process, fresh module state):
 *   node tests/parity-driver.ts --root <treeRoot> --game <id> --players <n>
 * stdout is a single JSON line (ParityRun).
 *
 * Fixtures are recorded ONLY from the baseline worktree via
 *   node tests/tools/regen-parity-fixtures.ts --root <baselineWorktree>
 * and must never be hand-edited.
 *
 * Output contains only score-derived data: the final per-player score vector
 * read from the game's own finished score table, and standings the driver
 * derives from that vector. Screen/controller text and new UI fields are
 * deliberately not captured; `results()` is not called because the baseline
 * tree predates it.
 */
import { createRequire, syncBuiltinESMExports } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/**
 * Three independent streams, all reseeded per run before the plugin runs:
 *   - `gameMath`     backs `Math.random` (game logic),
 *   - `gameCrypto`   backs `node:crypto.randomInt` (secure shuffles),
 *   - `driver`       backs only this driver's input choices.
 * Keeping the driver's choices on their own stream means a game that draws
 * one extra random number cannot shift the input strategy, so a score
 * difference points at the game, not at the driver.
 */
let gameMath: () => number = () => 0.5;
let gameCrypto: () => number = () => 0.5;
let driver: () => number = () => 0.5;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over game + player count + domain so each stream is reproducible. */
export function seedFor(game: string, players: number, domain: string): number {
  const input = `${game}:${players}:${domain}:tbrn-parity-v1`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type RandomIntCallback = (err: Error | null, value?: number) => void;

/** Seeded drop-in for `node:crypto.randomInt` (all four call shapes). */
function seededRandomInt(
  a?: number | RandomIntCallback,
  b?: number | RandomIntCallback,
  c?: RandomIntCallback,
): number | undefined {
  let min: number;
  let max: number;
  let cb: RandomIntCallback | undefined;
  if (typeof a === "function") {
    throw new RangeError("randomInt: (max, cb) with no max is not used by this driver");
  }
  if (typeof b === "function") {
    min = 0;
    max = a as number;
    cb = b;
  } else if (typeof b === "number") {
    min = a as number;
    max = b;
    cb = c;
  } else {
    min = 0;
    max = a as number;
  }
  if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min) {
    throw new RangeError(`randomInt: invalid range [${String(min)}, ${String(max)})`);
  }
  const value = min + Math.floor(gameCrypto() * (max - min));
  if (cb) {
    cb(null, value);
    return undefined;
  }
  return value;
}

/**
 * Install the patches once at module load, BEFORE any plugin is imported.
 * `syncBuiltinESMExports()` makes the ESM named export `randomInt` reflect
 * the patched CJS builtin even when `node:crypto` was imported earlier.
 */
function installDeterminismPatches(): void {
  Math.random = (): number => gameMath();
  const require = createRequire(import.meta.url);
  const crypto = require("node:crypto") as { randomInt: unknown };
  crypto.randomInt = seededRandomInt;
  syncBuiltinESMExports();
}

installDeterminismPatches();

// ---------------------------------------------------------------------------
// Fixture shapes (what is recorded and compared)
// ---------------------------------------------------------------------------

export interface ParityStanding {
  playerId: string;
  rank: number;
  raw: number;
}

/** The recorded, compared payload. Score-derived fields only. */
export interface ParityFixture {
  game: string;
  players: number;
  finished: boolean;
  /** Final score vector in player order (p0 .. pN-1). */
  scores: number[];
  /** Competition ranks derived from `scores` by the driver (ties share rank). */
  standings: ParityStanding[];
}

/**
 * One score snapshot: the full vector after a round scored, tagged with the
 * zero-based round it was scored in (read from the game's own state; quiz
 * uses the question index, -1 when the state carries no round counter).
 */
export interface ParityScoreSnapshot {
  round: number;
  scores: number[];
}

/**
 * Diagnostic run payload. Everything beyond `ParityFixture` is extra: the
 * recorded fixtures and `toFixture()` stay exactly as they were.
 */
export interface ParityRun extends ParityFixture {
  seed: number;
  ticks: number;
  lastPhase: string;
  /** True when the finished screen itself carried the score table. */
  scoresAtFinish: boolean;
  /**
   * Score vector after every round in which any score changed, tagged with
   * the round it was scored in — lets tests assert per-round gains (caps)
   * without re-running the game.
   */
  scoreHistory: ParityScoreSnapshot[];
  /** Rounds run, read from the game's own state (`round + 1`, or questions). */
  roundsCompleted: number | null;
  /** Configured round/question total from state (`maxRounds`, or questions). */
  roundsTotal: number | null;
  /** Key count of the final screen state (anti-vacuity: non-empty screens). */
  screenFields: number;
  error?: string;
}

/** Fixture file name for one game + player count. */
export function fixtureFileName(game: string, players: number): string {
  return `${game}-${players}p.json`;
}

/**
 * The enabled games that existed at the pre-expansion baseline commit
 * 085eeec. `guessimposter` (phase 4) is excluded: it has no baseline.
 */
export const PARITY_GAMES: readonly string[] = [
  "archery",
  "arena",
  "blather",
  "bluff",
  "bracket",
  "drawful",
  "dumbinventions",
  "fakin",
  "frankenanswers",
  "mindmeld",
  "mostlikely",
  "percentile",
  "poker",
  "quiz",
  "racing",
  "slideroulette",
  "sloganshirts",
  "splitroom",
  "stowaway",
  "survive",
  "writevote",
];

// ---------------------------------------------------------------------------
// Plugin driving
// ---------------------------------------------------------------------------

const TICK_MS = 500;
const DEFAULT_BUDGET = 5000;
/** Same tick budgets the deep probe uses. */
const BUDGETS: Record<string, number> = { poker: 40000, racing: 4000 };

interface GameLike {
  manifest: { minPlayers: number; maxPlayers: number };
  onStart(room: unknown, players: unknown[]): unknown;
  onInput(instance: unknown, playerId: string, input: unknown): void;
  onTick(instance: unknown, deltaMs: number): void;
  screenState(instance: unknown): unknown;
  controllerState(instance: unknown, playerId: string): unknown;
}

interface DriverPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: true;
}

const mkPlayers = (n: number): DriverPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));

function phaseOf(instance: unknown): string {
  const state = (instance as { state?: Record<string, unknown> } | null)?.state;
  if (!state) return "unknown";
  if (state.phase !== undefined) return String(state.phase);
  if (state.finished === true) return "finished";
  return "unknown";
}

function isFinished(instance: unknown): boolean {
  const state = (instance as { state?: Record<string, unknown> } | null)?.state;
  return state?.phase === "finished" || state?.finished === true;
}

/**
 * Rounds run vs configured, read from the game's OWN state so a test can
 * assert round counts without trusting the catalog. Quiz counts questions;
 * every other game reports the zero-based `round` plus `maxRounds`.
 */
function roundProgress(gameId: string, instance: unknown): { completed: number; total: number } | null {
  const state = (instance as { state?: Record<string, unknown> } | null)?.state;
  if (!state || typeof state !== "object") return null;
  if (gameId === "quiz") {
    const questions = state.questions;
    const current = state.currentQuestion;
    if (!Array.isArray(questions) || typeof current !== "number") return null;
    return { completed: current + 1, total: questions.length };
  }
  const round = state.round;
  const maxRounds = state.maxRounds;
  if (typeof round !== "number" || typeof maxRounds !== "number") return null;
  return { completed: round + 1, total: maxRounds };
}

// ---------------------------------------------------------------------------
// Score extraction from the game's own screen tables
// ---------------------------------------------------------------------------

/**
 * Mirrors the score tables `shared/results.ts` reads (racing progress, poker
 * chips, otherwise `scores[].score` with a `players[].score` fallback), but
 * is implemented here so the SAME extraction runs on both trees.
 */
function scoreSources(gameId: string): Array<{ list: string; key: string }> {
  if (gameId === "racing") return [{ list: "racers", key: "progress" }];
  if (gameId === "poker") return [{ list: "players", key: "chips" }];
  return [
    { list: "scores", key: "score" },
    { list: "players", key: "score" },
  ];
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Read the full per-player score vector out of a screen state by matching
 * row `name` to the driver's player names. Returns null unless EVERY player
 * is covered by one score table (partial tables are never used).
 */
function extractScores(gameId: string, screen: unknown, players: readonly DriverPlayer[]): number[] | null {
  if (!screen || typeof screen !== "object") return null;
  const record = screen as Record<string, unknown>;
  const indexByName = new Map(players.map((player, index) => [player.name, index]));

  for (const source of scoreSources(gameId)) {
    const list = record[source.list];
    if (!Array.isArray(list) || list.length === 0) continue;
    const values: number[] = players.map(() => 0);
    const seen: boolean[] = players.map(() => false);
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.name !== "string") continue;
      const index = indexByName.get(row.name);
      if (index === undefined || seen[index]) continue;
      const raw = asFiniteNumber(row[source.key]);
      if (raw === null) continue;
      values[index] = raw;
      seen[index] = true;
    }
    if (seen.every(Boolean)) return values;
  }
  return null;
}

/** Competition ranks from the score vector: ties share the first position. */
function deriveStandings(players: readonly DriverPlayer[], scores: readonly number[]): ParityStanding[] {
  const ordered = players
    .map((player, index) => ({ id: player.id, raw: scores[index] }))
    .sort((a, b) => b.raw - a.raw || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const standings: ParityStanding[] = [];
  let rank = 0;
  let previousRaw: number | null = null;
  ordered.forEach((entry, index) => {
    if (previousRaw === null || entry.raw !== previousRaw) {
      rank = index + 1;
      previousRaw = entry.raw;
    }
    standings.push({ playerId: entry.id, rank, raw: entry.raw });
  });
  return standings;
}

// ---------------------------------------------------------------------------
// Fixed input strategy (probe-style; every choice comes from the driver stream)
// ---------------------------------------------------------------------------

interface ControllerLike {
  mode?: unknown;
  phase?: unknown;
  options?: unknown;
  question?: unknown;
  hasAnswered?: unknown;
  hasVoted?: unknown;
  hasSubmitted?: unknown;
  yourTurn?: unknown;
  canCheck?: unknown;
  canCall?: unknown;
  canRaise?: unknown;
  minRaiseTo?: unknown;
  isDrawing?: unknown;
  drawPower?: unknown;
  chat?: unknown;
  rank?: unknown;
}

function optionList(value: unknown): Array<{ id: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { id: string } =>
      !!item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string",
  );
}

function strategyFor(gameId: string, controller: ControllerLike, playerId: string): unknown {
  const rnd = (n: number): number => Math.floor(driver() * Math.max(1, n));

  switch (gameId) {
    case "poker": {
      if (controller.yourTurn !== true) return null;
      if (controller.canCheck === true) return { action: driver() < 0.7 ? "check" : "raise", amount: controller.minRaiseTo };
      if (controller.canCall === true) return { action: "call" };
      if (controller.canRaise === true) return { action: "raise", amount: controller.minRaiseTo };
      return { action: "fold" };
    }
    case "quiz": {
      const question = controller.question as { options?: unknown } | null;
      const options = question ? optionList(question.options) : [];
      if (!question || controller.hasAnswered === true || !options.length) return null;
      return { choice: options[rnd(options.length)].id };
    }
    case "mostlikely": {
      const options = optionList(controller.options);
      if (controller.hasVoted === true || controller.phase !== "voting" || !options.length) return null;
      return { choice: options[rnd(options.length)].id };
    }
    case "bluff":
    case "writevote": {
      if (controller.phase === "writing") {
        return controller.hasSubmitted === true ? null : { text: `${gameId}-${playerId}-${rnd(999)}` };
      }
      if (controller.phase === "voting") {
        const options = optionList(controller.options);
        if (controller.hasVoted === true || !options.length) return null;
        return { choice: options[rnd(options.length)].id };
      }
      return null;
    }
    case "archery": {
      // Hold the draw until the bow is strong, then release.
      if (controller.isDrawing === true) {
        return typeof controller.drawPower === "number" && controller.drawPower >= 0.8 ? { tap: true } : null;
      }
      return { tap: true };
    }
    case "racing":
      return { tap: true };
    case "percentile":
    case "splitroom":
    case "drawful":
    case "fakin":
    case "survive":
    case "blather":
    case "mindmeld":
    case "stowaway":
    case "frankenanswers":
    case "bracket":
    case "dumbinventions":
    case "sloganshirts":
    case "slideroulette":
    case "arena": {
      // These games switch controller UI per phase and report it as `mode`.
      const mode = controller.mode;
      if (mode === "one-button") return { tap: true };
      if (mode === "slider") {
        return driver() < 0.5 ? { slider: { axis: "x", value: driver() } } : { action: "action" };
      }
      if (mode === "canvas") {
        return driver() < 0.75
          ? { stroke: { points: [[0.2, 0.2], [0.6, 0.6], [0.8, 0.4]], color: "#111111" } }
          : { action: "action" };
      }
      if (mode === "text") return { text: `${gameId} answer by ${playerId}` };
      if (mode === "aim") {
        return driver() < 0.4
          ? { pad: { x: driver() * 2 - 1, y: driver() * 2 - 1 } }
          : driver() < 0.5
            ? { slider: { axis: "y", value: driver() } }
            : { action: "action" };
      }
      if (mode === "chat") {
        const chat = controller.chat as { contacts?: Array<{ id: string }> } | undefined;
        const contacts = chat?.contacts ?? [];
        if (contacts.length) return { chat: { to: contacts[0].id, text: "hello there" } };
        return { action: "lol" };
      }
      if (mode === "rank") {
        const items = (controller.rank as { items?: Array<{ id: string }> } | undefined)?.items ?? [];
        const ids = items.map((item) => item.id);
        for (let k = ids.length - 1; k > 0; k--) {
          const j = Math.floor(driver() * (k + 1));
          const tmp = ids[k];
          ids[k] = ids[j];
          ids[j] = tmp;
        }
        return { rank: { order: ids } };
      }
      if (mode === "choice") {
        const options = optionList(controller.options);
        if (!options.length) return null;
        return { choice: options[rnd(options.length)].id };
      }
      return null;
    }
    default:
      return { tap: true };
  }
}

// ---------------------------------------------------------------------------
// Run one game to completion
// ---------------------------------------------------------------------------

function failure(game: string, players: number, seed: number, ticks: number, lastPhase: string, error: string): ParityRun {
  return {
    game,
    players,
    seed,
    finished: false,
    ticks,
    lastPhase,
    scoresAtFinish: false,
    scoreHistory: [],
    roundsCompleted: null,
    roundsTotal: null,
    screenFields: 0,
    scores: [],
    standings: [],
    error,
  };
}

/**
 * Run `gameId` at `players` seats inside the tree rooted at `root` and
 * return the final score vector plus driver-derived standings.
 */
export async function runGame(root: string, gameId: string, players: number): Promise<ParityRun> {
  const absRoot = resolve(root);
  const seed = seedFor(gameId, players, "driver");
  gameMath = mulberry32(seedFor(gameId, players, "game-math"));
  gameCrypto = mulberry32(seedFor(gameId, players, "game-crypto"));
  driver = mulberry32(seed);

  let plugin: GameLike;
  try {
    const url = pathToFileURL(join(absRoot, "games", gameId, "server.ts")).href;
    const loaded = (await import(url)) as { default?: GameLike };
    plugin = loaded.default as GameLike;
  } catch (error) {
    return failure(gameId, players, seed, 0, "unknown", `plugin import failed: ${(error as Error).message}`);
  }
  if (!plugin || typeof plugin.onStart !== "function" || typeof plugin.screenState !== "function") {
    return failure(gameId, players, seed, 0, "unknown", "plugin missing onStart/screenState");
  }

  const manifest = plugin.manifest;
  if (players < manifest.minPlayers || players > manifest.maxPlayers) {
    return failure(
      gameId,
      players,
      seed,
      0,
      "unknown",
      `manifest rejects ${players} players (range ${manifest.minPlayers}-${manifest.maxPlayers})`,
    );
  }

  const table = mkPlayers(players);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: table[0].id,
    players: table,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };

  let instance: unknown;
  try {
    instance = plugin.onStart(room, table);
  } catch (error) {
    return failure(gameId, players, seed, 0, "unknown", `onStart threw: ${(error as Error).message}`);
  }

  const budget = BUDGETS[gameId] ?? DEFAULT_BUDGET;
  let ticks = 0;
  let finished = false;
  let lastPhase = phaseOf(instance);
  let lastScores: number[] | null = null;

  // Per-round score history: every vector change is recorded with the round
  // the game state says it scored in, so tests can sum per-round gains.
  const scoreHistory: ParityScoreSnapshot[] = [];
  let lastSnapshot: number[] | null = null;
  const recordSnapshot = (scores: number[]): void => {
    if (lastSnapshot && lastSnapshot.length === scores.length && lastSnapshot.every((v, i) => v === scores[i])) {
      return;
    }
    const progress = roundProgress(gameId, instance);
    scoreHistory.push({ round: progress ? progress.completed - 1 : -1, scores: [...scores] });
    lastSnapshot = [...scores];
  };

  for (; ticks < budget; ticks++) {
    let screen: unknown;
    try {
      screen = plugin.screenState(instance);
    } catch (error) {
      return failure(gameId, players, seed, ticks, lastPhase, `screenState threw: ${(error as Error).message}`);
    }
    const parsed = extractScores(gameId, screen, table);
    if (parsed) {
      lastScores = parsed;
      recordSnapshot(parsed);
    }

    let done = false;
    for (const player of table) {
      let controller: ControllerLike | null = null;
      try {
        controller = plugin.controllerState(instance, player.id) as ControllerLike;
      } catch (error) {
        return failure(gameId, players, seed, ticks, lastPhase, `controllerState threw: ${(error as Error).message}`);
      }
      let input: unknown = null;
      if (controller) {
        try {
          input = strategyFor(gameId, controller, player.id);
        } catch (error) {
          return failure(gameId, players, seed, ticks, lastPhase, `strategy threw: ${(error as Error).message}`);
        }
      }
      if (input) {
        try {
          plugin.onInput(instance, player.id, input);
        } catch (error) {
          return failure(gameId, players, seed, ticks, lastPhase, `onInput threw: ${(error as Error).message}`);
        }
      }
      if (isFinished(instance)) {
        done = true;
        break;
      }
    }
    if (!done) {
      try {
        plugin.onTick(instance, TICK_MS);
      } catch (error) {
        return failure(gameId, players, seed, ticks, lastPhase, `onTick threw: ${(error as Error).message}`);
      }
      if (isFinished(instance)) done = true;
    }
    if (done) {
      finished = true;
      ticks++;
      break;
    }
    lastPhase = phaseOf(instance);
  }

  if (!finished) {
    return failure(gameId, players, seed, ticks, lastPhase, `did not finish within ${budget} ticks (last phase "${lastPhase}")`);
  }

  // Final snapshot: prefer the finished screen's own table, else the last one seen.
  let finalScreen: unknown;
  try {
    finalScreen = plugin.screenState(instance);
  } catch (error) {
    return failure(gameId, players, seed, ticks, lastPhase, `final screenState threw: ${(error as Error).message}`);
  }
  const finalScores = extractScores(gameId, finalScreen, table);
  if (finalScores) recordSnapshot(finalScores);
  const scores = finalScores ?? lastScores;
  if (!scores) {
    return failure(gameId, players, seed, ticks, lastPhase, "no complete score table on any screen state");
  }

  const progress = roundProgress(gameId, instance);
  return {
    game: gameId,
    players,
    seed,
    finished: true,
    scores,
    standings: deriveStandings(table, scores),
    ticks,
    lastPhase,
    scoresAtFinish: finalScores !== null,
    scoreHistory,
    roundsCompleted: progress?.completed ?? null,
    roundsTotal: progress?.total ?? null,
    screenFields: finalScreen && typeof finalScreen === "object" ? Object.keys(finalScreen).length : 0,
  };
}

/** The recorded payload only (diagnostics stay out of the fixture files). */
export function toFixture(run: ParityRun): ParityFixture {
  return {
    game: run.game,
    players: run.players,
    finished: run.finished,
    scores: run.scores,
    standings: run.standings,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { root: string; game: string; players: number } | null {
  let root: string | undefined;
  let game: string | undefined;
  let players: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--root" && value !== undefined) {
      root = value;
      i++;
    } else if (key === "--game" && value !== undefined) {
      game = value;
      i++;
    } else if (key === "--players" && value !== undefined) {
      players = Number(value);
      i++;
    }
  }
  if (!root || !game || players === undefined || !Number.isInteger(players)) return null;
  return { root, game, players };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: node tests/parity-driver.ts --root <treeRoot> --game <id> --players <n>");
    process.exitCode = 2;
    return;
  }
  const run = await runGame(args.root, args.game, args.players);
  console.log(JSON.stringify(run));
  process.exitCode = run.finished && !run.error ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
