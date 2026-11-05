/**
 * Stowaway - server logic.
 * Everyone shares a secret category except one Stowaway. Write a clue, talk it out, then vote.
 */

import { secureShuffle } from "../../shared/secure-random.ts";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { scalePayout, standingsFromScores, type GameResult } from "../../shared/scoring.ts";

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
  results?(instance: GameInstance): GameResult;
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
  /** Flat `<playerId>:<statKey>` counters for the finale awards. */
  stats: Record<string, number>;
}

interface StowInstance extends GameInstance { state: StowState }

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** Standalone rounds; the catalog's `scale()` reports 3 standalone / 2 rumble. */
const ROUNDS = 3;

const BRIEF_MS = 6000;
const CLUE_MS = 45000;
const TALK_MS = 30000;
const VOTE_MS = 20000;
const CATCH_MS = 20000;
const REVEAL_MS = 8000;

/** A clue is at most three words (brief 4). */
export const MAX_CLUE_WORDS = 3;
/** Defensive per-word cap so one absurd token cannot flood the TV or ballot. */
const MAX_CLUE_WORD_CHARS = 20;

/** Per-correct-voter payout, before `f(N)`: exactly 500 at 3-4 players. */
const CORRECT_VOTE_POINTS = 500;
/** An uncaught Stowaway takes this fixed amount; never scaled. */
const UNCAUGHT_POINTS = 1000;
/** A caught Stowaway who names the category still takes this fixed bonus. */
const CATEGORY_GUESS_POINTS = 500;
/** Category multiple-choice list: the real answer plus five decoys. */
export const CATEGORY_OPTIONS = 6;

const manifest: GameManifest = {
  id: "stowaway",
  name: "Stowaway",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "role",
  description: "Everyone shares a secret category except one Stowaway, who has to bluff. Write a clue, talk it out, then vote.",
};

/** Replace C0/DEL control characters (newlines, tabs, escape codes) with spaces. */
function stripControlCharacters(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : char;
  }
  return out;
}

/** True when a token has at least one letter or digit (not just punctuation). */
function hasWordCharacter(word: string): boolean {
  return /[\p{L}\p{N}]/u.test(word);
}

/**
 * Server-side clue sanitiser: strip control characters, collapse whitespace,
 * drop punctuation-only tokens and keep at most three words.
 *
 * Returns null when nothing usable remains, so a punctuation-only or blank
 * guess is not accepted as a submission.
 */
export function cleanClue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = stripControlCharacters(raw).replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  const words = text
    .split(" ")
    .filter(hasWordCharacter)
    .slice(0, MAX_CLUE_WORDS)
    .map((word) => word.slice(0, MAX_CLUE_WORD_CHARS));
  if (words.length === 0) return null;
  return words.join(" ");
}

/**
 * Stowaway seat for a round: `round % N`, so the role never repeats until
 * every seat has held it once. Deterministic by design (no `Math.random`).
 */
export function stowawayFor(round: number, playerCount: number): number {
  const count = Number.isFinite(playerCount) ? Math.floor(playerCount) : 0;
  if (count <= 0) return 0;
  const safeRound = Number.isFinite(round) ? Math.max(0, Math.floor(round)) : 0;
  return safeRound % count;
}

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

function bumpStat(state: StowState, playerId: string, stat: "correctAccusations" | "roundsUndetected"): void {
  const key = playerStatKey(playerId, stat);
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}

function stowBegin(instance: StowInstance, round: number): void {
  const s = instance.state;
  s.round = round;
  s.stowaway = stowawayFor(round, instance.players.length);
  const chosen = s.categories[round % s.categories.length];
  s.category = chosen.text;
  s.decoys = s.categories.filter((c) => c.text !== chosen.text).slice(0, CATEGORY_OPTIONS - 1).map((c) => c.text);
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

  // Every vote that named the real Stowaway is a correct accusation, whether
  // or not it reached the strict majority needed to catch them.
  instance.players.forEach((player, i) => {
    if (s.votes[i] === s.stowaway) bumpStat(s, player.id, "correctAccusations");
  });

  if (caught) {
    const payout = scalePayout(CORRECT_VOTE_POINTS, instance.players.length);
    for (let i = 0; i < instance.players.length; i++) {
      if (s.votes[i] === s.stowaway) s.scores[i] += payout;
    }
    s.reveal = { caught: true, accused, categoryGuess: null };
    s.phase = "catchguess";
    s.timerMs = CATCH_MS;
    return;
  }
  s.scores[s.stowaway] += UNCAUGHT_POINTS;
  bumpStat(s, instance.players[s.stowaway].id, "roundsUndetected");
  s.reveal = { caught: false, accused, categoryGuess: null };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

function stowFinishReveal(instance: StowInstance): void {
  const s = instance.state;
  const guessedRight = s.catchChoice !== null && s.catchChoice === s.category;
  if (guessedRight) s.scores[s.stowaway] += CATEGORY_GUESS_POINTS;
  s.reveal = { caught: true, accused: s.reveal?.accused ?? null, categoryGuess: s.catchChoice };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/** Who the TV is waiting on. The catch guess deliberately names nobody. */
function waitingNames(instance: StowInstance): string[] {
  const s = instance.state;
  if (s.phase === "clue") {
    return instance.players.filter((_, i) => s.clues[i] === null).map((p) => p.name);
  }
  if (s.phase === "vote") {
    return instance.players
      .filter((_, i) => i !== s.stowaway && s.votes[i] === null)
      .map((p) => p.name);
  }
  return [];
}

/** Public reveal line from the fixed caption bank; never carries private text. */
function revealCaption(instance: StowInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  if (!s.reveal.caught) {
    const fooled = s.votes.filter((vote) => vote !== null && vote !== s.stowaway).length;
    return captionFor({
      kind: "fooled",
      name: instance.players[s.stowaway]?.name,
      count: fooled,
      seed: s.round,
    });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

/** True once the round has reached the public reveal. */
function isRevealed(phase: StowState["phase"]): boolean {
  return phase === "reveal" || phase === "finished";
}

/** Clue text is public once discussion starts, never during the clue phase. */
function cluesArePublic(phase: StowState["phase"]): boolean {
  return phase === "discussion" || phase === "vote" || isRevealed(phase);
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    const instance: StowInstance = {
      roomId: room.id,
      players,
      state: {
        categories: secureShuffle(CATEGORIES),
        round: 0,
        maxRounds: ROUNDS,
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
        stats: Object.fromEntries(
          players.flatMap((p): Array<[string, number]> => [
            [playerStatKey(p.id, "correctAccusations"), 0],
            [playerStatKey(p.id, "roundsUndetected"), 0],
          ]),
        ),
      } satisfies StowState,
    };
    // Round 1 needs its category, decoys and rotating seat just like later
    // rounds; previously only the between-round path called `stowBegin`.
    stowBegin(instance, 0);
    return instance;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as StowInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "clue") {
      if (s.clues[index] === null) {
        const clue = cleanClue(raw?.text);
        if (clue !== null) {
          s.clues[index] = clue;
          if (s.clues.every((c) => c !== null)) { s.phase = "discussion"; s.timerMs = TALK_MS; }
        }
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
    const revealed = isRevealed(s.phase);
    const publicClues = cluesArePublic(s.phase);
    const clues = publicClues
      ? inst.players.map((p, i) => ({ name: p.name, clue: s.clues[i] ?? "" }))
      : [];
    // The clue list doubles as the TV ballot so the shared vote layout can
    // draw all eight seats (two columns with letter badges at 7+). Every entry
    // keeps the same shape in every phase: `votes` is 0 until the reveal.
    const options = publicClues
      ? inst.players.map((p, i) => ({
          id: `p:${i}`,
          label: s.clues[i] ? `${p.name}: ${s.clues[i]}` : p.name,
          text: s.clues[i] ?? "",
          votes: revealed && s.reveal ? s.votes.filter((vote) => vote === i).length : 0,
          selected: false,
        }))
      : [];
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      playerCount: inst.players.length,
      // The role and the category are only public at the reveal.
      stowawayName: revealed ? inst.players[s.stowaway]?.name : null,
      category: revealed ? s.category : null,
      clues,
      options,
      optionColumns: options.length >= 7 ? 2 : 1,
      showVoteCounts: revealed && s.reveal !== null,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
      // `reveal` carries the accused seat, so it stays off the TV until the
      // public reveal; the catch guess must not leak who was caught.
      reveal: revealed ? s.reveal : null,
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
        placeholder: "Three words max",
        maxLength: MAX_CLUE_WORDS * (MAX_CLUE_WORD_CHARS + 1),
        hasSubmitted: s.clues[index] !== null,
        info: isStow
          ? "You do not know the category - bluff in three words max"
          : `Category: ${s.category} · three words max`,
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

  results(instance: GameInstance): GameResult {
    const inst = instance as StowInstance;
    const s = inst.state;
    return {
      standings: standingsFromScores(
        inst.players.map((p, i) => ({ id: p.id, raw: s.scores[i] })),
      ),
      stats: { ...s.stats },
    };
  },
};

export default plugin;
