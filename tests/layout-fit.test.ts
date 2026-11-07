/**
 * Layout fit — PLATFORM_EXPANSION_BRIEF section 7, item 8:
 *   "TV renders correctly with 8 players and long names at 1080p and 720p.
 *    Phone UIs fit a 360dp-wide screen at 1.5x text."
 *
 * Two halves, both static (Node has no DOM and no CSS engine, and the task
 * forbids new dependencies):
 *
 * A. TV renderers (fake canvas)
 *    - Every enabled catalog game is rendered through a fail-closed matrix:
 *      `custom` = its `games/<id>/screen.ts` render function, `generic` = a
 *      mirror of `client/screen/main.ts#renderGeneric` built from the exported
 *      kit helpers. A newly enabled game fails until it is classified.
 *    - State is built at the game's max player count (8 where `maxPlayers`
 *      allows) with 12-character names, twice: the real initial screen and a
 *      `long-text` variant whose string fields (prompt/info/lastEvent/...) are
 *      replaced with a ~176-character stress line.
 *    - Every draw call is recorded with the current transform matrix applied:
 *      fillText/strokeText positions and extents, fillRect/strokeRect/clearRect,
 *      filled path bboxes, stroked path bboxes and gradient coordinates must be
 *      finite; text and filled shapes must sit inside the canvas; stroked paths
 *      get a documented 2x bound (the synthwave background's perspective grid
 *      intentionally runs to ~1.65x width and is clipped by the canvas).
 *    - Host-board helpers are driven directly: `drawVoteOptions` at 7/8/9
 *      options, the watch ticker with 8 rows of 12-char names, the interlude
 *      card, and the exported geometry helpers (bracket cards, racing lanes,
 *      poker seat panels). Archery's lane chips are not exported, so they are
 *      asserted from the recorded geometry (a row of equal-height chips).
 *
 * B. Phone 360dp at 1.5x text (static source audit)
 *    - The `<style>` block of `client/controller/index.html` is parsed and
 *      audited: no `width`/`min-width` evaluates above 360px at a 360px
 *      viewport; every interactive class a controller layout emits has a
 *      tap-target size >= 44px (the kit's 48dp floor minus rounding) or an
 *      explicit known-gap entry with a written reason and measurement.
 *    - Answer/name containers must show overflow protection
 *      (overflow-wrap / word-break / ellipsis), a documented intrinsic wrap, a
 *      documented content bound, or an explicit known-gap entry.
 *    - `shared/controllers.ts` + `client/controller/main.ts` inline styles and
 *      HTML width attributes are scanned for fixed pixel widths > 360px.
 *    - Every controller type in `controllerLayouts` is walked: its emitted
 *      classes must be covered by a tap-target row (or a documented modifier),
 *      and `getLayout(type).signature({})` must stay callable.
 *    - Phase-6 reachable findings are fixed and asserted (not just recorded):
 *      the rank controls used by Frankenanswers have 48px slots/items with
 *      wrapping names, the Drawful/Slogan Shirts swatches and size chips are
 *      48px, single-column choice buttons declare `overflow-wrap: anywhere`,
 *      and the Leave button is 48px. These are `size`/`prop` rows checked
 *      against the 44px floor. The remaining `gap` rows are layouts that no
 *      enabled catalog game reaches (chat, numpad, board) and stay recorded.
 *
 * Documented margins
 *   TEXT_MARGIN  = 8px   - shadow blur around glyphs + fractional baselines and
 *                          the vote grid's centred 3-line block (<= ~2px past
 *                          the cell by design).
 *   SHAPE_MARGIN = 12px  - half the thickest stroke seen (8px) + shake (+/-6px)
 *                          + sub-pixel path edges; shadows are visual-only.
 *   Stroked paths: 2x the canvas (clipped background geometry, see above).
 *   Text is additionally asserted to be no wider than the canvas itself.
 *
 * NOT VERIFIED (no browser/CSS engine available — do not read these as green)
 *   1. Real computed layout at 360dp/1.5x: flex/grid shrink behaviour,
 *      percentage rounding, and actual touch hit-rectangles are NOT VERIFIED;
 *      part B audits source declarations only.
 *   2. Real font metrics: `measureText` is a stub (0.62em per character), so
 *      real glyph widths at 1.5x phone text and 3-metre TV type are NOT
 *      VERIFIED.
 *   3. `client/screen/main.ts` is DOM-bound and never executed here; the
 *      generic path and the watch layer are exercised through the exported kit
 *      helpers plus fail-closed source pins on main.ts (drift fails the suite).
 *      The watch layer's wiring (finished-skip, seat lookup) is NOT VERIFIED.
 *   4. Unbroken, space-free tokens longer than a box: the canvas wrap helpers
 *      break on spaces only. Catalog content contains no such token, so a
 *      pathological single-word answer is NOT VERIFIED on the TV.
 *   5. Visual result (contrast, 3-metre legibility, aesthetics), device-pixel-
 *      ratio backing stores and letterboxing on odd aspect ratios: NOT VERIFIED.
 *   6. `private-grid`, `numpad`, `left-right` and `pad` are unreachable from
 *      every catalog game today; their rows are source-derived only. The
 *      grid-cell derivation holds at the 5x5 default (60px) and stays >= 44px
 *      only up to 6 columns — a hypothetical 20x20 board would be ~13px.
 *   7. Scrolling of long `.choices` ballots (max-height: 62vh) without a
 *      browser: NOT VERIFIED.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_CATALOG, type GameCatalogEntry } from "../shared/game-catalog.ts";
import { drawVoteOptions, type VoteOption } from "../client/screen/kit/vote.ts";
import {
  createWatchOverlay,
  drawWatchOverlay,
  tickerRowsFromScreen,
  updateWatchOverlay,
  waitingNamesFromScreen,
  type WatchOverlayState,
  type WatchTickerRow,
} from "../client/screen/kit/ticker.ts";
import {
  drawGenericSlide,
  drawGenericStrokes,
  genericSlideLayout,
  genericStrokeLayout,
  normaliseStrokes,
} from "../client/screen/kit/generic.ts";
import { interludeCard, oneLineRule, INTERLUDE_DURATION_MS } from "../shared/interlude.ts";
import { voteLayout } from "../shared/vote-options.ts";
import { scaleForViewport, scaledSize } from "../client/screen/kit/theme.ts";
import { clearParticles } from "../client/screen/kit/particles.ts";
import { seatForIndex } from "../shared/seat-identity.ts";
import { bracketCardLayout } from "../games/bracket/screen.ts";
import { racingLaneLayout } from "../games/racing/screen.ts";
import { pokerSeatLayout } from "../games/poker/screen.ts";
import { controllerLayouts, getLayout, type ControllerType } from "../shared/controllers.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = join(repoRoot, "games");

const RESOLUTIONS: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080],
  [1280, 720],
];

const TEXT_MARGIN = 8;
const SHAPE_MARGIN = 12;
/** Stroked paths may run under the canvas edge; background grid reaches ~1.65x. */
const STROKE_BOUND_FACTOR = 2;

/** 12-character player names (the join cap from docs/DECISIONS.md). */
function longName(index: number): string {
  return `Longname${String(index + 1).padStart(4, "0")}`;
}

const LONG_TEXT =
  "A delightfully long stress string used to push TV text layout to its limits, " +
  "with plenty of ordinary words that must wrap inside their boxes rather than " +
  "run past the edge of the canvas at either target resolution.";

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
}

interface GameInstance {
  players: Player[];
  state: Record<string, unknown>;
}

interface GamePlugin {
  manifest: { id: string; minPlayers: number; maxPlayers: number };
  onStart(room: unknown, players: Player[]): GameInstance;
  screenState(instance: GameInstance): unknown;
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: longName(i),
    joinedAt: 0,
    rejoinToken: `t${i}`,
    connected: true,
  }));
}

function makeRoom(players: Player[], gameId: string): Record<string, unknown> {
  return {
    id: "room1",
    code: "TEST1",
    hostPlayerId: players[0]?.id ?? null,
    players,
    gameId,
    gameState: null,
    createdAt: 0,
    status: "playing",
  };
}

async function loadPlugin(gameId: string): Promise<GamePlugin> {
  const mod = (await import(join(gamesDir, gameId, "server.ts"))) as { default: GamePlugin };
  return mod.default;
}

type Renderer = (ctx: CanvasRenderingContext2D, width: number, height: number, state: unknown) => void;

async function loadRenderer(gameId: string): Promise<Renderer> {
  const mod = (await import(join(gamesDir, gameId, "screen.ts"))) as Record<string, unknown>;
  const names = Object.keys(mod).filter((name) => name.startsWith("render") && typeof mod[name] === "function");
  assert.strictEqual(names.length, 1, `${gameId}: expected exactly one render* export, found ${names.join(", ")}`);
  return mod[names[0]] as Renderer;
}

// --- Recording canvas with transform tracking -------------------------------

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type RecordCategory = "text" | "fill" | "stroke" | "gradient";

interface RecordedOp {
  category: RecordCategory;
  method: string;
  /** Canvas-space bounding box (transform applied at record time). */
  box?: BBox;
  /** Raw numbers for gradient coordinates. */
  nums?: number[];
  text?: string;
  measured?: number;
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
}

/** Stub width per character: slightly wider than most sans faces (0.62em). */
const CHAR_EM = 0.62;

function fontSizeOf(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 10;
}

function codePointLength(text: string): number {
  return [...text].length;
}

/** Recording context: every unknown canvas method is a no-op. */
function makeRecorder(width: number, height: number): Recorder {
  const ops: RecordedOp[] = [];
  let matrix: Matrix = [...IDENTITY] as Matrix;
  const stack: Array<{ m: Matrix; align: string; baseline: string; font: string }> = [];
  /** Path points (already transformed) since the last beginPath. */
  let pathPoints: Array<{ x: number; y: number }> = [];

  const target: Record<string, unknown> = {
    canvas: { width, height },
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineWidth: 1,
    globalAlpha: 1,
    measureText: (text: unknown) => {
      const size = fontSizeOf(String(target.font));
      return { width: codePointLength(String(text)) * size * CHAR_EM };
    },
    createLinearGradient: (...args: number[]) => {
      ops.push({ category: "gradient", method: "createLinearGradient", nums: args });
      return { addColorStop: () => undefined };
    },
    createRadialGradient: (...args: number[]) => {
      ops.push({ category: "gradient", method: "createRadialGradient", nums: args });
      return { addColorStop: () => undefined };
    },
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
  };

  const boxFromPoints = (points: Array<{ x: number; y: number }>): BBox => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  };

  const transformBox = (local: BBox): BBox => {
    const corners = [
      applyMatrix(matrix, local.x0, local.y0),
      applyMatrix(matrix, local.x1, local.y0),
      applyMatrix(matrix, local.x0, local.y1),
      applyMatrix(matrix, local.x1, local.y1),
    ];
    return boxFromPoints(corners);
  };

  const addPathPoints = (points: Array<{ x: number; y: number }>): void => {
    for (const p of points) pathPoints.push(applyMatrix(matrix, p.x, p.y));
  };

  const recordText = (method: string, args: unknown[]): void => {
    const text = String(args[0]);
    const x = Number(args[1]);
    const y = Number(args[2]);
    const font = String(target.font);
    const size = fontSizeOf(font);
    const width = codePointLength(text) * size * CHAR_EM;
    const align = String(target.textAlign ?? "start");
    const baseline = String(target.textBaseline ?? "alphabetic");

    let lx0: number;
    let lx1: number;
    if (align === "right" || align === "end") {
      lx0 = x - width;
      lx1 = x;
    } else if (align === "center") {
      lx0 = x - width / 2;
      lx1 = x + width / 2;
    } else {
      lx0 = x;
      lx1 = x + width;
    }

    let ly0: number;
    let ly1: number;
    if (baseline === "top" || baseline === "hanging") {
      ly0 = y;
      ly1 = y + size;
    } else if (baseline === "middle") {
      ly0 = y - size / 2;
      ly1 = y + size / 2;
    } else if (baseline === "bottom") {
      ly0 = y - size;
      ly1 = y;
    } else {
      // alphabetic / ideographic
      ly0 = y - size * 0.85;
      ly1 = y + size * 0.15;
    }

    ops.push({
      category: "text",
      method,
      box: transformBox({ x0: lx0, y0: ly0, x1: lx1, y1: ly1 }),
      text,
      measured: width,
    });
  };

  const recordRect = (method: string, args: unknown[]): void => {
    const x = Number(args[0]);
    const y = Number(args[1]);
    const w = Number(args[2]);
    const h = Number(args[3]);
    ops.push({ category: "fill", method, box: transformBox({ x0: x, y0: y, x1: x + w, y1: y + h }) });
  };

  const recordArc = (args: unknown[], ryOverride?: number): void => {
    const cx = Number(args[0]);
    const cy = Number(args[1]);
    const rx = Number(args[2]);
    const ry = ryOverride ?? rx;
    addPathPoints([
      { x: cx - rx, y: cy - ry },
      { x: cx + rx, y: cy - ry },
      { x: cx - rx, y: cy + ry },
      { x: cx + rx, y: cy + ry },
    ]);
  };

  const targetFns: Record<string, (...args: unknown[]) => unknown> = {
    save: () => {
      stack.push({
        m: [...matrix] as Matrix,
        align: String(target.textAlign),
        baseline: String(target.textBaseline),
        font: String(target.font),
      });
    },
    restore: () => {
      const prev = stack.pop();
      if (prev) {
        matrix = prev.m;
        target.textAlign = prev.align;
        target.textBaseline = prev.baseline;
        target.font = prev.font;
      }
    },
    translate: (...args: unknown[]) => {
      matrix = multiply(matrix, [1, 0, 0, 1, Number(args[0]), Number(args[1])]);
    },
    scale: (...args: unknown[]) => {
      matrix = multiply(matrix, [Number(args[0]), 0, 0, Number(args[1]), 0, 0]);
    },
    rotate: (...args: unknown[]) => {
      const a = Number(args[0]);
      matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    },
    setTransform: (...args: unknown[]) => {
      if (args.length >= 6) {
        matrix = [Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]), Number(args[4]), Number(args[5])];
      } else if (args.length === 1 && Array.isArray(args[0])) {
        const m = args[0] as number[];
        matrix = [m[0], m[1], m[2], m[3], m[4], m[5]];
      }
    },
    transform: (...args: unknown[]) => {
      matrix = multiply(matrix, [
        Number(args[0]),
        Number(args[1]),
        Number(args[2]),
        Number(args[3]),
        Number(args[4]),
        Number(args[5]),
      ]);
    },
    resetTransform: () => {
      matrix = [...IDENTITY] as Matrix;
    },
    beginPath: () => {
      pathPoints = [];
    },
    fill: () => {
      if (pathPoints.length > 0) {
        ops.push({ category: "fill", method: "path-fill", box: boxFromPoints(pathPoints) });
      }
    },
    stroke: () => {
      if (pathPoints.length > 0) {
        ops.push({ category: "stroke", method: "path-stroke", box: boxFromPoints(pathPoints) });
      }
    },
    fillText: (...args: unknown[]) => recordText("fillText", args),
    strokeText: (...args: unknown[]) => recordText("strokeText", args),
    fillRect: (...args: unknown[]) => recordRect("fillRect", args),
    strokeRect: (...args: unknown[]) => recordRect("strokeRect", args),
    clearRect: (...args: unknown[]) => recordRect("clearRect", args),
    moveTo: (...args: unknown[]) => addPathPoints([{ x: Number(args[0]), y: Number(args[1]) }]),
    lineTo: (...args: unknown[]) => addPathPoints([{ x: Number(args[0]), y: Number(args[1]) }]),
    quadraticCurveTo: (...args: unknown[]) =>
      addPathPoints([
        { x: Number(args[0]), y: Number(args[1]) },
        { x: Number(args[2]), y: Number(args[3]) },
      ]),
    bezierCurveTo: (...args: unknown[]) =>
      addPathPoints([
        { x: Number(args[0]), y: Number(args[1]) },
        { x: Number(args[2]), y: Number(args[3]) },
        { x: Number(args[4]), y: Number(args[5]) },
      ]),
    rect: (...args: unknown[]) => {
      const x = Number(args[0]);
      const y = Number(args[1]);
      const w = Number(args[2]);
      const h = Number(args[3]);
      addPathPoints([
        { x, y },
        { x: x + w, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
      ]);
    },
    roundRect: (...args: unknown[]) => {
      const x = Number(args[0]);
      const y = Number(args[1]);
      const w = Number(args[2]);
      const h = Number(args[3]);
      addPathPoints([
        { x, y },
        { x: x + w, y },
        { x, y: y + h },
        { x: x + w, y: y + h },
      ]);
    },
    arc: (...args: unknown[]) => recordArc(args),
    ellipse: (...args: unknown[]) => recordArc(args, Number(args[3])),
  };

  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in targetFns) return targetFns[prop];
      if (prop in obj) return obj[prop];
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, ops };
}

// --- Geometry assertions ----------------------------------------------------

function describeOp(op: RecordedOp): string {
  if (op.category === "text") {
    return `${op.method}("${op.text}")`;
  }
  if (op.category === "gradient") {
    return `${op.method}(${(op.nums ?? []).join(", ")})`;
  }
  const b = op.box!;
  return `${op.method}[${b.x0.toFixed(1)},${b.y0.toFixed(1)}..${b.x1.toFixed(1)},${b.y1.toFixed(1)}]`;
}

function assertFiniteOps(rec: Recorder, label: string): void {
  for (const op of rec.ops) {
    if (op.category === "gradient") {
      for (const n of op.nums ?? []) {
        assert.ok(Number.isFinite(n), `${label}: ${describeOp(op)} has a non-finite coordinate`);
      }
      continue;
    }
    const b = op.box!;
    for (const v of [b.x0, b.y0, b.x1, b.y1]) {
      assert.ok(Number.isFinite(v), `${label}: ${describeOp(op)} has a non-finite coordinate`);
    }
  }
}

function assertOpInBounds(rec: Recorder, width: number, height: number, label: string): void {
  for (const op of rec.ops) {
    if (op.category === "gradient") continue;
    const b = op.box!;
    if (op.category === "text") {
      const extent = b.x1 - b.x0;
      assert.ok(
        extent <= width + 0.5,
        `${label}: text wider than canvas — ${describeOp(op)} spans ${extent.toFixed(1)}px of ${width}px`,
      );
      assert.ok(b.x0 >= -TEXT_MARGIN, `${label}: text starts left of canvas — ${describeOp(op)}`);
      assert.ok(b.x1 <= width + TEXT_MARGIN, `${label}: text runs past the right edge — ${describeOp(op)}`);
      assert.ok(b.y0 >= -TEXT_MARGIN, `${label}: text starts above the canvas — ${describeOp(op)}`);
      assert.ok(b.y1 <= height + TEXT_MARGIN, `${label}: text runs past the bottom — ${describeOp(op)}`);
      continue;
    }
    if (op.category === "stroke") {
      // Strokes may be clipped by the canvas edge (background grid), but a
      // geometry bug large enough to leave the 2x bound still fails.
      assert.ok(b.x0 >= -width * STROKE_BOUND_FACTOR, `${label}: stroke far left of canvas — ${describeOp(op)}`);
      assert.ok(b.x1 <= width * STROKE_BOUND_FACTOR, `${label}: stroke far right of canvas — ${describeOp(op)}`);
      assert.ok(b.y0 >= -height * STROKE_BOUND_FACTOR, `${label}: stroke far above canvas — ${describeOp(op)}`);
      assert.ok(b.y1 <= height * STROKE_BOUND_FACTOR, `${label}: stroke far below canvas — ${describeOp(op)}`);
      continue;
    }
    // fill (rects, filled paths)
    assert.ok(b.x0 >= -SHAPE_MARGIN, `${label}: fill starts left of canvas — ${describeOp(op)}`);
    assert.ok(b.x1 <= width + SHAPE_MARGIN, `${label}: fill runs past the right edge — ${describeOp(op)}`);
    assert.ok(b.y0 >= -SHAPE_MARGIN, `${label}: fill starts above canvas — ${describeOp(op)}`);
    assert.ok(b.y1 <= height + SHAPE_MARGIN, `${label}: fill runs past the bottom — ${describeOp(op)}`);
  }
}

function textOps(rec: Recorder): RecordedOp[] {
  return rec.ops.filter((op) => op.category === "text");
}

function fillBoxes(rec: Recorder): Array<RecordedOp & { box: BBox }> {
  return rec.ops.filter((op) => op.category === "fill" && op.box !== undefined) as Array<RecordedOp & { box: BBox }>;
}

function dedupeBoxes(boxes: Array<RecordedOp & { box: BBox }>): Array<RecordedOp & { box: BBox }> {
  const seen = new Set<string>();
  const out: Array<RecordedOp & { box: BBox }> = [];
  for (const op of boxes) {
    const key = `${op.box.x0.toFixed(2)},${op.box.y0.toFixed(2)},${op.box.x1.toFixed(2)},${op.box.y1.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

function overlaps(a: BBox, b: BBox): boolean {
  return a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
}

function inside(container: BBox, inner: BBox, tolerance: number): boolean {
  return (
    inner.x0 >= container.x0 - tolerance &&
    inner.y0 >= container.y0 - tolerance &&
    inner.x1 <= container.x1 + tolerance &&
    inner.y1 <= container.y1 + tolerance
  );
}

let clock = 1000;
function nextClock(): number {
  clock += 9000;
  return clock;
}

function withFakeNow<T>(now: number, fn: () => T): T {
  const originalNow = performance.now;
  Object.defineProperty(performance, "now", { value: () => now, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(performance, "now", { value: originalNow, configurable: true });
  }
}

/** Render once with a monotonic fake clock; record without asserting bounds. */
function recordDraw(
  draw: (ctx: CanvasRenderingContext2D) => void,
  width: number,
  height: number,
): Recorder {
  clearParticles();
  const rec = makeRecorder(width, height);
  const now = nextClock();
  withFakeNow(now, () => draw(rec.ctx));
  return rec;
}

/** Record + anti-vacuity + finiteness + in-canvas bounds. */
function renderAndAssert(
  render: (ctx: CanvasRenderingContext2D) => void,
  width: number,
  height: number,
  label: string,
): Recorder {
  const rec = recordDraw(render, width, height);
  assert.ok(textOps(rec).length > 0, `${label}: renderer drew no text at all`);
  assertFiniteOps(rec, label);
  assertOpInBounds(rec, width, height, label);
  return rec;
}

// --- TV matrix (fail-closed classification) ---------------------------------

type TvMode = "custom" | "generic";

interface MatrixEntry {
  mode: TvMode;
}

/**
 * Explicit classification for every enabled game. `custom` means production
 * loads `games/<id>/screen.ts`; `generic` means `main.ts#renderGeneric` draws
 * the payload. A newly enabled game must be added here before the suite passes.
 */
const TV_MATRIX: Record<string, MatrixEntry> = {
  // custom renderers
  bluff: { mode: "custom" },
  bracket: { mode: "custom" },
  darts: { mode: "custom" },
  guessimposter: { mode: "custom" },
  mindmeld: { mode: "custom" },
  mostlikely: { mode: "custom" },
  percentile: { mode: "custom" },
  poker: { mode: "custom" },
  quiz: { mode: "custom" },
  racing: { mode: "custom" },
  writevote: { mode: "custom" },
  // generic fallback (no games/<id>/screen.ts)
  arena: { mode: "generic" },
  blather: { mode: "generic" },
  drawful: { mode: "generic" },
  dumbinventions: { mode: "generic" },
  fakin: { mode: "generic" },
  frankenanswers: { mode: "generic" },
  slideroulette: { mode: "generic" },
  sloganshirts: { mode: "generic" },
  splitroom: { mode: "generic" },
  stowaway: { mode: "generic" },
  survive: { mode: "generic" },
};

function enabledGameIds(): string[] {
  return Object.values(GAME_CATALOG)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.id)
    .sort();
}

function playerCountFor(entry: GameCatalogEntry): number {
  return Math.min(8, entry.maxPlayers);
}

/**
 * Replace present text fields with the stress line; always add prompt/lastEvent.
 *
 * `category` is deliberately NOT stressed: Bluff and Write & Vote draw
 * `Round X of Y · category` unwrapped in their headers, and a category is a
 * fixed pack tag (observed maxima: bluff facts 57 chars for the prompt, tags
 * far shorter) — stressing it would test a bound the platform never produces.
 */
function longTextVariant(screen: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...screen };
  const fields = [
    "prompt",
    "info",
    "lastEvent",
    "slide",
    "caption",
    "subtitle",
    "topic",
    "question",
    "hint",
    "announce",
    "announcement",
    "description",
    "label",
    "status",
  ];
  for (const field of fields) {
    if (typeof out[field] === "string") out[field] = LONG_TEXT;
  }
  if (typeof out.prompt !== "string") out.prompt = LONG_TEXT;
  if (typeof out.lastEvent !== "string") out.lastEvent = LONG_TEXT;
  return out;
}

describe("A3: TV matrix is fail-closed", () => {
  test("every enabled game is classified and the mode matches the tree", () => {
    const enabled = enabledGameIds();
    assert.ok(enabled.length >= 20, `expected the enabled catalog to be populated, found ${enabled.length}`);

    const missing = enabled.filter((id) => !TV_MATRIX[id]);
    assert.deepStrictEqual(
      missing,
      [],
      `enabled games with no TV-matrix entry: ${missing.join(", ")} — a newly enabled game must be classified as custom or generic`,
    );

    const extra = Object.keys(TV_MATRIX).filter((id) => !enabled.includes(id));
    assert.deepStrictEqual(
      extra,
      [],
      `TV-matrix entries that the catalog no longer enables: ${extra.join(", ")}`,
    );

    for (const id of enabled) {
      const entry = TV_MATRIX[id];
      const hasCustom = existsSync(join(gamesDir, id, "screen.ts"));
      const hasServer = existsSync(join(gamesDir, id, "server.ts"));
      assert.ok(hasServer, `${id}: catalog enables a game with no games/${id}/server.ts`);
      assert.strictEqual(
        entry.mode,
        hasCustom ? "custom" : "generic",
        `${id}: matrix says "${entry.mode}" but games/${id}/screen.ts ${hasCustom ? "exists" : "is missing"} — reclassify`,
      );
      if (entry.mode === "generic") {
        assert.ok(!hasCustom, `${id}: generic entry must not ship a custom screen.ts`);
      }
    }

    const custom = enabled.filter((id) => TV_MATRIX[id].mode === "custom");
    const generic = enabled.filter((id) => TV_MATRIX[id].mode === "generic");
    assert.ok(custom.length >= 10, `expected most content games to have custom renderers, found ${custom.join(", ")}`);
    assert.ok(generic.length >= 8, `expected a real generic-fallback cohort, found ${generic.join(", ")}`);
  });
});

// --- Generic renderer mirror -------------------------------------------------

/** Pin the arithmetic in main.ts that this mirror reproduces (drift = failure). */
describe("A1: generic renderer mirror stays in sync with main.ts", () => {
  test("main.ts still contains the bounded expressions the mirror relies on", () => {
    const src = readFileSync(join(repoRoot, "client", "screen", "main.ts"), "utf8");
    const pins = [
      "const slideLayout = genericSlideLayout(width, height, y, state);",
      "const strokeRect = genericStrokeLayout(width, height, y);",
      "y = drawWrapped(ctx, bigText, 32, y, width - 64, 32) + 16;",
      "height: Math.max(120, height - y - 24),",
      "drawVoteOptions(ctx, rect, voteOptions, {",
      "for (let i = 0; i < players.length && y < height - 120; i++)",
      "const name = ellipsize(ctx, rawName, Math.max(120, width - 360));",
      'ctx.fillText(`${name}  ${bits.join("  ")}`, 56, y);',
    ];
    for (const pin of pins) {
      assert.ok(
        src.includes(pin),
        `client/screen/main.ts generic renderer changed: missing "${pin}" — re-sync tests/layout-fit.test.ts`,
      );
    }
  });
});

/** Mirror of `readVoteOptions` in client/screen/main.ts. */
function readVoteOptions(state: Record<string, unknown>): VoteOption[] {
  if (!Array.isArray(state.options)) return [];
  const options: VoteOption[] = [];
  for (const raw of state.options) {
    if (typeof raw === "string") {
      options.push({ id: raw, label: raw });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label =
      typeof record.label === "string" ? record.label : typeof record.text === "string" ? record.text : "";
    if (!label) continue;
    options.push({
      id: typeof record.id === "string" ? record.id : String(options.length),
      label,
      votes: typeof record.votes === "number" ? record.votes : undefined,
      selected: record.selected === true,
    });
  }
  return options;
}

/** Mirror of `ellipsize` in client/screen/main.ts. */
function ellipsize(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (c.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && c.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

/** Mirror of `drawWrapped` in client/screen/main.ts. */
function drawWrapped(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxWidth && line) {
      c.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    c.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** Mirror of `drawCellGrid` in client/screen/main.ts. */
function drawCellGridMirror(
  c: CanvasRenderingContext2D,
  cells: string[][],
  x: number,
  y: number,
  maxHeight: number,
): number {
  const rows = cells.length;
  const cols = Math.max(...cells.map((r) => r.length), 1);
  const size = Math.max(14, Math.min(44, Math.floor(maxHeight / rows), Math.floor((1200 - x * 2) / cols)));
  c.font = `600 ${Math.floor(size * 0.55)}px Inter, sans-serif`;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const value = String(cells[r]?.[col] ?? "");
      const cx = x + col * size;
      const cy = y + r * size;
      c.fillStyle = value ? "#334155" : "#1E293B";
      c.fillRect(cx, cy, size - 2, size - 2);
      if (value) {
        c.fillStyle = value === "X" ? "#EF4444" : value === "o" ? "#94A3B8" : "#F8FAFC";
        c.fillText(value, cx + 4, cy + 4);
      }
    }
  }
  return y + rows * size;
}

/** Mirror of `renderGeneric` in client/screen/main.ts (DOM-free). */
function renderGenericMirror(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: Record<string, unknown>,
  gameName: string,
): void {
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  let y = 24;

  // Header: game name + phase/round + timer.
  ctx.fillStyle = "#F8FAFC";
  ctx.font = "600 32px Inter, sans-serif";
  ctx.fillText(gameName || "TBRN-Games", 32, y);
  y += 44;
  ctx.font = "400 20px Inter, sans-serif";
  ctx.fillStyle = "#94A3B8";
  const meta: string[] = [];
  if (typeof state.phase === "string") meta.push(String(state.phase));
  if (typeof state.round === "number" && typeof state.totalRounds === "number") {
    meta.push(`Round ${state.round}/${state.totalRounds}`);
  }
  if (typeof state.drawingNumber === "number" && typeof state.totalDrawings === "number") {
    meta.push(`Drawing ${state.drawingNumber}/${state.totalDrawings}`);
    if (typeof state.artistName === "string" && state.artistName.length > 0) {
      meta.push(`Artist: ${state.artistName}`);
    }
  } else if (typeof state.round === "number" && typeof state.maxRounds === "number") {
    meta.push(`Round ${state.round + 1}/${state.maxRounds}`);
  }
  if (typeof state.holeNumber === "number" && typeof state.maxHoles === "number") {
    meta.push(`Hole ${state.holeNumber}/${state.maxHoles}`);
  }
  if (typeof state.level === "number" && typeof state.totalLevels === "number") {
    meta.push(`Level ${state.level}/${state.totalLevels}`);
  }
  if (typeof state.timeLeft === "number" && state.timeLeft > 0) {
    meta.push(`${Math.ceil((state.timeLeft as number) / 1000)}s`);
  }
  if (meta.length) {
    ctx.fillText(meta.join("  ·  "), 32, y);
    y += 32;
  }

  const slideLayout = genericSlideLayout(width, height, y, state);
  if (slideLayout) {
    drawGenericSlide(ctx, slideLayout, String(state.slide));
    y = slideLayout.nextY;
  } else {
    const bigText = [state.prompt, state.info, state.lastEvent].find(
      (t) => typeof t === "string" && t.length > 0,
    ) as string | undefined;
    if (bigText) {
      ctx.fillStyle = "#F8FAFC";
      ctx.font = "600 26px Inter, sans-serif";
      y = drawWrapped(ctx, bigText, 32, y, width - 64, 32) + 16;
    }
  }

  const strokes = normaliseStrokes(state.strokes);
  if (strokes.length > 0) {
    const strokeRect = genericStrokeLayout(width, height, y);
    drawGenericStrokes(ctx, strokeRect, strokes);
    y = strokeRect.y + strokeRect.height + 16;
  }

  const voteOptions = readVoteOptions(state);
  if (voteOptions.length > 0) {
    const rect = {
      x: 32,
      y,
      width: width - 64,
      height: Math.max(120, height - y - 24),
    };
    drawVoteOptions(ctx, rect, voteOptions, {
      scale: scaleForViewport(width, height),
      selectedId: typeof state.selectedId === "string" ? state.selectedId : null,
      showVoteCounts: state.showVoteCounts === true,
      minColumns: state.optionColumns === 2 ? 2 : 1,
    });
    y = rect.y + rect.height;
  }

  if (voteOptions.length === 0 && Array.isArray(state.cells) && Array.isArray(state.cells[0])) {
    y = drawCellGridMirror(ctx, state.cells as string[][], 32, y, height - y - 260) + 16;
  }

  const players = Array.isArray(state.players) ? (state.players as Array<Record<string, unknown>>) : [];
  if (voteOptions.length === 0 && players.length) {
    for (let i = 0; i < players.length && y < height - 120; i++) {
      const p = players[i];
      const seat = (p.seat as ReturnType<typeof seatForIndex> | undefined) ?? seatForIndex(i);
      const rawName = String(p.name ?? `Player ${i + 1}`);
      const presence = typeof p.presence === "string" ? p.presence : "active";
      const bits: string[] = [];
      for (const key of ["score", "chips", "totalStrokes", "taps", "shipsLeft", "remaining", "lives", "speed"]) {
        if (typeof p[key] === "number") bits.push(`${key === "score" ? "score" : key}: ${p[key]}`);
      }
      if (p.out === true || p.eliminated === true) bits.push("OUT");
      if (p.folded === true) bits.push("folded");
      if (p.alive === false) bits.push("out");
      if (presence !== "active") bits.push(presence);

      ctx.fillStyle = seat.color;
      ctx.fillRect(32, y + 2, 18, 18);
      ctx.fillStyle = "#0F172A";
      ctx.font = "700 12px Inter, sans-serif";
      ctx.fillText(seat.emoji, 36, y + 3);

      ctx.fillStyle = presence === "active" ? "#F8FAFC" : "#64748B";
      ctx.font = "400 22px Inter, sans-serif";
      const name = ellipsize(ctx, rawName, Math.max(120, width - 360));
      ctx.fillText(`${name}  ${bits.join("  ")}`, 56, y);
      y += 30;
    }
  }

  if (state.finished === true) {
    const winner = state.winner as { name?: string; score?: number } | null;
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(0, height / 2 - 90, width, 180);
    ctx.textAlign = "center";
    ctx.fillStyle = "#F59E0B";
    ctx.font = "700 56px Inter, sans-serif";
    ctx.fillText(winner?.name ? `${winner.name} wins!` : "Game over!", width / 2, height / 2 - 50);
    ctx.textAlign = "left";
  }
}

// --- A1: per-game TV matrix tests -------------------------------------------

describe("A1: TV renderers fit 1920x1080 and 1280x720 with 8 long-named players", () => {
  for (const [id, entry] of Object.entries(TV_MATRIX)) {
    const catalogEntry = GAME_CATALOG[id];
    test(`${id} [${entry.mode}] renders inside the canvas at both resolutions`, async () => {
      assert.ok(catalogEntry, `${id}: missing catalog entry`);
      const count = playerCountFor(catalogEntry);
      const players = makePlayers(count);
      const plugin = await loadPlugin(id);
      const instance = plugin.onStart(makeRoom(players, id), players);
      const screen = plugin.screenState(instance) as Record<string, unknown>;
      assert.ok(screen && typeof screen === "object", `${id}: screenState returned nothing`);

      const variants: Array<[string, Record<string, unknown>]> = [
        ["real", screen],
        ["long-text", longTextVariant(screen)],
      ];

      for (const [width, height] of RESOLUTIONS) {
        for (const [variant, state] of variants) {
          const label = `${id} ${variant} ${width}x${height}`;
          if (entry.mode === "custom") {
            const renderer = await loadRenderer(id);
            // Frame 1 creates any title card; frame 2 draws the game itself.
            renderAndAssert((ctx) => renderer(ctx, width, height, state), width, height, `${label} frame1`);
            renderAndAssert((ctx) => renderer(ctx, width, height, state), width, height, `${label} frame2`);
          } else {
            renderAndAssert(
              (ctx) => renderGenericMirror(ctx, width, height, state, catalogEntry.displayName),
              width,
              height,
              `${label} frame1`,
            );
            renderAndAssert(
              (ctx) => renderGenericMirror(ctx, width, height, state, catalogEntry.displayName),
              width,
              height,
              `${label} frame2`,
            );
          }
        }
      }

      // Anti-vacuity: the 12-char names (or a full roster) really reached the
      // screen payload, so the layout above was drawn with the long names.
      const names = players.map((p) => p.name);
      const json = JSON.stringify(screen);
      const seen = names.filter((name) => json.includes(name));
      if (seen.length === 0) {
        const roster = [screen.players, screen.scores, screen.racers, screen.turnOrder, screen.seats].find(
          (value) => Array.isArray(value) && value.length >= count,
        );
        assert.ok(roster, `${id}: screen state carries neither player names nor a ${count}-entry roster`);
      }
    });
  }
});

describe("A1: generic stress payloads fit both resolutions", () => {
  const eightPlayers = Array.from({ length: 8 }, (_, i) => ({
    name: longName(i),
    score: (i + 1) * 1111,
    seat: seatForIndex(i),
  }));

  const stressStates: Array<[string, Record<string, unknown>]> = [
    [
      "votes",
      {
        phase: "voting",
        round: 2,
        totalRounds: 6,
        timeLeft: 15000,
        prompt: LONG_TEXT,
        options: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: `${LONG_TEXT} ${i}`, votes: i })),
        showVoteCounts: true,
        selectedId: "o2",
        players: eightPlayers,
      },
    ],
    [
      "slide",
      {
        phase: "presenting",
        round: 1,
        maxRounds: 8,
        slide: LONG_TEXT,
        presenterName: longName(0),
        slidesLeft: 5,
        players: eightPlayers,
      },
    ],
    [
      "strokes",
      {
        phase: "voting",
        drawingNumber: 3,
        totalDrawings: 8,
        artistName: longName(4),
        strokes: [
          { points: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2]], color: "#111111" },
          [[0.25, 0.75], [0.8, 0.6]],
        ],
        options: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `${LONG_TEXT} title ${i}` })),
        players: eightPlayers,
      },
    ],
    [
      "cells",
      {
        phase: "playing",
        prompt: LONG_TEXT,
        cells: Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 12 }, (_, c) => ((r + c) % 3 === 0 ? "X" : (r + c) % 3 === 1 ? "o" : "")),
        ),
        players: eightPlayers,
      },
    ],
    [
      "finished",
      {
        phase: "finished",
        finished: true,
        winner: { name: longName(7), score: 9999 },
        players: eightPlayers,
      },
    ],
  ];

  for (const [name, state] of stressStates) {
    for (const [width, height] of RESOLUTIONS) {
      test(`${name} payload at ${width}x${height} stays inside the canvas`, () => {
        renderAndAssert(
          (ctx) => renderGenericMirror(ctx, width, height, state, "Stress Game"),
          width,
          height,
          `generic-stress ${name} ${width}x${height}`,
        );
      });
    }
  }
});

// --- A2: host-board canvas pieces -------------------------------------------

function optionSet(count: number, labelLength: number): VoteOption[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `o${i}`,
    label: `${LONG_TEXT.slice(0, labelLength)} ${i}`,
    votes: count - i,
    selected: i === 1,
  }));
}

function voteRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
  return { x: 32, y: 240, width: width - 64, height: height - 240 - 40 };
}

describe("A2: drawVoteOptions grids fit 7-9 options at both resolutions", () => {
  for (const count of [7, 8, 9]) {
    test(`${count} long-answer options: cells inside the rect, no overlap, text within`, () => {
      const layout = voteLayout(count);
      assert.strictEqual(layout.columns, 2, `${count} options must use the two-column letter grid`);

      for (const [width, height] of RESOLUTIONS) {
        const rect = voteRect(width, height);
        const container: BBox = {
          x0: rect.x,
          y0: rect.y,
          x1: rect.x + rect.width,
          y1: rect.y + rect.height,
        };
        const drawVote = (ctx: CanvasRenderingContext2D): void => {
          drawVoteOptions(ctx, rect, optionSet(count, 90), {
            scale: scaleForViewport(width, height),
            showVoteCounts: true,
          });
        };

        const rec = recordDraw(drawVote, width, height);
        assertFiniteOps(rec, `drawVoteOptions ${count} options ${width}x${height}`);
        assert.ok(
          textOps(rec).length >= count,
          `drawVoteOptions ${count}@${width}: expected >= ${count} option texts, got ${textOps(rec).length}`,
        );

        const boxes = dedupeBoxes(fillBoxes(rec));
        assert.ok(
          boxes.length >= count * 2,
          `drawVoteOptions ${count}@${width}: expected >= ${count * 2} shapes (cells + badges), recorded ${boxes.length}`,
        );

        // Largest `count` boxes are the option cells (cells dwarf the badges).
        const area = (b: RecordedOp & { box: BBox }): number => (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0);
        const cells = [...boxes].sort((a, b) => area(b) - area(a)).slice(0, count);
        for (const [index, cell] of cells.entries()) {
          const b = cell.box;
          assert.ok(
            b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1,
            `drawVoteOptions ${count}@${width}: cell ${index} has no size`,
          );
          assert.ok(
            inside(container, b, 1),
            `drawVoteOptions ${count}@${width}: cell ${index} escapes the rect (${b.x0.toFixed(1)},${b.y0.toFixed(1)}..${b.x1.toFixed(1)},${b.y1.toFixed(1)})`,
          );
        }
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            assert.ok(
              !overlaps(cells[i].box, cells[j].box),
              `drawVoteOptions ${count}@${width}: cells ${i} and ${j} overlap`,
            );
          }
        }

        // Every glyph (badge letters, answer lines, tallies) stays in the rect.
        // TEXT_MARGIN covers the centred 3-line block, which the source lets sit
        // up to ~2px past its cell by design.
        for (const text of textOps(rec)) {
          assert.ok(
            inside(container, text.box!, TEXT_MARGIN),
            `drawVoteOptions ${count}@${width}: text "${text.text}" escapes the option rect (${text.box!.x0.toFixed(1)},${text.box!.y0.toFixed(1)}..${text.box!.x1.toFixed(1)},${text.box!.y1.toFixed(1)})`,
          );
        }
      }
    });
  }
});

describe("A2: watch ticker fits 8 rows of 12-char names at both resolutions", () => {
  const rows: WatchTickerRow[] = Array.from({ length: 8 }, (_, i) => ({
    name: longName(i),
    seat: seatForIndex(i),
    // Big scores shrink the name column so the ellipsis path is exercised.
    score: 12345678 - i * 111111,
  }));

  function buildRowsOnlyOverlay(): WatchOverlayState {
    const state = createWatchOverlay();
    updateWatchOverlay(state, {
      rows,
      waitingNames: [],
      timeLeft: null,
      caption: null,
      reveal: null,
      now: 20000,
      reducedMotion: true,
    });
    return state;
  }

  function expectedCard(width: number, height: number): BBox {
    const scale = scaleForViewport(width, height);
    const margin = Math.max(12, scaledSize(24, scale));
    const padding = Math.max(8, scaledSize(12, scale));
    const rowHeight = Math.max(26, scaledSize(34, scale));
    const cardWidth = Math.min(Math.max(190, scaledSize(300, scale)), width * 0.36);
    const cardHeight = rows.length * rowHeight + padding * 2;
    return {
      x0: width - margin - cardWidth,
      y0: height - margin - cardHeight,
      x1: width - margin,
      y1: height - margin,
    };
  }

  test("the score card sits bottom-right with every row and glyph inside it", () => {
    for (const [width, height] of RESOLUTIONS) {
      const scale = scaleForViewport(width, height);
      const card = expectedCard(width, height);
      assert.ok(card.x0 > 0 && card.y0 > 0, `ticker ${width}x${height}: card must start on screen`);
      assert.ok(
        card.x1 - card.x0 > 0 && card.y1 - card.y0 > 0,
        `ticker ${width}x${height}: no negative card size`,
      );

      const rec = recordDraw(
        (ctx) => drawWatchOverlay(ctx, width, height, buildRowsOnlyOverlay(), 21000, true),
        width,
        height,
      );
      assertFiniteOps(rec, `ticker rows ${width}x${height}`);
      assertOpInBounds(rec, width, height, `ticker rows ${width}x${height}`);

      const cardBoxes = dedupeBoxes(fillBoxes(rec)).filter(
        (b) => Math.abs(b.box.x0 - card.x0) <= 1 && Math.abs(b.box.y1 - card.y1) <= 1,
      );
      assert.strictEqual(
        cardBoxes.length,
        1,
        `ticker ${width}x${height}: expected exactly one card rect at ${card.x0.toFixed(1)},${card.y0.toFixed(1)}`,
      );

      for (const text of textOps(rec)) {
        assert.ok(
          inside(card, text.box!, 1),
          `ticker ${width}x${height}: "${text.text}" escapes the card (${text.box!.x0.toFixed(1)}..${text.box!.x1.toFixed(1)})`,
        );
      }

      // Ellipsis: names too wide for their column must be clipped with "...".
      const padding = Math.max(8, scaledSize(12, scale));
      const rowHeight = Math.max(26, scaledSize(34, scale));
      const badgeSize = rowHeight * 0.64;
      const nameSize = Math.max(13, scaledSize(18, scale));
      const scoreSize = Math.max(14, scaledSize(22, scale));
      const drawn = textOps(rec).map((t) => t.text!);
      for (const [index, row] of rows.entries()) {
        const badgeX = card.x0 + padding;
        const scoreWidth = codePointLength(String(row.score)) * scoreSize * CHAR_EM;
        const nameX = badgeX + badgeSize + Math.max(6, scaledSize(9, scale));
        const nameMax = card.x1 - padding - scoreWidth - Math.max(6, scaledSize(10, scale));
        const available = Math.max(20, nameMax - nameX);
        const fullWidth = codePointLength(row.name) * nameSize * CHAR_EM;
        const label = `ticker ${width}x${height} row ${index} (${row.name})`;

        const match = drawn.find(
          (t) => t === row.name || (t.endsWith("…") && row.name.startsWith(t.slice(0, -1))),
        );
        assert.ok(
          match,
          `${label}: no drawn name found among ${drawn.filter((t) => t.includes("Longname")).join(" | ")}`,
        );
        if (fullWidth > available) {
          assert.ok(
            match.endsWith("…"),
            `${label}: ${fullWidth.toFixed(1)}px > ${available.toFixed(1)}px available, expected an ellipsis`,
          );
          assert.ok(
            codePointLength(match) * nameSize * CHAR_EM <= available + 0.5,
            `${label}: ellipsised name still wider than ${available.toFixed(1)}px`,
          );
        } else {
          assert.strictEqual(match, row.name, `${label}: name fits, so it must be drawn in full`);
        }
      }
    }
  });

  test("caption, reveal and waiting banner with 8 long names stay on screen", () => {
    for (const [width, height] of RESOLUTIONS) {
      const state = createWatchOverlay();
      updateWatchOverlay(state, {
        rows,
        waitingNames: rows.map((r) => r.name),
        timeLeft: 5000,
        caption: LONG_TEXT,
        reveal: LONG_TEXT,
        now: 30000,
        reducedMotion: false,
      });
      const rec = renderAndAssert(
        (ctx) => drawWatchOverlay(ctx, width, height, state, 31500, false),
        width,
        height,
        `watch-overlay full ${width}x${height}`,
      );
      assert.ok(
        textOps(rec).length >= 8,
        `watch-overlay ${width}x${height}: expected the eight name rows, got ${textOps(rec).length} texts`,
      );
    }
  });

  test("tickerRowsFromScreen caps at 8 rows and keeps 12-char names", () => {
    const screen = {
      players: Array.from({ length: 10 }, (_, i) => ({ name: longName(i % 8), score: i * 10 })),
      waitingOn: Array.from({ length: 12 }, (_, i) => longName(i % 8)),
    };
    const rowsOut = tickerRowsFromScreen(screen);
    assert.strictEqual(rowsOut.length, 8, "the ticker caps at one row per seat");
    assert.ok(
      rowsOut.every((r) => r.name.length === 12),
      "12-char names survive normalisation",
    );
    const waiting = waitingNamesFromScreen(screen);
    assert.strictEqual(waiting.length, 8, "the waiting list caps at the eight seats");
    assert.ok(waiting.every((name) => name.length === 12));
  });
});

describe("A2: interlude card with 8 players and a long rule", () => {
  test("oneLineRule truncates at 96 chars and the card stays bounded", () => {
    const longDescription = `${LONG_TEXT} ${LONG_TEXT}`;
    const rule = oneLineRule(longDescription);
    assert.ok(rule.length <= 97, `oneLineRule must stay within 96 chars + ellipsis, got ${rule.length}`);
    assert.ok(rule.endsWith("…"), "an over-long description must end with an ellipsis");

    const shortRule = oneLineRule("Write a slogan. Vote for the best one.");
    assert.strictEqual(shortRule, "Write a slogan.", "the first sentence wins when it fits");

    const players = Array.from({ length: 8 }, (_, i) => ({
      spectator: false,
      connected: true,
      presence: (i === 6 ? "away" : "active") as "active" | "away",
    }));
    const card = interludeCard({
      nextGame: { name: "Slogan Shirts", description: longDescription },
      players,
    });
    assert.strictEqual(card.playerCount, 7, "away players do not count toward the live total");
    assert.strictEqual(card.durationMs, INTERLUDE_DURATION_MS);
    assert.ok(card.rule.length <= 97, `interlude rule must be one bounded line, got ${card.rule.length}`);
    assert.ok(card.gameName.length > 0 && card.title.length > 0);
    assert.ok(Number.isFinite(card.playerCount) && card.playerCount >= 0);
  });
});

// --- A1: exported layout helpers --------------------------------------------

function assertRectsInsideAndDisjoint(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
  label: string,
): void {
  for (const [index, rect] of rects.entries()) {
    assert.ok(Number.isFinite(rect.x) && Number.isFinite(rect.y), `${label}: rect ${index} has non-finite origin`);
    assert.ok(
      rect.width > 0 && rect.height > 0,
      `${label}: rect ${index} has no size (${rect.width}x${rect.height})`,
    );
    assert.ok(rect.x >= -SHAPE_MARGIN, `${label}: rect ${index} starts left of the canvas`);
    assert.ok(rect.y >= -SHAPE_MARGIN, `${label}: rect ${index} starts above the canvas`);
    assert.ok(rect.x + rect.width <= width + SHAPE_MARGIN, `${label}: rect ${index} runs past the right edge`);
    assert.ok(rect.y + rect.height <= height + SHAPE_MARGIN, `${label}: rect ${index} runs past the bottom`);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlapX = a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5;
      const overlapY = a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
      assert.ok(!(overlapX && overlapY), `${label}: rects ${i} and ${j} overlap`);
    }
  }
}

describe("A1: exported geometry helpers at both resolutions", () => {
  test("bracket cards: 6-player bracket, non-overlapping and inside", () => {
    const matches = Array.from({ length: 5 }, (_, index) => ({ round: index < 2 ? 0 : 1 }));
    for (const [width, height] of RESOLUTIONS) {
      const cards = bracketCardLayout(width, height, matches);
      assert.strictEqual(cards.length, 5, `bracket ${width}: one card per match`);
      assertRectsInsideAndDisjoint(cards, width, height, `bracketCardLayout ${width}x${height}`);
    }
  });

  test("racing lanes: 8 lanes tile the track and leave room for names", () => {
    for (const [width, height] of RESOLUTIONS) {
      const scale = scaleForViewport(width, height);
      const layout = racingLaneLayout(8, width, height, scale);
      const { track, lanes } = layout;
      assert.ok(track.width > 0 && track.height > 0, `racing ${width}: track has no size`);
      assert.ok(track.x >= 0 && track.y >= 0, `racing ${width}: track starts on screen`);
      assert.ok(track.x + track.width <= width + 1, `racing ${width}: track fits horizontally`);
      assert.ok(track.y + track.height <= height + 1, `racing ${width}: track fits vertically`);
      assert.strictEqual(lanes.length, 8, `racing ${width}: eight lane boxes`);
      for (const [index, lane] of lanes.entries()) {
        assert.ok(lane.width > 0, `racing ${width}: lane ${index} has no width`);
        assert.ok(lane.nameMaxWidth > 0, `racing ${width}: lane ${index} leaves no room for a name`);
        assert.ok(lane.x >= track.x - 0.5, `racing ${width}: lane ${index} starts inside the track`);
        if (index > 0) {
          const prev = lanes[index - 1];
          assert.ok(
            Math.abs(prev.x + prev.width - lane.x) < 0.01,
            `racing ${width}: lanes ${index - 1} and ${index} must touch without overlap`,
          );
        }
      }
      const last = lanes[lanes.length - 1];
      assert.ok(
        last.x + last.width <= track.x + track.width + 0.5,
        `racing ${width}: lanes stay inside the track`,
      );
    }
  });

  test("poker seat panels: 8 seats, non-overlapping and inside", () => {
    for (const [width, height] of RESOLUTIONS) {
      const seats = pokerSeatLayout(8, width, height);
      assert.strictEqual(seats.length, 8, `poker ${width}: eight seat panels`);
      assertRectsInsideAndDisjoint(seats, width, height, `pokerSeatLayout ${width}x${height}`);
    }
  });

  test("archery: eight lane chips form one non-overlapping row at both resolutions", async () => {
    const plugin = await loadPlugin("archery");
    const players = makePlayers(8);
    const instance = plugin.onStart(makeRoom(players, "archery"), players);
    const screen = plugin.screenState(instance) as Record<string, unknown>;
    const drawable = { ...screen, phase: "aiming", round: 2, sound: null, caption: null };
    const renderer = await loadRenderer("archery");

    for (const [width, height] of RESOLUTIONS) {
      const label = `archery lanes ${width}x${height}`;
      const rec = renderAndAssert(
        (ctx) => renderer(ctx, width, height, drawable),
        width,
        height,
        label,
      );

      // The lane chips are not exported; group the recorded fills by their
      // (y, height) row and require one row of eight equal-height chips.
      const boxes = dedupeBoxes(fillBoxes(rec));
      const groups = new Map<string, Array<RecordedOp & { box: BBox }>>();
      for (const box of boxes) {
        const key = `${box.box.y0.toFixed(1)}|${(box.box.y1 - box.box.y0).toFixed(1)}`;
        const list = groups.get(key) ?? [];
        list.push(box);
        groups.set(key, list);
      }
      const rowsOfThree = [...groups.values()].filter((list) => list.length >= 3);
      const laneRow = rowsOfThree.find((list) => list.length >= 8);
      assert.ok(
        laneRow,
        `${label}: expected a row of >= 8 lane chips, rows found: ${
          rowsOfThree.map((list) => list.length).join(", ") || "none"
        }`,
      );
      const sorted = [...laneRow].sort((a, b) => a.box.x0 - b.box.x0);
      for (const [index, chip] of sorted.entries()) {
        assert.ok(
          chip.box.x0 >= -SHAPE_MARGIN && chip.box.x1 <= width + SHAPE_MARGIN,
          `${label}: lane chip ${index} leaves the canvas`,
        );
        if (index > 0) {
          assert.ok(
            sorted[index - 1].box.x1 <= chip.box.x0 + 0.5,
            `${label}: lane chips ${index - 1} and ${index} overlap`,
          );
        }
      }

      // All eight 12-char names must be drawn on their lane chips.
      const drawn = textOps(rec).map((t) => t.text!);
      for (const player of players) {
        const match = drawn.find(
          (t) => t === player.name || (t.endsWith("…") && player.name.startsWith(t.slice(0, -1))),
        );
        assert.ok(match, `${label}: lane chip name missing for ${player.name}`);
      }
    }
  });
});

// --- B: phone 360dp at 1.5x text (static source audit) ----------------------

const CONTROLLER_HTML = readFileSync(join(repoRoot, "client", "controller", "index.html"), "utf8");
const CONTROLLER_SRC = readFileSync(join(repoRoot, "shared", "controllers.ts"), "utf8");
const CONTROLLER_MAIN_SRC = readFileSync(join(repoRoot, "client", "controller", "main.ts"), "utf8");

interface CssRule {
  selector: string;
  decls: Record<string, string>;
  media: string | null;
}

function parseCss(html: string): CssRule[] {
  const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(styleMatch, "client/controller/index.html must contain a <style> block");
  const css = styleMatch[1].replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];

  const walk = (source: string, media: string | null): void => {
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf("{", i);
      if (open === -1) break;
      const prelude = source.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === "{") depth++;
        else if (source[j] === "}") depth--;
        j++;
      }
      const body = source.slice(open + 1, j - 1);
      if (prelude.startsWith("@media")) {
        walk(body, prelude);
      } else if (!prelude.startsWith("@")) {
        const decls: Record<string, string> = {};
        for (const part of body.split(";")) {
          const colon = part.indexOf(":");
          if (colon === -1) continue;
          const key = part.slice(0, colon).trim().toLowerCase();
          const value = part.slice(colon + 1).trim();
          if (key) decls[key] = value;
        }
        for (const raw of prelude.split(",")) {
          const selector = raw.replace(/\s+/g, " ").trim();
          if (selector) rules.push({ selector, decls, media });
        }
      }
      i = j;
    }
  };

  walk(css, null);
  return rules;
}

const CSS_RULES = parseCss(CONTROLLER_HTML);

function rulesFor(selector: string): CssRule[] {
  return CSS_RULES.filter((rule) => rule.selector === selector);
}

function ruleFor(selector: string): CssRule | undefined {
  return rulesFor(selector)[0];
}

function pxValue(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/** Worst-case declared tap size (min-height, else height) across matching rules. */
function sizeValue(selector: string): number | null {
  const values: number[] = [];
  for (const rule of rulesFor(selector)) {
    const size = pxValue(rule.decls["min-height"]) ?? pxValue(rule.decls["height"]);
    if (size !== null) values.push(size);
  }
  return values.length > 0 ? Math.min(...values) : null;
}

function pxTokens(value: string): number[] {
  return [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Evaluate a length at a given viewport width; null for fluid values. */
function evalLength(value: string, viewport: number): number | null {
  const v = value.trim().toLowerCase();
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  if (px) return Number(px[1]);
  const vw = /^(-?\d+(?:\.\d+)?)vw$/.exec(v);
  if (vw) return (Number(vw[1]) * viewport) / 100;
  if (v.startsWith("min(") || v.startsWith("max(")) {
    const inner = v.slice(v.indexOf("(") + 1, v.lastIndexOf(")"));
    const parts = splitTopLevel(inner).map((part) => evalLength(part, viewport));
    if (parts.some((part) => part === null)) return null;
    const nums = parts as number[];
    return v.startsWith("min(") ? Math.min(...nums) : Math.max(...nums);
  }
  return null; // %, calc(), var(), auto — fluid inside a <=360px container
}

describe("B1: phone CSS widths fit a 360dp viewport", () => {
  test("no width/min-width declaration exceeds 360px at 360px wide", () => {
    const violations: string[] = [];
    let checked = 0;
    for (const rule of CSS_RULES) {
      for (const prop of ["width", "min-width"] as const) {
        const value = rule.decls[prop];
        if (!value) continue;
        checked++;
        const where = `${rule.selector} { ${prop}: ${value} }${rule.media ? ` [${rule.media}]` : ""}`;
        for (const px of pxTokens(value)) {
          if (px > 360) violations.push(`${where} — fixed ${px}px exceeds 360px`);
        }
        const evaluated = evalLength(value, 360);
        if (evaluated !== null && evaluated > 360) {
          violations.push(`${where} — evaluates to ${evaluated}px at a 360px viewport`);
        }
      }
    }
    assert.ok(checked >= 30, `expected the controller CSS to declare widths, audited only ${checked}`);
    assert.deepStrictEqual(
      violations,
      [],
      `phone width audit failures (selector -> value):\n${violations.join("\n")}`,
    );
  });
});

// --- B2/B5: tap targets and the controller-type walk ------------------------

const CONTROLLER_TYPES: ControllerType[] = [
  "aim",
  "board",
  "card-hand",
  "canvas",
  "chat",
  "choice",
  "dpad",
  "dual-slider",
  "left-right",
  "numpad",
  "one-button",
  "pad",
  "private-grid",
  "rank",
  "role",
  "slider",
  "tap-race",
  "text",
];

const FLOOR_PX = 44;

function declOf(selector: string, prop: string): string {
  const rule = ruleFor(selector);
  assert.ok(rule, `tap-target ${selector}: no CSS rule found`);
  const value = rule.decls[prop];
  assert.ok(value, `tap-target ${selector}: missing "${prop}" declaration`);
  return value;
}

function numberOf(selector: string, prop: string, pattern: RegExp, what: string): number {
  const value = declOf(selector, prop);
  const m = pattern.exec(value);
  assert.ok(m, `tap-target ${selector}: cannot read ${what} from "${prop}: ${value}"`);
  return Number(m[1]);
}

interface TapRow {
  /** Class tokens this row covers for the fail-closed walk. */
  covers: string[];
  selector: string;
  types: ControllerType[];
  kind: "size" | "derived" | "gap";
  /** Documented px value at a 360dp viewport (0 = no CSS rule at all). */
  measured: number;
  /** Recompute the value from the live CSS (fail-closed on declaration drift). */
  derive?: () => number;
  reason?: string;
  note?: string;
}

/**
 * Every interactive class a controller layout emits, plus the platform chrome
 * buttons. `size` rows read min-height/height straight from the CSS; `derived`
 * rows recompute from the declarations they depend on; `gap` rows document a
 * value below the 44px floor with a written reason (known findings).
 */
const TAP_ROWS: TapRow[] = [
  // --- controller layouts ---------------------------------------------------
  {
    covers: ["btn-one"],
    selector: ".btn-one",
    types: ["one-button"],
    kind: "derived",
    measured: 230,
    derive: () => {
      const width = evalLength(declOf(".btn-one", "width"), 360);
      assert.ok(width !== null, 'tap-target .btn-one: width must evaluate at 360px');
      assert.strictEqual(declOf(".btn-one", "aspect-ratio"), "1", ".btn-one must stay square");
      return width;
    },
    note: "min(64vw, 230px) square button",
  },
  {
    covers: ["btn-lr"],
    selector: ".btn-lr",
    types: ["left-right"],
    kind: "size",
    measured: 90,
    note: "base 110px, 90px in the short-viewport media query — worst case wins",
  },
  {
    covers: ["dpad-btn"],
    selector: ".dpad-btn",
    types: ["dpad"],
    kind: "derived",
    measured: 98.93,
    derive: () => {
      const dpadWidth = evalLength(declOf(".dpad", "width"), 360);
      assert.ok(dpadWidth !== null, ".dpad width must evaluate at 360px");
      const gap = numberOf(".dpad", "gap", /^(\d+(?:\.\d+)?)px$/, "gap");
      const areas = declOf(".dpad", "grid-template-areas");
      const firstRow = areas.split(/["']/).find((part) => part.trim().includes("up")) ?? "";
      const cols = firstRow.trim().split(/\s+/).filter(Boolean).length;
      assert.ok(cols >= 3, `.dpad grid must keep 3 columns, found ${cols}`);
      assert.strictEqual(declOf(".dpad-btn", "aspect-ratio"), "1", ".dpad-btn must stay square");
      return Math.round(((dpadWidth - gap * (cols - 1)) / cols) * 100) / 100;
    },
    note: "square key inside min(88vw, 340px) 3-column grid",
  },
  {
    covers: ["primary"],
    selector: ".primary",
    types: ["text", "private-grid", "card-hand", "dual-slider", "numpad", "canvas", "chat", "rank"],
    kind: "size",
    measured: 50,
    note: "56px base, 50px in the short-viewport media query",
  },
  {
    covers: [],
    selector: ".grid-actions .primary",
    types: ["private-grid"],
    kind: "size",
    measured: 46,
    note: "sea-battle confirm button",
  },
  {
    covers: ["choice-btn"],
    selector: ".choice-btn",
    types: ["choice", "board"],
    kind: "size",
    measured: 56,
    note: "56px floor: stays above 48dp at 1.5x text",
  },
  {
    covers: ["choice-btn"],
    selector: ".choices-grid .choice-btn",
    types: ["choice"],
    kind: "size",
    measured: 48,
    note: "compact single-character keypad grid",
  },
  {
    covers: ["choice-btn"],
    selector: ".choices.two-column .choice-btn",
    types: ["choice"],
    kind: "size",
    measured: 56,
    note: "7+ option two-column grid",
  },
  {
    covers: ["card"],
    selector: ".card",
    types: ["card-hand"],
    kind: "size",
    measured: 118,
    note: "poker cards are clickable when the action bar is hidden",
  },
  {
    covers: ["action-btn"],
    selector: ".action-btn",
    types: ["card-hand", "dual-slider", "numpad", "canvas", "chat", "rank"],
    kind: "size",
    measured: 54,
  },
  {
    covers: ["raise-step"],
    selector: ".raise-step",
    types: ["card-hand"],
    kind: "size",
    measured: 48,
  },
  {
    covers: ["slider-track"],
    selector: ".slider-track",
    types: ["slider", "dual-slider", "aim"],
    kind: "size",
    measured: 64,
    note: "pointer-drag surface (the y-axis variant is 180px)",
  },
  {
    covers: ["slider-knob"],
    selector: ".slider-knob",
    types: ["slider", "dual-slider", "aim"],
    kind: "size",
    measured: 44,
    note: "decorative (pointer-events: none) but already at the floor",
  },
  {
    covers: ["pad"],
    selector: ".pad",
    types: ["pad"],
    kind: "derived",
    measured: 280.8,
    derive: () => {
      const width = evalLength(declOf(".pad", "width"), 360);
      assert.ok(width !== null, ".pad width must evaluate at 360px");
      assert.strictEqual(declOf(".pad", "aspect-ratio"), "1", ".pad must stay square");
      return width;
    },
    note: "min(78vw, 320px) square joystick",
  },
  {
    covers: ["aim-pad"],
    selector: ".aim-pad",
    types: ["aim"],
    kind: "derived",
    measured: 201.6,
    derive: () => {
      const width = evalLength(declOf(".aim-pad", "width"), 360);
      assert.ok(width !== null, ".aim-pad width must evaluate at 360px");
      assert.strictEqual(declOf(".pad", "aspect-ratio"), "1", ".aim-pad inherits the square .pad shape");
      return width;
    },
    note: "min(56vw, 240px) joystick",
  },
  {
    covers: ["race-btn"],
    selector: ".race-btn",
    types: ["tap-race"],
    kind: "derived",
    measured: 286.4,
    derive: () => {
      const padding = declOf(".race-btn", "padding");
      const vh = numberOf(".race-btn", "padding", /^(\d+(?:\.\d+)?)vh/, "vertical padding");
      const fontSize = numberOf(".race-btn", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      const border = numberOf(".race-btn", "border", /^(\d+(?:\.\d+)?)px/, "border");
      void padding;
      // Derived at a 640px-tall phone viewport; grows with any taller screen.
      return Math.round((2 * (vh / 100) * 640 + fontSize * 1.2 + border * 2) * 10) / 10;
    },
    note: "padding: 18vh 0 — derived at a 640px viewport height",
  },
  {
    covers: ["board-tile"],
    selector: ".board-tile",
    types: ["board"],
    kind: "derived",
    measured: 57.4,
    derive: () => {
      const paddingTop = numberOf(".board-tile", "padding", /^(\d+(?:\.\d+)?)px/, "padding-top");
      const gap = numberOf(".board-tile", "gap", /^(\d+(?:\.\d+)?)px$/, "gap");
      const border = numberOf(".board-tile", "border", /^(\d+(?:\.\d+)?)px/, "border");
      const initial = numberOf(".board-initial", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      const name = numberOf(".board-name", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      return Math.round((paddingTop * 2 + initial * 1.2 + gap + name * 1.1 + border * 2) * 10) / 10;
    },
    note: "content stack: padding + 22px initial + gap + 10px name + border",
  },
  {
    covers: ["numpad-key"],
    selector: ".numpad-key",
    types: ["numpad"],
    kind: "derived",
    measured: 64.4,
    derive: () => {
      const paddingTop = numberOf(".numpad-key", "padding", /^(\d+(?:\.\d+)?)px/, "padding-top");
      const fontSize = numberOf(".numpad-key", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      const border = numberOf(".numpad-key", "border", /^(\d+(?:\.\d+)?)px/, "border");
      return Math.round((paddingTop * 2 + fontSize * 1.2 + border * 2) * 10) / 10;
    },
  },
  {
    covers: ["role-hold"],
    selector: ".role-hold",
    types: ["role"],
    kind: "derived",
    measured: 71.6,
    derive: () => {
      const paddingTop = numberOf(".role-hold", "padding", /^(\d+(?:\.\d+)?)px/, "padding-top");
      const fontSize = numberOf(".role-hold", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      const border = numberOf(".role-hold", "border", /^(\d+(?:\.\d+)?)px/, "border");
      return Math.round((paddingTop * 2 + fontSize * 1.2 + border * 2) * 10) / 10;
    },
  },
  {
    covers: ["chat-input"],
    selector: ".chat-input",
    types: ["chat"],
    kind: "derived",
    measured: 44,
    derive: () => {
      const paddingTop = numberOf(".chat-input", "padding", /^(\d+(?:\.\d+)?)px/, "padding-top");
      const fontSize = numberOf(".chat-input", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      const border = numberOf(".chat-input", "border", /^(\d+(?:\.\d+)?)px/, "border");
      return Math.round((paddingTop * 2 + fontSize * 1.2 + border * 2) * 10) / 10;
    },
    note: "exactly 44px: 12px padding + 15px text + 1px border",
  },
  {
    covers: [],
    selector: ".text-input textarea",
    types: ["text"],
    kind: "size",
    measured: 96,
    note: "answer textarea: 132px base, 96px in the short-viewport media query",
  },
  {
    covers: ["grid-cell"],
    selector: ".grid-cell",
    types: ["private-grid"],
    kind: "derived",
    measured: 60,
    derive: () => {
      const play = declOf(".play", "padding");
      const horizontal = /^[\d.]+px\s+([\d.]+px)/.exec(play);
      assert.ok(horizontal, `.play padding must declare horizontal padding, got "${play}"`);
      const hPad = pxValue(horizontal[1]) ?? 0;
      const framePad = numberOf(".grid-frame", "padding", /^(\d+(?:\.\d+)?)px/, "padding");
      const gap = numberOf(".grid", "gap", /^(\d+(?:\.\d+)?)px$/, "gap");
      assert.ok(
        CONTROLLER_SRC.includes("raw.cols ?? 5"),
        "private-grid default column count changed — re-derive the grid-cell tap size",
      );
      const cols = 5;
      const inner = 360 - hPad * 2 - framePad * 2;
      return Math.round(((inner - gap * (cols - 1)) / cols) * 10) / 10;
    },
    note: "5x5 default (private-grid is unreachable from the catalog today); >= 44px only up to 6 columns",
  },
  {
    covers: ["draw-surface"],
    selector: ".draw-surface",
    types: ["canvas"],
    kind: "derived",
    measured: 360,
    derive: () => {
      assert.strictEqual(declOf(".draw-surface", "width"), "100%", "draw-surface must be fluid");
      assert.strictEqual(declOf(".draw-surface", "aspect-ratio"), "1", "draw-surface must stay square");
      // 100% of a container that B1 proves is <= 360px wide.
      return 360;
    },
    note: "the 600x600 bitmap is overridden by width: 100%",
  },
  {
    covers: ["canvas-swatch"],
    selector: ".canvas-swatch",
    types: ["canvas"],
    kind: "size",
    measured: 48,
    note: "48x48px circular colour swatch; the palette wraps on a 360dp phone (Drawful, Slogan Shirts)",
  },
  {
    covers: ["canvas-size"],
    selector: ".canvas-size",
    types: ["canvas"],
    kind: "size",
    measured: 48,
    note: "48x48px brush-size chip; three chips fit beside the wrapped palette",
  },
  {
    covers: ["rank-item"],
    selector: ".rank-item",
    types: ["rank"],
    kind: "size",
    measured: 48,
    note: "full-width pool chip, 48px floor, wraps long Frankenanswers labels",
  },
  {
    covers: ["rank-slot"],
    selector: ".rank-slot",
    types: ["rank"],
    kind: "size",
    measured: 48,
    note: "full-width placed chip with a compact order badge, 48px floor",
  },
  // --- known gaps (documented findings; changing the CSS fails these rows) ---
  {
    covers: ["chat-contact"],
    selector: ".chat-contact",
    types: ["chat"],
    kind: "gap",
    measured: 33.6,
    derive: () => {
      const paddingTop = numberOf(".chat-contact", "padding", /^(\d+(?:\.\d+)?)px/, "padding-top");
      const fontSize = numberOf(".chat-contact", "font-size", /^(\d+(?:\.\d+)?)px$/, "font-size");
      const border = numberOf(".chat-contact", "border", /^(\d+(?:\.\d+)?)px/, "border");
      return Math.round((paddingTop * 2 + fontSize * 1.2 + border * 2) * 10) / 10;
    },
    reason:
      "contact pill computes to ~34px, under the 44px floor. Only the disabled Blind Date Chat game emits the " +
      "chat layout today (unreachable), so the gap is recorded for when it is enabled.",
  },
  {
    covers: ["numpad-preset"],
    selector: ".numpad-preset",
    types: ["numpad"],
    kind: "gap",
    measured: 41.2,
    derive: () => {
      const paddingTop = numberOf(".numpad-preset", "padding", /^(\d+(?:\.\d+)?)px/, "padding-top");
      const border = numberOf(".numpad-preset", "border", /^(\d+(?:\.\d+)?)px/, "border");
      // No font-size of its own: inherits the 16px body default.
      assert.ok(!ruleFor(".numpad-preset")?.decls["font-size"], "numpad-preset gaining a font-size changes the estimate");
      return Math.round((paddingTop * 2 + 16 * 1.2 + border * 2) * 10) / 10;
    },
    reason:
      "computes to ~41px (10px padding + 16px inherited text + border), 3px under the 44px floor. No catalog " +
      "game emits the numpad controller type today (unreachable); raise the padding before enabling one.",
  },
  // --- platform chrome (static HTML, not emitted by a controller layout) ----
  {
    covers: [],
    selector: ".reaction-btn",
    types: [],
    kind: "size",
    measured: 48,
    note: "chrome: emoji reaction bar",
  },
  {
    covers: [],
    selector: ".host-btn",
    types: [],
    kind: "size",
    measured: 44,
    note: "chrome: host controls on the first phone",
  },
  {
    covers: [],
    selector: ".code-input",
    types: [],
    kind: "size",
    measured: 50,
    note: "chrome: room-code field, 58px base / 50px short viewport",
  },
  {
    covers: [],
    selector: ".name-field input",
    types: [],
    kind: "size",
    measured: 50,
    note: "chrome: join name field",
  },
  {
    covers: [],
    selector: ".leave-btn",
    types: [],
    kind: "size",
    measured: 48,
    note: "chrome: Leave-table pill raised to the 48px floor; stays centred in the 52px appbar",
  },
];

function tapActual(row: TapRow): number | null {
  if (row.derive) return row.derive();
  return sizeValue(row.selector);
}

function closeTo(actual: number, documented: number): boolean {
  return Math.abs(actual - documented) < 0.011;
}

describe("B2: every interactive controller class has a >= 44px tap target", () => {
  test("declared sizes match the audit table and meet the floor (or are documented gaps)", () => {
    assert.ok(TAP_ROWS.length >= 25, `tap audit table looks truncated: ${TAP_ROWS.length} rows`);
    for (const row of TAP_ROWS) {
      const label = `tap-target ${row.selector}`;
      const actual = tapActual(row);

      if (row.kind === "gap") {
        assert.ok(
          (row.reason ?? "").length >= 40,
          `${label}: known-gap row needs a written reason of at least 40 characters`,
        );
        if (row.measured === 0) {
          assert.strictEqual(
            actual,
            null,
            `${label}: the gap closed — a CSS rule now exists; promote this row to size/derived`,
          );
        } else {
          assert.ok(actual !== null, `${label}: the documented rule disappeared; re-review the row`);
          assert.ok(
            closeTo(actual, row.measured),
            `${label}: documented ${row.measured}px but the CSS now measures ${actual}px — re-review`,
          );
          assert.ok(
            actual < FLOOR_PX,
            `${label}: now ${actual}px >= ${FLOOR_PX}px floor — promote this row out of the gap list`,
          );
        }
        continue;
      }

      assert.ok(actual !== null, `${label}: no measurable tap size (min-height/height/derive)`);
      assert.ok(
        closeTo(actual, row.measured),
        `${label}: documented ${row.measured}px but the CSS now measures ${actual}px — re-review the audit table`,
      );
      assert.ok(
        actual >= FLOOR_PX,
        `${label}: ${actual}px is below the ${FLOOR_PX}px tap-target floor at 360dp`,
      );
    }
  });
});

// --- B5: walk every controller type ----------------------------------------

const CLASS_MODIFIERS = new Set([
  "active",
  "aim-action",
  "call",
  "chat-send",
  "clear-drawing",
  "confirm",
  "dual-action",
  "error",
  "face-down",
  "fold",
  "is-disabled",
  "left",
  "marked",
  "numpad-submit",
  "rank-reset",
  "rank-submit",
  "raise",
  "ready",
  "red",
  "right",
  "secret",
  "selected",
  "v-fill",
  "v-o",
  "v-S",
  "v-selected",
  "v-X",
  "v-picked",
]);

/** Pointer surfaces that are divs (not <button>) in the layout templates. */
const INTERACTIVE_DIVS = ["card", "slider-track", "pad"];

function extractLayoutClasses(): Array<{ type: ControllerType; classes: string[] }> {
  const header = /export function create(\w+)\(\): ControllerLayout \{/g;
  const starts: Array<{ type: ControllerType; start: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = header.exec(CONTROLLER_SRC)) !== null) {
    const group = match[1];
    const type = group.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "") as ControllerType;
    starts.push({ type, start: match.index });
  }
  assert.ok(starts.length >= 18, `expected 18 layout factories, found ${starts.length}`);

  const out: Array<{ type: ControllerType; classes: string[] }> = [];
  for (const [index, entry] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1].start : CONTROLLER_SRC.indexOf("export const controllerLayouts");
    const segment = CONTROLLER_SRC.slice(entry.start, end === -1 ? undefined : end);
    const tagRe = /<(button|input|textarea|canvas)[^>]*class="([^"]*)"/g;
    const classes = new Set<string>();
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRe.exec(segment)) !== null) {
      for (const token of tagMatch[2].split(/\s+/)) {
        if (/^[a-z][a-z0-9-]*$/.test(token)) classes.add(token);
      }
    }
    out.push({ type: entry.type, classes: [...classes].sort() });
  }
  return out;
}

describe("B5: every controller layout type is classified", () => {
  test("registry, signatures, emitted classes and interactive divs are all covered", () => {
    const registry = [...controllerLayouts.keys()].sort();
    assert.deepStrictEqual(
      registry,
      [...CONTROLLER_TYPES].sort(),
      "controllerLayouts registry changed — update CONTROLLER_TYPES and the audit rows",
    );

    for (const type of CONTROLLER_TYPES) {
      const layout = getLayout(type);
      assert.strictEqual(
        typeof layout.signature({}),
        "string",
        `${type}: getLayout(type).signature({}) must stay callable`,
      );
    }

    const extracted = extractLayoutClasses();
    const extractedCount = extracted.reduce((total, entry) => total + entry.classes.length, 0);
    assert.ok(
      extractedCount >= 18,
      `expected the layout templates to emit interactive classes, extraction found ${extractedCount}`,
    );

    const covered = new Set(TAP_ROWS.flatMap((row) => row.covers));
    const unclassified: string[] = [];
    for (const entry of extracted) {
      for (const cls of entry.classes) {
        if (covered.has(cls) || CLASS_MODIFIERS.has(cls)) continue;
        unclassified.push(`${entry.type} -> .${cls}`);
      }
    }
    assert.deepStrictEqual(
      unclassified,
      [],
      `controller classes with no tap-target row:\n${unclassified.join("\n")}`,
    );

    for (const div of INTERACTIVE_DIVS) {
      assert.ok(
        TAP_ROWS.some((row) => row.selector === `.${div}`),
        `interactive div .${div} must have a tap-target row`,
      );
      assert.ok(covered.has(div), `interactive div .${div} must be covered by a row`);
    }

    // The text layout's textarea carries no class; its selector row must exist.
    assert.ok(
      TAP_ROWS.some((row) => row.selector === ".text-input textarea"),
      "the text layout's textarea needs a tap-target row",
    );

    const typesWithRows = new Set(TAP_ROWS.flatMap((row) => row.types));
    for (const type of CONTROLLER_TYPES) {
      assert.ok(typesWithRows.has(type), `no tap-target row documents the ${type} layout`);
    }
  });
});

// --- B3: answer/name containers wrap at 1.5x text --------------------------

interface WrapRow {
  selector: string;
  kind: "prop" | "intrinsic" | "bounded" | "gap";
  /** Required declaration for kind "prop". */
  prop?: "overflow-wrap" | "text-overflow";
  reason: string;
  /** Assert the selector really has no rule (gap rows with no CSS at all). */
  noRule?: boolean;
}

const WRAP_ROWS: WrapRow[] = [
  {
    selector: ".choices.two-column .choice-btn",
    kind: "prop",
    prop: "overflow-wrap",
    reason: "7+ option two-column answers declare overflow-wrap: anywhere",
  },
  {
    selector: ".choice-btn",
    kind: "prop",
    prop: "overflow-wrap",
    reason:
      "single-column answers declare overflow-wrap: anywhere like the two-column variant, so an unbroken " +
      "long answer cannot overflow the button at 1.5x text",
  },
  {
    selector: ".text-input textarea",
    kind: "intrinsic",
    reason:
      "the answer textarea wraps natively (UA white-space: pre-wrap) and scrolls; the text layout caps " +
      "maxlength at 280 characters, so no explicit overflow property is required.",
  },
  {
    selector: ".chat-msg",
    kind: "gap",
    reason:
      "no wrap/ellipsis property; chat messages allow 180 unbroken characters. Only the disabled Blind Date " +
      "Chat game emits the chat layout today (unreachable), so the gap is recorded for when it ships.",
  },
  {
    selector: ".session-podium-row .p",
    kind: "prop",
    prop: "text-overflow",
    reason: "Rumble podium names use overflow: hidden + text-overflow: ellipsis + nowrap",
  },
  {
    selector: ".who",
    kind: "prop",
    prop: "text-overflow",
    reason: "appbar player name uses overflow: hidden + text-overflow: ellipsis",
  },
  {
    selector: ".trophy-row .p",
    kind: "bounded",
    reason:
      "no wrap property, but the content is a platform-capped 12-character name: 12 x ~12.4px at 1.5x " +
      "(22.5px font) is ~149px inside a ~300px row, so it fits without wrapping.",
  },
  {
    selector: ".race-rival",
    kind: "bounded",
    reason:
      "no wrap property; content is a 12-character name plus a tap count and wraps at the space separator — " +
      "the name alone is ~140px at 1.5x inside the ~330px stats bar.",
  },
  {
    selector: ".board-name",
    kind: "gap",
    reason:
      "no wrap/ellipsis property; a 12-character unbroken name at 1.5x (15px font) is ~96px and exceeds the " +
      "~76px tile. Only the disabled Guess Who game emits the board layout today — recorded as a finding for " +
      "the day it is enabled.",
  },
  {
    selector: ".coach",
    kind: "bounded",
    reason:
      "no wrap property; the status line carries platform-capped 12-character names and wraps at spaces — " +
      "12 x ~14px at 1.5x is ~170px inside the ~330px coach row.",
  },
  {
    selector: ".action-hint",
    kind: "bounded",
    reason:
      "no wrap property; 'Waiting for <name>...' wraps at spaces and the name is capped at 12 characters " +
      "(~140px at 1.5x) inside the action column.",
  },
  {
    selector: ".rank-name",
    kind: "prop",
    prop: "overflow-wrap",
    reason:
      "the rank layout's name span declares overflow-wrap: anywhere and flex: 1 1 auto with min-width: 0, so " +
      "a 12-character label or a long Frankenanswers chip wraps inside the slot",
  },
];

function wrapDeclarations(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rulesFor(selector)) {
    for (const key of ["overflow-wrap", "word-break", "text-overflow"]) {
      if (rule.decls[key]) out[key] = rule.decls[key];
    }
  }
  return out;
}

describe("B3: answer/name containers cannot overflow at 1.5x text", () => {
  test("each container shows overflow protection or a documented bound/gap", () => {
    assert.ok(WRAP_ROWS.length >= 10, `wrap audit table looks truncated: ${WRAP_ROWS.length} rows`);
    for (const row of WRAP_ROWS) {
      const label = `wrap ${row.selector}`;
      assert.ok(row.reason.length >= 40, `${label}: every row needs a written reason`);
      const decls = wrapDeclarations(row.selector);

      if (row.noRule) {
        assert.strictEqual(
          rulesFor(row.selector).length,
          0,
          `${label}: a rule now exists — re-review this row as a real container`,
        );
        continue;
      }

      assert.ok(rulesFor(row.selector).length > 0, `${label}: selector not found in the controller CSS`);

      if (row.kind === "prop") {
        const wanted = row.prop!;
        if (wanted === "text-overflow") {
          assert.strictEqual(
            decls["text-overflow"],
            "ellipsis",
            `${label}: expected text-overflow: ellipsis, found "${decls["text-overflow"] ?? "none"}"`,
          );
          assert.ok(
            rulesFor(row.selector).some((rule) => rule.decls["overflow"] === "hidden"),
            `${label}: ellipsis needs overflow: hidden beside it`,
          );
        } else {
          const value = decls["overflow-wrap"] ?? "none";
          assert.notStrictEqual(
            value,
            "normal",
            `${label}: expected a real overflow-wrap value, found "${value}"`,
          );
        }
        continue;
      }

      // intrinsic / bounded / gap rows must NOT already carry the property,
      // so a future change forces this row to be re-classified.
      assert.ok(
        !decls["overflow-wrap"] || decls["overflow-wrap"] === "normal",
        `${label}: overflow-wrap appeared — re-classify this row`,
      );
      assert.ok(!decls["word-break"], `${label}: word-break appeared — re-classify this row`);
      assert.ok(
        decls["text-overflow"] !== "ellipsis",
        `${label}: text-overflow: ellipsis appeared — re-classify this row`,
      );
    }

    // The join name field is the source of the 12-character bound several
    // rows rely on.
    assert.ok(
      CONTROLLER_HTML.includes('id="nameInput"') && CONTROLLER_HTML.includes('maxlength="12"'),
      "the join name input must keep maxlength=12 (several wrap rows depend on the 12-char bound)",
    );
  });
});

// --- B4: inline styles and HTML width attributes ---------------------------

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

describe("B4: controller sources carry no fixed inline width above 360px", () => {
  test("style attributes and width attributes stay within 360px", () => {
    const violations: string[] = [];
    const sources: Array<[string, string]> = [
      ["shared/controllers.ts", CONTROLLER_SRC],
      ["client/controller/main.ts", CONTROLLER_MAIN_SRC],
    ];

    for (const [file, src] of sources) {
      for (const match of src.matchAll(/style="([^"]*)"/g)) {
        const style = match[1];
        for (const px of pxTokens(style)) {
          if (px > 360) {
            violations.push(`${file}:${lineAt(src, match.index ?? 0)}: style="${style}" declares ${px}px`);
          }
        }
      }
      for (const match of src.matchAll(/\bwidth="(\d+)"/g)) {
        const value = Number(match[1]);
        if (value > 360) {
          // The drawing canvas is a bitmap; its CSS width is 100% (asserted below).
          const isDrawSurface =
            value === 600 && /class="draw-surface"[^>]*width="600"/.test(src);
          if (!isDrawSurface) {
            violations.push(`${file}:${lineAt(src, match.index ?? 0)}: width="${value}" exceeds 360px`);
          }
        }
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `inline width audit failures:\n${violations.join("\n")}`,
    );

    assert.ok(
      /\.draw-surface\s*\{[^}]*width:\s*100%/.test(CONTROLLER_HTML),
      "the 600px draw-surface bitmap must stay fluid (CSS width: 100%) so it cannot set layout width",
    );

    // Anti-vacuity: the scan really saw inline styles and a width attribute.
    assert.ok(
      (CONTROLLER_SRC.match(/style="/g) ?? []).length >= 8,
      "expected shared/controllers.ts to contain inline style attributes",
    );
    assert.ok(
      (CONTROLLER_SRC.match(/\bwidth="\d+"/g) ?? []).length >= 1,
      "expected shared/controllers.ts to contain the draw-surface width attribute",
    );
  });
});
