/**
 * Gravity Run - Server Logic
 * Tap to flip gravity, avoid obstacles, collect coins
 */

interface GameManifest { id: string; name: string; minPlayers: number; maxPlayers: number; controllerType: ControllerType; description: string; }
type ControllerType = "one-button" | "left-right" | "dpad" | "text" | "choice" | "private-grid" | "card-hand";
interface Player { id: string; name: string; joinedAt: number; rejoinToken: string; connected: boolean; controllerType?: string; }
interface RoomState { id: string; code: string; hostPlayerId: string | null; players: Player[]; gameId: string | null; gameState: unknown | null; createdAt: number; status: "lobby" | "playing" | "finished"; }
interface GameInstance { roomId: string; players: Player[]; state: unknown; }
interface GamePlugin { manifest: GameManifest; onStart(room: RoomState, players: Player[]): GameInstance; onInput(instance: GameInstance, playerId: string, input: unknown): void; onTick(instance: GameInstance, deltaMs: number): void; screenState(instance: GameInstance): unknown; controllerState(instance: GameInstance, playerId: string): unknown; }

interface GravityState {
  players: GravityPlayer[]; obstacles: Obstacle[]; coins: Coin[];
  scrollSpeed: number; distance: number; phase: "playing" | "finished"; timeLeft: number;
}
interface GravityPlayer { x: number; y: number; vy: number; gravity: 1 | -1; alive: boolean; score: number; coins: number; }
interface Obstacle { x: number; y: number; w: number; h: number; type: "block" | "spike"; }
interface Coin { x: number; y: number; collected: boolean; }
interface GravityInstance extends GameInstance { state: GravityState; }

const GRAVITY = 25; const JUMP_VEL = -12; const SCROLL_SPEED = 8; const SPAWN_RATE = 1.5; const GAME_TIME = 60000;
const PLAYER_W = 0.04; const PLAYER_H = 0.04; const GROUND_Y = 0.85;

const manifest: GameManifest = { id: "gravityrun", name: "Gravity Run", minPlayers: 1, maxPlayers: 4, controllerType: "one-button", description: "Tap to flip gravity. Avoid obstacles, collect coins. Endless runner with gravity flip!" };

const plugin: GamePlugin = {
  manifest,
  onStart(room: RoomState, players: Player[]): GravityInstance {
    const gravityPlayers: GravityPlayer[] = players.map(() => ({ x: 0.15, y: GROUND_Y - PLAYER_H, vy: 0, gravity: 1, alive: true, score: 0, coins: 0 }));
    return { roomId: room.id, players, state: { players: gravityPlayers, obstacles: [], coins: [], scrollSpeed: SCROLL_SPEED, distance: 0, phase: "playing", timeLeft: GAME_TIME } };
  },
  onInput(instance: GravityInstance, playerId: string, input: unknown): void {
    const state = instance.state; const playerIndex = instance.players.findIndex(p => p.id === playerId); if (playerIndex === -1) return;
    const tap = input as { tap?: boolean }; if (!tap?.tap) return;
    const p = state.players[playerIndex]; if (!p.alive) return;
    p.gravity *= -1; p.vy = JUMP_VEL * p.gravity;
  },
  onTick(instance: GravityInstance, deltaMs: number): void {
    const state = instance.state; const dt = deltaMs / 1000;
    if (state.phase !== "playing") return;
    state.timeLeft -= deltaMs;
    if (state.timeLeft <= 0) {
      // Survivors bank their distance at the buzzer.
      state.players.forEach(p => { if (p.alive) p.score += Math.floor(state.distance); });
      state.phase = "finished";
      return;
    }
    state.distance += state.scrollSpeed * dt; state.scrollSpeed += 0.01 * dt;

    // Update players
    state.players.forEach(p => {
      if (!p.alive) return;
      p.vy += GRAVITY * p.gravity * dt; p.y += p.vy * dt;
      if (p.gravity === 1 && p.y >= GROUND_Y - PLAYER_H) { p.y = GROUND_Y - PLAYER_H; p.vy = 0; }
      if (p.gravity === -1 && p.y <= 0.05) { p.y = 0.05; p.vy = 0; }
    });

    // Spawn obstacles/coins
    if (Math.random() < SPAWN_RATE * dt) {
      const isTop = Math.random() < 0.5;
      const y = isTop ? 0.0 : 0.5;
      state.obstacles.push({ x: 1.1, y, w: 0.06, h: 0.45, type: Math.random() < 0.3 ? "spike" : "block" });
    }
    if (Math.random() < 0.8 * dt) { state.coins.push({ x: 1.1, y: 0.3 + Math.random() * 0.5, collected: false }); }

    // Move obstacles/coins
    state.obstacles.forEach(o => o.x -= state.scrollSpeed * dt);
    state.coins.forEach(c => c.x -= state.scrollSpeed * dt);

    // Collision
    state.players.forEach(p => {
      if (!p.alive) return;
      // Obstacles
      state.obstacles.forEach(o => {
        if (p.x < o.x + o.w && p.x + PLAYER_W > o.x && p.y < o.y + o.h && p.y + PLAYER_H > o.y) {
          p.alive = false;
          p.score += Math.floor(state.distance);
        }
      });
      // Coins
      state.coins.forEach(c => {
        if (!c.collected && p.x < c.x + 0.03 && p.x + PLAYER_W > c.x && p.y < c.y + 0.03 && p.y + PLAYER_H > c.y) {
          c.collected = true; p.coins++; p.score += 50;
        }
      });
    });

    // Cleanup
    state.obstacles = state.obstacles.filter(o => o.x > -0.1);
    state.coins = state.coins.filter(c => c.x > -0.1 && !c.collected);

    // Check all dead
    if (state.players.every(p => !p.alive)) { state.phase = "finished"; }
  },
  screenState(instance: GravityInstance): unknown {
    const state = instance.state;
    return { players: state.players.map(p => ({ x: p.x, y: p.y, gravity: p.gravity, alive: p.alive, score: p.score, coins: p.coins })), obstacles: state.obstacles, coins: state.coins.filter(c => !c.collected), scrollSpeed: state.scrollSpeed, distance: Math.floor(state.distance), timeLeft: Math.max(0, state.timeLeft), phase: state.phase, scores: instance.players.map((p, i) => ({ name: p.name, score: state.players[i].score, coins: state.players[i].coins })), finished: state.phase === "finished", winner: state.phase === "finished" ? getWinner(instance) : null };
  },
  controllerState(instance: GravityInstance, playerId: string): unknown {
    const state = instance.state; const playerIndex = instance.players.findIndex(p => p.id === playerId);
    const p = state.players[playerIndex]; return { x: p.x, y: p.y, gravity: p.gravity, alive: p.alive, yourScore: p.score, coins: p.coins, distance: Math.floor(state.distance), timeLeft: Math.max(0, state.timeLeft), phase: state.phase, finished: state.phase === "finished", youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false };
  }
};

function getWinner(instance: GravityInstance): { name: string; score: number } | null { const state = instance.state; let best = -1, idx = -1; state.players.forEach((p,i) => { if (p.score > best) { best = p.score; idx = i; } }); if (idx >= 0) return { name: instance.players[idx].name, score: best }; return null; }

export default plugin;