/** Shared cardboard-box podium. */

import { createMox } from "./mox.ts";
import { createToken } from "./tokens.ts";
import { FleckLayer } from "./confetti.ts";
import { sound } from "./sound.ts";
import { enter } from "./motion.ts";

export interface VictoryPlayer {
  name: string;
  points: number;
  index: number;
}

export interface VictoryOptions {
  players: VictoryPlayer[];
  champion: string;
  title?: string;
  onClose?: () => void;
}

export function showVictory(options: VictoryOptions): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "victory";
  const ordered = [...options.players].sort((a, b) => b.points - a.points);
  const top = ordered.slice(0, 3);
  const champion = top.find((p) => p.name === options.champion) ?? top[0];

  overlay.innerHTML = `
    <div class="victory-card">
      <p class="victory-kicker">That's the night</p>
      <h2 class="victory-title">${escapeHtml(options.title ?? "Champion")}</h2>
      <div class="podium"></div>
      <div class="victory-scores"></div>
      <button class="btn-stamp victory-close" type="button">Back to the table</button>
      <div class="victory-mox"></div>
    </div>
  `;

  const podium = overlay.querySelector(".podium")!;
  const heights = [126, 176, 96];
  top.forEach((player, i) => {
    const place = ordered.indexOf(player) + 1;
    const step = document.createElement("div");
    step.className = `podium-step place-${place}`;
    step.style.height = `${heights[i] ?? 90}px`;
    step.style.setProperty("--step-color", "var(--paper)");
    const token = createToken(player.index, player.name, place === 1 ? "winner" : "idle");
    token.classList.add("podium-token");
    step.appendChild(token);
    const tag = document.createElement("span");
    tag.className = "score-tag";
    tag.textContent = `${place}. ${player.name} — ${player.points}`;
    step.appendChild(tag);
    podium.appendChild(step);
  });

  const scores = overlay.querySelector(".victory-scores")!;
  for (const player of ordered) {
    const row = document.createElement("div");
    row.className = "victory-row";
    const name = document.createElement("span");
    name.textContent = player.name;
    const pts = document.createElement("strong");
    pts.textContent = String(player.points);
    row.append(name, pts);
    scores.appendChild(row);
  }

  const moxHost = createMox({ outfit: "party", pitch: 1.16 });
  overlay.querySelector(".victory-mox")!.appendChild(moxHost);
  moxHost.mox.say("That was a night. Look at the state of that podium.", { expression: "celebrate" });

  document.body.appendChild(overlay);
  enter(overlay.querySelector(".victory-card")!, "drop");
  sound.play("win");
  const flecks = new FleckLayer(overlay);
  const rect = overlay.getBoundingClientRect();
  window.setTimeout(() => flecks.burst(rect.width / 2, rect.height * 0.3, 90), 120);
  window.setTimeout(() => {
    flecks.burst(rect.width * 0.25, rect.height * 0.25, 50);
    flecks.burst(rect.width * 0.75, rect.height * 0.25, 50);
  }, 700);

  const close = () => {
    flecks.destroy();
    overlay.remove();
    options.onClose?.();
  };
  overlay.querySelector(".victory-close")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  void champion;
  return overlay;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
