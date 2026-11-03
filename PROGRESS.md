# Visual Overhaul Progress (V0–V16)

## Renderer Interface Summary (from `client/screen/main.ts` and existing renderers)
- Type: `ScreenRenderer = (ctx: CanvasRenderingContext2D, width: number, height: number, state: unknown) => void`
- Loaded dynamically via `import(\`/games/${gameId}/screen.ts\`)`, looking for `render${CapGameId}` or `render` export
- `ctx` is already scaled by devicePixelRatio; `width`/`height` are CSS pixels
- State shape is game-specific, returned by `screenState()` in each plugin
- Generic fallback (`renderGeneric`) used when no custom renderer exists

---

## V0: Foundation

### PixiJS Decision
- **Option chosen**: Serve PixiJS as ES module from `node_modules` via static file serving. No esbuild step needed — the server already serves `/client/` and `/games/` statically. Add `pixi.js` to package.json, then copy `node_modules/pixi.js/dist/pixi.mjs` (or similar) to `client/assets/pixi.mjs` for offline loading.
- **Note**: Current server (`server/index.ts`) needs to serve `client/assets/` statically. Verify this works.

### Fonts
- Source: `@fontsource/space-grotesk`, `@fontsource/inter`, `@fontsource/orbitron`
- Destination: `client/assets/fonts/` (woff2 files)
- Load via `@font-face` in screen HTML/CSS

### Shared Kit (`client/screen/kit/`)
- `theme.ts` — design tokens (colors, spacing, typography, radii, glow, motion)
- `background.ts` — synthwave gradient + grid horizon + sun
- `bento.ts` — bento grid layout helpers, card rendering
- `scoreboard.ts` — animated counter, player score cards
- `particles.ts` — particle emitter (bursts, confetti)
- `shake.ts` — screen shake (max 6px, 250ms decay)
- `titleCard.ts` — countdown/intro title card (Orbitron)
- `victory.ts` — victory screen with confetti, ranked scores
- `easing.ts` — easeOutCubic, easeOutBack, stagger helpers
- `utils.ts` — wrapText, roundRect, tabular figures, color helpers

### Proof Game: Quiz ✓
- Ported `games/quiz/screen.ts` to use the kit
- Synthwave background, bento grid scoreboard, animated score counters, particle bursts, title card, countdown, victory screen with confetti
- All game-feel checklist items implemented

### All Games Checklist
| Game | Status | Notes |
|------|--------|-------|
| archery | **DONE (V17)** | Side-on range, sliding target, bow draw, shot feedback |
| darts | **DONE (V17)** | Neon board, sector/ring scoring, darts, remaining-score rail |
| quiz | **DONE (V0)** | Premium renderer, audited and browser-verified |
| racing | **DONE (V1)** | Camera-window track, standings, progress bars, victory |
| poker | **DONE (V2)** | Felt table, community cards, seats, showdown reveal |
| snakes | **DONE (V3)** | 20×20 arena, live/dead snakes, food, scores |
| golf | **DONE (V4)** | Real course state, aim/power, hole banner, strokes rail |
| seabattle | **DONE (V5)** | Radar map from public shots, fleet status, last shot |
| slotcar | **DONE (V6)** | Oval circuit, curve danger zones, lap pips |
| spinwar | **DONE (V7)** | Circular arena, spinning blades, eliminations |
| knifethrow | **DONE (V8)** | Rotating target, absolute knife angles, round pips |
| trafficjam | **DONE (V9)** | 6×6 puzzle, parsed cars, exit marker, level timer |
| bluff | **DONE (V10)** | Prompt, submission/vote counts, reveal ranking |
| writevote | **DONE (V11)** | Prompt, response ranking, vote bars |
| mostlikely | **DONE (V12)** | Anonymous vote, reveal bar chart |
| guesswho | **DONE (V13)** | 24 abstract tiles, lives, remaining, turn timer |
| hangman | **DONE (V14)** | Gallows, masked word, alphabet, sawtooth round-end |
| gravityrun | **DONE (V15)** | Side-scrolling corridor, gravity orbs, coins, obstacles |

---

## V1: Reference Renderer (Racing)
- Build `games/racing/screen.ts` using the kit
- Polish to premium quality bar
- Screenshot, critique, fix

## V2: Remaining Games (one per session)
Priority: poker → snakes → golf → seabattle → gravityrun → slotcar → spinwar → knifethrow → trafficjam → bluff → writevote → mostlikely → guesswho → hangman → archery restyle → darts restyle → quiz restyle

---

## V1–V5 Audit (repaired after browser verification)
The earlier renderers passed typecheck/tests but had never been loaded in a
browser. Fixes:
- `/client/*` and `/assets/*` static routes were wrong, so renderers and fonts
  never loaded. Both fixed.
- DPR transform was clobbered by `ctx.setTransform(scale, …)`; the screen client
  now owns the transform and wraps each render in save/restore.
- Title/countdown cards were never advanced; racing/poker recreated them every
  frame. Cards now advance per frame and are created only on state changes.
- Victory update had an unreachable branch; fixed. A 7 s result hold keeps the
  final frame on screen (the server returns to the lobby immediately on finish).
- Golf and Sea Battle read non-existent fields; rewritten against the real
  `screenState()`.
- `buildRankedEntries` now preserves the real player index.
- Loader accepts a module's single `render*` export, so `seabattle` →
  `renderSeaBattle` works.
- Removed per-frame console logging on screen and server (render loop went from
  9 fps to 60 fps in the verification browser).
- Canvas fits the viewport; scoreboards size to content and clip long names.

Browser-verified at 1280×720 with bots: racing, poker, snakes, golf, seabattle,
quiz. Console errors: only a missing favicon.

## Host Screen (V16)
The lobby is now a 16:9 design stage (1280×666) scaled to fit, like the game
canvas, so the composition is identical at 720p and on a TV.
- The room code is the marquee; the QR sits on a cream “ticket” with a dashed
  frame and the join address beneath it.
- The table has four fixed seats, filled with player-coloured swatches and a
  connected/away state; empty seats are dashed.
- The 18 games are a shelf, not a card grid: flat rows with a left selection
  rule, name, two-line description, player dots and min–max range.
- Disabled games show “Needs N”, the launch bar names the selected game and the
  button reads “Start Racing”, etc.
- One accent (magenta), one light surface (the QR), one load-in animation and a
  live pulse only. No per-card gradients or shadows.
- Verified at 1280×720 and 1920×1080, including the lobby → game transition
  through the host-token start endpoint.

## Controller UI (V18)
The phone controller now uses the same identity as the host and games:
- Local fonts only (the old page pulled Google Fonts, breaking offline use).
- Join screen with a 5-character room-code ticket; QR links show “Room linked”
  and only ask for a name. Names are remembered; refresh rejoins the seat.
- A coach strip highlights your turn and shows game hints (throttle, spin-out,
  submitted/voted state); a standby mark fills the lobby wait.
- Layouts restyled: one-button pad (with throttle ON/OFF), left/right paddles,
  labelled d-pad, writing card, choice list, 20×10 Sea Battle grid with fleet /
  enemy labels and X/o/S states, and cream card hands.
- Tall grids scroll inside the controller; short layouts centre in the thumb
  zone; text layouts anchor to the top for the keyboard.
- Verified at 390×844 for every layout, plus a live Slot Car controller and the
  lobby/room-code flows.

## Last Updated
All 18 renderers and both clients now share one visual language. V17 restyled
archery and darts; V18 rebuilt the phone controller (local fonts, room-code
join, coach strip, all seven layouts). Manifest controller types were corrected
for golf (dpad), Guess Who (choice) and Traffic Jam (private-grid). The game
logic hardening pass is in. `npm run typecheck` clean, `npm run lint` 0 errors
(65 warnings), `npm test` 62/62.