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



interface FakinState {
  round: number;
  maxRounds: number;
  phase: "acting" | "voting" | "reveal" | "finished";
  faker: number;
  realPrompt: string;
  fakePrompt: string;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { accused: number | null; caught: boolean } | null;
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

const ACT_MS = 25000;
const VOTE_MS = 20000;
const REVEAL_MS = 8000;

const manifest: GameManifest = {
  id: "fakin",
  name: "Fakin' It",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "choice",
  description: "Everyone gets the same instruction except one Faker, who has to bluff. Then everyone votes on who was faking.",
};

function fakinLeader(instance: FakinInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function fakinBegin(instance: FakinInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.faker = round % instance.players.length;
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

function fakinSettle(instance: FakinInstance): void {
  const s = instance.state;
  const tally = instance.players.map(() => 0);
  for (let i = 0; i < instance.players.length; i++) {
    const v = s.votes[i];
    if (v !== null && v >= 0 && v < tally.length) tally[v]++;
  }
  let accused = -1;
  let best = 0;
  let tie = false;
  tally.forEach((count, i) => {
    if (count > best) { best = count; accused = i; tie = false; }
    else if (count === best && count > 0) tie = true;
  });
  const caught = accused === s.faker && !tie;
  if (caught) {
    for (let i = 0; i < instance.players.length; i++) {
      if (s.votes[i] === s.faker) s.scores[i] += 200;
    }
  } else {
    s.scores[s.faker] += 500;
  }
  s.reveal = { accused: accused >= 0 ? accused : null, caught };
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
        maxRounds: 3,
        phase: "acting",
        faker: 0,
        realPrompt: REAL_PROMPTS[0],
        fakePrompt: FAKE_PROMPTS[0],
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: ACT_MS,
        reveal: null,
      } satisfies FakinState,
    };
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
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      instruction: s.phase === "reveal" ? null : s.realPrompt,
      fakerName: s.phase === "reveal" || s.phase === "finished" ? inst.players[s.faker]?.name : null,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
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
};

export default plugin;
