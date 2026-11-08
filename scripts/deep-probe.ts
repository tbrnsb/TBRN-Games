/**
 * Deep invariant probe over every game plugin.
 * Finds: Map/Set/undefined/NaN on the wire, stuck games, hostile-input crashes,
 * unsafe post-finish calls, and player-index range errors.
 *
 * Runs every enabled game at every player count in its manifest range.
 * Pass `--all` to include retired (disabled) games. Exits non-zero when any
 * run reports an issue.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { isGameEnabled } from "../shared/game-catalog.ts";

const includeDisabled = process.argv.includes("--all");

const gamesDir = join(process.cwd(), "games");
const allGameIds = readdirSync(gamesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(gamesDir, d.name, "server.ts")))
  .map((d) => d.name)
  .sort();
const gameIds = includeDisabled ? allGameIds : allGameIds.filter((id) => isGameEnabled(id));

const mkPlayers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
const mkRoom = (players: any[], gameId: string) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null,
  players, gameId, gameState: null, createdAt: 0, status: "playing",
});

/** Every integer player count the manifest allows, deduped. */
function playerCounts(manifest: { minPlayers: number; maxPlayers: number }): number[] {
  const counts: number[] = [];
  for (let n = manifest.minPlayers; n <= manifest.maxPlayers; n++) {
    if (n >= manifest.minPlayers && n <= manifest.maxPlayers) counts.push(n);
  }
  return [...new Set(counts)];
}

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
 * Keys whose values are scores and therefore must never be negative
 * (brief 7.1: "no negative or NaN scores"). Matched case-insensitively as a
 * substring so `score`, `scores`, `rawScore`, `chips`, `stack`, `pots`,
 * `points` and `roundGain` are all covered.
 */
const SCORE_KEY = /(score|raw|chips|stack|pots|points|gain)/i;

function badNumbers(value: unknown, path = "$", out: string[] = [], checkNegative = true): string[] {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(`${path} = ${String(value)} (non-finite)`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out, checkNegative));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${k}`;
      // Only score-like numeric keys are range-checked; other numbers (times,
      // counts, coordinates, angles) may legitimately be negative. The
      // non-negative rule applies to ENABLED games only: retired code such as
      // knifethrow subtracts 5 per clash by design, and `--all` still has to
      // run it without a false finding. Finite checks stay on for every game.
      if (checkNegative && typeof v === "number" && Number.isFinite(v) && v < 0 && SCORE_KEY.test(k)) {
        out.push(`${childPath} = ${v} (negative score)`);
      }
      badNumbers(v, childPath, out, checkNegative);
    }
  }
  return out;
}

/** Wire check: what JSON.stringify produces must round-trip to the same data. */
function checkWire(label: string, value: unknown, issues: string[]): void {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (e) {
    issues.push(`${label}: not serializable (${(e as Error).message})`);
    return;
  }
  const parsed = JSON.parse(json);
  try {
    assert.deepStrictEqual(parsed, JSON.parse(JSON.stringify(parsed)));
  } catch {
    issues.push(`${label}: unstable under JSON round-trip`);
  }
  // Detect Map/Set/undefined/function/NaN at the source by comparing shapes.
  const walk = (a: unknown, b: unknown, path: string) => {
    if (b === null && a !== null) {
      issues.push(`${label}${path}: becomes null on the wire (NaN/Infinity/undefined)`);
      return;
    }
    if (typeof a === "function") issues.push(`${label}${path}: function on the wire`);
    if (a instanceof Map || a instanceof Set) {
      issues.push(`${label}${path}: ${a.constructor.name} serialises to {}`);
      return;
    }
    if (a && typeof a === "object" && b && typeof b === "object") {
      if (Array.isArray(a) !== Array.isArray(b)) {
        issues.push(`${label}${path}: array/object shape changes on the wire`);
        return;
      }
      const ak = Object.keys(a as object);
      const bk = Object.keys(b as object);
      if (ak.length !== bk.length) {
        const missing = ak.filter((k) => !bk.includes(k));
        if (missing.length) issues.push(`${label}${path}: keys dropped (${missing.join(",")})`);
      }
      for (const k of ak) {
        walk((a as any)[k], (b as any)[k], `${path}.${k}`);
      }
    }
  };
  walk(value, parsed, "");
}

/** Hostile inputs a phone could plausibly (or maliciously) send. */
const hostileInputs: unknown[] = [
  null, undefined, {}, [], "x", 0, 123, -1, NaN, Infinity,
  { choice: 123 }, { choice: null }, { choice: "" }, { choice: "nope" },
  { move: 42 }, { move: "" }, { move: "sideways" },
  { tap: "yes" }, { tap: null },
  { text: 42 }, { text: "" }, { text: "x".repeat(500) },
  { grid: null }, { grid: { row: -5, col: 9999 } }, { grid: { row: 0.5, col: 0.5 } },
  { action: "raise", amount: -100 }, { action: "raise", amount: NaN },
  { action: "call", amount: Infinity }, { action: "bogus" },
  { amount: -1 }, { playCard: 999 }, { playCard: -1 },
  { __proto__: { polluted: true } },
];

function driver(gameId: string, cs: any, playerId: string): unknown {
  const rnd = (n: number) => Math.floor(Math.random() * Math.max(1, n));
  switch (gameId) {
    case "poker":
      if (cs.yourTurn !== true) return null;
      if (cs.canCheck) return { action: Math.random() < 0.7 ? "check" : "raise", amount: cs.minRaiseTo };
      if (cs.canCall) return { action: "call" };
      if (cs.canRaise) return { action: "raise", amount: cs.minRaiseTo };
      return { action: "fold" };
    case "hangman": {
      if (cs.isYourTurn !== true) return null;
      const guessed = new Set<string>((cs.guessed as string[]) ?? []);
      const fresh = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((l) => !guessed.has(l));
      return fresh.length ? { choice: fresh[rnd(fresh.length)] } : null;
    }
    case "quiz": {
      const q = cs.question as { options: Array<{ id: string }> } | null;
      if (!q || cs.hasAnswered) return null;
      return { choice: q.options[rnd(q.options.length)].id };
    }
    case "mostlikely": {
      const opts = (cs.options as Array<{ id: string }>) ?? [];
      if (cs.hasVoted || cs.phase !== "voting" || !opts.length) return null;
      return { choice: opts[rnd(opts.length)].id };
    }
    case "guesswho": {
      if (cs.yourTurn !== true) return null;
      const opts = (cs.options as Array<{ id: string }>) ?? [];
      if (!opts.length) return null;
      const guesses = opts.filter((o) => o.id.startsWith("g:"));
      const qs = opts.filter((o) => o.id.startsWith("q:"));
      const pool = guesses.length && Math.random() < 0.15 ? guesses : qs.length ? qs : opts;
      return { choice: pool[rnd(pool.length)].id };
    }
    case "guessimposter": {
      // Clue turns are either typed or a one-button spoken confirmation; the
      // vote and final guess both use a plain option list.
      if (cs.mode === "one-button") return { tap: true };
      if (cs.mode === "text") {
        if (cs.isYourTurn === false) return null;
        return { text: `clue${rnd(999)}` };
      }
      if (cs.mode === "choice") {
        const opts = (cs.options as Array<{ id: string }>) ?? [];
        if (!opts.length) return null;
        return { choice: opts[rnd(opts.length)].id };
      }
      return null;
    }
    case "bluff":
    case "writevote": {
      if (cs.phase === "writing") return cs.hasSubmitted ? null : { text: `${gameId}-${playerId}-${rnd(999)}` };
      if (cs.phase === "voting") {
        const opts = (cs.options as Array<{ id: string }>) ?? [];
        if (cs.hasVoted || !opts.length) return null;
        return { choice: opts[rnd(opts.length)].id };
      }
      return null;
    }
    case "percentile":
    case "splitroom":
    case "dictionarium":
    case "drawful":
    case "fakin":
    case "trivia":
    case "wordspud":
    case "survive":
    case "blather":
    case "mindmeld":
    case "mindreader":
    case "stowaway":
    case "bdate":
    case "frankenanswers":
    case "bracket":
    case "dumbinventions":
    case "wordchain":
    case "sloganshirts":
    case "mashup":
    case "arena":
    case "slideroulette":
    case "lastseat": {
      // These games switch controller UI per phase and report it as `mode`.
      if (cs.mode === "one-button") return { tap: true };
      if (cs.mode === "slider") {
        return Math.random() < 0.5 ? { slider: { axis: "x", value: Math.random() } } : { action: "action" };
      }
      if (cs.mode === "canvas") {
        return Math.random() < 0.75
          ? { stroke: { points: [[0.2, 0.2], [0.6, 0.6], [0.8, 0.4]], color: "#111111" } }
          : { action: "action" };
      }
      if (cs.mode === "text") return { text: `${gameId} answer by ${playerId}` };
      if (cs.mode === "aim") {
        return Math.random() < 0.4
          ? { pad: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 } }
          : Math.random() < 0.5
            ? { slider: { axis: "y", value: Math.random() } }
            : { action: "action" };
      }
      if (cs.mode === "chat") {
        const contacts = ((cs.chat as { contacts?: Array<{ id: string }> } | undefined)?.contacts ?? []);
        if (contacts.length) return { chat: { to: contacts[0].id, text: "hello there" } };
        return { action: "lol" };
      }
      if (cs.mode === "rank") {
        const items = ((cs.rank as { items?: Array<{ id: string }> } | undefined)?.items ?? []);
        const ids = items.map((i) => i.id);
        for (let k = ids.length - 1; k > 0; k--) {
          const j = Math.floor(Math.random() * (k + 1));
          const tmp = ids[k]; ids[k] = ids[j]; ids[j] = tmp;
        }
        return { rank: { order: ids } };
      }
      if (cs.mode === "choice") {
        const opts = (cs.options as Array<{ id: string }>) ?? [];
        if (!opts.length) return null;
        return { choice: opts[rnd(opts.length)].id };
      }
      return null;
    }
    case "snakes":
    case "golf":
      return { move: ["up", "down", "left", "right"][rnd(4)] };
    case "racing":
      return { tap: true };
    case "darts":
      return Math.random() < 0.5
        ? { slider: { axis: Math.random() < 0.5 ? "x" : "y", value: Math.random() } }
        : { action: "action" };
    default:
      return { tap: true };
  }
}

const budgets: Record<string, number> = {
  poker: 40000, snakes: 4000,
  darts: 6000, racing: 4000,
};

const report: string[] = [];
const perCount = new Map<number, { runs: number; failing: number }>();
let totalRuns = 0;
let failingRuns = 0;
let totalIssues = 0;

for (const gameId of gameIds) {
  const plugin = (await import(join(gamesDir, gameId, "server.ts"))).default;
  for (const n of playerCounts(plugin.manifest)) {
    totalRuns++;
    const countStats = perCount.get(n) ?? { runs: 0, failing: 0 };
    countStats.runs++;

    const issues: string[] = [];
    // A retired game may keep a deliberately negative score (knifethrow's -5
    // clash), so the non-negative score rule is scoped to enabled games.
    const checkNegativeScores = isGameEnabled(gameId);
    const players = mkPlayers(n);
    const inst = plugin.onStart(mkRoom(players, gameId), players);
    const budget = budgets[gameId] ?? 5000;
    let tick = 0;
    let finished = false;
    let lastPhase = phaseOf(inst);
    let phaseChangedAt = 0;
    const phaseSeq: string[] = [lastPhase];

    for (; tick < budget; tick++) {
      // Hostile inputs at fixed points, plus post-finish calls later.
      if (tick % 137 === 0) {
        for (const p of players) {
          for (const input of hostileInputs) {
            try {
              plugin.onInput(inst, p.id, input);
            } catch (e) {
              issues.push(`crash on hostile input ${JSON.stringify(input)}: ${(e as Error).message}`);
            }
          }
          // Unknown player id must not throw.
          try {
            plugin.onInput(inst, "ghost-player", { tap: true });
          } catch (e) {
            issues.push(`crash on unknown player: ${(e as Error).message}`);
          }
        }
      }

      try {
        const screen = plugin.screenState(inst);
        checkWire(`screen`, screen, issues);
        for (const bad of badNumbers(screen, "$", [], checkNegativeScores)) issues.push(`screen bad number ${bad}`);
      } catch (e) {
        issues.push(`screenState threw: ${(e as Error).message}`);
      }

      for (const p of players) {
        try {
          const cs = plugin.controllerState(inst, p.id);
          checkWire(`controller(${p.id})`, cs, issues);
          for (const bad of badNumbers(cs, "$", [], checkNegativeScores)) issues.push(`controller(${p.id}) bad number ${bad}`);
        } catch (e) {
          issues.push(`controllerState threw for ${p.id}: ${(e as Error).message}`);
        }
      }

      for (const p of players) {
        let cs: any = null;
        try {
          cs = plugin.controllerState(inst, p.id);
        } catch { /* already reported */ }
        if (!cs) continue;
        let input: unknown = null;
        try {
          input = driver(gameId, cs, p.id);
        } catch { /* ignore */ }
        if (input) {
          try {
            plugin.onInput(inst, p.id, input);
          } catch (e) {
            issues.push(`crash on driver input: ${(e as Error).message}`);
          }
        }
      }

      try {
        plugin.onTick(inst, 500);
      } catch (e) {
        issues.push(`onTick threw: ${(e as Error).message}`);
        break;
      }

      const phase = phaseOf(inst);
      if (phase !== lastPhase) {
        lastPhase = phase;
        phaseChangedAt = tick;
        phaseSeq.push(phase);
        if (phaseSeq.length > 16) phaseSeq.shift();
      }

      if (isFinished(inst)) {
        finished = true;
        break;
      }
    }

    // Post-finish safety.
    if (finished || isFinished(inst)) {
      for (const p of players) {
        try {
          plugin.onInput(inst, p.id, { tap: true });
          plugin.onTick(inst, 16);
          plugin.screenState(inst);
          plugin.controllerState(inst, p.id);
        } catch (e) {
          issues.push(`post-finish call threw: ${(e as Error).message}`);
        }
      }
    } else {
      const heldFor = budget - phaseChangedAt;
      issues.push(
        `did not finish within ${budget} ticks (last phase "${lastPhase}" held ${heldFor} ticks; phases seen: ${phaseSeq.join(" -> ")})`,
      );
    }

    const unique = [...new Set(issues)];
    if (unique.length) {
      countStats.failing++;
      failingRuns++;
      totalIssues += unique.length;
      report.push(`\n### ${gameId} (${n} players) — ${unique.length} issue(s)`);
      for (const u of unique) report.push(`  - ${u}`);
    } else {
      report.push(`${gameId} (${n}p): clean`);
    }
    perCount.set(n, countStats);
  }
}

console.log(report.join("\n"));

const countBreakdown = [...perCount.entries()]
  .sort(([a], [b]) => a - b)
  .map(([n, stats]) => `${n}p=${stats.runs}${stats.failing ? ` (${stats.failing} failing)` : ""}`)
  .join(", ");

console.log("");
console.log("PROBE SUMMARY");
console.log(`  mode: ${includeDisabled ? "all games (--all)" : "enabled games only (--all includes retired)"}`);
console.log(`  games probed: ${gameIds.length}`);
console.log(`  total runs: ${totalRuns}`);
console.log(`  player counts: ${countBreakdown || "none"}`);
console.log(`  clean runs: ${totalRuns - failingRuns}, failing runs: ${failingRuns}`);
console.log(`TOTAL ISSUES: ${totalIssues}`);

process.exitCode = totalIssues > 0 ? 1 : 0;
