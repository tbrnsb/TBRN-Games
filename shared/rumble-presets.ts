/**
 * Royal Rumble presets and the resolver (brief section 6).
 *
 * A Rumble is a playlist of eight games played back to back with one running
 * leaderboard. The playlist is data, not code: adding a sixth preset means
 * adding an entry to `RUMBLE_PRESETS`, nothing else.
 *
 * `resolvePreset()` runs at Rumble start and again before every game with the
 * current connected player count and the games already played. It keeps the
 * slot game when it still fits, substitutes the first usable bench game, then
 * any enabled game of the same kind, and otherwise drops the slot. Every swap
 * carries a one-line announcement for the TV.
 *
 * The module is pure: no clocks, no randomness, no server imports. Catalog
 * `enabled` flags are the default roster; a caller may narrow it (for example
 * to games the host has not switched off) by passing `enabledGames`.
 *
 * A skipped slot stays in `slots` with `gameId: null` so the caller still sees
 * eight slot positions; drop those entries when building the playlist.
 */

import { GAME_CATALOG, catalogEntry, type GameCatalogEntry } from "./game-catalog.ts";

/** User-facing Rumble name. One constant so it can be renamed before release. */
export const RUMBLE_NAME = "Royal Rumble";

/** Presets always describe eight games, per brief section 6. */
export const RUMBLE_SLOT_COUNT = 8;

/** One game slot in a preset, with any game-specific start options. */
export interface PresetSlot {
  gameId: string;
  options?: Record<string, unknown>;
}

/** A pre-built playlist plus its substitutes. */
export interface RumblePreset {
  id: string;
  name: string;
  /** Short description shown under the preset name in the lobby. */
  vibe: string;
  idealMin: number;
  idealMax: number;
  slots: PresetSlot[];
  /** Substitute game ids, tried in this order. */
  bench: string[];
}

/** A slot after resolution; `gameId` is null when no game could be found. */
export interface ResolvedSlot {
  /** The preset's slot game id, whether or not it was kept. */
  originalId: string;
  /** The game to play, or null when the slot was skipped. */
  gameId: string | null;
  /** Start options, already gated for the player count. */
  options?: Record<string, unknown>;
  /** TV line for a swap ("... needs 2-4 players, so we're playing ..."). */
  announcement: string | null;
}

/** One substitution, ready to show between games. */
export interface PresetSwap {
  /** The game the preset asked for. */
  from: string;
  /** The game that will actually be played. */
  to: string;
  /** One-line clause naming why the original game could not run. */
  reason: string;
  /** `reason` plus "so we're playing <to>." — the TV announcement. */
  announcement: string;
}

/** The full resolver result for one preset at one player count. */
export interface RumbleResolution {
  slots: ResolvedSlot[];
  swaps: PresetSwap[];
}

/** A configuration problem found by `validatePresets()`. */
export interface PresetProblem {
  /** The preset at fault, or null for a roster-wide problem. */
  presetId: string | null;
  message: string;
}

/**
 * Options that are only legal from a minimum player count, keyed by game then
 * option. The Larper needs five players (brief section 5), so the fifth preset
 * asks for one and the resolver drops the request at 3-4 players.
 */
const OPTION_MIN_PLAYERS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  guessimposter: { includeLarper: 5 },
};

/** The five presets from the brief's table, in table order. */
export const RUMBLE_PRESETS: RumblePreset[] = [
  {
    id: "friday-night-at-mos",
    name: "Friday Night at Mo's",
    vibe: "All-rounder for any group",
    idealMin: 4,
    idealMax: 8,
    slots: [
      { gameId: "mostlikely" },
      { gameId: "quiz", options: { mode: "fast" } },
      { gameId: "bluff", options: { contentPack: "facts" } },
      { gameId: "racing" },
      { gameId: "drawful" },
      { gameId: "splitroom" },
      { gameId: "guessimposter" },
      { gameId: "archery" },
    ],
    bench: ["writevote", "mindmeld", "stowaway", "fakin"],
  },
  {
    id: "cousins-reunion",
    name: "The Cousins Reunion",
    vibe: "Loud writing and voting chaos",
    idealMin: 4,
    idealMax: 8,
    slots: [
      { gameId: "writevote" },
      { gameId: "dumbinventions" },
      { gameId: "blather" },
      { gameId: "sloganshirts" },
      { gameId: "survive" },
      { gameId: "slideroulette" },
      { gameId: "splitroom" },
      { gameId: "bracket" },
    ],
    bench: ["mostlikely", "mindmeld", "fakin", "stowaway"],
  },
  {
    id: "sleepover-hours",
    name: "Sleepover Hours",
    vibe: "Creative, low pressure, silly",
    idealMin: 3,
    idealMax: 6,
    slots: [
      { gameId: "mindmeld" },
      { gameId: "mostlikely" },
      { gameId: "drawful" },
      { gameId: "fakin" },
      { gameId: "frankenanswers" },
      { gameId: "sloganshirts" },
      { gameId: "dumbinventions" },
      { gameId: "slideroulette" },
    ],
    bench: ["writevote", "blather", "splitroom", "racing"],
  },
  {
    id: "big-brain-sunday",
    name: "Big Brain Sunday",
    vibe: "Smart and competitive",
    idealMin: 3,
    idealMax: 8,
    slots: [
      { gameId: "quiz", options: { mode: "standard" } },
      { gameId: "percentile" },
      { gameId: "bluff", options: { contentPack: "dictionary" } },
      { gameId: "mindmeld" },
      { gameId: "archery" },
      { gameId: "arena" },
      { gameId: "racing" },
      { gameId: "poker" },
    ],
    bench: ["splitroom", "writevote", "stowaway", "blather"],
  },
  {
    id: "last-slice",
    name: "Who Ate the Last Slice?",
    vibe: "Suspicion and deception",
    idealMin: 4,
    idealMax: 8,
    slots: [
      { gameId: "mostlikely" },
      { gameId: "fakin" },
      { gameId: "bluff", options: { contentPack: "facts" } },
      { gameId: "racing" },
      { gameId: "stowaway" },
      { gameId: "survive" },
      { gameId: "splitroom" },
      { gameId: "guessimposter", options: { includeLarper: true } },
    ],
    bench: ["writevote", "mindmeld", "drawful", "blather"],
  },
];

/** Every catalog-enabled game id, in catalog order. */
function enabledCatalogIds(): string[] {
  return Object.values(GAME_CATALOG)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.id);
}

function displayName(id: string): string {
  return catalogEntry(id)?.displayName ?? id;
}

/** True when the game exists and its hard range contains `playerCount`. */
function fitsAt(entry: GameCatalogEntry, playerCount: number): boolean {
  return playerCount >= entry.minPlayers && playerCount <= entry.maxPlayers;
}

/** "3+", "3-6" or "4" — the range part of a "<game> needs ... players" line. */
function rangeLabel(entry: GameCatalogEntry): string {
  if (entry.minPlayers === entry.maxPlayers) return `${entry.minPlayers}`;
  if (entry.maxPlayers >= 8) return `${entry.minPlayers}+`;
  return `${entry.minPlayers}-${entry.maxPlayers}`;
}

/** One clause explaining why a slot game cannot be played as asked. */
function unavailableReason(
  id: string,
  playerCount: number,
  used: ReadonlySet<string>,
  enabled: ReadonlySet<string>,
): string {
  const name = displayName(id);
  if (used.has(id)) return `${name} has already been played this Rumble`;

  const entry = catalogEntry(id);
  if (!entry) return `${name} is not in the game catalog`;
  if (!entry.enabled || !enabled.has(id)) return `${name} is switched off`;
  return `${name} needs ${rangeLabel(entry)} players`;
}

/**
 * Copy the slot options, dropping any that are not legal at this player count.
 * Returns undefined rather than an empty object so a resolved slot carries no
 * options at all when nothing survives.
 */
function gatedOptions(
  gameId: string,
  options: Record<string, unknown> | undefined,
  playerCount: number,
): Record<string, unknown> | undefined {
  if (!options) return undefined;

  const gates = OPTION_MIN_PLAYERS[gameId];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    const minPlayers = gates?.[key];
    if (minPlayers !== undefined && playerCount < minPlayers) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** First enabled game of `kind` that fits and is unused, in catalog order. */
function sameKindFallback(
  originalId: string,
  playerCount: number,
  used: ReadonlySet<string>,
  enabled: ReadonlySet<string>,
): string | null {
  const kind = catalogEntry(originalId)?.kind;
  if (!kind) return null;

  for (const entry of Object.values(GAME_CATALOG)) {
    if (entry.kind !== kind) continue;
    if (!entry.enabled || !enabled.has(entry.id)) continue;
    if (used.has(entry.id)) continue;
    if (!fitsAt(entry, playerCount)) continue;
    return entry.id;
  }
  return null;
}

/**
 * Resolve one preset for the players actually in the room.
 *
 * `usedIds` are games already played (or already planned) in this Rumble; they
 * are never reused. Slots resolve in order, and every resolved game joins the
 * used set so the result can never contain the same game twice.
 */
export function resolvePreset(
  preset: RumblePreset,
  playerCount: number,
  usedIds: readonly string[] = [],
  enabledGames: readonly string[] = enabledCatalogIds(),
): RumbleResolution {
  const enabled = new Set(enabledGames);
  const used = new Set(usedIds);
  const slots: ResolvedSlot[] = [];
  const swaps: PresetSwap[] = [];

  const usable = (id: string): boolean => {
    if (!enabled.has(id) || used.has(id)) return false;
    const entry = catalogEntry(id);
    return entry !== undefined && entry.enabled && fitsAt(entry, playerCount);
  };

  for (const slot of preset.slots) {
    if (usable(slot.gameId)) {
      const options = gatedOptions(slot.gameId, slot.options, playerCount);
      slots.push({
        originalId: slot.gameId,
        gameId: slot.gameId,
        ...(options ? { options } : {}),
        announcement: null,
      });
      used.add(slot.gameId);
      continue;
    }

    const reason = unavailableReason(slot.gameId, playerCount, used, enabled);
    const replacement =
      preset.bench.find(usable) ?? sameKindFallback(slot.gameId, playerCount, used, enabled);

    if (!replacement) {
      slots.push({ originalId: slot.gameId, gameId: null, announcement: null });
      continue;
    }

    const announcement = `${reason}, so we're playing ${displayName(replacement)}.`;
    slots.push({ originalId: slot.gameId, gameId: replacement, announcement });
    swaps.push({ from: slot.gameId, to: replacement, reason, announcement });
    used.add(replacement);
  }

  return { slots, swaps };
}

/**
 * Check preset configuration. Returns an empty array when every preset is
 * playable. `presets` defaults to the shipped five so the same rules can judge
 * a fixture without changing the module's data.
 */
export function validatePresets(presets: readonly RumblePreset[] = RUMBLE_PRESETS): PresetProblem[] {
  const problems: PresetProblem[] = [];
  const add = (presetId: string | null, message: string): void => {
    problems.push({ presetId, message });
  };

  const seenPresetIds = new Set<string>();
  const covered = new Set<string>();

  for (const preset of presets) {
    if (seenPresetIds.has(preset.id)) add(preset.id, `duplicate preset id "${preset.id}"`);
    seenPresetIds.add(preset.id);

    if (preset.slots.length !== RUMBLE_SLOT_COUNT) {
      add(preset.id, `has ${preset.slots.length} slots, expected ${RUMBLE_SLOT_COUNT}`);
    }
    if (preset.idealMin > preset.idealMax) {
      add(preset.id, `ideal range ${preset.idealMin}-${preset.idealMax} is inverted`);
    }

    const slotIds = new Set<string>();
    for (const slot of preset.slots) {
      const entry = catalogEntry(slot.gameId);
      if (!entry) add(preset.id, `unknown game id "${slot.gameId}" in the slots`);
      else if (!entry.enabled) add(preset.id, `slot game "${slot.gameId}" is disabled`);
      if (slotIds.has(slot.gameId)) add(preset.id, `game "${slot.gameId}" appears twice in the slots`);
      slotIds.add(slot.gameId);
      covered.add(slot.gameId);
    }

    const benchIds = new Set<string>();
    for (const id of preset.bench) {
      const entry = catalogEntry(id);
      if (!entry) add(preset.id, `unknown bench game id "${id}"`);
      else if (!entry.enabled) add(preset.id, `bench game "${id}" is not enabled`);
      if (benchIds.has(id)) add(preset.id, `bench game "${id}" appears twice`);
      if (slotIds.has(id)) add(preset.id, `bench game "${id}" also appears in the slots`);
      benchIds.add(id);
      covered.add(id);
    }
  }

  for (const entry of Object.values(GAME_CATALOG)) {
    if (!entry.enabled) continue;
    if (!covered.has(entry.id)) add(null, `enabled game "${entry.id}" never appears in a preset`);
  }

  return problems;
}
