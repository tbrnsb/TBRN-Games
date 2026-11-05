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



interface SpudState {
  anchor: string;
  round: number;
  maxRounds: number;
  phase: "submitting" | "voting" | "reveal" | "finished";
  current: number;
  word: string | null;
  votes: Array<"accept" | "reject" | null>;
  scores: number[];
  timerMs: number;
  reveal: { accepted: boolean; word: string } | null;
}

interface SpudInstance extends GameInstance { state: SpudState }

const manifest: GameManifest = {
  id: "wordspud",
  name: "Word Spud",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "text",
  description: "Chain words by association. Everyone else votes accept or reject on every link.",
};

function spudLeader(instance: SpudInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function spudBegin(instance: SpudInstance, round: number, anchor: string): void {
  const s = instance.state;
  s.round = round;
  s.anchor = anchor;
  s.current = round % instance.players.length;
  s.word = null;
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = 20000;
  s.phase = "submitting";
}

function spudVoted(instance: SpudInstance): boolean {
  const s = instance.state;
  return instance.players.every((_, i) => i === s.current || s.votes[i] !== null);
}

function spudSettle(instance: SpudInstance): void {
  const s = instance.state;
  const word = s.word ?? "nothing";
  let accept = 0;
  let reject = 0;
  for (let i = 0; i < instance.players.length; i++) {
    if (i === s.current) continue;
    if (s.votes[i] === "accept") accept++;
    if (s.votes[i] === "reject") reject++;
  }
  const accepted = accept >= reject;
  if (accepted) s.scores[s.current] += 100;
  else s.scores[s.current] = Math.max(0, s.scores[s.current] - 50);
  s.reveal = { accepted, word };
  s.phase = "reveal";
  s.timerMs = 6000;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    return {
      roomId: room.id,
      players,
      state: {
        anchor: "hot",
        round: 0,
        maxRounds: 6,
        phase: "submitting",
        current: 0,
        word: null,
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: 20000,
        reveal: null,
      } satisfies SpudState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as SpudInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "submitting" && index === s.current) {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.word = raw.text.trim().slice(0, 40);
        s.phase = "voting";
        s.timerMs = 12000;
      }
      return;
    }
    if (s.phase === "voting" && index !== s.current) {
      if (raw?.choice === "accept" || raw?.choice === "reject") {
        s.votes[index] = raw.choice;
        if (spudVoted(inst)) spudSettle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as SpudInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    if (s.phase === "submitting") {
      if (!s.word) s.word = "mystery";
      s.phase = "voting";
      s.timerMs = 12000;
      return;
    }
    if (s.phase === "voting") { spudSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    spudBegin(inst, next, s.reveal?.accepted ? (s.reveal.word) : s.anchor);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as SpudInstance;
    const s = inst.state;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      anchor: s.anchor,
      word: s.phase === "voting" || s.phase === "reveal" ? s.word : null,
      currentName: inst.players[s.current]?.name ?? "",
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? spudLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as SpudInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && spudLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "submitting") {
      if (index === s.current) {
        return {
          ...base,
          mode: "text",
          controllerType: "text",
          placeholder: `A word that follows "${s.anchor}"`,
          hasSubmitted: false,
          info: `Your turn. Anchor word: ${s.anchor}`,
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: `${inst.players[s.current].name} is thinking of a word...`,
      };
    }
    if (s.phase === "voting") {
      if (index === s.current) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: `You said "${s.word}"` };
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [
          { id: "accept", label: "ACCEPT" },
          { id: "reject", label: "REJECT" },
        ],
        hasVoted: s.votes[index] !== null,
        info: `${inst.players[s.current].name}: "${s.word}" after "${s.anchor}"`,
      };
    }
    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal ? (s.reveal.accepted ? `Accepted: ${s.reveal.word}` : `Rejected: ${s.reveal.word}`) : "",
    };
  },
};

export default plugin;
