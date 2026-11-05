import { secureRandomInt } from "../../shared/secure-random.ts";

/**
 * Split the Room - server logic.
 * Fill a blank to split the room down the middle.
 */

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
  | "chat"
  | "role"
  | "rank";

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
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}





interface BracketState {
  round: number;
  maxRounds: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  prompt: string;
  entries: Array<{ author: number; text: string } | null>;
  duels: Array<{ a: number; b: number; votes: Array<"a" | "b" | null>; winner: number | null }>;
  current: number;
  scores: number[];
  timerMs: number;
  reveal: { champion: number | null } | null;
}

interface BracketInstance extends GameInstance { state: BracketState }

const PROMPTS = [
  "Best excuse for being late",
  "Worst thing to say on a first date",
  "Best name for a pet rock",
  "Worst superpower",
  "Best thing to find in your pocket",
  "Worst song to play at a wedding",
  "Best way to waste a Sunday",
];

const WRITE_MS = 60000;
const VOTE_MS = 20000;
const REVEAL_MS = 9000;

const manifest: GameManifest = {
  id: "bracket",
  name: "Bracket Brawl",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "Everyone writes one answer, then it is a knockout bracket. Only players not in a duel get to vote.",
};

/** Slots: >= 0 is an entry index; negative means "winner of duel (-slot - 1)". */
export function buildBracket(playerCount: number): Array<{ a: number; b: number }> {
  if (playerCount >= 4) {
    return [{ a: 0, b: 1 }, { a: 2, b: 3 }, { a: -1, b: -2 }];
  }
  if (playerCount === 3) {
    return [{ a: 0, b: 1 }, { a: -1, b: 2 }];
  }
  return [{ a: 0, b: 1 }];
}

/** Majority wins; a tie is broken by the supplied pick (0 = side a, 1 = side b). */
export function decideDuel(votes: Array<"a" | "b" | null>, tiePick: 0 | 1): "a" | "b" {
  let a = 0;
  let b = 0;
  for (const vote of votes) {
    if (vote === "a") a++;
    else if (vote === "b") b++;
  }
  if (a === b) return tiePick === 0 ? "a" : "b";
  return a > b ? "a" : "b";
}

function bracketLeader(instance: BracketInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function resolveSlot(s: BracketState, slot: number): number {
  if (slot >= 0) return slot;
  const duel = s.duels[-slot - 1];
  return duel?.winner ?? -1;
}

function duelSides(s: BracketState, duelIndex: number): { a: number; b: number } {
  const duel = s.duels[duelIndex];
  return { a: resolveSlot(s, duel.a), b: resolveSlot(s, duel.b) };
}

/** Seats that may vote in a duel: everyone whose answer is not in it. */
function eligibleVoters(instance: BracketInstance, duelIndex: number): number[] {
  const s = instance.state;
  const sides = duelSides(s, duelIndex);
  const taken = new Set<number>();
  for (const entryIndex of [sides.a, sides.b]) {
    const entry = entryIndex >= 0 ? s.entries[entryIndex] : null;
    if (entry) taken.add(entry.author);
  }
  return instance.players.map((_, i) => i).filter((i) => !taken.has(i));
}

function bracketBegin(instance: BracketInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.prompt = PROMPTS[round % PROMPTS.length];
  s.entries = instance.players.map(() => null);
  s.duels = [];
  s.current = 0;
  s.reveal = null;
  s.timerMs = WRITE_MS;
  s.phase = "writing";
}

function bracketStartBracket(instance: BracketInstance): void {
  const s = instance.state;
  s.duels = buildBracket(instance.players.length).map((d) => ({ a: d.a, b: d.b, votes: instance.players.map(() => null), winner: null }));
  s.current = 0;
  s.phase = "voting";
  s.timerMs = VOTE_MS;
}

function bracketResolve(instance: BracketInstance): void {
  const s = instance.state;
  const duel = s.duels[s.current];
  if (!duel) return;
  const sides = duelSides(s, s.current);
  const side = decideDuel(duel.votes, secureRandomInt(0, 2) === 0 ? 0 : 1);
  const entryIndex = side === "a" ? sides.a : sides.b;
  duel.winner = entryIndex;

  const winners = eligibleVoters(instance, s.current);
  for (const seat of winners) {
    if (duel.votes[seat] === side) s.scores[seat] += 100;
  }

  const author = entryIndex >= 0 ? s.entries[entryIndex]?.author ?? -1 : -1;
  const isFinal = s.current === s.duels.length - 1;
  if (author >= 0) s.scores[author] += isFinal ? 1000 : 500;

  if (isFinal) {
    s.reveal = { champion: author >= 0 ? author : null };
    s.phase = "reveal";
    s.timerMs = REVEAL_MS;
    return;
  }
  s.current++;
  s.timerMs = VOTE_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: 2,
        phase: "writing",
        prompt: PROMPTS[0],
        entries: players.map(() => null),
        duels: [],
        current: 0,
        scores: players.map(() => 0),
        timerMs: WRITE_MS,
        reveal: null,
      } satisfies BracketState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as BracketInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "writing") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.entries[index] === null) {
        s.entries[index] = { author: index, text: raw.text.trim().slice(0, 80) };
        if (s.entries.every((e) => e !== null)) bracketStartBracket(inst);
      }
      return;
    }

    if (s.phase === "voting") {
      const seats = eligibleVoters(inst, s.current);
      if (!seats.includes(index)) return;
      if (raw?.choice !== "a" && raw?.choice !== "b") return;
      s.duels[s.current].votes[index] = raw.choice;
      if (seats.every((seat) => s.duels[s.current].votes[seat] !== null)) bracketResolve(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as BracketInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "writing") {
      inst.players.forEach((_, i) => { if (!s.entries[i]) s.entries[i] = { author: i, text: "no answer" }; });
      bracketStartBracket(inst);
      return;
    }
    if (s.phase === "voting") { bracketResolve(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    bracketBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as BracketInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    const entryText = (idx: number): string => (idx >= 0 ? s.entries[idx]?.text ?? "" : "");
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      prompt: s.prompt,
      duels: s.duels.map((d, i) => ({
        a: entryText(resolveSlot(s, d.a)),
        b: entryText(resolveSlot(s, d.b)),
        winner: i === s.current && s.phase === "voting" ? null : (d.winner !== null ? entryText(d.winner) : null),
      })),
      currentDuel: s.phase === "voting" ? s.current : null,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? bracketLeader(inst) : null,
      revealed,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as BracketInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && bracketLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "writing") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: s.prompt,
        maxLength: 80,
        hasSubmitted: s.entries[index] !== null,
        info: s.prompt,
      };
    }

    if (s.phase === "voting") {
      const seats = eligibleVoters(inst, s.current);
      if (!seats.includes(index)) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: "You are in this duel. Watch the voting." };
      }
      const sides = duelSides(s, s.current);
      const label = (idx: number): string => (idx >= 0 ? s.entries[idx]?.text ?? "" : "");
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [
          { id: "a", label: label(sides.a) },
          { id: "b", label: label(sides.b) },
        ],
        hasVoted: s.duels[s.current]?.votes[index] !== null,
        info: "Pick the better answer",
      };
    }

    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? "Bracket complete" : "" };
  },
};

export default plugin;
