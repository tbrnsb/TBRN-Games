/**
 * Split the Room - server logic.
 * Fill a blank to split the room down the middle. The closer the yes/no vote,
 * the more the writer scores; minority voters take a fixed bonus.
 */

import { secureShuffle } from "../../shared/secure-random.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores, type GameResult } from "../../shared/scoring.ts";

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

interface Scenario { text: string; hint: string }

interface SplitState {
  scenarios: Scenario[];
  round: number;
  maxRounds: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  writer: number;
  submission: string | null;
  votes: Array<"yes" | "no" | null>;
  scores: number[];
  timerMs: number;
  reveal: { yes: number; no: number; points: number } | null;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface SplitInstance extends GameInstance { state: SplitState }

const SCENARIOS: Scenario[] = [
  { text: "You get $10,000, but every time you cough, ___ happens.", hint: "something you would pay to avoid" },
  { text: "You can fly, but only while ___ is playing.", hint: "a song or sound" },
  { text: "You are immortal, but you must ___ once a day.", hint: "an embarrassing ritual" },
  { text: "You become world famous, but everyone knows you as ___.", hint: "a nickname" },
  { text: "You never need sleep again, but you develop a craving for ___.", hint: "a strange snack" },
  { text: "You win a lifetime supply of ___, delivered weekly.", hint: "something useless in bulk" },
  { text: "You can read minds, but only the thoughts about ___.", hint: "a topic" },
  { text: "You get a personal chef, but they only cook ___.", hint: "one dish" },
  { text: "You can teleport, but you always arrive wearing ___.", hint: "an outfit" },
  { text: "You speak every language, but your voice sounds like ___.", hint: "a sound or character" },
  { text: "You never lose a bet, but you must first ___ in public.", hint: "a dare" },
  { text: "You own the world's fastest car, but it can only drive to ___.", hint: "a destination" },
];

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** Standalone always runs at least four rounds, so 3-4 players keep today's game. */
const MIN_ROUNDS = 4;
const MAX_ROUNDS = 8;
const MAX_TEXT = 140;
const WRITE_MS = 45000;
const VOTE_MS = 25000;
const REVEAL_MS = 8000;
/** A perfect split is worth this much to the writer. */
const SPLIT_POINTS = 1000;
/** Fixed payout to each voter on the smaller side. */
const MINORITY_BONUS = 150;

const manifest: GameManifest = {
  id: "splitroom",
  name: "Split the Room",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "text",
  description: "Fill a blank to split the room down the middle. The closer the yes/no vote, the more you score.",
};

/**
 * Standalone rounds: one write per player, but never fewer than four.
 *
 * The brief says "rounds N (max 8)". Keeping four at N=3 and N=4 deliberately
 * preserves today's 3-4 player game and its totals; see docs/DECISIONS.md.
 */
function standaloneRounds(playerCount: number): number {
  return Math.max(MIN_ROUNDS, Math.min(playerCount, MAX_ROUNDS));
}

/**
 * The writer rotates through the seat order exactly once per cycle, so at 5-8
 * players every player writes once. Below five the game still runs four rounds,
 * so the first seats write again.
 */
function writerFor(round: number, playerCount: number): number {
  return playerCount > 0 ? round % playerCount : 0;
}

/** Replace C0/DEL control characters (newlines, tabs, escape codes) with spaces. */
function stripControlCharacters(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out;
}

/** Server-side free-text sanitiser: strip control characters, collapse space, cap length. */
function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = stripControlCharacters(raw).replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.slice(0, MAX_TEXT);
}

function leaderName(instance: SplitInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function bumpStat(
  state: SplitState,
  playerId: string,
  stat: "splitScore" | "minorityCalls",
  amount = 1,
): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + amount;
}

function beginRound(instance: SplitInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.writer = writerFor(round, instance.players.length);
  s.submission = null;
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = WRITE_MS;
  s.phase = "writing";
}

function voters(instance: SplitInstance): number[] {
  const s = instance.state;
  return instance.players.map((_, i) => i).filter((i) => i !== s.writer);
}

function everyoneVoted(instance: SplitInstance): boolean {
  const s = instance.state;
  return voters(instance).every((i) => s.votes[i] !== null);
}

function settle(instance: SplitInstance): void {
  const s = instance.state;
  const list = voters(instance);
  const yes = list.filter((i) => s.votes[i] === "yes").length;
  const no = list.filter((i) => s.votes[i] === "no").length;
  const total = list.length || 1;
  const points = Math.round(SPLIT_POINTS - Math.abs(yes - no) * (SPLIT_POINTS / total));
  s.scores[s.writer] += points;
  bumpStat(s, instance.players[s.writer].id, "splitScore", points);

  // Voters on the smaller side called it right.
  if (yes !== no) {
    const minority = yes < no ? "yes" : "no";
    for (const i of list) {
      if (s.votes[i] !== minority) continue;
      s.scores[i] += MINORITY_BONUS;
      bumpStat(s, instance.players[i].id, "minorityCalls");
    }
  }

  s.reveal = { yes, no, points };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/** Who the TV is waiting on: the writer while writing, silent voters while voting. */
function waitingNames(instance: SplitInstance): string[] {
  const s = instance.state;
  if (s.phase === "writing") {
    const name = instance.players[s.writer]?.name;
    return name ? [name] : [];
  }
  if (s.phase === "voting") {
    return voters(instance)
      .filter((i) => s.votes[i] === null)
      .map((i) => instance.players[i].name);
  }
  return [];
}

/** Public reveal line from the fixed caption bank; never carries private text. */
function revealCaption(instance: SplitInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  if (s.reveal.yes === s.reveal.no) {
    return captionFor({
      kind: "perfect",
      name: instance.players[s.writer]?.name,
      count: s.reveal.yes,
      seed: s.round,
    });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

/** The scenario with the blank filled in, once the writer has submitted. */
function filledScenario(scenario: Scenario, submission: string | null): string {
  if (!submission) return scenario.text;
  return scenario.text.replace("___", submission);
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): SplitInstance {
    // A Rumble passes the catalog's shorter count; standalone keeps the
    // four-until-eight round rule.
    const rounds = roundsOption(options) ?? standaloneRounds(players.length);
    return {
      roomId: room.id,
      players,
      state: {
        scenarios: secureShuffle(SCENARIOS).slice(0, Math.min(rounds, SCENARIOS.length)),
        round: 0,
        maxRounds: rounds,
        phase: "writing",
        writer: 0,
        submission: null,
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: WRITE_MS,
        reveal: null,
        stats: Object.fromEntries(
          players.flatMap((p): Array<[string, number]> => [
            [playerStatKey(p.id, "splitScore"), 0],
            [playerStatKey(p.id, "minorityCalls"), 0],
          ]),
        ),
      } satisfies SplitState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as SplitInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "writing" && index === s.writer) {
      const text = cleanText(raw?.text);
      if (text !== null) {
        s.submission = text;
        s.phase = "voting";
        s.timerMs = VOTE_MS;
      }
      return;
    }

    if (s.phase === "voting" && index !== s.writer) {
      if (raw?.choice === "yes" || raw?.choice === "no") {
        s.votes[index] = raw.choice;
        if (everyoneVoted(inst)) settle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as SplitInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "writing") {
      if (!s.submission) s.submission = "something nobody expects";
      s.phase = "voting";
      s.timerMs = VOTE_MS;
      return;
    }
    if (s.phase === "voting") {
      settle(inst);
      return;
    }
    if (s.phase === "reveal") {
      const next = s.round + 1;
      if (next >= s.maxRounds) {
        s.phase = "finished";
        return;
      }
      beginRound(inst, next);
    }
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as SplitInstance;
    const s = inst.state;
    const scenario = s.scenarios[s.round % s.scenarios.length];
    const reveal = s.phase === "reveal";
    const filled = s.phase === "writing" ? null : s.submission;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      scenario: scenario.text,
      prompt: filledScenario(scenario, filled),
      filled,
      writerName: inst.players[s.writer]?.name ?? "",
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: reveal ? "reveal" : null,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      players: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as SplitInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const scenario = s.scenarios[s.round % s.scenarios.length];
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && leaderName(inst) === inst.players[index].name,
    };

    if (s.phase === "writing") {
      if (index === s.writer) {
        return {
          ...base,
          mode: "text",
          controllerType: "text",
          placeholder: scenario.hint,
          prompt: scenario.text,
          maxLength: MAX_TEXT,
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: `${inst.players[s.writer].name} is writing the scenario...`,
      };
    }

    if (s.phase === "voting") {
      if (index === s.writer) {
        return {
          ...base,
          mode: "wait",
          controllerType: "choice",
          options: [],
          info: "Your scenario is on the screen. Hope it splits them.",
        };
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [
          { id: "yes", label: "YES" },
          { id: "no", label: "NO" },
        ],
        hasVoted: s.votes[index] !== null,
        info: s.submission ?? "",
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal ? `${s.reveal.yes} yes - ${s.reveal.no} no - +${s.reveal.points}` : "",
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as SplitInstance;
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
