# HANDOFF

## Current state
Game-feel rebuild + GAMES-SPEC-2 build in progress. **27 games**, all passing.
Nothing is committed; the whole working tree is uncommitted.

Last gate: `npm test` 139/139 · typecheck 0 errors · lint 0 errors (123 warnings)
· `npm run probe` 0 issues across 27 games × 1-4 players.

## Done in this session
1. **Seat/reconnect bug fixed.** Phones that dropped in the lobby were deleted after
   `PLAYER_TIMEOUT_MS`, then could never rejoin (`INVALID_TOKEN`). That was why every game
   started one player short and Bluff would not start. Seats now survive while anyone else
   is in the room; a dead token into a lobby room takes a fresh seat.
   Tests: `tests/reconnect.test.ts`.
2. **Removed** seabattle, trafficjam, slotcar, gravityrun.
3. **9 new controller layouts**: slider, dual-slider, pad, aim, tap-race, board, numpad,
   canvas, chat, rank. Plus a per-game `maxLength` on `text`.
4. **Rewired**: darts (real two-slider aiming, was a random dice roll), golf (joystick +
   power + SHOOT), racing (pure mash), guesswho (fixed opponent, manual flips, shared board).
5. **New games (9)**: percentile, splitroom, dictionarium, drawful, fakin, trivia,
   wordspud, survive, blather.
6. **GAMES-SPEC-2**: mindmeld (61-item pack, pure scoring, 6 tests), mindreader (`rank`
   controller, footrule scoring, 4 tests), stowaway (`role` controller, 5 tests), bdate
   (chat wiring confirmed, 3 tests).

## Next three actions
1. **Frankenanswers** (spec item 3) - `rank` + text now exist; needs a per-player chip pool.
2. Content packs + `screen.ts` for the 9 games added from GAMES-SPEC-2 whose content is
   still inline (dictionarium needs the 80-word pack; blather needs 80 words + templates).

## Remaining from GAMES-SPEC-2
Dumb Inventions, Slide Roulette, Bracket Brawl, Frankenanswers, Word Chain,
Stowaway, Last Seat, Blind Date Chat, Slogan Shirts, Mash-Up Monsters, Slingshot Arena.

Already covered by existing games: Word Fraud=dictionarium, Fence Sitters=splitroom,
Gut Check=percentile, Fact or Fiction=trivia, Clue Crafters=blather, Twist It=survive,
The Fake Out=fakin, Sketch & Lie=drawful, Mind Meld + Mind Reader built to spec.

## Known gaps / deviations
- No `screen.ts` for the 9 new games; they use the fallback renderer.
- Content is inline in most games, not in `content/*.json` (only mindmeld uses the pack).
- No host announcer (`S6`) and no per-game `theme.json`.
- Poker still lacks host stack config, numpad bets and a round limit.
- Tutorials (`howTo`) not added.
- Drawful canvas has no colour picker or undo (spec S5 asks for 6 colours, 3 sizes, undo).

## How to run
```bash
npm start          # PORT env, default 3000
npm test
npm run typecheck
npm run lint
npm run probe
```
ufw already allows 3000 and 3100/tcp on this machine, so phones can connect.
Do not commit or push without the human asking.

## Commit log
- fix(engine): keep disconnected seats and recover stale rejoin tokens
- feat(controllers): add motion, value and role layouts
- feat(games): real dart aiming, golf joystick, tap race, guess who board
- chore: drop seabattle, trafficjam, slotcar and gravityrun
