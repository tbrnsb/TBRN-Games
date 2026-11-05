/**
 * Between-game interlude and TV watchability helpers (Phase 2, brief 3.8).
 *
 * Pure, deterministic functions only: the screen client renders these, tests
 * pin them, and later game tasks can reuse them. Nothing here imports the DOM,
 * the server or a game, so it loads in Node and in the browser alike.
 *
 * Privacy: caption text comes from the fixed bank below and is filled only with
 * a public name and a public count. A game can never pass a secret word, role
 * or unrevealed answer through a caption.
 */

/** How long the TV lingers on the between-game interlude. */
export const INTERLUDE_DURATION_MS = 15000;

/** How long a screen-state `caption` line stays up. */
export const CAPTION_DURATION_MS = 3000;

/** Fallback rule when a game has no description to show. */
const FALLBACK_RULE = "Grab your phone and follow the TV.";

/** Fallback rule when there is no next game to preview. */
const NO_GAME_RULE = "The host picks the next game on the TV.";

// --- Standings movement ---------------------------------------------------

export interface StandingPoint {
  playerId: string;
  points: number;
}

export type MovementDirection = "up" | "down" | "same" | "new";

export interface StandingMovement {
  playerId: string;
  direction: MovementDirection;
}

interface RankedStanding {
  playerId: string;
  points: number;
  /** Competition rank: 1 + the number of players with strictly more points. */
  rank: number;
}

/**
 * Rank a standings list by points. Ties share a rank and keep their given
 * order, which is how the session already lists them. Duplicate ids keep the
 * first row; a non-finite score counts as zero.
 */
function ranked(rows: readonly StandingPoint[]): RankedStanding[] {
  const seen = new Set<string>();
  const unique: StandingPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row.playerId !== "string" || row.playerId.length === 0) continue;
    if (seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    const points = Number(row.points);
    unique.push({ playerId: row.playerId, points: Number.isFinite(points) ? points : 0 });
  }
  return unique.map((row) => ({
    ...row,
    rank: 1 + unique.filter((other) => other.points > row.points).length,
  }));
}

/**
 * Compare the previous and current standings by rank position.
 *
 * - "up" / "down": the player's rank improved / worsened.
 * - "same": the rank is unchanged, including a tie that reordered.
 * - "new": the player was not in the previous list.
 *
 * Output follows the current list, so the caller can render it directly.
 */
export function standingsMovement(
  previous: readonly StandingPoint[],
  current: readonly StandingPoint[],
): StandingMovement[] {
  const before = new Map(ranked(previous).map((row) => [row.playerId, row.rank]));
  return ranked(current).map((row) => {
    const previousRank = before.get(row.playerId);
    if (previousRank === undefined) return { playerId: row.playerId, direction: "new" };
    if (row.rank < previousRank) return { playerId: row.playerId, direction: "up" };
    if (row.rank > previousRank) return { playerId: row.playerId, direction: "down" };
    return { playerId: row.playerId, direction: "same" };
  });
}

// --- Next-up card ---------------------------------------------------------

export interface InterludeGameInfo {
  id?: string;
  name: string;
  description?: string;
}

/** The slice of `SessionView` the card needs; keeps this module decoupled. */
export interface InterludeSessionLike {
  status?: "voting" | "playing" | "finished";
  currentGameId?: string | null;
  leadingGameId?: string | null;
  candidates?: readonly InterludeGameInfo[];
}

export interface InterludePlayerLike {
  spectator?: boolean;
  connected?: boolean;
  presence?: "active" | "away" | "left";
}

export interface InterludeCardInput {
  /** Session view, when the room is in a Rumble. */
  session?: InterludeSessionLike | null;
  /** Explicit "next up" game; wins over the session's pick. */
  nextGame?: InterludeGameInfo | null;
  /** Live room players, used for the "playing with N" line. */
  players?: readonly InterludePlayerLike[];
  /** Fallback count when the caller has no player list. */
  playerCount?: number;
}

export interface InterludeCard {
  title: string;
  gameName: string;
  rule: string;
  playerCount: number;
  durationMs: number;
}

/** Players who count for a game: connected, present and not spectating. */
export function livePlayerCount(players: readonly InterludePlayerLike[] | undefined): number {
  if (!players) return 0;
  return players.filter(
    (player) =>
      player !== null &&
      player !== undefined &&
      player.spectator !== true &&
      player.connected !== false &&
      (player.presence ?? "active") === "active",
  ).length;
}

/**
 * Flatten a game description to one readable line: first sentence when it fits,
 * otherwise a word-boundary truncation with an ellipsis. Never empty.
 */
export function oneLineRule(description: unknown, maxChars = 96): string {
  if (typeof description !== "string") return FALLBACK_RULE;
  const text = description.replace(/\s+/g, " ").trim();
  if (!text) return FALLBACK_RULE;

  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text);
  if (sentence && sentence[1].length <= maxChars) return sentence[1];

  if (text.length <= maxChars) return text;

  const cut = text.slice(0, maxChars + 1);
  const boundary = cut.lastIndexOf(" ");
  const head = boundary > maxChars * 0.5 ? cut.slice(0, boundary) : text.slice(0, maxChars);
  const trimmed = head.replace(/[\s,;:.\-–—]+$/, "");
  return `${trimmed || text.slice(0, maxChars)}…`;
}

/** The game the interlude should headline, resolved from explicit or session data. */
function resolveNextGame(input: InterludeCardInput): InterludeGameInfo | null {
  const explicit = input.nextGame;
  if (explicit && typeof explicit.name === "string" && explicit.name.trim()) return explicit;

  const session = input.session;
  const candidates = Array.isArray(session?.candidates) ? session.candidates : [];
  const wanted = session?.currentGameId ?? session?.leadingGameId ?? null;
  if (wanted) {
    const match = candidates.find((candidate) => candidate.id === wanted);
    if (match) return match;
  }
  return candidates[0] ?? null;
}

/**
 * Build the between-game card: title, next game, its one-line rule, the live
 * player count and the interlude duration.
 */
export function interludeCard(input: InterludeCardInput = {}): InterludeCard {
  const game = resolveNextGame(input);
  const players = input.players;
  const playerCount = players
    ? livePlayerCount(players)
    : Math.max(0, Math.trunc(Number(input.playerCount ?? 0)) || 0);

  return {
    title: "That's a wrap",
    gameName: game && game.name.trim() ? game.name.trim() : "Table's choice",
    rule: game ? oneLineRule(game.description) : NO_GAME_RULE,
    playerCount,
    durationMs: INTERLUDE_DURATION_MS,
  };
}

// --- Caption bank ---------------------------------------------------------

export type CaptionKind = "fooled" | "fastest" | "perfect" | "catchup" | "favourite" | "reveal";

export interface CaptionEvent {
  kind: CaptionKind;
  /** Public display name. Never a role, word or private value. */
  name?: string;
  /** Public count, for example how many players were fooled. */
  count?: number;
  /** Any numeric seed; the same seed always picks the same line. */
  seed?: number;
}

/**
 * Fixed TV captions. Placeholders are `{name}` and `{count}` only; there is no
 * path for game text to reach the screen through this bank.
 */
const CAPTION_BANK: Record<CaptionKind, readonly string[]> = {
  fooled: [
    "{name} fooled {count} people!",
    "{count} players fell for {name}'s fib.",
    "{name} reeled in {count} believers.",
  ],
  fastest: [
    "{name} hit the button first!",
    "Fastest fingers: {name}.",
    "{name} was quickest off the mark.",
  ],
  perfect: [
    "A perfect round for {name}!",
    "{name} got every single one.",
    "Flawless — {name} nailed the lot.",
  ],
  catchup: [
    "{name} is closing the gap!",
    "Look out — {name} is coming back.",
    "{name} just made it interesting.",
  ],
  favourite: [
    "{name} won the room with {count} votes!",
    "{count} votes for {name} — the crowd has spoken.",
    "{name} is the crowd favourite with {count} votes.",
  ],
  reveal: [
    "Here comes the reveal.",
    "Let's see how that landed.",
    "The truth is out.",
  ],
};

const CAPTION_KINDS: readonly CaptionKind[] = ["fooled", "fastest", "perfect", "catchup", "favourite", "reveal"];

function isCaptionKind(value: unknown): value is CaptionKind {
  return typeof value === "string" && (CAPTION_KINDS as readonly string[]).includes(value);
}

/** Deterministic index: negative, fractional and NaN seeds all land in range. */
function pickIndex(seed: unknown, length: number): number {
  if (length <= 0) return 0;
  const value = Number(seed);
  if (!Number.isFinite(value)) return 0;
  return ((Math.trunc(value) % length) + length) % length;
}

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const text = name.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 20 ? `${text.slice(0, 19)}…` : text;
}

/**
 * Pick a caption from the fixed bank. Deterministic for the same `seed`, and
 * every placeholder is filled before returning. A line that would need a
 * missing name or count falls back to the generic reveal bank.
 */
export function captionFor(event: CaptionEvent): string {
  const kind: CaptionKind = isCaptionKind(event?.kind) ? event.kind : "reveal";
  const name = cleanName(event?.name);
  const countValue = Number(event?.count);
  const count = Number.isFinite(countValue) ? Math.max(0, Math.trunc(countValue)) : null;

  const lines = CAPTION_BANK[kind];
  const usable = lines.filter(
    (line) => (!line.includes("{name}") || name !== null) && (!line.includes("{count}") || count !== null),
  );
  const pool = usable.length > 0 ? usable : CAPTION_BANK.reveal;
  const line = pool[pickIndex(event?.seed, pool.length)] ?? CAPTION_BANK.reveal[0];

  return line
    .replaceAll("{name}", name ?? "Someone")
    .replaceAll("{count}", String(count ?? 0));
}

// --- Count-up -------------------------------------------------------------

/**
 * Interpolate a score for a count-up animation.
 *
 * `progress` is clamped to 0..1 and eased out, so a score settles quickly and
 * lands exactly on `to`. Non-finite numbers degrade to the start value.
 */
export function countUp(from: number, to: number, progress: number): number {
  const start = Number.isFinite(from) ? from : 0;
  const end = Number.isFinite(to) ? to : start;
  const raw = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const eased = 1 - (1 - raw) ** 3;
  return Math.round(start + (end - start) * eased);
}
