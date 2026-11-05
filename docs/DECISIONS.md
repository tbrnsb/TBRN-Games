# Decisions

One line per decision, with the reason. Game rules and specs live in
`PLATFORM_EXPANSION_BRIEF.md`.

| Date | Area | Decision | Reason |
|---|---|---|---|
| 2026-11-06 | Seats | Seats are 8 stable slots assigned to the lowest free index on join; a seat is only reused after its owner is reaped or removed. | A player's colour/shape must not swap between games or when someone else leaves. |
| 2026-11-06 | Seats | Seat identity is `{ index, color, shape, emoji }`, with both a shape name and a mono glyph. | Colour alone is not accessible; the shape works on every display and in the canvas renderer. |
| 2026-11-06 | Names | Join names are trimmed, then truncated to 12 characters, then deduplicated as `Ana`, `Ana 2`, `Ana 3`. | Matches the brief; deduplication after truncation stops names that only differ past 12 characters from colliding. |
| 2026-11-06 | Names | The numeric dedupe suffix counts toward the 12-character cap, so a 12-character name shortens its base before the suffix. | Keeps every name inside the same cap without a second, longer limit. |
| 2026-11-06 | Rooms | The lobby always has 8 seats; a game's own `maxPlayers` is only checked when starting it. | Phase 2 raises the platform, not every game; small games stay greyed out until their per-game task widens them. |
| 2026-11-06 | Registry | `shared/game-catalog.ts` is the single source for display name, enabled, kind, ideal range, minutes, dropout policy, content packs and `scale()`. `manifest.json` keeps id/name/hard limits/copy; the loader merges the catalog over it. | The lobby, start gate and Rumble must not disagree; hard ranges mirror the JSON and a test fails on drift. |
| 2026-11-06 | Registry | Kind is the action players perform: writing (bluff, writevote, splitroom, survive, frankenanswers, bracket, dumbinventions), drawing (drawful, sloganshirts), deduction (stowaway, fakin), trivia (quiz, percentile), skill (archery, arena, racing), party (mostlikely, blather, slideroulette, mindmeld), cards (poker). | The Rumble resolver substitutes within a kind, so kind must describe the play, not the theme. |
| 2026-11-06 | Registry | Drop-out policy: `continue` for timer-driven games, `void-round` when the round needs that role (artist, presenter, writer, Stowaway, Faker, guesser), `pause` when a turn has no timer (archery aim), `forfeit` when leaving decides a duel/match (bracket, guess who, spin war, word chain, last seat). | Each game declares how a missing player affects its round; the platform does not guess. |
| 2026-11-06 | Registry | `scale()` reports today's implemented rounds in both modes; `minutes.rumble` uses the brief's shorter Rumble target. Timers are whole seconds. | Phase 2 records reality; per-game tasks split standalone from rumble. |
| 2026-11-06 | Registry | `enabled: false` is a registry flag, never a delete. Unknown or uncatalogued ids count as disabled. | Games leave the lobby without leaving the tree, and a half-registered game cannot ship. |
| 2026-11-06 | Scoring | Reserved: `f(N) = min(1, 3/(N-1))` and `rankPoints(rank,N) = round(100*(N-rank)/(N-1))` live in the shared scoring module; fixed payouts never scale. | Brief 3.3; 3-4 player results must stay identical. |
| 2026-11-06 | Scoring | `shared/scoring.ts` rounds half-up, gives a tie block the competition rank of its first position with each tied player receiving the rounded average of the block's rank points, breaks equal raws by id, and returns factor 1 / the base payout / 100 points for `N < 2`. | Brief 3.3 says `round()` and "share the average" without pinning the integer or tie order; games and the round-sanity test need one exact, deterministic rule. |
