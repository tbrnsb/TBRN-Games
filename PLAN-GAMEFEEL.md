# Game Feel Rebuild — Plan

Status: audit complete, implementation not started.
Supersedes the visual direction in `DESIGN.md` (synthwave/neon/glass). That direction is
the reason the product reads as "AI slop". See §1.

## 1. Diagnosis

### 1.1 The controller is the product, and it is the weakest layer
`shared/controllers.ts` defines seven layouts: one-button, left-right, dpad, text, choice,
private-grid, card-hand. None of them can express a slider, a joystick, a drag, or a
mash-race. Every game that needs one of those is forced into a worse interaction.

| Game | Needs | Has | Result |
|---|---|---|---|
| Darts | horizontal aim + vertical power | `onInput(…, _input)` throws a **random** dart | no skill at all |
| Golf | joystick + power + shoot | dpad: left/right aim, up = charge, down = shoot | no feel |
| Traffic Jam | drag a car along its axis | tap car, tap destination cell | not sliding |
| Racing | tap speed | left/right lane dodge | not a race of taps |
| Gravity Run | tap (fine) | tap, but physics is broken | unplayable |

Evidence: `games/darts/server.ts:145` ignores input entirely; `games/golf/server.ts:152`;
`games/trafficjam/server.ts:400`; `games/racing/server.ts:238`.

### 1.2 Phones never show the game
Jackbox's rule: the screen is the show, the phone is the paddle — but the paddle always
has the *game* on it (your cards, your drawing, your boat, your answer). Here the phone
gets a generic widget and the screen gets everything. Traffic Jam's controller receives a
24x24 char grid (`buildCells`), not the board with cars.

### 1.3 Guess Who is structurally broken with 3+ players
`games/guesswho/server.ts:295` — `nextLiving(state, playerIndex, count)`. The opponent
**rotates every turn**. Deductions about player B are worthless against player C, so a
3-4 player game cannot converge by reasoning; only luck. Also each wrong guess costs a
life, which is not Guess Who's rule.

### 1.4 Gravity Run is unplayable by construction
`games/gravityrun/server.ts:18` — `GRAVITY=25`, `JUMP_VEL=-12` against a play area 1.0
unit tall. At 60fps a flip moves y by 0.2 per frame; the whole field is 1.0 tall.
Obstacles are `h:0.45` placed at y=0.0 or y=0.5, so one of the two lanes is always
fatal and the gap is 0.05. All players die in seconds; line 96 then ends the match.

### 1.5 The visual system is the AI-slop template, on purpose
`DESIGN.md` mandates synthwave + neon + bento + gradients. `public/theme.css:38` stacks
three radial glows + a dot grid over a navy gradient; `--font-display: "Trebuchet MS"`.
Guess Who's "avatars" are hue-rotated circles with a hair arc (`guesswho/screen.ts:285`).
Jackbox is the opposite: flat saturated colour, chunky outlines, hand-drawn characters,
big type, no glow, no glass.

## 2. Direction: Jackbox, not synthwave

- Flat colour, thick outlines (4-6px), hard offset shadows (no blur), rounded chunky shapes.
- 2 fonts max: one heavy display (self-hosted), one clean body.
- Big faces. A character is a head + body + one loud accessory, drawn flat.
- Every screen has a title card with the game's own personality and colour.
- The phone mirrors the screen's art language, at phone scale.
- Kill: glassmorphism, neon glow, gradient backgrounds, dot grids, Trebuchet.

## 3. Work phases

**P0 — Controller primitives** (blocking everything)
`slider` (1D, horizontal or vertical, live drag), `pad` (2D drag = joystick),
`tap-race` (mash meter), `board` (shared board art on the phone, drag to slide).
Extend `ControllerType`, `controllerLayouts`, CSS, and the protocol's input union.

**P1 — Rewire the six**
- Darts: horizontal slider = x, vertical slider = y, release to throw. Real scoring.
- Golf: joystick for angle, power slider, SHOOT button. Momentum + shot preview.
- Traffic Jam: `board` layout, drag a car; screen and phone render the same cars.
- Racing: tap-race. Taps move you; whoever crosses first wins.
- Gravity Run: retune physics to the play area, add respawns, guarantee a first obstacle
  grace period, and a real death animation.
- Guess Who: real characters with art, fixed target per player, 2-4 player rules.

**P2 — Avatars**
24 CC0 "Open Peeps" characters (DiceBear, CC0 1.0) pre-generated into
`client/assets/avatars/`, served locally, credited in `CREDITS.md`. Offline-safe.

**P3 — Visual language**
Retheme `public/theme.css` to flat/chunky. Rework title cards + victory screens to match.
Then the 18 screen renderers, in order of how often they are played.

**P4 — Logic sweep**
Re-run the invariant probe; extend it to assert each game's win condition and that no
game can end in under N seconds from a cold start.

## 4. Decisions (confirmed by the human)

1. **Guess Who**: shared avatar pool on both screen and phone; the phone shows the whole
   board plus the opponent you picked; you flip down the faces you have ruled out; the TV
   reports progress ("Player 1 is down to 2 options"). Fixed opponent for the whole match,
   not a rotating one.
2. **Racing**: pure mash. Taps move you; first across the line wins. No obstacles.
3. **Poker**: host picks the starting stack before the deal (with an "everyone equal"
   option); bets are entered on a numpad, not fixed increments; after the agreed number of
   rounds the largest stack wins.
4. **Dropped games**: seabattle, trafficjam, slotcar, gravityrun. Removed in this pass.
5. **Tutorials**: every game carries a short "how to play" that shows on the phone and on
   the TV before the first input.
6. **Canvas + chat controllers**: adopted. `CanvasController` (vector strokes, never raster)
   and `TextChatController` (private per-socket messages) are the two new primitives that
   unlock the drawing and deduction games.

## 5. Build order

1. ~~Reconnect/seat bug~~ — done (`tests/reconnect.test.ts`).
2. ~~Drop four games~~ — done.
3. Controller primitives: `slider`, `pad`, `tap-race`, `board`, `numpad`, `canvas`, `chat`.
4. Darts, Golf, Racing, Guess Who rewired onto them.
5. Poker: stack config + numpad + round limit.
6. Tutorials everywhere.
7. New games, in order: Percentile Estimation, Drawful-style, Split the Room,
   Fakin' It, Survive the Internet, Blather 'Round, Tee K.O./Champ'd Up, then the rest.
8. Per-game `theme.json` + flat/chunky restyle + announcer.

