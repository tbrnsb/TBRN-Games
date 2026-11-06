/**
 * Guess the Imposter TV renderer, host settings and phone layouts.
 *
 * The renderer runs on the real server payloads from a scripted game, drawn at
 * both target resolutions with a recording 2D context. Alongside the smoke
 * test, every hidden phase is re-scanned for the word, the lookalike and the
 * roles, so a payload change cannot quietly leak a secret to the shared screen.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

import plugin, {
  COUNTDOWN_MS,
  DISCONNECT_GRACE_MS,
  FINAL_GUESS_MS,
  PEEK_MS,
  REVEAL_MS,
  VOTE_REVEAL_MS,
  settingsFromOptions,
} from "../games/guessimposter/server.ts";
import { renderGuessimposter, type ImposterScreenState } from "../games/guessimposter/screen.ts";
import {
  LARPER_MIN_PLAYERS,
  TWO_IMPOSTERS_MIN_PLAYERS,
  defaultImposterSettings,
  imposterAvailability,
  imposterStartOptions,
  keepUnavailableChoices,
  normaliseImposterSettings,
  readImposterSettings,
  writeImposterSettings,
} from "../client/screen/imposter-settings.ts";
import type { SettingsStorage } from "../client/screen/settings.ts";

// --- Fixtures --------------------------------------------------------------

interface TestPlayer {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface TestInstance {
  roomId: string;
  players: TestPlayer[];
  state: {
    settings: {
      clueMode: "spoken" | "typed";
      clueRounds: number;
      discussionMs: number;
      turnTimerMs: number;
    };
    roles: {
      entry: { word: string; lookalike: string; category: string };
      imposters: number[];
      larper: number | null;
    };
    finalGuess: { seat: number; options: string[] } | null;
    active: boolean[];
    removed: boolean[];
  };
}

interface ScreenPayload {
  phase: string;
  countdownMs: number | null;
  timerMs: number | null;
  timerTotalMs: number | null;
  timerOff: boolean;
  activePlayer: { seat: number; name: string } | null;
  order: Array<{ seat: number; done: boolean; active: boolean }>;
  clues: Array<{ seat: number; text: string }>;
  vote: { cast: number; total: number; revote: boolean } | null;
  voteReveal: {
    ejected: { seat: number; side: string | null } | null;
    nobodyOut: boolean;
    secondTie: boolean;
    ballots: Array<{ seat: number; target: { seat: number } | null; skipped: boolean }>;
  } | null;
  finalGuess: { seat: number; name: string } | null;
  finalReveal: {
    word: string;
    lookalike: string;
    category: string;
    winner: string;
    imposters: Array<{ seat: number; name: string }>;
    larper: { seat: number; name: string; word: string } | null;
    guesses: Array<{ seat: number; name: string; correct: boolean; choice: string | null; options: string[] }>;
  } | null;
  ejected: Array<{ seat: number; side: string | null }>;
  players: Array<{ id: string; name: string; seat: number; score: number }>;
  waitingOn: string[];
  caption: string | null;
  sound: string | null;
  announce: string | null;
  finished: boolean;
}

function makePlayers(count: number): TestPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `P${index}`,
    joinedAt: 0,
    rejoinToken: `t${index}`,
    connected: true,
  }));
}

function startGame(count: number, options?: Record<string, unknown>): TestInstance {
  const players = makePlayers(count);
  const room = {
    id: "r1",
    code: "ABCDE",
    hostPlayerId: players[0].id,
    players,
    gameId: "guessimposter",
    gameState: null,
    createdAt: 0,
    status: "playing" as const,
  };
  return plugin.onStart(room, players, options) as unknown as TestInstance;
}

function screenOf(instance: TestInstance): ScreenPayload {
  return plugin.screenState(instance) as unknown as ScreenPayload;
}

function controllerOf(instance: TestInstance, seat: number): Record<string, unknown> {
  return plugin.controllerState(instance, instance.players[seat].id) as Record<string, unknown>;
}

/** Tick a phase in 2 s steps, the server's own per-tick cap. */
function tickFor(instance: TestInstance, ms: number): void {
  const phase = screenOf(instance).phase;
  let remaining = ms;
  while (remaining > 0 && screenOf(instance).phase === phase) {
    const step = Math.min(2000, remaining);
    plugin.onTick(instance, step);
    remaining -= step;
  }
}

/** One legal move for the current phase, as a simulated phone would send it. */
function stepOnce(instance: TestInstance, screen: ScreenPayload): void {
  switch (screen.phase) {
    case "countdown":
      tickFor(instance, COUNTDOWN_MS);
      return;
    case "peek":
      tickFor(instance, PEEK_MS);
      return;
    case "clue": {
      const active = screen.activePlayer;
      if (!active) throw new Error("clue phase without an active player");
      if (instance.state.settings.clueMode === "typed") {
        plugin.onInput(instance, instance.players[active.seat].id, { text: "clue" });
      } else {
        plugin.onInput(instance, instance.players[active.seat].id, { action: "done" });
      }
      return;
    }
    case "discussion":
      tickFor(instance, instance.state.settings.discussionMs);
      return;
    case "vote": {
      const seat = screen.players.findIndex(
        (player, index) =>
          instance.state.active[index] &&
          !instance.state.removed[index] &&
          controllerOf(instance, index).hasVoted !== true,
      );
      if (seat === -1) throw new Error("vote phase with nobody left to vote");
      // Prefer an Imposter so the word reaches a final guess; never vote self.
      const candidates = instance.state.roles.imposters.filter((target) => target !== seat);
      const target = candidates[0] ??
        screen.players.find((_, index) => index !== seat && instance.state.active[index])?.seat ??
        0;
      plugin.onInput(instance, instance.players[seat].id, { choice: `p:${target}` });
      return;
    }
    case "voteReveal":
      tickFor(instance, VOTE_REVEAL_MS);
      return;
    case "finalGuess": {
      const guess = instance.state.finalGuess;
      if (!guess) throw new Error("final guess phase without a guess");
      const wrong = guess.options.findIndex((option) => option !== instance.state.roles.entry.word);
      plugin.onInput(instance, instance.players[guess.seat].id, { choice: `o:${wrong}` });
      return;
    }
    case "reveal":
      tickFor(instance, REVEAL_MS);
      return;
    default:
      throw new Error(`no move for phase ${screen.phase}`);
  }
}

/** Walk the game frame by frame; `onScreen` may stop early by returning true. */
function walk(
  instance: TestInstance,
  onScreen: (screen: ScreenPayload) => boolean | void,
): "stopped" | "finished" {
  for (let step = 0; step < 6000; step += 1) {
    const screen = screenOf(instance);
    if (onScreen(screen) === true) return "stopped";
    if (screen.phase === "finished") return "finished";
    stepOnce(instance, screen);
  }
  throw new Error("game did not finish");
}

/** Minimal recording context: every unknown canvas method is a no-op. */
function makeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    measureText: (text: unknown) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const ALL_PHASES = [
  "countdown",
  "peek",
  "clue",
  "discussion",
  "vote",
  "voteReveal",
  "finalGuess",
  "reveal",
  "finished",
];

// --- Renderer smoke --------------------------------------------------------

describe("guess the imposter TV renderer", () => {
  test("every phase draws at 1280x720 and 1920x1080", () => {
    const instance = startGame(5);
    const ctx = makeContext();
    const seen = new Set<string>();
    let reveal: ScreenPayload | null = null;
    let tieReveal: ScreenPayload | null = null;
    let clueTurn: ScreenPayload | null = null;

    const drawBoth = (screen: ScreenPayload): void => {
      renderGuessimposter(ctx, 1280, 720, screen as unknown as ImposterScreenState);
      renderGuessimposter(ctx, 1920, 1080, screen as unknown as ImposterScreenState);
    };

    walk(instance, (screen) => {
      seen.add(screen.phase);
      drawBoth(screen);

      // The vote reveal animates through the tally beat, the ballot-by-ballot
      // beat and the ejected banner; draw each timing state.
      if (screen.phase === "voteReveal") {
        for (const remaining of [4500, 3000, 1500, 0]) {
          drawBoth({ ...screen, timerMs: remaining });
        }
        if (!tieReveal) tieReveal = screen;
      }
      // The final guess and discussion rings are drawn at both ends too.
      if (screen.phase === "finalGuess" || screen.phase === "discussion") {
        drawBoth({ ...screen, timerMs: 0, timerTotalMs: screen.timerTotalMs ?? 1000 });
      }
      if (screen.phase === "clue" && !clueTurn) clueTurn = screen;
      if (screen.phase === "reveal" && !reveal) reveal = screen;
    });

    assert.deepEqual([...seen].sort(), [...ALL_PHASES].sort());

    // Branch coverage that a single random word does not guarantee: a tie with
    // nobody out, a reveal with no final guess and no Larper, and a clue turn
    // with the host's turn timer switched off.
    const tie = tieReveal as ScreenPayload | null;
    if (!tie) assert.fail("no vote reveal to adapt");
    drawBoth({
      ...tie,
      timerMs: 0,
      voteReveal: tie.voteReveal
        ? {
            ...tie.voteReveal,
            ejected: null,
            nobodyOut: true,
            secondTie: true,
            ballots: tie.voteReveal.ballots.map((ballot) => ({
              ...ballot,
              target: null,
              skipped: true,
            })),
          }
        : null,
    });

    const end = reveal as ScreenPayload | null;
    if (!end?.finalReveal) assert.fail("no reveal to adapt");
    drawBoth({
      ...end,
      finalReveal: { ...end.finalReveal, guesses: [], larper: null },
    });

    const turn = clueTurn as ScreenPayload | null;
    if (!turn) assert.fail("no clue turn to adapt");
    drawBoth({ ...turn, timerMs: null, timerTotalMs: null, timerOff: true });
  });

  test("eight players with a Larper draw every phase", () => {
    const instance = startGame(8, { includeLarper: true });
    const ctx = makeContext();
    const seen = new Set<string>();
    const found: { larper: { name: string; word: string } | null } = { larper: null };

    walk(instance, (screen) => {
      seen.add(screen.phase);
      renderGuessimposter(ctx, 1280, 720, screen as unknown as ImposterScreenState);
      renderGuessimposter(ctx, 1920, 1080, screen as unknown as ImposterScreenState);

      if (screen.phase === "voteReveal") {
        for (const remaining of [4500, 1500]) {
          renderGuessimposter(ctx, 1920, 1080, { ...screen, timerMs: remaining } as unknown as ImposterScreenState);
        }
      }
      if (screen.phase === "reveal" && !found.larper) {
        assert.ok(screen.finalReveal, "reveal payload present");
        assert.equal(screen.finalReveal.imposters.length, 1);
        assert.ok(screen.finalReveal.larper, "eight players with the Larper setting on must have one");
        found.larper = {
          name: screen.finalReveal.larper.name,
          word: screen.finalReveal.larper.word,
        };
        return true;
      }
      return false;
    });

    assert.ok(seen.has("clue"), "an eight-player game reaches the clue phase");
    if (!found.larper) assert.fail("the reveal names the Larper");
    assert.equal(found.larper.word, instance.state.roles.entry.lookalike);
  });
});

// --- Secrecy ---------------------------------------------------------------

describe("guess the imposter TV secrecy", () => {
  test("no phase before the reveal names the word, lookalike or roles", () => {
    // Larper on and announcements on, so the countdown carries its public line.
    const instance = startGame(6, { includeLarper: true, announceLarper: true });
    const ctx = makeContext();

    walk(instance, (screen) => {
      const revealed = screen.phase === "reveal" || screen.phase === "finished";
      const payload = JSON.stringify(screen);
      const word = instance.state.roles.entry.word;
      const lookalike = instance.state.roles.entry.lookalike;

      if (!revealed) {
        assert.ok(!payload.includes(word), `${screen.phase}: word leaked to the TV`);
        assert.ok(!payload.includes(lookalike), `${screen.phase}: lookalike leaked to the TV`);
        assert.ok(!payload.includes('"imposters"'), `${screen.phase}: imposter list leaked`);
        assert.ok(!payload.includes('"larper"'), `${screen.phase}: larper field leaked`);
        assert.ok(!payload.includes('"role"'), `${screen.phase}: role field leaked`);
        assert.equal(screen.finalReveal, null, `${screen.phase}: finalReveal must stay null`);

        // An ejected Imposter is announced as out, never as an Imposter.
        if (screen.voteReveal?.ejected) {
          assert.ok(
            screen.voteReveal.ejected.side === null || screen.voteReveal.ejected.side === "crew",
            `${screen.phase}: an Imposter's side must stay hidden`,
          );
        }
      }

      // The caption bank never interpolates game text.
      assert.ok(!payload.includes(`"caption":"${word}`), `${screen.phase}: word in caption`);

      // Rendered so a leaking payload shape would also crash the renderer.
      renderGuessimposter(ctx, 1280, 720, screen as unknown as ImposterScreenState);
    });
  });

  test("a non-guesser phone never receives the final-guess options", () => {
    const instance = startGame(5);
    let checked = 0;

    walk(instance, (screen) => {
      if (screen.phase !== "finalGuess" || !screen.finalGuess) return false;
      for (let seat = 0; seat < instance.players.length; seat += 1) {
        const controller = controllerOf(instance, seat);
        if (seat === screen.finalGuess.seat) {
          const options = controller.options as Array<{ id: string }>;
          assert.equal(options.length, 6, "the guesser gets six choices");
        } else {
          const options = controller.options as Array<{ id: string }>;
          assert.equal(options.length, 0, "other phones get no guess options");
          assert.ok(!JSON.stringify(controller).includes(instance.state.roles.entry.word));
        }
      }
      checked += 1;
      return true;
    });

    assert.equal(checked, 1);
  });
});

// --- Generic hooks ---------------------------------------------------------

describe("guess the imposter screen hooks", () => {
  test("waitingOn, announce, sound and caption follow the beat", () => {
    const instance = startGame(5);
    const first = new Map<string, ScreenPayload>();

    walk(instance, (screen) => {
      if (!first.has(screen.phase)) first.set(screen.phase, screen);
      return false;
    });

    assert.deepEqual(first.get("countdown")?.sound, "whoosh");
    assert.deepEqual(first.get("peek")?.sound, null);
    assert.deepEqual(first.get("voteReveal")?.sound, "vote");
    assert.deepEqual(first.get("reveal")?.sound, "reveal");
    assert.deepEqual(first.get("finished")?.sound, "win");

    const clue = first.get("clue");
    assert.ok(clue);
    assert.deepEqual(clue.waitingOn, [clue.activePlayer?.name]);
    assert.equal(clue.announce, `${clue.activePlayer?.name}, you're up`);

    const discussion = first.get("discussion");
    assert.deepEqual(discussion?.waitingOn, []);

    const reveal = first.get("reveal");
    assert.ok(reveal);
    assert.ok(reveal.caption && reveal.caption.length > 0, "the reveal has a caption");
    assert.ok(!reveal.caption.includes(instance.state.roles.entry.word));

    // Only an ejected Imposter's final guess is shown on the TV, at the reveal.
    assert.ok(reveal.finalReveal);
    assert.equal(reveal.finalReveal.guesses.length, 1);
    assert.equal(reveal.finalReveal.guesses[0].options.length, 6);
    assert.ok(reveal.finalReveal.guesses[0].options.includes(reveal.finalReveal.word));
  });

  test("the vote phase publishes a cast count and never a tally", () => {
    const instance = startGame(5);
    let sawPartial = false;

    walk(instance, (screen) => {
      if (screen.phase !== "vote" || !screen.vote) return false;
      assert.equal(screen.vote.total, 5);
      assert.ok(screen.vote.cast >= 0 && screen.vote.cast <= 5);
      const payload = JSON.stringify(screen);
      assert.ok(!payload.includes('"votes":1'), "a per-candidate tally must not be published");
      if (screen.vote.cast > 0 && screen.vote.cast < screen.vote.total) sawPartial = true;
      return false;
    });

    assert.ok(sawPartial, "the TV sees votes arrive one at a time");
  });
});

// --- Phone layouts ---------------------------------------------------------

describe("guess the imposter phone layouts", () => {
  test("hold-to-peek, DONE, vote grid, final guess and the ejected banner", () => {
    const instance = startGame(5);
    const checks = {
      peek: 0,
      clue: 0,
      vote: 0,
      finalGuess: 0,
      ejected: 0,
      reveal: 0,
    };

    walk(instance, (screen) => {
      if (screen.phase === "peek") {
        for (let seat = 0; seat < instance.players.length; seat += 1) {
          const controller = controllerOf(instance, seat);
          assert.equal(controller.controllerType, "role");
          const role = controller.role as { holdLabel: string; title: string };
          assert.equal(role.holdLabel, "HOLD TO PEEK");
        }
        checks.peek += 1;
      }

      if (screen.phase === "clue" && screen.activePlayer) {
        const controller = controllerOf(instance, screen.activePlayer.seat);
        assert.equal(controller.controllerType, "one-button");
        assert.equal((controller.labels as { button: string }).button, "DONE");
        assert.equal(controller.isYourTurn, true);
        const other = controllerOf(instance, (screen.activePlayer.seat + 1) % instance.players.length);
        assert.equal(other.controllerType, "choice");
        assert.equal(other.isYourTurn, false);
        checks.clue += 1;
      }

      if (screen.phase === "vote") {
        for (let seat = 0; seat < instance.players.length; seat += 1) {
          const controller = controllerOf(instance, seat);
          if (controller.controllerType !== "choice" || !Array.isArray(controller.options)) continue;
          const ids = (controller.options as Array<{ id: string }>).map((option) => option.id);
          assert.ok(!ids.includes(`p:${seat}`), "a phone is never offered its own seat");
          if (controller.hasVoted === false) {
            assert.equal(controller.canChangeVote, true);
            checks.vote += 1;
          }
        }
      }

      if (screen.phase === "finalGuess" && screen.finalGuess) {
        const controller = controllerOf(instance, screen.finalGuess.seat);
        assert.equal(controller.controllerType, "choice");
        const ids = (controller.options as Array<{ id: string }>).map((option) => option.id);
        assert.deepEqual(ids, ["o:0", "o:1", "o:2", "o:3", "o:4", "o:5"]);
        checks.finalGuess += 1;
      }

      if (screen.phase === "reveal") {
        // Whoever was ejected last is now a spectator with reactions available.
        const ejected = screen.finalReveal?.guesses[0]?.seat;
        if (ejected !== undefined) {
          const controller = controllerOf(instance, ejected);
          assert.equal(controller.spectator, true);
          assert.equal(controller.info, "You're out. Watch and react.");
          checks.ejected += 1;
        }
        checks.reveal += 1;
      }

      return false;
    });

    assert.ok(checks.peek > 0, "peek phase seen");
    assert.ok(checks.clue > 0, "clue turns seen");
    assert.ok(checks.vote > 0, "vote ballots seen");
    assert.ok(checks.finalGuess > 0, "final guess seen");
    assert.ok(checks.ejected > 0, "ejected spectator seen");
    assert.ok(checks.reveal > 0, "reveal seen");
  });

  test("typed mode gives the active phone a 20-character one-word field", () => {
    const instance = startGame(5, { clueMode: "typed" });
    let checked = 0;

    walk(instance, (screen) => {
      if (screen.phase !== "clue" || !screen.activePlayer) return false;
      const controller = controllerOf(instance, screen.activePlayer.seat);
      assert.equal(controller.controllerType, "text");
      assert.equal(controller.maxLength, 20);
      assert.equal(controller.placeholder, "One word");
      assert.equal(controller.isYourTurn, true);
      checked += 1;
      return false;
    });

    assert.ok(checked > 0);
  });
});

// --- Host settings ---------------------------------------------------------

function fakeStorage(): { storage: SettingsStorage; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
  };
}

describe("guess the imposter host settings", () => {
  test("defaults match the brief's settings table", () => {
    assert.deepEqual(defaultImposterSettings(), {
      rounds: 3,
      clueMode: "spoken",
      clueRounds: 2,
      turnTimerSec: 20,
      discussionSec: 90,
      imposterNotFirst: true,
      imposterNotLast: false,
      rerandomiseOrder: true,
      includeLarper: false,
      announceLarper: false,
      imposterSeesCategory: true,
      imposters: 1,
      allowSkipVotes: false,
      spokenAnnouncements: true,
    });
  });

  test("choices persist across a save and reload", () => {
    const { storage, data } = fakeStorage();
    const saved = {
      ...defaultImposterSettings(),
      rounds: 5,
      clueMode: "typed" as const,
      clueRounds: 3,
      turnTimerSec: 0,
      discussionSec: 180,
      imposterNotLast: true,
      includeLarper: true,
      announceLarper: true,
      imposters: 2 as const,
      allowSkipVotes: true,
      spokenAnnouncements: false,
    };
    writeImposterSettings(storage, saved);

    assert.ok(data.get("tbrn_imposter_settings"), "one JSON blob is stored");
    assert.deepEqual(readImposterSettings(storage), saved);
  });

  test("corrupt or out-of-range storage falls back to legal values", () => {
    const { storage, data } = fakeStorage();
    data.set("tbrn_imposter_settings", "{not json");
    assert.deepEqual(readImposterSettings(storage), defaultImposterSettings());

    data.set(
      "tbrn_imposter_settings",
      JSON.stringify({
        rounds: 99,
        clueMode: "telepathy",
        clueRounds: -4,
        turnTimerSec: 7,
        discussionSec: 5,
        imposters: 9,
        includeLarper: "yes",
      }),
    );
    const repaired = readImposterSettings(storage);
    assert.equal(repaired.rounds, 5);
    assert.equal(repaired.clueMode, "spoken");
    assert.equal(repaired.clueRounds, 1);
    assert.equal(repaired.turnTimerSec, 20);
    assert.equal(repaired.discussionSec, 30);
    assert.equal(repaired.imposters, 1);
    assert.equal(repaired.includeLarper, false);
  });

  test("a missing store still returns the defaults", () => {
    assert.deepEqual(readImposterSettings(null), defaultImposterSettings());
    writeImposterSettings(null, defaultImposterSettings());
  });

  test("the start options map onto the server's settings", () => {
    const settings = {
      ...defaultImposterSettings(),
      rounds: 4,
      clueMode: "typed" as const,
      clueRounds: 3,
      turnTimerSec: 10,
      discussionSec: 60,
      imposterNotLast: true,
      includeLarper: true,
      announceLarper: true,
      imposters: 2 as const,
      allowSkipVotes: true,
      spokenAnnouncements: false,
    };
    const options = imposterStartOptions(settings, {});
    assert.equal(options.mode, "standalone");
    assert.equal(options.rounds, 4);

    const parsed = settingsFromOptions(options, 8);
    assert.equal(parsed.mode, "standalone");
    assert.equal(parsed.rounds, 4);
    assert.equal(parsed.clueMode, "typed");
    assert.equal(parsed.clueRounds, 3);
    assert.equal(parsed.turnTimerMs, 10000);
    assert.equal(parsed.discussionMs, 60000);
    assert.equal(parsed.imposterNotFirst, true);
    assert.equal(parsed.imposterNotLast, true);
    assert.equal(parsed.includeLarper, true);
    assert.equal(parsed.announceLarper, true);
    assert.equal(parsed.imposters, 2);
    assert.equal(parsed.allowSkipVotes, true);
    assert.equal(parsed.spokenAnnouncements, false);

    // Turning the timer off is a real value, not a missing one.
    const off = settingsFromOptions(imposterStartOptions({ ...settings, turnTimerSec: 0 }, {}), 5);
    assert.equal(off.turnTimerMs, 0);

    // A Rumble keeps its own word count and mode.
    const rumble = imposterStartOptions(settings, { rumble: true });
    assert.equal(rumble.mode, "rumble");
    assert.equal(rumble.rounds, undefined);
    assert.equal(settingsFromOptions(rumble, 8).rounds, 2);
  });

  test("a too-small table does not erase a saved role choice", () => {
    const saved = { ...defaultImposterSettings(), includeLarper: true, imposters: 2 as const };
    const panelAtFour = { ...defaultImposterSettings(), includeLarper: false, imposters: 1 as const };

    // Gone at four, kept for when the table grows.
    const kept = keepUnavailableChoices(saved, panelAtFour, 4);
    assert.equal(kept.includeLarper, true);
    assert.equal(kept.imposters, 2);

    // The panel wins once the table is big enough to use the control.
    const six = keepUnavailableChoices(saved, { ...panelAtFour, includeLarper: true }, 6);
    assert.equal(six.includeLarper, true);
    assert.equal(six.imposters, 2, "two Imposters still need seven players");

    const eight = keepUnavailableChoices(saved, { ...panelAtFour, imposters: 1 }, 8);
    assert.equal(eight.imposters, 1, "the panel's choice wins at eight players");
  });

  test("role choices unlock at five and seven players", () => {
    assert.equal(LARPER_MIN_PLAYERS, 5);
    assert.equal(TWO_IMPOSTERS_MIN_PLAYERS, 7);
    assert.deepEqual(imposterAvailability(4), { larper: false, twoImposters: false });
    assert.deepEqual(imposterAvailability(5), { larper: true, twoImposters: false });
    assert.deepEqual(imposterAvailability(7), { larper: true, twoImposters: true });

    // The server clamps the same rules regardless of what the lobby sends.
    const settings = { ...defaultImposterSettings(), includeLarper: true, imposters: 2 as const };
    const atFour = settingsFromOptions(imposterStartOptions(settings, {}), 4);
    assert.equal(atFour.includeLarper, false);
    assert.equal(atFour.imposters, 1);
    const atSix = settingsFromOptions(imposterStartOptions(settings, {}), 6);
    assert.equal(atSix.imposters, 1);
  });
});

// --- Sanity on imported constants -----------------------------------------

test("the renderer's timing assumptions match the server", () => {
  assert.equal(COUNTDOWN_MS, 3000);
  assert.equal(PEEK_MS, 5000);
  assert.equal(VOTE_REVEAL_MS, 6000);
  assert.equal(FINAL_GUESS_MS, 15000);
  assert.ok(DISCONNECT_GRACE_MS >= 0);
});

test("normalise keeps a valid stored value unchanged", () => {
  const settings = { ...defaultImposterSettings(), rounds: 2, clueRounds: 1 };
  assert.deepEqual(normaliseImposterSettings(settings), settings);
});
