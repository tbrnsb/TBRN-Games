/**
 * Royal Rumble preset config and resolver (brief section 6).
 *
 * Pins the five presets to the brief's table, proves every enabled game has a
 * home, and exercises the resolver at every player count from 3 to 8: keep,
 * bench, same-kind fallback, skip, swap announcements and the used-game rule.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { GAME_CATALOG } from "../shared/game-catalog.ts";
import {
  RUMBLE_PRESETS,
  RUMBLE_SLOT_COUNT,
  resolvePreset,
  validatePresets,
  type RumblePreset,
} from "../shared/rumble-presets.ts";

const ENABLED = Object.values(GAME_CATALOG)
  .filter((entry) => entry.enabled)
  .map((entry) => entry.id);

const EXPECTED_SLOTS: string[][] = [
  ["mostlikely", "quiz", "bluff", "racing", "drawful", "splitroom", "guessimposter", "archery"],
  ["writevote", "dumbinventions", "blather", "sloganshirts", "survive", "slideroulette", "splitroom", "bracket"],
  ["mindmeld", "mostlikely", "drawful", "fakin", "frankenanswers", "sloganshirts", "dumbinventions", "slideroulette"],
  ["quiz", "percentile", "bluff", "mindmeld", "archery", "arena", "racing", "poker"],
  ["mostlikely", "fakin", "bluff", "racing", "stowaway", "survive", "splitroom", "guessimposter"],
];

const EXPECTED_BENCH: string[][] = [
  ["writevote", "mindmeld", "stowaway", "fakin"],
  ["mostlikely", "mindmeld", "fakin", "stowaway"],
  ["writevote", "blather", "splitroom", "racing"],
  ["splitroom", "writevote", "stowaway", "blather"],
  ["writevote", "mindmeld", "drawful", "blather"],
];

const EXPECTED_NAMES = [
  "Friday Night at Mo's",
  "The Cousins Reunion",
  "Sleepover Hours",
  "Big Brain Sunday",
  "Who Ate the Last Slice?",
];

const EXPECTED_VIBES = [
  "All-rounder for any group",
  "Loud writing and voting chaos",
  "Creative, low pressure, silly",
  "Smart and competitive",
  "Suspicion and deception",
];

const EXPECTED_IDEAL: Array<[number, number]> = [
  [4, 8],
  [4, 8],
  [3, 6],
  [3, 8],
  [4, 8],
];

function fixture(slots: string[], bench: string[]): RumblePreset {
  return {
    id: "fixture",
    name: "Fixture",
    vibe: "test",
    idealMin: 3,
    idealMax: 8,
    slots: slots.map((gameId) => ({ gameId })),
    bench,
  };
}

describe("rumble presets", () => {
  test("ships the five presets from the brief's table", () => {
    assert.strictEqual(RUMBLE_PRESETS.length, 5);
    assert.strictEqual(new Set(RUMBLE_PRESETS.map((preset) => preset.id)).size, 5);

    RUMBLE_PRESETS.forEach((preset, index) => {
      assert.strictEqual(preset.name, EXPECTED_NAMES[index], `preset ${index}: name`);
      assert.strictEqual(preset.vibe, EXPECTED_VIBES[index], `preset ${index}: vibe`);
      assert.deepStrictEqual(
        [preset.idealMin, preset.idealMax],
        EXPECTED_IDEAL[index],
        `preset ${index}: ideal range`,
      );
      assert.strictEqual(preset.slots.length, RUMBLE_SLOT_COUNT, `preset ${index}: slot count`);
      assert.deepStrictEqual(
        preset.slots.map((slot) => slot.gameId),
        EXPECTED_SLOTS[index],
        `preset ${index}: slot order`,
      );
      assert.deepStrictEqual(preset.bench, EXPECTED_BENCH[index], `preset ${index}: bench order`);
    });
  });

  test("every enabled game appears in at least one preset", () => {
    const covered = new Set<string>();
    for (const preset of RUMBLE_PRESETS) {
      for (const slot of preset.slots) covered.add(slot.gameId);
      for (const id of preset.bench) covered.add(id);
    }
    for (const id of ENABLED) {
      assert.ok(covered.has(id), `enabled game "${id}" is in no preset`);
    }
  });

  test("the shipped presets validate clean", () => {
    assert.deepStrictEqual(validatePresets(), []);
  });

  test("mode and content-pack options match the brief", () => {
    const optionFor = (presetIndex: number, gameId: string) =>
      RUMBLE_PRESETS[presetIndex].slots.find((slot) => slot.gameId === gameId)?.options;

    assert.deepStrictEqual(optionFor(0, "quiz"), { mode: "fast" });
    assert.deepStrictEqual(optionFor(0, "bluff"), { contentPack: "facts" });
    assert.deepStrictEqual(optionFor(3, "quiz"), { mode: "standard" });
    assert.deepStrictEqual(optionFor(3, "bluff"), { contentPack: "dictionary" });
    assert.deepStrictEqual(optionFor(4, "bluff"), { contentPack: "facts" });
    assert.deepStrictEqual(optionFor(4, "guessimposter"), { includeLarper: true });
  });

  test("every preset resolves six or more unique valid games at 3-8 players", () => {
    for (const preset of RUMBLE_PRESETS) {
      for (let playerCount = 3; playerCount <= 8; playerCount++) {
        const { slots } = resolvePreset(preset, playerCount, [], ENABLED);
        assert.strictEqual(slots.length, RUMBLE_SLOT_COUNT, `${preset.id} @ ${playerCount}: slot count`);

        const ids = slots
          .map((slot) => slot.gameId)
          .filter((id): id is string => id !== null);
        assert.ok(
          ids.length >= 6,
          `${preset.id} @ ${playerCount}: only ${ids.length} of 8 slots resolved`,
        );
        assert.strictEqual(
          new Set(ids).size,
          ids.length,
          `${preset.id} @ ${playerCount}: duplicate game in the playlist`,
        );

        for (const id of ids) {
          const entry = GAME_CATALOG[id];
          assert.ok(entry, `${preset.id} @ ${playerCount}: unknown resolved game "${id}"`);
          assert.ok(entry.enabled, `${preset.id} @ ${playerCount}: disabled game "${id}"`);
          assert.ok(
            playerCount >= entry.minPlayers && playerCount <= entry.maxPlayers,
            `${preset.id} @ ${playerCount}: "${id}" does not fit ${entry.minPlayers}-${entry.maxPlayers}`,
          );
        }
      }
    }
  });

  test("swaps carry a one-line announcement naming the reason", () => {
    const { slots, swaps } = resolvePreset(RUMBLE_PRESETS[3], 8);
    const arenaSwap = swaps.find((swap) => swap.from === "arena");
    assert.ok(arenaSwap, "Slingshot Arena should be swapped at eight players");
    assert.strictEqual(arenaSwap.to, "splitroom");
    assert.match(arenaSwap.reason, /Slingshot Arena needs 2-4 players/);
    assert.strictEqual(
      arenaSwap.announcement,
      "Slingshot Arena needs 2-4 players, so we're playing Split the Room.",
    );

    const arenaSlot = slots.find((slot) => slot.originalId === "arena");
    assert.strictEqual(arenaSlot?.gameId, "splitroom");
    assert.strictEqual(arenaSlot?.announcement, arenaSwap.announcement);
    assert.strictEqual(arenaSlot?.options, undefined, "the kept game's options must not leak");

    // Every swap in every preset at every count is announced and names its target.
    for (const preset of RUMBLE_PRESETS) {
      for (let playerCount = 3; playerCount <= 8; playerCount++) {
        const result = resolvePreset(preset, playerCount, [], ENABLED);
        for (const swap of result.swaps) {
          assert.ok(swap.reason.length > 0, `${preset.id} @ ${playerCount}: empty swap reason`);
          assert.ok(
            swap.announcement.startsWith(`${swap.reason}, so we're playing `),
            `${preset.id} @ ${playerCount}: announcement does not name the reason`,
          );
          assert.ok(
            swap.announcement.includes(GAME_CATALOG[swap.to].displayName),
            `${preset.id} @ ${playerCount}: announcement does not name the replacement`,
          );
          assert.notStrictEqual(swap.from, swap.to);
        }
      }
    }
  });

  test("never reuses or announces an already-started game", () => {
    const used = ["mostlikely"];
    const { slots, swaps } = resolvePreset(RUMBLE_PRESETS[0], 5, used);

    const resolvedIds = slots
      .map((slot) => slot.gameId)
      .filter((id): id is string => id !== null);
    for (const id of used) {
      assert.ok(!resolvedIds.includes(id), `already-started game "${id}" came back`);
    }

    const swap = swaps.find((entry) => entry.from === "mostlikely");
    assert.ok(swap, "the used slot game should be swapped");
    assert.match(swap.reason, /already been played/);
    assert.strictEqual(slots[0].gameId, "writevote");
    assert.ok(swap.announcement.includes("Write & Vote"));
  });

  test("bench games are tried in order before the same-kind fallback", () => {
    const preset = fixture(["arena"], ["racing", "archery"]);

    assert.strictEqual(resolvePreset(preset, 8).slots[0].gameId, "racing");
    assert.strictEqual(resolvePreset(preset, 8, ["racing"]).slots[0].gameId, "archery");
  });

  test("same kind is the last resort and follows catalog order", () => {
    const preset = fixture(["arena"], []);
    const { slots, swaps } = resolvePreset(preset, 8);

    assert.strictEqual(slots[0].gameId, "archery");
    assert.strictEqual(GAME_CATALOG.archery.kind, GAME_CATALOG.arena.kind);
    assert.strictEqual(swaps[0].to, "archery");
  });

  test("skips a slot when nothing valid is left", () => {
    const preset = fixture(["arena"], ["racing"]);
    const { slots, swaps } = resolvePreset(preset, 8, ["racing"], ["arena", "racing"]);

    assert.deepStrictEqual(slots, [{ originalId: "arena", gameId: null, announcement: null }]);
    assert.deepStrictEqual(swaps, []);
  });

  test("preset five asks for a Larper only from five players", () => {
    const lastSlice = RUMBLE_PRESETS[4];

    for (const playerCount of [3, 4]) {
      const slot = resolvePreset(lastSlice, playerCount).slots.find(
        (entry) => entry.originalId === "guessimposter",
      );
      assert.strictEqual(slot?.gameId, "guessimposter", `${playerCount}: game should be kept`);
      assert.strictEqual(slot?.options, undefined, `${playerCount}: Larper must be off`);
    }

    for (const playerCount of [5, 6, 7, 8]) {
      const slot = resolvePreset(lastSlice, playerCount).slots.find(
        (entry) => entry.originalId === "guessimposter",
      );
      assert.strictEqual(slot?.gameId, "guessimposter", `${playerCount}: game should be kept`);
      assert.deepStrictEqual(slot?.options, { includeLarper: true }, `${playerCount}: Larper should be on`);
    }

    // Resolving must not mutate the preset config.
    assert.deepStrictEqual(lastSlice.slots[7].options, { includeLarper: true });
  });

  test("validation catches a deliberately broken preset set", () => {
    const broken: RumblePreset[] = [
      {
        id: "broken",
        name: "Broken",
        vibe: "test",
        idealMin: 3,
        idealMax: 8,
        slots: [
          { gameId: "mostlikely" },
          { gameId: "mostlikely" },
          { gameId: "no-such-game" },
          { gameId: "bluff" },
          { gameId: "quiz" },
        ],
        bench: ["darts", "bluff"],
      },
    ];

    const problems = validatePresets(broken);
    const messages = problems.map((problem) => problem.message);
    const has = (fragment: string) => messages.some((message) => message.includes(fragment));

    assert.ok(has('unknown game id "no-such-game"'), messages.join(" | "));
    assert.ok(has('game "mostlikely" appears twice'), messages.join(" | "));
    assert.ok(has('bench game "darts" is not enabled'), messages.join(" | "));
    assert.ok(has('bench game "bluff" also appears in the slots'), messages.join(" | "));
    assert.ok(has("5 slots, expected 8"), messages.join(" | "));
    assert.ok(has('enabled game "archery" never appears'), messages.join(" | "));
    assert.ok(problems.some((problem) => problem.presetId === null), "roster gap should be preset-less");
  });
});
