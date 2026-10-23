# Handoff

- Current phase and step: F3 Same Wave — committed, pushed, CI green
- Last commit: `7fb4e1a` F3: add Same Wave game with host flow
- Status: F0–F2 are complete and CI-green on their foundation branches. F3 is
  pushed on `foundation/f3` (branched from `da30b7a`); Ubuntu and Windows CI
  passed (run 39989107606). The 24 prompt texts still need owner review before
  merge or release. `main` and `foundation/f0` are untouched, and nothing is
  merged.

## Done
- F0: HTTP hello-world server, laptop page, phone page; `cbaf5f3`; CI green.
- F1: four-player WebSocket lobby, server names/IDs/tokens, two-minute seat
  reservation, public lobby plus private controller state; `a26c505`; CI green.
- F1 real check: both devices on the same Wi-Fi showed both players and names.
  Reconnect was not tested.
- F2: server-side `GamePlugin` contract, registry, session, injected
  `random`/`now`, and hidden-state tests; `1873ab1`; CI green.
- F3 rules: Same Wave, 3–4 connected players, five rounds, 30-second window,
  secret A/B votes, first vote final, non-voters abstain, majority +1, ties and
  fewer than two votes score 0, tied leaders share the win.
- F3 engine: optional `deadline`, `onDeadline`, and `applyHostAction` plugin
  hooks; `GameSession` routes them; `GameManager` checks the current host and
  builds lobby, game, and spectating controller states.
- F3 host flow: earliest seated connected player is host; on disconnect control
  passes to the earliest connected player; reconnect never restores it
  automatically. Start uses connected players only; late joiners spectate.
- F3 transport: `start_game`, `game_action`, `host_action`, `return_to_lobby`,
  public `screen`, private `controller`, deadline timers, and game-aware
  reconnect/resume.
- F3 UI: laptop lobby plus voting/reveal/final screen; phone lobby start button,
  secret vote buttons, countdown, reveal, score, next-round, early end, and
  return-to-lobby controls; spectator panel.
- F3 tests: room host rules, Same Wave rules/privacy/deadlines, game manager,
  and WebSocket end-to-end flows. 74 tests total.
- Prompt pack: 24 original prompts in
  `src/server/games/same-wave/prompts.ts`, marked as a draft for owner review.
- Reviewer round 1 requested a phone countdown fix; Fixer applied it, checks
  reran green, and round 2 returned CLEAR with no clear findings.
- F3 committed as `7fb4e1a` and pushed to `origin/foundation/f3`; Ubuntu and
  Windows CI passed in run 39989107606.
- README, DECISIONS, and LESSONS updated for F3.

## In progress
- Owner review of the 24 prompt texts. No merge or release.

## Next three actions
1. Review and approve or revise the 24 prompt texts.
2. Run a real Same Wave check with three or four phones.
3. Keep `foundation/f3` unmerged until the human decides.

## Run and test
- `npm run dev` or `PORT=4000 npm run dev`.
- Linux checks with Node 24.22.1, all exit 0: `npm run lint`,
  `npm run typecheck`, `npm test` (74 pass), `npm run build`.
- `npm start` runs the compiled `dist/server/main.js`.
- CI runs lint, typecheck, and tests on Ubuntu and Windows for every push.
- Real Same Wave check on three or four phones has not been run.

## Failing tests and known issues
- No failing tests or known code issues.
- CI is green for `7fb4e1a`.
- Reconnect has not been tested on a real phone.
- A real Same Wave check with three or four phones has not been run.
- The 24 prompts are draft content and need owner review before merge/release.

## Decisions
- Same Wave is the only F3 game; no other game or content work.
- Host control is dynamic and follows the room's earliest-connected rule.
- A player's first vote is final for that round; voting also closes early when
  the whole game roster has voted.
- Laptop is display-only; all inputs come from phones.
- Prompt text is kept in a separate draft file until approved.

## Open questions
- Approve or revise the 24 prompt texts.
- Confirm the theme palette and font before finalizing the theme.
- Confirm the separate content-pack license before publishing packs.
- Confirm stricter PORT parsing (reject `0x1F`, `1e2`, surrounding spaces).
- Confirm whether all non-GET methods should stay 404.
