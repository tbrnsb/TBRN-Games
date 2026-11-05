import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DropoutPolicy, GameKind, GameScale, ScaleMode } from "../shared/game-catalog.ts";
import type { GameResult } from "../shared/scoring.ts";

// Plugin types defined locally to avoid import issues with Node type stripping
export interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
  howTo?: string;
  // Platform metadata, merged from shared/game-catalog.ts at load time.
  displayName?: string;
  enabled?: boolean;
  kind?: GameKind;
  idealMin?: number;
  idealMax?: number;
  minutes?: { standalone: number; rumble: number };
  dropoutPolicy?: DropoutPolicy;
  contentPacks?: string[];
  scale?: (playerCount: number, mode: ScaleMode) => GameScale;
}

export type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand";

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  presence: "active" | "away" | "left";
  spectator?: boolean;
  controllerType?: string;
}

export interface RoomState<TGameState extends object = object> {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: TGameState | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

export interface GameInstance<TState extends object = object> {
  roomId: string;
  players: Player[];
  state: TState;
}

export interface GamePlugin<
  TState extends object = object,
  TInput = unknown,
  TScreenState = unknown,
  TControllerState = unknown
> {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance<TState>;
  onInput(instance: GameInstance<TState>, playerId: string, input: TInput): void;
  onTick(instance: GameInstance<TState>, deltaMs: number): void;
  screenState(instance: GameInstance<TState>): TScreenState;
  controllerState(instance: GameInstance<TState>, playerId: string): TControllerState;
  /** Optional host-token control for the running game (authenticated by the server). */
  onHostAction?(instance: GameInstance<TState>, action: string): boolean;
  /** Optional per-game standings and stats; the platform extracts a fallback. */
  results?(instance: GameInstance<TState>): GameResult;
}

export interface PluginLoader {
  loadAll(): Map<string, GamePlugin<any, any, any, any>>;
  get(id: string): GamePlugin<any, any, any, any> | undefined;
}

export async function createPluginLoader(gamesDir: string): Promise<PluginLoader> {
  const plugins = new Map<string, GamePlugin>();

  // Auto-discover and load plugins from games/<name>/server.ts
  async function loadPlugins() {
    if (!existsSync(gamesDir)) return;

    const gameDirs = readdirSync(gamesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const gameName of gameDirs) {
      const serverPath = join(gamesDir, gameName, "server.ts");
      if (!existsSync(serverPath)) continue;

      try {
        const module = await import(`file://${serverPath}`);
        const plugin = module.default;
        if (plugin && plugin.manifest) {
          plugins.set(plugin.manifest.id, plugin);
          console.log(`[Plugin] Loaded: ${plugin.manifest.name} (${plugin.manifest.id})`);
        }
      } catch (e) {
        console.error(`[Plugin] Failed to load ${gameName}:`, e);
      }
    }
  }

  await loadPlugins();

  return {
    loadAll() {
      return plugins;
    },
    get(id: string) {
      return plugins.get(id);
    },
  };
}

export function registerPlugin(_plugin: GamePlugin): void {
  // Used by games/<name>/server.ts to self-register
  // In production, plugins auto-register on import
}