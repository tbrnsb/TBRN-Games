# TBRN-Games Handoff — Paper & Ink on Games-expansion

## Current state
`Games-expansion` is merged into `paper-overhaul` (81 commits). The platform has
**37 games: 22 enabled, 15 retired**. All 22 enabled games have a renderer and
are skinned in the paper-and-ink system; the host board and phones use the new
8-seat, preset-Rumble structure.

## Last commit
Audio pass: every finished game now plays the win fanfare (including games
whose screen state only publishes reveal cues), and spoken turn announcements
fall back to `turnName` / `currentPlayerName` / a single `waitingOn` name in
addition to Guess the Imposter's authored line. Sound, speech and haptics were
instrumented and verified in the browser.

## Done
- **Merge**: new catalog, 8 seats, 22 enabled games, Rumble presets/slots/
  interlude/host controls/finale, score ticker, pause, results/awards, settings,
  presence/reactions, sound/TTS.
- **Host board**: paper table, 8-seat roster (all eight fit at 1280x720), the
  old game-box shelf restored (six illustrated boxes per row with tape, pins and
  per-game paper; `NEEDS n` / `MAX n` notes when the table does not fit), paper
  Rumble preset picker,
  slot progress, swap controls, finals podium/leaderboard/awards (fits 720p with
  eight rows), interlude and pause overlays, paper settings sheet.
- **All 22 enabled renderers**: 11 new expansion games use the shared paper
  board; existing renderers inherit paper backgrounds, cards, score rail, title
  and victory. Poker (green felt paper + paper table), Tap Race (paper track and
  ink lane markings) and Guess the Imposter's dark panels were repainted.
- **Controllers**: paper shell for all new layouts, seat badge, large stamped
  controls, reactions, haptics. The canvas layout gained a **Done** action so
  Slogan Shirts/Drawful can close the sketch phase early, and the sketch surface
  is capped so the tools sit near the fold.
- **11 new renderers**: Split the Room, Survive the Internet, Frankenanswers,
  Dumb Inventions, Stowaway, Fakin' It, Blather Round, Slide Roulette, Drawful,
  Slogan Shirts, Slingshot Arena.
- **Skins** added for the expansion IDs (33 skins total).
- **Legacy tree removed**: `src/`, `test/` and `public/` (pre-expansion engine,
  its tests and the synthwave `theme.css`) were dead paths, excluded from
  `tsconfig`, CI and `npm test`.
- **Background fix**: the washi tape no longer covers the top-left game title.
- **Visual consistency pass**: `client/screen/kit/header.ts` gives every game
  the same title/meta treatment; `drawBentoCard` keeps light cards and uses
  `stroke`/`glow` only for state accents; paper-board cards use ink text;
  `showsScores` turns off the platform ticker for the 20 games that already
  draw a score rail (only Bracket and Mind Meld keep it); the waiting panel no
  longer repeats the phase copy or overflows with eight long names.
- **Audio**: all 22 games publish screen sound cues; `client/screen/sound.ts`
  synthesises reveal/vote/win over WebAudio with no assets. The platform adds
  the win cue on every finish, and the speech hook covers turn-based games as
  well as the Imposter's own lines. TV sound/speech toggles persist and mute
  the cues/voice; phone haptics fire on control taps.
- **Victory animation**: `client/screen/kit/finish.ts` builds the shared
  winner card/standings/confetti from the screen state's score table and is
  used by the paper board and the three custom games that had none. The shared
  victory card now uses ink-on-card text and the right seat colour per player.
  Evidence: `design/shots-v3/{arena,dumbinventions,bracket,mindmeld,percentile,poker}/victory-1280.png`.
- **Poker**: the TV now uses the same card design as the phone (lavender face,
  big rank + suit, red/black inks; tomato striped back with "?"), with card
  backs in every undealt community slot and two hole-card backs per live seat.
  The table has a flat mint top, ink rim, cream inlay and stitched line; the
  pot has a chip stack; seat badges, D/SB/BB pills and the turn timer are
  larger and colour-coded.
- **Archery**: the empty card + stick figure is gone. The range is now a paper
  scene with a big paper archer (tunic, cap, bow, quiver), a tripod target,
  sun/clouds, distance ticks, grass, turn tickets and a POWER meter; all text
  stays inside the canvas at 1280 and 1920.
- **Host polish**: the game-box shelf tape moved clear of the kicker, Rumble
  playlists use a 3-column grid plus a "How a Rumble works" note, the Rumble
  sheet covers the launch bar, and the pause Wait button is paper/ink.

## Verification
`npx tsc --noEmit` clean; `npm run lint` 0 errors; `npm test` 1018/1018;
`npm run assets:check` 344 files; `npm run check:design` PASS.
Image-capable critic full audit of all 22 games at 1280/1920, starts,
controllers, host states and victories: **10/10 — no concrete visual
defects**. Evidence on disk (gitignored): `design/shots-v6/<game>/...`,
`design/host-shots/*.png`; contact sheets `design/review/batches/*-v7.png`.

## In progress
- None. Working tree is clean at the last commit.

## Next three actions
1. Per-game signature art/sound pass for the 22 enabled games; the shell is done,
   but several playfields still carry their pre-paper in-game art.
2. Retired games only if asked.
3. Optional: collapse the reaction bar during active drawing on phones so the
   sketch tools fit without a scroll.

## How to run & test
```bash
cd /home/sulav/.local/share/opencode/worktree/c248ff/paper-overhaul
npx tsc --noEmit
npm run lint
npm test              # 1018/1018
npm run assets:check  # 344 files
npm run check:design  # PASS
npm run shots         # or SHOT_GAMES=... SHOT_OUT=...
PORT=3101 npm start
```
Open `http://localhost:3101`.

## Failing tests / known issues
- None failing.
- Some existing playfields still keep their old in-game art (golf green, dark
  arena boards). The shell, scores, titles and victory screens are paper.
- The new 11 renderers share a board; they are functional and skinned but not
  yet one-off signature compositions.
- Drawing controllers need a short scroll to reach the colour tools on a 360dp
  phone at 1.5x text; the Done action is reachable there.
- No push; branch stays local.

## Decisions
1. The merge takes the new platform as the structural source of truth.
2. Existing renderers stay canvas; new text/vote/draw games use the shared
   paper board.
3. The legacy canvas kit is restyled to paper and is live for 11 games, not dead.
4. All 22 enabled games are in scope; the 15 retired games are not.
5. The pre-expansion `src/`/`test/`/`public/` trees are deleted rather than
   restyled; git history keeps them.
6. The canvas controller sends `{ action: "action" }` on Done; both Drawful and
   Slogan Shirts already accept that input.
