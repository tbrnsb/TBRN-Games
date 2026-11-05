# HANDOFF

## Current state
Platform expansion phases 2-6 in progress, on branch `Games-expansion`.
Phase 1 audit is committed (`docs/EXPANSION_AUDIT.md`). 36 games in the tree,
21 enabled, 15 retired but kept.

Last gate: `npm test` 265/265 · typecheck clean · lint 0 errors (236 warnings)
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
- Phase 2.5a: presence (`active`/`away`/`left`), 30 s rejoin grace, mid-game
  spectators promoted next game, leave control, 8 emoji reactions with a
  2-second server-side limit and a floating TV animation.
- Phase 2.5b: auto-pause when connected players fall below a game's minimum,
  60 s host offer (Wait / Resume / End game), frozen game clock, host token on
  the host phone, pause overlay on TV.

## In progress
Phase 2 platform foundation: result/award schema and the between-game
interlude plus TV watchability.

## Next three actions
1. Result/award schema from game stats.
2. Between-game interlude, waiting-on card, sound/TTS hooks.
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
