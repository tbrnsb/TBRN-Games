/**
 * Phase 6 TV secret scanner — PLATFORM_EXPANSION_BRIEF section 7, item 4:
 * "every TV payload in every hidden phase contains no hole cards, roles,
 * secret words, lookalikes, chips or unrevealed answers."
 *
 * Scope: every game `shared/game-catalog.ts` marks enabled, driven through the
 * plugin API (no HTTP) at its plugin manifest's minimum and maximum player
 * count (deduped when equal), plus disabled `guesswho`, which the task's
 * table A lists explicitly. Each run ticks `onTick(instance, 500)` for up to
 * 4000 ticks, feeds each phone a deterministic input strategy adapted from
 * `tests/games-smoke.test.ts` (same per-game branches; a seeded LCG instead
 * of `Math.random`), and samples `screenState()` every tick while recording
 * every phase transition, so all phases are scanned.
 *
 * Two complementary scans per tick:
 *   A. value scan — each secret the game currently holds (hole-card arrays,
 *      the round word / lookalike / category / decoys, the fake prompt, the
 *      Stowaway category / decoys / clues, the Drawful prompt / bluffs, or a
 *      unique `TVSECRET-<game>-<player>-r<round>` sentinel a phone submitted)
 *      must not appear in the screen JSON while the phase is outside that
 *      secret's `publicPhases`.
 *   B. structural scan — field/key assertions that hold in every hidden
 *      phase (the `cards` key, `fakerName`, `realPrompt`, `question.correct`,
 *      `guess`, the vote tally, masked imposter sides, guesswho's personal
 *      board keys, ...).
 *
 * How false positives are avoided (documented per the task):
 *  - Sentinels are fixed strings, never `Math.random`, and game-derived
 *    secrets are read from `instance.state` / `controllerState()` at scan
 *    time, so a failure always names the actual generated value.
 *  - Content words (imposter word, lookalike, category, decoys, Stowaway
 *    category/decoys/clues, Blather target) are compared as *exact* JSON
 *    string values, never substrings: a longer clue containing "bank" cannot
 *    trip a scan for the word "bank", and a player-typed clue can never equal
 *    a content word because every typed value carries the TVSECRET prefix.
 *  - Phases where a game intentionally publishes a value are declared per
 *    secret in `publicPhases` with an inline reason (the anonymous ballot
 *    phases of the writing games, the live presentation in Slide Roulette,
 *    the reveal phases). Those declarations only relax the check in the one
 *    phase the design documents; every other phase stays fully asserted.
 *  - Even inside a declared public phase, `allowedPaths` keeps the exception
 *    narrow: the value may occur only at the exact screen path(s) the design
 *    documents (e.g. drawful's prompt only as an anonymous `options[].label`
 *    or the reveal-only `realPrompt`; the Stowaway decoys at no path at
 *    all). An occurrence anywhere else fails with the path in the message.
 *
 * Anti-vacuity (task section C): every run must reach >= 3 distinct screen
 * phases (guesswho declares its two), extract at least one real secret from
 * game state, observe each game's field proof (the reveal field must have
 * been non-null at least once), and — where the secret is meant to become
 * public — actually see it on screen in a public phase, proving the sentinel
 * path is real. The coverage-matrix test fails if an enabled game has no
 * entry, so a newly enabled game cannot silently skip the scanner.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_CATALOG } from "../shared/game-catalog.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = join(repoRoot, "games");

// --- Plugin plumbing (same shapes as tests/games-smoke.test.ts) ------------

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: Record<string, unknown>;
}

interface GamePlugin {
  manifest: { id: string; name: string; minPlayers: number; maxPlayers: number; controllerType: string };
  onStart(room: unknown, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  onHostAction?(instance: GameInstance, action: string): boolean;
}

async function loadPlugin(gameId: string): Promise<GamePlugin> {
  const mod = (await import(join(gamesDir, gameId, "server.ts"))) as { default: GamePlugin };
  return mod.default;
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Bot${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: Player[], gameId: string): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: "p0",
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

function manifestRange(gameId: string): { minPlayers: number; maxPlayers: number } {
  const raw = JSON.parse(readFileSync(join(gamesDir, gameId, "manifest.json"), "utf8")) as {
    minPlayers: number;
    maxPlayers: number;
  };
  return { minPlayers: raw.minPlayers, maxPlayers: raw.maxPlayers };
}

// --- Small helpers ----------------------------------------------------------

type StateRec = Record<string, unknown>;

function stateRec(instance: GameInstance): StateRec {
  return instance.state as StateRec;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function asRecord(value: unknown): StateRec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as StateRec)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Every object key in the screen tree, recursively. */
function keysOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const entry of node) keysOf(entry, out);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as StateRec)) {
      out.push(key);
      keysOf(value, out);
    }
  }
  return out;
}

interface PathString {
  path: string;
  value: string;
}

/** Every string value in the screen tree with its JSON path, recursively. */
function pathStringsOf(node: unknown, prefix: string, out: PathString[]): PathString[] {
  if (typeof node === "string") {
    out.push({ path: prefix, value: node });
  } else if (Array.isArray(node)) {
    node.forEach((entry, index) => pathStringsOf(entry, `${prefix}[${index}]`, out));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as StateRec)) {
      pathStringsOf(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/** Arrays in the screen tree whose every element is a `{ suit, rank }` card. */
function cardArraysOf(node: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(node)) {
    const cardShaped =
      node.length > 0 &&
      node.every(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          "suit" in (entry as StateRec) &&
          "rank" in (entry as StateRec),
      );
    if (cardShaped) out.push(node);
    for (const entry of node) cardArraysOf(entry, out);
  } else if (node !== null && typeof node === "object") {
    for (const value of Object.values(node as StateRec)) cardArraysOf(value, out);
  }
  return out;
}

/** Failure messages always carry the game id and the sampled phase. */
function at(gameId: string, phase: string, detail: string): string {
  return `${gameId} [phase=${phase}] ${detail}`;
}

function phaseOf(screen: StateRec, instance: GameInstance): string {
  const fromScreen = screen.phase;
  if (typeof fromScreen === "string" && fromScreen.length > 0) return fromScreen;
  const fromState = instance.state.phase;
  return typeof fromState === "string" && fromState.length > 0 ? fromState : "unknown";
}

/** Deterministic LCG so a failing run reproduces exactly; never used for secrets. */
function makeRng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return n > 0 ? s % n : 0;
  };
}

function seedFor(gameId: string, playerCount: number): number {
  let h = 2166136261;
  for (const char of `${gameId}:${playerCount}`) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Spec model -------------------------------------------------------------

interface Secret {
  /** Identity used in failure messages; never the secret contents. */
  label: string;
  /** The value that must stay off the TV (or the literal text to find). */
  value: string;
  /** Screen phases where this value is intentionally public (documented). */
  publicPhases: string[];
  /**
   * includes  = raw screen-JSON substring (unique sentinel tokens, full
   *             sentences that cannot be embedded in another value);
   * exact     = equality with one parsed screen string value (content words);
   * cardpair  = JSON equality with a `{suit, rank}` array on the screen.
   */
  match: "includes" | "exact" | "cardpair";
  /**
   * At a public phase every occurrence of the value must sit in one of these
   * screen paths (anchored regexes). This keeps the ballot-phase exceptions
   * narrow: the value is allowed only in the exact field(s) the design
   * documents (e.g. drawful's prompt only as an anonymous `options[].label`),
   * never anywhere else. Absent = any occurrence in a public phase is fine;
   * an empty array = the value must never appear, even in a public phase.
   */
  allowedPaths?: RegExp[];
}

interface TickCtx {
  gameId: string;
  phase: string;
  screen: StateRec;
  screenJson: string;
  instance: GameInstance;
  controllers: Map<string, Record<string, unknown>>;
}

interface FieldProof {
  label: string;
  test: (ctx: TickCtx) => boolean;
}

interface GameSpec {
  id: string;
  table: "A" | "B" | "no-secrets";
  /** Required for table "no-secrets": one line on why the game hides nothing. */
  reason?: string;
  /** True only for games scanned beyond the enabled catalog (guesswho). */
  extra?: boolean;
  /** When the game has fewer than three phases: every phase it can show. */
  allPhases?: string[];
  /** Current secrets of this game, read from state/controllers this tick. */
  secrets: (instance: GameInstance, controllers: Map<string, Record<string, unknown>>) => Secret[];
  /** Per-tick field/key assertions for every phase not listed otherwise. */
  structural?: (ctx: TickCtx) => void;
  /** Each must be observed true at least once during the run. */
  fieldProofs?: FieldProof[];
  /** Default true; false only for games with no value-shaped secret. */
  expectExtraction?: boolean;
  /** Require the secret itself to appear on screen in a public phase. */
  requirePublicSighting?: boolean;
}

const REVEAL_PHASES = ["reveal", "finished"];

// --- Input strategy (adapted from tests/games-smoke.test.ts) ---------------
//
// Same per-game branches as the proven smoke driver, with three changes:
//  1. text inputs carry a unique fixed sentinel instead of a generic string;
//  2. text/rank inputs are staggered across ticks so at least one submission
//     exists while the phase is still hidden (the scan window is real);
//  3. Math.random is replaced by a seeded LCG for reproducibility. Secrets
//     are never derived from the RNG.

interface RunState {
  gameId: string;
  instance: GameInstance;
  tick: number;
  rng: (n: number) => number;
  /** frankenanswers chip sequence per player: three chips per round. */
  chipSeq: Map<string, { round: number; n: number }>;
}

/** Fixed, per-player, per-round sentinel. Lengths fit every game's cap. */
function sentinel(gameId: string, playerId: string, round: number): string {
  // mindmeld caps answers at 20 chars and stowaway caps each clue word at 20.
  const short = gameId === "mindmeld" ? "meld" : gameId === "stowaway" ? "stow" : gameId;
  return `TVSECRET-${short}-${playerId}-r${round}`;
}

function roundOf(cs: StateRec, instance: GameInstance): number {
  if (typeof cs.round === "number") return cs.round;
  const s = stateRec(instance);
  if (typeof s.currentPrompt === "number") return s.currentPrompt + 1;
  if (typeof s.round === "number") return s.round + 1;
  return 1;
}

/** Stagger gate: each player attempts text input on a different tick. */
function staggered(run: RunState, playerIndex: number): boolean {
  return (run.tick + playerIndex) % 4 === 0;
}

function pickChoice(cs: StateRec, rng: (n: number) => number): unknown {
  const options = asArray(cs.options) as Array<{ id?: unknown }>;
  if (options.length === 0) return null;
  const option = options[rng(options.length)];
  return typeof option?.id === "string" ? { choice: option.id } : null;
}

function textInputFor(run: RunState, cs: StateRec, playerId: string, playerIndex: number): unknown {
  if (cs.hasSubmitted === true) return null;
  if (!staggered(run, playerIndex)) return null;
  const round = roundOf(cs, run.instance);
  const { gameId } = run;

  switch (gameId) {
    case "frankenanswers": {
      // `mode === "text"` is the chip phase: three distinct typed chips.
      let seq = run.chipSeq.get(playerId);
      if (!seq || seq.round !== round) {
        seq = { round, n: 0 };
        run.chipSeq.set(playerId, seq);
      }
      if (seq.n >= 3) return null;
      const chips = ["TVSECRET", `frk${playerId}`, `round${round}`];
      const chip = chips[seq.n] ?? chips[0];
      seq.n += 1;
      return { text: chip };
    }
    case "dumbinventions": {
      // Two-stage text: product name first, then the one-line pitch.
      const name = sentinel(gameId, playerId, round);
      if (cs.placeholder === "Product name") return { text: name };
      return { text: `${name} pitch` };
    }
    case "blather": {
      // The presenter's clue is public by design (the TV shows it as soon as
      // it is written) and is never scanned; guessers' guesses are secrets.
      if (cs.placeholder === "Describe it without naming it") {
        return { text: `TVSECRET-clue-${playerId}-r${round}` };
      }
      return { text: sentinel(gameId, playerId, round) };
    }
    default:
      return { text: sentinel(gameId, playerId, round) };
  }
}

function chooseInput(run: RunState, cs: StateRec, playerId: string, playerIndex: number): unknown {
  const { gameId, rng } = run;

  switch (gameId) {
    case "poker": {
      if (cs.yourTurn !== true) return null;
      if (cs.canCheck === true) {
        return { action: rng(10) < 7 ? "check" : "raise", amount: cs.minRaiseTo };
      }
      if (cs.canCall === true) {
        return { action: rng(10) < 7 ? "call" : "fold" };
      }
      if (cs.canRaise === true) return { action: "raise", amount: cs.minRaiseTo };
      return { action: "fold" };
    }
    case "quiz": {
      const question = asRecord(cs.question);
      if (!question || cs.hasAnswered === true) return null;
      const options = asArray(question.options) as Array<{ id?: unknown }>;
      if (options.length === 0) return null;
      const option = options[rng(options.length)];
      return typeof option?.id === "string" ? { choice: option.id } : null;
    }
    case "mostlikely": {
      if (cs.hasVoted === true || cs.phase !== "voting") return null;
      return pickChoice(cs, rng);
    }
    case "guesswho": {
      if (cs.yourTurn !== true) return null;
      const options = asArray(cs.options) as Array<{ id?: string }>;
      if (options.length === 0) return null;
      const guesses = options.filter((option) => option.id?.startsWith("g:"));
      const questions = options.filter((option) => option.id?.startsWith("q:"));
      const useGuess = guesses.length > 0 && rng(10) < 2;
      const pool = useGuess ? guesses : questions.length > 0 ? questions : options;
      const option = pool[rng(pool.length)];
      return typeof option?.id === "string" ? { choice: option.id } : null;
    }
    case "guessimposter": {
      if (cs.mode === "one-button" && cs.isYourTurn === true) return { action: "done" };
      if (cs.mode === "text" && cs.isYourTurn === true) return { text: "xyzzy" };
      if (cs.mode === "choice") return pickChoice(cs, rng);
      return null;
    }
    case "bluff":
    case "writevote": {
      if (cs.phase === "writing") {
        if (cs.hasSubmitted === true || !staggered(run, playerIndex)) return null;
        return { text: sentinel(gameId, playerId, roundOf(cs, run.instance)) };
      }
      if (cs.phase === "voting") {
        if (cs.hasVoted === true) return null;
        return pickChoice(cs, rng);
      }
      return null;
    }
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
    case "arena":
    case "slideroulette": {
      // These games switch controller UI per phase and report it as `mode`.
      if (cs.mode === "slider") {
        return rng(10) < 5
          ? { slider: { axis: "x", value: rng(100) / 100 } }
          : { action: "action" };
      }
      if (cs.mode === "canvas") {
        return rng(10) < 8
          ? { stroke: { points: [[0.2, 0.2], [0.6, 0.6], [0.8, 0.4]], color: "#111111" } }
          : { action: "action" };
      }
      if (cs.mode === "text") return textInputFor(run, cs, playerId, playerIndex);
      if (cs.mode === "aim") {
        const roll = rng(10);
        if (roll < 4) return { pad: { x: rng(200) / 100 - 1, y: rng(200) / 100 - 1 } };
        if (roll < 7) return { slider: { axis: "y", value: rng(100) / 100 } };
        return { action: "action" };
      }
      if (cs.mode === "rank") {
        // frankenanswers build: compose a valid answer (3-4 chips, <=2 links)
        // server-side, staggered so early answers exist during the build.
        if (cs.hasSubmitted === true || !staggered(run, playerIndex)) return null;
        const rank = asRecord(cs.rank);
        const items = asArray(rank?.items) as Array<{ id?: unknown }>;
        const chipIds = items
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string" && !id.startsWith("k:"))
          .slice(0, 3);
        if (chipIds.length < 3) return null;
        for (let i = chipIds.length - 1; i > 0; i--) {
          const j = rng(i + 1);
          const tmp = chipIds[i];
          chipIds[i] = chipIds[j];
          chipIds[j] = tmp;
        }
        return { rank: { order: chipIds } };
      }
      if (cs.mode === "choice") return pickChoice(cs, rng);
      return null;
    }
    case "racing":
      return { tap: true };
    default:
      // Archery and anything else: tap-driven, same as the smoke driver.
      return { tap: true };
  }
}

// --- Per-game specs ---------------------------------------------------------

/** Ballot/reveal phases where writing games show submitted text by design. */
const BALLOT_PUBLIC = ["voting", "reveal", "finished"];
/** Slogan Shirts calls its ballot phase "vote" rather than "voting". */
const SHIRT_BALLOT_PUBLIC = ["vote", "reveal", "finished"];

function playerIndexedSecrets(
  instance: GameInstance,
  pick: (state: StateRec, index: number) => unknown,
  label: (index: number, playerId: string) => string,
  publicPhases: string[],
  match: Secret["match"],
  allowedPaths?: RegExp[],
): Secret[] {
  const state = stateRec(instance);
  const out: Secret[] = [];
  instance.players.forEach((player, index) => {
    const value = asString(pick(state, index));
    if (value) out.push({ label: label(index, player.id), value, publicPhases, match, allowedPaths });
  });
  return out;
}

const SPECS: Record<string, GameSpec> = {
  // --- Table A: role / hidden-information games -----------------------------
  poker: {
    id: "poker",
    table: "A",
    secrets: (_instance, controllers) => {
      const out: Secret[] = [];
      for (const [playerId, cs] of controllers) {
        const cards = cs.cards;
        if (Array.isArray(cards) && cards.length > 0) {
          // Hole cards are never public: not even at showdown (hand names only).
          out.push({
            label: `hole cards of ${playerId}`,
            value: JSON.stringify(cards),
            publicPhases: [],
            match: "cardpair",
          });
        }
      }
      return out;
    },
    structural: (ctx) => {
      assert.ok(
        !keysOf(ctx.screen).includes("cards"),
        at(ctx.gameId, ctx.phase, 'screen tree must never contain the key "cards"'),
      );
    },
    fieldProofs: [
      {
        label: "a phone controller received hole cards",
        test: (ctx) =>
          [...ctx.controllers.values()].some(
            (cs) => Array.isArray(cs.cards) && cs.cards.length > 0,
          ),
      },
    ],
    // Hole cards have no public phase, so there is nothing to sight on TV.
    requirePublicSighting: false,
  },

  guesswho: {
    id: "guesswho",
    table: "A",
    extra: true, // disabled in the catalog; listed explicitly by the task
    // Only two phases exist (playing | finished), so both must be observed.
    allPhases: ["playing", "finished"],
    secrets: () => [],
    structural: (ctx) => {
      // The personal board (per-seat `marked` eliminations) and the secret
      // character must never reach the shared screen.
      for (const key of keysOf(ctx.screen)) {
        assert.ok(
          !["secret", "eliminated", "board"].includes(key),
          at(ctx.gameId, ctx.phase, `personal-board key "${key}" reached the TV screen`),
        );
      }
      for (const token of ['"secret"', '"eliminated"', '"board"']) {
        assert.ok(
          !ctx.screenJson.includes(token),
          at(ctx.gameId, ctx.phase, `screen JSON contains ${token}`),
        );
      }
    },
    expectExtraction: false,
    requirePublicSighting: false,
  },

  guessimposter: {
    id: "guessimposter",
    table: "A",
    secrets: (instance) => {
      const roles = asRecord(stateRec(instance).roles);
      const entry = asRecord(roles?.entry);
      const out: Secret[] = [];
      // The reveal payload is the only screen path that may carry them.
      const finalRevealPaths = [/^finalReveal(\.|$)/];
      const push = (label: string, raw: unknown) => {
        const value = asString(raw);
        // Exact string-value match: content words are short and could appear
        // inside a longer clue as a substring, which is not a leak.
        if (value) {
          out.push({ label, value, publicPhases: REVEAL_PHASES, match: "exact", allowedPaths: finalRevealPaths });
        }
      };
      push("round word", entry?.word);
      push("lookalike word", entry?.lookalike);
      push("category", entry?.category);
      asStringArray(entry?.decoys).forEach((decoy, index) => push(`decoy word ${index}`, decoy));
      // Role side labels identify the Imposter/Larper; they are only ever
      // public inside the final reveal payload.
      const sidePaths = [/^ejected\[\d+\]\.side$/, /^finalReveal(\.|$)/];
      out.push({ label: 'role side "imposter"', value: "imposter", publicPhases: REVEAL_PHASES, match: "exact", allowedPaths: sidePaths });
      out.push({ label: 'role side "larper"', value: "larper", publicPhases: REVEAL_PHASES, match: "exact", allowedPaths: sidePaths });
      return out;
    },
    structural: (ctx) => {
      if (ctx.phase === "reveal" || ctx.phase === "finished") return;
      assert.strictEqual(
        ctx.screen.finalReveal ?? null,
        null,
        at(ctx.gameId, ctx.phase, "finalReveal must be null before the reveal phase"),
      );
      for (const key of keysOf(ctx.screen)) {
        assert.ok(
          !/imposter|larper/i.test(key),
          at(ctx.gameId, ctx.phase, `role-identifying key "${key}" present before the reveal`),
        );
      }
      for (const entry of asArray(ctx.screen.ejected)) {
        const side = asRecord(entry)?.side;
        assert.ok(
          side === null || side === "crew",
          at(ctx.gameId, ctx.phase, `ejected seat side "${String(side)}" shown before the reveal`),
        );
      }
      const voteReveal = asRecord(ctx.screen.voteReveal);
      const side = asRecord(voteReveal?.ejected)?.side;
      if (side !== undefined && side !== null) {
        assert.strictEqual(
          side,
          "crew",
          at(ctx.gameId, ctx.phase, `vote-reveal ejected side "${String(side)}" shown before the reveal`),
        );
      }
    },
    fieldProofs: [
      {
        label: "finalReveal populated at the reveal",
        test: (ctx) => ctx.screen.finalReveal !== null && ctx.screen.finalReveal !== undefined,
      },
    ],
    requirePublicSighting: true,
  },

  fakin: {
    id: "fakin",
    table: "A",
    secrets: (instance) => {
      // The fake prompt is phone-only for the Faker in every phase, including
      // the reveal (the TV only ever shows the public real instruction).
      const value = asString(stateRec(instance).fakePrompt);
      return value ? [{ label: "fake prompt", value, publicPhases: [], match: "includes" }] : [];
    },
    structural: (ctx) => {
      if (ctx.phase === "reveal" || ctx.phase === "finished") return;
      assert.strictEqual(
        ctx.screen.fakerName ?? null,
        null,
        at(ctx.gameId, ctx.phase, "fakerName must be null before reveal/finished"),
      );
      assert.strictEqual(
        ctx.screen.reveal ?? null,
        null,
        at(ctx.gameId, ctx.phase, "reveal payload must be null before reveal/finished"),
      );
    },
    fieldProofs: [
      {
        label: "fakerName published at the reveal",
        test: (ctx) => typeof ctx.screen.fakerName === "string" && ctx.screen.fakerName.length > 0,
      },
    ],
    requirePublicSighting: false, // the fake prompt is never public
  },

  stowaway: {
    id: "stowaway",
    table: "A",
    secrets: (instance) => {
      const state = stateRec(instance);
      const out: Secret[] = [];
      const category = asString(state.category);
      // Exact-value matches: typed clues carry the TVSECRET prefix, and the
      // content categories are multi-word phrases no screen field emits
      // verbatim before the reveal.
      // The reveal's `category` field and the Stowaway's own category guess
      // are the only screen paths that may carry the real category.
      const categoryPaths = [/^category$/, /^reveal(\.|$)/];
      if (category) out.push({ label: "category", value: category, publicPhases: REVEAL_PHASES, match: "exact", allowedPaths: categoryPaths });
      // Decoy categories are never published at all: [] forbids every path.
      asStringArray(state.decoys).forEach((decoy, index) =>
        out.push({ label: `decoy category ${index}`, value: decoy, publicPhases: REVEAL_PHASES, match: "exact", allowedPaths: [] }),
      );
      asArray(state.clues).forEach((clue, index) => {
        const value = asString(clue);
        // Clues become public with the discussion ballot, never during the
        // private clue phase (stowaway: cluesArePublic()).
        if (value) {
          out.push({
            label: `clue of seat ${index}`,
            value,
            publicPhases: ["discussion", "vote", "reveal", "finished"],
            match: "exact",
            allowedPaths: [/^clues\[\d+\]\.clue$/, /^options\[\d+\]\.text$/],
          });
        }
      });
      return out;
    },
    structural: (ctx) => {
      if (ctx.phase === "reveal" || ctx.phase === "finished") return;
      // Regression guard: the game sets these screen fields to null today.
      assert.strictEqual(
        ctx.screen.stowawayName ?? null,
        null,
        at(ctx.gameId, ctx.phase, "stowawayName must be null before reveal/finished"),
      );
      assert.strictEqual(
        ctx.screen.category ?? null,
        null,
        at(ctx.gameId, ctx.phase, "category must be null before reveal/finished"),
      );
      assert.strictEqual(
        ctx.screen.reveal ?? null,
        null,
        at(ctx.gameId, ctx.phase, "reveal payload must be null before reveal/finished"),
      );
    },
    fieldProofs: [
      {
        label: "stowawayName published at the reveal",
        test: (ctx) => typeof ctx.screen.stowawayName === "string" && ctx.screen.stowawayName.length > 0,
      },
    ],
    requirePublicSighting: true,
  },

  drawful: {
    id: "drawful",
    table: "A",
    secrets: (instance) => {
      const state = stateRec(instance);
      const out: Secret[] = [];
      const prompt = asString(state.prompt);
      // The real prompt is absent until the ballot opens; at voting it is one
      // anonymous, unmarked option label (docs/DECISIONS.md "Drawful ballot
      // privacy"), and `screen.realPrompt` itself stays null until reveal.
      // Even at the ballot the value may live ONLY in the anonymous option
      // label (or the reveal-only `realPrompt` field) — never elsewhere.
      const ballotPaths = [/^options\[\d+\]\.label$/, /^realPrompt$/];
      if (prompt) out.push({ label: "real prompt", value: prompt, publicPhases: BALLOT_PUBLIC, match: "includes", allowedPaths: ballotPaths });
      asArray(state.bluffs).forEach((bluff, index) => {
        const value = asString(bluff);
        // Bluffs are absent from the TV until the vote opens (same decision).
        if (value) out.push({ label: `bluff of seat ${index}`, value, publicPhases: BALLOT_PUBLIC, match: "includes", allowedPaths: ballotPaths });
      });
      return out;
    },
    structural: (ctx) => {
      const revealed = ctx.phase === "reveal" || ctx.phase === "finished";
      if (!revealed) {
        assert.strictEqual(
          ctx.screen.realPrompt ?? null,
          null,
          at(ctx.gameId, ctx.phase, "realPrompt must be null until the reveal phase"),
        );
      }
      // Host-hidden drawings must withhold the strokes entirely.
      if (ctx.screen.drawingHidden === true) {
        assert.deepStrictEqual(
          ctx.screen.strokes,
          [],
          at(ctx.gameId, ctx.phase, "drawingHidden must withhold every stroke from the TV"),
        );
      }
    },
    fieldProofs: [
      {
        label: "realPrompt published at the reveal",
        test: (ctx) => typeof ctx.screen.realPrompt === "string" && ctx.screen.realPrompt.length > 0,
      },
      {
        label: "strokes visible on TV while the drawing is not hidden",
        test: (ctx) =>
          ctx.phase === "drawing" &&
          ctx.screen.drawingHidden === false &&
          Array.isArray(ctx.screen.strokes) &&
          (ctx.screen.strokes as unknown[]).length > 0,
      },
    ],
    requirePublicSighting: true,
  },

  // --- Table B: written/guessed answer games --------------------------------
  bluff: {
    id: "bluff",
    table: "B",
    secrets: (instance) => {
      const submissions = asRecord(stateRec(instance).submissions) ?? {};
      const out: Secret[] = [];
      for (const [playerId, raw] of Object.entries(submissions)) {
        const value = asString(raw);
        // Answers surface only in the reveal payload, never in the ballot.
        if (value) out.push({ label: `written answer of ${playerId}`, value, publicPhases: REVEAL_PHASES, match: "includes", allowedPaths: [/^answers\[\d+\]/] });
      }
      return out;
    },
    requirePublicSighting: true,
  },

  writevote: {
    id: "writevote",
    table: "B",
    secrets: (instance) => {
      const responses = asRecord(stateRec(instance).responses) ?? {};
      const out: Secret[] = [];
      for (const [playerId, raw] of Object.entries(responses)) {
        const value = asString(raw);
        if (value) out.push({ label: `written response of ${playerId}`, value, publicPhases: REVEAL_PHASES, match: "includes", allowedPaths: [/^responses\[\d+\]/] });
      }
      return out;
    },
    requirePublicSighting: true,
  },

  splitroom: {
    id: "splitroom",
    table: "B",
    secrets: (instance) => {
      const value = asString(stateRec(instance).submission);
      // The writer's fill becomes the public ballot subject from voting on:
      // voters must read it, and the writer's own controller says "Your
      // scenario is on the screen." It stays hidden during the writing phase
      // (the phase flips atomically on submit, so the hidden-phase scan there
      // is a structural guard).
      return value
        ? [{
            label: "writer submission",
            value,
            publicPhases: BALLOT_PUBLIC,
            match: "includes",
            allowedPaths: [/^filled$/, /^prompt$/],
          }]
        : [];
    },
    requirePublicSighting: true,
  },

  survive: {
    id: "survive",
    table: "B",
    secrets: (instance) => {
      // Answers (answering phase) and twists (twisting phase) reach the TV
      // only with the voting pairs — the screenState comment says so.
      const answers = playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.answers)[index],
        (index, playerId) => `answer of seat ${index} (${playerId})`,
        BALLOT_PUBLIC,
        "includes",
        [/^pairs\[\d+\]\.(headline|answer)$/],
      );
      const twists = playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.twists)[index],
        (index, playerId) => `twist of seat ${index} (${playerId})`,
        BALLOT_PUBLIC,
        "includes",
        [/^pairs\[\d+\]\.(headline|answer)$/],
      );
      return [...answers, ...twists];
    },
    requirePublicSighting: true,
  },

  frankenanswers: {
    id: "frankenanswers",
    table: "B",
    secrets: (instance) => {
      const state = stateRec(instance);
      const out: Secret[] = [];
      const publicPhases = ["vote", "reveal", "finished"];
      // The composed pitch is the secret (the task: not the pack chip words).
      // Typed chips carry the TVSECRET prefix, so scanning them can never
      // collide with pack content; they become public only inside the
      // composed ballot answers at the vote.
      for (const tile of asArray(state.tiles)) {
        const record = asRecord(tile);
        const text = asString(record?.text);
        const author = typeof record?.author === "number" ? record.author : -1;
        if (text && text.startsWith("TVSECRET") && author >= 0) {
          out.push({
            label: `typed chip of seat ${author}`,
            value: text,
            publicPhases,
            match: "includes",
            allowedPaths: [/^options\[\d+\]\.text$/, /^reveal(\.|$)/],
          });
        }
      }
      asArray(state.answers).forEach((answer, index) => {
        const value = asString(asRecord(answer)?.text);
        if (value) {
          out.push({
            label: `composed pitch of seat ${index}`,
            value,
            publicPhases,
            match: "includes",
            allowedPaths: [/^options\[\d+\]\.text$/, /^reveal(\.|$)/],
          });
        }
      });
      return out;
    },
    requirePublicSighting: true,
  },

  bracket: {
    id: "bracket",
    table: "B",
    secrets: (instance) =>
      // Entries are private while everyone writes; the built bracket shows
      // every entry as public duel text from the voting phase onward.
      playerIndexedSecrets(
        instance,
        (state, index) => asRecord(asArray(state.entries)[index])?.text,
        (index, playerId) => `bracket entry of seat ${index} (${playerId})`,
        BALLOT_PUBLIC,
        "includes",
        [/^duels\[\d+\]\.(a|b|winner)$/],
      ),
    requirePublicSighting: true,
  },

  dumbinventions: {
    id: "dumbinventions",
    table: "B",
    secrets: (instance) => {
      // Product names and pitches stay off the TV through invent AND vote
      // (docs/DECISIONS.md "Dumb Inventions privacy"); only the reveal shows
      // them. Names are capped at 30 chars: the sentinel fits with room.
      const inventionPaths = [/^inventions\[\d+\]/, /^options\[\d+\]/, /^reveal(\.|$)/];
      const names = playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.names)[index],
        (index, playerId) => `product name of seat ${index} (${playerId})`,
        REVEAL_PHASES,
        "includes",
        inventionPaths,
      );
      const pitches = playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.pitches)[index],
        (index, playerId) => `pitch of seat ${index} (${playerId})`,
        REVEAL_PHASES,
        "includes",
        inventionPaths,
      );
      return [...names, ...pitches];
    },
    requirePublicSighting: true,
  },

  mostlikely: {
    id: "mostlikely",
    table: "B",
    // No free text exists; the per-player vote targets are the secret.
    secrets: () => [],
    structural: (ctx) => {
      if (ctx.phase !== "voting" && ctx.phase !== "tally") return;
      assert.strictEqual(
        ctx.screen.votes ?? null,
        null,
        at(ctx.gameId, ctx.phase, "vote tally must stay off the TV before the reveal"),
      );
      assert.strictEqual(
        ctx.screen.roundWinner ?? null,
        null,
        at(ctx.gameId, ctx.phase, "roundWinner must be null before the reveal"),
      );
    },
    fieldProofs: [
      {
        label: "vote tally published at the reveal",
        test: (ctx) => Array.isArray(ctx.screen.votes),
      },
    ],
    expectExtraction: false,
    requirePublicSighting: false,
  },

  blather: {
    id: "blather",
    table: "B",
    secrets: (instance) => {
      const state = stateRec(instance);
      const out: Secret[] = [];
      const target = asString(state.target);
      // The target word is exact-matched (a guess could contain it as a
      // substring without being it); guesses are unique sentinels.
      if (target) {
        out.push({ label: "target word", value: target, publicPhases: REVEAL_PHASES, match: "exact", allowedPaths: [/^target$/] });
      }
      asArray(state.guesses).forEach((guess, index) => {
        const value = asString(guess);
        if (value) {
          out.push({ label: `guess of seat ${index}`, value, publicPhases: REVEAL_PHASES, match: "includes", allowedPaths: [/^guesses\[\d+\]\.guess$/] });
        }
      });
      return out;
    },
    requirePublicSighting: true,
  },

  slideroulette: {
    id: "slideroulette",
    table: "B",
    secrets: (instance) =>
      // Captions are hidden while writing; the live presentation shows the
      // current slide anonymously, and authors stay reveal-only.
      playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.submissions)[index],
        (index, playerId) => `caption of seat ${index} (${playerId})`,
        ["presenting", "rating", "reveal", "finished"],
        "includes",
        [/^slide$/, /^captions\[\d+\]\.text$/],
      ),
    requirePublicSighting: true,
  },

  sloganshirts: {
    id: "sloganshirts",
    table: "B",
    secrets: (instance) =>
      // Slogans appear on the TV only with the shirt ballot (phase name is
      // "vote"); authors stay reveal-only (screenState gates
      // `author`/`sloganAuthor`).
      playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.slogans)[index],
        (index, playerId) => `slogan of seat ${index} (${playerId})`,
        SHIRT_BALLOT_PUBLIC,
        "includes",
        [/^shirts\[\d+\]\.slogan$/, /^reveal(\.|$)/],
      ),
    requirePublicSighting: true,
  },

  quiz: {
    id: "quiz",
    table: "B",
    // Option ids are all public (they render the ballot); the secret is the
    // designated correct option, which is a field rather than a value.
    secrets: () => [],
    structural: (ctx) => {
      if (ctx.phase === "reveal" || ctx.phase === "finished") return;
      const question = asRecord(ctx.screen.question);
      assert.strictEqual(
        question?.correct ?? null,
        null,
        at(ctx.gameId, ctx.phase, "question.correct must be null before the reveal"),
      );
      assert.strictEqual(
        ctx.screen.distribution ?? null,
        null,
        at(ctx.gameId, ctx.phase, "answer distribution must be null before the reveal"),
      );
    },
    fieldProofs: [
      {
        label: "correct option published at the reveal",
        test: (ctx) => {
          const question = asRecord(ctx.screen.question);
          return question?.correct !== null && question?.correct !== undefined;
        },
      },
    ],
    expectExtraction: false,
    requirePublicSighting: false,
  },

  mindmeld: {
    id: "mindmeld",
    table: "B",
    secrets: (instance) =>
      // Answers are capped at 20 chars; the sentinel is 19 with the "meld"
      // short id, and the value is read back from state after the trim.
      playerIndexedSecrets(
        instance,
        (state, index) => asArray(state.answers)[index],
        (index, playerId) => `answer of seat ${index} (${playerId})`,
        REVEAL_PHASES,
        "includes",
        [/^answers\[\d+\]\.answer$/],
      ),
    requirePublicSighting: true,
  },

  percentile: {
    id: "percentile",
    table: "B",
    // The guess is a number, so it is asserted as a withheld field rather
    // than a string value (raw number scans would collide with timers).
    secrets: () => [],
    structural: (ctx) => {
      if (ctx.phase === "reveal" || ctx.phase === "finished") return;
      for (const key of ["guess", "actual", "delta", "source", "year", "reveal"] as const) {
        assert.strictEqual(
          ctx.screen[key] ?? null,
          null,
          at(ctx.gameId, ctx.phase, `screen.${key} must be null before the reveal`),
        );
      }
    },
    fieldProofs: [
      {
        label: "guess published at the reveal",
        test: (ctx) => ctx.screen.guess !== null && ctx.screen.guess !== undefined,
      },
    ],
    expectExtraction: false,
    requirePublicSighting: false,
  },

  // --- No-secrets allow-list -------------------------------------------------
  archery: {
    id: "archery",
    table: "no-secrets",
    reason: "Physical aim-and-shoot skill game: arrows, target, power and scores are all public by design.",
    secrets: () => [],
    expectExtraction: false,
    requirePublicSighting: false,
  },
  arena: {
    id: "arena",
    table: "no-secrets",
    reason: "Slingshot duel: pucks, aim, round wins and scores are public; no roles, cards or answers exist.",
    secrets: () => [],
    expectExtraction: false,
    requirePublicSighting: false,
  },
  racing: {
    id: "racing",
    table: "no-secrets",
    reason: "Tap race: lanes, progress, standings and scores are public; nothing private exists to leak.",
    secrets: () => [],
    expectExtraction: false,
    requirePublicSighting: false,
  },
};

// --- The scanner run --------------------------------------------------------

const TICK_BUDGET = 4000;
const TICK_MS = 500;

async function runScan(spec: GameSpec, playerCount: number): Promise<void> {
  const plugin = await loadPlugin(spec.id);
  assert.strictEqual(plugin.manifest.id, spec.id, `${spec.id}: plugin manifest id mismatch`);
  const players = makePlayers(playerCount);
  const instance = plugin.onStart(makeRoom(players, spec.id), players);
  const run: RunState = {
    gameId: spec.id,
    instance,
    tick: 0,
    rng: makeRng(seedFor(spec.id, playerCount)),
    chipSeq: new Map(),
  };

  const phases = new Set<string>();
  const proofsSeen = new Set<string>();
  let extracted = 0;
  let publicSighting = 0;

  for (let tick = 0; tick < TICK_BUDGET; tick++) {
    run.tick = tick;
    const screen = plugin.screenState(instance) as StateRec;
    const phase = phaseOf(screen, instance);
    phases.add(phase);
    const screenJson = JSON.stringify(screen) ?? "";
    assert.ok(screenJson.length > 2, at(spec.id, phase, "screen JSON is empty"));

    const controllers = new Map<string, Record<string, unknown>>();
    const inputs: Array<{ playerId: string; input: unknown }> = [];
    players.forEach((player, index) => {
      const cs = (plugin.controllerState(instance, player.id) ?? {}) as Record<string, unknown>;
      controllers.set(player.id, cs);
      const input = chooseInput(run, cs, player.id, index);
      if (input !== null && input !== undefined) inputs.push({ playerId: player.id, input });
    });

    const ctx: TickCtx = { gameId: spec.id, phase, screen, screenJson, instance, controllers };

    spec.structural?.(ctx);
    for (const proof of spec.fieldProofs ?? []) {
      if (proof.test(ctx)) proofsSeen.add(proof.label);
    }

    let pathStrings: PathString[] | null = null;
    for (const secret of spec.secrets(instance, controllers)) {
      extracted += 1;
      let found: boolean;
      let occurrences: string[] = [];
      if (secret.match === "cardpair") {
        // Array equality; hole cards have no public phase, so paths never apply.
        found = cardArraysOf(screen).some((cards) => JSON.stringify(cards) === secret.value);
      } else {
        pathStrings ??= pathStringsOf(screen, "", []);
        const hits = pathStrings.filter((entry) =>
          secret.match === "includes"
            ? entry.value.includes(secret.value)
            : entry.value === secret.value,
        );
        occurrences = hits.map((entry) => entry.path);
        found = hits.length > 0;
      }
      if (secret.publicPhases.includes(phase)) {
        if (found) publicSighting += 1;
        if (found && secret.allowedPaths) {
          for (const path of occurrences) {
            assert.ok(
              secret.allowedPaths.some((allowed) => allowed.test(path)),
              at(
                spec.id,
                phase,
                `secret "${secret.label}" appears at undocumented screen path "${path}" (allowed: ${secret.allowedPaths.map((re) => re.source).join(", ")})`,
              ),
            );
          }
        }
      } else {
        assert.ok(
          !found,
          at(
            spec.id,
            phase,
            `secret "${secret.label}" reached the TV screen at ${occurrences[0] ?? "(non-string location)"} (${secret.match} match)`,
          ),
        );
      }
    }

    for (const { playerId, input } of inputs) plugin.onInput(instance, playerId, input);
    plugin.onTick(instance, TICK_MS);

    if (phase === "finished" || screen.finished === true) break;
  }

  // --- Anti-vacuity (task section C) ---------------------------------------
  const phaseList = [...phases].join(",");
  if (spec.allPhases) {
    for (const declared of spec.allPhases) {
      assert.ok(
        phases.has(declared),
        at(spec.id, phaseList, `never reached its declared phase "${declared}"`),
      );
    }
  } else {
    assert.ok(
      phases.size >= 3,
      at(spec.id, phaseList, `reached only ${phases.size} distinct phases (need >= 3)`),
    );
  }
  if (spec.expectExtraction !== false) {
    assert.ok(
      extracted >= 1,
      at(spec.id, phaseList, "never extracted a secret from game state — the scan would be vacuous"),
    );
  }
  for (const proof of spec.fieldProofs ?? []) {
    assert.ok(
      proofsSeen.has(proof.label),
      at(spec.id, phaseList, `field proof "${proof.label}" never observed — reveal path not exercised`),
    );
  }
  if (spec.requirePublicSighting) {
    assert.ok(
      publicSighting >= 1,
      at(
        spec.id,
        phaseList,
        "the secret never appeared on screen in a public phase — the sentinel path is unproven",
      ),
    );
  }
}

// --- Tests ------------------------------------------------------------------

describe("tv secrets: coverage matrix", () => {
  test("every enabled catalog game is covered by table A, B or the no-secrets allow-list", () => {
    const enabled = Object.values(GAME_CATALOG)
      .filter((entry) => entry.enabled)
      .map((entry) => entry.id)
      .sort();
    const missing = enabled.filter((id) => !SPECS[id]);
    assert.deepStrictEqual(
      missing,
      [],
      `enabled games with no TV-secret spec: ${missing.join(", ")} — a newly enabled game must be added to table A, table B, or the no-secrets allow-list`,
    );

    for (const [id, spec] of Object.entries(SPECS)) {
      if (spec.table === "no-secrets") {
        assert.ok(
          (spec.reason ?? "").length >= 20,
          `${id}: no-secrets allow-list entry needs a one-line reason`,
        );
      } else {
        assert.ok(
          !spec.reason,
          `${id}: table ${spec.table} entries must not carry a no-secrets reason`,
        );
      }
      if (!spec.extra) {
        assert.ok(
          GAME_CATALOG[id]?.enabled === true,
          `${id}: has a scanner spec but the catalog does not enable it (flag it extra instead)`,
        );
      }
    }
    assert.strictEqual(
      SPECS.guesswho?.extra,
      true,
      "guesswho is disabled in the catalog; its spec must be flagged extra",
    );

    const tableA = Object.values(SPECS).filter((spec) => spec.table === "A").map((spec) => spec.id);
    const tableB = Object.values(SPECS).filter((spec) => spec.table === "B").map((spec) => spec.id);
    const noSecrets = Object.values(SPECS)
      .filter((spec) => spec.table === "no-secrets")
      .map((spec) => spec.id);
    assert.ok(tableA.length >= 6, `table A should cover the role games, found: ${tableA.join(",")}`);
    assert.ok(tableB.length >= 14, `table B should cover the answer games, found: ${tableB.join(",")}`);
    assert.deepStrictEqual(
      [...noSecrets].sort(),
      ["archery", "arena", "racing"],
      "the no-secrets allow-list must stay explicit",
    );
  });
});

describe("tv secrets: hidden-phase payload scans", () => {
  for (const spec of Object.values(SPECS)) {
    const { minPlayers, maxPlayers } = manifestRange(spec.id);
    const counts = minPlayers === maxPlayers ? [minPlayers] : [minPlayers, maxPlayers];
    for (const playerCount of counts) {
      test(`${spec.id} [table ${spec.table}] at ${playerCount} players`, async () => {
        await runScan(spec, playerCount);
      });
    }
  }
});

describe("tv secrets: host controls", () => {
  test("drawful: hide-drawing withholds strokes, show-drawing restores them", async () => {
    const plugin = await loadPlugin("drawful");
    const players = makePlayers(3);
    const instance = plugin.onStart(makeRoom(players, "drawful"), players);
    const hide = plugin.onHostAction;
    assert.strictEqual(typeof hide, "function", "drawful: onHostAction must exist for host controls");

    // The drawer draws; strokes are public while the drawing is not hidden.
    for (const player of players) {
      plugin.onInput(instance, player.id, {
        stroke: { points: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2]], color: "#111111" },
      });
    }
    const before = plugin.screenState(instance) as StateRec;
    assert.strictEqual(before.phase, "drawing", "drawful [phase=drawing]: expected the drawing phase");
    assert.strictEqual(before.drawingHidden, false, "drawful [phase=drawing]: drawing should start visible");
    assert.ok(
      Array.isArray(before.strokes) && (before.strokes as unknown[]).length > 0,
      "drawful [phase=drawing]: strokes must be public while drawingHidden is false",
    );

    hide?.(instance, "hide-drawing");
    const hidden = plugin.screenState(instance) as StateRec;
    assert.strictEqual(hidden.phase, "drawing", "drawful [phase=drawing]: host hide must not change the phase");
    assert.strictEqual(hidden.drawingHidden, true, "drawful [phase=drawing]: drawingHidden must flip to true");
    assert.deepStrictEqual(
      hidden.strokes,
      [],
      "drawful [phase=drawing]: hidden drawing must not send strokes to the TV",
    );

    hide?.(instance, "show-drawing");
    const shown = plugin.screenState(instance) as StateRec;
    assert.strictEqual(shown.drawingHidden, false, "drawful [phase=drawing]: show-drawing must restore visibility");
    assert.ok(
      Array.isArray(shown.strokes) && (shown.strokes as unknown[]).length > 0,
      "drawful [phase=drawing]: show-drawing must restore the strokes on the TV",
    );
  });
});
