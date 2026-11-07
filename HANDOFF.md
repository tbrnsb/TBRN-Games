# TBRN-Games Handoff — Paper & Ink on Games-expansion

## Current state
`Games-expansion` is merged into `paper-overhaul` (81 commits). The platform has
**37 games: 22 enabled, 15 retired**. All 22 enabled games have a renderer and
are skinned in the paper-and-ink system; the host board and phones use the new
8-seat, preset-Rumble structure.

## Last commit
Skin-contrast fix (Racing, Guess the Imposter) and removal of the stale
`tsconfig.build.json`, on top of the paper polish commit for the host shelf,
alleys, finale, controllers and the remaining dark playfields.

## Done
- **Merge**: new catalog, 8 seats, 22 enabled games, Rumble presets/slots/
  interlude/host controls/finale, score ticker, pause, results/awards, settings,
  presence/reactions, sound/TTS.
- **Host board**: paper table, 8-seat roster (all eight fit at 1280x720), 22-game
  shelf with readable names and a visible scrollbar, paper Rumble preset picker,
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

## Verification
`npx tsc --noEmit` clean; `npm run lint` 0 errors; `npm test` 1018/1018;
`npm run assets:check` 344 files; `npm run check:design` PASS. Critic follow-up on
the contrast fix found no defects.

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
