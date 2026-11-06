/**
 * Blind Date Chat - server logic.
 * One Dater, everyone else a Candidate with a secret persona. Chat privately, then get picked.
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
  | "role";

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




interface DateMsg { from: number; to: number; text: string }

interface DateState {
  round: number;
  maxRounds: number;
  phase: "brief" | "chat" | "pick" | "reveal" | "finished";
  dater: number;
  personas: Array<string | null>;
  messages: DateMsg[];
  lols: number[];
  lastSender: number;
  pick: number | null;
  scores: number[];
  timerMs: number;
  elapsedMs: number;
  lastChatMs: number[];
  reveal: { picked: number | null; lols: number[] } | null;
}

interface DateInstance extends GameInstance { state: DateState }

const PERSONAS = [
  "a pirate who only talks about taxes",
  "a fitness influencer with no gym membership",
  "a ghost who is afraid of the dark",
  "a chef who cannot taste anything",
  "a lawyer for houseplants",
  "a time traveller stuck in this week",
  "a professional napper who is always tired",
  "a sports commentator for grocery shopping",
  "a magician whose tricks never work",
  "a life coach who lives with their parents",
];

const BRIEF_MS = 6000;
const CHAT_MS = 60000;
const PICK_MS = 20000;
const REVEAL_MS = 9000;
const CHAT_COOLDOWN_MS = 700;

const manifest: GameManifest = {
  id: "bdate",
  name: "Blind Date Chat",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "chat",
  description: "One Dater, everyone else is a Candidate with a secret persona. Chat privately, then get picked.",
};

/** Pure scoring for the round. */
export function scoreDate(lols: number[], pick: number | null, dater: number): number[] {
  // LOLs are the Dater's taps, so the Dater never earns per-LOL; candidates do.
  const points = lols.map((n, i) => (i === dater ? 0 : n * 100));
  if (pick !== null && pick >= 0 && pick < points.length && pick !== dater) points[pick] += 1000;
  const daterLols = lols[dater] ?? 0;
  points[dater] = (points[dater] ?? 0) + (daterLols >= 3 ? 300 : 0);
  return points;
}

function dateLeader(instance: DateInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function dateBegin(instance: DateInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.dater = round % instance.players.length;
  s.personas = instance.players.map((_, i) => (i === s.dater ? null : PERSONAS[(round + i) % PERSONAS.length]));
  s.messages = [];
  s.lols = instance.players.map(() => 0);
  s.lastSender = -1;
  s.pick = null;
  s.reveal = null;
  s.lastChatMs = instance.players.map(() => -9999);
  s.timerMs = BRIEF_MS;
  s.phase = "brief";
}

function dateSettle(instance: DateInstance): void {
  const s = instance.state;
  const points = scoreDate(s.lols, s.pick, s.dater);
  points.forEach((p, i) => { s.scores[i] += p; });
  s.reveal = { picked: s.pick, lols: [...s.lols] };
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
        maxRounds: players.length,
        phase: "brief",
        dater: 0,
        personas: players.map(() => null),
        messages: [],
        lols: players.map(() => 0),
        lastSender: -1,
        pick: null,
        scores: players.map(() => 0),
        timerMs: BRIEF_MS,
        elapsedMs: 0,
        lastChatMs: players.map(() => -9999),
        reveal: null,
      } satisfies DateState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as DateInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { chat?: { to?: unknown; text?: unknown }; action?: unknown; choice?: unknown } | null;

    if (s.phase === "chat") {
      if (raw?.chat && typeof raw.chat.text === "string") {
        const text = raw.chat.text.trim().slice(0, 140);
        if (!text) return;
        if (s.elapsedMs - s.lastChatMs[index] < CHAT_COOLDOWN_MS) return;
        s.lastChatMs[index] = s.elapsedMs;
        s.messages.push({ from: index, to: index === s.dater ? -1 : s.dater, text });
        s.lastSender = index;
        if (s.messages.length > 200) s.messages.shift();
        return;
      }
      if (raw?.action === "lol" && index === s.dater) {
        if (s.lastSender >= 0 && s.lastSender !== s.dater) s.lols[s.lastSender]++;
      }
      return;
    }

    if (s.phase === "pick" && index === s.dater) {
      if (typeof raw?.choice === "string" && raw.choice.startsWith("p:")) {
        const target = Number(raw.choice.slice(2));
        if (!Number.isInteger(target) || target < 0 || target >= inst.players.length || target === s.dater) return;
        s.pick = target;
        dateSettle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as DateInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);
    s.timerMs -= dt;
    if (s.phase === "chat") s.elapsedMs += dt;
    if (s.timerMs > 0) return;
    if (s.phase === "brief") { s.phase = "chat"; s.timerMs = CHAT_MS; return; }
    if (s.phase === "chat") { s.phase = "pick"; s.timerMs = PICK_MS; return; }
    if (s.phase === "pick") { dateSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    dateBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as DateInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      daterName: inst.players[s.dater]?.name ?? "",
      // Message text is NEVER on the shared screen, only counts.
      messageCounts: inst.players.map((p, i) => ({
        name: p.name,
        sent: s.messages.filter((m) => m.from === i).length,
        lols: s.lols[i],
      })),
      pickedName: revealed && s.reveal?.picked !== null && s.reveal?.picked !== undefined
        ? inst.players[s.reveal.picked].name
        : null,
      personas: revealed ? inst.players.map((p, i) => ({ name: p.name, persona: s.personas[i] })) : [],
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? dateLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as DateInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && dateLeader(inst) === inst.players[index].name,
    };
    const isDater = index === s.dater;

    if (s.phase === "brief") {
      return {
        ...base,
        mode: "wait",
        controllerType: "role",
        role: {
          title: isDater ? "You are the DATER" : "Your secret persona",
          body: isDater ? "Three strangers will chat you up. Pick your favourite." : (s.personas[index] ?? ""),
          holdLabel: "HOLD TO VIEW",
          secret: !isDater,
        },
      };
    }

    if (s.phase === "chat") {
      // Each phone sees only the messages it took part in.
      const thread = s.messages
        .filter((m) => (isDater ? true : m.from === index || m.to === index))
        .map((m) => ({ from: inst.players[m.from]?.name ?? "", text: m.text }));
      const contacts = isDater
        ? inst.players.map((p, i) => ({ id: `p:${i}`, name: p.name })).filter((_, i) => i !== s.dater)
        : [{ id: `p:${s.dater}`, name: inst.players[s.dater].name }];
      return {
        ...base,
        mode: "chat",
        controllerType: "chat",
        chat: { contacts, thread, remaining: -1, disabled: false, placeholder: "Say something charming" },
        info: isDater ? "Tap LOL when a message lands" : "",
      };
    }

    if (s.phase === "pick") {
      if (isDater) {
        const options = inst.players.map((p, i) => ({ id: `p:${i}`, label: p.name })).filter((_, i) => i !== s.dater);
        return { ...base, mode: "choice", controllerType: "choice", options, info: "Who won you over?" };
      }
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "The Dater is choosing..." };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal ? "Round complete" : "",
    };
  },
};

export default plugin;
