# HANDOFF

## Current state
Platform expansion phases 2-6 in progress, on branch `Games-expansion`.
Phase 1 audit is committed (`docs/EXPANSION_AUDIT.md`). 36 games in the tree,
21 enabled, 15 retired but kept.

Last gate: `npm test` 255/255 · typecheck clean · lint 0 errors (236 warnings)
· `npm run probe` 0 issues.

## Done
- Phase 1 audit.
- Phase 2.1: `shared/game-catalog.ts` (display names, enabled, kind, ideal
  range, minutes, dropout policy, content packs, `scale()`), catalog merged
  into plugin manifests, `/api/games` + game start + Rumble filter by
  `enabled`, TV lobby greys out games with a fit reason.
- Phase 2.2: room ceiling 8, stable 8-seat identity (colour + shape/glyph),
  12-character deduplicated names, TV roster + phone header badges.
- Phase 2.3: `shared/scoring.ts` — `scalingFactor`, `scalePayout`,
  `rankPoints`, `rankWithTies`, `GameResult`/`GameStanding`, award ids and
  the 1500 round bound, with tests.
- Phase 2.4: shared vote layout (1-6 one screen, 7-9 two columns + letter
  badges), canvas vote helper, scrolling 48dp+ phone choices, change-vote
  flag.

## In progress
Phase 2 platform foundation: spectators/reactions, results/awards and the
between-game interlude.

## Next three actions
1. Spectator/reaction/disconnect handling.
2. Results/awards and the between-game interlude.
3. Then widen the games one at a time (Phase 3).

## Known issues
- `tests/wordchain.test.ts` can flake: it picks a random starting letter and
  the dictionary has gaps. Pre-existing, needs a deterministic fixture.
- `server/session.ts` still uses `Math.random` for its existing selection;
  Phase 5 replaces only the selection step with presets.

## How to run
```bash
npm start          # PORT env, default 3000
npm test
npm run typecheck
npm run lint
npm run probe
```

Do not push, merge or tag without being asked.
