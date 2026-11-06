/** Canvas ink flecks and paper confetti, hard-capped at 250 live particles. */

import { prefersReducedMotion } from "./motion.ts";

interface Fleck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  life: number;
}

export class FleckLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private flecks: Fleck[] = [];
  private raf = 0;
  private dpr = 1;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "fleck-layer";
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", this.resize);
    this.raf = requestAnimationFrame(this.tick);
  }

  private resize = () => {
    this.dpr = devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
  };

  burst(x: number, y: number, count = 24, colors: string[] = ["#FF5BA7", "#FFC21A", "#0E8C8C", "#2447C8", "#1D1B26"]) {
    if (prefersReducedMotion()) return;
    const room = Math.max(0, 250 - this.flecks.length);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 220;
      this.flecks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        size: 3 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
      });
    }
  }

  private tick = (now: number) => {
    const dt = 1 / 60;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    this.flecks = this.flecks.filter((f) => {
      f.life -= dt * 0.9;
      if (f.life <= 0) return false;
      f.vy += 420 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      this.ctx.save();
      this.ctx.translate(f.x, f.y);
      this.ctx.rotate(f.rot);
      this.ctx.globalAlpha = Math.max(0, f.life);
      this.ctx.fillStyle = f.color;
      this.ctx.fillRect(-f.size / 2, -f.size / 4, f.size, f.size / 2);
      this.ctx.restore();
      return true;
    });
    this.raf = requestAnimationFrame(this.tick);
    void now;
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.canvas.remove();
  }
}
