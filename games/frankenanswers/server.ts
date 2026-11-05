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

/** author: >= 0 is a player seat, -1 is the content pack, -2 is a connector. */
export interface FaTile { id: string; text: string; author: number }

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_WORDS: Array<{ id: string; text: string }> = JSON.parse(
  readFileSync(join(HERE, "content", "chips.json"), "utf8"),
) as Array<{ id: string; text: string }>;

export const CONNECTORS: FaTile[] = ["the", "and", "my", "but"].map((text, i) => ({ id: `k:${i}`, text, author: -2 }));

const PROMPTS = ["a place", "an excuse", "something sticky", "a job title", "a smell", "a family member", "a sound", "something in a bag"];

interface FaAnswer { author: number; text: string; chipIds: string[] }

interface FaState {
  round: number;
  maxRounds: number;
  phase: "chips" | "build" | "vote" | "reveal" | "finished";
  prompt: string;
  tiles: FaTile[];
  submitted: number[];
  pools: string[][];
  build: Array<string[] | null>;
  answers: Array<FaAnswer | null>;
  votes: Array<string | null>;
  scores: number[];
  timerMs: number;
  reveal: { winners: number[]; rows: Array<{ text: string; author: number; votes: number }> } | null;
}

interface FaInstance extends GameInstance { state: FaState }

const CHIPS_MS = 60000;
const BUILD_MS = 90000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_CHIP = 18;

const manifest: GameManifest = {
  id: "frankenanswers",
  name: "Frankenanswers",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "rank",
  description: "Everyone writes three word chips, then builds the best answer out of other people's words.",
};

/**
 * Deal each player six chips written by OTHER players, plus the four connector
 * tiles. If there are too few foreign chips, top up from the content pack.
 */
export function dealPools(tiles: FaTile[], playerCount: number): string[][] {
  const chips = tiles.filter((t) => t.author >= 0);
  const pack = tiles.filter((t) => t.author === -1);
  const connectors = CONNECTORS.map((c) => c.id);
  const pools: string[][] = [];
  for (let p = 0; p < playerCount; p++) {
    const picked = chips.filter((c) => c.author !== p).slice(0, 6).map((c) => c.id);
    let cursor = 0;
    while (picked.length < 6 && pack.length > 0) {
      const tile = pack[(p * 3 + cursor) % pack.length];
      if (!picked.includes(tile.id)) picked.push(tile.id);
      cursor++;
      if (cursor > pack.length * 2) break;
    }
    pools.push([...picked, ...connectors]);
  }
  return pools;
}

/** Validate an ordered list of tile ids against the player's own pool. */
export function composeAnswer(order: string[], pool: string[], tiles: FaTile[]): { ok: boolean; text: string; chipIds: string[] } {
  const fail = { ok: false, text: "", chipIds: [] as string[] };
  if (order.length === 0) return fail;
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const words: string[] = [];
  const chipIds: string[] = [];
  let connectors = 0;

  for (const id of order) {
    if (seen.has(id)) return fail;
    seen.add(id);
    if (!pool.includes(id)) return fail;
    const tile = byId.get(id);
    if (!tile) return fail;
    if (tile.author === -2) connectors++;
    else chipIds.push(id);
    words.push(tile.text);
  }

  if (chipIds.length < 3 || chipIds.length > 4) return fail;
  if (connectors > 2) return fail;
  if (words.length > 6) return fail;
  return { ok: true, text: words.join(" "), chipIds };
}

function faLeader(instance: FaInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function faPackTiles(): FaTile[] {
  return PACK_WORDS.map((p) => ({ id: p.id, text: p.text, author: -1 }));
}

function faBegin(instance: FaInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.prompt = PROMPTS[round % PROMPTS.length];
  s.tiles = faPackTiles();
  s.submitted = instance.players.map(() => 0);
  s.pools = instance.players.map(() => []);
  s.build = instance.players.map(() => null);
  s.answers = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = CHIPS_MS;
  s.phase = "chips";
}

function faEnterBuild(instance: FaInstance): void {
  const s = instance.state;
  s.pools = dealPools(s.tiles, instance.players.length);
  s.phase = "build";
  s.timerMs = BUILD_MS;
}

function faEnterVote(instance: FaInstance): void {
  const s = instance.state;
  s.phase = "vote";
  s.timerMs = VOTE_MS;
}

function faSettle(instance: FaInstance): void {
  const s = instance.state;
  const tally = s.answers.map(() => 0);
  for (const vote of s.votes) {
    if (typeof vote !== "string" || !vote.startsWith("a")) continue;
    const idx = Number(vote.slice(1));
    if (Number.isInteger(idx) && idx >= 0 && idx < tally.length) tally[idx]++;
  }
  const max = tally.length ? Math.max(...tally) : 0;
  const winners = max > 0 ? tally.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0) : [];

  tally.forEach((count, i) => {
    const answer = s.answers[i];
    if (answer && count > 0) s.scores[answer.author] += 1000 * count;
  });

  for (const wi of winners) {
    const answer = s.answers[wi];
    if (!answer) continue;
    for (const chipId of answer.chipIds) {
      const tile = s.tiles.find((t) => t.id === chipId);
      if (tile && tile.author >= 0) s.scores[tile.author] += 100;
    }
  }

  s.reveal = {
    winners,
    rows: s.answers.map((a, i) => ({ text: a?.text ?? "", author: a?.author ?? -1, votes: tally[i] })),
  };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
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
        phase: "chips",
        prompt: PROMPTS[0],
        tiles: faPackTiles(),
        submitted: players.map(() => 0),
        pools: players.map(() => []),
        build: players.map(() => null),
        answers: players.map(() => null),
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: CHIPS_MS,
        reveal: null,
      } satisfies FaState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as FaInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; rank?: { order?: unknown }; choice?: unknown } | null;

    if (s.phase === "chips") {
      if (typeof raw?.text !== "string" || s.submitted[index] >= 3) return;
      const text = raw.text.trim().slice(0, MAX_CHIP);
      if (!text) return;
      s.tiles.push({ id: `c:${index}:${s.submitted[index]}`, text, author: index });
      s.submitted[index]++;
      if (s.submitted.every((n) => n >= 3)) faEnterBuild(inst);
      return;
    }

    if (s.phase === "build") {
      if (!Array.isArray(raw?.rank?.order)) return;
      const order = (raw.rank.order as unknown[]).map(String);
      const result = composeAnswer(order, s.pools[index], s.tiles);
      if (!result.ok) return;
      s.build[index] = order;
      s.answers[index] = { author: index, text: result.text, chipIds: result.chipIds };
      if (s.answers.every((a) => a !== null)) faEnterVote(inst);
      return;
    }

    if (s.phase === "vote") {
      if (typeof raw?.choice !== "string" || !raw.choice.startsWith("a")) return;
      const target = Number(raw.choice.slice(1));
      if (!Number.isInteger(target) || target < 0 || target >= inst.players.length) return;
      if (target === index || !s.answers[target]) return;
      s.votes[index] = raw.choice;
      if (s.votes.every((v) => v !== null)) faSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as FaInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "chips") {
      // Timed out: top each player up from the pack so the round can continue.
      const pack = s.tiles.filter((t) => t.author === -1);
      inst.players.forEach((_, p) => {
        while (s.submitted[p] < 3 && pack.length > 0) {
          const tile = pack[(p + s.submitted[p]) % pack.length];
          if (!s.tiles.some((t) => t.id === tile.id && t.author === p)) {
            s.tiles.push({ id: `c:${p}:${s.submitted[p]}`, text: tile.text, author: p });
          }
          s.submitted[p]++;
        }
      });
      faEnterBuild(inst);
      return;
    }
    if (s.phase === "build") {
      inst.players.forEach((_, p) => {
        if (s.answers[p]) return;
        const order = s.pools[p].filter((id) => !id.startsWith("k:")).slice(0, 3);
        const result = composeAnswer(order, s.pools[p], s.tiles);
        s.build[p] = order;
        s.answers[p] = result.ok
          ? { author: p, text: result.text, chipIds: result.chipIds }
          : { author: p, text: "no answer", chipIds: [] };
      });
      faEnterVote(inst);
      return;
    }
    if (s.phase === "vote") { faSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    faBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as FaInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      prompt: s.prompt,
      chipCounts: inst.players.map((p, i) => ({ name: p.name, chips: s.submitted[i] })),
      // Anonymous composed answers, no authors until the reveal.
      options: s.phase === "vote" || revealed
        ? s.answers.map((a, i) => ({ id: `a${i}`, text: a?.text ?? "", author: revealed ? (a?.author ?? -1) : -1, votes: revealed ? (s.reveal?.rows[i]?.votes ?? 0) : 0 }))
        : [],
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? faLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as FaInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && faLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "chips") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: s.prompt,
        maxLength: MAX_CHIP,
        hasSubmitted: s.submitted[index] >= 3,
        info: `Chip ${Math.min(3, s.submitted[index] + 1)} of 3`,
      };
    }

    if (s.phase === "build") {
      const items = s.pools[index].map((id) => {
        const tile = s.tiles.find((t) => t.id === id);
        return { id, label: `${tile?.text ?? id}${id.startsWith("k:") ? " (link)" : ""}` };
      });
      return {
        ...base,
        mode: "rank",
        controllerType: "rank",
        rank: { items, order: [], submitLabel: "Submit answer", disabled: false, hasSubmitted: s.answers[index] !== null, min: 3, max: 6 },
        info: "Tap 3-4 chips in order. Links are optional.",
      };
    }

    if (s.phase === "vote") {
      const options = s.answers
        .map((a, i) => ({ id: `a${i}`, label: a?.text ?? "" }))
        .filter((_, i) => i !== index && s.answers[i] !== null);
      return { ...base, mode: "choice", controllerType: "choice", options, hasVoted: s.votes[index] !== null, info: "Best answer?" };
    }

    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? "Round complete" : "" };
  },
};

export default plugin;
