# TBRN-Games Handoff

## Current Phase
Visual language v2 (paper-and-ink) is in an isolated worktree. V0 foundation,
V1 table/lobby, V2 controller shell and V3 Quiz are implemented. Next is V4
Racing, then the remaining existing games.

## Last Commit
`5c7bfff` on `visual-overhaul`. The paper overhaul is uncommitted on branch
`paper-overhaul` in
`/home/sulav/.local/share/opencode/worktree/c248ff/paper-overhaul`.

## Done
- **Kit** (`client/kit/`): paper/ink tokens, textures, props, text-fit, sound
  manager, motion, player tokens, Mox host, box art, shelf, ratchet counter,
  flecks, victory podium.
- **Assets**: 22 Latin font faces, 10 papers, wood, grain, halftone, 10 generated
  props; `ASSETS.md` covers 344 files; `npm run assets:check` passes.
- **Skins**: 18 existing game skins in `client/skins/<game>/skin.ts`.
- **Lobby**: wood table, paper join ticket, luggage-tag code, QR sticker, player
  tokens, Mox, audio gate, credits sheet, 18 game boxes with per-game paper/inks.
- **Controller**: paper app bar with player token, status ribbon, stamped
  one-button/left-right/dpad/choice/text/card/grid controls, paper session card,
  haptics, tape/pin/scribble details.
- **All 18**: the shared legacy canvas kit now paints paper backgrounds, paper
  score cards, hard shadows, per-game paper/inks/display fonts, paper title and
  victory screens. Per-game playfield art is still the next pass.
- **Quiz (V3)**: DOM-only paper renderer (old canvas path deleted); question,
  answers, score tags, timer, reveal stamps, Mox host lines, final champion.
- **Compliance**: removed obsolete synthwave controller font-face/gradient/glow
  rules; generic fallback and player colours moved to paper tokens; token faces
  seeded by player id; high-contrast toggle; `?debug=1` FPS overlay.
- **Royal Rumble** sheets restyled as paper; logic untouched.
- **Tooling**: `npm run shots` (start/live/controller), `assets:check`,
  `check:design` (contrast, text-fit, overflow, console, 4× CPU, reload heap).

## In Progress
- None. Racing and the remaining 13 active game renderers still use the old
  synthwave kit. The four dropped games are legacy.
- Phase discipline: V0–V3 were bundled in this worktree; V4 onward is one
  phase/game per session.

## Next Three Actions
1. Build V4 Racing as the action-game reference (canvas + DOM overlay).
2. Rebuild the remaining existing game renderers one per pass: Poker, Snakes,
   Golf, Darts, Archery, Write & Vote, Bluff, Most Likely To, Guess Who,
   Hangman, Spin War, Knife Throw.
3. Delete the old synthwave kit/fonts after the last migration.

## How to Run & Test
```bash
cd /home/sulav/.local/share/opencode/worktree/c248ff/paper-overhaul
npm run typecheck     # 0 errors
npm run lint          # 0 errors, 93 warnings
npm test              # 101/101 pass
npm run assets:check  # 344 files covered
npm run check:design  # PASS
npm run shots         # SHOT_GAMES=quiz for one game
PORT=3101 npm start
```
Open `http://localhost:3101`.

## Failing Tests / Known Issues
- No failing tests.
- Unmigrated game renderers still draw synthwave scenes. Do not demo them next
  to the new lobby/controller/Quiz until V4/V5.
- The controller has the paper shell but not the new slider/rank/draw/chat/role/
  aim primitives from `GAMES-SPEC-2.md`; those belong to the new-game stream.
- `npm run check:design` does not yet do the memory/restart check from the spec.
- The four dropped games have skins but will not be migrated.

## Decisions Made
1. Paper + 2 spot inks + ink-black; no gradients, glow, blur or soft shadows.
2. House fonts: Bricolage Grotesque, Atkinson Hyperlegible, Permanent Marker.
3. Canvas for action; DOM/CSS/SVG for text-heavy games (`renderDom`).
4. One skin file per game; skins are data.
5. Worktree isolation keeps the concurrent Game Feel/new-game stream separate.

## Open Questions for Human
1. Review V1/V2/V3 before V4; especially Mox placement and Quiz option density.
2. Confirm whether the dropped four games keep skins at all.
