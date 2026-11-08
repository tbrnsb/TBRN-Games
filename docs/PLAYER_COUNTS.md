# Player counts

Final player ranges for every game, as shipped after the platform
expansion (phases 2-6). The table is generated from `shared/game-catalog.ts`,
which is the single source the lobby, start gate and Royal Rumble resolver
read; a test fails if a manifest and the catalog disagree on hard limits.

- **Players** is the hard range: a game cannot start outside it.
- **Ideal** is the range the game plays best in; the lobby greys a game out
  with a reason when the table size falls outside it.
- The room ceiling is 8 seats for every game.

## Enabled games

| Game | Players | Ideal | Kind |
|---|---|---|---|
| Blather Round (`blather`) | 3-8 | 4-8 | party |
| Bluff (`bluff`) | 3-8 | 4-8 | writing |
| Bracket Brawl (`bracket`) | 3-6 | 4-6 | writing |
| Darts (`darts`) | 1-4 | 2-4 | skill |
| Drawful (`drawful`) | 3-8 | 4-8 | drawing |
| Dumb Inventions (`dumbinventions`) | 3-6 | 4-6 | writing |
| Fakin' It (`fakin`) | 3-8 | 4-8 | deduction |
| Frankenanswers (`frankenanswers`) | 3-6 | 4-6 | writing |
| Guess the Imposter (`guessimposter`) | 3-8 | 5-8 | deduction |
| Mind Meld (`mindmeld`) | 2-8 | 4-8 | party |
| Most Likely To (`mostlikely`) | 3-8 | 4-8 | party |
| Percentile (`percentile`) | 2-8 | 3-8 | trivia |
| Quiz (`quiz`) | 1-8 | 3-8 | trivia |
| Slide Roulette (`slideroulette`) | 3-8 | 4-8 | party |
| Slingshot Arena (`arena`) | 2-4 | 2-4 | skill |
| Slogan Shirts (`sloganshirts`) | 3-8 | 4-8 | drawing |
| Split the Room (`splitroom`) | 3-8 | 4-8 | writing |
| Stowaway (`stowaway`) | 3-8 | 4-8 | deduction |
| Survive the Internet (`survive`) | 3-6 | 4-6 | writing |
| Tap Race (`racing`) | 1-8 | 3-8 | skill |
| Texas Hold'em (`poker`) | 2-8 | 3-8 | cards |
| Write & Vote (`writevote`) | 3-8 | 4-8 | writing |

## Disabled games (kept in the tree)

Disabled is a registry flag, never a delete. These keep their ranges so they
can be re-enabled without a re-audit.

| Game | Players | Ideal | Kind |
|---|---|---|---|
| Archery (`archery`) | 1-8 | 2-8 | skill |
| Blind Date Chat (`bdate`) | 3-4 | 3-4 | party |
| Dictionarium (`dictionarium`) | 3-4 | 3-4 | writing |
| Golf (`golf`) | 1-4 | 2-4 | skill |
| Guess Who (`guesswho`) | 2-4 | 2-4 | deduction |
| Hangman (`hangman`) | 1-4 | 2-4 | writing |
| Knife Throw (`knifethrow`) | 1-4 | 2-4 | skill |
| Last Seat (`lastseat`) | 3-4 | 3-4 | party |
| Mash-Up Monsters (`mashup`) | 3-4 | 3-4 | drawing |
| Mind Reader (`mindreader`) | 3-4 | 3-4 | party |
| Quick Trivia (`trivia`) | 1-4 | 3-4 | trivia |
| Snakes (`snakes`) | 1-4 | 3-4 | skill |
| Spin War (`spinwar`) | 2-4 | 3-4 | skill |
| Word Chain (`wordchain`) | 2-4 | 3-4 | writing |
| Word Spud (`wordspud`) | 2-4 | 3-4 | writing |

22 enabled, 15 disabled, 37 total.
