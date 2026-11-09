# Party Platform: 8-Player Expansion, Royal Rumble and Guess the Imposter

Brief for the coding agent. Read ALL of it before touching code.

## 0. How to work

- You are upgrading an existing party-game platform. The laptop is the TV and the only authority. Phones are controllers: they send inputs, never state or scores.
- First AUDIT, then change. Where existing logic already matches this brief, leave it alone. Where it differs, change it to match this brief and list the change.
- Never delete game code. Games being retired are disabled in the registry (section 2), not removed.
- Don't stop to ask questions unless something is truly undecidable from this document. Decide, and log every decision with a one-line reason in `docs/DECISIONS.md`.
- Work in the phases in section 8, on one branch, with at least one commit per phase and all tests green before the next phase.
- Never weaken or delete an existing test to get green. Update a test only when this brief deliberately changes the behaviour it asserts, and say so in the commit message.
- Where this brief says "if the existing implementation already defines X, keep it", keep it. This brief only fixes what is missing, broken at more than 4 players, or inconsistent.

## 1. Non-negotiable platform rules

1. The server is authoritative. Phones send only inputs: taps, choices, slider values, stroke points, short capped text.
2. Secrets never reach the TV channel: hole cards, roles, secret words, lookalike words, other players' answers before reveal, chip pools, anything private. Send the TV and each phone separate minimal payloads. Never rely on the client to hide something. Add a test that scans every TV payload in every hidden phase for secrets.
3. All timing uses the server game clock, never wall-clock or client time.
4. Ties, shuffles, deals, role assignment and player order use a CSPRNG (secure random), never `Math.random` or a predictable seed.
5. Free text is length-capped and sanitised on the server. Composed-text games keep composing the text on the server.
6. Every game declares its player range. The lobby never starts a game outside it.

## 2. Roster

**Enabled (22):** Bluff, Write & Vote, Split the Room, Survive the Internet, Frankenanswers, Bracket Brawl, Dumb Inventions, Most Likely To, Stowaway, Fakin' It, Blather Round, Slide Roulette, Drawful, Slogan Shirts, Quiz, Mind Meld, Percentile, Archery, Slingshot Arena, Texas Hold'em, Tap Race, and the NEW Guess the Imposter.

**Disabled (15), keep the code:** Darts, Golf, Knife Throw, Spin War, Snakes, Quick Trivia, Word Chain, Mind Reader, Dictionarium, Word Spud, Blind Date Chat, Mash-Up Monsters, Last Seat, Hangman, Guess Who.

Two of those are merged into enabled games rather than lost:
- Quick Trivia becomes Quiz "Fast mode" (section 4).
- Dictionarium becomes a Bluff content pack, "Dictionary" (section 4).

Add `enabled: boolean` to the game registry and filter the lobby and Royal Rumble by it. Keep each game's internal `id` separate from its user-facing `displayName`, with all display names in one constants file so they can be renamed before a public release.

## 3. Platform-wide work

### 3.1 Game manifest
Every game declares, in one place:

```
id, displayName, kind        // writing | drawing | deduction | trivia | skill | party | cards
minPlayers, maxPlayers       // hard limits; lobby enforces
idealMin, idealMax           // shown in the lobby ("best with 4-8")
minutes: { standalone, rumble }
scale(n, mode) -> { rounds, timers, optionCaps, ... }   // mode: 'standalone' | 'rumble'
dropoutPolicy: 'continue' | 'pause' | 'void-round' | 'forfeit'
contentPacks: [...]
```

Delete every hard-coded 4. Grep for `4`, `max`, `players.length == 4`, fixed-size seat arrays, colour palettes with 4 entries, grids laid out for 4, and tests that only use 4 players. Fix them all.

### 3.2 Lobby and seats (up to 8)
- 8 seats, each with a distinct colour AND a distinct shape or emoji (colour-blind safe). Names are capped at 12 characters, deduplicated automatically, and truncated with an ellipsis on the TV.
- A host phone (first joiner, transferable) has the controls: pick game or preset, settings, start, pause, skip.
- The lobby shows every enabled game, greyed out with a reason when it doesn't fit the current player count ("needs 3+", "max 6"). It updates live as people join.
- A phone that refreshes or reconnects returns to its seat via a rejoin token.
- The join QR and room code stay visible (small) on the TV between games.

### 3.3 Scoring system (all games)
1. Every game ends by returning a standings list with ranks (ties allowed) and raw scores, plus per-player stats for awards (3.7).
2. **Scaling factor.** `f(N) = min(1, 3 / (N - 1))`. Apply it to any payout that is per-other-player or per-vote (marked "x f" below). Fixed payouts are not scaled.
   Results at 3 and 4 players must be IDENTICAL to today's implementation. Add a regression test that proves it.
3. **Round sanity bound.** At any N from 2 to 8, one player's maximum possible score in a single round must stay at or below about 1500. Add a test that computes the maximum per game per N.
4. **Rank points (Royal Rumble).** `rankPoints(rank, N) = round(100 * (N - rank) / (N - 1))`. Tied players share the average of the positions they occupy. Standalone games show raw scores; Rumble shows Rumble points with the raw score beside them.
5. Where a game's existing scoring is undefined or ambiguous (flagged below), use the rule given here, and log it in `docs/DECISIONS.md`.

### 3.4 Round-length scaling
Games with a turn per person (drawing, presenting, writing) get longer as N grows. `scale(n, mode)` returns the round count, timers and caps. In `rumble` mode, target 4 to 7 minutes per game. The per-game sections give the standalone and Rumble round counts.

### 3.5 Voting screens
- Up to 6 options: one TV screen, large type.
- 7 to 9 options: two-column grid with letter badges, or pages of 5 for 5 seconds each. Never shrink text below readable at 3 metres.
- On phones, option lists scroll, with at least 48dp tap targets. Option letters on the phone match the TV. A player can change their vote until everyone has voted or the timer ends.
- Never show who voted for what until the reveal.

### 3.6 Disconnects, late joins, spectators
- A phone that disconnects is marked "away" within 5 seconds and has a 30-second grace period to rejoin.
- Each game declares a `dropoutPolicy`. If connected players fall below the game's minimum, pause for 60 seconds, then offer the host: wait, end the game, or continue the Rumble with the next valid game.
- People who join mid-game become spectators until the next game starts. Spectators and eliminated players can send reactions (3.8) and cannot affect the game.
- A player who leaves keeps their score on the board, greyed out and marked "left".

### 3.7 Results and awards
Each game returns `{ standings: [{ playerId, rank, raw }], stats: { ... } }`. Stats feed fun awards on the TV (3.8): Best Liar, Sharpest Eye, Fastest Fingers, Crowd Favourite, Cold-Blooded, Comeback Kid, Master of Disguise. Each game contributes whatever stat fits it (for example votes fooled, correct accusations, average answer speed, biggest pot, rank improvement).

### 3.8 The TV should be fun to just watch
The laptop screen is a show, not a status panel. Build this in from the start:
- **Never a dead screen.** Nothing static for more than about 5 seconds: always motion, a countdown ring, or "Waiting on: Ana, Ben" with those avatars highlighted.
- **Big, readable, 3 metres away.** Large type, high contrast, and avatars always visible with the current scores.
- **Reveals are moments.** Votes tally with a drum roll, answers flip one at a time, scores count up, and the leader changes with an animation.
- **Between games (15 to 20 seconds):** standings with up/down movement, a "Next up" card with the game name, a one-line rule, and the player count it's using. The host can skip it.
- **Audience reactions.** Phones can send one of 8 emoji reactions (rate-limited to one per 2 seconds). The TV shows them floating up. Spectators and eliminated players use this.
- **Short caption lines** during reveals ("Priya fooled four people!") from a small text bank, never revealing a secret.
- **Optional sound and text-to-speech.** Sound effect hooks on reveals, with a mute toggle. Browser speech synthesis for turn announcements (Guess the Imposter), default on, toggle in settings.
- **Accessibility.** Colour-blind-safe palette, plus shape or emoji with every colour. Do not rely on colour alone.

## 4. Per-game specs

Format: **Players** (hard min-max, ideal range). Rounds are "standalone / rumble". "x f" means scale by `f(N)` from 3.3. If the existing implementation already defines a rule that this section leaves open, keep it.

### Writing, bluffing and voting

**Bluff** (3-8, ideal 4-8). Rounds 6 / 4 (3 if N >= 7).
- Flow: a question is shown. Each player writes a fake answer. The real answer is shuffled in. Everyone votes for what they think is true (not their own fake).
- Scoring: truth found 500. Each person fooled 200 x f.
- Content packs: "Facts" and "Dictionary" (absorbs Dictionarium: an obscure word, players invent definitions, same scoring).
- At 8: up to 9 options, so use the 7-9 option layout from 3.5.

**Write & Vote** (3-8, ideal 4-8). Rounds 5 / 3.
- Flow: a prompt, everyone writes an answer, everyone votes for a favourite (not their own), anonymous until reveal.
- Scoring: 100 per vote received x f.
- At 6+ answers use the grid layout.

**Split the Room** (3-8, ideal 4-8). Rounds N (max 8) / min(N, 4); the writer rotates.
- Flow: one player fills a blank in an absurd scenario. Everyone else votes YES or NO.
- Scoring: writer gets `1000 - |yes - no| * (1000 / voters)`, so a perfect split pays the most and unanimous pays zero. Minority voters get 150 (fixed). `voters` is the number of non-writers, so it already scales.

**Survive the Internet** (3-6, ideal 4-6). Rounds 3 / 2.
- Flow: everyone answers innocently, then writes a headline that makes someone else's answer look terrible (never their own). Everyone votes for the funniest pairing (not their own).
- Scoring: per vote, 700 to the headline writer and 300 to the quoted player, x f.
- Max 6 because every player's pairing needs a vote slot. Stretch goal only: vote on a random subset to allow 8.

**Frankenanswers** (3-6, ideal 4-6). Rounds 3 / 2.
- Flow: each player writes three word chips. Each is dealt six chips written by others plus four connectors. They build an answer from 3-4 chips plus up to 2 connectors. The SERVER composes the text; phones never send free text for the final answer. Everyone votes (not their own).
- Scoring: +1000 per vote x f, and +100 to each chip's author per chip used (x f). A content pack fills any chip shortfall.
- Max 6: more answers than that is too much to read.

**Bracket Brawl** (3-6, ideal 4-6). One full bracket.
- Flow: each player writes one answer, then a knockout bracket of head-to-head duels. Only players NOT in a duel vote. Ties break by secure random.
- Generalise the bracket: pad to the next power of two with byes assigned by secure random, and nobody gets more than one bye. 3 players = a duel plus a bye, 4 = two semis plus a final (both match today). 5-6 = an extra opening round.
- Scoring: any non-final duel win 500, the final 1000, each voter who backed the winner 100 (fixed). Duels run one at a time, with a visible bracket on the TV.

**Dumb Inventions** (3-6, ideal 4-6). Rounds 3 / 2.
- Flow: a problem card and two word chips each. Name a product and pitch it using both chips. Everyone votes (not their own).
- Scoring: +1000 per vote x f.
- Change: REMOVE the -200 penalty for skipping a chip. Skipping just forfeits that chip. Log in `docs/DECISIONS.md`.

**Most Likely To** (3-8, ideal 4-8). Rounds 8 / 5.
- Flow: a "Who's most likely to..." prompt. Everyone votes anonymously for a player (voting for yourself is allowed). The TV tallies with a drum roll.
- Scoring (if not already defined): the top vote-getter gets 500 (split evenly on a tie), and each voter who voted for a top vote-getter gets 100.
- Prompts must make sense for any group. No private or sensitive targeting.

### Social deduction and performance

**Stowaway** (3-8, ideal 4-8). Rounds 3 / 2.
- Flow: everyone sees a category except one player (the Stowaway). Each writes a short clue (server caps at 3 words). The Stowaway bluffs. Discuss, then vote.
- Scoring: strict majority catches the Stowaway: each correct voter +500 x f. A caught Stowaway can still pick the category from 6 multiple-choice options for +500. An uncaught Stowaway takes 1000.
- Optional (N >= 7): a setting for 2 Stowaways. Skip if time is short.

**Fakin' It** (3-8, ideal 4-8). Rounds 5 / 3.
- Flow: everyone gets the same instruction except one Faker, who is told to copy. 25 seconds of acting, then everyone votes.
- Scoring: a strict majority catches the Faker: each correct voter +200 x f. Otherwise the Faker takes 500.
- The Faker rotates by secure random and never repeats until everyone has been Faker.

**Blather Round** (3-8, ideal 4-8). Rounds min(N, 6) / 4.
- Flow: one presenter describes a secret word without saying it. Everyone else races to guess on their phone. Typos within edit distance 1 count.
- Scoring: guessers get speed-decayed points `max(100, 1000 - seconds * 20)` over a 45-second limit. The presenter gets 100 per correct guesser x f, capped at 600 (if undefined today).
- The secret word never reaches the TV. The TV shows the word only after it is guessed or time is up.

**Slide Roulette** (3-8, ideal 4-8). Presenters: each player once (max 8) / 3.
- Flow: the presenter gets a topic and no slides. Everyone else writes one caption each. The presenter improvises while the captions appear, tapping to advance. The audience rates 1-5 stars.
- Scoring: presenter = 200 x the AVERAGE star rating (max 1000 at any N). Each caption author gets 100 when the average rating is 4 or more.
- Captions are shuffled so the presenter can't tell who wrote what. The TV shows the current caption large, with a "slides left" counter.

### Drawing

**Drawful** (3-8, ideal 4-8). One drawing per player (max 8) / 4 drawings, chosen by secure random.
- Flow: one player draws a ridiculous prompt (only they see it). Everyone else invents a fake title. All titles plus the real one go to a vote (not for your own title).
- Scoring: the artist gets 500 per vote for the true title (x f). Each bluff gets 250 per vote (x f).
- Strokes are sent as input points. The host can skip or hide a drawing. The TV redraws from the received strokes.

**Slogan Shirts** (3-8, ideal 4-8). One cycle (each player makes a design) / max 4 shirts.
- Flow: each player draws a design and writes a slogan. Slogans rotate with a cyclic shift, so nobody's design carries their own slogan (valid for any N >= 3). Everyone votes for a shirt, never one on their own design.
- Scoring: the winning shirt pays BOTH its authors 1000. Other shirts' authors get 100 per vote x f.
- At 8, show shirts in a 4x2 grid on the TV.

### Knowledge and numbers

**Quiz** (1-8, ideal 3-8). 10 questions standalone, Fast mode in the Rumble.
- Standard: 10 questions, 15 seconds each. Correct = 1000 + up to 500 speed bonus (linear on remaining game-clock time). Wrong or no answer = 0.
- Fast mode (absorbs Quick Trivia): 6 questions, 10 seconds, 4 options, correct = `max(100, 1000 - seconds * 90)`.
- After each question the TV shows the answer distribution (who picked what is hidden until the reveal).

**Mind Meld** (2-8, ideal 4-8). Rounds 5 / 4.
- Flow: a category, one word each, normalised (case, punctuation, plurals). 
- Scoring: 300 x f per OTHER player who matches you. A full-table match pays 1000 to everyone and ends the game.
- At N >= 5, "full table" is very unlikely, so also end the game early if a round hits a match of N-1 players, with 800 each. Log in `docs/DECISIONS.md`.

**Percentile** (2-8, ideal 3-8). Rounds 5 / 4. Setting "Everyone guesses once" sets rounds = N.
- Flow: the guesser estimates a real statistic on a slider. Everyone else bets HIGHER or LOWER BEFORE seeing the guess. The guesser rotates.
- Scoring (keep today's): exact = 1000, within 15 = `1000 - 50 * distance`. A correct directional bet = 500, plus 200 more if the guesser missed by more than 20.
- Every statistic needs a value, unit, source and year in the content pack.

### Skill and showpiece

**Tap Race** (1-8, ideal 3-8). One race. Standalone can offer best of 3.
- Flow: 3-second countdown, then mash. Each tap adds speed; speed bleeds about 55% per second. First to 100 wins, or the furthest at the 60-second buzzer. Each phone shows your count and your nearest rival's.
- Scoring: rank only, using standard rank points (3.3). At 8 the TV needs 8 lanes.

**Archery** (1-8, ideal 2-8). Rounds 5 / 3.
- Flow: hold to draw, power builds while held, release to fire at a sliding target. Gravity applies. Releasing too early cancels the shot. All players fire at once on one shared target, and each arrow is coloured by player.
- Scoring: proximity to the centre, up to 100 per arrow. Highest total wins.

**Slingshot Arena** (2-4 ONLY, ideal 2-4). Standalone best of 3, Rumble one match with a 60-second clock.
- Flow: turn-based. Aim, set power, FIRE. Pucks slide, collide elastically with equal mass, bounce off the rim, and die at the edge or on a hazard. Nearest to centre wins when the clock ends.
- Stretch only: 5-8 players as two teams sharing a colour, alternating turns. NOT required. The Rumble treats this game as max 4.

**Texas Hold'em** (2-8, ideal 3-8).
- Standard no-limit Hold'em. The host sets the starting stack (equal for all) and the number of hands. Raises use a stepper between the minimum raise and your maximum. Hole cards never leave your phone.
- Required at more than 2 players: side pots for all-ins, a correct dealer button, correct blind posting heads-up vs multiway, and a 25-second action timer that auto-checks or folds.
- Busted players become spectators and are ranked by reverse elimination order. Final ranking is by stack. Rumble default: 8 hands, blinds double at hand 5.
- The TV shows community cards, pots, stacks, whose turn it is, and last action. Folded cards stay hidden.
- Deal with a CSPRNG shuffle.

## 5. NEW GAME: Guess the Imposter

**Players:** 3-8, ideal 5-8. Rounds (one secret word each): 3 standalone / 2 in the Rumble.

### Concept
Everyone gets the same secret word on their phone except the Imposter, who is told "You are the Imposter". Players give clues, discuss, then vote someone off. Repeat until the Imposter is caught or wins. An optional Larper sits among the crew: they get a SIMILAR word and don't know they're the Larper.

### Roles
- **Crew:** sees the secret word and its category.
- **Imposter:** sees "YOU ARE THE IMPOSTER" (plus the category if that setting is on).
- **Larper (optional):** looks exactly like crew on their phone (same screen layout, same wording) but sees the lookalike word. They believe they are normal crew. They are on the crew's side for scoring.
- Roles are assigned by secure random every round. A player can't be the Imposter two rounds in a row.
- Larper needs N >= 5. Second Imposter needs N >= 7 and the setting turned on.

### Content pack
Each entry: `{ category, word, lookalike, decoys: [5 strings] }`. The lookalike is in the same category and similar enough that a clue for one could plausibly fit the other, but is clearly a different thing. The 5 decoys plus the real word form the Imposter's final-guess options. Ship at least 150 entries across at least 12 family-friendly categories. Examples: `{Foods, Pizza, Flatbread, [Lasagna, Calzone, Nachos, Pancake, Burger]}`, `{Animals, Dolphin, Porpoise, ...}`, `{Jobs, Surgeon, Dentist, ...}`.

### Round flow
1. **Countdown.** TV shows "Look at your phones" and a 3-2-1 countdown. Phones flip their card automatically.
2. **Private reveal.** The word shows on the phone only while the player holds the card ("hold to peek") and auto-hides after 5 seconds, so neighbours can't read it. Nothing secret ever goes to the TV.
3. **Clue turns.** The laptop picks a random order and announces each turn in big text, with an optional spoken announcement ("Jamie, you're up"). The TV shows the order list with ticks for who has gone, and a timer ring.
   - **Spoken mode (default):** the player says one clue word out loud. The active phone shows a big DONE button. The turn ends on DONE or on timeout.
   - **Typed mode:** the active phone submits one word (server caps at 20 characters, sanitised). The TV shows it after submission.
   - Order rules (settings): Imposter can't go first (default ON), Imposter can't go last (default OFF), re-randomise the order each clue round (default ON, but the Imposter-not-first rule still holds).
4. **Repeat** for the set number of clue rounds (default 2).
5. **Discussion.** A timer (default 90 seconds). The TV shows the countdown and the player list.
6. **Vote.** Everyone still in votes simultaneously for who to eject. No voting for yourself. Skip votes are off by default (setting). The TV reveals the votes one by one.
   - **Tie:** one revote among only the tied players, 20 seconds. A second tie means nobody is ejected this time.
   - There is a cap of N-1 votes per round. If the cap is reached and the Imposter is still hidden, the Imposter wins.
7. **Result of the vote:**
   - **An Imposter is ejected:** they get ONE final guess. Their phone shows the real word plus 5 decoys (multiple choice, 15 seconds). A correct guess means the Imposter steals the win. If every Imposter is now caught, the crew wins.
   - **A crew member (or the Larper) is ejected:** they are out. They become a spectator who can see the TV and send reactions. The TV flashes who they were, and the word is not revealed yet. Go back to step 3 with the remaining players.
   - **Imposter wins by numbers** when imposters >= remaining non-imposters.
8. **Reveal.** The TV shows the secret word, who the Imposter was, and who the Larper was (with the lookalike word). Make this a big moment.

### Settings (host phone, before the game)
| Setting | Options | Default |
|---|---|---|
| Rounds (words) | 1-5 | 3 (Rumble: 2) |
| Clue mode | Spoken / Typed | Spoken |
| Clue rounds before each vote | 1-3 | 2 |
| Turn timer | 10 / 20 / 30 s / off | 20 s |
| Discussion timer | 30-180 s | 90 s |
| Imposter can't go first | on / off | ON |
| Imposter can't go last | on / off | OFF |
| Re-randomise order each clue round | on / off | ON |
| Include Larper (N >= 5) | on / off | OFF |
| Announce that a Larper is in play | on / off | OFF |
| Imposter sees the category | on / off | ON |
| Number of Imposters (2 needs N >= 7) | 1 / 2 | 1 |
| Allow skip votes | on / off | OFF |
| Spoken turn announcements (text-to-speech) | on / off | ON |

### Scoring (per round)
- **Crew wins:** each remaining crew member 400; a crew member who was wrongly ejected earlier 200. Plus 100 for every vote you cast that landed on an Imposter.
- **Larper** (if they survived to the end of a crew win): +200 "Slipped Through" on top of the crew score.
- **Imposter wins by survival:** 1000. **By correct final guess:** 700. Everyone else 0, except the 100-per-correct-vote bonus above.
- Stats for awards: correct accusations (Sharpest Eye), rounds won as Imposter or Larper surviving (Master of Disguise).
- Rank by total across rounds. Rumble uses standard rank points.

### Edge cases
- An Imposter disconnects and doesn't return within 30 seconds: crew wins the round.
- The Larper disconnects: remove them quietly, nothing else changes.
- If a clue-turn player disconnects, skip their turn.
- N = 3: no Larper, and any wrongly ejected crew member ends the round in the Imposter's favour (1 vs 1).
- Nothing about roles, words or lookalikes ever appears in any TV payload before the final reveal.

### TV and phone screens
- **TV:** big "Whose turn" card with avatar, name and timer ring. Order list with ticks. Clue round counter. Voting reveal animation. Spectator banner for ejected players. Final reveal. Optional suspense sound.
- **Phone (active):** hold-to-peek card, DONE button on your turn, vote grid, final-guess grid for an ejected Imposter.
- **Phone (ejected):** "You're out. Watch and react", with reaction buttons.

## 6. Royal Rumble

(User-facing name is a constant. "Royal Rumble" is the working title; keep it one constant so it can be renamed before a public release.)

### Concept
A Rumble is a pre-built playlist of 8 games played back to back, with one running leaderboard and a crowning at the end. It adapts to however many players are in the room.

- Player range: 3-8 to start (ideal range per preset below). If players drop mid-Rumble to 2, continue with games valid at 2 or pause.
- Each game runs in `rumble` mode (shorter rounds, section 3.4). Target 50-65 minutes total.
- Slots can carry options (for example Quiz in Fast or Standard mode, Bluff with the Facts or Dictionary pack).

### Presets (5)
| # | Name | Vibe | Ideal players | The 8 games, in order | Bench (substitutes) |
|---|---|---|---|---|---|
| 1 | **Friday Night at Mo's** | All-rounder for any group | 4-8 | Most Likely To, Quiz (Fast), Bluff (Facts), Tap Race, Drawful, Split the Room, Guess the Imposter, Archery | Write & Vote, Mind Meld, Stowaway, Fakin' It |
| 2 | **The Cousins Reunion** | Loud writing and voting chaos | 4-8 | Write & Vote, Dumb Inventions, Blather Round, Slogan Shirts, Survive the Internet, Slide Roulette, Split the Room, Bracket Brawl | Most Likely To, Mind Meld, Fakin' It, Stowaway |
| 3 | **Sleepover Hours** | Creative, low pressure, silly | 3-6 | Mind Meld, Most Likely To, Drawful, Fakin' It, Frankenanswers, Slogan Shirts, Dumb Inventions, Slide Roulette | Write & Vote, Blather Round, Split the Room, Tap Race |
| 4 | **Big Brain Sunday** | Smart and competitive | 3-8 | Quiz (Standard), Percentile, Bluff (Dictionary), Mind Meld, Archery, Slingshot Arena, Tap Race, Texas Hold'em | Split the Room, Write & Vote, Stowaway, Blather Round |
| 5 | **Who Ate the Last Slice?** | Suspicion and deception | 4-8 | Most Likely To, Fakin' It, Bluff (Facts), Tap Race, Stowaway, Survive the Internet, Split the Room, Guess the Imposter (Larper ON if N >= 5) | Write & Vote, Mind Meld, Drawful, Blather Round |

Every enabled game appears in at least one preset. Make presets data (a config file), so adding a sixth is just config.

### Adapting to the players in the room
Run the resolver at Rumble start and again before EVERY game, using the current number of connected players (spectators excluded). Never swap a game that has already started.

```
resolve(slot, N, usedIds):
  game = registry[slot.gameId]
  if valid(game, N) and not used: keep
  else:
    1. first game in preset.bench that is valid at N and unused
    2. else first enabled game of the same `kind` that is valid at N and unused
    3. else skip the slot
```

- Announce every swap on the TV in one line ("Slingshot Arena needs 2-4 players, so we're playing Split the Room").
- If fewer than 8 slots survive, the Rumble is shorter. That's fine.
- Test: for every preset and every N from 3 to 8, at least 6 of the 8 slots resolve to unique valid games.
- A game's cap below 8 (Slingshot 4, Bracket Brawl 6, Survive 6, Frankenanswers 6, Dumb Inventions 6) is fine. Never force 8.

### Scoring and flow
- Each game's standings turn into rank points (3.3). The **last game counts double** (setting, default ON).
- A late joiner enters at the next game boundary and starts with the lowest current Rumble score, so they're never ahead and never hopeless.
- A player who leaves keeps their score, greyed out and marked "left".
- Between games: standings with up/down arrows, the next game's intro card, and the swap announcements. 15-20 seconds, host can skip.
- **Host controls:** pause, skip the current game, swap the next game for any valid one, end the Rumble early (crown the current leader).
- **Persistence:** save Rumble state on the server after every game, so a refreshed laptop resumes where it left off.
- **Finale:** podium for the top 3 with an animation, the full leaderboard, and 4-6 awards drawn from the game stats (3.7).

## 7. Tests and acceptance

1. **Bots:** write a simple bot player that speaks the phone protocol. Run EVERY enabled game at every N in its range (including the min and max) to completion. No crashes, no stuck phases, no negative or NaN scores.
2. **Regression at 3-4 players:** scores identical to the pre-change implementation (using recorded fixtures or seeded runs).
3. **Scaling:** for each game and each N from 2 to 8, assert the round sanity bound (3.3).
4. **Secrets:** every TV payload in every hidden phase contains no hole cards, roles, secret words, lookalikes, chips or unrevealed answers.
5. **Disconnects:** drop and rejoin a phone during every phase of at least these games: Hold'em, Drawful, Bluff, Guess the Imposter. Also drop below a game's minimum.
6. **Resolver:** unit tests for every preset at N = 3..8, including the swap announcements.
7. **Guess the Imposter:** tests for the order rules (Imposter never first with the setting on), ties and revotes, final guess, Larper scoring, N = 3 edge case, 2 Imposters, and that the Larper's phone payload has the same shape as a crew member's.
8. **Layout:** TV renders correctly with 8 players and long names at 1080p and 720p. Phone UIs fit a 360dp-wide screen at 1.5x text.
9. **Lobby:** a game outside the player range can't be started, and shows why.

## 8. Phases

1. **Audit (read-only).** Write `docs/EXPANSION_AUDIT.md`: a table of every game with current min/max, every hard-coded 4 you found, the current scoring formulas, and every place the current behaviour differs from this brief. Then continue.
2. **Platform foundation.** Registry `enabled` flag and manifest, 8-seat lobby, scoring utility (`f(N)`, rank points), voting layouts, disconnect and spectator handling, reactions, result and award schema, TV watchability pieces. Commit.
3. **Scale the existing games**, grouped by shared system: (a) text answer and voting games, (b) chips and composed text, (c) hidden roles and clues, (d) drawing, (e) physics and aim, (f) Quiz, Mind Meld, Percentile, Tap Race, (g) Hold'em. Bot-test each group before the next. Commit per group.
4. **Guess the Imposter.** Content pack, game, settings, TV and phone screens, tests. Commit.
5. **Royal Rumble.** Preset config, resolver, scoring, interludes, host controls, persistence, finale. Commit.
6. **Polish and verification.** Run the whole test list in section 7. Fix what fails. Write `docs/DECISIONS.md` and a short `docs/PLAYER_COUNTS.md` table of every game's final min, max and ideal range.

Report at the end of each phase: what changed, files touched, tests added, decisions logged, and anything in this brief you deliberately did not do and why.
