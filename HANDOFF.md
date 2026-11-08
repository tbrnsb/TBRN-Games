# HANDOFF

## Current state
Platform expansion phases 2-6, branch `Games-expansion`. Phase 1 audit is
committed (`docs/EXPANSION_AUDIT.md`). 37 games in the tree: 22 enabled and
15 retired but kept, one catalog entry per game directory (no aliases).

Last gate: `npm test` 1028/1028 · typecheck clean · lint 0 errors (warnings
only) · `npm run probe` 126 runs, 0 issues · `npm run probe -- --all` 176
runs, 0 issues.

## Done
- Phase 2: catalog/enabled registry, eight seats with colour+shape, shared
  scoring (`f(N)`, rank points), vote layouts, presence/spectators/reactions,
  below-min pause, results/awards, interlude/ticker, sound/TTS.
- Phase 3 (all 21 existing games): widened to eight where the game supports
  it, scaled payouts, secrecy and reveal fixes, result stats; one commit per
  game (detail in `.orchestrator/STATE.md`).
- Phase 4: Guess the Imposter content pack (168 entries / 14 categories),
  engine (39 tests), TV renderer, host settings panel, phone paths.
- Phase 5 (presets/engine/transport/UI): five Rumble playlists as data;
  resolver with bench then kind fallback and TV swap lines for N=3..8; preset
  session state, per-game re-resolution, interlude, double-last, late joiners
  and summary; preset start/skip/next/end API with slot options and on-disk
  save; TV preset picker, slot progress and host controls, podium +
  leaderboard + awards finale, phone interlude/finale cards; vote UI removed.
- Phase 6 probe: every enabled game at every valid count (126 runs after the
  roster swap), `--all` for retired games (176 runs); 0 issues.
- Phase 6 secrets: `tests/tv-secrets.test.ts` scans every enabled game at min
  and max count; a coverage matrix fails if a newly enabled game is missed.
- Phase 6 docs: `docs/PLAYER_COUNTS.md` (22 enabled, 15 disabled, 37 total)
  plus Rumble TV/phone UI and secret-scanner decisions.
- Phase 6 parity: `tests/parity-34.test.ts` compares seeded 3-4 standalone
  runs against fixtures from baseline `085eeec`; 14 exact-compared, 7 on a
  fail-closed exemption list, `guessimposter` skipped. Four round counts were
  restored to baseline at 3-4 (Dumb Inventions 2, Fakin' It 3, Frankenanswers
  2, Stowaway 4) with brief counts from five up; the `Parity` row records it.
- Phase 6 cap alignment: Survive's 1500 round-gain cap applies from five
  players up, like Frankenanswers/Dumb Inventions/Bracket/Slogan Shirts; 3-4
  keep uncapped totals for parity.
- Phase 6 disconnects: `tests/disconnect-matrix.test.ts` drops and rejoins a
  phone in every phase of poker, drawful, bluff and guessimposter.
- Phase 6 scaling: `tests/scaling-bounds.test.ts` — per-game ceilings at
  every valid N plus driven min/max rounds; 14 documented >1500 exceptions.
- Phase 6 layout: `tests/layout-fit.test.ts` renders every renderer at
  1080p/720p with 8 long names, host geometry and a 360dp phone audit.
- Phase 6 acceptance gaps: `GAMES.md` ranges match the catalog (Guess the
  Imposter added); the HTTP start gate proves TOO_MANY_PLAYERS stays in lobby.
- CI: `.github/workflows/ci.yml` runs `npm run probe` on Ubuntu and Windows
  after the test suite.
- Rumble mode: both preset start paths inject `rumble: true`, `mode:"rumble"`
  (a slot's own mode wins, e.g. quiz `fast`) and `rounds` from the catalog;
  all 22 games treat `options.rounds` as authoritative, so presets run the
  brief's shorter Rumble lengths. Standalone play is unchanged.
- Darts (2026-11-08): aim is a constant-speed two-stage timing lock
  (`AIM_SWEEP_MS = 1200`, X then Y), 3 darts a turn and 501 unchanged. The
  roster swapped Darts in for Archery (Archery kept but disabled), Darts runs
  20 standalone / 8 Rumble rounds and both presets list it. Catalog, preset,
  TV-secrets, layout, Rumble-mode, parity and scaling suites updated; parity
  keeps Darts EXEMPT with the 20-round count, 180 ceiling and a throw-score probe.

## In progress
None. Roster swap is complete and the full gate is green.

## Next three actions
1. Human gates: review, push, merge.
2. Optional: delete the unused archery parity fixtures if the roster stays.
3. Next planned phase from the brief.

## Known issues
- `tests/wordchain.test.ts` can flake: random starting letter with dictionary
  gaps. Pre-existing; needs a deterministic fixture.
- Occasional fixture/port race (reconnect, randomised poker). Treat as flakes
  until reproduced.
- Lint baseline is warning-only; do not treat warnings as failures.

## How to run
```bash
npm start          # PORT env, default 3000
npm test
npx tsc --noEmit
npm run lint
npm run probe      # --all includes retired games
```
Do not push, merge or tag without being asked.
