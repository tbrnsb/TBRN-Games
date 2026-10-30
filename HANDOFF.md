# HANDOFF.md — TBRN-Games

**Updated:** 2026-10-31
**Last commit:** F1: Engine core complete - WebSocket server, rooms, QR join, lobby, reconnect, plugin loader, game loop, bot tests
**Phase:** F1 Engine Core ✓ (done gate passed)
**Step:** All tests passing, lint clean, ready for F2

---

## Done
- Machine setup complete: Omarchy (Arch), no sudo, Node 26.8.1 via mise, git, curl, gh, nvim, code present
- GitHub auth: `tbrnsb` logged in (gh CLI, SSH protocol)
- Repo created & cloned: `github.com/tbrnsb/TBRN-Games` (public, MIT)
- Per-repo git identity set: `tbrnsb` / `tbrnsb@users.noreply.github.com`
- OpenCode v2.2.3 installed with NVIDIA, OpenRouter, Groq, Mistral providers
- Project foundation files created (AGENTS.md, HANDOFF.md, .githooks/pre-commit, .github/workflows/ci.yml, package.json, tsconfig.json, eslint.config.js, .gitattributes, .nvmrc, .gitignore)
- `shared/types.ts` — message types, constants
- `shared/constants.js` — runtime constants (MESSAGE_TYPES, getLanUrls)
- `shared/theme.ts` — design tokens (palette, font, spacing, motion)
- `server/index.ts` — HTTP + WebSocket server with:
  - Room management (create, join, leave, cleanup)
  - Join flow with rejoin tokens (persist player seat on reconnect)
  - QR join via `/api/lan-urls` + QR code generation
  - Lobby state: player list, host can start game via `POST /api/rooms/:id/start`
  - Game loop (60fps tick) broadcasting GAME_STATE to all players
  - Plugin loader with dummy "tap-counter" plugin
  - Privacy: controllerState per player, screenState shared
- `server/plugins.ts` — plugin loader interface
- `client/screen/index.html` + `main.ts` — lobby QR, game canvas rendering
- `client/controller/index.html` + `main.ts` — join form, 7 controller types (one-button, left-right, dpad, text, choice, private-grid, card-hand)
- `tests/bot-client.ts` — simulated phone clients with auto-reconnect
- `tests/server.test.ts` — 3 integration tests passing:
  1. 4 bots join same room, receive roomState with 4 players
  2. Bot reconnects with rejoin token, restores same playerId
  3. Host starts tap-counter game, bots send inputs, receive gameState
- `docs/opencode-prompts/f0-f1-foundation.md` — OpenCode prompt for F0/F1
- Lint passes (7 warnings only, 0 errors)
- All 3 tests pass
- Pushed to GitHub

---

## In Progress
- F1 Engine Core complete — ready for F2 Controller Kit

---

## Next 3 Actions
1. F2 Controller Kit: implement all 7 controller layouts with proper rendering
2. F2 Screen basics: scoreboard, turn banner, game selection UI
3. G1 Darts: first real game (1-4 players, one-button, turn flow, timing, scoring)

---

## How to Run & Test
```bash
cd /home/sulav/Projects/TBRN-Games
npm install          # Install dependencies
npm run lint         # Lint (passes with 7 warnings)
npm start            # Start server (port 3000)
# In another terminal:
npm test             # Run integration tests (connect to running server)
# Test from phone: http://192.168.1.75:3000 (screen) or /controller
```

---

## Failing Tests / Known Issues
- None — all tests pass

---

## Decisions Made
- Node 26 (via mise), TypeScript, native `.ts` execution
- MIT license for code, separate license for content packs
- 4 players max, plugin architecture, privacy-enforced server
- Runtime constants in `shared/constants.js` (JS), types in `shared/types.ts` (TS)
- ESLint flat config with relaxed rules for client code (DOM APIs)
- Controller types: one-button, left-right, dpad, text, choice, private-grid, card-hand
- Builder = Nemotron 3 Ultra, Reviewer = Nemotron 3.5 Lightning (same family, user override)
- Game loop runs at ~60fps (16ms interval) broadcasting to all connected players

---

## Open Questions for Human
1. QR code: use external API (qrserver.com) or local generation (qrcode npm package)?
2. HTTPS for keep-screen-awake: self-signed cert + trust on phone, or no-sleep JS trick (Wake Lock API)?
3. Theme file format: current TS module with helpers — OK, or prefer JSON/CSS custom properties?
4. F2 scope: implement all 7 controller layouts with shared components, or minimal for G1?