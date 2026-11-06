/**
 * Knife Throw - Server Logic
 * Tap to throw knives at rotating target
 */

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

interface KnifeState { angle: number; knives: Knife[]; currentPlayer: number; knivesPerPlayer: number; scores: number[]; round: number; maxRounds: number; phase: "playing" | "finished"; }
interface Knife { playerIndex: number; angle: number; round: number; }
interface KnifeInstance extends GameInstance { state: KnifeState; }

const ROTATION_SPEED = 0.5; const KNIVES_PER_ROUND = 5; const ROUNDS = 3;

const manifest: GameManifest = { id: "knifethrow", name: "Knife Throw", minPlayers: 1, maxPlayers: 4, controllerType: "one-button", description: "Tap to throw knives at rotating target. Don't hit existing knives!" };

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): KnifeInstance {
    return { roomId: room.id, players, state: { angle: 0, knives: [], currentPlayer: 0, knivesPerPlayer: KNIVES_PER_ROUND, scores: players.map(() => 0), round: 0, maxRounds: ROUNDS, phase: "playing" } };
  },
  onInput(instance: KnifeInstance, playerId: string, input: unknown): void {
    const state = instance.state; if (state.phase === "finished") return;
    const playerIndex = instance.players.findIndex(p => p.id === playerId); if (playerIndex !== state.currentPlayer) return;
    const tap = input as { tap?: boolean }; if (!tap?.tap) return;
    if (state.knivesPerPlayer <= 0) return;
    const knifeAngle = state.angle; let hit = false;
    state.knives.forEach(k => { const diff = Math.abs(k.angle - knifeAngle); if (diff < 0.15 || diff > Math.PI * 2 - 0.15) hit = true; });
    if (hit) { state.scores[playerIndex] -= 5; } else { state.scores[playerIndex] += 10; }
    state.knives.push({ playerIndex, angle: knifeAngle, round: state.round }); state.knivesPerPlayer--;
    if (state.knivesPerPlayer <= 0) {
      // state.round counts completed player-turns, so the match is over only
      // after every player has thrown maxRounds sets of knives.
      state.round++;
      state.knivesPerPlayer = KNIVES_PER_ROUND;
      if (state.round >= state.maxRounds * instance.players.length) {
        state.phase = "finished";
      } else {
        state.currentPlayer = (state.currentPlayer + 1) % instance.players.length;
      }
    }
  },
  onTick(instance: KnifeInstance, deltaMs: number): void { instance.state.angle = (instance.state.angle + ROTATION_SPEED * deltaMs / 1000) % (Math.PI * 2); },
  screenState(instance: KnifeInstance): unknown { const state = instance.state; return { angle: state.angle, knives: state.knives, currentPlayer: state.currentPlayer, round: Math.min(state.maxRounds, Math.floor(state.round / instance.players.length) + 1), maxRounds: state.maxRounds, knivesLeft: state.knivesPerPlayer, scores: instance.players.map((p,i) => ({ name: p.name, score: state.scores[i] })), finished: state.phase === "finished", winner: state.phase === "finished" ? getWinner(instance) : null }; },
  controllerState(instance: KnifeInstance, playerId: string): unknown { const state = instance.state; const playerIndex = instance.players.findIndex(p => p.id === playerId); return { angle: state.angle, isYourTurn: playerIndex === state.currentPlayer && state.phase !== "finished", knivesLeft: state.knivesPerPlayer, yourScore: state.scores[playerIndex], round: Math.min(state.maxRounds, Math.floor(state.round / instance.players.length) + 1), maxRounds: state.maxRounds, finished: state.phase === "finished", youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false }; }
};

function getWinner(instance: KnifeInstance): { name: string; score: number } | null { const state = instance.state; let best = -1, idx = -1; state.scores.forEach((s,i) => { if (s > best) { best = s; idx = i; } }); if (idx >= 0) return { name: instance.players[idx].name, score: best }; return null; }

export default plugin;