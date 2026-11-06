# TBRN-Games: New Game Specs (GAMES-SPEC.md)

> **AGENT: read fully before building anything.** Build ONE game per session, then stop and update `PROGRESS.md`.
> Before the first game, read `games/bluff/server.ts` and `games/writevote/server.ts` (closest existing patterns) and the `GamePlugin` type in `shared/types.ts`. **Adapt every spec below to the real plugin interface. Never invent a new one.**

## 0. Ground rules
- Inspiration labels like "(inspired by X)" are for orientation only. **Never use those names, art, prompts, or text anywhere in code, UI, or content.** Use the original names below. All prompts and content are written fresh by you.
- Players: 1-4 phones + 1 screen. Many specs need 3+. Set `minPlayers` / `maxPlayers` in each `manifest.json`.
- Server-authoritative. Phones send inputs only. Hidden data (answers before reveal, roles, secret words) is **never** sent to the screen or other phones until the reveal phase.
- Fully offline. Content lives in `games/<name>/content/*.json`. No remote APIs.
- Tests per game: unit tests for the pure scoring function, plus one scripted full game with `tests/bot-client.ts`. `npm test`, `npm run typecheck`, `npm run lint` must pass.

## 1. Shared building blocks (build once, reuse everywhere)

**S1 Phase engine.** A game is a list of phases: `collect -> reveal -> vote -> score -> next round`. Each phase has a server deadline. It advances when all connected players have submitted OR the timer ends. Input after the deadline is ignored. Timers use delta time.

**S2 Submissions.** Per round, per player: trim, collapse whitespace, max length per field, strip control characters. HTML is never interpreted (render as text). Empty or timed out: substitute a fallback line from the pack (for example "(ran out of time)") and mark it so it scores 0.

**S3 Anonymous reveal.** During `collect` and `vote`, answers carry an opaque id, never an author. Authors are revealed after the vote result.

**S4 Vote module.** "Pick your favorite among answers that are not yours." Players cannot vote for themselves. No vote = no points. Tie: secure-random winner with a host joke (never `Math.random()` for game outcomes; use `shared/secure-random.ts`).

**S5 New controller layouts** (add to `shared/controllers.ts`, each with disabled/locked states after submitting):
- `text`: single or multi-line input, character counter, Submit, locks after submit (show "sent!").
- `slider`: 0-100 with big thumb and a Lock In button.
- `rank`: tap items in order to build a ranking, with Reset and Submit.
- `draw`: canvas, 6 colors, 3 brush sizes, undo, clear, submit. Strokes sent as normalized point arrays (0-1), max ~4000 points per drawing, throttled.
- `chat`: message list + input + rate limit (1 message / 700 ms, 140 chars).
- `role`: private card shown only while the player holds a button, hidden again on release.
- `aim`: drag vector (angle + power), release to fire (only for Slingshot Arena).
- Existing `choice` handles buttons, 2-button true/false, and 5-star ratings.

**S6 Host announcer.** A line library per event (`gameStart`, `allSubmitted`, `reveal`, `tie`, `bigWin`, `roundEnd`, `winner`, `disconnect`), each with 4+ variants, picked without immediate repeats. Shown as a big caption on the screen. This is what gives the platform a personality. Keep lines short and funny, never mean about real people.

**S7 Content loader.** Loads `{ id, text, tags, safe }` JSON, deals without repeats within a session, default to `safe: true` only. Every pack needs at least 60 items (trivia/statements: 80+).

**S8 Scoring and results.** Per-round points table, running total, shared victory screen (from the visual kit), ties broken by a one-question sudden-death or shared win.

**S9 Disconnect handling.** A dropped player counts as "no submission" for the current phase. Reconnect restores their controller to the current phase. If players fall below `minPlayers`, pause with a clear message on the screen and wait 60 s, then end the game gracefully.

**S10 Safety.** Rate-limit per IP (already exists), cap payload sizes (text 280 chars, drawing 50 KB), escape all output.

---

## 2. Text and choice games (build these first)

### 1. Word Fraud (inspired by a fake-definition game) | Priority 1
- **Players:** 3-4 | **Rounds:** 4 | **~10 min**
- **Controller:** `text`, then `choice`.
- **Flow:**
  1. Screen shows an obscure real word and its pronunciation hint (no definition).
  2. Everyone writes a fake definition (60 s, max 100 chars).
  3. Server adds the real definition to the pool. Shuffle. Screen reads them out one by one (S3).
  4. Everyone votes for the definition they think is real (S4 rules, cannot vote own).
  5. Reveal: real one highlighted, then who wrote each fake and who it fooled.
- **Scoring:** correct pick +1000. Each player fooled by your fake +500 to you.
- **Edge cases:** reject a fake that is too similar to the real definition (case-insensitive token overlap above ~80%) with "too close to the truth, try again" and let them resubmit. Two identical fakes: merged, both authors get credit.
- **Content:** 80 real obscure words with accurate, paraphrased definitions you are sure about.

### 2. Fence Sitters (inspired by a split-the-room game) | Priority 1
- **Players:** 3-4 | **Rounds:** one per player | **~8 min**
- **Controller:** `text` for the author, `choice` (Would / Wouldn't) for voters.
- **Flow:**
  1. Each round has an Author (rotating). Screen shows a scenario starter ("You find a wallet with $500, and...").
  2. Author finishes it with a twist (30 s, max 80 chars). The twist should make the decision hard.
  3. Everyone else secretly votes "I would" or "I wouldn't" (15 s).
  4. Reveal votes with a tug-of-war bar.
- **Scoring:** author gets `round(1000 * (1 - |yes - no| / voters))` (perfect split = 1000, unanimous = 0). Voters get +100 for voting.
- **Edge cases:** if the author times out, a pack twist is used and the author scores 0.
- **Content:** 40 scenario starters.

### 3. Gut Check (inspired by a higher-or-lower guessing game) | Priority 2
- **Players:** 3-4 | **Rounds:** 2 per player | **~8 min**
- **Controller:** `slider`, then `choice` (Higher / Lower).
- **Flow:**
  1. Active guesser sees a numeric question with a 0-100 range (for example a well-known percentage or count scaled to 0-100). Locks a guess.
  2. Screen shows the guess (not the answer). Everyone else votes Higher or Lower.
  3. Reveal the true value with a needle animation.
- **Scoring:** guesser `max(0, 1000 - 20 * |diff|)`. Each voter who picked the correct direction +500. Exact hit: guesser +500 bonus, voters 0.
- **Content:** 60 questions with stable, verifiable answers. Add a `source` field for each. Do not use disputed or changing statistics.

### 4. Fact or Fiction (inspired by a true/false trivia game) | Priority 1 (easy)
- **Players:** 1-4 | **10 statements** | **~5 min**
- **Controller:** `choice` with two huge buttons.
- **Flow:** statement shown, 15 s timer, answers lock instantly, reveal with one-line explanation, next.
- **Scoring:** correct = 500 + speed bonus up to 500 (linear over the timer). Streak bonus +100 per consecutive correct.
- **Edge cases:** no answer = wrong. Show "everyone got it wrong" host jokes.
- **Content:** 80 statements, each marked true/false with a short explanation. Only facts you are certain about.

### 5. Mind Meld | Priority 2
- **Players:** 2-4 | **Rounds:** until everyone matches or 6 rounds | **~6 min**
- **Controller:** `text` (max 20 chars).
- **Flow:** screen shows a category ("a fruit"). Everyone writes a word (20 s). Reveal all together. Next round gets a harder category if players did not match.
- **Normalization:** lowercase, trim, strip punctuation, simple plural stripping.
- **Scoring:** for each other player whose normalized answer matches yours, +300. If all players match, everyone +1000 and the game ends early with a victory flourish.
- **Content:** 60 categories.

### 6. Dumb Inventions (inspired by a pitch-a-product game) | Priority 2
- **Players:** 3-4 | **Rounds:** 2 | **~12 min**
- **Controller:** `text` x2 (product name, pitch), `choice` for voting.
- **Flow:**
  1. Each player gets a Problem card and two random Word chips (for example "umbrella", "subscription").
  2. They invent a product name (max 30 chars) and a one-sentence pitch (max 120 chars) that includes both chips (90 s).
  3. Screen presents each pitch as a fake commercial card, one at a time, name animating in.
  4. Vote for the best.
- **Scoring:** +1000 per vote. Chip not used in pitch: -200 (still shown). Most votes gets a "Crowd Favorite" banner.
- **Content:** 50 problems, 120 chips.

### 7. Slide Roulette (inspired by an improv-presentation game) | Priority 3
- **Players:** 3-4 | **Rounds:** one per player | **~15 min**
- **Controller:** `text` for writing slides, `choice` (5 stars) for rating, presenter phone shows "TALK!".
- **Flow:**
  1. Each round has a Presenter and a topic ("Why pigeons deserve a union").
  2. Every other player writes one slide caption for that topic (max 40 chars, 30 s).
  3. Screen shows the topic, then each slide for 15 s. Presenter must improvise aloud in the room. Presenter can tap Next early.
  4. Audience rates 1-5 stars.
- **Scoring:** presenter `round(200 * averageStars)`. Each slide author +100 if the average is 4 or higher.
- **Edge cases:** if only 2 others exist, each writes 1 slide (deck of 2).
- **Content:** 40 topics.

### 8. Bracket Brawl (inspired by a bracket-vote game) | Priority 3
- **Players:** 3-4 | **Rounds:** 2 | **~10 min**
- **Controller:** `text`, then `choice` (pick A or B).
- **Flow:**
  1. Prompt ("Best excuse for being late"). Everyone writes one answer.
  2. Bracket: 4 players = two semi duels then a final. 3 players = one duel, winner vs the bye.
  3. In each duel, only players not in the duel vote. A tied duel is decided by secure random with a host joke.
- **Scoring:** semi win +500, final win +1000, each vote for the eventual duel winner +100.
- **Screen:** animated bracket with answers sliding in.

### 9. Twist It (inspired by a context-twisting game) | Priority 3
- **Players:** 3-4 | **Rounds:** 2 | **~10 min**
- **Controller:** `text` x2, then `choice`.
- **Flow:**
  1. Everyone answers a prompt ("A message you would not want to send your boss").
  2. Answers are passed around: each player gets someone else's answer (never their own) and must write the **question or setup** that makes it as awkward or funny as possible.
  3. Screen shows pairs (setup + answer). Vote on the best pair.
- **Scoring:** both co-authors of the winning pair +1000. Other pairs +100 per vote.

### 10. Frankenanswers (inspired by a word-chip interview game) | Priority 3
- **Players:** 3-4 | **Rounds:** 3 | **~10 min**
- **Controller:** `text` (3 short chips), then `rank` (build an answer), then `choice`.
- **Flow:**
  1. Everyone writes 3 short chips (max 18 chars each) for a category prompt ("a place", "an excuse", "something sticky").
  2. Screen shows a question ("Describe your biggest weakness in a job interview").
  3. Each player gets 6 random chips written by OTHER players and must tap 3-4 of them in an order to build an answer. They may add up to 2 filler words.
  4. Vote.
- **Scoring:** answer author +1000 per vote; each chip author +100 when their chip is in a winning answer.
- **Edge cases:** pool too small: fill with pack chips.

### 11. Clue Crafters (inspired by a describe-without-saying game) | Priority 3
- **Players:** 3-4 | **Rounds:** one per player | **~10 min**
- **Controller:** `text` (fill blanks) for the describer, `text` (guess) for guessers.
- **Flow:**
  1. Describer privately sees a secret word and 5 sentence templates ("It is usually found in ___", "You can ___ with it", "It is bigger than ___").
  2. Describer fills one blank at a time. Each filled clue appears on the screen as it unlocks.
  3. Guessers type guesses at any time. Guesses are normalized and checked on the server.
- **Rules:** the server rejects any clue containing the secret word or its stem.
- **Scoring:** guesser `1000 - 150 * cluesUnlocked`. Describer +300 per correct guesser.
- **Content:** 80 words with templates.

### 12. Word Chain | Priority 3
- **Players:** 2-4 | **~6 min**
- **Controller:** `text` (one word).
- **Flow:** turn-based. Each word must start with the last letter of the previous word, be in the offline word list (use an MIT/CC0 word list and note it in `ASSETS.md`), and not already used. 15 s per turn.
- **Rules:** each player has 2 lives. Invalid or late = lose a life. Last player alive wins.
- **Scoring:** placement points (1st 1000, 2nd 600, 3rd 300, 4th 100).
- **Screen:** ring of players with the chain curling around it.

### 13. Mind Reader (inspired by a rank-and-guess game) | Priority 3
- **Players:** 3-4 | **Rounds:** one per player | **~10 min**
- **Controller:** `rank`.
- **Flow:**
  1. Prompt with 4 items ("Rank these: pizza, tacos, sushi, burgers").
  2. Everyone privately ranks them (20 s). The Spotlight player is announced.
  3. Everyone else guesses how the Spotlight player ranked them. Reveal and compare.
- **Scoring:** guessers `round(1000 * (1 - footruleDistance / maxDistance))`. Spotlight player +100 per guesser scoring 70% or more.

### 14. The Fake Out (inspired by a one-person-bluffs game) | Priority 3
- **Players:** 3-4 | **Rounds:** 4 | **~10 min**
- **Controller:** `role`, then `choice`.
- **Flow:**
  1. Everyone except one (the Bluffer) receives a secret in-person instruction ("Mime brushing your teeth"). The Bluffer sees "???".
  2. Countdown. Everyone performs together in the room for 20 s. The Bluffer copies the others.
  3. Players vote who the Bluffer is.
  4. If the Bluffer is caught, they get one chance to pick the real instruction from 6 options.
- **Scoring:** correct detective +500. Uncaught Bluffer +1000. Caught Bluffer who guesses correctly +500.
- **Safety:** 40 instructions. All safe, no contact, nothing dangerous or embarrassing.

### 15. Stowaway (inspired by a social-deduction game) | Priority 4
- **Players:** 3-4 | **Rounds:** 4 | **~12 min**
- **Controller:** `role`, `text`, `choice`.
- **Flow:**
  1. Everyone except the Stowaway sees a secret category ("Ocean"). The Stowaway sees "???".
  2. Everyone writes one short clue (max 20 chars) related to the category. The Stowaway bluffs.
  3. Screen reveals all clues. Real talk in the room for 60 s.
  4. Vote who the Stowaway is. If caught, the Stowaway picks the category from 6 options for a bonus.
- **Scoring:** same shape as The Fake Out.
- **Content:** 50 categories.

### 16. Last Seat (inspired by a trivia-elimination game) | Priority 4
- **Players:** 3-4 | **~15 min**
- **Controller:** `choice` (4 answers), then per-minigame layouts.
- **Flow:**
  1. Round: a 4-choice trivia question, 20 s.
  2. Anyone wrong or late is "in danger" and plays a mini-game. The player who does worst loses a seat.
  3. Mini-games: Reflex (tap when the screen turns green, early tap fails), Memory (repeat a 4-6 symbol sequence), Trapdoors (pick 1-4 in 5 s, one door is rigged each round).
  4. If everyone answers correctly, skip the mini-game. Last two seats play a head-to-head finale: first to 3 correct answers wins.
- **Scoring:** survival rounds + finale win.
- **Content:** 60 trivia questions with 3 wrong answers each. Only facts you are sure about.

### 17. Blind Date Chat (inspired by a private-chat comedy game) | Priority 5
- **Players:** 3-4 | **Rounds:** one per player | **~12 min**
- **Controller:** `chat`, then `choice`.
- **Flow:**
  1. One Dater, the others are Candidates. Each Candidate secretly receives a persona card ("a pirate who only talks about taxes").
  2. Candidates chat privately with the Dater for 60 s. Dater sees one tab per Candidate and a big LOL button.
  3. Dater picks a favorite.
- **Scoring:** Candidates earn +100 per LOL tap and +1000 if picked. Dater +300 if they tapped LOL at least 3 times.
- **Safety:** message length cap, rate limit, no private messages visible on the shared screen until the pick (then show highlights).

### 18. Slingshot Arena (inspired by a physics-party game) | Priority 6, optional
- **Players:** 2-4 | **~5 min**
- **Controller:** `aim` (drag direction and power, release to fire).
- **Flow:** circular arena with hazards. Server physics (circle collisions, friction). Knock others off the edge. Last one standing wins the round, best of 3.
- **Build last.** Real-time physics needs a stable delta-time loop and is the most bug-prone.

---

## 3. Drawing games (need the `draw` controller first)

### 19. Sketch & Lie (inspired by a draw-and-bluff game) | Priority 4
- **Players:** 3-4 | **Rounds:** one drawing per player | **~15 min**
- **Controller:** `draw`, `text`, `choice`.
- **Flow:**
  1. Each player gets a private odd prompt ("a sad cloud selling insurance") and draws it (90 s).
  2. For each drawing, everyone else writes a fake title (30 s).
  3. Screen shows the drawing and all titles plus the real one, shuffled. Players vote for the real one.
- **Scoring:** picking the real title +1000. Artist +1000 per player who picked it. Each player fooled by your fake title +500 to you.
- **Edge cases:** fake equals real: reject. Blank drawing: auto-skipped with a host joke.

### 20. Slogan Shirts (inspired by a t-shirt vote game) | Priority 5
- **Players:** 3-4 | **Rounds:** 2 | **~12 min**
- **Controller:** `draw`, `text`, `choice`.
- **Flow:**
  1. Everyone draws a design (60 s) and writes a slogan (30 s).
  2. The server pairs designs and slogans so nobody gets their own pair (derangement).
  3. Screen shows each pairing as a T-shirt mockup. Vote.
- **Scoring:** both co-authors of the winning shirt +1000. Other shirts +100 per vote.

### 21. Mash-Up Monsters (inspired by an exquisite-corpse game) | Priority 5
- **Players:** 3-4 | **~10 min**
- **Controller:** `draw`.
- **Flow:** the canvas has 3 or 4 stacked sections. Each player draws their section on a different sheet while seeing only a short hint strip from the previous section. Sheets rotate until complete. Screen reveals each monster. Players vote on favorites and name them.
- **Scoring:** +1000 for the section artists of the favorite monster, +300 for the others.

### Skip for now
Murder-mystery drawing, arena-champion drawing, and art-auction games are large and add little beyond the above.

---

## 4. Build order
1. **Foundation:** S1-S4, S6-S10, `text` controller. Prove with **Word Fraud**.
2. **Easy wins:** Fact or Fiction, Fence Sitters.
3. **Controllers:** `slider` -> Gut Check. Multi-field text -> Dumb Inventions.
4. **Voting variants:** Bracket Brawl, Twist It, Slide Roulette, Frankenanswers (needs `rank`), Mind Meld, Clue Crafters, Word Chain.
5. **Rank/role:** Mind Reader, The Fake Out, Stowaway.
6. **Drawing:** `draw` controller -> Sketch & Lie -> Slogan Shirts -> Mash-Up Monsters.
7. **Big ones:** Last Seat, Blind Date Chat.
8. **Last:** Slingshot Arena.

## 5. Definition of done (every game)
- Own `manifest.json`, `server.ts`, `screen.ts`, content pack of the required size
- Pure scoring function with unit tests
- Scripted bot full-game test passes
- No secret leakage (verified by a test that inspects screen-bound messages)
- Disconnect and reconnect in every phase handled
- Works with exactly `minPlayers` and with 4 players
- `npm test`, `npm run typecheck`, `npm run lint` pass
- `PROGRESS.md` updated, plan updated, one commit per game
