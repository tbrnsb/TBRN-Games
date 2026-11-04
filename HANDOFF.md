# TBRN-Games Handoff

## Current Phase
Visual overhaul and Royal Rumble sessions are complete. All 18 game renderers,
the host lobby and the phone controller share one visual language, and a room
can play a 5/8/all-game series with phone votes or random picks.

## Last Commit
`a917120` (hardening docs) before the uncommitted Royal Rumble work. All commits
are local; nothing is pushed.

## Done
- **Royal Rumble engine** (`server/session.ts`): eligible-game candidates,
  vote/random selection, 10/6/3/1 placement points, round abort, champion
  tie-break (points → wins → best single round → name), and trophies: Most Wins,
  Podium Regular, Wooden Spoon, High Roller, Most Accurate (quiz answers).
- **Session transport** (`server/index.ts`): per-room `roomSessions`, `session` /
  `session-vote` messages, host-token `POST /session/start`, `/session/end`,
  `/end-game`; scoring on game finish; abort without points; cleanup on room
  deletion and disconnect; new seats blocked while a rumble is active.
- **Host screen**: Royal Rumble setup (5 / 8 / All, Vote / Random), live vote
  board, standings, Start round, End rumble, final champion/trophy board, and a
  double-confirm End game button in the top bar.
- **Phone controller**: votable session card with live counts, your points,
  final champion/trophies and "you finished #n"; returns to voting when a game
  finishes; rejoin restores the session view.
- **18 game plugins** under `games/*/server.ts`; all pass the automated
  playthrough, manifest, garbage-input and privacy probes.
- **Server hardening**: host-token start auth, unique room names, per-game
  try/catch, result hold, local QR generation, optional TLS, local fonts.
- **Tests**: 101/101 pass, including 11 pure session-engine tests and a real
  socket/HTTP session flow (vote → start → abort → play → score → clear).

## In Progress
- None.

## Next Three Actions
1. Playtest a full rumble on real phones on the same LAN.
2. Decide whether sessions should survive a server restart (currently in-memory).
3. Consider pruning candidates if enough players leave that a candidate no
   longer fits; the roster is otherwise frozen for the life of a rumble.

## How to Run & Test
```bash
cd /home/sulav/Projects/TBRN-Games
npm run typecheck   # 0 errors
npm run lint        # 0 errors (93 warnings)
npm test            # 101/101 pass
npm run probe       # 0 issues
PORT=3100 npm start # server
```
Open `http://localhost:3100` on the laptop; phones open `/controller?room=<CODE>`
or scan the QR code.

## Failing Tests / Known Issues
- No failing tests.
- Rumble state is in memory; a server restart clears the series.
- The session roster is fixed at start; a player who leaves and does not rejoin
  stays in the standings with their existing points.
- Browser UI was exercised manually with Playwright (host + two phone contexts),
  but that flow is not part of `npm test`.
- Legacy scaffold (`public/`, `src/`, `test/`, `dist/`) stays excluded from
  typecheck.

## Decisions Made
1. Rumble lengths are 5, 8 or all eligible games.
2. Points are 10 / 6 / 3 / 1 by placement; champion ties break by wins, then best
   single round, then name.
3. Each round is chosen by one private phone vote per player or by random pick.
4. End game aborts the round without points and reopens voting for the same round.
5. New phones cannot take a fresh seat mid-rumble; rejoin tokens still work.
6. Trophies are honorary: Most Wins, Podium Regular, Wooden Spoon, High Roller,
   and Most Accurate when a quiz round was played.
7. The server remains the only authority for votes, points and hidden state.

## Open Questions for Human
1. Should a rumble survive a server restart?
2. Should game-point weights change for longer series?
