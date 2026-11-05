/**
 * Most Likely To - Server Logic
 * Vote on who's most likely to do something
 */

import { secureShuffle } from "../../shared/secure-random.ts";

interface GameManifest { id: string; name: string; minPlayers: number; maxPlayers: number; controllerType: ControllerType; description: string; }
type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand"
  | "slider"
  | "dual-slider"
  | "pad"
  | "aim"
  | "tap-race"
  | "board"
  | "numpad"
  | "canvas"
  | "chat";
interface Player { id: string; name: string; joinedAt: number; rejoinToken: string; connected: boolean; controllerType?: string; }
interface RoomState { id: string; code: string; hostPlayerId: string | null; players: Player[]; gameId: string | null; gameState: unknown | null; createdAt: number; status: "lobby" | "playing" | "finished"; }
interface GameInstance { roomId: string; players: Player[]; state: unknown; }
interface GamePlugin { manifest: GameManifest; onStart(room: RoomState, players: Player[]): GameInstance; onInput(instance: GameInstance, playerId: string, input: unknown): void; onTick(instance: GameInstance, deltaMs: number): void; screenState(instance: GameInstance): unknown; controllerState(instance: GameInstance, playerId: string): unknown; }

interface MostLikelyState {
  prompts: string[]; currentPrompt: number; phase: "voting" | "reveal" | "finished";
  votes: Map<number, Map<string, string>>; // promptIndex -> voterId -> targetId
  scores: number[]; timeLeft: number; roundWinner: number | null;
}
interface MostLikelyInstance extends GameInstance { state: MostLikelyState; }

const PROMPTS = [
  "Most likely to become a billionaire", "Most likely to survive a zombie apocalypse",
  "Most likely to accidentally reply all", "Most likely to get lost in their own city",
  "Most likely to adopt 10 cats", "Most likely to win a hot dog eating contest",
  "Most likely to forget their own birthday", "Most likely to talk their way out of a ticket",
  "Most likely to start a cult", "Most likely to become a meme",
  "Most likely to sleep through an earthquake", "Most likely to cry at a commercial",
  "Most likely to accidentally send a text to the wrong person", "Most likely to win at Vegas",
  "Most likely to have a secret talent", "Most likely to become a superhero",
  "Most likely to survive on a deserted island", "Most likely to talk to animals",
  "Most likely to invent something useless", "Most likely to become a dictator"
];
const VOTE_TIME = 15000; const REVEAL_TIME = 4000; const ROUNDS = 8;

const manifest: GameManifest = { id: "mostlikely", name: "Most Likely To", minPlayers: 3, maxPlayers: 4, controllerType: "choice", description: "Vote on who's most likely to do something. Anonymous voting, reveal results." };

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): MostLikelyInstance {
    const shuffled = secureShuffle(PROMPTS).slice(0, ROUNDS);
    return { roomId: room.id, players, state: { prompts: shuffled, currentPrompt: 0, phase: "voting", votes: new Map(), scores: players.map(() => 0), timeLeft: VOTE_TIME, roundWinner: null } };
  },
  onInput(instance: MostLikelyInstance, playerId: string, input: unknown): void {
    const state = instance.state; if (state.phase !== "voting") return;
    const voterIndex = instance.players.findIndex(p => p.id === playerId); if (voterIndex === -1) return;
    const choice = input as { choice?: string }; if (!choice?.choice) return;
    const targetIndex = parseInt(choice.choice); if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= instance.players.length) return;
    if (!state.votes.has(state.currentPrompt)) state.votes.set(state.currentPrompt, new Map());
    state.votes.get(state.currentPrompt)!.set(playerId, instance.players[targetIndex].id);
  },
  onTick(instance: MostLikelyInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "voting") {
      state.timeLeft -= deltaMs;
      if (state.timeLeft <= 0) { state.phase = "reveal"; state.timeLeft = REVEAL_TIME; scoreRound(state, instance.players); }
    } else if (state.phase === "reveal") {
      state.timeLeft -= deltaMs;
      if (state.timeLeft <= 0) {
        state.currentPrompt++; if (state.currentPrompt >= state.prompts.length) { state.phase = "finished"; return; }
        state.phase = "voting"; state.timeLeft = VOTE_TIME; state.roundWinner = null;
      }
    }
  },
  screenState(instance: MostLikelyInstance): unknown {
    const state = instance.state; const prompt = state.prompts[state.currentPrompt];
    const voteCounts = new Map<string, number>(); state.votes.get(state.currentPrompt)?.forEach(targetId => { voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1); });
    return { prompt, currentPrompt: state.currentPrompt + 1, totalPrompts: state.prompts.length, phase: state.phase, timeLeft: Math.max(0, state.timeLeft), players: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })), votes: state.phase === "reveal" ? Array.from(voteCounts.entries()).map(([id, count]) => ({ name: instance.players.find(p => p.id === id)?.name, count })) : null, finished: state.phase === "finished", winner: state.phase === "finished" ? getWinner(instance) : null };
  },
  controllerState(instance: MostLikelyInstance, playerId: string): unknown {
    const state = instance.state; const voterIndex = instance.players.findIndex(p => p.id === playerId);
    const hasVoted = state.votes.get(state.currentPrompt)?.has(playerId) ?? false;
    const options = instance.players.map((p, i) => ({ id: String(i), label: p.name }));
    return { prompt: state.prompts[state.currentPrompt], options, hasVoted, yourScore: state.scores[voterIndex], timeLeft: Math.max(0, state.timeLeft), phase: state.phase, currentPrompt: state.currentPrompt + 1, totalPrompts: state.prompts.length, finished: state.phase === "finished", youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[voterIndex].name : false };
  }
};

function scoreRound(state: MostLikelyState, players: Player[]): void {
  const votes = state.votes.get(state.currentPrompt); if (!votes) return;
  const counts = new Map<string, number>(); votes.forEach(targetId => { counts.set(targetId, (counts.get(targetId) || 0) + 1); });
  let max = 0, winnerId = ""; counts.forEach((count, id) => { if (count > max) { max = count; winnerId = id; } });
  if (winnerId) { const winnerIdx = players.findIndex(p => p.id === winnerId); if (winnerIdx >= 0) { state.scores[winnerIdx] += max * 10; state.roundWinner = winnerIdx; } }
}
function getWinner(instance: MostLikelyInstance): { name: string; score: number } | null { const state = instance.state; let best = -1, idx = -1; state.scores.forEach((s,i) => { if (s > best) { best = s; idx = i; } }); if (idx >= 0) return { name: instance.players[idx].name, score: best }; return null; }

export default plugin;