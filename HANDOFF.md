# Handoff

- Current phase and step: F3 Same Wave — reviewed, checks green, committing
- Last commit: `da30b7a` docs: record F2 commit and CI results
- Status: F0–F2 are complete and CI-green on their foundation branches. F3 is
  implemented in the working tree on `foundation/f3` (branched from `da30b7a`).
  Lint, typecheck, 74 tests, and build pass, and the re-review is CLEAR. F3 is
  not committed or pushed yet. `main` and `foundation/f0` are untouched, and
  nothing is merged.

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
- README, DECISIONS, and LESSONS updated for F3.

## In progress
- Commit and push `foundation/f3`, then watch Ubuntu/Windows CI. No merge.

## Next three actions
1. Commit and push `foundation/f3`; monitor CI and fix clear failures.
2. Show the 24 prompt texts to the project owner for approval.
3. After approval, keep the branch unmerged until the human decides.

## Run and test
- `npm run dev` or `PORT=4000 npm run dev`.
- Linux checks with Node 24.22.1, all exit 0: `npm run lint`,
  `npm run typecheck`, `npm test` (74 pass), `npm run build`.
- `npm start` runs the compiled `dist/server/main.js`.
- CI runs lint, typecheck, and tests on Ubuntu and Windows for every push.
- Real Same Wave check on three or four phones has not been run.

## Failing tests and known issues
- No failing tests or known code issues.
- F3 is uncommitted and has no CI run yet.
- Reconnect has not been tested on a real phone.
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
