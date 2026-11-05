/**
 * Split the Room - server logic.
 * Fill a blank to split the room down the middle.
 */

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
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}



interface Entry { word: string; definition: string }

interface DictState {
  entries: Entry[];
  round: number;
  maxRounds: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  fakes: Array<string | null>;
  votes: Array<string | null>;
  order: string[];
  scores: number[];
  timerMs: number;
  reveal: { realVotes: number; realDefinition: string } | null;
}

interface DictInstance extends GameInstance { state: DictState }

const ENTRIES: Entry[] = [
  { word: "crapulous", definition: "given to excessive eating and drinking" },
  { word: "gongoozler", definition: "a person who stares idly at canal activity" },
  { word: "snollygoster", definition: "a shrewd, unprincipled politician" },
  { word: "ultracrepidarian", definition: "one who gives opinions beyond their knowledge" },
  { word: "jobler", definition: "someone who does small jobs" },
  { word: "mumpsimus", definition: "a stubborn refusal to correct a mistake" },
  { word: "flapdoodle", definition: "nonsense" },
  { word: "brabble", definition: "to argue loudly about something trivial" },
  { word: "obdormition", definition: "the numbness of a limb that has gone to sleep" },
  { word: "apricate", definition: "to sunbathe" },
];

const WRITE_MS = 60000;
const VOTE_MS = 30000;
const REVEAL_MS = 9000;

const manifest: GameManifest = {
  id: "dictionarium",
  name: "Dictionarium",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "An obsolete word nobody knows. Invent a definition convincing enough to beat the real one.",
};

function leaderName(instance: DictInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function buildOrder(instance: DictInstance): string[] {
  const s = instance.state;
  const ids = ["real"];
  s.fakes.forEach((fake, i) => { if (fake) ids.push(`p:${i}`); });
  return secureShuffle(ids);
}

function beginRound(instance: DictInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.fakes = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.order = [];
  s.reveal = null;
  s.timerMs = WRITE_MS;
  s.phase = "writing";
}

function allSubmitted(instance: DictInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => s.fakes[i] !== null);
}

function allVoted(instance: DictInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => s.votes[i] !== null);
}

function settle(instance: DictInstance): void {
  const s = instance.state;
  const entry = s.entries[s.round % s.entries.length];
  for (let i = 0; i < instance.players.length; i++) {
    const vote = s.votes[i];
    if (!vote) continue;
    if (vote === "real") {
      s.scores[i] += 500; // found the true definition
      continue;
    }
    const author = Number(vote.slice(2));
    if (Number.isInteger(author) && author >= 0 && author !== i) s.scores[author] += 100;
  }
  s.reveal = { realVotes: s.votes.filter((v) => v === "real").length, realDefinition: entry.definition };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

function optionsFor(instance: DictInstance, viewer: number): Array<{ id: string; label: string }> {
  const s = instance.state;
  const entry = s.entries[s.round % s.entries.length];
  const ids = s.order.length ? s.order : ["real"];
  return ids
    .filter((id) => id !== `p:${viewer}`)
    .map((id) => ({
      id,
      label: id === "real" ? entry.definition : (s.fakes[Number(id.slice(2))] ?? ""),
    }));
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        entries: secureShuffle(ENTRIES).slice(0, 4),
        round: 0,
        maxRounds: 4,
        phase: "writing",
        fakes: players.map(() => null),
        votes: players.map(() => null),
        order: [],
        scores: players.map(() => 0),
        timerMs: WRITE_MS,
        reveal: null,
      } satisfies DictState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as DictInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "writing") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.fakes[index] = raw.text.trim().slice(0, 120);
        if (allSubmitted(inst)) {
          s.order = buildOrder(inst);
          s.phase = "voting";
          s.timerMs = VOTE_MS;
        }
      }
      return;
    }

    if (s.phase === "voting") {
      if (typeof raw?.choice !== "string") return;
      if (raw.choice === `p:${index}`) return; // no voting for yourself
      if (!s.order.includes(raw.choice)) return;
      s.votes[index] = raw.choice;
      if (allVoted(inst)) settle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as DictInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "writing") {
      inst.players.forEach((_, i) => { if (!s.fakes[i]) s.fakes[i] = "something deeply unhelpful"; });
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

  screenState(instance: GameInstance): unknown {
    const inst = instance as DictInstance;
    const s = inst.state;
    const entry = s.entries[s.round % s.entries.length];
    const voting = s.phase === "voting" || s.phase === "reveal";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      word: entry.word,
      options: voting ? optionsFor(inst, -1) : [],
      realDefinition: s.phase === "reveal" ? entry.definition : null,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as DictInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const entry = s.entries[s.round % s.entries.length];
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && leaderName(inst) === inst.players[index].name,
    };

    if (s.phase === "writing") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: `What does "${entry.word}" mean?`,
        hasSubmitted: s.fakes[index] !== null,
        info: `Invent a definition for "${entry.word}"`,
      };
    }

    if (s.phase === "voting") {
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: optionsFor(inst, index),
        hasVoted: s.votes[index] !== null,
        info: "Pick the real definition",
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: `"${entry.word}" really means: ${entry.definition}`,
    };
  },
};

export default plugin;
