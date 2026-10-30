import { GamePlugin, GameManifest, GameInstance } from "../shared/types.ts";

export { GamePlugin, GameManifest, GameInstance };

export interface PluginLoader {
  loadAll(): Map<string, GamePlugin>;
  get(id: string): GamePlugin | undefined;
}

export function createPluginLoader(_gamesDir: string): PluginLoader {
  const plugins = new Map<string, GamePlugin>();

  // TODO: Dynamic import from gamesDir at runtime
  // For now, manual registration

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