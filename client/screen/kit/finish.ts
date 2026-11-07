/**
 * One finish celebration for every game.
 *
 * The eight legacy renderers already own a victory screen. The paper-board
 * games, Bracket, Mind Meld and Percentile did not, so a finished game just
 * froze on its last board. This helper draws the shared paper victory overlay
 * from whichever score table the screen state publishes.
 */

import { updateParticles } from "./particles.ts";
import {
  buildRankedEntries,
  createVictoryScreen,
  drawVictoryScreen,
  showVictoryScreen,
  updateVictoryScreen,
  type VictoryScreen,
} from "./victory.ts";

interface ScoreRow {
  name: string;
  score: number;
}

let victory: VictoryScreen | null = null;
let victoryKey = "";
let lastNow = 0;

function rowsFromState(state: Record<string, unknown>): ScoreRow[] {
  const raw = Array.isArray(state.scores)
    ? state.scores
    : Array.isArray(state.players)
      ? state.players
      : [];
  const rows: ScoreRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const score = typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (score === null || !name) continue;
    rows.push({ name, score });
  }
  return rows;
}

function winnerNameFromState(state: Record<string, unknown>, rows: ScoreRow[]): string {
  const winner = state.winner;
  if (typeof winner === "string" && winner.trim()) return winner.trim();
  if (winner && typeof winner === "object") {
    const name = (winner as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return sorted[0]?.name ?? "";
}

/**
 * Draw the finish celebration when the game is over. Returns true when it drew
 * the overlay, so the caller can skip the underlying board for that frame.
 */
export function drawFinishVictory(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: unknown,
  gameName: string,
  scoreSuffix = "pts",
): boolean {
  const record = (state ?? {}) as Record<string, unknown>;
  if (record.finished !== true) {
    victory = null;
    victoryKey = "";
    lastNow = 0;
    return false;
  }

  const rows = rowsFromState(record);
  if (rows.length === 0) return false;
  const winnerName = winnerNameFromState(record, rows);
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const nextKey = `${gameName}|${winnerName}|${sorted.map((r) => `${r.name}:${r.score}`).join(",")}`;
  const now = performance.now();

  if (!victory || victoryKey !== nextKey) {
    // Pass the seat-order rows: buildRankedEntries preserves each playerIndex
    // for the seat colour while it sorts the display order.
    const rankings = buildRankedEntries(rows, winnerName);
    const winner = rankings.find((entry) => entry.isWinner) ?? rankings[0];
    if (!winner) return false;
    victory = createVictoryScreen({
      winner,
      rankings,
      gameName,
      duration: 0,
      scoreSuffix,
    });
    victoryKey = nextKey;
    showVictoryScreen(victory, now, width, height);
    lastNow = now;
  }

  const dt = lastNow ? Math.min(now - lastNow, 100) : 16;
  lastNow = now;
  updateParticles(dt);
  updateVictoryScreen(victory, now, dt);
  drawVictoryScreen(ctx, width, height, victory);
  return true;
}
