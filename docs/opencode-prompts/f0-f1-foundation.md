# OpenCode Prompt: F0 Setup + F1 Engine Core

## Context
You are the **Builder** (coder subagent) for TBRN-Games. Implement F0 and F1 phases per AGENTS.md and HANDOFF.md.

**Repo**: `/home/sulav/TBRN-Games` (already initialized with package.json, tsconfig, eslint, gitattributes, nvmrc, AGENTS.md, HANDOFF.md, .githooks/pre-commit, .github/workflows/ci.yml)

**Current state**: Hello-world HTTP server exists at `server/index.ts` (port 3000, serves `/` and `/api/health`). Run with `npm start`.

---

## F0: Setup — Repo Scaffolding

### Acceptance Criteria
- [ ] Full folder structure exists (see AGENTS.md Architecture section)
- [ ] `npm run lint` passes (eslint + tsconfig strict)
- [ ] `npm test` runs (node --test) — at least 1 passing test
- [ ] Theme file created: `shared/theme.ts` with palette, font, spacing tokens
- [ ] Client HTML skeletons: `client/screen/index.html`, `client/controller/index.html`
- [ ] QR code generation helper (use `qrcode` npm package or simple SVG)
- [ ] `.gitignore` covers node_modules, dist, .env, *.log
- [ ] README.md updated with project description and run instructions

### Tasks
1. Create missing folders: `games/`, `packs/`, `docs/`, `client/screen/`, `client/controller/`
2. Create `shared/theme.ts` — single palette (8 colors), font stack, spacing scale (4px base), border radius, motion tokens (duration, easing)
3. Create `client/screen/index.html` — minimal HTML with canvas, loads `/client/screen/main.js`
4. Create `client/controller/index.html` — minimal HTML with button area, loads `/client/controller/main.js`
5. Create `client/screen/main.ts` and `client/controller/main.ts` — TypeScript entry points (connect WS, handle messages)
4. Add `qrcode` to package.json devDependencies
5. Update README.md
6. Run lint + test, fix any issues

---

## F1: Engine Core — WebSocket Server, Rooms, QR Join, Lobby, Reconnect, Plugin Loader, Bot Clients

### Acceptance Criteria
- [ ] WebSocket server running on same port as HTTP (upgrade)
- [ ] Room creation with 5-char code, max 4 players
- [ ] Join flow: phone enters name → gets rejoin token → receives roomState
- [ ] QR code shown on screen with room URL + code as text fallback
- [ ] Lobby state: player list, host can start game
- [ ] Reconnect: locked phone reopens page → enters with token → restored to seat
- [ ] Plugin loader: scans `games/` directory, loads `manifest.json` + `server.ts`
- [ ] Dummy plugin "tap-counter" works (already stubbed in server/index.ts)
- [ ] Bot test clients: 4 bots join, send inputs, receive gameState, reconnect after disconnect
- [ ] Ping/pong heartbeat (15s interval, 30s timeout)
- [ ] All messages typed via `shared/types.ts`

### Tasks
1. **WebSocket upgrade** — `server/index.ts` already uses `ws` package. Verify it works.
2. **Room manager** — `server/rooms.ts`: createRoom, joinRoom, leaveRoom, getRoom, cleanupEmptyRooms
3. **QR code endpoint** — `GET /api/qr/:roomId` returns SVG QR code for room URL
4. **Lobby protocol** — Host sees "Start Game" button; phones see "Waiting for host..."
5. **Game start flow** — Host picks game → server loads plugin → calls `onStart` → broadcasts `gameState`
6. **Plugin loader** — `server/plugins.ts`: dynamic `import()` from `games/<id>/server.ts`, validate manifest
7. **Game loop** — `setInterval` at 60fps (16ms), calls `plugin.onTick`, broadcasts `gameState` to all
8. **Bot client enhancements** — `tests/bot-client.ts`: auto-reconnect, simulate taps, verify gameState
9. **Integration test** — `tests/engine.test.ts`: 4 bots join → host starts tap-counter → bots tap for 5s → verify scores → one bot disconnects/reconnects → verify state restored

### Files to Create/Modify
- `server/rooms.ts` — room management
- `server/plugins.ts` — plugin loader (dynamic import)
- `server/game-loop.ts` — tick loop
- `server/index.ts` — integrate all, add QR endpoint, lobby messages
- `games/tap-counter/` — plugin folder with `manifest.json`, `server.ts`, `screen.ts`, `controller.ts`
- `shared/theme.ts` — design tokens
- `client/screen/main.ts` — WS connection, render loop
- `client/controller/main.ts` — WS connection, input handling
- `tests/engine.test.ts` — full integration test

---

## Cross-Platform Rules (MUST FOLLOW)
- No bash scripts — use `package.json` scripts only
- Paths: `import { join } from "node:path"` + `join(process.cwd(), ...)`
- LAN IPs: use `getLanUrls()` from `shared/types.ts`
- Line endings: LF only (enforced by .gitattributes + CI)
- Node 26 features: native `.ts` execution, `node:test`, `node:ws`

---

## Handoff Protocol
After each commit:
1. Update `HANDOFF.md` (rewrite, not append) — <80 lines
2. Run `git add HANDOFF.md` before commit
3. Pre-commit hook will verify HANDOFF.md present and valid

---

## Model
You are running on **Nemotron 3 Ultra** (NVIDIA NIM). Think step by step. Write tests first, then implementation. Keep diffs small. Ask if spec is ambiguous.

---

## Next Steps After F1
- F2: Controller kits (one-button, left-right, dpad, text, choice, private-grid, card-hand)
- G1: Darts (1-4, one-button)