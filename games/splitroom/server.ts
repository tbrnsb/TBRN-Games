/**
 * Split the Room - server logic.
 * Fill a blank to split the room down the middle. The closer the yes/no vote, the more you score. The closer the yes/no vote, the more you score.
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


interface Scenario { text: string; hint: string }

interface SplitState {
  scenarios: Scenario[];
  round: number;
  maxRounds: number;
  phase: "writing" | "voting" | "reveal" | "finished";
  writer: number;
  submission: string | null;
  votes: Array<"yes" | "no" | null>;
  scores: number[];
  timerMs: number;
  reveal: { yes: number; no: number; points: number } | null;
}

interface SplitInstance extends GameInstance { state: SplitState }

const SCENARIOS: Scenario[] = [
  { text: "You get $10,000, but every time you cough, ___ happens.", hint: "something you would pay to avoid" },
  { text: "You can fly, but only while ___ is playing.", hint: "a song or sound" },
  { text: "You are immortal, but you must ___ once a day.", hint: "an embarrassing ritual" },
  { text: "You become world famous, but everyone knows you as ___.", hint: "a nickname" },
  { text: "You never need sleep again, but you develop a craving for ___.", hint: "a strange snack" },
  { text: "You win a lifetime supply of ___, delivered weekly.", hint: "something useless in bulk" },
  { text: "You can read minds, but only the thoughts about ___.", hint: "a topic" },
  { text: "You get a personal chef, but they only cook ___.", hint: "one dish" },
];

const WRITE_MS = 45000;
const VOTE_MS = 25000;
const REVEAL_MS = 8000;

const manifest: GameManifest = {
  id: "splitroom",
  name: "Split the Room",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "Fill a blank to split the room down the middle. The closer the yes/no vote, the more you score.",
};

function leaderName(instance: SplitInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((score, i) => { if (score > best) { best = score; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function beginRound(instance: SplitInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.writer = round % instance.players.length;
  s.submission = null;
  s.votes = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = WRITE_MS;
  s.phase = "writing";
}

function voters(instance: SplitInstance): number[] {
  const s = instance.state;
  return instance.players.map((_, i) => i).filter((i) => i !== s.writer);
}

function everyoneVoted(instance: SplitInstance): boolean {
  const s = instance.state;
  return voters(instance).every((i) => s.votes[i] !== null);
}

function settle(instance: SplitInstance): void {
  const s = instance.state;
  const list = voters(instance);
  const yes = list.filter((i) => s.votes[i] === "yes").length;
  const no = list.filter((i) => s.votes[i] === "no").length;
  const total = list.length || 1;
  const points = Math.round(1000 - Math.abs(yes - no) * (1000 / total));
  s.scores[s.writer] += points;

  // Voters on the smaller side called it right.
  if (yes !== no) {
    const minority = yes < no ? "yes" : "no";
    for (const i of list) if (s.votes[i] === minority) s.scores[i] += 150;
  }

  s.reveal = { yes, no, points };
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
        scenarios: secureShuffle(SCENARIOS).slice(0, 4),
        round: 0,
        maxRounds: 4,
        phase: "writing",
        writer: 0,
        submission: null,
        votes: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: WRITE_MS,
        reveal: null,
      } satisfies SplitState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as SplitInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "writing" && index === s.writer) {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0) {
        s.submission = raw.text.trim().slice(0, 140);
        s.phase = "voting";
        s.timerMs = VOTE_MS;
      }
      return;
    }

    if (s.phase === "voting" && index !== s.writer) {
      if (raw?.choice === "yes" || raw?.choice === "no") {
        s.votes[index] = raw.choice;
        if (everyoneVoted(inst)) settle(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as SplitInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "writing") {
      if (!s.submission) s.submission = "something nobody expects";
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
    const inst = instance as SplitInstance;
    const s = inst.state;
    const scenario = s.scenarios[s.round % s.scenarios.length];
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      scenario: scenario.text,
      filled: s.phase === "writing" ? null : s.submission,
      writerName: inst.players[s.writer]?.name ?? "",
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? leaderName(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as SplitInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    const scenario = s.scenarios[s.round % s.scenarios.length];
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };

    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && leaderName(inst) === inst.players[index].name,
    };

    if (s.phase === "writing") {
      if (index === s.writer) {
        return {
          ...base,
          mode: "text",
          controllerType: "text",
          placeholder: scenario.hint,
          prompt: scenario.text,
        };
      }
      return {
        ...base,
        mode: "wait",
        controllerType: "choice",
        options: [],
        info: `${inst.players[s.writer].name} is writing the scenario...`,
      };
    }

    if (s.phase === "voting") {
      if (index === s.writer) {
        return {
          ...base,
          mode: "wait",
          controllerType: "choice",
          options: [],
          info: "Your scenario is on the screen. Hope it splits them.",
        };
      }
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [
          { id: "yes", label: "YES" },
          { id: "no", label: "NO" },
        ],
        hasVoted: s.votes[index] !== null,
        info: s.submission ?? "",
      };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal ? `${s.reveal.yes} yes - ${s.reveal.no} no - +${s.reveal.points}` : "",
    };
  },
};

export default plugin;
