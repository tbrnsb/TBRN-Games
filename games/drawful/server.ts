/**
 * Drawful - server logic.
 * Draw a ridiculous prompt on your phone, then lie about everyone else's drawings.
 *
 * Player range is 3-8. At 3 and 4 players the original three drawings are kept
 * exactly (artist = round % N, prompts in list order) so those totals stay
 * identical to the pre-expansion game. From five players every seat draws once,
 * in seat order, with prompts drawn from a secure shuffle. A Rumble asks for
 * four drawings selected by secure random (three at 3-4, matching parity).
 *
 * The prompt only ever reaches the artist's phone; the shared screen carries
 * anonymous vote options so a modified client cannot tell which title is real
 * before the reveal. The host may hide or skip the current drawing through the
 * platform's host-token endpoint.
 */

import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { scalePayout, standingsFromScores, type GameResult } from "../../shared/scoring.ts";
import { secureShuffle } from "../../shared/secure-random.ts";

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
  /** Optional host-token control for the current drawing. */
  onHostAction?(instance: GameInstance, action: string): boolean;
  results?(instance: GameInstance): GameResult;
}

interface Stroke { points: Array<[number, number]>; color: string }

type DrawfulMode = "standalone" | "rumble";

interface DrawState {
  round: number;
  maxRounds: number;
  /** Seat that draws in each round, in drawing order. */
  artists: number[];
  /** One prompt per round; never sent to the screen before the reveal. */
  prompts: string[];
  phase: "drawing" | "bluffing" | "voting" | "reveal" | "finished";
  drawer: number;
  prompt: string;
  strokes: Stroke[];
  bluffs: Array<string | null>;
  /** Internal ballot reference ("real" or "b:<seat>"), never sent to clients. */
  votes: Array<string | null>;
  /** Shuffled internal ballot references for the current round. */
  order: string[];
  scores: number[];
  timerMs: number;
  reveal: { realVotes: number; bluffVotes: number[] } | null;
  /** Host hid the current drawing from the TV; strokes are withheld. */
  drawingHidden: boolean;
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface DrawInstance extends GameInstance { state: DrawState }

const PROMPTS = [
  "a soggy sandwich that has seen things",
  "a dog running for mayor",
  "the world's worst superhero",
  "a haunted vending machine",
  "a very confident pigeon",
  "an angry cloud",
  "a wizard who forgot his spellbook",
  "a birthday party for one",
  "a snail in a hurry",
  "a lamp that judges you",
  "a dinosaur learning to skateboard",
  "a ghost with a nine-to-five",
  "a cat plotting world domination",
  "a submarine in the desert",
  "a robot with the hiccups",
  "a knight afraid of the dark",
];

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** The original game: three drawings, artist = round % N, prompts in order. */
const LEGACY_ROUNDS = 3;
/** Brief 4: a Rumble runs four drawings. */
const RUMBLE_ROUNDS = 4;

const REAL_TITLE_POINTS = 500;
const BLUFF_POINTS = 250;
const MAX_BLUFF_LENGTH = 100;

const DRAW_MS = 60000;
const BLUFF_MS = 35000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;

const manifest: GameManifest = {
  id: "drawful",
  name: "Drawful",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "canvas",
  description: "One player draws a ridiculous prompt on their phone. Everyone else writes a convincing lie. Vote for the truth.",
};

function clampPlayerCount(playerCount: number): number {
  if (!Number.isFinite(playerCount)) return 0;
  return Math.max(0, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
}

export interface DrawfulPlan {
  rounds: number;
  artists: number[];
  prompts: string[];
}

/**
 * Round plan for a table of `playerCount`.
 *
 * 3-4 players keep the original three drawings and prompt order, which is what
 * keeps their totals identical to the pre-expansion game. 5-8 play one drawing
 * per seat, in seat order. A Rumble caps at four drawings selected by secure
 * random, and drops to the legacy three at 3-4 for the same parity reason.
 */
export function drawfulPlan(
  playerCount: number,
  mode: DrawfulMode = "standalone",
): DrawfulPlan {
  const count = clampPlayerCount(playerCount);

  if (count <= 4) {
    const rounds = Math.min(LEGACY_ROUNDS, count);
    return {
      rounds,
      artists: Array.from({ length: rounds }, (_, index) => index),
      prompts: PROMPTS.slice(0, rounds),
    };
  }

  const rounds = mode === "rumble" ? Math.min(RUMBLE_ROUNDS, count) : count;
  const artists = mode === "rumble"
    ? secureShuffle(Array.from({ length: count }, (_, index) => index)).slice(0, rounds)
    : Array.from({ length: rounds }, (_, index) => index);
  const deck = secureShuffle(PROMPTS);
  return {
    rounds,
    artists,
    prompts: Array.from({ length: rounds }, (_, index) => deck[index % deck.length]),
  };
}

function leaderName(instance: DrawInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function bumpStat(state: DrawState, playerId: string, stat: "votesReceived" | "fooledVotes", amount: number): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + amount;
}

function buildOrder(instance: DrawInstance): string[] {
  const s = instance.state;
  const ids = ["real"];
  s.bluffs.forEach((bluff, i) => { if (bluff) ids.push(`b:${i}`); });
  return secureShuffle(ids);
}

function beginRound(instance: DrawInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.drawer = s.artists[round] ?? round % instance.players.length;
  s.prompt = s.prompts[round] ?? PROMPTS[round % PROMPTS.length];
  s.strokes = [];
  s.bluffs = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.order = [];
  s.reveal = null;
  s.drawingHidden = false;
  s.timerMs = DRAW_MS;
  s.phase = "drawing";
}

function allBluffed(instance: DrawInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => i === s.drawer || s.bluffs[i] !== null);
}

function allVoted(instance: DrawInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => i === s.drawer || s.votes[i] !== null);
}

function settle(instance: DrawInstance): void {
  const s = instance.state;
  const playerCount = instance.players.length;
  const realPayout = scalePayout(REAL_TITLE_POINTS, playerCount);
  const bluffPayout = scalePayout(BLUFF_POINTS, playerCount);
  let realVotes = 0;
  const bluffVotes = instance.players.map(() => 0);

  for (let i = 0; i < playerCount; i++) {
    const vote = s.votes[i];
    if (!vote || i === s.drawer) continue;
    if (vote === "real") {
      realVotes++;
      continue;
    }
    const author = Number(vote.slice(2));
    if (Number.isInteger(author) && author >= 0 && author < playerCount) bluffVotes[author]++;
  }

  s.scores[s.drawer] += realVotes * realPayout;
  if (realVotes > 0) bumpStat(s, instance.players[s.drawer].id, "votesReceived", realVotes);
  bluffVotes.forEach((count, i) => {
    s.scores[i] += count * bluffPayout;
    if (count > 0) {
      const playerId = instance.players[i]?.id;
      if (playerId) {
        bumpStat(s, playerId, "votesReceived", count);
        bumpStat(s, playerId, "fooledVotes", count);
      }
    }
  });

  s.reveal = { realVotes, bluffVotes };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/**
 * Internal ballot entries for one viewer, in the shuffled order.
 *
 * Clients only ever receive the opaque `o<index>` ids, so the `real` reference
 * is not discoverable from a TV or phone payload before the reveal. The viewer's
 * own bluff is excluded because nobody votes for their own lie.
 */
function optionRefsFor(instance: DrawInstance, viewer: number): Array<{ id: string; ref: string }> {
  const s = instance.state;
  const refs = s.order.length ? s.order : ["real"];
  return refs
    .map((ref, index) => ({ id: `o${index}`, ref }))
    .filter((entry) => entry.ref !== `b:${viewer}`);
}

function optionsFor(instance: DrawInstance, viewer: number, revealed: boolean): Array<{
  id: string;
  label: string;
  correct?: boolean;
  votes?: number;
}> {
  const s = instance.state;
  return optionRefsFor(instance, viewer).map(({ id, ref }) => {
    const option: { id: string; label: string; correct?: boolean; votes?: number } = {
      id,
      label: ref === "real" ? s.prompt : (s.bluffs[Number(ref.slice(2))] ?? ""),
    };
    if (revealed && s.reveal) {
      option.correct = ref === "real";
      option.votes = ref === "real"
        ? s.reveal.realVotes
        : (s.reveal.bluffVotes[Number(ref.slice(2))] ?? 0);
    }
    return option;
  });
}

/** Who the TV is waiting on: the seats still to bluff or vote this drawing. */
function waitingNames(instance: DrawInstance): string[] {
  const s = instance.state;
  if (s.phase === "bluffing") {
    return instance.players
      .filter((_, i) => i !== s.drawer && s.bluffs[i] === null)
      .map((player) => player.name);
  }
  if (s.phase === "voting") {
    return instance.players
      .filter((_, i) => i !== s.drawer && s.votes[i] === null)
      .map((player) => player.name);
  }
  return [];
}

/** A public reveal line: the round's most believed liar, or a generic reveal. */
function revealCaption(instance: DrawInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  let best = 0;
  let author = -1;
  s.reveal.bluffVotes.forEach((count, i) => {
    if (count > best) { best = count; author = i; }
  });
  if (author >= 0 && best > 0) {
    return captionFor({
      kind: "fooled",
      name: instance.players[author]?.name,
      count: best,
      seed: s.round,
    });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const mode: DrawfulMode = options?.mode === "rumble" ? "rumble" : "standalone";
    const plan = drawfulPlan(players.length, mode);
    const instance: DrawInstance = {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: plan.rounds,
        artists: plan.artists,
        prompts: plan.prompts,
        phase: "drawing",
        drawer: plan.artists[0] ?? 0,
        prompt: plan.prompts[0] ?? PROMPTS[0],
        strokes: [],
        bluffs: players.map(() => null),
        votes: players.map(() => null),
        order: [],
        scores: players.map(() => 0),
        timerMs: DRAW_MS,
        reveal: null,
        drawingHidden: false,
        stats: Object.fromEntries(
          players.flatMap((player): Array<[string, number]> => [
            [playerStatKey(player.id, "votesReceived"), 0],
            [playerStatKey(player.id, "fooledVotes"), 0],
          ]),
        ),
      } satisfies DrawState,
    };
    // Initialise round 1 through the same path as every later drawing.
    beginRound(instance, 0);
    return instance;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as DrawInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as {
      stroke?: { points?: unknown; color?: unknown };
      action?: unknown;
      text?: unknown;
      choice?: unknown;
    } | null;

    if (s.phase === "drawing" && index === s.drawer) {
      if (raw?.stroke && Array.isArray(raw.stroke.points)) {
        const points = (raw.stroke.points as unknown[])
          .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number")
          .slice(0, 300)
          .map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [number, number]);
        if (points.length >= 2) {
          s.strokes.push({ points, color: typeof raw.stroke.color === "string" ? raw.stroke.color : "#111111" });
          if (s.strokes.length > 200) s.strokes.shift();
        }
        return;
      }
      if (raw?.action === "action" && s.strokes.length > 0) {
        s.phase = "bluffing";
        s.timerMs = BLUFF_MS;
      }
      return;
    }

    if (s.phase === "bluffing" && index !== s.drawer) {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.bluffs[index] = raw.text.trim().slice(0, MAX_BLUFF_LENGTH);
        if (allBluffed(inst)) {
          s.order = buildOrder(inst);
          s.phase = "voting";
          s.timerMs = VOTE_MS;
        }
      }
      return;
    }

    if (s.phase === "voting" && index !== s.drawer) {
      if (typeof raw?.choice !== "string") return;
      // The ballot exposes opaque ids; the internal reference stays server-side.
      const chosen = optionRefsFor(inst, index).find((entry) => entry.id === raw.choice);
      if (!chosen) return;
      s.votes[index] = chosen.ref;
      if (allVoted(inst)) settle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as DrawInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "drawing") {
      if (s.strokes.length === 0) {
        s.strokes.push({ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" });
      }
      s.phase = "bluffing";
      s.timerMs = BLUFF_MS;
      return;
    }
    if (s.phase === "bluffing") {
      inst.players.forEach((_, i) => { if (i !== s.drawer && !s.bluffs[i]) s.bluffs[i] = "a very bad drawing"; });
      s.order = buildOrder(inst);
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

  /**
   * Host-token controls for the current drawing.
   *
   * `hide-drawing` withholds the received strokes from the TV (and `show-drawing`
   * restores them) without touching the artist's phone or the round state.
   * `skip-drawing` discards the rest of the current drawing, scoring nothing for
   * it, and moves straight to the next drawing (or finishes after the last).
   */
  onHostAction(instance: GameInstance, action: string): boolean {
    const inst = instance as DrawInstance;
    const s = inst.state;
    if (s.phase === "finished") return false;
    if (action === "hide-drawing") {
      s.drawingHidden = true;
      return true;
    }
    if (action === "show-drawing") {
      s.drawingHidden = false;
      return true;
    }
    if (action === "skip-drawing") {
      const next = s.round + 1;
      if (next >= s.maxRounds) {
        s.phase = "finished";
        s.timerMs = 0;
      } else {
        beginRound(inst, next);
      }
      return true;
    }
    return false;
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as DrawInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal";
    const showOptions = s.phase === "voting" || revealed;
    const options = showOptions ? optionsFor(inst, -1, revealed) : [];
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      // Explicit "drawing X of N" fields for the TV header.
      drawingNumber: s.round + 1,
      totalDrawings: s.maxRounds,
      drawerName: inst.players[s.drawer]?.name ?? "",
      artistName: inst.players[s.drawer]?.name ?? "",
      strokes: s.drawingHidden ? [] : s.strokes,
      drawingHidden: s.drawingHidden,
      options,
      optionColumns: options.length >= 7 ? 2 : 1,
      // The real title and the anonymous-option mapping stay secret until the
      // reveal; before the vote the bluffs are not even in the payload.
      realPrompt: revealed ? s.prompt : null,
      reveal: s.reveal,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: revealed ? "reveal" : null,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as DrawInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      drawingNumber: s.round + 1,
      totalDrawings: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && leaderName(inst) === inst.players[index].name,
    };

    if (s.phase === "drawing") {
      if (index === s.drawer) {
        return {
          ...base,
          mode: "canvas",
          controllerType: "canvas",
          canvas: { prompt: s.prompt, color: "#111111", disabled: false },
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: `${inst.players[s.drawer].name} is drawing...`,
      };
    }

    if (s.phase === "bluffing") {
      if (index === s.drawer) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Your drawing is up. Sit tight." };
      }
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "What could this be?",
        hasSubmitted: s.bluffs[index] !== null,
        info: "Write a convincing lie",
      };
    }

    if (s.phase === "voting") {
      if (index === s.drawer) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Everyone is voting." };
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: optionsFor(inst, index, false),
        hasVoted: s.votes[index] !== null,
        info: "Which one is real?",
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: `It was: ${s.prompt}`,
    };
  },

  results(instance: GameInstance): GameResult {
    const inst = instance as DrawInstance;
    return {
      standings: standingsFromScores(
        inst.players.map((player, i) => ({ id: player.id, raw: inst.state.scores[i] })),
      ),
      stats: { ...inst.state.stats },
    };
  },
};

export default plugin;
