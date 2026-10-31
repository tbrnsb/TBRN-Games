/**
 * Traffic Jam - Server Logic
 * Slide cars to clear a path for the target car (T) to reach the exit.
 * Levels are generated from a solved state with a deterministic random walk,
 * which guarantees they are solvable (every move can be reversed).
 *
 * Controls (private-grid): tap a car to select it, then tap an empty cell in
 * the same row (horizontal car) or column (vertical car) to slide there.
 */

// Types defined inline to avoid import issues with Node type stripping
interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
}

type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand";

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
}

interface RoomState {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: unknown;
}

interface GamePlugin {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}

interface Car {
  id: number;
  row: number;
  col: number;
  len: number;
  horizontal: boolean;
}

interface TrafficState {
  cars: Car[];
  selectedCarId: number | null;
  levelIndex: number;
  phase: "playing" | "solved" | "finished";
  levelTimerMs: number;
  solvedTimerMs: number;
  currentPlayer: number;
  totalMoves: number;
  movesByPlayer: number[];
  scores: number[];
  lastMessage: string | null;
}

interface TrafficInstance extends GameInstance {
  state: TrafficState;
}

const GRID = 6;
const EXIT_ROW = 2; // exit is on the right edge of this row
const LEVEL_TIME_MS = 180000;
const SOLVED_PAUSE_MS = 2500;
const TARGET_ID = 0;
const LABELS = ["T", "1", "2", "3", "4", "5", "6", "7"];

// Solved starting layouts (target car already at the exit, cols 4-5).
const SOLVED_LAYOUTS: Car[][] = [
  [
    { id: 0, row: EXIT_ROW, col: 4, len: 2, horizontal: true },
    { id: 1, row: 0, col: 0, len: 3, horizontal: true },
    { id: 2, row: 1, col: 2, len: 2, horizontal: false },
    { id: 3, row: 3, col: 0, len: 2, horizontal: false },
    { id: 4, row: 4, col: 1, len: 3, horizontal: true },
    { id: 5, row: 5, col: 3, len: 2, horizontal: true },
    { id: 6, row: 0, col: 5, len: 2, horizontal: false },
    { id: 7, row: 3, col: 4, len: 2, horizontal: false },
  ],
  [
    { id: 0, row: EXIT_ROW, col: 4, len: 2, horizontal: true },
    { id: 1, row: 1, col: 0, len: 2, horizontal: false },
    { id: 2, row: 0, col: 0, len: 3, horizontal: true },
    { id: 3, row: 3, col: 1, len: 3, horizontal: true },
    { id: 4, row: 4, col: 0, len: 2, horizontal: false },
    { id: 5, row: 5, col: 2, len: 3, horizontal: true },
    { id: 6, row: 4, col: 4, len: 2, horizontal: true },
    { id: 7, row: 0, col: 5, len: 2, horizontal: false },
  ],
];

const LEVEL_SEEDS = [12345, 67890];
const LEVEL_WALKS = [45, 70]; // random moves away from the solved state

// --- Deterministic PRNG (identical across platforms) ---
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function cellsOf(car: Car): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < car.len; i++) {
    cells.push(car.horizontal ? { row: car.row, col: car.col + i } : { row: car.row + i, col: car.col });
  }
  return cells;
}

function occupancy(cars: Car[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of cars) {
    for (const cell of cellsOf(c)) map.set(`${cell.row},${cell.col}`, c.id);
  }
  return map;
}

/** Can this car move `steps` cells in `dir` (-1 back / +1 forward)? Returns new position or null. */
function trySlide(cars: Car[], car: Car, dir: -1 | 1, steps: number): { row: number; col: number } | null {
  const occ = occupancy(cars.filter((c) => c.id !== car.id));
  let row = car.row;
  let col = car.col;
  for (let s = 0; s < steps; s++) {
    row += car.horizontal ? 0 : dir;
    col += car.horizontal ? dir : 0;
    // Bounds.
    if (row < 0 || col < 0) return null;
    if (car.horizontal && col + car.len > GRID) return null;
    if (!car.horizontal && row + car.len > GRID) return null;
    // Destination cells must be free.
    const probe = { ...car, row, col };
    for (const cell of cellsOf(probe)) {
      if (occ.has(`${cell.row},${cell.col}`)) return null;
    }
  }
  return { row, col };
}

/** Random walk away from the solved state. Reverse-order undo is always legal. */
function generateLevel(levelIndex: number): Car[] {
  const cars: Car[] = SOLVED_LAYOUTS[levelIndex % SOLVED_LAYOUTS.length].map((c) => ({ ...c }));
  const rnd = lcg(LEVEL_SEEDS[levelIndex % LEVEL_SEEDS.length]);
  const walk = LEVEL_WALKS[levelIndex % LEVEL_WALKS.length];
  for (let m = 0; m < walk; m++) {
    const car = cars[Math.floor(rnd() * cars.length)];
    const dir: -1 | 1 = rnd() < 0.5 ? -1 : 1;
    const steps = 1 + Math.floor(rnd() * 3);
    const next = trySlide(cars, car, dir, steps);
    if (next) {
      car.row = next.row;
      car.col = next.col;
    }
  }
  return cars;
}

function isSolved(cars: Car[]): boolean {
  const target = cars.find((c) => c.id === TARGET_ID);
  return !!target && target.col + target.len >= GRID;
}

const manifest: GameManifest = {
  id: "trafficjam",
  name: "Traffic Jam",
  minPlayers: 1,
  maxPlayers: 4,
  controllerType: "private-grid",
  description: "Slide cars to clear a path for the target car (T) to exit. Tap a car, then tap where it should slide.",
};

function buildCells(state: TrafficState): string[][] {
  const occ = occupancy(state.cars);
  const cells: string[][] = [];
  for (let r = 0; r < GRID; r++) {
    const row: string[] = [];
    for (let c = 0; c < GRID; c++) {
      const id = occ.get(`${r},${c}`);
      if (id === undefined) {
        row.push("");
      } else {
        const car = state.cars.find((x) => x.id === id)!;
        const label = LABELS[car.id] ?? "?";
        row.push(state.selectedCarId === car.id ? `[${label}]` : label);
      }
    }
    cells.push(row);
  }
  return cells;
}

function loadLevel(state: TrafficState, levelIndex: number): void {
  state.cars = generateLevel(levelIndex);
  state.selectedCarId = null;
  state.phase = "playing";
  state.levelTimerMs = LEVEL_TIME_MS;
  state.totalMoves = 0;
  state.lastMessage = null;
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): TrafficInstance {
    const instance: TrafficInstance = {
      roomId: room.id,
      players,
      state: {
        cars: [],
        selectedCarId: null,
        levelIndex: 0,
        phase: "playing",
        levelTimerMs: LEVEL_TIME_MS,
        solvedTimerMs: 0,
        currentPlayer: 0,
        totalMoves: 0,
        movesByPlayer: players.map(() => 0),
        scores: players.map(() => 0),
        lastMessage: null,
      },
    };
    loadLevel(instance.state, 0);
    return instance;
  },

  onInput(instance: TrafficInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase !== "playing") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex !== state.currentPlayer) return;

    const grid = (input as { grid?: { row?: number; col?: number } } | null)?.grid;
    if (!grid || typeof grid.row !== "number" || typeof grid.col !== "number") return;
    const { row, col } = grid;
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) return;

    const occ = occupancy(state.cars);
    const tappedId = occ.get(`${row},${col}`) ?? null;

    if (state.selectedCarId === null) {
      // Tap a car to select it.
      if (tappedId !== null) state.selectedCarId = tappedId;
      return;
    }

    const selected = state.cars.find((c) => c.id === state.selectedCarId);
    if (!selected) {
      state.selectedCarId = null;
      return;
    }

    if (tappedId === selected.id) {
      // Tap the same car again to deselect.
      state.selectedCarId = null;
      return;
    }

    if (tappedId !== null) {
      // Tap another car: switch selection.
      state.selectedCarId = tappedId;
      return;
    }

    // Empty cell: must lie on the car's row (horizontal) or column (vertical).
    const axisOk = selected.horizontal ? row === selected.row : col === selected.col;
    if (!axisOk) {
      state.selectedCarId = null;
      return;
    }

    // Compute the slide: front moves to the tapped cell, or back moves to it.
    let targetPos: { row: number; col: number } | null = null;
    if (selected.horizontal) {
      if (col > selected.col + selected.len - 1) {
        targetPos = { row: selected.row, col: col - selected.len + 1 };
      } else if (col < selected.col) {
        targetPos = { row: selected.row, col };
      }
    } else {
      if (row > selected.row + selected.len - 1) {
        targetPos = { row: row - selected.len + 1, col: selected.col };
      } else if (row < selected.row) {
        targetPos = { row, col: selected.col };
      }
    }
    if (!targetPos) {
      state.selectedCarId = null;
      return;
    }

    const steps =
      selected.horizontal
        ? Math.abs(targetPos.col - selected.col)
        : Math.abs(targetPos.row - selected.row);
    const dir: -1 | 1 = selected.horizontal
      ? targetPos.col > selected.col ? 1 : -1
      : targetPos.row > selected.row ? 1 : -1;

    const moved = trySlide(state.cars, selected, dir, steps);
    if (!moved) {
      // Path blocked: keep the car selected so the player can try another way.
      return;
    }

    selected.row = moved.row;
    selected.col = moved.col;
    state.selectedCarId = null;
    state.totalMoves++;
    state.movesByPlayer[playerIndex]++;

    if (isSolved(state.cars)) {
      const points = Math.max(20, 140 - state.totalMoves * 4);
      state.scores[playerIndex] += points;
      state.lastMessage = `${instance.players[playerIndex].name} cleared the jam! +${points}`;
      state.phase = "solved";
      state.solvedTimerMs = SOLVED_PAUSE_MS;
    } else {
      // Hot-seat: the move is complete, pass control to the next player.
      state.currentPlayer = (state.currentPlayer + 1) % instance.players.length;
    }
  },

  onTick(instance: TrafficInstance, deltaMs: number): void {
    const state = instance.state;
    if (state.phase === "finished") return;

    if (state.phase === "solved") {
      state.solvedTimerMs -= deltaMs;
      if (state.solvedTimerMs <= 0) {
        if (state.levelIndex + 1 >= LEVEL_WALKS.length) {
          state.phase = "finished";
        } else {
          state.levelIndex++;
          state.currentPlayer = (state.currentPlayer + 1) % instance.players.length;
          loadLevel(state, state.levelIndex);
        }
      }
      return;
    }

    if (state.phase === "playing") {
      state.levelTimerMs -= deltaMs;
      if (state.levelTimerMs <= 0) {
        state.lastMessage = "Time's up!";
        state.phase = "solved";
        state.solvedTimerMs = SOLVED_PAUSE_MS;
      }
    }
  },

  screenState(instance: TrafficInstance): unknown {
    const state = instance.state;
    return {
      phase: state.phase,
      cells: buildCells(state),
      level: state.levelIndex + 1,
      totalLevels: LEVEL_WALKS.length,
      timeLeft: Math.max(0, state.levelTimerMs),
      moves: state.totalMoves,
      currentPlayer: state.currentPlayer,
      lastMessage: state.lastMessage,
      scores: instance.players.map((p, i) => ({ name: p.name, score: state.scores[i] })),
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: TrafficInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    const selected = state.cars.find((c) => c.id === state.selectedCarId);
    return {
      rows: GRID,
      cols: GRID,
      cells: buildCells(state),
      isYourTurn: playerIndex === state.currentPlayer && state.phase === "playing",
      hint: selected
        ? "Tap an empty cell in its row/column to slide"
        : "Tap a car to select it",
      level: state.levelIndex + 1,
      totalLevels: LEVEL_WALKS.length,
      timeLeft: Math.max(0, state.levelTimerMs),
      moves: state.totalMoves,
      yourScore: state.scores[playerIndex],
      lastMessage: state.lastMessage,
      finished: state.phase === "finished",
      youWon: state.phase === "finished" ? getWinner(instance)?.name === instance.players[playerIndex].name : false,
    };
  },
};

function getWinner(instance: TrafficInstance): { name: string; score: number } | null {
  const state = instance.state;
  let best = -1;
  let idx = -1;
  state.scores.forEach((s, i) => {
    if (s > best) {
      best = s;
      idx = i;
    }
  });
  if (idx >= 0) return { name: instance.players[idx].name, score: best };
  return null;
}

export default plugin;
