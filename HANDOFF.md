# Handoff

- Current phase and step: F2 game/plugin interface — implemented, awaiting review
- Last commit: `f5278b4` docs: record F1 commit and CI results
- Status: F1 is complete on `foundation/f1`; CI is green and the real laptop +
  phone lobby check passed on the same Wi-Fi (both players and names appeared;
  reconnect was not tested). F2 is implemented in the working tree on
  `foundation/f2`, branched from `f5278b4`. Lint, typecheck, 47 tests, and build
  pass, and Reviewer is clear. F2 is not committed or pushed yet. `main` and
  `foundation/f0` are untouched.

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
- README and DECISIONS updated for F2; HANDOFF records the F1 real check.

## In progress
- Human review of the F2 diff and commit approval. No F2 commit or push.

## Next three actions
1. Review F2 and fix any clear findings; rerun the checks.
2. Commit and push F2 after human approval; watch Ubuntu/Windows CI.
3. Define and wire the first game (rules, start/host flow, and UI).

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
- CI is green for `f5278b4`; F2 has no CI run yet.

## Decisions
- Repository is private for now; free OpenCode models only.
- F0 is HTTP-only; F1 adds the WebSocket lobby described in `DECISIONS.md`.
- F2 defines the server-side plugin contract, registry, and session; games are
  added as plugins without editing the engine.
- F2 adds no game rules or content. The first game and its start flow are the
  next step.
- `actions/checkout@v7` and `actions/setup-node@v7` ran successfully in F0 and F1
  CI.

## Open questions
- Define the first game's rules, player count, win condition, and start/host flow.
- Confirm the theme palette and font before finalizing the theme.
- Confirm the separate content-pack license before publishing packs.
- Confirm stricter PORT parsing (reject `0x1F`, `1e2`, surrounding spaces).
- Confirm whether all non-GET methods should stay 404 before gameplay builds on it.
