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







interface MStroke { points: Array<[number, number]>; color: string }

interface MonsterState {
  phase: "drawing" | "naming" | "vote" | "reveal" | "finished";
  pass: number;
  passes: number;
  drawn: boolean[];
  sheets: Array<Array<MStroke[] | null>>;
  names: Array<string | null>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { winner: number | null; namer: number | null } | null;
}

interface MonsterInstance extends GameInstance { state: MonsterState }

const DRAW_MS = 45000;
const NAME_MS = 30000;
const VOTE_MS = 25000;
const REVEAL_MS = 10000;
const MAX_NAME = 25;
const MAX_SECTION_POINTS = 12;

const manifest: GameManifest = {
  id: "mashup",
  name: "Mash-Up Monsters",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "canvas",
  description: "Everyone draws one section of a monster, then the sheets pass on. You only see a hint of what came before.",
};

/** Which sheet a player works on during a pass, so no sheet repeats a player. */
export function sheetFor(player: number, pass: number, playerCount: number): number {
  return (player + pass) % playerCount;
}

/** The favourite monster's namer takes 1000; everyone else takes 300. */
export function scoreMonsters(votes: Array<number | null>, namerOf: number[], playerCount: number): number[] {
  const tally = new Array<number>(playerCount).fill(0);
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0 || vote >= playerCount) continue;
    tally[vote]++;
  }
  const max = tally.length ? Math.max(...tally) : 0;
  const winner = max > 0 ? tally.findIndex((c) => c === max) : -1;
  return Array.from({ length: playerCount }, (_, i) => (i === (winner >= 0 ? namerOf[winner] : -1) ? 1000 : 300));
}

function mashLeader(instance: MonsterInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}


function nextPass(instance: MonsterInstance): void {
  const s = instance.state;
  s.pass++;
  s.drawn = instance.players.map(() => false);
  if (s.pass >= s.passes) {
    s.phase = "naming";
    s.timerMs = NAME_MS;
    return;
  }
  s.timerMs = DRAW_MS;
}

function mashSettle(instance: MonsterInstance): void {
  const s = instance.state;
  const namerOf = instance.players.map((_, i) => i);
  const points = scoreMonsters(s.votes, namerOf, instance.players.length);
  points.forEach((p, i) => { s.scores[i] += p; });
  const tally = instance.players.map((_, i) => s.votes.filter((v) => v === i).length);
  const max = tally.length ? Math.max(...tally) : 0;
  const winner = max > 0 ? tally.findIndex((c) => c === max) : -1;
  s.reveal = { winner: winner >= 0 ? winner : null, namer: winner >= 0 ? winner : null };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    const n = players.length;
    return {
      roomId: room.id,
      players,
      state: {
        phase: "drawing",
        pass: 0,
        passes: n,
        drawn: players.map(() => false),
        sheets: Array.from({ length: n }, () => Array.from({ length: n }, () => null)),
        names: players.map(() => null),
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: DRAW_MS,
        reveal: null,
      } satisfies MonsterState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as MonsterInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { stroke?: { points?: unknown; color?: unknown }; action?: unknown; text?: unknown; choice?: unknown } | null;

    if (s.phase === "drawing") {
      const sheet = sheetFor(index, s.pass, inst.players.length);
      const section = s.pass;
      if (raw?.stroke && Array.isArray(raw.stroke.points)) {
        const points = (raw.stroke.points as unknown[])
          .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === "number" && typeof pt[1] === "number")
          .slice(0, 300)
          .map(([x, y]) => [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [number, number]);
        if (points.length < 2) return;
        if (!s.sheets[sheet][section]) s.sheets[sheet][section] = [];
        s.sheets[sheet][section]!.push({ points, color: typeof raw.stroke.color === "string" ? raw.stroke.color : "#111111" });
        if (s.sheets[sheet][section]!.length > 150) s.sheets[sheet][section]!.shift();
        return;
      }
      if (raw?.action === "action") {
        if (!s.sheets[sheet][section]) s.sheets[sheet][section] = [{ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" }];
        s.drawn[index] = true;
        if (s.drawn.every((done) => done)) nextPass(inst);
      }
      return;
    }

    if (s.phase === "naming") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.names[index] === null) {
        s.names[index] = raw.text.trim().slice(0, MAX_NAME);
        if (s.names.every((n) => n !== null)) { s.phase = "vote"; s.timerMs = VOTE_MS; }
      }
      return;
    }

    if (s.phase === "vote") {
      if (typeof raw?.choice !== "string" || !raw.choice.startsWith("s:")) return;
      const target = Number(raw.choice.slice(2));
      if (!Number.isInteger(target) || target < 0 || target >= inst.players.length) return;
      if (target === index) return; // your own monster
      s.votes[index] = target;
      if (s.votes.every((v) => v !== null)) mashSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as MonsterInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "drawing") {
      const n = inst.players.length;
      for (let p = 0; p < n; p++) {
        const sheet = sheetFor(p, s.pass, n);
        if (!s.sheets[sheet][s.pass]) s.sheets[sheet][s.pass] = [{ points: [[0.2, 0.5], [0.8, 0.5]], color: "#111111" }];
      }
      nextPass(inst);
      return;
    }
    if (s.phase === "naming") {
      inst.players.forEach((_, i) => { if (!s.names[i]) s.names[i] = "The Unnamed"; });
      s.phase = "vote";
      s.timerMs = VOTE_MS;
      return;
    }
    if (s.phase === "vote") { mashSettle(inst); return; }
    s.phase = "finished";
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as MonsterInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      pass: s.pass + 1,
      passes: s.passes,
      sheets: revealed
        ? inst.players.map((p, i) => ({ name: s.names[i] ?? "The Unnamed", sections: s.sheets[i], votes: s.votes.filter((v) => v === i).length }))
        : [],
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? mashLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as MonsterInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && mashLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "drawing") {
      const sheet = sheetFor(index, s.pass, inst.players.length);
      const previous = s.pass > 0 ? s.sheets[sheet][s.pass - 1] : null;
      const hint = (previous ?? []).slice(-1).flatMap((stroke) => stroke.points.slice(-MAX_SECTION_POINTS));
      return {
        ...base,
        mode: "canvas",
        controllerType: "canvas",
        canvas: { prompt: `Section ${s.pass + 1} of ${s.passes}`, color: "#111111", disabled: false, hint },
        info: `Pass ${s.pass + 1} of ${s.passes}`,
      };
    }
    if (s.phase === "naming") {
      return { ...base, mode: "text", controllerType: "text", placeholder: "Name this monster", maxLength: MAX_NAME, hasSubmitted: s.names[index] !== null, info: "Name the monster you can see" };
    }
    if (s.phase === "vote") {
      const options = inst.players
        .map((_, i) => ({ id: `s:${i}`, label: s.names[i] ?? "The Unnamed" }))
        .filter((_, i) => i !== index);
      return { ...base, mode: "choice", controllerType: "choice", options, hasVoted: s.votes[index] !== null, info: "Favourite monster?" };
    }
    return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Monsters revealed" };
  },
};

export default plugin;
