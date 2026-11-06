/** Reusable paper-craft props: tape, pins, clips, stamps, stickers, notes. */

export interface PropOptions {
  x?: string;
  y?: string;
  size?: number;
  rotate?: number;
  opacity?: number;
}

const PROP_FILES: Record<string, string> = {
  tape: "/assets/props/tape.svg",
  pin: "/assets/props/pin.svg",
  paperclip: "/assets/props/paperclip.svg",
  stamp: "/assets/props/stamp.svg",
  "coffee-ring": "/assets/props/coffee-ring.svg",
  "torn-edge": "/assets/props/torn-edge.svg",
  star: "/assets/props/star.svg",
  scribble: "/assets/props/scribble.svg",
  fold: "/assets/props/fold.svg",
};

export function prop(name: keyof typeof PROP_FILES | string, options: PropOptions = {}): HTMLImageElement {
  const img = document.createElement("img");
  img.src = PROP_FILES[name] ?? PROP_FILES.tape;
  img.alt = "";
  img.className = `prop prop-${name}`;
  img.style.position = "absolute";
  img.style.pointerEvents = "none";
  img.style.left = options.x ?? "0";
  img.style.top = options.y ?? "0";
  if (options.size) img.style.width = `${options.size}px`;
  if (options.rotate) img.style.transform = `rotate(${options.rotate}deg)`;
  if (options.opacity !== undefined) img.style.opacity = String(options.opacity);
  return img;
}

/** Deterministic pseudo-random from a string, so props do not jump on re-render. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 0xffffffff;
  };
}

/** Scatter 3+ props around a container. Container must be position: relative. */
export function addProps(container: HTMLElement, names: string[], seed = "paper") {
  const rnd = seeded(seed);
  const slots = [
    { x: "-2%", y: "4%", r: -8, size: 120 },
    { x: "82%", y: "10%", r: 11, size: 110 },
    { x: "6%", y: "88%", r: 5, size: 90 },
    { x: "76%", y: "82%", r: -6, size: 100 },
    { x: "44%", y: "-2%", r: 3, size: 130 },
  ];
  names.slice(0, 4).forEach((name, i) => {
    const s = slots[i % slots.length];
    container.appendChild(
      prop(name, {
        x: s.x,
        y: s.y,
        size: s.size * (0.85 + rnd() * 0.3),
        rotate: s.r + (rnd() - 0.5) * 10,
        opacity: 0.75 + rnd() * 0.25,
      }),
    );
  });
}

export function stickyNote(text: string, color = "var(--ink-2)"): HTMLElement {
  const note = document.createElement("div");
  note.className = "sticky-note";
  note.style.background = color;
  note.textContent = text;
  return note;
}

export function rubberStamp(text: string, options: { color?: string; rotate?: number } = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = "rubber-stamp";
  el.textContent = text;
  if (options.color) el.style.color = options.color;
  el.style.transform = `rotate(${options.rotate ?? -6}deg)`;
  return el;
}

export function tapeAcross(el: HTMLElement, options: { top?: string; left?: string; rotate?: number } = {}) {
  const img = prop("tape", {
    x: options.left ?? "50%",
    y: options.top ?? "-10px",
    size: 150,
    rotate: options.rotate ?? -4,
  });
  img.style.transform = `translateX(-50%) rotate(${options.rotate ?? -4}deg)`;
  el.appendChild(img);
}

export function scribbleUnderline(el: HTMLElement) {
  const img = prop("scribble", { x: "10%", y: "92%", size: 180, rotate: -2 });
  img.style.width = "80%";
  el.appendChild(img);
}
