/**
 * Sea Battle - Server Logic
 * Battleship for 2-4: place your fleet privately, then fire by tapping the
 * enemy grid. Hit keeps your turn; a fully sunk fleet eliminates that player.
 *
 * Controller layout (private-grid, 20 rows x 10 cols):
 *   rows 0-9   = your own board (S ship, X hit, o miss)
 *   rows 10-19 = the enemy board you are firing at (tap to fire)
 * The target is always the next player still afloat, clockwise.
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

type CellState = "empty" | "ship" | "hit" | "miss";
interface Cell {
  state: CellState;
  shipIndex: number; // -1 when no ship
}

type ShipType = "carrier" | "battleship" | "cruiser" | "submarine" | "destroyer";
const SHIP_TYPES: ShipType[] = ["carrier", "battleship", "cruiser", "submarine", "destroyer"];
const SHIP_SIZES: Record<ShipType, number> = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };

interface Ship {
  type: ShipType;
  cells: number[];
  hits: number;
  sunk: boolean;
}

interface PlayerBoard {
  cells: Cell[]; // 100
  fleet: Ship[];
  eliminated: boolean;
}

interface LastShot {
  shooter: string;
  target: string;
  row: number;
  col: number;
  hit: boolean;
}

interface SeaBattleState {
  boards: PlayerBoard[];
  phase: "placing" | "playing" | "finished";
  placingIndex: number; // who is placing right now
  placingShipIndex: number; // which ship of the fleet
  currentPlayer: number; // whose turn to fire
  scores: number[];
  lastShot: LastShot | null;
}

interface SeaBattleInstance extends GameInstance {
  state: SeaBattleState;
}

const GRID = 10;
const ROWS_WITH_ENEMY = 20;

const manifest: GameManifest = {
  id: "seabattle",
  name: "Sea Battle",
  minPlayers: 2,
  maxPlayers: 4,
  controllerType: "private-grid",
  description: "Place your fleet, take turns firing. Sink every enemy ship. Classic battleship for 2-4!",
};

function emptyBoard(): PlayerBoard {
  return {
    cells: Array.from({ length: GRID * GRID }, () => ({ state: "empty" as CellState, shipIndex: -1 })),
    fleet: [],
    eliminated: false,
  };
}

function livingPlayers(state: SeaBattleState): number[] {
  const out: number[] = [];
  state.boards.forEach((b, i) => {
    if (!b.eliminated) out.push(i);
  });
  return out;
}

function nextLiving(state: SeaBattleState, from: number): number {
  const n = state.boards.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (!state.boards[i].eliminated) return i;
  }
  return -1;
}

function allShipsSunk(board: PlayerBoard): boolean {
  return board.fleet.length > 0 && board.fleet.every((s) => s.sunk);
}

const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[]): SeaBattleInstance {
    return {
      roomId: room.id,
      players,
      state: {
        boards: players.map(() => emptyBoard()),
        phase: "placing",
        placingIndex: 0,
        placingShipIndex: 0,
        currentPlayer: 0,
        scores: players.map(() => 0),
        lastShot: null,
      },
    };
  },

  onInput(instance: SeaBattleInstance, playerId: string, input: unknown): void {
    const state = instance.state;
    if (state.phase === "finished") return;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return;

    const grid = (input as { grid?: { row?: number; col?: number } } | null)?.grid;
    if (!grid || typeof grid.row !== "number" || typeof grid.col !== "number") return;
    const { row, col } = grid;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (col < 0 || col >= GRID) return;

    if (state.phase === "placing") {
      if (playerIndex !== state.placingIndex) return;
      if (row < 0 || row >= GRID) return;
      placeShip(state, instance, playerIndex, row, col);
      return;
    }

    // Battle: taps on the enemy half (rows 10-19) fire at (row-10, col).
    if (playerIndex !== state.currentPlayer) return;
    if (row < GRID || row >= ROWS_WITH_ENEMY) return;
    fireAt(state, instance, playerIndex, row - GRID, col);
  },

  onTick(_instance: SeaBattleInstance, _deltaMs: number): void {
    // Turn-based: no timers needed.
  },

  screenState(instance: SeaBattleInstance): unknown {
    const state = instance.state;
    return {
      phase: state.phase,
      grid: GRID,
      rows: ROWS_WITH_ENEMY,
      turnName:
        state.phase === "placing"
          ? instance.players[state.placingIndex].name
          : state.phase === "playing"
            ? instance.players[state.currentPlayer].name
            : null,
      placingName: state.phase === "placing" ? instance.players[state.placingIndex].name : null,
      targetName:
        state.phase === "playing"
          ? instance.players[nextLiving(state, state.currentPlayer)].name
          : null,
      players: instance.players.map((p, i) => ({
        name: p.name,
        shipsLeft: state.boards[i].fleet.filter((s) => !s.sunk).length,
        totalShips: SHIP_TYPES.length,
        eliminated: state.boards[i].eliminated,
        score: state.scores[i],
      })),
      lastShot: state.lastShot,
      finished: state.phase === "finished",
      winner: state.phase === "finished" ? getWinner(instance) : null,
    };
  },

  controllerState(instance: SeaBattleInstance, playerId: string): unknown {
    const state = instance.state;
    const playerIndex = instance.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) return { phase: state.phase, finished: state.phase === "finished" };
    const me = state.boards[playerIndex];

    // 20 x 10 view: top = my board, bottom = the enemy I'm firing at.
    const enemyIndex = nextLiving(state, playerIndex);
    const enemy = state.boards[enemyIndex];
    const cells: string[][] = [];
    for (let r = 0; r < GRID; r++) {
      const row: string[] = [];
      for (let c = 0; c < GRID; c++) {
        const cell = me.cells[r * GRID + c];
        row.push(
          cell.state === "ship" ? "S" : cell.state === "hit" ? "X" : cell.state === "miss" ? "o" : "",
        );
      }
      cells.push(row);
    }
    if (state.phase === "playing" && !me.eliminated) {
      for (let r = 0; r < GRID; r++) {
        const row: string[] = [];
        for (let c = 0; c < GRID; c++) {
          const cell = enemy.cells[r * GRID + c];
          row.push(cell.state === "hit" ? "X" : cell.state === "miss" ? "o" : "");
        }
        cells.push(row);
      }
    } else {
      for (let r = 0; r < GRID; r++) cells.push(Array(GRID).fill(""));
    }

    const placingShip = SHIP_TYPES[state.placingShipIndex];
    const isPlacing = state.phase === "placing" && state.placingIndex === playerIndex;

    return {
      rows: ROWS_WITH_ENEMY,
      cols: GRID,
      cells,
      phase: state.phase,
      yourTurn:
        (state.phase === "placing" && isPlacing) ||
        (state.phase === "playing" && state.currentPlayer === playerIndex),
      info:
        state.phase === "placing"
          ? isPlacing
            ? `Place: ${placingShip} (${SHIP_SIZES[placingShip]} cells) — tap start cell (horizontal first)`
            : `Waiting for ${instance.players[state.placingIndex].name} to place…`
          : state.phase === "playing"
            ? state.currentPlayer === playerIndex
              ? `Your turn — tap the lower grid to fire at ${instance.players[enemyIndex].name}`
              : `${instance.players[state.currentPlayer].name} is firing…`
            : "Game over",
      targetName: state.phase === "playing" ? instance.players[enemyIndex].name : null,
      myShipsLeft: me.fleet.filter((s) => !s.sunk).length,
      enemyShipsLeft: state.phase === "playing" ? enemy.fleet.filter((s) => !s.sunk).length : SHIP_TYPES.length,
      eliminated: me.eliminated,
      yourScore: state.scores[playerIndex],
      finished: state.phase === "finished",
      youWon: state.phase === "finished" && getWinner(instance)?.name === instance.players[playerIndex].name,
    };
  },
};

function placeShip(
  state: SeaBattleState,
  instance: SeaBattleInstance,
  playerIndex: number,
  row: number,
  col: number,
): void {
  const board = state.boards[playerIndex];
  const shipType = SHIP_TYPES[state.placingShipIndex];
  if (!shipType || board.fleet.length >= SHIP_TYPES.length) return;
  const size = SHIP_SIZES[shipType];

  // Prefer horizontal; fall back to vertical when horizontal does not fit.
  let cells: number[] = [];
  let horizontal = true;
  const horizontalOk = col + size <= GRID;
  if (horizontalOk) {
    const probe: number[] = [];
    for (let i = 0; i < size; i++) probe.push(row * GRID + col + i);
    if (probe.every((idx) => board.cells[idx].state === "empty")) cells = probe;
  }
  if (cells.length === 0 && row + size <= GRID) {
    horizontal = false;
    const probe: number[] = [];
    for (let i = 0; i < size; i++) probe.push((row + i) * GRID + col);
    if (probe.every((idx) => board.cells[idx].state === "empty")) cells = probe;
  }
  if (cells.length === 0) return; // invalid placement: ignore

  for (const idx of cells) board.cells[idx] = { state: "ship", shipIndex: board.fleet.length };
  board.fleet.push({ type: shipType, cells, hits: 0, sunk: false });
  void horizontal;

  state.placingShipIndex++;
  if (state.placingShipIndex >= SHIP_TYPES.length) {
    state.placingShipIndex = 0;
    state.placingIndex++;
    if (state.placingIndex >= instance.players.length) {
      state.phase = "playing";
      state.currentPlayer = nextLiving(state, instance.players.length - 1);
    }
  }
}

function fireAt(
  state: SeaBattleState,
  instance: SeaBattleInstance,
  shooterIndex: number,
  row: number,
  col: number,
): void {
  const targetIndex = nextLiving(state, shooterIndex);
  if (targetIndex === -1 || targetIndex === shooterIndex) return;
  const target = state.boards[targetIndex];
  const idx = row * GRID + col;
  const cell = target.cells[idx];
  if (!cell || cell.state === "hit" || cell.state === "miss") return;

  const shooterName = instance.players[shooterIndex].name;
  const targetName = instance.players[targetIndex].name;

  if (cell.state === "ship") {
    cell.state = "hit";
    const ship = target.fleet[cell.shipIndex];
    state.scores[shooterIndex] += 10;
    let sunkBonus = 0;
    if (ship) {
      ship.hits++;
      if (ship.hits >= ship.cells.length && !ship.sunk) {
        ship.sunk = true;
        sunkBonus = 15;
        state.scores[shooterIndex] += sunkBonus;
      }
    }
    state.lastShot = { shooter: shooterName, target: targetName, row, col, hit: true };

    if (allShipsSunk(target)) {
      target.eliminated = true;
      state.scores[shooterIndex] += 100;
      const living = livingPlayers(state);
      if (living.length === 1) {
        state.phase = "finished";
      } else {
        // Shooter keeps the turn and fires at the next living player.
      }
    }
    // Hit: shooter fires again (turn unchanged).
  } else {
    cell.state = "miss";
    state.lastShot = { shooter: shooterName, target: targetName, row, col, hit: false };
    state.currentPlayer = nextLiving(state, shooterIndex);
  }
}

function getWinner(instance: SeaBattleInstance): { name: string; score: number } | null {
  const state = instance.state;
  const living = livingPlayers(state);
  if (living.length === 1) {
    return { name: instance.players[living[0]].name, score: state.scores[living[0]] };
  }
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
