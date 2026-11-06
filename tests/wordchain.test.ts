/** Word Chain: normalization, validation rules, elimination and placement. */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { normalizeWord, validateWord } from "../games/wordchain/server.ts";

const DICT = new Set(["apple", "elephant", "tree", "eagle", "egg", "gold", "dog", "goat"]);
const dictWords: string[] = (JSON.parse(readFileSync(new URL("../games/wordchain/content/words.json", import.meta.url), "utf8")) as Array<{ text: string }>).map((w) => w.text);

const wordFor = (letter: string): string | undefined => dictWords.find((w) => w.startsWith(letter) && w.length >= 3);

const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, joinedAt: 0, rejoinToken: `t${i}`, connected: true }));
const room = (players: ReturnType<typeof mk>) => ({
  id: "r1", code: "ABCDE", hostPlayerId: players[0]?.id ?? null, players,
  gameId: "wordchain", gameState: null, createdAt: 0, status: "playing" as const,
});

describe("word chain", () => {
  test("normalization strips punctuation and case", () => {
    assert.strictEqual(normalizeWord("Apple!"), "apple");
    assert.strictEqual(normalizeWord("  EaGlE  "), "eagle");
    assert.strictEqual(normalizeWord("123"), "");
  });

  test("validation rejects wrong letter, repeats and unknown words", () => {
    assert.strictEqual(validateWord("apple", "a", [], DICT).ok, true);
    assert.strictEqual(validateWord("banana", "a", [], DICT).ok, false, "wrong first letter");
    assert.strictEqual(validateWord("apple", "a", ["apple"], DICT).ok, false, "already used");
    assert.strictEqual(validateWord("aardvark", "a", [], DICT).ok, false, "not in dictionary");
    assert.strictEqual(validateWord("a!", "a", [], DICT).ok, false, "too short");
  });

  test("scripted game: a good word passes the turn, two misses knock a player out", async () => {
    const plugin = (await import("../games/wordchain/server.ts")).default;
    const players = mk(2);
    const inst = plugin.onStart(room(players), players);
    const s = inst.state as any;

    const first = wordFor(s.lastLetter);
    assert.ok(first, `dictionary needs a word starting with ${s.lastLetter}`);
    plugin.onInput(inst, "p0", { text: first });
    assert.strictEqual(s.chain.length, 2);
    assert.strictEqual(s.current, 1, "turn passes to the next player");
    assert.strictEqual(s.lastLetter, first[first.length - 1]);

    // p1 misses twice and is eliminated.
    plugin.onInput(inst, "p1", { text: "zzzz" });
    assert.strictEqual(s.lives[1], 1);
    assert.strictEqual(s.current, 0, "missing a word still passes the turn");

    // p0 must play to come back around; use a bad word too, but keep p0 alive.
    plugin.onInput(inst, "p0", { text: "zzzz" });
    plugin.onInput(inst, "p1", { text: "zzzz" });

    assert.strictEqual(s.out[1], true, "two misses eliminate");
    assert.strictEqual(s.phase, "finished", "last player standing wins");
    assert.strictEqual(s.scores[0], 1000, "first place");
    assert.strictEqual(s.scores[1], 600, "second place");
  });
});
