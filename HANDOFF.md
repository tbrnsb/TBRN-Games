# Handoff

- Current phase and step: F2 game/plugin interface — committed, pushed, CI green
- Last commit: `1873ab1` F2: add server-side game plugin interface
- Status: F1 is complete on `foundation/f1`; CI is green and the real laptop +
  phone lobby check passed on the same Wi-Fi (both players and names appeared;
  reconnect was not tested). F2 is pushed on `foundation/f2`; Ubuntu and Windows
  CI passed (run 39983766864). The first-game rules and host/start-flow proposal
  is the next step. `main` and `foundation/f0` are untouched.

## Done
- F0: committed as `cbaf5f3`, pushed, and green on Ubuntu/Windows CI; the real
  phone check showed "Connected to the game server."
- F1: four-player WebSocket lobby, server names/IDs/tokens, two-minute seat
  reservation, public lobby plus private controller state; committed as
  `a26c505`, pushed, and green on Ubuntu/Windows CI (run 39980280605).
- F1 real check: both devices were on the same Wi-Fi, and the lobby showed both
  players and their names. Reconnect was not tested.
- F2 contract: a server-side `GamePlugin` with private state, action reducer,
  public screen view, per-player controller view, finish check, and injected
  `random`/`now`; `defineGame` gives typed plugins a safe wrapper.
- F2 registry: validates game IDs, names, player counts, and required methods;
  rejects duplicate IDs; lists public metadata; `createGameRegistry` builds a
  registry from a game list.
- F2 session: validates the seated players, keeps state private, routes actions,
  rejects unknown players, invalid actions, and actions after the game ends, and
  produces screen and controller views.
- F2 tests: 12 new tests (6 registry, 6 session) using a fixture counter plugin,
  including hidden-state and per-player view isolation checks.
- Reviewer requested a guard-order fix in `GameSession.apply` and a README intro
  update; both were applied, the checks reran, and the re-review returned CLEAR.
- F2 committed as `1873ab1` and pushed to `origin/foundation/f2`; Ubuntu and
  Windows CI passed in run 39983766864.
- README and DECISIONS updated for F2; HANDOFF records the F1 real check.

## In progress
- First-game rules and host/start-flow proposal; no game-specific implementation
  until the proposal is settled.

## Next three actions
1. Settle the first-game rules and host/start flow.
2. Implement the first game plugin and start flow test-first.
3. Run Reviewer/Fixer, checks, and the commit gate.

## Run and test
- `npm run dev` or `PORT=4000 npm run dev`.
- Linux checks with Node 24.22.1, all exit 0: `npm run lint`,
  `npm run typecheck`, `npm test` (47 pass), `npm run build`.
- `npm start` runs the compiled `dist/server/main.js`.
- CI runs lint, typecheck, and tests on Ubuntu and Windows for every push.

## Failing tests and known issues
- No failing tests or known code issues.
- F2 is interface-only: no WebSocket wiring, start/host flow, UI, or playable
  game yet.
- Reconnect has not been tested on a real phone.
- CI is green for `1873ab1`; the first game has not been implemented.

## Decisions
- Repository is private for now; free OpenCode models only.
- F0 is HTTP-only; F1 adds the WebSocket lobby described in `DECISIONS.md`.
- F2 defines the server-side plugin contract, registry, and session; games are
  added as plugins without editing the engine.
- F2 is committed and CI-green. It adds no game rules or content; the first game
  and its start flow are the next step.
- `actions/checkout@v7` and `actions/setup-node@v7` ran successfully in F0, F1,
  and F2 CI.

## Open questions
- Settle the first game's rules, player count, win condition, and start/host
  flow from the pending proposal.
- Confirm the theme palette and font before finalizing the theme.
- Confirm the separate content-pack license before publishing packs.
- Confirm stricter PORT parsing (reject `0x1F`, `1e2`, surrounding spaces).
- Confirm whether all non-GET methods should stay 404 before gameplay builds on it.
