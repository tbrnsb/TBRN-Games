/**
 * TV sound and speech hooks (Phase 2, brief 3.8).
 *
 * Pins the pure pieces only: cue normalisation and dedupe, the announce-change
 * rule, and settings persistence over a fake storage. No browser or WebAudio
 * is required to run these.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  cueSignature,
  cuesFromScreen,
  cuesToPlay,
  isSoundCue,
} from "../client/screen/sound.ts";
import { shouldAnnounce } from "../client/screen/speech.ts";
import {
  SOUND_KEY,
  SPEECH_KEY,
  defaultSetting,
  loadTvSettings,
  readSetting,
  writeSetting,
  type SettingsStorage,
} from "../client/screen/settings.ts";

interface FakeStorage extends SettingsStorage {
  data: Map<string, string>;
}

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("cuesFromScreen", () => {
  test("accepts a single cue and an array of cues", () => {
    assert.deepStrictEqual(cuesFromScreen({ sound: "reveal" }), ["reveal"]);
    assert.deepStrictEqual(cuesFromScreen({ sound: ["vote", "win"] }), ["vote", "win"]);
  });

  test("drops unknown ids and collapses duplicates within one state", () => {
    assert.deepStrictEqual(
      cuesFromScreen({ sound: ["reveal", "nope", "reveal", 42, "tick"] }),
      ["reveal", "tick"],
    );
    assert.deepStrictEqual(cuesFromScreen({ sound: "explosion" }), []);
    assert.deepStrictEqual(cuesFromScreen({}), []);
    assert.deepStrictEqual(cuesFromScreen(null), []);
    assert.deepStrictEqual(cuesFromScreen("reveal"), []);
  });

  test("isSoundCue only matches the five shipped cues", () => {
    for (const cue of ["reveal", "vote", "win", "tick", "whoosh"]) {
      assert.ok(isSoundCue(cue), `${cue} should be a cue`);
    }
    for (const value of ["", "Reveal", "beep", 3, null, undefined]) {
      assert.ok(!isSoundCue(value), `${String(value)} should not be a cue`);
    }
  });
});

describe("cue dedupe", () => {
  test("a republished cue list has the same signature", () => {
    const first = cuesFromScreen({ sound: "reveal", round: 1 });
    const nextFrame = cuesFromScreen({ sound: "reveal", round: 1 });
    assert.strictEqual(cueSignature(first), cueSignature(nextFrame));
  });

  test("the same signature plays nothing and a change replays the list", () => {
    const reveal = cuesFromScreen({ sound: "reveal" });
    const signature = cueSignature(reveal);
    assert.deepStrictEqual(cuesToPlay(signature, reveal), []);
    assert.deepStrictEqual(cuesToPlay(signature, cuesFromScreen({ sound: "win" })), ["win"]);
    assert.deepStrictEqual(cuesToPlay("", []), []);
  });

  test("removing the field changes the signature without playing anything", () => {
    const played = cueSignature(cuesFromScreen({ sound: "vote" }));
    const cleared = cuesToPlay(played, cuesFromScreen({}));
    assert.deepStrictEqual(cleared, []);
    assert.notStrictEqual(cueSignature(cuesFromScreen({})), played);
  });
});

describe("shouldAnnounce", () => {
  test("speaks a new, non-empty line", () => {
    assert.strictEqual(shouldAnnounce("", "Jamie, you're up"), true);
    assert.strictEqual(shouldAnnounce("Ana, you're up", "Ben, you're up"), true);
  });

  test("does not repeat the same line, ignoring surrounding whitespace", () => {
    assert.strictEqual(shouldAnnounce("Ana, you're up", "Ana, you're up"), false);
    assert.strictEqual(shouldAnnounce("  Ana, you're up ", "Ana, you're up"), false);
    assert.strictEqual(shouldAnnounce("Ana", "\t Ana \n"), false);
  });

  test("never speaks empty or whitespace-only text", () => {
    assert.strictEqual(shouldAnnounce("Ana", ""), false);
    assert.strictEqual(shouldAnnounce("Ana", "   "), false);
    assert.strictEqual(shouldAnnounce("", ""), false);
  });
});

describe("TV settings persistence", () => {
  test("both preferences default to on", () => {
    assert.strictEqual(defaultSetting(), true);
    const storage = fakeStorage();
    assert.deepStrictEqual(loadTvSettings(storage, true), { sound: true, speech: true });
  });

  test("speech is forced off when the browser has no synthesiser", () => {
    const storage = fakeStorage({ [SPEECH_KEY]: "on", [SOUND_KEY]: "on" });
    assert.deepStrictEqual(loadTvSettings(storage, false), { sound: true, speech: false });
    assert.strictEqual(readSetting(storage, SPEECH_KEY), true);
  });

  test("writes and reads both keys independently", () => {
    const storage = fakeStorage();
    writeSetting(storage, SOUND_KEY, false);
    writeSetting(storage, SPEECH_KEY, false);
    assert.deepStrictEqual(loadTvSettings(storage, true), { sound: false, speech: false });

    writeSetting(storage, SOUND_KEY, true);
    assert.deepStrictEqual(loadTvSettings(storage, true), { sound: true, speech: false });
    assert.strictEqual(storage.data.get(SOUND_KEY), "on");
    assert.strictEqual(storage.data.get(SPEECH_KEY), "off");
  });

  test("garbage and unknown values fall back to the default", () => {
    const storage = fakeStorage({ [SOUND_KEY]: "maybe", [SPEECH_KEY]: "1" });
    assert.deepStrictEqual(loadTvSettings(storage, true), { sound: true, speech: true });
  });

  test("a missing or throwing storage never breaks the screen", () => {
    assert.deepStrictEqual(loadTvSettings(null, true), { sound: true, speech: true });
    assert.doesNotThrow(() => writeSetting(null, SOUND_KEY, false));

    const blocked: SettingsStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };
    assert.doesNotThrow(() => readSetting(blocked, SOUND_KEY));
    assert.strictEqual(readSetting(blocked, SOUND_KEY), true);
    assert.doesNotThrow(() => writeSetting(blocked, SPEECH_KEY, false));
  });
});
