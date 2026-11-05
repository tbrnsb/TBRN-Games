/**
 * Survive the Internet - server logic.
 * Answer innocently, twist someone else's answer into a headline, vote for the funniest.
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



interface SurviveState {
  round: number;
  maxRounds: number;
  phase: "answering" | "twisting" | "voting" | "reveal" | "finished";
  prompt: string;
  answers: Array<string | null>;
  twists: Array<string | null>;
  votes: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: Array<{ twister: number; author: number; votes: number }> | null;
}

interface SurviveInstance extends GameInstance { state: SurviveState }

const PROMPTS = [
  "What is your favourite food?",
  "What is the last thing you bought?",
  "Where did you go on your last holiday?",
  "What is your most used app?",
  "What is your comfort movie?",
  "What is the weirdest thing in your bag?",
];

const ANSWER_MS = 45000;
const TWIST_MS = 40000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;

const manifest: GameManifest = {
  id: "survive",
  name: "Survive the Internet",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "Answer an innocent question. Someone else twists your answer into a headline. Vote for the funniest.",
};

function surviveLeader(instance: SurviveInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function surviveBegin(instance: SurviveInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.prompt = PROMPTS[round % PROMPTS.length];
  s.answers = instance.players.map(() => null);
  s.twists = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = ANSWER_MS;
  s.phase = "answering";
}

function authorOf(instance: SurviveInstance, twister: number): number {
  // Player i twists the answer of player i+1.
  return (twister + 1) % instance.players.length;
}

function surviveSettle(instance: SurviveInstance): void {
  const s = instance.state;
  const tally = instance.players.map(() => 0);
  for (let i = 0; i < instance.players.length; i++) {
    const v = s.votes[i];
    if (v === null || v < 0 || v >= tally.length) continue;
    tally[v]++;
  }
  const rows = tally.map((count, twister) => ({ twister, author: authorOf(instance, twister), votes: count }));
  rows.forEach((row) => {
    s.scores[row.twister] += row.votes * 700;
    s.scores[row.author] += row.votes * 300;
  });
  s.reveal = rows;
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
        phase: "answering",
        prompt: PROMPTS[0],
        answers: players.map(() => null),
        twists: players.map(() => null),
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: ANSWER_MS,
        reveal: null,
      } satisfies SurviveState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "answering") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.answers[index] = raw.text.trim().slice(0, 100);
        if (s.answers.every((a) => a !== null)) { s.phase = "twisting"; s.timerMs = TWIST_MS; }
      }
      return;
    }
    if (s.phase === "twisting") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.twists[index] = raw.text.trim().slice(0, 100);
        if (s.twists.every((t) => t !== null)) { s.phase = "voting"; s.timerMs = VOTE_MS; }
      }
      return;
    }
    if (s.phase === "voting") {
      if (typeof raw?.choice === "string" && raw.choice.startsWith("t:")) {
        const target = Number(raw.choice.slice(2));
        if (!Number.isInteger(target) || target < 0 || target >= inst.players.length) return;
        if (target === index) return;
        s.votes[index] = target;
        if (s.votes.every((v) => v !== null)) surviveSettle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;
    if (s.phase === "answering") {
      inst.players.forEach((_, i) => { if (!s.answers[i]) s.answers[i] = "something boring"; });
      s.phase = "twisting"; s.timerMs = TWIST_MS; return;
    }
    if (s.phase === "twisting") {
      inst.players.forEach((_, i) => { if (!s.twists[i]) s.twists[i] = "a slow news day"; });
      s.phase = "voting"; s.timerMs = VOTE_MS; return;
    }
    if (s.phase === "voting") { surviveSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    surviveBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      prompt: s.prompt,
      pairs: s.phase === "voting" || s.phase === "reveal"
        ? inst.players.map((p, i) => {
            const twister = i;
            const author = authorOf(inst, twister);
            return {
              twisterName: p.name,
              authorName: inst.players[author].name,
              headline: s.twists[twister],
              answer: s.answers[author],
            };
          })
        : [],
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? surviveLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as SurviveInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && surviveLeader(inst) === inst.players[index].name,
    };
    if (s.phase === "answering") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "Your honest answer",
        hasSubmitted: s.answers[index] !== null,
        info: s.prompt,
      };
    }
    if (s.phase === "twisting") {
      const author = authorOf(inst, index);
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "Write a headline that makes this look bad",
        hasSubmitted: s.twists[index] !== null,
        info: `Their answer: "${s.answers[author] ?? ""}"`,
      };
    }
    if (s.phase === "voting") {
      const options = inst.players
        .map((p, i) => ({ id: `t:${i}`, label: `${p.name}: ${s.twists[i] ?? ""}` }))
        .filter((_, i) => i !== index);
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options,
        hasVoted: s.votes[index] !== null,
        info: "Which headline is funniest?",
      };
    }
    return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Scoring..." };
  },
};

export default plugin;
