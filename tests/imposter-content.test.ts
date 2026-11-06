/**
 * Guess the Imposter content pack validation.
 *
 * The pack (games/guessimposter/content/words.json) is the only data this
 * game has so far. These tests pin the contract the game code will rely on:
 * enough entries, enough categories, a lookalike in the same category, and
 * exactly five same-category decoys that never collide with the word or the
 * lookalike anywhere in the pack.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packPath = join(process.cwd(), "games", "guessimposter", "content", "words.json");

interface Entry {
  category: string;
  word: string;
  lookalike: string;
  decoys: string[];
}

const entries: Entry[] = JSON.parse(readFileSync(packPath, "utf8"));

const MIN_ENTRIES = 150;
const MIN_CATEGORIES = 12;
const MIN_PER_CATEGORY = 8;
const DECOYS_PER_ENTRY = 5;
const MIN_LEN = 2;
const MAX_LEN = 40;

const isAscii = (s: string) => /^[\x20-\x7E]+$/.test(s);

describe("guess the imposter content pack", () => {
  test("ships at least 150 entries", () => {
    assert.ok(Array.isArray(entries), "words.json must be an array");
    assert.ok(entries.length >= MIN_ENTRIES, `expected >= ${MIN_ENTRIES} entries, found ${entries.length}`);
  });

  test("spans at least 12 categories", () => {
    const categories = new Set(entries.map((e) => e.category));
    assert.ok(categories.size >= MIN_CATEGORIES, `expected >= ${MIN_CATEGORIES} categories, found ${categories.size}`);
  });

  test("every category has at least 8 entries", () => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    for (const [category, count] of counts) {
      assert.ok(count >= MIN_PER_CATEGORY, `category ${category} has only ${count} entries (need ${MIN_PER_CATEGORY})`);
    }
  });

  test("every entry has exactly 5 decoys, distinct from the word and lookalike", () => {
    for (const e of entries) {
      const label = `${e.category}/${e.word}`;
      assert.strictEqual(e.decoys.length, DECOYS_PER_ENTRY, `${label}: expected ${DECOYS_PER_ENTRY} decoys`);
      assert.strictEqual(new Set(e.decoys).size, DECOYS_PER_ENTRY, `${label}: decoys are not distinct`);
      for (const d of e.decoys) {
        assert.notStrictEqual(d, e.word, `${label}: decoy equals the word`);
        assert.notStrictEqual(d, e.lookalike, `${label}: decoy equals the lookalike`);
      }
    }
  });

  test("every decoy sits in the same category as its word", () => {
    // Words, lookalikes and decoys all come from one vocabulary per category,
    // so the category of a string is wherever it first appears in the pack.
    const categoryOf = new Map<string, string>();
    for (const e of entries) {
      categoryOf.set(e.word, e.category);
      categoryOf.set(e.lookalike, e.category);
      for (const d of e.decoys) {
        if (!categoryOf.has(d)) categoryOf.set(d, e.category);
      }
    }
    for (const e of entries) {
      for (const d of e.decoys) {
        const owner = categoryOf.get(d);
        assert.strictEqual(owner, e.category, `${e.category}/${e.word}: decoy ${d} belongs to ${owner ?? "nothing"}`);
      }
    }
  });

  test("no word or lookalike repeats anywhere in the pack", () => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      for (const field of ["word", "lookalike"] as const) {
        const value = e[field];
        assert.ok(!seen.has(value), `${value} used by both ${seen.get(value)} and ${e.category}/${e.word} (${field})`);
        seen.set(value, `${e.category}/${e.word} (${field})`);
      }
    }
  });

  test("word and lookalike differ within every entry", () => {
    for (const e of entries) {
      assert.notStrictEqual(e.word, e.lookalike, `${e.category}: word equals lookalike`);
    }
  });

  test("every string is plain ASCII and 2-40 characters", () => {
    for (const e of entries) {
      const label = `${e.category}/${e.word}`;
      for (const s of [e.category, e.word, e.lookalike, ...e.decoys]) {
        assert.ok(isAscii(s), `${label}: non-ASCII string ${JSON.stringify(s)}`);
        assert.ok(s.length >= MIN_LEN, `${label}: string too short ${JSON.stringify(s)}`);
        assert.ok(s.length <= MAX_LEN, `${label}: string too long ${JSON.stringify(s)}`);
      }
    }
  });

  test("every entry has the full shape with non-empty fields", () => {
    for (const e of entries) {
      const label = `${e.category}/${e.word}`;
      assert.strictEqual(typeof e.category, "string", `${label}: category missing`);
      assert.strictEqual(typeof e.word, "string", `${label}: word missing`);
      assert.strictEqual(typeof e.lookalike, "string", `${label}: lookalike missing`);
      assert.ok(e.category.length > 0, `${label}: empty category`);
      assert.ok(e.word.length > 0, `${label}: empty word`);
      assert.ok(e.lookalike.length > 0, `${label}: empty lookalike`);
      assert.ok(Array.isArray(e.decoys), `${label}: decoys must be an array`);
    }
  });
});
