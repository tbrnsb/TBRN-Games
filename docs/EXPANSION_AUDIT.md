# Expansion Audit (Phase 1)

Read-only audit against the 8-player / Royal Rumble / Guess the Imposter brief.
No code changed in this phase.

Date: 2026-11-06. Repo: `/home/sulav/Projects/TBRN-Games`. Gate at audit time:
196 tests, typecheck clean, lint 0 errors, probe 0 issues, 36 games.

---

## 1. Player ranges — current vs target

| Game | Now | Brief target | Status | Enabled after change |
|---|---|---|---|---|
| archery | 1-4 | 1-8 | widen | yes |
| arena | 2-4 | 2-4 | ok | yes |
| bdate | 3-4 | — | retired | no |
| blather | 3-4 | 3-8 | widen | yes |
| bluff | 3-4 | 3-8 | widen | yes |
| bracket | 3-4 | 3-6 | widen | yes |
| darts | 1-4 | — | retired | no |
| dictionarium | 3-4 | — | absorbed into Bluff pack | no |
| drawful | 3-4 | 3-8 | widen | yes |
| dumbinventions | 3-4 | 3-6 | widen | yes |
| fakin | 3-4 | 3-8 | widen | yes |
| frankenanswers | 3-4 | 3-6 | widen | yes |
| golf | 1-4 | — | retired | no |
| guesswho | 2-4 | — | retired | no |
| hangman | 1-4 | — | retired | no |
| knifethrow | 1-4 | — | retired | no |
| lastseat | 3-4 | — | retired | no |
| mashup | 3-4 | — | retired | no |
| mindmeld | 2-4 | 2-8 | widen | yes |
| mindreader | 3-4 | — | retired | no |
| mostlikely | 3-4 | 3-8 | widen | yes |
| percentile | 2-4 | 2-8 | widen | yes |
| poker | 2-4 | 2-8 | widen | yes |
| quiz | 1-4 | 1-8 | widen | yes |
| racing | 1-4 | 1-8 | widen | yes |
| slideroulette | 3-4 | 3-8 | widen | yes |
| sloganshirts | 3-4 | 3-8 | widen | yes |
| snakes | 1-4 | — | retired | no |
| spinwar | 2-4 | — | retired | no |
| splitroom | 3-4 | 3-8 | widen | yes |
| stowaway | 3-4 | 3-8 | widen | yes |
| survive | 3-4 | 3-6 | widen | yes |
| trivia | 1-4 | — | absorbed into Quiz fast mode | no |
| wordchain | 2-4 | — | retired | no |
| wordspud | 2-4 | — | retired | no |
| writevote | 3-4 | 3-8 | widen | yes |
| *(new)* guessimposter | — | 3-8 | build | yes |

Counts match the brief: 22 enabled (21 existing + 1 new), 15 retired but kept in the tree.

---

## 2. Hard-coded 4s found

| Location | What | Impact |
|---|---|---|
| `server/index.ts:41` | `MAX_PLAYERS_PER_ROOM = 4` | **Hard blocker.** The room refuses a 5th seat even if a game allows it. |
| every `games/*/manifest.json` | `maxPlayers: 4` | Every game caps at 4. |
| every `games/*/server.ts` | inline `maxPlayers: 4` (merged over by the JSON now) | Same, but the JSON wins at load. |
| `server/index.ts:806` | seat cap derived from the manifest | Correct mechanism, wrong values. |
| `games/snakes/server.ts:43` | `COLORS` has 4 entries | Uses `i % length`, so it does not break at 8, but players 5-8 reuse colours and there is no shape/emoji. Colour-blind unsafe. |
| `games/lastseat/server.ts:422,428` | 4 doors / 4 symbols | A minigame's option count, not seats. No change needed. |

No other seat-indexed arrays were found: seats are built with `players.map(...)` throughout.

---

## 3. Current scoring formulas

| Game | Rule in code | Brief | Delta |
|---|---|---|---|
| bluff | truth 500, fool 200, 6 rounds | same + `f(N)` | needs scaling |
| writevote | 100/vote, 5 rounds | same + f | needs scaling |
| splitroom | `1000 - |yes-no|*(1000/voters)`, minority 150 | same | already scales via voters |
| survive | 700 writer / 300 quoted per vote | same + f | needs scaling |
| frankenanswers | 1000/vote, 100/chip | same + f | needs scaling |
| bracket | 500 semi, 1000 final, 100 voter | same | ok |
| dumbinventions | 1000/vote, **-200 missing chip** | remove penalty | **change** |
| mostlikely | top vote-getter **+`max * 10`** | 500 to top (split on tie), 100 to correct voters | **change** |
| stowaway | detective 500, uncaught 1000, caught category 500 | same + f on detective | needs scaling |
| fakin | voter 200, faker 500 | same + f on voter | needs scaling |
| blather | guesser `1000 - 100*s`, presenter 300/correct | guesser `max(100, 1000 - 20*s)`, presenter 100/correct capped 600 | **change both** |
| slideroulette | presenter 200*avg, author 100 at 4+ | same | ok |
| drawful | artist 500/vote, bluff 250/vote | same + f | needs scaling |
| sloganshirts | winner both authors 1000, others 100/vote | same + f on others | needs scaling |
| quiz | 1000 + up to 500 speed | same | ok |
| mindmeld | 300/match, 1000 jackpot | same + f | needs scaling |
| percentile | exact 1000, `1000-50*d`, bet 500 (+200 if d>20) | same ("keep today's") | ok |
| archery | proximity, up to 100/arrow | same | ok |
| arena | rank only | rank points | ok once rank points exist |
| poker | chips | chips, rank by stack | ok |

---

## 4. Where the platform differs from the brief

### 4.1 Missing from the manifest and registry
No `enabled`, `kind`, `idealMin/idealMax`, `minutes`, `scale(n, mode)`, `dropoutPolicy`
or `contentPacks`. The registry has no filter hook at all — `/api/games` returns every
plugin. Display names live inside each plugin, not in one constants file.

### 4.2 No scoring utilities
There is no `f(N)`, no `rankPoints`, and no shared standings/stats schema. `server/session.ts`
extracts scores per game with a `switch` on game id — that is the closest thing to a
standings adapter, and it is ad hoc.

### 4.3 Rumble conflict (important)
`server/session.ts` already implements a *different* Rumble: players vote for candidate
games, and it scores rounds. The brief describes **preset playlists** with a resolver and
bench substitutions. These are not the same feature. Decision needed at Phase 5: reuse the
existing session scoring shell, or replace the vote-based selection with presets. The audit
recommends **keeping the session scoring/standing machinery and replacing only the
selection step**, because the scoring half already works and is tested.

### 4.4 Lobby and TV
- Lobby does not grey out games by player count; it lists everything and only complains
  after the fact.
- No 8-seat palette, no shape/emoji per seat, no colour-blind enforcement.
- No spectators, no reactions, no between-game interlude, no awards, no captions.
- No pause/skip host controls.

### 4.5 Disconnects
Seats are retained while anyone remains (fixed earlier), with a 30 s rejoin grace. There is
no per-game `dropoutPolicy`, no pause-at-minimum flow, and no spectator state for
mid-game joiners (they are rejected with `GAME_IN_PROGRESS`).

### 4.6 Game-specific gaps
- **quiz**: no Fast mode; `trivia` is a separate plugin to fold in.
- **bluff**: no content-pack split; `dictionarium` is a separate plugin to fold in.
- **bracket**: bracket is hard-coded for 3 and 4 players (duel+bye / two semis+final);
  no power-of-two generalisation, no byes.
- **drawful**: rounds are `min(3, players)`; brief wants one drawing per player (max 8).
- **sloganshirts**: 2 rounds; brief wants one cycle.
- **mindmeld**: no N-1 early-end rule.
- **poker**: action timer exists; side pots, heads-up blind rules and reverse-elimination
  ranking are not implemented. Needs verification at Phase 3(g).
- **arena**: stays 2-4, as the brief allows.
- **guessimposter**: does not exist.

### 4.7 Tests
196 tests exist, all at 1-4 players. There is no bot driver at 5-8, no TV-payload secret
scanner across all games, no resolver tests, and no scaling tests. The probe covers 1-4
with hostile input only.

---

## 5. Recommended order (unchanged from the brief, with one note)

1. Registry + manifest fields + 8-seat lobby + `f(N)` + `rankPoints` + standings schema.
   Everything else depends on these.
2. Retire 15 games via `enabled: false` (no deletions) and fold trivia/dictionarium into
   quiz/bluff as modes/packs.
3. Scale existing games by shared system, bot-testing each group.
4. Guess the Imposter.
5. Rumble presets + resolver (decide 4.3 first), persistence, finale.
6. Verification sweep.

Do not start Phase 3 before Phase 2 lands: every game change depends on the seat cap and
the manifest fields.
