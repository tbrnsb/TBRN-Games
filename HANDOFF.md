# Handoff

- Current phase and step: F1 Lobby — implementation complete, awaiting review
- Last commit: `cbaf5f3` F0 commit; F1 is uncommitted on `foundation/f1`
- Status: F1 is implemented in the working tree, branched from `cbaf5f3`. Local
  lint, typecheck, 35 tests, and build pass after the review fixes. F1 is not
  committed, pushed, or CI-tested yet. `foundation/f0` remains unmerged.

## Done
- F0: committed as `cbaf5f3`, pushed, and green on Ubuntu/Windows CI (run
  39975503218); real phone check showed "Connected to the game server."
- F1 transport: `ws` runtime dependency and `@types/ws` dev dependency; the
  lockfile was refreshed with install scripts disabled.
- Room: four players; names trimmed to 1-20 characters, with blank and
  control-character names rejected and duplicates allowed; server-generated IDs
  and random resume tokens; two-minute disconnected-seat reservation; restart
  clears the room.
- Protocol: WebSocket endpoint `/ws`; public lobby broadcast; private controller
  state only to its owner; malformed input rejected; 4 KB payload cap; tokens
  never appear in lobby state.
- Pages: laptop shows the public lobby; phone joins, stores its token in
  localStorage, resumes after reconnect, and shows its own controller.
- Tests: 35 total (18 new for room rules and WebSocket behavior), written before
  implementation.
- Compiled-server smoke check passed (lobby, joined, lobby, controller).
- README and DECISIONS updated for F1; LESSONS already recorded the phase-size
  guidance in F0.
- Reviewer found two low-severity issues: a phone could stall after a
  `seat_connected` resume race, and binary-frame rejection was untested. Fixer
  added bounded resume retries and a binary-frame assertion; checks were rerun
  and pass.
- A final Reviewer pass verified both fixes and returned CLEAR with no findings.

## In progress
- Final review is clear; commit and push of `foundation/f1` are authorized.

## Next three actions
1. Commit and push `foundation/f1`; watch Ubuntu/Windows CI.
2. Run the real laptop + phone lobby check.
3. Plan the next step (game/plugin interface) after F1 is accepted.

## Run and test
- `npm run dev` or `PORT=4000 npm run dev`.
- Linux checks with Node 24.22.1, all exit 0: `npm run lint`,
  `npm run typecheck`, `npm test` (35 pass), `npm run build`.
- `npm start` runs the compiled `dist/server/main.js`.

## Failing tests and known issues
- No failing tests or known code issues.
- F1 has not been pushed, so it has no CI run yet.
- The real F1 phone/laptop lobby check has not been run.
- Resume retry is bounded to five attempts after a `seat_connected` error.

## Decisions
- Repository is private for now; free OpenCode models only.
- F0 is HTTP-only; F1 adds the WebSocket lobby described in `DECISIONS.md`.
- Four players, 1-20 character names, server IDs and tokens, two-minute seat
  reservation, public lobby plus private controller state.
- The game/plugin interface is deferred to its later step.
- `actions/checkout@v7` and `actions/setup-node@v7` ran successfully in F0 CI.
- Dependencies were installed outside Build; ESLint is `^10.13.0` and `ws` is
  the new runtime dependency.

## Open questions
- Confirm the theme palette and font before finalizing the theme.
- Confirm the separate content-pack license before publishing packs.
- Confirm stricter PORT parsing (reject `0x1F`, `1e2`, surrounding spaces).
- Confirm whether all non-GET methods should stay 404 before gameplay builds on it.
- Define the game/plugin interface scope for the next step.
