/**
 * Guess Who - Server Logic
 * Each player has a secret character. On your turn pick a yes/no question
 * from the choice list; the server answers truthfully from the target's
 * secret character and prunes your board. Or make a guess: correct guess
 * wins instantly, a wrong guess costs one of your three lives and passes
 * the turn. Lose all three lives and you are out.
 */

import { secureShuffle } from "../../shared/secure-random.ts";

// Types defined inline to avoid import issues with Node type stripping
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

// --- Game types ---
interface Character {
  id: number;
  name: string;
  desc: string;
  attrs: Record<string, string | boolean>;
}

interface QuestionDef {
  id: string; // "q:<attr>:<value>"
  attr: string;
  value: string | boolean;
  label: string;
}

interface GuessWhoState {
  characters: Character[];
  questions: QuestionDef[];
  secrets: number[]; // character index per player
  opponents: number[]; // fixed opponent seat per player
  eliminated: boolean[][]; // [playerIndex][characterIndex]
  lives: number[];
  out: boolean[];
  scores: number[];
  currentPlayer: number;
  phase: "playing" | "finished";
  history: Array<{ asker: string; target: string; label: string; answer: boolean }>;
  lastEvent: string | null;
  turnTimerMs: number;
  turns: number;
  winnerIndex: number | null;
}

interface GuessWhoInstance extends GameInstance {
  state: GuessWhoState;
}

// --- Constants ---
const CHAR_COUNT = 24;
const START_LIVES = 3;
const TURN_TIME_MS = 45000;
const MAX_TURNS = 80; // safety valve: decide by closest board
const WIN_SCORE = 100;

const GENDERS = ["male", "female"];
const HAIR_COLORS = ["black", "brown", "blonde", "red", "gray", "white"];
const EYE_COLORS = ["brown", "blue", "green", "hazel"];
const HAIR_LENGTHS = ["short", "medium", "long", "bald"];
const BOOL_ATTRS: Array<{ attr: string; label: string }> = [
  { attr: "hasGlasses", label: "Wears glasses?" },
  { attr: "hasHat", label: "Wears a hat?" },
  { attr: "hasBeard", label: "Has a beard?" },
  { attr: "hasMustache", label: "Has a mustache?" },
];

const manifest: GameManifest = {
  id: "guesswho",
  name: "Guess Who",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "board",
  description:
    "Secret characters. Same board on the TV and every phone: flip down the faces that do not fit, ask yes/no questions, then guess. Wrong guesses cost lives.",
};

// --- Helpers ---
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Use secureShuffle from shared/secure-random.ts

function buildQuestions(): QuestionDef[] {
  const qs: QuestionDef[] = [
    { id: "q:gender:male", attr: "gender", value: "male", label: "Is male?" },
    { id: "q:gender:female", attr: "gender", value: "female", label: "Is female?" },
  ];
  for (const c of HAIR_COLORS) {
    qs.push({ id: `q:hairColor:${c}`, attr: "hairColor", value: c, label: `${cap(c)} hair?` });
  }
  for (const c of EYE_COLORS) {
    qs.push({ id: `q:eyeColor:${c}`, attr: "eyeColor", value: c, label: `${cap(c)} eyes?` });
  }
  for (const l of HAIR_LENGTHS) {
    qs.push({ id: `q:hairLength:${l}`, attr: "hairLength", value: l, label: `Hair is ${l}?` });
  }
  for (const b of BOOL_ATTRS) {
    qs.push({ id: `q:${b.attr}:true`, attr: b.attr, value: true, label: b.label });
  }
  return qs;
}

function describe(attrs: Record<string, string | boolean>): string {
  return [
    String(attrs.gender),
    `${String(attrs.hairColor)} hair`,
    `${String(attrs.eyeColor)} eyes`,
    `${String(attrs.hairLength)} hair`,
    attrs.hasGlasses ? "glasses" : null,
    attrs.hasHat ? "hat" : null,
    attrs.hasBeard ? "beard" : null,
    attrs.hasMustache ? "mustache" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function generateCharacters(): Character[] {
  const combos: Array<Record<string, string | boolean>> = [];
  for (const gender of GENDERS) {
    for (const hairColor of HAIR_COLORS) {
      for (const eyeColor of EYE_COLORS) {
        for (const hairLength of HAIR_LENGTHS) {
          for (const glasses of [true, false]) {
            for (const hat of [true, false]) {
              combos.push({ gender, hairColor, eyeColor, hairLength, hasGlasses: glasses, hasHat: hat });
            }
          }
        }
      }
    }
  }
  const picked = secureShuffle(combos).slice(0, CHAR_COUNT);
  return picked.map((attrs, i) => ({
    id: i,
    name: `Character ${i + 1}`,
    desc: describe(attrs),
    attrs,
  }));
}

function matchAttr(attrs: Record<string, string | boolean>, attr: string, value: string | boolean): boolean {
  return attrs[attr] === value;
}

function nextLiving(state: GuessWhoState, from: number, count: number): number {
  for (let step = 1; step <= count; step++) {
    const i = (from + step) % count;
    if (!state.out[i]) return i;
  }
  return -1;
}

function livingCount(state: GuessWhoState): number {
  return state.out.filter((o) => !o).length;
}

function finishGame(instance: GuessWhoInstance, winnerIndex: number): void {
  const state = instance.state;
  state.phase = "finished";
  state.winnerIndex = winnerIndex;
  state.scores[winnerIndex] += WIN_SCORE;
  state.lastEvent = `${instance.players[winnerIndex].name} wins!`;
}

function maybeAutoEnd(instance: GuessWhoInstance): void {
  const state = instance.state;
  if (state.phase !== "playing") return;
  if (livingCount(state) <= 1) {
    const last = state.out.findIndex((o) => !o);
    if (last >= 0) finishGame(instance, last);
  }
}

function advanceTurn(instance: GuessWhoInstance): void {
  const state = instance.state;
  const playerCount = instance.players.length;
  state.turns++;
  if (state.phase !== "playing") return;
  if (state.turns >= MAX_TURNS) {
    // Safety valve: fewest characters left on the board wins.
    let bestIdx = -1;
    let bestRemaining = Infinity;
    for (let i = 0; i < state.eliminated.length; i++) {
      if (state.out[i]) continue;
      const remaining = state.eliminated[i].filter((e) => !e).length;
      if (remaining < bestRemaining) {
        bestRemaining = remaining;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) finishGame(instance, bestIdx);
    return;
  }
  const next = nextLiving(state, state.currentPlayer, playerCount);
  if (next === -1) return;
  state.currentPlayer = next;
  state.turnTimerMs = TURN_TIME_MS;
}

/** The player this seat is interrogating. Fixed for the whole match so a
 *  deduction keeps its value; falls back to the next living player only if the
 *  fixed opponent has been knocked out. */
function targetFor(instance: GuessWhoInstance, playerIndex: number): number {
  const state = instance.state;
  const fixed = state.opponents[playerIndex];
  if (fixed !== undefined && fixed >= 0 && !state.out[fixed]) return fixed;
  return nextLiving(state, playerIndex, instance.players.length);
}

function guessCharacter(instance: GuessWhoInstance, playerIndex: number, charId: number): void {
  const state = instance.state;
  const targetIndex = targetFor(instance, playerIndex);
  const guessed = state.characters[charId];
  if (!guessed || targetIndex < 0) return;
  const askerName = instance.players[playerIndex].name;
  const secret = state.characters[state.secrets[targetIndex]];

  if (guessed.id === secret.id) {
    state.lastEvent = `${askerName} guessed ${guessed.name} — CORRECT!`;
    finishGame(instance, playerIndex);
    return;
  }

  state.lives[playerIndex]--;
  if (state.lives[playerIndex] <= 0) {
    state.out[playerIndex] = true;
    state.lastEvent = `${askerName} guessed wrong (${guessed.name}) and is out!`;
  } else {
    state.lastEvent = `${askerName} guessed wrong (${guessed.name}) — ${state.lives[playerIndex]} lives left`;
  }
  maybeAutoEnd(instance);
  if (state.phase === "playing") advanceTurn(instance);
}

// --- Plugin ---
const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GuessWhoInstance {
    const characters = generateCharacters();
    const order = secureShuffle(characters.map((c) => c.id));
    const secrets = players.map((_, i) => order[i % order.length]);
    return {
      roomId: room.id,
      players,
      state: {
        characters,
        questions: buildQuestions(),
        secrets,
        opponents: players.map((_, i) => (i + 1) % players.length),
        eliminated: players.map(() => characters.map(() => false)),
        lives: players.map(() => START_LIVES),
        out: players.map(() => false),
        scores: players.map(() => 0),
        currentPlayer: 0,
        phase: "playing",
        history: [],
        lastEvent: `${players[0].name} to ask or guess`,
        turnTimerMs: TURN_TIME_MS,
        turns: 0,
        winnerIndex: null,
      } satisfies GuessWhoState,
    } as GuessWhoInstance;
  },

  onInput(instance: GuessWhoInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "playing") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1 || state.out[playerIndex]) return;

    const raw = input as { board?: { id?: unknown; action?: unknown }; choice?: unknown } | null;

    // Flipping a face is private bookkeeping and is allowed on anyone's turn:
    // the player is maintaining their own board, exactly like the tabletop game.
    if (raw?.board && raw.board.action !== "pick") {
      const id = Number(raw.board.id);
      if (!Number.isInteger(id) || id < 0 || id >= state.characters.length) return;
      const board = state.eliminated[playerIndex];
      board[id] = !board[id];
      return;
    }

    if (playerIndex !== state.currentPlayer) return;

    // A "pick" on the board is a guess at that character.
    if (raw?.board && raw.board.action === "pick") {
      const id = Number(raw.board.id);
      if (Number.isInteger(id)) guessCharacter(instance, playerIndex, id);
      return;
    }

    const choice = raw?.choice;
    if (typeof choice !== "string") return;

    const targetIndex = targetFor(instance, playerIndex);
    if (targetIndex === -1) return;
    const targetName = instance.players[targetIndex].name;
    const askerName = instance.players[playerIndex].name;

    if (choice.startsWith("q:")) {
      const q = state.questions.find((x) => x.id === choice);
      if (!q) return;
      const targetSecret = state.characters[state.secrets[targetIndex]];
      const answer = matchAttr(targetSecret.attrs, q.attr, q.value);
      // The answer is narrated, not applied: the player flips their own board,
      // which is the whole point of the physical game.
      state.history.push({ asker: askerName, target: targetName, label: q.label, answer });
      state.lastEvent = `${askerName} asked ${targetName}: "${q.label}" — ${answer ? "YES" : "NO"}`;
      advanceTurn(instance);
      return;
    }

    if (choice.startsWith("g:")) {
      guessCharacter(instance, playerIndex, Number(choice.slice(2)));
    }
  },

  onTick(instance: GuessWhoInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase !== "playing") return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);
    state.turnTimerMs -= dt;
    if (state.turnTimerMs <= 0) {
      state.lastEvent = "Time's up! Turn skipped.";
      advanceTurn(instance);
    }
  },

  screenState(instance: GuessWhoInstance): unknown {
    const state = instance.state;
    return {
      phase: state.phase,
      characters: state.characters.map((c) => ({ id: c.id, name: c.name })),
      turnName: state.phase === "playing" ? instance.players[state.currentPlayer].name : null,
      timeLeft: Math.max(0, state.turnTimerMs),
      history: state.history,
      lastEvent: state.lastEvent,
      // The host screen narrates the race: "Ana is down to 2 options".
      notice: (() => {
        const alive = instance.players
          .map((p, i) => ({ name: p.name, remaining: state.eliminated[i].filter((e) => !e).length, out: state.out[i] }))
          .filter((x) => !x.out);
        if (alive.length === 0) return null;
        const closest = alive.reduce((a, b) => (b.remaining < a.remaining ? b : a));
        return `${closest.name} is down to ${closest.remaining} option${closest.remaining === 1 ? "" : "s"}`;
      })(),
      players: instance.players.map((p, i) => ({
        name: p.name,
        lives: state.lives[i],
        out: state.out[i],
        remaining: state.eliminated[i].filter((e) => !e).length,
        score: state.scores[i],
        connected: p.connected,
      })),
      finished: state.phase === "finished",
      winner:
        state.phase === "finished" && state.winnerIndex !== null
          ? { name: instance.players[state.winnerIndex].name, score: state.scores[state.winnerIndex] }
          : null,
    };
  },

  controllerState(instance: GuessWhoInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return { phase: state.phase, finished: state.phase === "finished" };

    const yourTurn =
      state.phase === "playing" && playerIndex === state.currentPlayer && !state.out[playerIndex];
    const targetIndex = targetFor(instance, playerIndex);

    // Guessing only appears once the board is small enough to matter; before
    // that the phone stays a board plus questions.
    const remaining = state.characters.filter((_, i) => !state.eliminated[playerIndex][i]);
    const guessChoices = yourTurn && remaining.length <= 6
      ? remaining.map((c) => ({ id: `g:${c.id}`, label: `Guess ${c.name}` }))
      : [];

    const options = yourTurn
      ? [
          ...state.questions.map((q) => ({ id: q.id, label: q.label })),
          ...guessChoices,
        ]
      : [];

    const secret = state.characters[state.secrets[playerIndex]];
    const turnName = state.phase === "playing" ? instance.players[state.currentPlayer].name : null;

    return {
      phase: state.phase,
      // Board layout: the whole shared pool, on the phone, flippable.
      board: {
        title: "Your board",
        subtitle: targetIndex >= 0 ? `Opponent: ${instance.players[targetIndex].name}` : "",
        hint: state.out[playerIndex]
          ? "You are out — watch the others play"
          : yourTurn
            ? "Flip the faces that do not fit, or ask a question"
            : `Waiting for ${turnName ?? "the next player"}…`,
        tiles: state.characters.map((c, i) => ({
          id: String(c.id),
          label: c.name,
          marked: state.eliminated[playerIndex][i],
        })),
        choices: options,
        mode: "flip",
        disabled: state.out[playerIndex],
      },
      // Legacy fields kept for the older choice layout.
      options,
      yourTurn,
      turnName,
      targetName: targetIndex >= 0 ? instance.players[targetIndex].name : null,
      info: state.out[playerIndex]
        ? "You are out — watch the others play"
        : yourTurn
          ? `Ask a question or guess ${instance.players[targetIndex]?.name ?? ""}'s character`
          : `Waiting for ${turnName ?? "the next player"}…`,
      secret: { name: secret.name, desc: secret.desc },
      remaining: remaining.length,
      lives: state.lives[playerIndex],
      out: state.out[playerIndex],
      timeLeft: Math.max(0, state.turnTimerMs),
      scores: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })),
      lastEvent: state.lastEvent,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" && state.winnerIndex === playerIndex,
    };
  },
};

export default plugin;
