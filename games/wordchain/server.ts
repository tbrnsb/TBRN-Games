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






import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORDS: Array<{ text: string }> = JSON.parse(readFileSync(join(HERE, "content", "words.json"), "utf8")) as Array<{ text: string }>;
const DICT = new Set(WORDS.map((w) => w.text));

interface ChainState {
  phase: "playing" | "finished";
  chain: string[];
  used: string[];
  current: number;
  lives: number[];
  out: boolean[];
  eliminated: number[];
  scores: number[];
  lastLetter: string;
  timerMs: number;
  lastEvent: string | null;
  winnerIndex: number | null;
}

interface ChainInstance extends GameInstance { state: ChainState }

const TURN_MS = 15000;
const START_LIVES = 2;
const PLACEMENT = [1000, 600, 300, 100];

const manifest: GameManifest = {
  id: "wordchain",
  name: "Word Chain",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "text",
  description: "Chain words: each one must start with the last letter of the one before. Miss and lose a life.",
};

/** Strip anything that is not a letter, so "Apple!" becomes "apple". */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, "");
}

export function validateWord(raw: string, lastLetter: string, used: string[], dict: Set<string>): { ok: boolean; word: string; reason?: string } {
  const word = normalizeWord(raw);
  if (word.length < 2) return { ok: false, word, reason: "Too short" };
  if (word[0] !== lastLetter) return { ok: false, word, reason: `Must start with ${lastLetter.toUpperCase()}` };
  if (used.includes(word)) return { ok: false, word, reason: "Already used" };
  if (!dict.has(word)) return { ok: false, word, reason: "Not in the dictionary" };
  return { ok: true, word };
}

function chainLeader(instance: ChainInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function living(instance: ChainInstance): number[] {
  return instance.state.out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
}

function nextLiving(instance: ChainInstance, from: number): number {
  const count = instance.players.length;
  for (let step = 1; step <= count; step++) {
    const i = (from + step) % count;
    if (!instance.state.out[i]) return i;
  }
  return -1;
}

function finishChain(instance: ChainInstance): void {
  const s = instance.state;
  const alive = living(instance);
  const winner = alive.length === 1 ? alive[0] : (alive[0] ?? -1);
  s.winnerIndex = winner >= 0 ? winner : null;
  if (winner >= 0) s.scores[winner] = PLACEMENT[0];
  // Second place is the last player eliminated, then backwards.
  const rest = [...s.eliminated].reverse().filter((i) => i !== winner);
  rest.forEach((playerIndex, i) => {
    const place = i + 1;
    if (place < PLACEMENT.length) s.scores[playerIndex] = PLACEMENT[place];
  });
  s.phase = "finished";
}

function passTurn(instance: ChainInstance): void {
  const s = instance.state;
  if (s.phase !== "playing") return;
  if (living(instance).length <= 1) { finishChain(instance); return; }
  const next = nextLiving(instance, s.current);
  if (next === -1) { finishChain(instance); return; }
  s.current = next;
  s.timerMs = TURN_MS;
}

function loseLife(instance: ChainInstance, index: number, reason: string): void {
  const s = instance.state;
  s.lives[index]--;
  if (s.lives[index] <= 0) {
    s.out[index] = true;
    s.eliminated.push(index);
    s.lastEvent = `${instance.players[index].name} is out (${reason})`;
  } else {
    s.lastEvent = `${instance.players[index].name}: ${reason} - ${s.lives[index]} lives left`;
  }
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    const start = WORDS[secureRandomInt(0, WORDS.length)].text;
    return {
      roomId: room.id,
      players,
      state: {
        phase: "playing",
        chain: [start],
        used: [start],
        current: 0,
        lives: players.map(() => START_LIVES),
        out: players.map(() => false),
        eliminated: [],
        scores: players.map(() => 0),
        lastLetter: start[start.length - 1],
        timerMs: TURN_MS,
        lastEvent: `Starting word: ${start}`,
        winnerIndex: null,
      } satisfies ChainState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as ChainInstance;
    const s = inst.state;
    if (s.phase !== "playing") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1 || index !== s.current || s.out[index]) return;
    const raw = (input as { text?: unknown } | null)?.text;
    if (typeof raw !== "string") return;

    const result = validateWord(raw, s.lastLetter, s.used, DICT);
    if (!result.ok) {
      loseLife(inst, index, result.reason ?? "Invalid word");
      passTurn(inst);
      return;
    }

    s.chain.push(result.word);
    s.used.push(result.word);
    s.lastLetter = result.word[result.word.length - 1];
    s.lastEvent = `${inst.players[index].name} played ${result.word}`;
    s.timerMs = TURN_MS;
    passTurn(inst);
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as ChainInstance;
    const s = inst.state;
    if (s.phase !== "playing") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    loseLife(inst, s.current, "Out of time");
    passTurn(inst);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as ChainInstance;
    const s = inst.state;
    return {
      phase: s.phase,
      chain: s.chain.slice(-12),
      lastLetter: s.lastLetter,
      currentName: s.phase === "playing" ? inst.players[s.current]?.name ?? "" : null,
      lastEvent: s.lastEvent,
      players: inst.players.map((p, i) => ({ name: p.name, lives: s.lives[i], out: s.out[i] })),
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? chainLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as ChainInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const yourTurn = s.phase === "playing" && index === s.current && !s.out[index];
    const base = {
      yourScore: s.scores[index],
      lives: s.lives[index],
      out: s.out[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && chainLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "finished") {
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Game over" };
    }
    if (yourTurn) {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: `A word starting with ${s.lastLetter.toUpperCase()}`,
        maxLength: 20,
        info: `Your turn - ${s.lives[index]} ${s.lives[index] === 1 ? "life" : "lives"} left`,
      };
    }
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.out[index] ? "You are out - watching" : `Waiting for ${inst.players[s.current]?.name ?? ""}`,
    };
  },
};

export default plugin;
