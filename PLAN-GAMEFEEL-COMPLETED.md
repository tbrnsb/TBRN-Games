# PLAN-GAMEFEEL-COMPLETED.md

Record of what was actually built, fixed, added and removed. Written against
`PLAN-GAMEFEEL.md`. Visual styling is deliberately untouched — the designer owns that.

Last verified gate: **95 tests pass · typecheck 0 errors · lint 0 errors (109 warnings) · probe 0 issues**.

---

## 1. FIXED — the bug that was breaking every single game

**Symptom:** one player vanished from every lobby, the room capped at 2 controllers,
Spin War showed 2 blades with 3 phones, Bluff refused to start with 3 phones.

**Root cause:** `PLAYER_TIMEOUT_MS` (30 s) deleted a disconnected seat outright. A phone
locks its screen, the WebSocket dies, the seat is reaped, and the phone's rejoin token no
longer resolves → `INVALID_TOKEN` → that phone is dead for the night. Every game then
started one player short, and anything with `minPlayers: 3` could not start at all.

Proven before fixing (real server, real sockets):

```
BEFORE:  Alice, Bob, Carol
Carol's phone locks for 33s
AFTER:   Alice(true), Bob(true)      <- seat deleted
CAROL RECONNECT: ERROR INVALID_TOKEN <- locked out for the night
ROOM FINAL: Alice, Bob
```

**Changes**

| File | Change |
|---|---|
| `server/index.ts` | A disconnected seat is kept as long as anyone else remains in the room. Seats are reaped only when nobody is left. Pruning now happens at game start, where an absent player would stall turns. |
| `server/index.ts` | A rejoin token that no longer resolves, pointing at a room that is **not** mid-game, now takes a fresh seat instead of returning `INVALID_TOKEN`. A phone can no longer be bricked mid-party. |
| `shared/constants.js` | `PLAYER_TIMEOUT_MS` is now overridable via env, so tests can exercise the reap path in milliseconds. |
| `tests/fixtures/server-fixture.ts` | `startServer({ ENV })` accepts per-test env overrides. |
| `tests/reconnect.test.ts` | **New.** 3 regression tests: seat survives the timeout, stale token recovers into a lobby, Bluff starts with 3 connected phones. |

---

## 2. REMOVED — the four games you killed

Deleted: `games/seabattle/`, `games/trafficjam/`, `games/slotcar/`, `games/gravityrun/`.

References cleaned up:
- `tests/games-smoke.test.ts` — dropped the grid driver and their tick budgets; the
  "18 games" assertion became a roster check (no hardcoded count).
- `scripts/deep-probe.ts` — dropped their drivers and budgets.
- `server/session.ts` — dropped the `slotcar` score extractor.

**14 games remain:** archery, bluff, darts, golf, guesswho, hangman, knifethrow,
mostlikely, poker, quiz, racing, snakes, spinwar, writevote.

---

## 3. ADDED — controller primitives (the layer that was missing)

`shared/controllers.ts` had seven layouts and none of them could express a slider, a
joystick, a drag or a mash. Nine were added. This is why Darts had no slider: the thing
did not exist.

| Layout | Purpose | Input emitted |
|---|---|---|
| `slider` | One axis, live drag | `{ slider: { axis, value } }` (0..1) |
| `dual-slider` | Horizontal **and** vertical sliders + action button | `{ slider: {…} }`, `{ action: "action" }` |
| `pad` | 2D joystick with pointer capture | `{ pad: { x, y } }` (-1..1, y up) |
| `aim` | Joystick + power slider + action button (golf) | `{ pad }`, `{ slider }`, `{ action }` |
| `tap-race` | Mash button with live progress + rival count | `{ tap: true }` |
| `board` | Shared tile grid, flip or pick, optional question buttons | `{ board: { id, action } }`, `{ choice }` |
| `numpad` | Numeric entry with presets, min/max clamp | `{ amount }` |
| `canvas` | Vector drawing, emits compressed stroke points | `{ stroke: { points, color } }` |
| `chat` | Private contact list + thread | `{ chat: { to, text } }` |

Also added in `client/controller/index.html`: functional CSS for all nine (slider tracks,
knob, pad, mash button, tile grid, keypad, drawing surface, chat panes). **Unstyled by
design** — this is the designer's canvas.

`ControllerType` was extended in `shared/controllers.ts` and in all 14 game servers (they
each carry their own inline copy of the union).

---

## 4. CHANGED — the games

### Darts — was: random dice. Now: real aim
- **Before:** `onInput(instance, playerId, _input)` — the input parameter was literally
  unused. Every tap threw a dart at a random angle and power.
- **After:** two sliders (horizontal + vertical) set a real board position; the THROW
  button fires at that position. Bull at centre = 50, off-board = 0.
- Added a 20-round cap so a cold game still finishes; lowest score wins at the cap.
- Uses the game clock, not `Date.now()`.
- `controllerType`: `one-button` → `dual-slider`.

### Golf — was: d-pad. Now: joystick + power slider + SHOOT
- Joystick direction aims (screen y is down, so the stick's up is negated); the power
  slider sets strength directly; SHOOT fires.
- Old d-pad input still accepted so nothing regresses.
- Par + 4 pick-up cap preserved.
- `controllerType`: `dpad` → `aim`.

### Racing — was: lane dodging. Now: pure mash
- Rewritten. Every tap adds speed; speed bleeds off at 55%/s, so a fast masher wins but
  cannot teleport. 3-second countdown, 100-unit track, 60-second buzzer if nobody finishes.
- Winner is the first across the line; at the buzzer it is whoever is furthest.
- Renamed to **Tap Race** in the manifest.
- `controllerType`: `left-right` → `tap-race`.

### Guess Who — fixed opponent, shared board, manual flips
- **Fixed opponent per player** (`opponents: [i+1 % n]`) instead of `nextLiving()`. The old
  rotating opponent made 3-4 player games unwinnable by reasoning: you learned about B,
  then faced C next turn. Deductions now accumulate.
- **The server no longer auto-prunes the board.** A question answer is narrated
  ("Ana asked Bob: 'Red hair?' — YES") and the player flips their own faces, exactly like
  the tabletop game. That was the "remove options you don't see fit" request.
- The controller is now a `board`: the whole shared pool on the phone, tap to flip, tap
  again to un-flip, opponent name in the header.
- Guess buttons appear once the board is down to **6 or fewer** faces, so the phone never
  turns into a 24-button wall.
- `screenState` now emits `notice: "Ana is down to 2 options"` for the TV.
- `controllerType`: `choice` → `board`.

---

## 5. Verification

| Check | Result |
|---|---|
| `npm test` | **95 / 95 pass** |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 109 warnings |
| `npm run probe` (14 games × 1-4 players, hostile inputs) | **0 issues** |
| Reconnect regression (3 tests) | pass |

New tests added this pass:
- `tests/reconnect.test.ts` — seat retention, stale-token recovery, Bluff starts with 3.
- `tests/game-logic.test.ts` — darts aim decides the throw; guess who fixed opponent +
  private flips; racing taps drive the racer and the masher wins.

---

## 6. NOT DONE (honest list)

These were in scope and are **not** built yet:

1. **Poker** — host-chosen starting stack ("everyone equal" option), numpad bet sizing,
   N-round limit with largest stack winning. Needs an engine change (`onStart` options
   argument) plus a pre-game control on the host screen.
2. **Tutorials** — a `howTo` field on every manifest, shown on the phone and the TV before
   the first input.
3. **New games** — Percentile Estimation, Drawful-style drawing, Split the Room, Fakin' It,
   Survive the Internet, Blather 'Round, Tee K.O./Champ'd Up. The `canvas` and `chat`
   layouts they need now exist, but no game uses them yet.
4. **Per-game `theme.json`** and the announcer (`server/announcer.ts`).
5. **Visual restyle** — leaving `DESIGN.md`'s synthwave/neon/glass direction in place is the
   designer's call; the tokens, kit and renderers are untouched.

### Notes for the designer
- All new layouts emit plain DOM classes: `.slider-track`, `.slider-knob`, `.pad`,
  `.pad-knob`, `.race-btn`, `.board-grid`, `.board-tile`, `.numpad-key`, `.draw-surface`,
  `.chat-thread`. Restyle there, no logic changes needed.
- `board` tiles accept an optional `image` URL — that is the hook for real avatars.
- Darts and golf expose live aim state on the TV (`screenState().aim`) for a crosshair.

---

## 7. How to run

```bash
npm start            # port 3000 (or PORT=xxxx)
npm test             # 95 tests
npm run typecheck
npm run lint
npm run probe        # invariant harness, 14 games
```

Phones must reach the laptop: **ufw now allows 3000 and 3100/tcp** (verified in
`/etc/ufw/user.rules`). QR encodes `http://<lan-ip>:<port>/controller?room=<id>`.

---

## 8. NEW GAMES — wave 1 (added after the first report)

Four games, playable end to end, each using the new controller primitives. The roster is
back to **18 games**.

| Game | Controller | Rules implemented |
|---|---|---|
| **Percentile** | `slider` → `choice` per phase | One player estimates a real statistic on a 0-100 slider; everyone else bets HIGHER/LOWER. Exact = 1000, within 15 = 1000 − 50×delta, directional bets = 500 (+200 when the miss was big). 5 rounds. |
| **Split the Room** | `text` → `choice` | Writer fills a blank in an absurd scenario; everyone else votes YES/NO. Score = 1000 − \|yes−no\| × (1000/voters). Minority voters get +150. 4 rounds. |
| **Dictionarium** | `text` → `choice` | Obscure word, everyone invents a definition, everyone votes for what they think is real (cannot vote for their own). +100 per vote to a bluff author, +500 for finding the truth. 4 rounds. |
| **Drawful** | `canvas` → `text` → `choice` | One player draws a ridiculous prompt with vector strokes; others submit fake titles; everyone votes. Drawer +500 per vote for the real title, bluffers +250 per vote. Up to 3 rounds. |

Design notes:
- Games now report `mode` (`slider` / `canvas` / `text` / `choice` / `wait`) in their
  controller state. The test drivers read that, so new games need no per-game test code.
- Phase-dependent controllers use the existing per-phase `controllerType` override in
  `server/index.ts` — no engine change was needed.
- Drawful stores strokes as `[x, y]` pairs (0..1), never raster data. Cap: 200 strokes,
  300 points each.

Probe: `percentile`, `splitroom`, `dictionarium`, `drawful` all report **clean** at every
player count, including hostile input sweeps.

### Still to add (14 of the 18 blueprints)
Hidden Impostor (Push the Button), Fakin' It, Patently Stupid, Talking Points,
Bracketeering, Survive the Internet, Job Job, Blather 'Round, Trivia Murder Party,
Word Spud, Role Models, Monster Seeking Monster, Civic Doodle, Tee K.O.

The `chat` primitive exists for Monster Seeking Monster but no game uses it yet.
`theme.json` per game and `server/announcer.ts` are not built.

---

## 9. NEW GAMES — wave 2 (five more)

| Game | Phone UI | Rules implemented |
|---|---|---|
| **Fakin' It** | choice | Everyone gets the same instruction except one Faker, who gets a fake one. 25 s of acting, then everyone votes. Strict majority catches the Faker (+200 to correct voters), otherwise the Faker escapes (+500). 3 rounds, faker rotates. |
| **Quick Trivia** | choice | 6 rapid question, 10 s each. Points scale with speed: `max(100, 1000 - seconds*90)`. Reveal shows the answer. |
| **Word Spud** | text → choice | Word-chain by association. Current player submits a linked word, everyone else votes ACCEPT/REJECT. Accept moves the anchor and scores +100; reject keeps the anchor and costs 50. 6 links. |
| **Survive the Internet** | text → text → choice | Innocent question, then you write a headline that makes *the next player's* answer look terrible, then vote for the funniest. Votes split 700 to the writer / 300 to the quoted author. 3 rounds. |
| **Blather Round** | text → text | One presenter gets a secret word and describes it without naming it; everyone else races to guess. Accepts typos via Levenshtein distance <= 1. Speed-decayed scoring, presenter earns per correct guess. 3 rounds. |

Roster is now **23 games**:

```
archery   blather   bluff      darts      dictionarium  drawful   fakin
golf      guesswho  hangman    knifethrow mostlikely    percentile poker
quiz      racing    snakes     spinwar    splitroom     survive   trivia
wordspud  writevote
```

### Verification after wave 2
- `npm test` — **113 / 113 pass**
- `npm run typecheck` — 0 errors
- `npm run lint` — 0 errors (109 warnings)
- `npm run probe` — **0 issues** across all 23 games, 1-4 players, with hostile-input sweeps

### Blueprints from the 18 that are still unbuilt (9)
Hidden Impostor (Push the Button), Patently Stupid, Talking Points, Bracketeering,
Job Job, Role Models, Monster Seeking Monster, Civic Doodle, Tee K.O.

Of those, Patently Stupid and Job Job need a word-pool picker (a new `words` mode),
Role Models needs drag-and-drop mapping, Monster Seeking Monster needs the `chat` layout
wired to the engine, and Civic Doodle needs an overlay canvas. Tee K.O. is the closest to
shippable — it is Drawful's shape plus a name/tagline stage and a head-to-head vote.

---

## 10. GAMES-SPEC-2 pass

### Built to spec: Mind Meld
- `games/mindmeld/manifest.json`, `server.ts`, `content/categories.json` (61 safe categories,
  exceeds the 60 minimum).
- Pure functions exported for testing: `normalizeAnswer()` (lowercase, punctuation strip,
  space collapse, ies->y, ches/shes/xes/zes/ses-> strip, trailing s strip) and
  `scoreRound()` (300 per matching partner, 1000 each for a full-table match).
- Phases: `collect` (20 s) -> `reveal` (8 s) -> next round, 6 rounds, ends early on a full
  match. Input after the deadline is ignored. No submission scores 0.
- Privacy: answers are absent from `screenState` until the reveal.
- `shared/controllers.ts`: the `text` layout now honours a per-game `maxLength` (default
  200, capped at 280) and shows it in the counter.

### Spec coverage map (18 -> existing)
| Spec game | Status |
|---|---|
| Word Fraud | = `dictionarium` (built, needs 80-word pack + similarity rejection) |
| Fence Sitters | = `splitroom` |
| Gut Check | = `percentile` |
| Fact or Fiction | = `trivia` |
| Mind Meld | **built to spec** |
| Dumb Inventions | missing (needs multi-field text + chips) |
| Slide Roulette | missing (screen-side slide deck) |
| Bracket Brawl | missing (bracket state machine) |
| Twist It | = `survive` |
| Frankenanswers | missing (needs `rank`) |
| Clue Crafters | = `blather` (needs templates + stem rejection) |
| Word Chain | missing (needs offline word list) |
| Mind Reader | missing (needs `rank`) |
| The Fake Out | = `fakin` |
| Stowaway | missing (needs `role`) |
| Last Seat | missing (large) |
| Blind Date Chat | missing (needs `chat` wired) |
| Slingshot Arena | missing (physics) |
| Sketch & Lie | = `drawful` |
| Slogan Shirts | missing (needs derangement pairing) |
| Mash-Up Monsters | missing (needs canvas overlay) |

Verification: 121 tests, typecheck 0 errors, lint 0 errors, probe 0 issues (24 games).

---

## 11. GAMES-SPEC-2 pass 2

### Added: `rank` controller + Mind Reader
- `shared/controllers.ts`: new `rank` layout - tap items in order to build an ordering, tap a
  placed item to remove it, Reset, Submit. Disabled state and a submit-lock after sending.
- `games/mindreader/`: server, manifest, plus **pure** `footruleDistance()` and
  `scoreGuess()` (guards against duplicate/mismatched guesses so a malformed input scores 0
  instead of producing a nonsense number).
- Flow: everyone ranks four items (25 s) -> the round's Spotlight is announced -> everyone
  else ranks them again as a guess (25 s) -> reveal. One round per player.
- Scoring: `round(1000 * (1 - footrule / floor(n^2/2))`; Spotlight earns +100 per guesser
  scoring 70% or better.
- `tests/mindreader.test.ts`: 4 tests (distance, scoring, malformed guesses, scripted round).

### Gate
127 tests · typecheck 0 · lint 0 errors · probe 0 issues · **25 games**.

### Deviation from spec still in force
One game per pass was followed for mindmeld and mindreader. The remaining 11 GAMES-SPEC-2
games need controllers that do not exist yet: `role` (Stowaway, The Fake Out replay) and
`chat` engine wiring (Blind Date Chat). `rank` now exists, unblocking Frankenanswers.

---

## 12. GAMES-SPEC-2 pass 3

### Item 1: `role` controller + Stowaway
- `shared/controllers.ts`: `role` layout - a private card that is only visible while a
  HOLD TO VIEW button is pressed (pointerdown shows, release/leave hides).
- `games/stowaway/`: 40 categories, phases `brief -> clue -> discussion -> vote ->
  catchguess -> reveal`, 4 rounds. Pure `tallyAccusation()` (strict majority; ties and
  splits never catch; garbage votes ignored).
- Scoring: correct detective +500 each, uncaught Stowaway +1000, caught Stowaway who names
  the category +500.
- `tests/stowaway.test.ts`: 5 tests including a scripted caught round.
- Bug found by its own test: vote completion required the Stowaway's own vote, which
  never arrives (they cannot vote for themselves). Fixed to complete when every other
  player has voted.

### Item 2: chat wiring + Blind Date Chat
- No engine change was needed: `gameStateMessage()` already sends a per-player controller
  state, so the `chat` layout can carry a private thread per phone.
- `games/bdate/`: Dater + Candidates with secret personas, 60 s private chat, dater LOL
  button, then a pick. Screen shows only message counts and LOL counts, never text.
- Pure `scoreDate()`; `tests/bdate.test.ts` (3 tests).
- Bug found by its own test: the Dater was earning per-LOL from their own counter.
  The Dater's taps are not candidate points; fixed so only candidates earn 100/tap.

### Gate
**139 tests · typecheck 0 · lint 0 errors · probe 0 issues · 27 games**

### Not done this pass
- Item 3 (Frankenanswers) - not started.
- All remaining gaps (screen.ts for new games, content packs, announcer, theme.json,
  poker config, tutorials, draw colours/undo).
