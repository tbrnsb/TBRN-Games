# HANDOFF

## Current state
Platform expansion phases 2-6, branch `Games-expansion`. Phase 1 audit is
committed (`docs/EXPANSION_AUDIT.md`). 36 games in the tree, 22 enabled,
15 retired but kept (two overlap in the counts via catalog aliases).

Last gate: `npm test` 999/999 · typecheck clean · lint 0 errors (1055 warnings)
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
- Phase 6 docs: `docs/PLAYER_COUNTS.md` — every game's hard and ideal range,
  generated from the catalog (22 enabled, 15 disabled, 37 total), and two new
  `docs/DECISIONS.md` rows for the Rumble TV/phone UI and the secret scanner.
- Phase 6 parity restore: cross-version parity test vs baseline `085eeec`
  exposed four round-count changes at 3-4; the human chose to restore the
  baseline counts at 3-4 (brief counts from 5 up) for Dumb Inventions (2),
  Fakin' It (3), Frankenanswers (2) and Stowaway (4), keeping brief-ordered
  rule changes at all counts with the deviation logged. Tests corrected to
  the count-aware rule; a `Parity` row records the decision.
- Phase 6 cap alignment: Survive's 1500 round-gain cap now applies only from
  five players up, like Frankenanswers/Dumb Inventions/Bracket/Slogan Shirts;
  3-4 keep uncapped totals for parity (a stacked 4-player round pays 1700).
  Tests assert the exact uncapped vector at 3-4 and the cap at 5-6.
- Phase 6 parity: `tests/parity-34.test.ts` compares seeded 3-4 standalone
  runs against fixtures recorded from baseline `085eeec`. 14 games are
  exact-compared; 7 sit on a fail-closed exemption list (written reasons)
  that still asserts baseline round counts, cap ceilings with 5-player cap
  probes, and exact payout-formula probes; `guessimposter` is skipped as
  baseline-absent. A newly enabled game fails the suite until classified.
- Phase 6 disconnects: `tests/disconnect-matrix.test.ts` drops and rejoins a
  phone in every non-terminal phase of poker (6), drawful (4), bluff (3) and
  guessimposter (8), asserting seat/private-state/input survival and a
  below-minimum pause per game. Phase coverage is fail-closed in both
  directions. Observed design: an away clue-holder in Guess the Imposter
  forfeits the turn to the next seat on the next tick (the rejoined phone
  acts when its turn returns).
- CI: `.github/workflows/ci.yml` now runs `npm run probe` after the test
  suite on both Ubuntu and Windows, so the 130-run every-game/every-N gate
  is enforced on push and pull request.
- Phase 6 scaling: `tests/scaling-bounds.test.ts` — every enabled game at
  every valid N, with a per-game ceiling derived from its scoring code and a
  driven worst-case round at min and max N. The only >1500 pairs are 14
  documented exceptions, all human-decided (3-4 parity stacking and poker
  chip pots); coverage is fail-closed in both directions.
- Phase 6 layout: `tests/layout-fit.test.ts` — every enabled game renderer
  at 1080p and 720p with 8 players and 12-character names, host-board
  geometry helpers, and a 360dp phone audit of tap targets (>=44px) and
  fluid widths. Findings queued for a fix: rank controls unstyled
  (Frankenanswers), draw swatches 30/34px (Drawful/Slogan Shirts),
  single-column choice wrapping, and a 40px leave button.

## In progress
Phase 6 verification.

## Next three actions
1. Scaling bound suite (brief 7.3): per-game per-N ceilings, written
   exceptions for parity-protected 3-4 stacking and poker pots.
2. Layout checks 1080p/720p/360dp (brief 7.8); add `npm run probe` to CI.
3. Final critic (family differs from authors), then final report.

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
