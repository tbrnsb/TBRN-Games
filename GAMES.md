# TBRN-Games — Game Catalogue

36 games. Every one: the laptop is the shared screen and the only authority; phones send
inputs only; secrets never reach the TV.

**How a session works:** the laptop opens the screen, creates a room, and shows a QR code.
Each phone scans it and takes a seat. The host picks a game; games that need more players
stay disabled until enough phones have joined. When the game ends the room returns to the
lobby and everyone can play again.

---

## Precision & aim

### Archery — 1-8 players
Hold the button to draw the bow: power builds while you hold. Release to fire. The arrow
flies with gravity toward a target that slides left and right. Score is how close to the
target's centre you land, up to 100 per arrow. Five rounds; highest total wins. Release too
early and the shot is cancelled rather than wasted. Players fire in seat order; at eight the
TV shows every seat's lane and colours each arrow with the owner's seat colour and glyph.

### Darts — 1-4 players
A horizontal slider aims left/right, a vertical slider aims up/down, THROW fires at that
exact point on the board. Real dartboard scoring: bull 50, outer bull 25, triple ring ×3,
double ring ×2, misses 0. Three darts a turn, 501 down to exactly zero ends the match.
Everyone gets equal turns; a 20-round cap decides by lowest score if nobody checks out.

### Golf — 1-4 players
A joystick points where you want the ball to go, a power slider sets strength, SHOOT fires.
The ball rolls with friction, bounces off walls, and stops. Sink it in the cup to finish the
hole; lower strokes win. Each hole is capped at par + 4 so a hole can never run forever.
Multiple holes, everyone plays them in turn.

### Knife Throw — 1-4 players
A target spins continuously. Tap to throw a knife into it. Knives stay where they land — hit
one and you lose points. Each safe knife is +10, each clash is −5. Three rounds of five
knives each, and every player throws every round (the match ends after
`rounds × players` sets).

---

## Action & physics

### Tap Race — 1-4 players
A three-second countdown, then mash. Every tap adds speed, and speed bleeds off at about
55% per second, so bursts beat panic. First to 100 units wins; at the 60-second buzzer the
furthest racer takes it. Your phone shows your taps and your nearest rival's.

### Slingshot Arena — 2-4 players
Turn-based physics. Aim with the joystick, set power, FIRE. Your puck slides, bounces off
others and off the rim, and dies if it leaves the arena or touches a hazard. Equal-mass
elastic collisions, so a good hit knocks someone out. A 60-second round clock decides by
whoever is nearest the centre, so a round always ends. Best of three rounds.

### Spin War — 2-4 players
Tap to shove your blade away from the centre; a constant pull drags everyone back in, so
collisions are unavoidable. Hits knock opponents outward. Fall out of the ring and you are
eliminated. The **last spinner standing** wins — score is ranking only, never the winner.

### Snakes — 1-4 players
Classic snake on a 20×20 grid at 8 moves per second, starting length 3. Eat food to grow and
score; hit a wall or your own body and you are out. Four snakes can share the board.

---

## Knowledge & numbers

### Quiz — 1-4 players
Ten questions, 15 seconds each. A correct answer is worth 1000 plus a speed bonus of up to
500, scaled by how fast you locked in. Timing uses the game clock, not wall time, so a
stalled server cannot hand out free speed points. Highest total wins.

### Quick Trivia — 1-4 players
Six rapid questions, 10 seconds each, four options. Points scale with speed:
`max(100, 1000 − seconds × 90)`. Every question reveals the correct answer for five seconds.

### Percentile — 2-4 players
A real statistic appears. One player estimates it on a 0–100 slider and locks in. Everyone
else bets HIGHER or LOWER without seeing the estimate's direction. Exact hit is 1000; within
15 is `1000 − 50 × distance`; directional bets pay 500, plus 200 when the guess was off by
more than 20. Five rounds, the guesser rotates.

### Mind Meld — 2-4 players
A category appears ("a fruit"). Everyone types one word. You score **300 per other player
who wrote the same thing** after normalisation (case, punctuation, simple plurals). If the
whole table matches, everyone gets 1000 and the game ends immediately.

### Word Chain — 2-4 players
A starting word is given. Each turn the current player types a word that starts with the
last letter of the previous one, exists in the bundled dictionary, and has not been used.
Invalid or late costs one of your two lives. Last player alive wins; placement pays
1000 / 600 / 300 / 100.

### Mind Reader — 3-4 players
Everyone ranks four items privately. Then one player is the Spotlight, and everyone else
ranks the same four items again as a guess at the Spotlight's order. Scoring uses footrule
distance: `1000 × (1 − distance / max)`, so identical orders score 1000 and reversed scores
0. The Spotlight earns 100 per guesser who lands within 70%.

---

## Bluffing, writing & voting

### Bluff — 3-4 players
A prompt appears. Everyone writes a believable fake answer. The real answer is shuffled in
and everyone votes for the one they think is true. Voting for the truth pays 500; each
person your lie fools pays you 200. Six rounds.

### Write & Vote — 3-4 players
A prompt appears and everyone writes an answer, then everyone votes for their favourite
(not their own). Each vote an answer collects is 100 points to its author. Five rounds.

### Dictionarium — 3-4 players
An obscure real word appears with no definition. Everyone invents a definition, they are
shuffled with the truth, and everyone votes. You cannot vote for your own. +500 for finding
the real definition; +100 per vote to each fake. Four rounds.

### Split the Room — 3-4 players
One player fills a blank in an absurd scenario ("You get $10,000, but every time you cough,
___ happens"). Everyone else votes YES or NO. The writer scores
`1000 − |yes − no| × (1000 / voters)`, so a perfect 50/50 split pays the maximum and a
unanimous vote pays nothing. Voters on the smaller side get 150.

### Survive the Internet — 3-4 players
Everyone answers an innocent question. Then each player writes a headline that makes
**someone else's** answer look terrible — answers are passed round so you never twist your
own. Everyone votes for the funniest pairing. Each vote pays 700 to the headline writer and
300 to the person quoted.

### Frankenanswers — 3-4 players
Everyone writes three short word chips. The server deals each player six chips **written by
other people**, plus four connector tiles ("the", "and", "my", "but"). You build an answer
by tapping chips in order — 3-4 chips, at most 2 connectors, all from your own pool — and
the server composes the text. Then everyone votes for the best answer. +1000 per vote to the
author; +100 to each chip's author for chips in a winning answer. If too few chips exist the
content pack fills the gap.

### Bracket Brawl — 3-4 players
Everyone writes one answer to a prompt. Those answers run as a knockout bracket: four
players get two semis and a final, three players get a duel and a bye. Only players **not**
in the current duel vote. Ties break with a secure random pick. Semi wins pay 500, the final
1000, and each correct voter 100.

### Dumb Inventions — 3-4 players
Each player gets a problem card and two random word chips. Name a product, then pitch it in
one sentence using both chips. Everyone votes for the best pitch. +1000 per vote; a pitch
that skips a chip still appears but scores 200 less.

### Blather Round — 3-4 players
One presenter is given a secret word and describes it without naming it. Everyone else types
guesses as fast as they can; typos within an edit distance of 1 still count. Guesses decay
in value over time and the presenter earns per correct guess. Three rounds, rotating
presenter.

### Word Spud — 2-4 players
A word chain by association, not spelling. The current player submits a word related to the
anchor; everyone else votes ACCEPT or REJECT. Accept moves the anchor to the new word and
pays 100; reject keeps the anchor and costs 50. Six links.

---

## Social deduction & chat

### Fakin' It — 3-4 players
Everyone receives the same instruction except one Faker, who is told to copy the group.
Twenty-five seconds of acting in the room, then everyone votes for who was faking. A strict
majority on the Faker pays 200 to each correct voter; anything else pays the Faker 500.

### Stowaway — 3-4 players
Everyone but one player sees a secret category. The Stowaway sees only "???". Everyone
writes one short clue about the category; the Stowaway bluffs. Clues are revealed, the room
talks, then everyone votes. A strict-majority accusation catches the Stowaway (+500 per
correct detective); if caught, the Stowaway can still name the category for +500. Uncaught,
the Stowaway takes 1000.

### Most Likely To — 3-4 players
A prompt appears ("most likely to..."). Everyone votes for a player, anonymously. Votes are
revealed together and the most-voted player takes the round. Eight rounds.

### Blind Date Chat — 3-4 players
One player is the Dater; everyone else is a Candidate with a secret persona ("a pirate who
only talks about taxes"). Candidates chat privately with the Dater — the Dater sees every
conversation but the TV only ever sees message counts, never text. The Dater can tap LOL.
Then the Dater picks a favourite. Candidates earn 100 per LOL and 1000 if picked; the Dater
earns 300 for actually laughing.

---

## Drawing

### Drawful — 3-4 players
One player draws a ridiculous prompt on their phone with vector strokes. Everyone else
invents a fake title. All titles plus the real one go up for a vote. The artist earns 500
per vote for the true title; each bluff earns 250 per vote.

### Slogan Shirts — 3-4 players
Everyone draws a design, then everyone writes a slogan. Slogans rotate so nobody's design
carries their own slogan. Vote for the best shirt. The winning shirt pays both co-authors
1000; every other shirt pays 100 per vote. You cannot vote for a shirt built on your own
design.

### Mash-Up Monsters — 3-4 players
Each pass sends every player to a different sheet to draw one section of a monster, seeing
only the last few points of the section before. Sheets rotate until every section is filled
by a different artist. Then everyone names a monster and votes for the favourite: its namer
takes 1000, everyone else 300.

---

## Performance

### Slide Roulette — 3-4 players
One presenter gets a topic and no slides. Everyone else writes a single slide caption. The
presenter improvises out loud while the captions appear one at a time, tapping to advance.
The audience rates 1–5 stars. Presenter earns 200 per star; slide authors earn 100 when the
average reaches 4. One round per player.

---

## Elimination

### Last Seat — 3-4 players
Sixty trivia questions. A wrong or late answer sends you to a minigame — reflex (tap after
the hidden target), memory (repeat the four-symbol sequence), or trapdoors (pick a door, one
is rigged). The worst performer loses their seat. Two survivors play a first-to-three finale.
An eight-round cap decides by correct answers if nobody is eliminated.

### Hangman — 1-4 players
A word is hidden. Players guess one letter at a time; correct letters reveal and score 10,
six wrong guesses end the round for everyone. Completing the word pays 50. Ten rounds.

---

## Cards & board

### Texas Hold'em — 2-8 players
Full no-limit Texas Hold'em against the other phones. The host picks the starting stack
(everyone equal) and the number of hands before the game starts. Betting uses a raise
stepper between the minimum raise and your maximum, so you can size bets freely instead of
fixed increments. Hole cards are private; only your own hand ever reaches your phone. All-ins
are split into a main pot and side pots automatically. When you lose your last chip you become
a spectator and finish in reverse elimination order. After the agreed hand count, the biggest
stack wins.

### Guess Who — 2-4 players
Everyone gets a secret character. You are matched with one fixed opponent for the whole
match, so your deductions keep their value. Ask yes/no questions about their character and
get truthful answers, then **flip down the faces** that no longer fit on your own phone
board. The TV shows how many options each player has left ("Ana is down to 2 options").
When you are down to six or fewer, guess buttons appear. A correct guess wins the match; a
wrong one costs a life.

---

## Controllers

Each game drives the phone differently, and some switch mid-game:

`one-button` · `left-right` · `dpad` · `text` · `choice` · `private-grid` · `card-hand` ·
`slider` · `dual-slider` · `pad` · `aim` · `tap-race` · `board` · `numpad` · `canvas` ·
`chat` · `rank` · `role`
