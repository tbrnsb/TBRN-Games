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








import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secureShuffle } from "../../shared/secure-random.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOPICS: Array<{ text: string }> = JSON.parse(readFileSync(join(HERE, "content", "topics.json"), "utf8")) as Array<{ text: string }>;

interface SlideState {
  round: number;
  maxRounds: number;
  phase: "writing" | "presenting" | "rating" | "reveal" | "finished";
  presenter: number;
  topic: string;
  submissions: Array<string | null>;
  deck: Array<{ author: number; text: string }>;
  slideIndex: number;
  ratings: Array<number | null>;
  scores: number[];
  timerMs: number;
  reveal: { average: number; presenterPoints: number } | null;
}

interface SlideInstance extends GameInstance { state: SlideState }

const WRITE_MS = 30000;
const SLIDE_MS = 15000;
const RATE_MS = 20000;
const REVEAL_MS = 8000;
const MAX_CAPTION = 40;

const manifest: GameManifest = {
  id: "slideroulette",
  name: "Slide Roulette",
  minPlayers: 3,
  maxPlayers: 4,
  controllerType: "text",
  description: "Write one slide caption for a topic you did not choose. The presenter has to improvise around it.",
};

export function averageRating(ratings: Array<number | null>): number {
  const valid = ratings.filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r >= 1 && r <= 5);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, r) => sum + r, 0) / valid.length;
}

export function presenterPoints(average: number): number {
  return Math.round(200 * Math.max(0, Math.min(5, average)));
}

function slideLeader(instance: SlideInstance): string | null {
  const s = instance.state;
  let best = -1;
  let idx = -1;
  s.scores.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  return idx >= 0 ? instance.players[idx].name : null;
}

function slideBegin(instance: SlideInstance, round: number, topics: string[]): void {
  const s = instance.state;
  s.round = round;
  s.presenter = round % instance.players.length;
  s.topic = topics[round % topics.length];
  s.submissions = instance.players.map(() => null);
  s.deck = [];
  s.slideIndex = 0;
  s.ratings = instance.players.map(() => null);
  s.reveal = null;
  s.timerMs = WRITE_MS;
  s.phase = "writing";
}

function buildDeck(instance: SlideInstance): void {
  const s = instance.state;
  s.deck = instance.players
    .map((_, i) => ({ author: i, text: s.submissions[i] ?? "" }))
    .filter((slide, i) => i !== s.presenter && slide.text.length > 0);
  if (s.deck.length === 0) s.deck = [{ author: s.presenter, text: "no slide was written" }];
  s.slideIndex = 0;
  s.phase = "presenting";
  s.timerMs = SLIDE_MS;
}

function slideSettle(instance: SlideInstance): void {
  const s = instance.state;
  const average = averageRating(s.ratings);
  s.scores[s.presenter] += presenterPoints(average);
  if (average >= 4) {
    for (const slide of s.deck) s.scores[slide.author] += 100;
  }
  s.reveal = { average, presenterPoints: presenterPoints(average) };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): GameInstance {
    const topics = secureShuffle(TOPICS).map((t) => t.text);
    const inst: SlideInstance = {
      roomId: room.id,
      players,
      state: {
        round: 0,
        maxRounds: players.length,
        phase: "writing",
        presenter: 0,
        topic: topics[0],
        submissions: players.map(() => null),
        deck: [],
        slideIndex: 0,
        ratings: players.map(() => null),
        scores: players.map(() => 0),
        timerMs: WRITE_MS,
        reveal: null,
      } satisfies SlideState,
    };
    slideBegin(inst, 0, topics);
    return inst;
  },

  onInput(instance: GameInstance, playerId: string, input: unknown): void {
    const inst = instance as SlideInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return;
    const raw = input as { text?: unknown; choice?: unknown } | null;

    if (s.phase === "writing") {
      if (index === s.presenter) return;
      if (typeof raw?.text === "string" && raw.text.trim().length > 0 && s.submissions[index] === null) {
        s.submissions[index] = raw.text.trim().slice(0, MAX_CAPTION);
        if (inst.players.every((_, i) => i === s.presenter || s.submissions[i] !== null)) buildDeck(inst);
      }
      return;
    }

    if (s.phase === "presenting") {
      if (index !== s.presenter) return;
      if (raw?.choice === "next") {
        s.slideIndex++;
        if (s.slideIndex >= s.deck.length) { s.phase = "rating"; s.timerMs = RATE_MS; }
        else s.timerMs = SLIDE_MS;
      }
      return;
    }

    if (s.phase === "rating") {
      if (index === s.presenter) return;
      if (typeof raw?.choice !== "string") return;
      const stars = Number(raw.choice);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
      s.ratings[index] = stars;
      if (inst.players.every((_, i) => i === s.presenter || s.ratings[i] !== null)) slideSettle(inst);
    }
  },

  onTick(instance: GameInstance, deltaMs: number): void {
    const inst = instance as SlideInstance;
    const s = inst.state;
    if (s.phase === "finished") return;
    s.timerMs -= Math.min(Math.max(deltaMs, 0), 2000);
    if (s.timerMs > 0) return;

    if (s.phase === "writing") {
      inst.players.forEach((_, i) => { if (i !== s.presenter && !s.submissions[i]) s.submissions[i] = "no caption"; });
      buildDeck(inst);
      return;
    }
    if (s.phase === "presenting") {
      s.slideIndex++;
      if (s.slideIndex >= s.deck.length) { s.phase = "rating"; s.timerMs = RATE_MS; }
      else s.timerMs = SLIDE_MS;
      return;
    }
    if (s.phase === "rating") { slideSettle(inst); return; }
    const next = s.round + 1;
    if (next >= s.maxRounds) { s.phase = "finished"; return; }
    const topics = TOPICS.map((t) => t.text);
    slideBegin(inst, next, topics);
  },

  screenState(instance: GameInstance): unknown {
    const inst = instance as SlideInstance;
    const s = inst.state;
    const slide = s.deck[s.slideIndex];
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      topic: s.topic,
      presenterName: inst.players[s.presenter]?.name ?? "",
      slide: s.phase === "presenting" || s.phase === "rating" || s.phase === "reveal" ? (slide?.text ?? "") : null,
      slideNumber: s.deck.length ? s.slideIndex + 1 : 0,
      slideCount: s.deck.length,
      reveal: s.reveal,
      timerMs: Math.max(0, s.timerMs),
      scores: inst.players.map((p, i) => ({ name: p.name, score: s.scores[i] })),
      finished: s.phase === "finished",
      winner: s.phase === "finished" ? slideLeader(inst) : null,
    };
  },

  controllerState(instance: GameInstance, playerId: string): unknown {
    const inst = instance as SlideInstance;
    const s = inst.state;
    const index = inst.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { mode: "wait", controllerType: "choice", options: [] };
    const isPresenter = index === s.presenter;
    const base = {
      round: s.round + 1,
      maxRounds: s.maxRounds,
      yourScore: s.scores[index],
      finished: s.phase === "finished",
      youWon: s.phase === "finished" && slideLeader(inst) === inst.players[index].name,
    };

    if (s.phase === "writing") {
      if (isPresenter) {
        return { ...base, mode: "wait", controllerType: "choice", options: [], info: `You are presenting: ${s.topic}` };
      }
      return { ...base, mode: "text", controllerType: "text", placeholder: "One slide caption", maxLength: MAX_CAPTION, hasSubmitted: s.submissions[index] !== null, info: s.topic };
    }
    if (s.phase === "presenting") {
      if (isPresenter) {
        return {
          ...base,
          mode: "choice",
          controllerType: "choice",
          options: [{ id: "next", label: "NEXT SLIDE" }],
          info: `Slide ${s.slideIndex + 1} of ${s.deck.length} - talk!`,
        };
      }
      return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Watch the presenter squirm" };
    }
    if (s.phase === "rating") {
      if (isPresenter) return { ...base, mode: "wait", controllerType: "choice", options: [], info: "Take a bow" };
      return {
        ...base,
        mode: "choice",
        controllerType: "choice",
        options: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: "★".repeat(n) })),
        hasVoted: s.ratings[index] !== null,
        info: "Rate the presentation",
      };
    }
    return { ...base, mode: "wait", controllerType: "choice", options: [], info: s.reveal ? `Average ${s.reveal.average.toFixed(1)} stars` : "" };
  },
};

export default plugin;
