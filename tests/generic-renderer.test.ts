/**
 * Generic TV fallback renderer.
 *
 * Games without a custom `screen.ts` are drawn from their screen state. These
 * tests pin the two payload-driven pieces: a large slide caption with a
 * presenter line and slides-left counter, and the stroke canvas fallback.
 * Both are checked at the two target resolutions with eight players.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import {
  drawGenericSlide,
  drawGenericStrokes,
  genericSlideLayout,
  genericStrokeLayout,
  normaliseStrokes,
  projectStrokePoint,
  wrapTextLines,
} from "../client/screen/kit/generic.ts";

const LONG_SLIDE =
  "My holiday photo from the worst possible angle, with three people blinking and a seagull stealing the sandwich";

const EIGHT_PLAYERS = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index}`,
  name: `Player ${index + 1}`,
  score: index * 100,
}));

const SLIDE_STATE = {
  slide: LONG_SLIDE,
  presenterName: "Alexandria Longname",
  slidesLeft: 3,
  players: EIGHT_PLAYERS,
  scores: EIGHT_PLAYERS.map((player) => ({ name: player.name, score: player.score })),
};

/** Minimal recording context: every unknown canvas method is a no-op. */
function makeContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    measureText: (text: unknown) => ({ width: String(text).length * 8 }),
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

describe("generic renderer: slide caption", () => {
  for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
    test(`${width}x${height}: long slide + eight players stays on screen`, () => {
      const layout = genericSlideLayout(width, height, 100, SLIDE_STATE);
      assert.ok(layout, "a slide string produces a layout");

      const { slide } = layout;
      assert.ok(slide.x >= 0 && slide.y >= 0, "slide starts on screen");
      assert.ok(slide.x + slide.width <= width, "slide stays inside the width");
      assert.ok(slide.y + slide.height <= height, "slide stays inside the height");
      assert.ok(slide.size >= 40, "the caption is large type");
      assert.ok(slide.lineHeight > slide.size, "lines have breathing room");

      assert.ok(layout.presenter, "the presenter line exists");
      assert.strictEqual(layout.presenter?.text, "Alexandria Longname");
      assert.ok(layout.presenter!.y < slide.y, "the presenter sits above the caption");

      assert.ok(layout.counter, "the slides-left counter exists");
      assert.strictEqual(layout.counter?.text, "3 slides left");
      assert.ok(layout.counter!.x <= width, "the counter stays on screen");

      // Leave room for the eight-player score table below the slide.
      assert.ok(layout.nextY <= height - 8 * 30, "eight score rows still fit");

      const ctx = makeContext();
      assert.doesNotThrow(() => drawGenericSlide(ctx, layout, LONG_SLIDE));
    });
  }

  test("slide is null or empty keeps the existing prompt path", () => {
    assert.strictEqual(genericSlideLayout(1280, 720, 100, { prompt: "Write an answer" }), null);
    assert.strictEqual(genericSlideLayout(1280, 720, 100, { slide: "   " }), null);
    assert.strictEqual(genericSlideLayout(1280, 720, 100, null), null);
  });

  test("singular counter and a missing presenter name", () => {
    const layout = genericSlideLayout(1920, 1080, 100, { slide: "One more", slidesLeft: 1 });
    assert.ok(layout);
    assert.strictEqual(layout.counter?.text, "1 slide left");
    assert.strictEqual(layout.presenter, null);
  });

  test("wrapTextLines breaks a long caption without losing words", () => {
    const ctx = makeContext();
    const lines = wrapTextLines(ctx, LONG_SLIDE, 400);
    assert.ok(lines.length > 1, "the caption wraps");
    assert.strictEqual(lines.join(" "), LONG_SLIDE, "no words are dropped");
  });
});

describe("generic renderer: stroke canvas", () => {
  test("normaliseStrokes accepts object strokes and point arrays", () => {
    const strokes = normaliseStrokes([
      { points: [[0, 0], [0.5, 0.5], [1, 1]], color: "#111111" },
      [[0.25, 0.75]],
      [[-1, 2]],
      null,
      "not a stroke",
    ]);
    assert.strictEqual(strokes.length, 3);
    assert.deepStrictEqual(strokes[0], { points: [[0, 0], [0.5, 0.5], [1, 1]], color: "#111111" });
    assert.deepStrictEqual(strokes[1].points, [[0.25, 0.75]]);
    assert.deepStrictEqual(strokes[2].points, [[0, 1]], "points are clamped to 0..1");
    assert.deepStrictEqual(normaliseStrokes(undefined), []);
    assert.deepStrictEqual(normaliseStrokes([]), []);
  });

  for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
    test(`${width}x${height}: stroke rect and scaling stay on screen`, () => {
      const rect = genericStrokeLayout(width, height, 100);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= width, "stroke canvas fits the width");
      assert.ok(rect.y + rect.height <= height, "stroke canvas fits the height");

      assert.deepStrictEqual(projectStrokePoint(rect, [0, 0]), [rect.x, rect.y]);
      assert.deepStrictEqual(projectStrokePoint(rect, [1, 1]), [rect.x + rect.width, rect.y + rect.height]);

      const strokes = normaliseStrokes([
        { points: [[0.1, 0.1], [0.9, 0.9]], color: "#111111" },
        [[0.5, 0.5]],
      ]);
      const ctx = makeContext();
      assert.doesNotThrow(() => drawGenericStrokes(ctx, rect, strokes));
    });
  }
});
