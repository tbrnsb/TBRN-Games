# HANDOFF.md — TBRN-Games

**Updated:** 2026-10-31
**Last commit:** (pending)
**Phase:** F0 Setup → F1 Engine Core (in progress)
**Step:** Foundation files created, server running, lint passing, tests connecting

---

## Done
- Machine setup complete: Omarchy (Arch), no sudo, Node 26.8.1 via mise, git, curl, gh, nvim, code present
- GitHub auth: `tbrnsb` logged in (gh CLI, SSH protocol)
- Repo created & cloned: `github.com/tbrnsb/TBRN-Games` (public, MIT)
- Per-repo git identity set: `tbrnsb` / `tbrnsb@users.noreply.github.com`
- OpenCode v2.2.3 installed with NVIDIA, OpenRouter, Groq, Mistral providers
- Project foundation files created:
  - `AGENTS.md` — project rules, cross-platform rules, review checklist, handoff protocol
  - `HANDOFF.md` — this file
  - `.githooks/pre-commit` — rejects commits without HANDOFF.md
  - `.github/workflows/ci.yml` — tests on Ubuntu + Windows + HANDOFF.md check
  - `package.json`, `tsconfig.json`, `.eslintrc.json` → `eslint.config.js`, `.gitattributes`, `.nvmrc`, `.gitignore`
  - `shared/types.ts` — message types, constants
  - `shared/constants.js` — runtime constants (MESSAGE_TYPES, getLanUrls)
  - `shared/theme.ts` — design tokens (palette, font, spacing, motion)
  - `server/index.ts` — HTTP + WebSocket server, room management, join/reconnect, dummy tap-counter plugin
  - `server/plugins.ts` — plugin loader interface
  - `client/screen/index.html` + `main.ts` — lobby QR, game canvas
  - `client/controller/index.html` + `main.ts` — join form, 7 controller types
  - `tests/bot-client.ts` — simulated phone clients
  - `tests/server.test.ts` — integration tests (4 bots join, reconnect, game state)
  - `docs/opencode-prompts/f0-f1-foundation.md` — OpenCode prompt for F0/F1
- Lint passes (5 warnings only)
- Server starts and serves HTTP + WS on port 3000
- LAN URLs detected: `http://192.168.1.75:3000`
- Tests connect to server (4 bots join successfully)

---

## In Progress
- F1 Engine Core: WebSocket server, room management, QR join, lobby, reconnect, plugin loader, bot test clients
- Server runs but game loop not fully integrated (tests timeout waiting for gameState)
- Reconnect logic needs fix (new bot gets new playerId instead of restoring)

---

## Next 3 Actions
1. Complete F1 engine: integrate game loop (60fps tick), broadcast gameState to all players
2. Fix reconnect: restore player by rejoinToken, preserve playerId
3. Start tap-counter game from lobby (host clicks "Start Game" → loads plugin → calls onStart → broadcasts gameState)
4. Run tests again, verify all pass

---

## How to Run & Test
```bash
cd /home/sulav/TBRN-Games
npm install          # Install dependencies
npm run lint         # Lint (passes with 5 warnings)
npm start            # Start server (port 3000)
# In another terminal:
npm test             # Run integration tests (connect to running server)
# Test from phone: http://192.168.1.75:3000 (screen) or /controller
```

---

## Failing Tests / Known Issues
- Test "4 bots can join and receive room state": timeout waiting for ROOM_STATE broadcast after join
- Test "bot can reconnect with rejoin token": new bot gets new playerId instead of restoring original
- Test "tap-counter game: bots can send inputs and receive game state": timeout waiting for GAME_STATE (game not started)
- Server game loop not broadcasting gameState periodically
- `/api/lan-urls` works, QR code generation uses external API (qrserver.com)

---

## Decisions Made
- Node 26 (via mise), TypeScript, native `.ts` execution with `--experimental-strip-types`
- MIT license for code, separate license for content packs
- 4 players max, plugin architecture, privacy-enforced server
- Runtime constants in `shared/constants.js` (JS), types in `shared/types.ts` (TS) — avoids Node type-stripping limitations
- ESLint flat config with relaxed rules for client code (DOM APIs)
- Controller types: one-button, left-right, dpad, text, choice, private-grid, card-hand
- Builder = Nemotron 3 Ultra, Reviewer = Nemotron 3.5 Lightning (same family, user override)

---

## Open Questions for Human
1. QR code: use external API (qrserver.com) or local generation (qrcode npm package)?
2. HTTPS for keep-screen-awake: self-signed cert + trust on phone, or no-sleep JS trick (Wake Lock API)?
3. Theme file format: current TS module with helpers — OK, or prefer JSON/CSS custom properties?
4. F0 scope: current scaffolding complete, or add more (game plugin skeleton, more test coverage)?