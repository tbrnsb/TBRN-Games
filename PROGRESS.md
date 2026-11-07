# TBRN Progress — Paper & Ink (post-merge)

`Games-expansion` was merged into `paper-overhaul` (81 commits). The platform is
now 37 games: **22 enabled**, 15 retired but kept. Every enabled game has a
screen renderer and is skinned in the paper system.

## Current state

- **Host board**: 8 fixed seats with colour + emoji/shape identity, the
  pre-merge illustrated game-box shelf (six per row, box art, tape, pins,
  per-game paper), 22 games, 8-player names, new Rumble preset picker, slot progress, swap
  controls, interlude, pause overlay, settings, ticker and paper finale
  podium/leaderboard/awards.
- **Controllers**: paper shell over every new layout (`one-button`, `left-right`,
  `dpad`, `choice`, `text`, `card-hand`, `private-grid`, `slider`, `rank`,
  `draw`, `chat`, `role`, `aim`, `numpad`, `race`, `board`), player seat badge,
  reactions, haptics and large paper controls.
- **All 22 enabled renderers** now use the paper vocabulary. The 11 new
  expansion games use the shared paper board; the 11 pre-existing enabled
  renderers inherit paper background, cards, score rail, title and victory from
  the restyled shared kit with per-game paper/inks/display font.
- **New games added to the renderer set**: Split the Room, Survive the Internet,
  Frankenanswers, Dumb Inventions, Stowaway, Fakin' It, Blather Round,
  Slide Roulette, Drawful, Slogan Shirts, Slingshot Arena.
- **Retired games** (15) have no lobby entry and were not migrated.
- **Post-merge polish**: the 8-seat roster and finale fit 1280x720, shelf names
  wrap instead of ellipsising, the picker has a visible scrollbar, the canvas
  controller gained a Done action, and the washi tape moved off the game title.
- **Playfield repaints**: Poker runs on green felt paper with a paper table,
  Tap Race uses a printed cream track with ink lane markings, and Guess the
  Imposter's dark panels/pills became paper. Racing and Imposter accent inks
  were re-picked for legibility on their papers.
- **Legacy removal**: the pre-expansion `src/`, `test/`, `public/` trees and the
  stale `tsconfig.build.json` are gone; the live paths are `server/`, `tests/`,
  `client/`.

## Visual consistency pass

- One header system: `client/screen/kit/header.ts` (`paperTitle` 32px skin
  display, first ink; `paperMeta` 18px body, muted) used by all 22 renderers.
- `drawBentoCard` is light paper on every stock; `stroke`/`glow` carry state
  accents. Paper-board cards print in `cardText`/`cardMuted`; page text stays
  `text`/`textMuted`.
- 20 games export `showsScores` and suppress the duplicate platform ticker;
  only Bracket and Mind Meld rely on it.
- All 22 TVs and controllers re-shot at 1280/1920 and 390: `design/shots-v3/`.
- Host states re-shot: `design/host-shots/` (lobby 1280/1920, Rumble picker,
  session slots, finale 1280/1920, settings, pause, interlude).

## Texas Hold'em host board

The TV cards now share the phone's design: `#F5F3FF` faces with a big rank and
suit, `#D6204E` red ink, ink borders and a hard shadow; undealt community slots
and every live seat's two hole cards use the phone's tomato striped back with a
"?" mark. The table is a flat mint oval with an ink rim, cream inlay and a
stitched betting line; the pot has a paper chip stack; seat panels gained seat
badges and larger D/SB/BB pills; the active seat has a thicker timer bar and the
header shows the countdown. Evidence: `design/shots-v3/poker/`.

## Archery rebuild

`games/archery/screen.ts` now draws a paper range scene instead of an empty
white card: sky and field bands, paper sun/clouds, a picket-fence line of
distance markers, a tripod target, a paper-cutout archer with tunic/cap/bow/
quiver, a labelled POWER meter, a HOLD/PULL/RELEASE tag above the archer, and
a paper ticket strip for the turn order. The old stick figure and 11px lane
bars are gone. Re-shot at 1280/1920.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (1065 existing warnings).
- `npm test` — **1018/1018 pass**, including 8-player/long-name layout and TV
  secret tests.
- `npm run assets:check` — **344 files covered**.
- `npm run check:design` — **PASS**, p95 16.8 ms.
- `npm run shots` groups:
  - `design/shots-enabled` — 11 existing enabled games
  - `design/shots-new` — 11 new enabled games
  - `design/shots-a/b/c` — pre-merge 18-game sweep
- Browser-verified: 8-seat lobby, 22-game shelf (1280 and 1920), Rumble preset
  and slot board, Rumble interlude after a real game, finale podium/leaderboard,
  paper controller quiz, live Slogan Shirts sketch with the Done action, and the
  11 new game TV boards at 1280/1920 and 390 phone.
- Critic: 9/10 before the polish; a follow-up review of the contrast fix found
  no defects.

## Renderer interface

`ScreenRenderer(ctx, width, height, state)` from `games/<id>/screen.ts`; the
screen client owns DPR and canvas fit. `setLegacySkin(skinFor(gameId))` swaps the
paper, inks and display font before every canvas frame. The new shared paper
board is `client/screen/kit/paperBoard.ts`.

## Next

- Per-game signature art and sound passes for the 22 enabled games (the shell is
  in place; some playfields still use their old in-game art).
- Retired games only if the human asks.

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
## GAMES-SPEC-2 pass (2026-11-05)

- Added **Mind Meld** (`games/mindmeld/`) to spec: 61-item category pack in
  `content/categories.json`, pure `normalizeAnswer` / `scoreRound` exports, 6 tests
  (normalization, per-partner scoring, jackpot, empty answers, scripted full game,
  deadline resolve). Controller honours a per-game `maxLength` (20 chars here).
- Spec sections 1-18 map onto existing games: Word Fraud = dictionarium, Fence Sitters =
  splitroom, Gut Check = percentile, Fact or Fiction = trivia, Clue Crafters = blather,
  Twist It = survive, The Fake Out = fakin, Sketch & Lie = drawful.
- Still missing: Mind Reader, Word Chain, Dumb Inventions, Slide Roulette, Bracket Brawl,
  Frankenanswers, Stowaway, Last Seat, Blind Date Chat, Slogan Shirts, Mash-Up Monsters,
  Slingshot Arena.
- Added **Mind Reader** (`games/mindreader/`) to spec: `rank` controller in
  `shared/controllers.ts`, pure `footruleDistance` / `scoreGuess`, 4 tests.
  Gate: 127 tests, probe 0 issues, 25 games.
