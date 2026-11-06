# HANDOFF

## Current state
Platform expansion phases 2-6, branch `Games-expansion`. Phase 1 audit is
committed (`docs/EXPANSION_AUDIT.md`). 36 games in the tree, 22 enabled,
15 retired but kept (two overlap in the counts via catalog aliases).

Last gate: `npm test` 822/822 · typecheck clean · lint 0 errors (954 warnings)
· `npm run probe` 130 runs, 0 issues.

## Done
- Phase 2 (all): catalog/enabled registry, eight seats with colour+shape,
  shared scoring (`f(N)`, rank points), vote layouts, presence/spectators/
  reactions, below-min pause, results/awards, interlude/ticker, sound/TTS.
- Phase 3 (all 21 existing games): widened to eight where the game supports
  it, scaled payouts, secrecy and reveal fixes, result stats. Details in
  `.orchestrator/STATE.md` with one commit per game.
- Phase 4: Guess the Imposter content pack (168 entries / 14 categories),
  full engine (39 tests), TV renderer, host settings panel, phone paths.
- Phase 5 presets: five Rumble playlists as data, resolver with bench then
  kind fallback and TV swap lines, validated for N=3..8.
- Phase 5 engine: preset session state, per-game re-resolution, interlude,
  double-last, late joiners, summary; placement points unchanged.
- Phase 5 transport: preset start/skip/next/end API, slot options passed to
  games, late joins at boundaries, on-disk Rumble save per room code.
- Phase 5 client UI: preset picker on the TV, slot progress with swap lines,
  host next/swap/end controls, podium + leaderboard + awards finale; phone
  between-games and finale cards; session vote UI removed.
- Phase 6 probe: every enabled game at every valid count (130 runs), with
  `--all` for retired games. Probe 0 issues.
- Phase 6 secrets: `tests/tv-secrets.test.ts` scans every enabled game at its
  min and max count — hole cards, roles, secret words, lookalikes, private
  prompts and unrevealed answers stay off the TV payload in every hidden
  phase; a coverage matrix fails if a newly enabled game is not scanned.

## In progress
Phase 6 verification.

## Next three actions
1. 3-4 score parity fixtures, scaling bounds, disconnect/rejoin matrix,
   layout checks (1080p / 720p / 360dp).
2. `docs/PLAYER_COUNTS.md`, decisions/HANDOFF updates, final critic.

## Known issues
- `tests/wordchain.test.ts` can flake: it picks a random starting letter and
  the dictionary has gaps. Pre-existing, needs a deterministic fixture.
- Occasional fixture/port race seen once in `tests/reconnect.test.ts` and the
  randomised poker test. One unreproduced `actual: undefined` failure after
  the mindmeld suite. Treat as flakes until reproduced.
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
