/**
 * Fakin' It - server logic.
 * Everyone gets the same instruction except one Faker. Spot them.
 *
 * The Faker seat comes from a secure-random rotation cycle: every seat is drawn
 * exactly once per cycle, so nobody repeats as Faker until everyone has had it.
 */

import { secureShuffle } from "../../shared/secure-random.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { scalePayout, standingsFromScores, type GameResult } from "../../shared/scoring.ts";

interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
}

type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand"
  | "slider"
  | "dual-slider"
  | "pad"
  | "aim"
  | "tap-race"
  | "board"
  | "numpad"
  | "canvas"
  | "chat";

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
}

interface RoomState {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: unknown;
}

interface GamePlugin {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  results?(instance: GameInstance): GameResult;
}

interface FakinState {
  round: number;
  maxRounds: number;
  phase: "acting" | "voting" | "reveal" | "finished";
  faker: number;
  /** Secure-random seat order for the current rotation cycle. */
  fakerOrder: number[];
  /** Position of the next seat to draw from `fakerOrder`. */
  fakerCursor: number;
  realPrompt: string;
  fakePrompt: string;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { accused: number | null; caught: boolean } | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface FakinInstance extends GameInstance { state: FakinState }

const REAL_PROMPTS = [
  "Raise your hand if you have ever lied to get out of plans",
  "Raise your hand if you have cried at a cartoon",
  "Raise your hand if you have pretended to know a song",
  "Raise your hand if you have eaten something off the floor",
  "Raise your hand if you have faked being sick for a day off",
  "Raise your hand if you have snooped through someone's phone",
];
const FAKE_PROMPTS = [
  "You are the Faker. Copy what everyone else does.",
  "You are the Faker. Mirror the group and do not get caught.",
  "You are the Faker. Watch the others, then copy them.",
];

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** Standalone rounds; the catalog's `scale()` reports the same split. */
const ROUNDS_SMALL_TABLE = 3;
const ROUNDS_LARGE_TABLE = 5;

/** 3-4 players keep the pre-expansion three rounds; five and up run five. */
function roundsFor(playerCount: number): number {
  return playerCount <= 4 ? ROUNDS_SMALL_TABLE : ROUNDS_LARGE_TABLE;
}

const ACT_MS = 25000;
const VOTE_MS = 20000;
const REVEAL_MS = 8000;

/** Per-correct-voter payout, before `f(N)`: exactly 200 at 3-4 players. */
const CORRECT_VOTE_POINTS = 200;
/** An uncaught Faker takes this fixed amount; never scaled. */
const UNCAUGHT_POINTS = 500;

const manifest: GameManifest = {
  id: "fakin",
  name: "Fakin' It",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "choice",
  description: "Everyone gets the same instruction except one Faker, who has to bluff. Then everyone votes on who was faking.",
};

/**
 * One Faker-rotation cycle: a secure shuffle of every seat.
 *
 * The game consumes the cycle in order and draws a fresh one when it runs out,
 * so no seat repeats as Faker until every player has been Faker once.
 */
export function buildFakerCycle(playerCount: number): number[] {
  const count = Number.isFinite(playerCount) ? Math.floor(playerCount) : 0;
  if (count <= 0) return [];
  return secureShuffle(Array.from({ length: count }, (_, seat) => seat));
}

function fakinLeader(instance: FakinInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function bumpStat(state: FakinState, playerId: string, stat: "correctVotes" | "roundsUndetected"): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}

function fakinBegin(instance: FakinInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  // Draw a new secure-random cycle only when the current one is spent.
  if (s.fakerCursor >= s.fakerOrder.length) {
    s.fakerOrder = buildFakerCycle(instance.players.length);
    s.fakerCursor = 0;
  }
  s.faker = s.fakerOrder[s.fakerCursor] ?? 0;
  s.fakerCursor += 1;
  s.realPrompt = REAL_PROMPTS[round % REAL_PROMPTS.length];
  s.fakePrompt = FAKE_PROMPTS[round % FAKE_PROMPTS.length];
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = ACT_MS;
  s.phase = "acting";
}

function fakinAllVoted(instance: FakinInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => i === s.faker || s.votes[i] !== null);
}

/**
 * Strict-majority accusation over the votes cast (brief 4, GAMES.md).
 *
 * More than half of the ballots must name the Faker. A tie, a split, or a
 * leader who is somebody else never catches them. At 3-4 players every
 * non-tied unique top is also a majority, so this matches the old rule there.
 */
export function tallyFakerVotes(
  votes: Array<number | null>,
  faker: number,
): { accused: number | null; caught: boolean } {
  const tally = new Map<number, number>();
  const seats = votes.length;
  let cast = 0;
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= seats) continue;
    tally.set(vote, (tally.get(vote) ?? 0) + 1);
    cast += 1;
  }

  let accused: number | null = null;
  let best = 0;
  let tie = false;
  for (const [seat, count] of tally) {
    if (count > best) { best = count; accused = seat; tie = false; }
    else if (count === best) tie = true;
  }

  return { accused, caught: !tie && best > 0 && best * 2 > cast && accused === faker };
}

function fakinSettle(instance: FakinInstance): void {
  const s = instance.state;
  const { accused, caught } = tallyFakerVotes(s.votes, s.faker);

  // Every vote that named the real Faker is a correct vote, even when the
  // group's top pick was somebody else; the Sharpest Eye stat counts them all.
  instance.players.forEach((player, i) => {
    if (s.votes[i] === s.faker) bumpStat(s, player.id, "correctVotes");
  });

  if (caught) {
    const payout = scalePayout(CORRECT_VOTE_POINTS, instance.players.length);
    for (let i = 0; i < instance.players.length; i++) {
      if (s.votes[i] === s.faker) s.scores[i] += payout;
    }
  } else {
    s.scores[s.faker] += UNCAUGHT_POINTS;
    bumpStat(s, instance.players[s.faker].id, "roundsUndetected");
  }
  s.reveal = { accused, caught };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/**
 * Who the TV is waiting on.
 *
 * The list is every player without a vote yet, including the Faker (who never
 * votes): filtering the Faker out would name them by omission on the shared
 * screen. The ballot closes the moment the last real voter votes, so the
 * Faker is never left alone on the banner.
 */
function waitingNames(instance: FakinInstance): string[] {
  const s = instance.state;
  if (s.phase !== "voting") return [];
  return instance.players.filter((_, i) => s.votes[i] === null).map((p) => p.name);
}

/** Public reveal line from the fixed caption bank; never carries a secret. */
function revealCaption(instance: FakinInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  if (!s.reveal.caught) {
    const fooled = s.votes.filter((vote) => vote !== null && vote !== s.faker).length;
    return captionFor({
      kind: "fooled",
      name: instance.players[s.faker]?.name,
      count: fooled,
      seed: s.round,
    });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const instance: FakinInstance = {
      roomId: room.id,
      players,
      state: {
        round: 0,
        // A Rumble passes three rounds; standalone keeps the table rule.
        maxRounds: roundsOption(options) ?? roundsFor(players.length),
        phase: "acting",
        faker: 0,
        fakerOrder: [],
        fakerCursor: 0,
        realPrompt: REAL_PROMPTS[0],
        fakePrompt: FAKE_PROMPTS[0],
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: ACT_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.flatMap((p): Array<[string, number]> => [
            [playerStatKey(p.id, "correctVotes"), 0],
            [playerStatKey(p.id, "roundsUndetected"), 0],
          ]),
        ),
      } satisfies FakinState,
    };
    // Round 1 needs its prompts and its rotation seat just like later rounds.
    fakinBegin(instance, 0);
    return instance;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as FakinInstance;
    const s = inst.state;
    if (s.phase !== "voting") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1 || index === s.faker) return;
    const choice = (input as { choice?: unknown } | null)?.choice;
    if (typeof choice !== "string" || !choice.startsWith("p:")) return;
    const target = Number(choice.slice(2));
    if (!Number.isInteger(target) || target < 0 || target >= inst.players.length) return;
    if (target === index) return;
    s.votes[index] = target;
    if (fakinAllVoted(inst)) fakinSettle(inst);
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as FakinInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    if (s.phase === "acting") { s.phase = "voting"; s.timerMs = VOTE_MS; return; }
    if (s.phase === "voting") { fakinSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    fakinBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as FakinInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    // The ballot opens only for voting and the reveal: every seat gets a TV row
    // so the shared 7-9 layout can draw all eight, with counts held back until
    // the reveal.
    const ballotOpen = s.phase === "voting" || revealed;
    const options = ballotOpen
      ? inst.players.map((p, i) => ({
          id: `p:${i}`,
          label: p.name,
          votes: revealed ? s.votes.filter((vote) => vote === i).length : 0,
          selected: false,
        }))
      : [];
    // The acting instruction is public (everyone but the Faker shares it); the
    // role is only public at the reveal.
    const prompt = revealed
      ? s.reveal
        ? s.reveal.caught
          ? `${inst.players[s.faker].name} was the Faker and got caught!`
          : `${inst.players[s.faker].name} was the Faker and got away with it.`
        : null
      : s.realPrompt;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      prompt,
      instruction: s.phase === "reveal" ? null : s.realPrompt,
      fakerName: revealed ? inst.players[s.faker]?.name : null,
      options,
      optionColumns: options.length >= 7 ? 2 : 1,
      showVoteCounts: revealed && s.reveal !== null,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
      reveal: revealed ? s.reveal : null,
      timerMs: Math.max(0, s.timerMs),
      // Name/score rows keep the generic TV table and the ticker in sync at 8.
      players: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? fakinLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as FakinInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && fakinLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "acting") {
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: index === s.faker ? s.fakePrompt : s.realPrompt,
      };
    }
    if (s.phase === "voting") {
      // One option per other seat: a phone never offers its own name.
      const options = inst.players
        .map((p, i) => ({ id: `p:${i}`, label: p.name }))
        .filter((_, i) => i !== index);
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options,
        hasVoted: s.votes[index] !== null,
        info: "Who was faking?",
      };
    }
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal
        ? s.reveal.caught
          ? `${inst.players[s.faker].name} was caught!`
          : `${inst.players[s.faker].name} got away with it.`
        : "",
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as FakinInstance;
    const s = inst.state;
    return {
      standings: standingsFromScores(
        inst.players.map((p, i) => ({ id: p.id, raw: s.scores[i] })),
      ),
      stats: { ...s.stats },
    };
  },
};

export default plugin;
