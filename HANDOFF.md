# TBRN-Games Handoff — Paper & Ink on Games-expansion

## Current state
`Games-expansion` is merged into `paper-overhaul` (81 commits). The platform now
has **37 games: 22 enabled, 15 retired**. All 22 enabled games have a renderer
and are skinned in the paper-and-ink system; the host board and phones use the
new 8-seat, preset-Rumble structure.

## Last commit
`ab7db7e` — merge Games-expansion into paper-overhaul. The paper adaptation on
top of the merge is uncommitted.

## Done
- **Merge**: new catalog, 8 seats, 22 enabled games, Rumble presets/slots/
  interlude/host controls/finale, score ticker, pause, results/awards, settings,
  presence/reactions, sound/TTS.
- **Host board**: paper table, 8-seat roster, 22-game shelf, paper Rumble preset
  picker, slot progress, swap controls, finals podium/leaderboard/awards,
  interlude and pause overlays, paper settings sheet.
- **All 22 enabled renderers**: 11 new expansion games use the shared paper
  board (`client/screen/kit/paperBoard.ts`); existing renderers inherit paper
  backgrounds, score cards, paper title/victory, per-game paper/inks/fonts via
  the restyled legacy canvas kit and `setLegacySkin`.
- **Controllers**: paper shell for all new layouts, seat badge, large stamped
  controls, reactions, haptics.
- **11 new renderers**: Split the Room, Survive the Internet, Frankenanswers,
  Dumb Inventions, Stowaway, Fakin' It, Blather Round, Slide Roulette, Drawful,
  Slogan Shirts, Slingshot Arena.
- **Skins** added for the expansion IDs (33 skins total).

## In progress
- None. Committing the paper adaptation is the next action.

## Next three actions
1. Commit the merged paper adaptation.
2. Per-game signature art/sound pass for the 22 enabled games; the shell is done,
   but several playfields still carry their old in-game art.
3. Retired games only if asked.

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
- Some existing playfield art is still the pre-paper game art (golf green,
  poker table, racing track, dark arena boards). The shell, scores, titles and
  victory screens are paper.
- The new 11 renderers share a board; they are functional and skinned but not
  yet one-off signature compositions.
- Ticker/reaction canvas colours are paper, but some old game renderers still
  have their own in-game palettes.
- No push; branch stays local.

## Decisions
1. The merge takes the new platform as the structural source of truth.
2. Existing renderers stay canvas; new text/vote/draw games use the shared
   paper board.
3. The legacy canvas kit is restyled to paper and is live for 11 games, not dead.
4. All 22 enabled games are in scope; the 15 retired games are not.
