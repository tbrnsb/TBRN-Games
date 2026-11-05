# HANDOFF

## Current state
Platform expansion phases 2-6 in progress, on branch `Games-expansion`.
Phase 1 audit is committed (`docs/EXPANSION_AUDIT.md`). 36 games in the tree,
21 enabled, 15 retired but kept.

Last gate: `npm test` 495/495 · typecheck clean · lint 0 errors (605 warnings)
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
- Phase 2.6a: optional `results()` game hook, fallback result extraction from
  screen scores, raw scores and per-player stats per Rumble round, and the
  seven briefed awards (max 6 on the finale). Placement points unchanged.
- Phase 2.6b: 15 s between-game interlude with movement arrows and a next-up
  card, always-on score ticker, waiting-on banner, caption/reveal hooks.
- Phase 2.6c: no-asset WebAudio cues, speech-synthesis turn announcements,
  TV settings toggles persisted locally.

- Phase 3 (a) Bluff: 3-8 players, standalone 6 / rumble 4 (3 at 7+),
  truth 500 fixed, fooled 200 x f(N), Facts + 84-entry Dictionary packs,
  nine-option reveal grid, result stats.
- Phase 3 (a) Write & Vote: 3-8, 100 x f(N) per vote, changeable votes,
  six-plus-answer grid, result stats.
- Phase 3 (a) Split the Room: 3-8, writer rotates, standalone 4/…/8 rounds
  (4 kept at 3-4 for parity), rumble min(N,4), 12 scenarios, result stats.
- Phase 3 (a) Survive the Internet: 3-6, derangement pairings, scaled
  700/300 per vote, 1500 round cap, result stats.
- Phase 3 (b) Frankenanswers: 3-6, server-composed answers, scaled
  1000/100, fixed the connector lookup, two-column six-answer reveal.
- Phase 3 (b) Dumb Inventions: 3-6, -200 chip penalty removed, scaled
  1000/vote, pre-reveal TV privacy fixed, two-column reveal.
- Phase 3 (b) Bracket Brawl: 3-6, general power-of-two bracket with secure
  byes, 2 brackets at 3-4 / one at 5-6, new TV bracket renderer, stats.
- Phase 3 (c) Stowaway: 3-8, three-word clue cap, 500 x f(N) correct voters,
  round-1 setup bug fixed, pre-reveal secrecy, stats.
- Phase 3 (c) Fakin' It: 3-8, 5 standalone / 3 rumble rounds, secure-random
  Faker rotation in shuffled cycles with no repeat before every seat has had
  it, 200 x f(N) correct voters, fixed 500 uncaught, eight-seat TV ballot,
  pre-reveal secrecy, result stats.

## In progress
Phase 3: widen each existing game on its own task, in shared-system groups.
Room cap is 8; a game stays at its old max until its own task.

## Next three actions
1. Blather Round (3-8, speed-decayed guesses).
2. Most Likely To (3-8, new top-vote scoring).
3. Slide Roulette (3-8, presenter rotation).

## Known issues
- `tests/wordchain.test.ts` can flake: it picks a random starting letter and
  the dictionary has gaps. Pre-existing, needs a deterministic fixture.
- `tests/poker.test.ts`'s randomized betting run can flake (seen once on
  2026-11-06): the generated action sequence sometimes misses the hand limit.
  Pre-existing and unrelated to the game tasks.
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
