/** A ratcheting score counter: counts up with small ticks, then stamps. */

import { sound } from "./sound.ts";
import { stamp } from "./motion.ts";

export class RatchetCounter {
  readonly el: HTMLElement;
  private current = 0;
  private raf = 0;

  constructor(initial = 0, className = "ratchet") {
    this.el = document.createElement("span");
    this.el.className = className;
    this.el.textContent = String(initial);
    this.current = initial;
  }

  set(value: number, options: { duration?: number; tick?: boolean } = {}) {
    const from = this.current;
    const to = value;
    this.current = value;
    cancelAnimationFrame(this.raf);
    if (from === to) {
      this.el.textContent = String(to);
      return;
    }
    const duration = options.duration ?? 600;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (to - from) * eased);
      this.el.textContent = String(v);
      if (t < 1) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.el.textContent = String(to);
        if (options.tick !== false) {
          sound.play("stamp");
          stamp(this.el);
        }
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}
