/**
 * Snakes - Server Logic
 * Classic snake game with dpad controls
 */

/**
 * Snakes - Server Logic
 * Classic snake game with dpad controls
 */

import { secureRandomInt } from "../../shared/secure-random.ts";

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

interface SnakeState { snakes: Snake[]; food: Food[]; gridSize: number; phase: "playing" | "finished"; _tickAccum?: number; }
interface Snake { body: Segment[]; dir: number; nextDir: number; alive: boolean; score: number; color: string; }
interface Segment { x: number; y: number; }
interface Food { x: number; y: number; }
interface SnakeInstance extends GameInstance { state: SnakeState; }

const GRID = 20; const INITIAL_LEN = 3; const SPEED = 8; // moves per second
const COLORS = ["#ff6b6b", "#4ecdc4", "#ffe66d", "#95e1d3"];
const DIRS = [{dx:0,dy:-1},{dx:1,dy:0},{dx:0,dy:1},{dx:-1,dy:0}]; // up, right, down, left

const manifest: GameManifest = { id: "snakes", name: "Snakes", minPlayers: 1, maxPlayers: 4, controllerType: "dpad", description: "Classic snake - eat food, grow longer, don't hit walls or yourself!" };

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): SnakeInstance {
    const snakes: Snake[] = players.map((_, i) => {
      const startX = Math.floor(GRID * 0.2) + i * 2; const startY = Math.floor(GRID / 2);
      const body: Segment[] = []; for(let k=0;k<INITIAL_LEN;k++) body.push({x:startX-k,y:startY});
      return { body, dir: 1, nextDir: 1, alive: true, score: 0, color: COLORS[i % COLORS.length] };
    });
    return { roomId: room.id, players, state: { snakes, food: [], gridSize: GRID, phase: "playing" } };
  },
  onInput(instance: SnakeInstance, playerId: string, input: unknown): void {
    const state = instance.state; const playerIndex = instance.players.findIndex(p => p.id === playerId); if (playerIndex === -1) return;
    const move = input as { move?: string }; const snake = state.snakes[playerIndex]; if (!snake.alive) return;
    let newDir = snake.dir; if (move?.move === "up") newDir = 0; else if (move?.move === "right") newDir = 1; else if (move?.move === "down") newDir = 2; else if (move?.move === "left") newDir = 3;
    // Prevent 180 turn
    if ((newDir + 2) % 4 !== snake.dir) snake.nextDir = newDir;
  },
  onTick(instance: SnakeInstance, deltaMs: number): void {
    const state = instance.state; if (state.phase !== "playing") return;
    const tickInterval = 1000 / SPEED; state._tickAccum = (state._tickAccum || 0) + deltaMs;
    if (state._tickAccum < tickInterval) return; state._tickAccum = 0;

    // Spawn food
    if (state.food.length < state.snakes.filter(s => s.alive).length * 2) { spawnFood(state); }

    state.snakes.forEach((snake, i) => {
      if (!snake.alive) return;
      snake.dir = snake.nextDir;
      const head = snake.body[0]; const d = DIRS[snake.dir];
      const newHead = { x: (head.x + d.dx + GRID) % GRID, y: (head.y + d.dy + GRID) % GRID };

      // Self collision
      if (snake.body.some(s => s.x === newHead.x && s.y === newHead.y)) { snake.alive = false; return; }
      // Other snakes collision
      state.snakes.forEach((s, j) => { if (i !== j && s.alive && s.body.some(seg => seg.x === newHead.x && seg.y === newHead.y)) snake.alive = false; });

      snake.body.unshift(newHead);
      // Food collision
      const foodIdx = state.food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
      if (foodIdx >= 0) { snake.score += 10; state.food.splice(foodIdx, 1); } else { snake.body.pop(); }
    });

    // Check all dead
    if (state.snakes.every(s => !s.alive)) state.phase = "finished";
  },
  screenState(instance: SnakeInstance): unknown { const state = instance.state; return { snakes: state.snakes.map(s => ({ body: s.body, color: s.color, alive: s.alive, score: s.score })), food: state.food, gridSize: state.gridSize, phase: state.phase, scores: instance.players.map((p,i) => ({ name: p.name, score: state.snakes[i].score, alive: state.snakes[i].alive })), finished: state.phase === "finished", winner: state.phase === "finished" ? getWinner(instance) : null }; },
  controllerState(instance: SnakeInstance, playerId: string): unknown { const state = instance.state; const playerIndex = instance.players.findIndex(p => p.id === playerId); const snake = state.snakes[playerIndex]; return { body: snake.body, color: snake.color, alive: snake.alive, score: snake.score, gridSize: state.gridSize, finished: state.phase === "finished", youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false }; }
};

function spawnFood(state: SnakeState): void {
  const occupied = new Set<string>();
  state.snakes.forEach(s => s.body.forEach(seg => occupied.add(`${seg.x},${seg.y}`)));
  state.food.forEach(f => occupied.add(`${f.x},${f.y}`));
  let x = 0, y = 0, attempts = 0;
  do { x = secureRandomInt(0, state.gridSize); y = secureRandomInt(0, state.gridSize); attempts++; } while (occupied.has(`${x},${y}`) && attempts < 500);
  if (occupied.has(`${x},${y}`)) return; // board is full: nothing left to eat
  state.food.push({ x, y });
}
function getWinner(instance: SnakeInstance): { name: string; score: number } | null { const state = instance.state; let best = -1, idx = -1; state.snakes.forEach((s,i) => { if (s.score > best) { best = s.score; idx = i; } }); if (idx >= 0) return { name: instance.players[idx].name, score: best }; return null; }

export default plugin;