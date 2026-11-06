/**
 * Slide Roulette - server logic.
 *
 * Player range is 3-8. The presenter seat rotates `round % N`, so a standalone
 * game runs one round per player (up to eight) and every player presents
 * exactly once; the Rumble runs three rounds.
 *
 * Each non-presenter writes one caption. The captions are shuffled with a
 * secure shuffle before they reach the presenter, so the order on the TV cannot
 * be mapped back to the author. Authors are published only in the reveal
 * payload. The TV gets the current caption, the presenter's name and a
 * "slides left" counter.
 *
 * Scoring is unchanged from the original game: the presenter earns
 * `round(200 * average stars)` (max 1000) and every caption author earns a flat
 * 100 when the average is 4 or more. The average is already a per-vote measure,
 * so no `f(N)` is applied and 3-4 player totals stay identical.
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
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  results?(instance: GameInstance): GameResult;
}








import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores, type GameResult } from "../../shared/scoring.ts";
import { secureShuffle } from "../../shared/secure-random.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOPICS: Array<{ text: string }> = JSON.parse(readFileSync(join(HERE, "content", "topics.json"), "utf8")) as Array<{ text: string }>;

type SlideMode = "standalone" | "rumble";

interface SlideState {
  mode: SlideMode;
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
  /** Rounds each seat has presented. Used for the `averageStars` stat. */
  presented: number[];
  /** Sum of the star averages earned while presenting. */
  starTotal: number[];
  /** Rounds where this seat's caption earned the 4-star author bonus. */
  captionsRated4: number[];
}

interface SlideInstance extends GameInstance { state: SlideState }

const WRITE_MS = 30000;
const SLIDE_MS = 15000;
const RATE_MS = 20000;
const REVEAL_MS = 8000;
const MAX_CAPTION = 40;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
/** Brief 4: a Rumble runs three presenters. */
const RUMBLE_ROUNDS = 3;

const manifest: GameManifest = {
  id: "slideroulette",
  name: "Slide Roulette",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  controllerType: "text",
  description: "Write one slide caption for a topic you did not choose. The presenter has to improvise around it.",
};

/**
 * Round count for a table of `playerCount`.
 *
 * Standalone is one presenter per player (up to the eight-seat ceiling), which
 * keeps the original game at 3-4 players. The Rumble runs three presenters.
 */
export function slideRounds(playerCount: number, mode: SlideMode = "standalone"): number {
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  if (mode === "rumble") return Math.min(RUMBLE_ROUNDS, Math.max(1, count));
  return Math.max(1, Math.min(count || 1, MAX_PLAYERS));
}

export function averageRating(ratings: Array<number | null>): number {
  const valid = ratings.filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r >= 1 && r <= 5);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, r) => sum + r, 0) / valid.length;
}

export function presenterPoints(average: number): number {
  return Math.round(200 * Math.max(0, Math.min(5, average)));
}

/**
 * Build the presenter's deck from the submitted captions.
 *
 * One caption per non-presenter, with the author only kept for scoring. The
 * order is shuffled (secure random) so a presenter cannot map a slide position
 * to a seat. The shuffle is injectable so tests can pin the order.
 */
export function deckFor(
  submissions: ReadonlyArray<string | null>,
  presenter: number,
  shuffle: <T>(items: T[]) => T[] = secureShuffle,
): Array<{ author: number; text: string }> {
  const slides = submissions
    .map((text, author) => ({ author, text: text ?? "" }))
    .filter((slide) => slide.author !== presenter && slide.text.length > 0);
  if (slides.length === 0) return [{ author: presenter, text: "no slide was written" }];
  return shuffle(slides);
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
  s.deck = deckFor(s.submissions, s.presenter);
  s.slideIndex = 0;
  s.phase = "presenting";
  s.timerMs = SLIDE_MS;
}

function slideSettle(instance: SlideInstance): void {
  const s = instance.state;
  const average = averageRating(s.ratings);
  const points = presenterPoints(average);
  s.scores[s.presenter] += points;
  s.presented[s.presenter] += 1;
  s.starTotal[s.presenter] += average;
  if (average >= 4) {
    for (const slide of s.deck) {
      s.scores[slide.author] += 100;
      // The fallback deck is credited to the presenter; it is not a real
      // caption and must not inflate the player's author stats.
      if (slide.author !== s.presenter) s.captionsRated4[slide.author] += 1;
    }
  }
  s.reveal = { average, presenterPoints: points };
  s.phase = "reveal";
  s.timerMs = REVEAL_MS;
}

/** Who the TV is waiting on in the current phase. */
function waitingNames(instance: SlideInstance): string[] {
  const s = instance.state;
  if (s.phase === "writing") {
    return instance.players
      .filter((_, index) => index !== s.presenter && s.submissions[index] === null)
      .map((player) => player.name);
  }
  if (s.phase === "presenting") {
    const name = instance.players[s.presenter]?.name;
    return name ? [name] : [];
  }
  if (s.phase === "rating") {
    return instance.players
      .filter((_, index) => index !== s.presenter && s.ratings[index] === null)
      .map((player) => player.name);
  }
  return [];
}

/** Public reveal line: the presenter and their star average, never an author. */
function revealCaption(instance: SlideInstance): string | null {
  const s = instance.state;
  if (s.phase !== "reveal" || !s.reveal) return null;
  const name = instance.players[s.presenter]?.name;
  if (name && s.reveal.average >= 5) {
    return captionFor({ kind: "perfect", name, seed: s.round });
  }
  return captionFor({ kind: "reveal", seed: s.round });
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance {
    const mode: SlideMode = options?.mode === "rumble" ? "rumble" : "standalone";
    const topics = secureShuffle(TOPICS).map((t) => t.text);
    const inst: SlideInstance = {
      roomId: room.id,
      players,
      state: {
        mode,
        round: 0,
        maxRounds: slideRounds(players.length, mode),
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
        presented: players.map(() => 0),
        starTotal: players.map(() => 0),
        captionsRated4: players.map(() => 0),
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
    const shown = s.phase === "presenting" || s.phase === "rating" || s.phase === "reveal";
    const revealed = s.phase === "reveal" || s.phase === "finished";
    const slideNumber = s.deck.length ? Math.min(s.slideIndex + 1, s.deck.length) : 0;
    return {
      phase: s.phase,
      round: s.round + 1,
      maxRounds: s.maxRounds,
      topic: s.topic,
      presenterName: inst.players[s.presenter]?.name ?? "",
      slide: shown ? (slide?.text ?? "") : null,
      slideNumber,
      slideCount: s.deck.length,
      // "Slides left" including the one on screen now, for the TV counter.
      slidesLeft: s.deck.length ? Math.max(0, s.deck.length - s.slideIndex) : 0,
      // Authorship is a reveal only: never send a caption-to-seat mapping early.
      captions: revealed
        ? s.deck.map((entry) => ({
          text: entry.text,
          author: inst.players[entry.author]?.name ?? "",
        }))
        : null,
      reveal: s.reveal,
      waitingOn: waitingNames(inst),
      caption: revealCaption(inst),
      sound: s.phase === "reveal" ? "reveal" : null,
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

  results(instance: GameInstance): GameResult {
    const inst = instance as SlideInstance;
    const s = inst.state;
    const stats: Record<string, number> = {};
    inst.players.forEach((player, index) => {
      const presented = s.presented[index] ?? 0;
      stats[playerStatKey(player.id, "averageStars")] = presented > 0 ? s.starTotal[index] / presented : 0;
      stats[playerStatKey(player.id, "captionsRated4")] = s.captionsRated4[index] ?? 0;
    });
    return {
      standings: standingsFromScores(
        inst.players.map((player, index) => ({ id: player.id, raw: s.scores[index] })),
      ),
      stats,
    };
  },
};

export default plugin;
