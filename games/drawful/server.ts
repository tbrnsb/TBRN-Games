/**
 * Drawful - server logic.
 * Draw a ridiculous prompt on your phone, then lie about everyone else's drawings.
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



interface Stroke { points: Array<[number, number]>; color: string }

interface DrawState {
  round: number;
  maxRounds: number;
  phase: "drawing" | "bluffing" | "voting" | "reveal" | "finished";
  drawer: number;
  prompt: string;
  strokes: Stroke[];
  bluffs: Array<string | null>;
  votes: Array<string | null>;
  order: string[];
  scores: number[];
  timerMs: number;
  reveal: { realVotes: number; bluffVotes: number[] } | null;
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
];

const DRAW_MS = 60000;
const BLUFF_MS = 35000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;

const manifest: GameManifest = {
  id: "drawful",
  name: "Drawful",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "canvas",
  description: "One player draws a ridiculous prompt on their phone. Everyone else writes a convincing lie. Vote for the truth.",
};

function leaderName(instance: DrawInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
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
  s.drawer = round % instance.players.length;
  s.prompt = PROMPTS[round % PROMPTS.length];
  s.strokes = [];
  s.bluffs = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.order = [];
  s.reveal = null;
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
  let realVotes = 0;
  const bluffVotes = instance.players.map(() => 0);
  for (let i = 0; i < instance.players.length; i++) {
    const vote = s.votes[i];
    if (!vote || i === s.drawer) continue;
    if (vote === "real") {
      realVotes++;
      continue;
    }
    const author = Number(vote.slice(2));
    if (Number.isInteger(author) && author >= 0) bluffVotes[author]++;
  }
  s.scores[s.drawer] += realVotes * 500;
  bluffVotes.forEach((count, i) => { s.scores[i] += count * 250; });
  s.reveal = { realVotes, bluffVotes };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

function optionsFor(instance: DrawInstance, viewer: number): Array<{ id: string; label: string }> {
  const s = instance.state;
  const ids = s.order.length ? s.order : ["real"];
  return ids
    .filter((id) => id !== `b:${viewer}`)
    .map((id) => ({ id, label: id === "real" ? s.prompt : (s.bluffs[Number(id.slice(2))] ?? "") }));
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: Math.min(3, players.length),
        phase: "drawing",
        drawer: 0,
        prompt: PROMPTS[0],
        strokes: [],
        bluffs: players.map(() => null),
        votes: players.map(() => null),
        order: [],
        scores: players.map(() => 0),
        timerMs: DRAW_MS,
        reveal: null,
      } satisfies DrawState,
    };
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
        s.bluffs[index] = raw.text.trim().slice(0, 100);
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
      if (raw.choice === `b:${index}`) return;
      if (!s.order.includes(raw.choice)) return;
      s.votes[index] = raw.choice;
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

  screenState(instance: GameInstance): unknown {
    const inst = instance as DrawInstance;
    const s = inst.state;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      drawerName: inst.players[s.drawer]?.name ?? "",
      strokes: s.strokes,
      options: s.phase === "voting" || s.phase === "reveal" ? optionsFor(inst, -1) : [],
      realPrompt: s.phase === "reveal" ? s.prompt : null,
      reveal: s.reveal,
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
        options: optionsFor(inst, index),
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
};

export default plugin;
