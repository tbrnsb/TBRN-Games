# TBRN Progress — Paper & Ink

This file now tracks the DESIGN.md v2 paper-and-ink overhaul. The paper shell (shared kit)
log below is historical.

## V0 — Foundation: DONE

- Renderer interface is unchanged: `ScreenRenderer(ctx, width, height, state)` loaded from `games/<id>/screen.ts`; the screen client owns DPR and canvas fit. DOM games export `renderDom(root, state)`.
- New shared kit at `client/kit/`: paper/ink tokens, paper surfaces, props, text-fit, sound manager with skin banks, motion, player tokens, Mox + host line library, box art, shelf, ratchet counter, flecks, victory.
- 22 Latin font faces installed self-hosted; 10 papers, wood, grain, halftone and 10 generated props.
- `scripts/install-fonts.mjs`, `scripts/generate-assets.mjs`, `scripts/generate-skins.mjs`.
- `npm run assets:check`, `npm run check:design` (contrast, text-fit, overflow, console, 4× CPU frame time, reload heap), `npm run shots` (start/live/controller phases), and `?debug=1` FPS overlay exist.
- 18 existing skins live in `client/skins/<game>/skin.ts`; new games use the same interface.
- The paper shell (shared kit) Quiz canvas renderer is deleted. The legacy kit remains only for the unmigrated game renderers; it is not dead code until the last game moves.

## V1 — The Table: DONE

- Wood table, paper join card, luggage-tag room code, QR sticker with hand-drawn arrow, player tokens, Mox dock, audio gate, credits sheet.
- Shelf of 18 boxes with per-game paper, two inks, box art, tape/pins, sticky NEED notes, lift/select motion.
- Selection ticket and Open button; Royal Rumble sheets restyled on paper.
- `npm run check:design`: PASS (10 papers, p95 16.8 ms); `npm run shots` captures lobby + game + controller.

## V2 — Controller shell: DONE

- Paper app bar, player token + name, status ribbon, stamped primary/choice/dpad/one-button/left-right/card/grid controls, ruled text field, paper session card, haptics hook.
- Existing seven controller layouts are restyled; new primitives (slider, rank, draw, chat, role, aim) are not in this branch yet.
- Verified at 390×844 for join, idle, quiz, knife throw, racing, golf, bluff, poker and sea battle.

## V3 — Reference game: Quiz — DONE

- New DOM renderer path in the screen client (`renderDom`) while canvas renderers keep working.
- Paper TV-set Quiz: Titan One masthead, paper question card, 2×2 stamped answers, score tags, reveal stamps, timed countdown, Mox with the host line library, final champion.
- Three handmade details on the question screen (tape, pin, coffee ring) plus a star sticker.
- The paper shell (shared kit) canvas Quiz renderer and its kit imports are deleted.
- Console clean; `npm run shots` captures start, live, 1280/1920 and the phone controller.

## Compliance notes

- All 18 existing canvas renderers now inherit paper backgrounds, paper score cards,
  hard offset shadows, per-game paper/spot-ink/display-font tokens, paper title
  cards and the paper victory screen from the shared legacy kit. The remaining
  work is per-game art (the playfield itself), not the shell.

- V0–V3 were bundled into this worktree in one session. From V4 onward: one phase
  or game per session, then stop.
- The controller’s obsolete synthwave `@font-face`, gradient and glow base has
  been removed; only layout base rules remain under the paper override.
- Token faces are seeded by player id so they survive renames and rejoins.
- Controller taps and your-turn transitions now use haptics.
- High-contrast mode is reachable from the host top bar; canvas scenes get a
  grayscale/contrast treatment, not a full paper retheme yet.

## V4 — Reference game: Racing: NEXT

## V5+ — Remaining existing games

### 39-game checklist

| Game | Skin | Renderer | Controller | Status |
|---|---|---|---|---|
| Archery | DONE | paper shell (shared kit) | paper shell | V5+ |
| Bluff | DONE | paper shell (shared kit) | paper shell | V5+ |
| Darts | DONE | paper shell (shared kit) | paper shell | V5+ |
| Golf | DONE | paper shell (shared kit) | paper shell | V5+ |
| Gravity Run | DONE | paper shell (shared kit) | paper shell | legacy/dropped |
| Guess Who | DONE | paper shell (shared kit) | paper shell | V5+ |
| Hangman | DONE | paper shell (shared kit) | paper shell | V5+ |
| Knife Throw | DONE | paper shell (shared kit) | paper shell | V5+ |
| Most Likely To | DONE | paper shell (shared kit) | paper shell | V5+ |
| Poker | DONE | paper shell (shared kit) | paper shell | V5+ |
| Quiz | DONE | **paper DOM (V3)** | paper shell | DONE |
| Racing | DONE | paper shell (shared kit) | paper shell | V4 next |
| Sea Battle | DONE | paper shell (shared kit) | paper shell | legacy/dropped |
| Slot Car | DONE | paper shell (shared kit) | paper shell | legacy/dropped |
| Snakes | DONE | paper shell (shared kit) | paper shell | V5+ |
| Spin War | DONE | paper shell (shared kit) | paper shell | V5+ |
| Traffic Jam | DONE | paper shell (shared kit) | paper shell | legacy/dropped |
| Write & Vote | DONE | paper shell (shared kit) | paper shell | V5+ |

### New games from DESIGN.md §9.2

All 21 have a skin defined in the design table and are not built yet.

Word Fraud · Fence Sitters · Gut Check · Fact or Fiction · Mind Meld · Dumb
Inventions · Slide Roulette · Bracket Brawl · Twist It · Frankenanswers · Clue
Crafters · Word Chain · Mind Reader · The Fake Out · Stowaway · Last Seat ·
Blind Date Chat · Slingshot Arena · Sketch & Lie · Slogan Shirts · Mash-Up
Monsters.

---

# Historical: Synthwave visual overhaul (V0–V16)


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

## Royal Rumble (post-overhaul)

- `server/session.ts` is a pure series engine: candidates, private votes, random
  picks, 10/6/3/1 placement points, abort, champion and five honorary trophies.
- The host shelf gained a Rumble setup, live board and final champion/trophy
  screen; the top bar gained a double-confirm End game.
- The controller gained a session card: vote buttons with counts, live points,
  your vote/result, and the final trophy board.
- Sessions are per room and in memory; new seats are blocked mid-rumble, while
  rejoin tokens still restore the same seat.
- Tests: 11 engine tests + a real socket/HTTP flow covering vote, start, abort,
  play, score and clear.

## Last Updated
Royal Rumble sessions are in on top of the finished visual overhaul and logic
hardening. All 18 renderers and both clients share one language. `npm run
typecheck` clean, lint 0 errors, `npm test` 101/101 (18 renderer smoke tests, 9
controller/lobby logic tests, 11 session-engine tests, a server session flow,
and the existing game/server suites), `npm run probe` 0 issues. Browser flow was
exercised with two phone contexts: vote → start → finish → points → final board,
plus End game and random mode.