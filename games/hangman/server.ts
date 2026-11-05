/**
 * Hangman Game - Server Logic
 * Guess letters, wrong guesses build hangman
 */

import { secureRandomInt } from "../../shared/secure-random.ts";

interface GameManifest { id: string; name: string; minPlayers: number; maxPlayers: number; controllerType: ControllerType; description: string; }
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
interface Player { id: string; name: string; joinedAt: number; rejoinToken: string; connected: boolean; controllerType?: string; }
interface RoomState { id: string; code: string; hostPlayerId: string | null; players: Player[]; gameId: string | null; gameState: unknown | null; createdAt: number; status: "lobby" | "playing" | "finished"; }
interface GameInstance { roomId: string; players: Player[]; state: unknown; }
interface GamePlugin { manifest: GameManifest; onStart(room: RoomState, players: Player[]): GameInstance; onInput(instance: GameInstance, playerId: string, input: unknown): void; onTick(instance: GameInstance, deltaMs: number): void; screenState(instance: GameInstance): unknown; controllerState(instance: GameInstance, playerId: string): unknown; }

interface HangmanState {
  word: string; masked: string; guessed: Set<string>; wrongGuesses: number; maxWrong: number;
  currentPlayer: number; scores: number[]; round: number; maxRounds: number; phase: "playing" | "round-end" | "finished"; roundWinner: number | null;
  roundTimerMs: number;
}
interface HangmanInstance extends GameInstance { state: HangmanState; }

const WORDS = ["JAVASCRIPT", "TYPESCRIPT", "REACT", "VUE", "ANGULAR", "NODEJS", "PYTHON", "RUST", "GOLANG", "SWIFT", "KOTLIN", "DART", "ELIXIR", "HASKELL", "CLOSURE", "SCHEME", "PROLOG", "ERLANG", "LUA", "PERL", "RUBY", "PHP", "JAVA", "CSHARP", "CPLUSPLUS", "HTML", "CSS", "SQL", "JSON", "XML", "YAML", "TOML", "MARKDOWN", "GIT", "DOCKER", "KUBERNETES", "LINUX", "WINDOWS", "MACOS", "UBUNTU", "ARCH", "FEDORA", "DEBIAN", "CENTOS", "NGINX", "APACHE", "REDIS", "POSTGRES", "MONGODB", "MYSQL", "WEBPACK", "VITE", "ESLINT", "PRETTIER", "JEST", "CYPRESS", "PLAYWRIGHT", "STORYBOOK", "TAILWIND", "BOOTSTRAP", "MATERIAL", "ANTDESIGN", "CHAKRA", "RADIX", "HEADLESS", "ACCESSIBLE", "PERFORMANCE", "SECURITY", "SCALABILITY", "RELIABILITY", "MAINTAINABILITY", "READABILITY", "TESTABILITY", "DEBUGGING", "PROFILING", "OPTIMIZATION", "REFACTORING", "DESIGNPATTERNS", "SOLID", "DRY", "KISS", "YAGNI", "CLEANCODE", "TDD", "BDD", "DDD", "MICROSERVICES", "MONOLITH", "SERVERLESS", "EDGE", "CDN", "CACHE", "DATABASE", "ORM", "MIGRATION", "SEEDING", "FACTORY", "BUILDER", "SINGLETON", "FACTORY", "OBSERVER", "STRATEGY", "COMMAND", "DECORATOR", "ADAPTER", "FACADE", "PROXY", "BRIDGE", "COMPOSITE", "FLYWEIGHT", "INTERPRETER", "ITERATOR", "MEDIATOR", "MEMENTO", "STATE", "TEMPLATE", "VISITOR"];
const MAX_WRONG = 6; const ROUNDS = 10;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const manifest: GameManifest = { id: "hangman", name: "Hangman", minPlayers: 1, maxPlayers: 4, controllerType: "choice", description: "Guess the word letter by letter. Wrong guesses build the hangman. Solo uses word list." };

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): HangmanInstance {
    const word = WORDS[secureRandomInt(0, WORDS.length)];
    return { roomId: room.id, players, state: { word, masked: "_".repeat(word.length), guessed: new Set(), wrongGuesses: 0, maxWrong: MAX_WRONG, currentPlayer: 0, scores: players.map(() => 0), round: 0, maxRounds: ROUNDS, phase: "playing", roundWinner: null, roundTimerMs: 0 } };
  },
  onInput(instance: HangmanInstance, playerId: string, input: unknown): void {
    const state = instance.state; if (state.phase !== "playing") return;
    const playerIndex = instance.players.findIndex(p => p.id === playerId); if (playerIndex !== state.currentPlayer) return;
    const raw = (input as { choice?: unknown } | null)?.choice;
    if (typeof raw !== "string" || raw.length !== 1) return;
    const letter = raw.toUpperCase(); if (state.guessed.has(letter)) return;
    state.guessed.add(letter);
    if (state.word.includes(letter)) {
      state.masked = state.word.split("").map(c => state.guessed.has(c) ? c : "_").join("");
      state.scores[playerIndex] += 10;
      if (!state.masked.includes("_")) { state.phase = "round-end"; state.roundWinner = playerIndex; state.scores[playerIndex] += 50; state.roundTimerMs = 2000; }
    } else { state.wrongGuesses++; if (state.wrongGuesses >= state.maxWrong) { state.phase = "round-end"; state.roundWinner = null; state.roundTimerMs = 2000; } }
  },
  onTick(instance: HangmanInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "round-end") {
      state.roundTimerMs -= deltaMs;
      if (state.roundTimerMs <= 0) nextRound(state, instance.players.length);
    }
  },
  screenState(instance: HangmanInstance): unknown { const state = instance.state; return { word: state.phase === "round-end" || state.phase === "finished" ? state.word : state.masked, masked: state.masked, guessed: Array.from(state.guessed).sort(), wrongGuesses: state.wrongGuesses, maxWrong: state.maxWrong, currentPlayer: state.currentPlayer, round: state.round + 1, maxRounds: state.maxRounds, phase: state.phase, scores: instance.players.map((p,i) => ({ name: p.name, score: state.scores[i] })), finished: state.phase === "finished", winner: state.phase === "finished" ? getWinner(instance) : null }; },
  // `options` is the flat list the choice controller renders: the letters
  // that are still up.
  controllerState(instance: HangmanInstance, playerId: string): unknown { const state = instance.state; const playerIndex = instance.players.findIndex(p => p.id === playerId); const isCurrent = playerIndex === state.currentPlayer && state.phase === "playing"; return { word: state.phase === "round-end" || state.phase === "finished" ? state.word : state.masked, masked: state.masked, guessed: Array.from(state.guessed).sort(), wrongGuesses: state.wrongGuesses, maxWrong: state.maxWrong, isYourTurn: isCurrent, options: ALPHABET.filter(l => !state.guessed.has(l)).map(l => ({ id: l, label: l })), yourScore: state.scores[playerIndex], round: state.round + 1, maxRounds: state.maxRounds, phase: state.phase, finished: state.phase === "finished", youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false }; }
};

function nextRound(state: HangmanState, playerCount: number): void {
  state.round++; if (state.round >= state.maxRounds) { state.phase = "finished"; return; }
  const word = WORDS[secureRandomInt(0, WORDS.length)];
  state.word = word; state.masked = "_".repeat(word.length); state.guessed = new Set(); state.wrongGuesses = 0; state.phase = "playing"; state.roundWinner = null;
  state.currentPlayer = (state.currentPlayer + 1) % playerCount;
}
function getWinner(instance: HangmanInstance): { name: string; score: number } | null { const state = instance.state; let best = -1, idx = -1; state.scores.forEach((s,i) => { if (s > best) { best = s; idx = i; } }); if (idx >= 0) return { name: instance.players[idx].name, score: best }; return null; }

export default plugin;