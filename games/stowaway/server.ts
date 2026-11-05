/**
 * Stowaway - server logic.
 * Everyone shares a secret category except one Stowaway. Write a clue, talk it out, then vote.
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



interface StowCategory { id: string; text: string }

const CATEGORIES: StowCategory[] = [
  "Ocean", "Space station", "Farm", "Hospital", "Airport", "Cruise ship", "Desert", "Rainforest",
  "Music festival", "Submarine", "Zoo", "Ski resort", "Prison", "Museum", "Casino", "Library",
  "Volcano", "Arctic", "Football stadium", "Great Barrier Reef", "Mount Everest", "Antarctica",
  "Haunted house", "Battlefield", "Jungle", "Coral reef", "Wind farm", "Water park", "Botanical garden",
  "Archaeological dig", "Night market", "Space shuttle", "Cave system", "Brewery", "Truck stop",
  "Rehabilitation clinic", "Primary school", "Rooftop bar", "Fish market", "Power plant",
].map((text, i) => ({ id: `cat_${i + 1}`, text }));

interface StowState {
  categories: StowCategory[];
  round: number;
  maxRounds: number;
  phase: "brief" | "clue" | "discussion" | "vote" | "catchguess" | "reveal" | "finished";
  stowaway: number;
  category: string;
  decoys: string[];
  clues: Array<string | null>;
  votes: Array<number | null>;
  catchChoice: string | null;
  scores: number[];
  timerMs: number;
  reveal: { caught: boolean; accused: number | null; categoryGuess: string | null } | null;
}

interface StowInstance extends GameInstance { state: StowState }

const BRIEF_MS = 6000;
const CLUE_MS = 45000;
const TALK_MS = 30000;
const VOTE_MS = 20000;
const CATCH_MS = 20000;
const REVEAL_MS = 8000;

const manifest: GameManifest = {
  id: "stowaway",
  name: "Stowaway",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "role",
  description: "Everyone shares a secret category except one Stowaway, who has to bluff. Write a clue, talk it out, then vote.",
};

/** Strict-majority accusation: a tie or a split never catches the Stowaway. */
export function tallyAccusation(votes: Array<number | null>, stowaway: number): { accused: number | null; caught: boolean } {
  const counts = new Map<number, number>();
  for (const vote of votes) {
    if (vote === null || !Number.isInteger(vote) || vote < 0) continue;
    counts.set(vote, (counts.get(vote) ?? 0) + 1);
  }
  let accused: number | null = null;
  let best = 0;
  let tie = false;
  for (const [id, count] of counts) {
    if (count > best) { best = count; accused = id; tie = false; }
    else if (count === best) tie = true;
  }
  return { accused, caught: accused === stowaway && !tie && best > 0 };
}

function stowLeader(instance: StowInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function stowBegin(instance: StowInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.stowaway = round % instance.players.length;
  const chosen = s.categories[round % s.categories.length];
  s.category = chosen.text;
  s.decoys = s.categories.filter((c) => c.text !== chosen.text).slice(0, 5).map((c) => c.text);
  s.clues = instance.players.map(() => null);
  s.votes = instance.players.map(() => null);
  s.catchChoice = null;
  s.reveal = null;
  s.timerMs = BRIEF_MS;
  s.phase = "brief";
}

function stowResolveVote(instance: StowInstance): void {
  const s = instance.state;
  const { accused, caught } = tallyAccusation(s.votes, s.stowaway);
  if (caught) {
    for (let i = 0; i < instance.players.length; i++) {
      if (s.votes[i] === s.stowaway) s.scores[i] += 500;
    }
    s.reveal = { caught: true, accused, categoryGuess: null };
    s.phase = "catchguess";
    s.timerMs = CATCH_MS;
    return;
  }
  s.scores[s.stowaway] += 1000;
  s.reveal = { caught: false, accused, categoryGuess: null };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

function stowFinishReveal(instance: StowInstance): void {
  const s = instance.state;
  const guessedRight = s.catchChoice !== null && s.catchChoice === s.category;
  if (guessedRight) s.scores[s.stowaway] += 500;
  s.reveal = { caught: true, accused: s.reveal?.accused ?? null, categoryGuess: s.catchChoice };
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
        categories: secureShuffle(CATEGORIES),
        round: 0,
        maxRounds: 4,
        phase: "brief",
        stowaway: 0,
        category: "",
        decoys: [],
        clues: players.map(() => null),
        votes: players.map(() => null),
        catchChoice: null,
        scores: players.map(() => 0),
        timerMs: BRIEF_MS,
        reveal: null,
      } satisfies StowState,
    };
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as StowInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "clue") {
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.clues[index] === null) {
        s.clues[index] = raw.text.trim().slice(0, 20);
        if (s.clues.every((c) => c !== null)) { s.phase = "discussion"; s.timerMs = TALK_MS; }
      }
      return;
    }

    if (s.phase === "vote") {
      if (typeof raw?.choice === "string" && raw.choice.startsWith("p:")) {
        const target = Number(raw.choice.slice(2));
        if (!Number.isInteger(target) || target < 0 || target >= inst.players.length || target === index) return;
        s.votes[index] = target;
        // The Stowaway does not vote on themselves; their own slot stays null.
        if (s.votes.every((v, i) => i === s.stowaway || v !== null)) stowResolveVote(inst);
      }
      return;
    }

    if (s.phase === "catchguess" && index === s.stowaway) {
      if (typeof raw?.choice === "string") {
        const options = [s.category, ...s.decoys];
        if (!options.includes(raw.choice)) return;
        s.catchChoice = raw.choice;
        stowFinishReveal(inst);
      }
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as StowInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "brief") { s.phase = "clue"; s.timerMs = CLUE_MS; return; }
    if (s.phase === "clue") {
      inst.players.forEach((_, i) => { if (!s.clues[i]) s.clues[i] = "something vague"; });
      s.phase = "discussion"; s.timerMs = TALK_MS; return;
    }
    if (s.phase === "discussion") { s.phase = "vote"; s.timerMs = VOTE_MS; return; }
    if (s.phase === "vote") { stowResolveVote(inst); return; }
    if (s.phase === "catchguess") { stowFinishReveal(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    stowBegin(inst, next);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as StowInstance;
    const s = inst.state;
    const revealed = s.phase === "reveal" || s.phase === "finished";
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      stowawayName: revealed ? inst.players[s.stowaway]?.name : null,
      category: revealed ? s.category : null,
      clues: s.phase === "discussion" || s.phase === "vote" || revealed
        ? inst.players.map((p, i) => ({ name: p.name, clue: s.clues[i] ?? "" }))
        : [],
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? stowLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as StowInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && stowLeader(inst) === inst.players[index].name,
    };
    const isStow = index === s.stowaway;

    if (s.phase === "brief") {
      return {
        ...base,
        mode: "wait",
        controllerType: "role",
        role: {
          title: isStow ? "You are the STOWAWAY" : "Your category",
          body: isStow ? "You do not know the category. Listen, blend in, and bluff." : s.category,
          holdLabel: "HOLD TO VIEW",
          secret: isStow,
        },
      };
    }

    if (s.phase === "clue") {
      return {
        ...base,
        mode: "text",
        controllerType: "text",
        placeholder: "One short clue",
        maxLength: 20,
        hasSubmitted: s.clues[index] !== null,
        info: isStow ? "You do not know the category - bluff carefully" : `Category: ${s.category}`,
      };
    }

    if (s.phase === "vote") {
      const options = inst.players.map((p, i) => ({ id: `p:${i}`, label: p.name })).filter((_, i) => i !== index);
      return { ...base, mode: "choice", controllerType: "choice", options, hasVoted: s.votes[index] !== null, info: "Who is the Stowaway?" };
    }

    if (s.phase === "catchguess") {
      if (isStow) {
        const options = [s.category, ...s.decoys].map((c) => ({ id: c, label: c }));
        return { ...base, mode: "choice", controllerType: "choice", options, info: "You were caught. Guess the category for +500." };
      }
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "The Stowaway is guessing the category..." };
    }

    if (s.phase === "discussion") {
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: isStow ? "Talk it out. Do not give yourself away." : `Category: ${s.category}` };
    }

    return {
      ...base,
      mode: "wait",
      controllerType: "choice",
      options: [],
      info: s.reveal ? (s.reveal.caught ? "The Stowaway was caught." : "The Stowaway got away.") : "",
    };
  },
};

export default plugin;
