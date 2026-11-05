/**
 * Slogan Shirts - server logic.
 * Draw a design, write a slogan, then everyone gets someone else's slogan on their shirt and you vote for the best.
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






interface ShirtStroke { points: Array<[number, number]>; color: string }

interface ShirtState {
  round: number;
  maxRounds: number;
  phase: "draw" | "slogan" | "vote" | "reveal" | "finished";
  designs: Array<ShirtStroke[] | null>;
  slogans: Array<string | null>;
  shirts: Array<{ design: number; slogan: number }>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { winners: number[]; rows: Array<{ text: string; votes: number }> } | null;
}

interface ShirtInstance extends GameInstance { state: ShirtState }

const DRAW_MS = 60000;
const SLOGAN_MS = 30000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;
const MAX_SLOGAN = 40;

const manifest: GameManifest = {
  id: "sloganshirts",
  name: "Slogan Shirts",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "canvas",
  description: "Draw a design, write a slogan, then everyone gets someone else's slogan on their shirt and you vote for the best.",
};

/** Rotate slogans by one so nobody's design carries their own slogan. */
export function buildShirts(playerCount: number): Array<{ design: number; slogan: number }> {
  const shirts: Array<{ design: number; slogan: number }> = [];
  for (let i = 0; i < playerCount; i++) {
    shirts.push({ design: i, slogan: (i + 1) % playerCount });
  }
  return shirts;
}

/** Winning shirt pays both authors 1000; every other shirt pays 100 per vote. */
export function scoreShirts(votes: Array<number | null>, shirts: Array<{ design: number; slogan: number }>, playerCount: number): number[] {
  const tally = new Array<number>(shirts.length).fill(0);
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= shirts.length) continue;
    tally[vote]++;
  }
  const max = tally.length ? Math.max(...tally) : 0;
  const points = new Array<number>(playerCount).fill(0);

  tally.forEach((count, shirtIndex) => {
    if (count <= 0) return;
    const shirt = shirts[shirtIndex];
    const per = count === max && max > 0 ? 1000 : 100 * count;
    points[shirt.design] += per;
    points[shirt.slogan] += per;
  });
  return points;
}

function shirtLeader(instance: ShirtInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function shirtBegin(instance: ShirtInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.designs = instance.players.map(() => null);
  s.slogans = instance.players.map(() => null);
  s.shirts = [];
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = DRAW_MS;
  s.phase = "draw";
}

function enterVote(instance: ShirtInstance): void {
  const s = instance.state;
  s.shirts = buildShirts(instance.players.length);
  s.phase = "vote";
  s.timerMs = VOTE_MS;
}

function settle(instance: ShirtInstance): void {
  const s = instance.state;
  const points = scoreShirts(s.votes, s.shirts, instance.players.length);
  points.forEach((p, i) => { s.scores[i] += p; });
  const tally = s.shirts.map((_, i) => s.votes.filter((v) => v === i).length);
  const max = tally.length ? Math.max(...tally) : 0;
  const winners = max > 0 ? tally.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0) : [];
  s.reveal = { winners, rows: s.shirts.map((shirt, i) => ({ text: s.slogans[shirt.slogan] ?? "", votes: tally[i] })) };
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
        phase: "draw",
        designs: players.map(() => null),
        slogans: players.map(() => null),
        shirts: [],
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: DRAW_MS,
        reveal: null,
      } satisfies ShirtState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { stroke?: { points?: unknown; color?: unknown }; action?: unknown; text?: unknown; choice?: unknown } | null;

    if (s.phase === "draw") {
      if (raw?.stroke && Array.isArray(raw.stroke.points)) {
        const points = (raw.stroke.points as unknown[])
          .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number")
          .slice(0, 300)
          .map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [number, number]);
        if (points.length < 2) return;
        if (!s.designs[index]) s.designs[index] = [];
        s.designs[index].push({ points, color: typeof raw.stroke.color === "string" ? raw.stroke.color : "#111111" });
        if (s.designs[index].length > 200) s.designs[index].shift();
        return;
      }
      if (raw?.action === "action") {
        if (!s.designs[index] || s.designs[index].length === 0) s.designs[index] = [{ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" }];
        if (s.designs.every((d) => d !== null)) { s.phase = "slogan"; s.timerMs = SLOGAN_MS; }
      }
      return;
    }

    if (s.phase === "slogan") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.slogans[index] === null) {
        s.slogans[index] = raw.text.trim().slice(0, MAX_SLOGAN);
        if (s.slogans.every((t) => t !== null)) enterVote(inst);
      }
      return;
    }

    if (s.phase === "vote") {
      if (typeof raw?.choice !== "string" || !raw.choice.startsWith("s:")) return;
      const target = Number(raw.choice.slice(2));
      if (!Number.isInteger(target) || target < 0 || target >= s.shirts.length) return;
      const shirt = s.shirts[target];
      // Only the design's owner is barred: with three players, excluding the
      // slogan author too leaves every voter exactly one option.
      if (shirt.design === index) return;
      s.votes[index] = target;
      if (s.votes.every((v) => v !== null)) settle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "draw") {
      inst.players.forEach((_, i) => {
        if (!s.designs[i] || s.designs[i]!.length === 0) s.designs[i] = [{ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" }];
      });
      s.phase = "slogan";
      s.timerMs = SLOGAN_MS;
      return;
    }
    if (s.phase === "slogan") {
      inst.players.forEach((_, i) => { if (!s.slogans[i]) s.slogans[i] = "no slogan"; });
      enterVote(inst);
      return;
    }
    if (s.phase === "vote") { settle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    shirtBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      shirts: s.shirts.map((shirt, i) => ({
        id: `s:${i}`,
        design: s.designs[shirt.design] ?? [],
        slogan: s.slogans[shirt.slogan] ?? "",
        votes: revealed ? (s.reveal?.rows[i]?.votes ?? 0) : null,
        author: revealed ? inst.players[shirt.design]?.name : null,
      })),
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? shirtLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as ShirtInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && shirtLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "draw") {
      return { ...base, mode: "canvas", controllerType: "canvas", canvas: { prompt: "Design a t-shirt", color: "#111111", disabled: false } };
    }
    if (s.phase === "slogan") {
      return { ...base, mode: "text", controllerType: "text", placeholder: "The slogan", maxLength: MAX_SLOGAN, hasSubmitted: s.slogans[index] !== null, info: "Write a short slogan" };
    }
    if (s.phase === "vote") {
      const options = s.shirts
        .map((shirt, i) => ({ id: `s:${i}`, label: s.slogans[shirt.slogan] ?? "" }))
        .filter((_, i) => s.shirts[i].design !== index);
      return { ...base, mode: "choice", controllerType: "choice", options, hasVoted: s.votes[index] !== null, info: "Best shirt?" };
    }
    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? "Round complete" : "" };
  },
};

export default plugin;
