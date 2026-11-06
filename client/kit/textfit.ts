/** Mandatory text-fit helpers for player-written text. */

export interface FitOptions {
  min?: number;
  max?: number;
  step?: number;
  lineHeight?: number;
}

/** Shrink font-size until the element fits, then return the size used. */
export function fitText(el: HTMLElement, options: FitOptions = {}): number {
  const min = options.min ?? 14;
  const max = options.max ?? 64;
  const step = options.step ?? 1;
  const lineHeight = options.lineHeight;
  const parentWidth = el.parentElement?.clientWidth ?? el.clientWidth;
  const parentHeight = el.parentElement?.clientHeight ?? el.clientHeight;
  let lo = min;
  let hi = max;
  let best = min;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (lineHeight) el.style.lineHeight = `${Math.round(mid * lineHeight)}px`;
    const fits =
      el.scrollWidth <= Math.max(1, parentWidth) + 1 &&
      el.scrollHeight <= Math.max(1, parentHeight) + 1;
    if (fits) {
      best = mid;
      lo = mid + step;
    } else {
      hi = mid - step;
    }
  }
  el.style.fontSize = `${best}px`;
  if (lineHeight) el.style.lineHeight = `${Math.round(best * lineHeight)}px`;
  return best;
}

/**
 * Canvas text fit. Returns a font size that keeps `text` inside `maxWidth`.
 * For multi-line text, pass a `measure` that accounts for wrapping.
 */
export function fitCanvasFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  family: string,
  weight = 700,
  max = 64,
  min = 14,
): number {
  let size = max;
  while (size > min) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  return min;
}

/** Wrap text into lines that fit maxWidth. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else if (line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = word;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (consumed < words.length) {
    let last = lines[lines.length - 1] ?? "";
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}
