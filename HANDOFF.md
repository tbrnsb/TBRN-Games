# HANDOFF.md — TBRN-Games

**Updated:** 2026-10-31
**Last commit:** G1: Darts game complete - first real game implementation
**Phase:** G1 Darts ✓ (done gate passed)
**Step:** All tests passing, lint clean, ready for G2 Quiz

---

## Done
- Machine setup complete: Omarchy (Arch), no sudo, Node 26.8.1 via mise, git, curl, gh, nvim, code present
- GitHub auth: `tbrnsb` logged in (gh CLI, SSH protocol)
- Repo created & cloned: `github.com/tbrnsb/TBRN-Games` (public, MIT)
- Per-repo git identity set: `tbrnsb` / `tbrnsb@users.noreply.github.com`
- OpenCode v2.2.3 installed with NVIDIA, OpenRouter, Groq, Mistral providers
- **F0 Setup**: Project scaffolding, lint/test scripts, theme, CI, git hooks
- **F1 Engine Core**: WebSocket server, rooms, join/reconnect, lobby, game loop, plugin loader, bot tests
- **F2 Controller Kit**: 7 reusable controller layouts with shared rendering
- **G1 Darts** (1-4 players, one-button): 
  - Turn flow (3 darts per turn, 501 scoring)
  - Dartboard rendering with sectors, rings, bullseye
  - Score panel with current player highlight
  - Random throw simulation on tap
  - Win detection (exact 0)
- Dynamic plugin loader: auto-discovers games from `games/<name>/server.ts`
- Tests: 3 integration tests passing (join, reconnect, darts game input/state)
- Lint: 0 errors, 7 warnings
- Pushed to GitHub

---

## In Progress
- G1 Darts complete — ready for G2 Quiz

---

## Next 3 Actions
1. **G2 Quiz** (1-4 players, choose answer): content packs, speed scoring, answer reveal
2. **G3 Archery** (1-4, one-button): timing-based mechanics, moving target
3. **G4 Golf** (1-4, one-button): multi-round scoring, power meter

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
- Shared controller layouts in `shared/controllers.ts` with registry pattern
- Plugin types inlined in `server/plugins.ts` and game servers to avoid Node type-stripping issues

---

## Open Questions for Human
1. QR code: use external API (qrserver.com) or local generation (qrcode npm package)?
2. HTTPS for keep-screen-awake: self-signed cert + trust on phone, or no-sleep JS trick (Wake Lock API)?
3. Theme file format: current TS module with helpers — OK, or prefer JSON/CSS custom properties?
4. G2 Quiz scope: question packs from JSON, timed answers, score by speed + correctness?