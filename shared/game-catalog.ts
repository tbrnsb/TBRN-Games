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
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 6, rumble: 6 },
    dropoutPolicy: "continue",
    contentPacks: ["chips"],
    scale: fixedScale(2, { chips: 60, build: 90, vote: 25, reveal: 9 }),
  },
  bracket: {
    id: "bracket",
    displayName: "Bracket Brawl",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 5, rumble: 4 },
    dropoutPolicy: "forfeit",
    contentPacks: [],
    scale: fixedScale(2, { write: 60, vote: 20, reveal: 9 }, { options: 2 }),
  },
  dumbinventions: {
    id: "dumbinventions",
    displayName: "Dumb Inventions",
    enabled: true,
    kind: "writing",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 6,
    minutes: { standalone: 4, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: ["problems", "words"],
    scale: fixedScale(2, { invent: 90, vote: 25, reveal: 9 }),
  },
  mostlikely: {
    id: "mostlikely",
    displayName: "Most Likely To",
    enabled: true,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: (playerCount) => ({
      rounds: 8,
      timers: { vote: 15, reveal: 4 },
      optionCaps: { options: playerCount },
    }),
  },
  stowaway: {
    id: "stowaway",
    displayName: "Stowaway",
    enabled: true,
    kind: "deduction",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 7, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: fixedScale(4, { brief: 6, clue: 45, discuss: 30, vote: 20, catch: 20, reveal: 8 }, { options: 6 }),
  },
  fakin: {
    id: "fakin",
    displayName: "Fakin' It",
    enabled: true,
    kind: "deduction",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 3 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount) => ({
      rounds: 3,
      timers: { act: 25, vote: 20, reveal: 8 },
      optionCaps: { options: playerCount },
    }),
  },
  blather: {
    id: "blather",
    displayName: "Blather Round",
    enabled: true,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 5, rumble: 5 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: fixedScale(3, { clue: 40, guess: 45, reveal: 8 }),
  },
  slideroulette: {
    id: "slideroulette",
    displayName: "Slide Roulette",
    enabled: true,
    kind: "party",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 7, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: ["topics"],
    scale: (playerCount) => ({
      rounds: playerCount,
      timers: { write: 30, slide: 15, rate: 20, reveal: 8 },
    }),
  },
  drawful: {
    id: "drawful",
    displayName: "Drawful",
    enabled: true,
    kind: "drawing",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 7, rumble: 7 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: (playerCount) => ({
      rounds: Math.min(3, playerCount),
      timers: { draw: 60, bluff: 35, vote: 25, reveal: 9 },
      optionCaps: { options: playerCount + 1 },
    }),
  },
  sloganshirts: {
    id: "sloganshirts",
    displayName: "Slogan Shirts",
    enabled: true,
    kind: "drawing",
    minPlayers: 3,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 4, rumble: 4 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: (playerCount) => ({
      rounds: 2,
      timers: { draw: 60, slogan: 30, vote: 25, reveal: 9 },
      optionCaps: { options: playerCount },
    }),
  },
  quiz: {
    id: "quiz",
    displayName: "Quiz",
    enabled: true,
    kind: "trivia",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: [],
    scale: fixedScale(10, { question: 15, reveal: 3 }, { options: 4 }),
  },
  mindmeld: {
    id: "mindmeld",
    displayName: "Mind Meld",
    enabled: true,
    kind: "party",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 4,
    idealMax: 8,
    minutes: { standalone: 3, rumble: 2 },
    dropoutPolicy: "continue",
    contentPacks: ["categories"],
    scale: fixedScale(6, { collect: 20, reveal: 8 }),
  },
  percentile: {
    id: "percentile",
    displayName: "Percentile",
    enabled: true,
    kind: "trivia",
    minPlayers: 2,
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 4, rumble: 4 },
    dropoutPolicy: "void-round",
    contentPacks: [],
    scale: fixedScale(5, { guess: 30, bet: 15, reveal: 7 }),
  },
  archery: {
    id: "archery",
    displayName: "Archery",
    enabled: true,
    kind: "skill",
    minPlayers: 1,
    maxPlayers: 4,
    idealMin: 2,
    idealMax: 8,
    minutes: { standalone: 2, rumble: 2 },
    dropoutPolicy: "pause",
    contentPacks: [],
    scale: fixedScale(5),
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
    scale: fixedScale(3, { round: 60, shot: 20 }),
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
    maxPlayers: 4,
    idealMin: 3,
    idealMax: 8,
    minutes: { standalone: 1, rumble: 1 },
    dropoutPolicy: "continue",
    contentPacks: [],
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
