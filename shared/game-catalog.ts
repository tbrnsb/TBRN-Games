/**
 * Game catalog — the single source of truth for the platform manifest fields
 * that are not already supplied by `games/<id>/manifest.json`.
 *
 * `manifest.json` still owns `id`, `name`, `minPlayers`, `maxPlayers`,
 * `controllerType` and the copy (description/howTo). This file owns the
 * platform metadata the lobby, the Rumble planner and the drop-out rules need:
 * display name, enabled flag, kind, ideal range, duration estimates, drop-out
 * policy, content packs and the per-player-count scale.
 *
 * Hard player ranges here mirror each game's current `manifest.json`; a later
 * per-game task widens them game by game. `idealMin`/`idealMax` are the brief's
 * design targets, which the lobby shows as "best with 4-8".
 *
 * Timing values in `GameScale.timers` are whole seconds (games use ms
 * internally). `scale()` reports what the game does TODAY; `minutes.rumble`
 * uses the brief's shorter Rumble round counts, which Phase 5 will implement.
 */

export type GameKind = "writing" | "drawing" | "deduction" | "trivia" | "skill" | "party" | "cards";

export type DropoutPolicy = "continue" | "pause" | "void-round" | "forfeit";

export type ScaleMode = "standalone" | "rumble";

export interface GameScale {
  rounds: number;
  /** Phase timers in whole seconds, keyed by phase name. */
  timers?: Record<string, number>;
  /** Upper bound of any option list the round shows, keyed by what it is. */
  optionCaps?: Record<string, number>;
}

export interface GameCatalogEntry {
  id: string;
  displayName: string;
  enabled: boolean;
  kind: GameKind;
  minPlayers: number;
  maxPlayers: number;
  idealMin: number;
  idealMax: number;
  minutes: { standalone: number; rumble: number };
  dropoutPolicy: DropoutPolicy;
  contentPacks: string[];
  scale: (playerCount: number, mode: ScaleMode) => GameScale;
}

/** Build a scale that does not depend on the player count or the mode yet. */
function fixedScale(
  rounds: number,
  timers?: Record<string, number>,
  optionCaps?: Record<string, number>,
): (playerCount: number, mode: ScaleMode) => GameScale {
  return (_playerCount, _mode) => {
    const scale: GameScale = { rounds };
    if (timers) scale.timers = { ...timers };
    if (optionCaps) scale.optionCaps = { ...optionCaps };
    return scale;
  };
}

/**
 * Every game directory that ships a `server.ts`. Enabled games are playable;
 * disabled games stay in the tree (never deleted) and are filtered out of the
 * lobby, `/api/games` and the game-start endpoint.
 */
export const GAME_CATALOG: Record<string, GameCatalogEntry> = {
  // --- Enabled ---
  bluff: {
    id: "bluff",
    displayName: "Bluff",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 6, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: ["Facts", "Dictionary"],
    scale: (playerCount, mode) => ({
      // Standalone is always six rounds. Rumble drops to four, and to three
      // in a full 7-8 player room, per brief 4.
      rounds: mode === "rumble" ? (playerCount >= 7 ? 3 : 4) : 6,
      timers: { write: 30, vote: 20, reveal: 6 },
      optionCaps: { options: playerCount + 1 },
    }),
  },
  writevote: {
    id: "writevote",
    displayName: "Write & Vote",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 6, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // Five standalone rounds; the Rumble runs three shorter rounds.
      rounds: mode === "rumble" ? 3 : 5,
      timers: { write: 45, vote: 20, reveal: 6 },
      optionCaps: { options: playerCount },
    }),
  },
  splitroom: {
    id: "splitroom",
    displayName: "Split the Room",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 5, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // One write per player, but standalone never drops below four rounds, so
      // the 3-4 player game and its totals stay exactly as they were. Rumble
      // caps at four rounds.
      rounds: mode === "rumble"
        ? Math.min(playerCount, 4)
        : Math.max(4, Math.min(playerCount, 8)),
      timers: { write: 45, vote: 25, reveal: 8 },
      optionCaps: { options: 2 },
    }),
  },
  survive: {
    id: "survive",
    displayName: "Survive the Internet",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 6,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 6, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // Three standalone rounds; the Rumble runs two. Timers stay unchanged.
      rounds: mode === "rumble" ? 2 : 3,
      timers: { answer: 45, twist: 40, vote: 25, reveal: 9 },
      optionCaps: { options: playerCount },
    }),
  },
  frankenanswers: {
    id: "frankenanswers",
    displayName: "Frankenanswers",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 6,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 6, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: ["chips"],
    scale: (playerCount, mode) => ({
      // Three standalone rounds; the Rumble runs two. Every player is dealt
      // six foreign chips plus four connectors at any count.
      rounds: mode === "rumble" ? 2 : 3,
      timers: { chips: 60, build: 90, vote: 25, reveal: 9 },
      optionCaps: { chips: 6, connectors: 4, options: playerCount },
    }),
  },
  bracket: {
    id: "bracket",
    displayName: "Bracket Brawl",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 6,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 5, rumble: 4 },
    dropoutPolicy: "forfeit",
    contentPacks: [],
    scale: (playerCount) => ({
      // 3-4 keep the old two brackets; 5-6 play one full power-of-two bracket.
      rounds: playerCount <= 4 ? 2 : 1,
      timers: { write: 60, vote: 20, reveal: 9 },
      optionCaps: { options: 2 },
    }),
  },
  dumbinventions: {
    id: "dumbinventions",
    displayName: "Dumb Inventions",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 6,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 6, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: ["problems", "words"],
    scale: (playerCount, mode) => ({
      // Three standalone rounds; the Rumble runs two shorter rounds. The
      // invent/vote/reveal timers stay as they were at every count.
      rounds: mode === "rumble" ? 2 : 3,
      timers: { invent: 90, vote: 25, reveal: 9 },
      optionCaps: { options: playerCount },
    }),
  },
  mostlikely: {
    id: "mostlikely",
    displayName: "Most Likely To",
    enabled: true,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // Standalone keeps the eight-round game; the Rumble runs five.
      rounds: mode === "rumble" ? 5 : 8,
      // The 15-second ballot and 4-second result are unchanged; the 2-second
      // tally beat is the drum-roll added for eight-seat reveals.
      timers: { vote: 15, tally: 2, reveal: 4 },
      optionCaps: { options: playerCount },
    }),
  },
  stowaway: {
    id: "stowaway",
    displayName: "Stowaway",
    enabled: true,
    kind: "deduction",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 7, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // Three standalone rounds; the Rumble runs two. The brief/clue/discuss/
      // vote/catch/reveal timers stay unchanged at every count.
      rounds: mode === "rumble" ? 2 : 3,
      timers: { brief: 6, clue: 45, discuss: 30, vote: 20, catch: 20, reveal: 8 },
      // One ballot slot per seat and six category choices.
      optionCaps: { options: playerCount, categories: 6 },
    }),
  },
  fakin: {
    id: "fakin",
    displayName: "Fakin' It",
    enabled: true,
    kind: "deduction",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 5, rumble: 3 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // Five standalone rounds; the Rumble runs three. The 25-second acting
      // timer stays as it was at every count.
      rounds: mode === "rumble" ? 3 : 5,
      timers: { act: 25, vote: 20, reveal: 8 },
      // One ballot option per other seat: 7 on the largest phone.
      optionCaps: { options: Math.max(1, playerCount - 1) },
    }),
  },
  blather: {
    id: "blather",
    displayName: "Blather Round",
    enabled: true,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 6, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // One round per player, capped at six standalone; the Rumble runs four.
      rounds: mode === "rumble" ? 4 : Math.min(Math.max(playerCount, 1), 6),
      timers: { clue: 45, guess: 45, reveal: 8 },
    }),
  },
  slideroulette: {
    id: "slideroulette",
    displayName: "Slide Roulette",
    enabled: true,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 7, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: ["topics"],
    scale: (playerCount, mode) => ({
      // Standalone gives every player one presenter turn (up to eight); the
      // Rumble runs three presenters. Timers are unchanged at every count.
      rounds: mode === "rumble" ? 3 : Math.max(1, Math.min(playerCount, 8)),
      timers: { write: 30, slide: 15, rate: 20, reveal: 8 },
    }),
  },
  drawful: {
    id: "drawful",
    displayName: "Drawful",
    enabled: true,
    kind: "drawing",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 7, rumble: 7 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // 3-4 keeps the original three drawings for parity. From five players
      // every seat draws once in seat order. The Rumble caps at four drawings,
      // selected by secure random, and never asks for more than the table has.
      rounds: mode === "rumble"
        ? (playerCount <= 4 ? 3 : 4)
        : (playerCount <= 4 ? 3 : Math.min(playerCount, 8)),
      timers: { draw: 60, bluff: 35, vote: 25, reveal: 9 },
      // Real title plus one bluff per other seat: N options on the TV, N-1 on
      // each phone because a player never votes for their own bluff.
      optionCaps: { options: Math.max(1, Math.min(playerCount, 8)) },
    }),
  },
  sloganshirts: {
    id: "sloganshirts",
    displayName: "Slogan Shirts",
    enabled: true,
    kind: "drawing",
    minPlayers: 3,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 4, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: (playerCount, mode) => ({
      // 3-4 keep the original two rounds for parity. From five players the
      // game is one full cycle: one round with one shirt per player, or four
      // shirts in a Rumble, which is also one round.
      rounds: playerCount <= 4 ? Math.max(1, Math.min(2, playerCount)) : 1,
      timers: { draw: 60, slogan: 30, vote: 25, reveal: 9 },
      // One ballot slot per shirt; a 5-8 Rumble caps the TV at four shirts.
      optionCaps: {
        options: mode === "rumble" ? Math.max(1, Math.min(playerCount, 4)) : Math.max(1, playerCount),
      },
    }),
  },
  quiz: {
    id: "quiz",
    displayName: "Quiz",
    enabled: true,
    kind: "trivia",
    minPlayers: 1,
    maxPlayers: 8,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: ["quiz-questions"],
    // Standard standalone: 10 questions at 15 s. The Rumble's Fast mode:
    // 6 questions at 10 s with four options. Both modes show four options.
    scale: (_playerCount, mode) => ({
      rounds: mode === "rumble" ? 6 : 10,
      timers: { question: mode === "rumble" ? 10 : 15, reveal: 3 },
      optionCaps: { options: 4 },
    }),
  },
  mindmeld: {
    id: "mindmeld",
    displayName: "Mind Meld",
    enabled: true,
    kind: "party",
    minPlayers: 2,
    maxPlayers: 8,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: ["categories"],
    // Standalone keeps six rounds at 2-4 and runs five from five players up;
    // the Rumble runs four. Timers are unchanged at every count.
    scale: (playerCount, mode) => ({
      rounds: mode === "rumble" ? 4 : playerCount >= 5 ? 5 : 6,
      timers: { collect: 20, reveal: 8 },
    }),
  },
  percentile: {
    id: "percentile",
    displayName: "Percentile",
    enabled: true,
    kind: "trivia",
    minPlayers: 2,
    maxPlayers: 8,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 4, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: ["percentile-stats"],
    scale: (_playerCount, mode) => ({
      // Five standalone rounds (today's count); the "Everyone guesses once"
      // host setting lets `onStart` run N rounds, which `scale()` cannot see.
      rounds: mode === "rumble" ? 4 : 5,
      timers: { guess: 30, bet: 15, reveal: 7 },
    }),
  },
  archery: {
    id: "archery",
    displayName: "Archery",
    enabled: true,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 8,
    idealMin: 2,
    idealMax: 8,
    minutes: { standalone: 2, rumble: 2 },
    dropoutPolicy: "pause",
    contentPacks: [],
    scale: (_playerCount, mode) => ({ rounds: mode === "rumble" ? 3 : 5 }),
  },
  arena: {
    id: "arena",
    displayName: "Slingshot Arena",
    enabled: true,
    kind: "skill",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: [],
    // Standalone is best of three. The Rumble plays one match on the same
    // 60-second round clock, so it is always a single-round game.
    scale: (_playerCount, mode) => ({
      rounds: mode === "rumble" ? 1 : 3,
      timers: { round: 60, shot: 20 },
    }),
  },
  poker: {
    id: "poker",
    displayName: "Texas Hold'em",
    enabled: true,
    kind: "cards",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 5, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(12, { action: 25 }),
  },
  racing: {
    id: "racing",
    displayName: "Tap Race",
    enabled: true,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 8,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 1, rumble: 1 },
    dropoutPolicy: "continue",
    contentPacks: [],
    // One race at every count: 3-second countdown, 60-second buzzer. The
    // optional standalone best-of-3 is a host choice that stays off by default,
    // so the catalog reports the single-race game that actually starts.
    scale: fixedScale(1, { countdown: 3, race: 60 }),
  },

  // --- Disabled, kept in the tree ---
  darts: {
    id: "darts",
    displayName: "Darts",
    enabled: false,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(20),
  },
  golf: {
    id: "golf",
    displayName: "Golf",
    enabled: false,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 4,
    minutes: { standalone: 7, rumble: 7 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(5, { holeDone: 1.5 }),
  },
  knifethrow: {
    id: "knifethrow",
    displayName: "Knife Throw",
    enabled: false,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(3),
  },
  spinwar: {
    id: "spinwar",
    displayName: "Spin War",
    enabled: false,
    kind: "skill",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "forfeit",
    contentPacks: [],
    scale: fixedScale(1),
  },
  snakes: {
    id: "snakes",
    displayName: "Snakes",
    enabled: false,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(1),
  },
  trivia: {
    id: "trivia",
    displayName: "Quick Trivia",
    enabled: false,
    kind: "trivia",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 2, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(6, { question: 10, reveal: 5 }, { options: 4 }),
  },
  wordchain: {
    id: "wordchain",
    displayName: "Word Chain",
    enabled: false,
    kind: "writing",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 5, rumble: 5 },
    dropoutPolicy: "forfeit",
    contentPacks: ["words"],
    scale: fixedScale(1, { turn: 15 }),
  },
  mindreader: {
    id: "mindreader",
    displayName: "Mind Reader",
    enabled: false,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 4, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount) => ({
      rounds: playerCount,
      timers: { rank: 25, guess: 25, reveal: 9 },
    }),
  },
  dictionarium: {
    id: "dictionarium",
    displayName: "Dictionarium",
    enabled: false,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 7, rumble: 7 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(4, { write: 60, vote: 30, reveal: 9 }),
  },
  wordspud: {
    id: "wordspud",
    displayName: "Word Spud",
    enabled: false,
    kind: "writing",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: fixedScale(6, { round: 20, write: 12, reveal: 6 }),
  },
  bdate: {
    id: "bdate",
    displayName: "Blind Date Chat",
    enabled: false,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 6, rumble: 6 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount) => ({
      rounds: playerCount,
      timers: { brief: 6, chat: 60, pick: 20, reveal: 9 },
    }),
  },
  mashup: {
    id: "mashup",
    displayName: "Mash-Up Monsters",
    enabled: false,
    kind: "drawing",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 2, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(1, { draw: 45, name: 30, vote: 25, reveal: 10 }),
  },
  lastseat: {
    id: "lastseat",
    displayName: "Last Seat",
    enabled: false,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 4,
    minutes: { standalone: 2, rumble: 2 },
    dropoutPolicy: "forfeit",
    contentPacks: ["questions"],
    scale: fixedScale(8, { trivia: 20, reflex: 9, memory: 16, trap: 8 }),
  },
  hangman: {
    id: "hangman",
    displayName: "Hangman",
    enabled: false,
    kind: "writing",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 4,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(10),
  },
  guesswho: {
    id: "guesswho",
    displayName: "Guess Who",
    enabled: false,
    kind: "deduction",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 4,
    minutes: { standalone: 5, rumble: 5 },
    dropoutPolicy: "forfeit",
    contentPacks: [],
    scale: fixedScale(1, { turn: 45 }),
  },
};

/** The catalog entry for a game id, or undefined when the game is unknown. */
export function catalogEntry(id: string): GameCatalogEntry | undefined {
  return Object.prototype.hasOwnProperty.call(GAME_CATALOG, id) ? GAME_CATALOG[id] : undefined;
}

/** True only for games the catalog marks enabled. Unknown ids are disabled. */
export function isGameEnabled(id: string): boolean {
  return catalogEntry(id)?.enabled === true;
}

/**
 * Why a game cannot be played at this player count, or null when it fits.
 * Short enough for a lobby tile: "needs 3+", "needs 3-6", "max 6".
 */
export function gameAvailability(
  entry: Pick<GameCatalogEntry, "minPlayers" | "maxPlayers">,
  playerCount: number,
): string | null {
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  const { minPlayers, maxPlayers } = entry;

  if (count >= minPlayers && count <= maxPlayers) return null;
  if (count < minPlayers) {
    if (minPlayers === maxPlayers) return `needs ${minPlayers}`;
    if (maxPlayers >= 8) return `needs ${minPlayers}+`;
    return `needs ${minPlayers}-${maxPlayers}`;
  }
  return `max ${maxPlayers}`;
}
