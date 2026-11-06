/** Snappy paper motion. All helpers respect prefers-reduced-motion. */

import { MOTION } from "./theme.ts";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function enter(el: Element, style: "slide-tilt" | "stamp" | "drop" | "unfold" | "curtain" = "slide-tilt", delay = 0) {
  if (!(el instanceof HTMLElement) || prefersReducedMotion()) return;
  const frames: Keyframe[] =
    style === "stamp"
      ? [{ transform: "scale(1.5) rotate(-4deg)", opacity: 0.4 }, { transform: "scale(1) rotate(0)", opacity: 1 }]
      : style === "drop"
        ? [{ transform: "translateY(-30px) rotate(-3deg)", opacity: 0 }, { transform: "translateY(0) rotate(0)", opacity: 1 }]
        : style === "unfold"
          ? [{ transform: "scaleY(0.05) rotate(-2deg)", opacity: 0.2 }, { transform: "scaleY(1) rotate(0)", opacity: 1 }]
          : style === "curtain"
            ? [{ transform: "translateX(-24px) rotate(-2deg)", opacity: 0 }, { transform: "translateX(0) rotate(0)", opacity: 1 }]
            : [{ transform: "translateY(18px) rotate(-2deg)", opacity: 0 }, { transform: "translateY(0) rotate(0)", opacity: 1 }];
  el.animate(frames, {
    duration: style === "stamp" ? MOTION.stamp : MOTION.enter,
    delay,
    easing: style === "stamp" ? "cubic-bezier(.2,.9,.2,1.3)" : "cubic-bezier(.16,1,.3,1)",
    fill: "both",
  });
}

export function stamp(el: HTMLElement) {
  if (prefersReducedMotion()) return;
  el.animate(
    [{ transform: "scale(1.5)", opacity: 0.6 }, { transform: "scale(1)", opacity: 1 }],
    { duration: MOTION.stamp, easing: "cubic-bezier(.2,.9,.2,1.3)" },
  );
}

export function shake(el: HTMLElement, amount = MOTION.shake) {
  if (prefersReducedMotion()) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i < 6; i++) {
    const d = amount * (1 - i / 6);
    frames.push({ transform: `translate(${i % 2 ? d : -d}px, ${i % 3 ? d / 2 : 0}px)` });
  }
  frames.push({ transform: "translate(0,0)" });
  el.animate(frames, { duration: 200, easing: "steps(6)" });
}

/** Stop-motion idle wobble. Returns a cleanup function. */
export function wobble(el: HTMLElement, amount = MOTION.wobble): () => void {
  if (prefersReducedMotion()) return () => {};
  let raf = 0;
  let last = 0;
  let sign = 1;
  const tick = (now: number) => {
    if (now - last > 160) {
      last = now;
      sign = -sign;
      el.style.transform = `rotate(${sign * amount}deg)`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    el.style.transform = "";
  };
}

export function stagger(els: Element[], style: "slide-tilt" | "stamp" | "drop" = "slide-tilt") {
  els.forEach((el, i) => enter(el, style, i * MOTION.stagger));
}
