/**
 * Round sanity bound across the player-count matrix — PLATFORM_EXPANSION_BRIEF
 * section 7, item 3: for each enabled game and each N in its valid range, one
 * player's maximum possible score in a single round stays at or below
 * `MAX_ROUND_SCORE` (1500, `shared/scoring.ts`), with written exceptions where
 * the human's decisions deliberately allow more.
 *
 * Design follows the fail-closed pattern of `tests/parity-34.test.ts` and
 * `tests/tv-secrets.test.ts`:
 *
 *  1. COVERAGE — every game `shared/game-catalog.ts` marks enabled (22 today)
 *     must have a CEILING entry and a DRIVEN entry. A newly enabled game fails
 *     the suite until it is classified.
 *  2. CEILING table — one `maxRoundGain(n)` per game, derived from that game's
 *     own scoring code; every entry cites its formula/payout constants and
 *     source lines. Entries use `scalePayout` from `shared/scoring.ts`
 *     wherever the production formula does, so the ceiling tracks f(N)
 *     exactly rather than a hand-copied number.
 *  3. BOUND — for every (game, N): `ceiling <= MAX_ROUND_SCORE`, or the pair
 *     sits in the EXCEPTIONS table with a >=20-char written reason (all of
 *     them human decisions recorded in docs/DECISIONS.md). A ceiling above
 *     the bound with no decision behind it fails and is reported as a
 *     FINDING — the assertion is never weakened. The constant
 *     `MAX_ROUND_SCORE === 1500` itself is asserted in tests/scoring.test.ts;
 *     this file only imports it.
 *  4. DRIVEN — every game drives a single round (worst case where the
 *     scenario can be steered to the ceiling; a representative round for the
 *     formula-only skill/card games — each drive says which) at its minimum
 *     and maximum valid N through `plugin.onInput` in standalone mode, and
 *     measures one player's round gain: `measured <= ceiling`, and
 *     `measured === ceiling` when the drive claims attainment. No full games
 *     are played; drives stop at the first scored round's reveal (poker stops
 *     at the first hand's `hand-end`). Inputs are fixed and deterministic —
 *     no `Math.random` anywhere in this file.
 *  5. ANTI-VACUITY — coverage in both directions, every exception carries a
 *     written reason AND still over-shoots the bound (no stale entries), and
 *     every driven round must actually score (`measured > 0`), so a drive
 *     that silently does nothing cannot pass.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import { MAX_ROUND_SCORE, scalePayout, withinRoundBound } from "../shared/scoring.ts";

const GAMES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "games");

// ---------------------------------------------------------------------------
// Plugin plumbing (same shapes as tests/tv-secrets.test.ts)
// ---------------------------------------------------------------------------

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface Instance {
  players: Player[];
  // Game states are read loosely here; every drive asserts its own numbers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any>;
}

interface Plugin {
  manifest: { id: string; minPlayers: number; maxPlayers: number };
  onStart(room: Record<string, unknown>, players: Player[], options?: Record<string, unknown>): Instance;
  onInput(instance: Instance, playerId: string, input: unknown): void;
  onTick(instance: Instance, deltaMs: number): void;
  screenState(instance: Instance): unknown;
  controllerState(instance: Instance, playerId: string): unknown;
}

type ModuleNs = { default: Plugin } & Record<string, unknown>;

const moduleCache = new Map<string, ModuleNs>();

async function loadModule(gameId: string): Promise<ModuleNs> {
  let mod = moduleCache.get(gameId);
  if (!mod) {
    mod = (await import(join(GAMES_DIR, gameId, "server.ts"))) as ModuleNs;
    moduleCache.set(gameId, mod);
  }
  return mod;
}

async function loadPlugin(gameId: string): Promise<Plugin> {
  return (await loadModule(gameId)).default;
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Bot ${i + 1}`,
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: Player[], gameId: string): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: players[0]?.id ?? null,
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

function zeros(count: number): number[] {
  return new Array<number>(count).fill(0);
}

/** Highest single-seat gain between two score snapshots. */
function maxGain(before: readonly number[], after: readonly number[]): number {
  let best = Number.NEGATIVE_INFINITY;
  after.forEach((score, index) => {
    const gain = score - (before[index] ?? 0);
    if (gain > best) best = gain;
  });
  return best;
}

function scoresOf(inst: Instance): number[] {
  const scores = inst.state.scores;
  assert.ok(Array.isArray(scores), "game state must expose a scores array");
  return scores as number[];
}

/** Tick until `phase`, failing with the phase actually seen. */
function advanceTo(plugin: Plugin, inst: Instance, phase: string, budget = 400): void {
  for (let i = 0; i < budget && inst.state.phase !== phase && inst.state.phase !== "finished"; i++) {
    plugin.onTick(inst, 2000);
  }
  assert.equal(
    inst.state.phase,
    phase,
    `expected phase "${phase}", saw "${String(inst.state.phase)}"`,
  );
}

// ---------------------------------------------------------------------------
// Ceiling table — maxRoundGain(n) per enabled game, derived from scoring code
// ---------------------------------------------------------------------------

const CEILINGS: Record<string, (n: number) => number> = {
  // bluff: 500 for voting the real answer + scalePayout(200, N) per fooled
  // vote on your own fake. Worst case: all N-1 other seats are fooled by one
  // author, who also finds the truth. games/bluff/server.ts:166-167
  // (POINTS_VOTE_REAL, POINTS_FOOL_BASE), scoreRound lines 246-270, self-
  // submission votes rejected at line 376.
  bluff: (n) => 500 + (n - 1) * scalePayout(200, n),

  // writevote: scalePayout(100, N) per vote on your response; at most N-1
  // other seats can vote for you (own response rejected, server.ts:316).
  // games/writevote/server.ts:124 (POINTS_PER_VOTE), scoreRound 238-253.
  writevote: (n) => (n - 1) * scalePayout(100, n),

  // splitroom: the writer's payout is round(1000 - |yes-no| * (1000/voters))
  // <= SPLIT_POINTS = 1000; the minority bonus is a fixed 150 to a voter who
  // is never also the writer. games/splitroom/server.ts:119, 121, settle
  // lines 208-226.
  splitroom: () => 1000,

  // survive: a player can hold the writer seat and the quoted seat at once.
  // One ballot per voter, so votes on your own headline plus votes on the
  // headline quoting you sum to at most N-1, maximised at (N-2) writer votes
  // plus 1 quoted vote. scalePayout(700/300, N) from five up, where the
  // round gain is also capped (games/survive/server.ts:121-122, 244-263).
  survive: (n) =>
    n < 5
      ? (n - 2) * 700 + 300
      : Math.min((n - 2) * scalePayout(700, n) + scalePayout(300, n), MAX_ROUND_SCORE),

  // frankenanswers: every vote pays scalePayout(1000, N) to the author; at
  // most N-1 seats can vote your answer (self-vote rejected, server.ts:398).
  // Chip credit (scalePayout(100, N) x up to 3 chips) goes to the chip
  // authors and can never stack on the vote maximum for the same player, so
  // votes decide. Cap from five players
  // (games/frankenanswers/server.ts:139-140, 296-324).
  frankenanswers: (n) =>
    n < 5 ? (n - 1) * 1000 : Math.min((n - 1) * scalePayout(1000, n), MAX_ROUND_SCORE),

  // bracket: 500 per non-final duel win, 1000 for the final, 100 per voter
  // who backed a winner (games/bracket/server.ts:148-150). At 3 the champion
  // is a participant of both duels and can never take voter points: 500+1000
  // = 1500. At 4 the champion also backs the parallel semi: 500+100+1000 =
  // 1600 (docs/DECISIONS.md "Bracket scoring"). From five the award() cap
  // binds (server.ts:305-318) — the uncapped path exceeds 1500, proven in
  // tests/bracket.test.ts "the 1500 cap binds only from five players".
  bracket: (n) => (n === 4 ? 1600 : MAX_ROUND_SCORE),

  // dumbinventions: scalePayout(1000, N) per vote, at most N-1 votes (own
  // pitch rejected, server.ts:323), uncapped at 3-4 per docs/DECISIONS.md
  // "Dumb Inventions cap", capped from five
  // (games/dumbinventions/server.ts:134, roundPoints 163-174).
  dumbinventions: (n) =>
    n < 5 ? (n - 1) * 1000 : Math.min((n - 1) * scalePayout(1000, n), MAX_ROUND_SCORE),

  // mostlikely: the top vote-getter takes max * POINTS_PER_VOTE and voting
  // for yourself is allowed, so all N votes can land on one seat.
  // games/mostlikely/server.ts:60, scoreRound 251-269.
  mostlikely: (n) => n * 10,

  // stowaway: fixed payouts only — an uncaught Stowaway takes 1000, a caught
  // one 500 for the category guess, a correct voter scalePayout(500, N) <=
  // 500; a seat is either the Stowaway or a voter, never both.
  // games/stowaway/server.ts:130-134, stowResolveVote 238-263.
  stowaway: () => 1000,

  // fakin: an uncaught Faker takes a fixed 500, a correct voter
  // scalePayout(200, N) <= 200; the Faker never votes, so the two cannot
  // stack. games/fakin/server.ts:128-130, fakinSettle 220-242.
  fakin: () => 500,

  // guessimposter: role payouts are fixed — Imposter survival 1000, Imposter
  // final-guess steal 700, Larper survival 600, crew survival 400, wrong
  // eject 200 — plus a correct-vote bonus of 100 per resolving ballot capped
  // at VOTE_BONUS_CAP = floor((1500 - 1000) / 100) = 5 per word, i.e. 500.
  // Survival 1000 + bonus 500 = 1500 is the worst seat (the cap is literally
  // derived from MAX_ROUND_SCORE). games/guessimposter/server.ts:164-176,
  // endWord 916-950.
  guessimposter: () => MAX_ROUND_SCORE,

  // blather: a correct guess pays max(100, 1000 - seconds*20) <= 1000 (one
  // guess per seat per round); the presenter gets min(600,
  // scalePayout(100,N) * correct) <= 600 and never guesses their own round.
  // games/blather/server.ts:120-125, guessScore 194-197, presenterScore
  // 203-208.
  blather: () => 1000,

  // slideroulette: the presenter gets round(200 * average stars) <= 1000
  // (perfect 5) and a caption author a flat 100 for their one caption; the
  // presenter writes no caption in a real round.
  // games/slideroulette/server.ts: slideSettle 219-233.
  slideroulette: () => 1000,

  // drawful: the artist takes scalePayout(500, N) per true-title vote from
  // the N-1 non-artists; a bluff author takes scalePayout(250, N) per vote,
  // at most N-2 (nobody votes their own lie). The artist maximum dominates:
  // (N-1) x scaled 500. games/drawful/server.ts:144-145, settle 253-288.
  drawful: (n) => (n - 1) * scalePayout(500, n),

  // sloganshirts: a top shirt (including every shirt in a top tie) pays each
  // of its two authors a fixed 1000; one player can author the design of one
  // shirt and the slogan of another, so an all-shirt tie pays 2000. Uncapped
  // at 3-4, capped from five (docs/DECISIONS.md "Slogan Shirts scoring and
  // cap"; games/sloganshirts/server.ts:139-140, scoreShirts 221-257).
  sloganshirts: (n) => (n <= 4 ? 2000 : MAX_ROUND_SCORE),

  // quiz: 1000 base + SPEED_BONUS_MAX 500 for a first/fast correct answer
  // (rank 0 at 3-4, full-window clock from five); fast mode pays at most
  // 1000. games/quiz/server.ts:188-212, scoreQuestion 324-359.
  quiz: () => MAX_ROUND_SCORE,

  // mindmeld: a full-table match pays every seat a fixed 1000 and ends the
  // game; per-match scalePayout(300, N) x (N-1) tops out at 903 (N=8) and
  // the N-1 early end pays a fixed 800.
  // games/mindmeld/server.ts:126-130, scoreRound 194-243.
  mindmeld: () => 1000,

  // percentile: the guesser takes at most EXACT_POINTS 1000 (the guesser
  // never bets); a bettor takes at most BET_POINTS 500 + BET_BONUS 200 =
  // 700. The two roles are exclusive in one round.
  // games/percentile/server.ts:129-139, guessPoints 236-241, betScore
  // 244-250, settle 311-328.
  percentile: () => 1000,

  // archery: one arrow per seat per round, proximity score at most 100 at
  // the centre. games/archery/server.ts:89-94 (archeryScore), shot scoring
  // at lines 206-208.
  archery: () => 100,

  // arena: one round win awards exactly +1 to the nearest puck's seat
  // (endRound fires once per round). games/arena/server.ts:248-259.
  arena: () => 1,

  // poker: chips are a cumulative stack, not round points — see EXCEPTIONS;
  // the theoretical max single-hand gain from a fresh table is
  // (N-1) * STARTING_CHIPS (STARTING_CHIPS = 1000, server.ts:156), because a
  // hand can collect every other seat's whole stack across main and side
  // pots (docs/DECISIONS.md "Poker elimination and ranking": raw = final
  // chips). Also an upper bound at all times: a hand's net gain is at most
  // min(winner's pre-hand stack, N*1000 - it) <= (N-1)*1000 for N >= 2.
  poker: (n) => (n - 1) * 1000,

  // racing: rank-only scoring — the per-race value is race progress, clamped
  // to 0..1 by progressOf (games/racing/server.ts:122-126; results() raw at
  // lines 310-312).
  racing: () => 1,
};

// ---------------------------------------------------------------------------
// Exception table — human-decided ceilings above MAX_ROUND_SCORE
// ---------------------------------------------------------------------------

function pokerExceptionReason(n: number): string {
  return (
    "Chips are a cumulative stack, not round points: games/poker/server.ts " +
    "STARTING_CHIPS=1000 (line 156) lets one hand collect up to " +
    `(N-1)*STARTING_CHIPS = ${(n - 1) * 1000} in main and side pots; ` +
    "docs/DECISIONS.md 'Poker elimination and ranking' scores raw = final chips."
  );
}

/**
 * `(game, N) -> written reason` for every pair whose derived ceiling exceeds
 * MAX_ROUND_SCORE. Fail closed in both directions: an over-bound pair with no
 * entry fails the bound test, and an entry whose ceiling no longer exceeds
 * the bound (or whose reason is missing/short, or whose N is outside the
 * game's range) fails the exception test. Every reason cites the decision.
 */
const EXCEPTIONS: Record<string, Record<number, string>> = {
  dumbinventions: {
    3: "docs/DECISIONS.md 'Dumb Inventions cap': 3-4 parity keeps the uncapped " +
      "per-vote total identical to the pre-change game — (N-1)*1000 = 2000 at " +
      "three players; the 1500 cap starts at five players.",
    4: "docs/DECISIONS.md 'Dumb Inventions cap': 3-4 parity keeps the uncapped " +
      "per-vote total identical to the pre-change game — (N-1)*1000 = 3000 at " +
      "four players; the 1500 cap starts at five players.",
  },
  frankenanswers: {
    3: "docs/DECISIONS.md 'Frankenanswers scoring': 3-4 parity beats the literal " +
      "bound — stacked votes pay 2000 at three players; the cap starts at N>=5.",
    4: "docs/DECISIONS.md 'Frankenanswers scoring': 3-4 parity beats the literal " +
      "bound — stacked votes pay 3000 at four players; the cap starts at N>=5.",
  },
  survive: {
    4: "docs/DECISIONS.md 'Survive scoring' amended: the round-gain cap binds " +
      "from five players only — a stacked 4-player writer+quoted round pays " +
      "(4-2)*700+300 = 1700 so pre-change 3-4 totals stay identical.",
  },
  bracket: {
    4: "docs/DECISIONS.md 'Bracket scoring': a 4-player semi winner who also " +
      "backs the parallel semi and wins the final earns 500+100+1000 = 1600, " +
      "uncapped at 3-4 for parity; the cap starts at five players.",
  },
  sloganshirts: {
    3: "docs/DECISIONS.md 'Slogan Shirts scoring and cap': an all-shirt tie pays " +
      "1000 to every tied shirt, so a design+slogan dual author takes 2000 at " +
      "3-4; the cap starts at five players.",
    4: "docs/DECISIONS.md 'Slogan Shirts scoring and cap': an all-shirt tie pays " +
      "1000 to every tied shirt, so a design+slogan dual author takes 2000 at " +
      "3-4; the cap starts at five players.",
  },
  poker: {
    3: pokerExceptionReason(3),
    4: pokerExceptionReason(4),
    5: pokerExceptionReason(5),
    6: pokerExceptionReason(6),
    7: pokerExceptionReason(7),
    8: pokerExceptionReason(8),
  },
};

// ---------------------------------------------------------------------------
// Driven verification — one adversarial (or representative) round per game
// ---------------------------------------------------------------------------

interface DriveResult {
  /** Highest single-round gain any one seat achieved in this drive. */
  measured: number;
  /**
   * Set only when the scenario is constructed to ATTAIN the ceiling; the test
   * then requires `measured === expect === ceiling`. Leave unset for the
   * representative drives (formula-verified ceilings).
   */
  expect?: number;
}

type Drive = (count: number) => Promise<DriveResult>;

/** Driven at the game's minimum and maximum valid N (deduped when equal). */
const DRIVEN: Record<string, Drive> = {
  // --- Voting games: stack every ballot on one author ----------------------

  // Worst case: every other seat is fooled by seat 0's answer (+scaled 200
  // each) and seat 0's own ballot finds the truth (+500). Attains ceiling.
  bluff: async (count) => {
    const plugin = await loadPlugin("bluff");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "bluff"), players);
    for (const player of players) {
      plugin.onInput(inst, player.id, { text: `fake answer from ${player.name}` });
    }
    assert.equal(inst.state.phase, "voting", `bluff ${count}p: all submissions open the ballot`);
    for (const player of players) {
      plugin.onInput(inst, player.id, { choice: player.id === "p0" ? "real" : "p0" });
    }
    assert.equal(inst.state.phase, "reveal", `bluff ${count}p: the last ballot settles the round`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 500 + (count - 1) * scalePayout(200, count) };
  },

  // Worst case: every other seat votes seat 0's response; seat 0's own vote
  // goes elsewhere (own response is rejected). Attains ceiling.
  writevote: async (count) => {
    const plugin = await loadPlugin("writevote");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "writevote"), players);
    for (const player of players) {
      plugin.onInput(inst, player.id, { text: `funniest line from ${player.name}` });
    }
    assert.equal(inst.state.phase, "voting", `writevote ${count}p: all responses open the ballot`);
    for (const player of players) {
      plugin.onInput(inst, player.id, { choice: player.id === "p0" ? "p1" : "p0" });
    }
    assert.equal(inst.state.phase, "reveal", `writevote ${count}p: the last ballot settles the round`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: (count - 1) * scalePayout(100, count) };
  },

  // Best possible writer: the ballot is split as evenly as the voter count
  // allows. With an even voter count (N odd) the split is perfect and the
  // writer takes exactly SPLIT_POINTS = 1000 = the ceiling; with an odd
  // count one forced vote sets |yes-no| = 1 and the writer lands just below,
  // so no attainment is claimed there.
  splitroom: async (count) => {
    const plugin = await loadPlugin("splitroom");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "splitroom"), players);
    const writer = inst.state.writer as number;
    plugin.onInput(inst, players[writer].id, { text: "airports: the carpet knows too much" });
    assert.equal(inst.state.phase, "voting", `splitroom ${count}p: the fill opens the ballot`);
    const voters = players.map((_, i) => i).filter((i) => i !== writer);
    const half = Math.floor(voters.length / 2);
    voters.forEach((seat, index) => {
      plugin.onInput(inst, players[seat].id, { choice: index < half ? "yes" : "no" });
    });
    assert.equal(inst.state.phase, "reveal", `splitroom ${count}p: the last vote settles the round`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return voters.length % 2 === 0 ? { measured, expect: 1000 } : { measured };
  },

  // Worst case: every eligible voter backs seat 0's headline; the one voter
  // barred from it (the quoted seat) backs the pairing that quotes seat 0,
  // so seat 0 stacks the writer payout (N-2 votes) plus one quoted vote.
  // Ballot closed on the timer, exactly like tests/survive.test.ts.
  survive: async (count) => {
    const plugin = await loadPlugin("survive");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "survive"), players);
    for (const player of players) plugin.onInput(inst, player.id, { text: `answer ${player.id}` });
    assert.equal(inst.state.phase, "twisting", `survive ${count}p: all answers submitted`);
    for (const player of players) plugin.onInput(inst, player.id, { text: `headline ${player.id}` });
    assert.equal(inst.state.phase, "voting", `survive ${count}p: all twists submitted`);

    const pairing = inst.state.pairing as number[];
    const focus = 0;
    const partner = pairing[focus];
    const quotingPairing = pairing.findIndex((author) => author === focus);
    assert.ok(
      partner !== undefined && quotingPairing >= 0,
      `survive ${count}p: pairing must be a derangement`,
    );
    for (let voter = 0; voter < count; voter++) {
      if (voter === focus) continue;
      const target = voter === partner ? quotingPairing : focus;
      plugin.onInput(inst, players[voter].id, { choice: `t:${target}` });
    }
    inst.state.timerMs = 0;
    plugin.onTick(inst, 500);
    assert.equal(inst.state.phase, "reveal", `survive ${count}p: the expired ballot settles the round`);

    const uncapped = (count - 2) * scalePayout(700, count) + scalePayout(300, count);
    const expect = count >= 5 ? Math.min(uncapped, MAX_ROUND_SCORE) : uncapped;
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect };
  },

  // Worst case: every other seat votes seat 0's answer (self-votes are
  // rejected), which borrows seat 1's chips — seat 0 takes the full stacked
  // vote total, capped from five players. Ballot closed on the timer.
  frankenanswers: async (count) => {
    const plugin = await loadPlugin("frankenanswers");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "frankenanswers"), players);
    for (const player of players) {
      for (let k = 0; k < 3; k++) plugin.onInput(inst, player.id, { text: `chip-${player.id}-${k}` });
    }
    assert.equal(inst.state.phase, "build", `frankenanswers ${count}p: chips submitted`);
    // Seat 0 borrows seat 1's three chips (dealPools always seats them).
    plugin.onInput(inst, "p0", { rank: { order: ["c:1:0", "c:1:1", "c:1:2"] } });
    for (let seat = 1; seat < count; seat++) {
      const controller = plugin.controllerState(inst, players[seat].id) as {
        rank?: { items?: Array<{ id: string }> };
      };
      const order = (controller.rank?.items ?? [])
        .map((item) => item.id)
        .filter((id) => !id.startsWith("k:"))
        .slice(0, 3);
      assert.equal(order.length, 3, `frankenanswers ${count}p: seat ${seat} pool must offer 3 chips`);
      plugin.onInput(inst, players[seat].id, { rank: { order } });
    }
    assert.equal(inst.state.phase, "vote", `frankenanswers ${count}p: every answer built`);
    for (let voter = 1; voter < count; voter++) {
      plugin.onInput(inst, players[voter].id, { choice: "a0" });
    }
    inst.state.timerMs = 0;
    plugin.onTick(inst, 500);
    assert.equal(inst.state.phase, "reveal", `frankenanswers ${count}p: the ballot closed`);

    const uncapped = (count - 1) * 1000;
    const expect =
      count < 5 ? uncapped : Math.min((count - 1) * scalePayout(1000, count), MAX_ROUND_SCORE);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect };
  },

  // Worst case: steer one champion through every duel — the champion wins
  // each duel they enter and, in parallel duels, backs the winner for the
  // 100-voter points. 3p = 500+1000, 4p = 500+100+1000, 5-6p the award()
  // cap binds (uncapped path proven above 1500 in tests/bracket.test.ts).
  bracket: async (count) => {
    const plugin = await loadPlugin("bracket");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "bracket"), players);
    const state = inst.state;
    const authorOf = (entry: number): number =>
      entry >= 0 ? ((state.entries[entry]?.author as number) ?? -1) : -1;
    const resolvedSides = (index: number): { a: number; b: number } => {
      const resolve = (slot: number): number =>
        slot >= 0 ? slot : ((state.duels[-slot - 1]?.winner as number) ?? -1);
      const duel = state.duels[index];
      return { a: resolve(duel.a), b: resolve(duel.b) };
    };

    for (const player of players) plugin.onInput(inst, player.id, { text: `answer from ${player.id}` });
    assert.equal(state.phase, "voting", `bracket ${count}p: all entries start the bracket`);

    const champion = authorOf(resolvedSides(0).a);
    assert.ok(champion >= 0, `bracket ${count}p: the first duel must have an author`);
    let guard = 0;
    while (state.phase === "voting" && guard++ < 60) {
      const index = state.current as number;
      const sides = resolvedSides(index);
      const aAuthor = authorOf(sides.a);
      const bAuthor = authorOf(sides.b);
      const side = aAuthor === champion ? "a" : bAuthor === champion ? "b" : "a";
      const duel = state.duels[index];
      for (let seat = 0; seat < count; seat++) {
        if (seat === aAuthor || seat === bAuthor) continue;
        if (duel.votes[seat] !== null) continue;
        plugin.onInput(inst, players[seat].id, { choice: side });
      }
    }
    assert.equal(state.phase, "reveal", `bracket ${count}p: the bracket settles in a reveal`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: count === 4 ? 1600 : MAX_ROUND_SCORE };
  },

  // Worst case: every other seat stacks their vote on seat 0's invention
  // (own pitch rejected), seat 0's vote goes elsewhere; uncapped at 3-4,
  // capped from five. Attains ceiling.
  dumbinventions: async (count) => {
    const plugin = await loadPlugin("dumbinventions");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "dumbinventions"), players);
    for (const player of players) {
      const seat = Number(player.id.slice(1));
      plugin.onInput(inst, player.id, { text: `Gadget ${seat}` });
      plugin.onInput(inst, player.id, { text: `It does nothing at all, seat ${seat}.` });
    }
    assert.equal(inst.state.phase, "vote", `dumbinventions ${count}p: every pitch submitted`);
    for (const player of players) {
      const seat = Number(player.id.slice(1));
      plugin.onInput(inst, player.id, { choice: `p:${seat === 0 ? 1 : 0}` });
    }
    assert.equal(inst.state.phase, "reveal", `dumbinventions ${count}p: the stacked ballot settles`);
    const uncapped = (count - 1) * 1000;
    const expect =
      count < 5 ? uncapped : Math.min((count - 1) * scalePayout(1000, count), MAX_ROUND_SCORE);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect };
  },

  // Worst case: every seat (self-votes allowed) piles onto seat 0, so the
  // winner's top count is N and the payout is N * 10. Attains ceiling.
  mostlikely: async (count) => {
    const plugin = await loadPlugin("mostlikely");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "mostlikely"), players);
    assert.equal(inst.state.phase, "voting", `mostlikely ${count}p: a round starts in voting`);
    for (const player of players) plugin.onInput(inst, player.id, { choice: "0" });
    assert.equal(inst.state.phase, "tally", `mostlikely ${count}p: the last ballot closes the tally`);
    advanceTo(plugin, inst, "reveal");
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: count * 10 };
  },

  // --- Deduction games: force the fixed maximum payout ---------------------

  // Worst case: a split ballot nobody can resolve, so the Stowaway escapes
  // for the fixed 1000 (the caught path pays only 500). Attains ceiling.
  stowaway: async (count) => {
    const plugin = await loadPlugin("stowaway");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "stowaway"), players);
    advanceTo(plugin, inst, "clue");
    for (const player of players) plugin.onInput(inst, player.id, { text: "salt water" });
    assert.equal(inst.state.phase, "discussion", `stowaway ${count}p: all clues submitted`);
    advanceTo(plugin, inst, "vote");
    const stow = inst.state.stowaway as number;
    const innocents = players.map((_, i) => i).filter((i) => i !== stow);
    const target = innocents[0];
    const fallback = innocents[1];
    for (const voter of innocents) {
      const choice = voter === target ? fallback : target;
      plugin.onInput(inst, players[voter].id, { choice: `p:${choice}` });
    }
    // String() keeps the earlier assert.equal("discussion") narrowing out of
    // this runtime re-check (the ballot may already have closed).
    const phaseAfterBallot = String(inst.state.phase);
    if (phaseAfterBallot === "vote") {
      inst.state.timerMs = 0;
      plugin.onTick(inst, 500);
    }
    assert.equal(inst.state.phase, "reveal", `stowaway ${count}p: the split ballot settles the round`);
    assert.equal(inst.state.reveal?.caught, false, `stowaway ${count}p: a tie never catches them`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 1000 };
  },

  // Worst case: a split ballot the Faker escapes with the fixed 500 (the
  // caught path pays voters only 200 each). Attains ceiling.
  fakin: async (count) => {
    const plugin = await loadPlugin("fakin");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "fakin"), players);
    advanceTo(plugin, inst, "voting");
    const faker = inst.state.faker as number;
    const innocents = players.map((_, i) => i).filter((i) => i !== faker);
    const target = innocents[0];
    const fallback = innocents[1];
    for (const voter of innocents) {
      const choice = voter === target ? fallback : target;
      plugin.onInput(inst, players[voter].id, { choice: `p:${choice}` });
    }
    assert.equal(inst.state.phase, "reveal", `fakin ${count}p: the split ballot settles the round`);
    assert.equal(inst.state.reveal?.caught, false, `fakin ${count}p: a tie never catches the Faker`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 500 };
  },

  // Representative worst case (ceiling is formula-verified): the crew spends
  // every ballot on ejections until the N-1 attempt cap ends the word with
  // the Imposter surviving (DECISIONS "Guess the Imposter vote bonus cap"
  // derives VOTE_BONUS_CAP from MAX_ROUND_SCORE, so role payout 1000 + bonus
  // 500 can never exceed 1500).
  guessimposter: async (count) => {
    const plugin = await loadPlugin("guessimposter");
    const mod = await loadModule("guessimposter");
    const voteRevealMs = Number(mod.VOTE_REVEAL_MS ?? 6100);
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "guessimposter"), players, { rounds: 1 });
    const state = inst.state;

    const tickExact = (ms: number): void => {
      let left = Math.max(0, Math.floor(ms));
      let guard = 0;
      while (left > 0 && guard++ < 2000) {
        const step = Math.min(2000, left);
        plugin.onTick(inst, step);
        left -= step;
      }
    };
    const tickUntil = (phase: string, budget = 400): void => {
      for (
        let i = 0;
        i < budget && state.phase !== phase && state.phase !== "reveal" && state.phase !== "finished";
        i++
      ) {
        plugin.onTick(inst, 2000);
      }
    };
    const liveSeats = (): number[] =>
      (state.active as boolean[])
        .map((_, seat) => seat)
        .filter((seat) => state.active[seat] && !state.removed[seat]);
    const voteOut = (target: number): void => {
      for (const seat of liveSeats()) {
        const pick = seat === target ? liveSeats().find((other) => other !== seat) : target;
        if (pick === undefined) continue;
        plugin.onInput(inst, players[seat].id, { choice: `p:${pick}` });
      }
      if (state.phase === "vote") tickExact(20100);
    };
    const completeClueTurn = (): void => {
      const seat = (state.order as number[])[state.turnIndex as number];
      if (seat === undefined) return;
      const input = state.settings.clueMode === "typed" ? { text: "hint" } : { action: "done" };
      plugin.onInput(inst, players[seat].id, input);
    };
    const finishClues = (): void => {
      for (let guard = 0; guard < 500 && state.phase === "clue"; guard++) completeClueTurn();
    };
    const resolveFinalGuessWrong = (): void => {
      const guess = state.finalGuess;
      if (!guess || guess.resolved) return;
      const word = state.roles.entry.word as string;
      const index = (guess.options as string[]).findIndex((option) => option !== word);
      assert.ok(index >= 0, "the final guess must offer a wrong option");
      plugin.onInput(inst, players[guess.seat].id, { choice: `o:${index}` });
    };

    // Survival strategy: every ballot ejects a crew member, never the
    // Imposter — the worst case for one player's round gain.
    let guard = 0;
    while (state.phase !== "reveal" && state.phase !== "finished" && guard++ < 120) {
      switch (state.phase) {
        case "countdown":
        case "peek":
          tickUntil("clue");
          break;
        case "clue":
          finishClues();
          break;
        case "discussion":
          tickUntil("vote");
          break;
        case "vote": {
          const crew = liveSeats().find(
            (seat) => !(state.roles.imposters as number[]).includes(seat),
          );
          if (crew !== undefined) voteOut(crew);
          else tickExact(20100);
          break;
        }
        case "voteReveal":
          tickExact(voteRevealMs + 100);
          break;
        case "finalGuess":
          resolveFinalGuessWrong();
          break;
        default:
          plugin.onTick(inst, 2000);
          break;
      }
    }
    assert.ok(
      state.phase === "reveal" || state.phase === "finished",
      `guessimposter ${count}p: the word must end (phase "${String(state.phase)}")`,
    );
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured };
  },

  // Worst case: every non-presenter answers the target instantly, so each
  // guesser takes guessScore(0) = 1000 (the speed decay never applies) —
  // above the presenter's capped 600. Attains ceiling.
  blather: async (count) => {
    const plugin = await loadPlugin("blather");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "blather"), players);
    advanceTo(plugin, inst, "clue");
    const presenter = inst.state.presenter as number;
    plugin.onInput(inst, players[presenter].id, { text: "a common thing you see outside" });
    assert.equal(inst.state.phase, "guessing", `blather ${count}p: the clue opens guessing`);
    const target = inst.state.target as string;
    for (let seat = 0; seat < count; seat++) {
      if (seat === presenter) continue;
      plugin.onInput(inst, players[seat].id, { text: target });
    }
    assert.equal(inst.state.phase, "reveal", `blather ${count}p: the last guess settles the round`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 1000 };
  },

  // Worst case: every non-presenter rates five stars, so the presenter takes
  // round(200 * 5) = 1000 — caption authors only get 100 each.
  // Attains ceiling.
  slideroulette: async (count) => {
    const plugin = await loadPlugin("slideroulette");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "slideroulette"), players);
    const presenter = inst.state.presenter as number;
    assert.equal(inst.state.phase, "writing", `slideroulette ${count}p: the round starts in writing`);
    for (let seat = 0; seat < count; seat++) {
      if (seat === presenter) continue;
      plugin.onInput(inst, players[seat].id, { text: `caption from seat ${seat}` });
    }
    assert.equal(inst.state.phase, "presenting", `slideroulette ${count}p: every caption submitted`);
    const deckLength = (inst.state.deck as unknown[]).length;
    for (let i = 0; i < deckLength; i++) {
      plugin.onInput(inst, players[presenter].id, { choice: "next" });
    }
    assert.equal(inst.state.phase, "rating", `slideroulette ${count}p: the deck is presented`);
    for (let seat = 0; seat < count; seat++) {
      if (seat === presenter) continue;
      plugin.onInput(inst, players[seat].id, { choice: "5" });
    }
    assert.equal(inst.state.phase, "reveal", `slideroulette ${count}p: the last rating settles it`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 1000 };
  },

  // Worst case: the artist collects every non-artist's true-title vote
  // ((N-1) x scalePayout(500, N)); a bluff author can never reach that.
  // Attains ceiling.
  drawful: async (count) => {
    const plugin = await loadPlugin("drawful");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "drawful"), players);
    const artist = inst.state.drawer as number;
    plugin.onInput(inst, players[artist].id, {
      stroke: { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111111" },
    });
    plugin.onInput(inst, players[artist].id, { action: "action" });
    assert.equal(inst.state.phase, "bluffing", `drawful ${count}p: the drawing is submitted`);
    for (let seat = 0; seat < count; seat++) {
      if (seat === artist) continue;
      plugin.onInput(inst, players[seat].id, { text: `Bluff from seat ${seat}` });
    }
    assert.equal(inst.state.phase, "voting", `drawful ${count}p: every bluff submitted`);
    const order = inst.state.order as string[];
    const idForRef = (seat: number, ref: string): string => {
      const entry = order
        .map((candidate, index) => ({ id: `o${index}`, ref: candidate }))
        .filter((candidate) => candidate.ref !== `b:${seat}`)
        .find((candidate) => candidate.ref === ref);
      assert.ok(entry, `drawful seat ${seat} should see ${ref}`);
      return entry.id;
    };
    for (let seat = 0; seat < count; seat++) {
      if (seat === artist) continue;
      plugin.onInput(inst, players[seat].id, { choice: idForRef(seat, "real") });
    }
    assert.equal(inst.state.phase, "reveal", `drawful ${count}p: the last vote settles the drawing`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: (count - 1) * scalePayout(500, count) };
  },

  // Worst case: every shirt ties at one vote each, so every shirt pays its
  // two authors 1000 — a design+slogan dual author takes 2000 uncapped at
  // 3-4, clamped to 1500 from five. Attains ceiling.
  sloganshirts: async (count) => {
    const plugin = await loadPlugin("sloganshirts");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "sloganshirts"), players);
    for (const seat of inst.state.designers as number[]) {
      plugin.onInput(inst, players[seat].id, { action: "action" });
    }
    assert.equal(inst.state.phase, "slogan", `sloganshirts ${count}p: every design submitted`);
    for (const player of players) plugin.onInput(inst, player.id, { text: `slogan ${player.id}` });
    assert.equal(inst.state.phase, "vote", `sloganshirts ${count}p: every slogan submitted`);
    // Seat i backs shirt (i+1): never their own design, and every shirt
    // collects exactly one vote — an all-shirt tie.
    for (let seat = 0; seat < count; seat++) {
      plugin.onInput(inst, players[seat].id, { choice: `s:${(seat + 1) % count}` });
    }
    assert.equal(inst.state.phase, "reveal", `sloganshirts ${count}p: the tie settles the round`);
    const expect = count <= 4 ? 2000 : MAX_ROUND_SCORE;
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect };
  },

  // Worst case: seat 0 answers first, taking rank 0 at 3-4 (1000 + 500) or
  // the full-window clock bonus from five (1000 + round(500 * remaining /
  // window) = 1500 with zero elapsed). Attains ceiling.
  quiz: async (count) => {
    const plugin = await loadPlugin("quiz");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "quiz"), players);
    if (inst.state.phase === "waiting") plugin.onTick(inst, 0);
    assert.equal(inst.state.phase, "question", `quiz ${count}p: question one started`);
    players.forEach((player, rank) => {
      if (rank > 0) plugin.onTick(inst, 1000); // stagger the answer times
      const question = inst.state.questions[inst.state.currentQuestion];
      plugin.onInput(inst, player.id, { choice: question.correct });
    });
    plugin.onTick(inst, (inst.state.timeLeft as number) + 1);
    assert.equal(inst.state.phase, "reveal", `quiz ${count}p: the deadline closes the question`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: MAX_ROUND_SCORE };
  },

  // Worst case: the whole table melds one identical answer — the fixed 1000
  // jackpot (the N-1 early end pays only 800). Attains ceiling.
  mindmeld: async (count) => {
    const plugin = await loadPlugin("mindmeld");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "mindmeld"), players);
    for (const player of players) plugin.onInput(inst, player.id, { text: "Banana" });
    assert.equal(inst.state.phase, "reveal", `mindmeld ${count}p: a full match opens the reveal`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 1000 };
  },

  // Worst case for one seat: the guesser hits the exact value for 1000 (the
  // guesser never bets); an exact guess has no direction, so bettors score
  // 0 — the 700 maximum bet belongs to a different seat. Attains ceiling.
  percentile: async (count) => {
    const plugin = await loadPlugin("percentile");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "percentile"), players);
    assert.equal(inst.state.phase, "guessing", `percentile ${count}p: the round starts guessing`);
    const guesser = inst.state.guesser as number;
    const prompts = inst.state.prompts as Array<{ value: number }>;
    const actual = prompts[(inst.state.round as number) % prompts.length].value;
    plugin.onInput(inst, players[guesser].id, { slider: { value: actual / 100 } });
    plugin.onInput(inst, players[guesser].id, { action: "action" });
    assert.equal(inst.state.phase, "betting", `percentile ${count}p: the guess opens betting`);
    for (let seat = 0; seat < count; seat++) {
      if (seat === guesser) continue;
      plugin.onInput(inst, players[seat].id, { choice: "higher" });
    }
    assert.equal(inst.state.phase, "reveal", `percentile ${count}p: the last bet settles the round`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 1000 };
  },

  // --- Skill games: representative rounds with formula ceilings -------------

  // Representative + formula: land one arrow dead centre (the pattern from
  // tests/archery.test.ts) — archeryScore(0, 0) is the documented 100
  // maximum, one arrow per seat per round. Attains ceiling.
  archery: async (count) => {
    const plugin = await loadPlugin("archery");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "archery"), players);
    const state = inst.state;
    assert.equal(state.phase, "aiming", `archery ${count}p: the round starts in aiming`);
    // Drop an arrow straight onto the target centre so the shot is exact.
    state.currentPlayer = 0;
    state.phase = "flying";
    state.isDrawing = false;
    state.drawPower = 0;
    state.arrowX = 0;
    state.arrowY = 0.001;
    state.arrowVX = 0;
    state.arrowVY = -1;
    state.targetX = 0;
    state.targetSpeed = 0;
    plugin.onTick(inst, 16);
    const shot = state.shots[state.shots.length - 1];
    assert.ok(shot, `archery ${count}p: the landing tick must record a shot`);
    assert.equal(shot.score, 100, `archery ${count}p: a centred arrow scores the 100 maximum`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 100 };
  },

  // Representative + formula: pin seat 0's puck at the centre and let the
  // round clock call nearest-to-centre — endRound awards exactly one round
  // win, the documented arena maximum. Attains ceiling.
  arena: async (count) => {
    const plugin = await loadPlugin("arena");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "arena"), players);
    const state = inst.state;
    assert.equal(state.phase, "aiming", `arena ${count}p: the match starts in aiming`);
    state.pucks[0].x = 0;
    state.pucks[0].y = 0;
    state.pucks[0].vx = 0;
    state.pucks[0].vy = 0;
    state.pucks[0].alive = true;
    for (let seat = 1; seat < count; seat++) {
      state.pucks[seat].x = 0.6;
      state.pucks[seat].y = 0.6;
      state.pucks[seat].vx = 0;
      state.pucks[seat].vy = 0;
      state.pucks[seat].alive = true;
    }
    state.timerMs = 1;
    plugin.onTick(inst, 10);
    assert.equal(state.phase, "reveal", `arena ${count}p: the clock must end the round`);
    const measured = maxGain(zeros(count), scoresOf(inst));
    return { measured, expect: 1 };
  },

  // Representative + formula: tap seat 0 alone across the finish line. The
  // race value is progress, clamped to 0..1 by progressOf, so the winner's
  // 1 is the documented maximum. Attains ceiling.
  racing: async (count) => {
    const plugin = await loadPlugin("racing");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "racing"), players);
    const state = inst.state;
    let guard = 0;
    while (state.phase !== "finished" && guard++ < 3000) {
      if (state.phase === "racing") {
        plugin.onInput(inst, players[0].id, { tap: true });
        plugin.onTick(inst, 100);
      } else {
        plugin.onTick(inst, 500);
      }
    }
    assert.equal(state.phase, "finished", `racing ${count}p: seat 0 must cross the line`);
    const screen = plugin.screenState(inst) as { racers: Array<{ progress: number }> };
    const measured = Math.max(...screen.racers.map((racer) => racer.progress));
    return { measured, expect: 1 };
  },

  // Representative + formula: one hand where everyone else folds into the
  // blinds — the winner's gain is tiny, while the derived ceiling
  // (N-1) * STARTING_CHIPS bounds every possible hand (see CEILINGS.poker).
  // The drive also pins STARTING_CHIPS = 1000 from handStartChips.
  poker: async (count) => {
    const plugin = await loadPlugin("poker");
    const players = makePlayers(count);
    const inst = plugin.onStart(makeRoom(players, "poker"), players);
    const state = inst.state;
    let guard = 0;
    while (state.phase !== "hand-end" && state.phase !== "finished" && guard++ < 4000) {
      plugin.onTick(inst, 500);
      const turn = state.turnIndex as number;
      if (turn >= 0 && turn < count) {
        const cs = plugin.controllerState(inst, players[turn].id) as Record<string, unknown>;
        const input = cs.canCheck === true ? { action: "check" } : { action: "fold" };
        plugin.onInput(inst, players[turn].id, input);
      }
    }
    assert.ok(
      state.phase === "hand-end" || state.phase === "finished",
      `poker ${count}p: one hand must complete (phase "${String(state.phase)}")`,
    );
    const handStart = state.handStartChips as number[];
    assert.ok(
      Array.isArray(handStart) && handStart.length === count,
      `poker ${count}p: handStartChips must be recorded`,
    );
    handStart.forEach((chips, seat) => {
      assert.equal(
        chips,
        1000,
        `poker ${count}p: seat ${seat} started the hand with ${chips}, expected ` +
          "STARTING_CHIPS = 1000 (games/poker/server.ts:156)",
      );
    });
    const measured = Math.max(
      ...(state.seats as Array<{ chips: number }>).map(
        (seat, index) => seat.chips - handStart[index],
      ),
    );
    return { measured };
  },
};

// ---------------------------------------------------------------------------
// Coverage matrix (fail closed)
// ---------------------------------------------------------------------------

function enabledGames(): string[] {
  return Object.entries(GAME_CATALOG)
    .filter(([, entry]) => entry.enabled)
    .map(([id]) => id)
    .sort();
}

/** Valid N for a game: max(2, minPlayers) .. maxPlayers, per the catalog. */
function countsFor(game: string): number[] {
  const entry = GAME_CATALOG[game];
  assert.ok(entry, `${game}: no catalog entry`);
  const min = Math.max(2, entry.minPlayers);
  const out: number[] = [];
  for (let n = min; n <= entry.maxPlayers; n++) out.push(n);
  assert.ok(out.length >= 1, `${game}: empty count range`);
  return out;
}

test("coverage: every enabled game has a ceiling entry and a driven round", () => {
  const enabled = enabledGames();
  assert.ok(enabled.length >= 22, `expected at least 22 enabled games, found ${enabled.length}`);

  const missingCeiling = enabled.filter((id) => typeof CEILINGS[id] !== "function");
  assert.deepStrictEqual(
    missingCeiling,
    [],
    `enabled games with no ceiling entry: ${missingCeiling.join(", ")} — a newly ` +
      "enabled game must be classified before the suite passes",
  );
  const missingDrive = enabled.filter((id) => typeof DRIVEN[id] !== "function");
  assert.deepStrictEqual(
    missingDrive,
    [],
    `enabled games with no driven verification: ${missingDrive.join(", ")} — every ` +
      "enabled game must drive at least one worst-case round",
  );

  for (const [id, ceiling] of Object.entries(CEILINGS)) {
    assert.equal(
      GAME_CATALOG[id]?.enabled,
      true,
      `${id}: has a ceiling entry but the catalog does not enable it (stale entry)`,
    );
    assert.equal(typeof ceiling, "function", `${id}: ceiling entry must be a function`);
  }
  for (const id of Object.keys(DRIVEN)) {
    assert.equal(
      GAME_CATALOG[id]?.enabled,
      true,
      `${id}: has a drive but the catalog does not enable it (stale entry)`,
    );
  }
});

test("exceptions: every entry is an enabled in-range over-bound pair with a written reason", () => {
  let count = 0;
  for (const [game, entries] of Object.entries(EXCEPTIONS)) {
    assert.equal(
      GAME_CATALOG[game]?.enabled,
      true,
      `${game}: exception entry is stale (game not enabled)`,
    );
    assert.ok(CEILINGS[game], `${game}: exception without a ceiling entry`);
    const validCounts = countsFor(game);
    for (const [rawN, reason] of Object.entries(entries)) {
      const n = Number(rawN);
      count += 1;
      assert.ok(
        validCounts.includes(n),
        `${game} @ ${n}p: exception for a player count outside the game's range ` +
          `(${validCounts[0]}-${validCounts[validCounts.length - 1]})`,
      );
      assert.ok(
        typeof reason === "string" && reason.length >= 20,
        `${game} @ ${n}p: an exception needs a written reason of at least 20 characters`,
      );
      const ceiling = CEILINGS[game](n);
      assert.ok(
        ceiling > MAX_ROUND_SCORE,
        `${game} @ ${n}p: stale exception — the ceiling ${ceiling} no longer exceeds ` +
          `MAX_ROUND_SCORE ${MAX_ROUND_SCORE}`,
      );
    }
  }
  assert.ok(count >= 14, `expected at least 14 exception pairs, found ${count}`);
});

test("bound: every (game, N) ceiling is at or below MAX_ROUND_SCORE or carries a written exception", () => {
  for (const game of enabledGames()) {
    const ceilingFor = CEILINGS[game];
    assert.ok(ceilingFor, `${game}: no ceiling entry (classify it first)`);
    for (const n of countsFor(game)) {
      const ceiling = ceilingFor(n);
      assert.ok(
        Number.isFinite(ceiling) && ceiling >= 0,
        `${game} @ ${n}p: ceiling ${ceiling} is not a finite non-negative number`,
      );
      const reason = EXCEPTIONS[game]?.[n];
      if (ceiling <= MAX_ROUND_SCORE) {
        assert.ok(
          withinRoundBound(ceiling),
          `${game} @ ${n}p: ceiling ${ceiling} fails the shared withinRoundBound helper`,
        );
        continue;
      }
      assert.ok(
        typeof reason === "string" && reason.length >= 20,
        `${game} @ ${n}p: ceiling ${ceiling} exceeds MAX_ROUND_SCORE ${MAX_ROUND_SCORE} ` +
          "with no written exception — this is a FINDING: report the formula and the " +
          "game's scoring lines instead of weakening the bound",
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Driven rounds — min and max N per game
// ---------------------------------------------------------------------------

for (const game of enabledGames()) {
  const drive = DRIVEN[game];
  if (!drive) continue; // the coverage test fails separately
  const counts = countsFor(game);
  const driven = [...new Set([counts[0], counts[counts.length - 1]])];
  for (const n of driven) {
    test(`driven: ${game} @ ${n}p single round stays within its ceiling`, async () => {
      const ceiling = CEILINGS[game](n);
      assert.ok(
        Number.isFinite(ceiling) && ceiling >= 0,
        `${game} @ ${n}p: ceiling ${ceiling} is not a finite non-negative number`,
      );
      const { measured, expect } = await drive(n);
      assert.ok(
        Number.isFinite(measured),
        `${game} @ ${n}p: drive measured ${measured} (ceiling ${ceiling})`,
      );
      assert.ok(
        measured > 0,
        `${game} @ ${n}p: drive measured ${measured} — the round never scored, ` +
          "so the verification would be vacuous",
      );
      assert.ok(
        measured <= ceiling,
        `${game} @ ${n}p: measured ${measured} exceeds ceiling ${ceiling} ` +
          `(MAX_ROUND_SCORE ${MAX_ROUND_SCORE})`,
      );
      if (expect !== undefined) {
        assert.equal(
          expect,
          ceiling,
          `${game} @ ${n}p: the drive claims attainment of ${expect} but the derived ` +
            `ceiling is ${ceiling} — the claim and the table must agree`,
        );
        assert.equal(
          measured,
          expect,
          `${game} @ ${n}p: measured ${measured}, expected the ceiling ${ceiling} ` +
            "(the worst-case scenario must attain it)",
        );
      }
    });
  }
}
