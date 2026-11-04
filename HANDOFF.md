# TBRN-Games Handoff

## Current Phase
Visual overhaul V0–V18 complete: all 18 game renderers, the host lobby and the
phone controller share one visual language. Game-logic hardening is in.

## Last Commit
`c6246f4` (visual overhaul + game renderers) — this controller/archery pass is
uncommitted until the next commit.

## Done
- **18 game plugins** under `games/*/server.ts`; every game passes the automated
  playthrough, manifest, garbage-input and privacy tests.
- **Server** (`server/index.ts`): spectator screen, delta-time loop, O(1) room
  lookup, host-token start auth, per-game try/catch, local QR generation.
- **Shared kit** (`client/screen/kit/`): theme, synthwave background, bento
  cards, scoreboard, counters, particles, shake, title/countdown, victory,
  easing, utils.
- **Renderers**: quiz, racing, poker, snakes, golf, seabattle, slotcar, spinwar,
  knifethrow, trafficjam, bluff, writevote, mostlikely, guesswho, hangman,
  gravityrun, archery, darts. Browser-verified at 1280×720 and/or 1920×1080.
- **Host screen**: 16:9 lobby stage scaled to fit; room-code marquee, QR
  ticket, four-seat roster, 18-game shelf, selected-game launch bar.
- **Controller (V18)**: local fonts, room-code join ticket, QR-linked join,
  remembered name/seat rejoin, coach strip, standby state, and restyled
  one-button, left/right, dpad, text, choice, 20×10 grid and card-hand layouts.
- **Game logic hardening** (from the logic pass): null/type/grid guards,
  delta-time quiz timing, golf stroke cap, knife-throw turn fairness, Spin War
  last-survivor win, bounded food spawning, plus `scripts/deep-probe.ts` and
  `tests/game-logic.test.ts`.
- **Manifest fixes**: golf → dpad, Guess Who → choice, Traffic Jam →
  private-grid, matching their server plugins.
- **Playability pass** (independent debugger): choice buttons no longer lock when
  a game omits a turn flag; quiz and hangman now expose the flat options the
  controller renders; poker's card-hand layout gained Fold / Check / Call /
  Raise; 26 letters render as a compact grid; archery and darts detect shots
  beyond their rolling window; victory rankings put the actual winner first;
  Slot Car reports total distance for a finished car; title cards reset between
  games; quiz stops shipping the answer before reveal; a finished game releases
  the room so the lobby cap is not inherited.
- **Runtime fixes**: correct `/client/` and `/assets/` routes (renderers and
  fonts now load), DPR-safe rendering, advancing title/countdown/victory cards,
  result hold after a game ends, multi-word renderer export loading, 60 fps by
  removing per-frame console logging, canvas/stage fit to the viewport.

## Next Three Actions
1. Independent review pass: debugger for logic regressions, ui-reviewer for the
   host/controller screens, critic for the final score.
2. Verify the controller in landscape and on a real phone; add a screenshots
   regression script for the 18 renderers and 7 controller layouts.
3. Playtest the new game-logic changes (knife-throw fairness, Spin War winner,
   golf pick-up cap) and tune content packs.

## How to Run & Test
```bash
cd /home/sulav/Projects/TBRN-Games
npm run typecheck   # 0 errors
npm run lint        # 0 errors (65 warnings)
npm test            # 62/62 pass
PORT=3100 npm start # server
```
Open `http://localhost:3000/screen/`; phones open `/controller?room=<CODE>`.

## Failing Tests / Known Issues
- **Favicon**: `/favicon.ico` 404s; cosmetic only.
- **Legacy scaffold**: `public/`, `src/`, `test/`, `dist/` remain excluded from
  typecheck.
- HTTPS/WSS is not implemented (needed for some mobile PWA features).

## Decisions Made
1. **Screen is a spectator**, never a player; it owns the room and starts games.
2. **Host-token start**: only the connected screen can start a game.
3. **Delta-time timers** in game logic; renderers use `performance.now()` only
   for cosmetics.
4. **V1 Racing is the quality bar**; every renderer uses the shared kit.
5. **One visual pass per game** (V0…V15); no game gets two passes in a phase.
6. **Render-state ownership**: one module-level state per game on `globalThis`;
   renderers never mutate server state.
7. **Privacy**: render only fields the server already exposes (poker hole cards
   at showdown, no Sea Battle ship positions, no Guess Who secrets).
8. **Result hold**: the client keeps the final frame for 7 s so the victory
   screen can play; the server returns to the lobby on the finish tick.
9. **Host stage**: the lobby is a fixed 1280×666 design scaled to fit, so the
   composition survives 720p and a TV identically.
10. **One accent**: magenta is the only filled accent on the host screen; the QR
    is the only light surface; game tiles are a shelf, not a card grid.
11. **Player palette**: the lobby seats use the same four colours as the game
    renderers, so a player keeps their colour from lobby to game.
12. **Controller identity**: local fonts only (offline), a room-code ticket,
    a coach strip that highlights your turn, and thumb-sized controls. The
    controller is a phone UI, not a shrunken screen UI.
13. **Manifest source of truth**: `server.ts` owns the plugin manifest; the
    JSON copy must mirror it (controller types corrected for three games).

## Open Questions for Human
1. Add HTTPS/WSS for mobile PWA features?
