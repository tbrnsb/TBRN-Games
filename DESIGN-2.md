# TBRN-Games: Visual and Audio Identity (DESIGN.md, v2)

> **AGENT: this file REPLACES the earlier Synthwave DESIGN.md.** The Synthwave look (neon, glow, gradients, glass cards, Inter, grid horizon) was rejected as generic. Delete it. Do not keep dead styling code.
> You have broad freedom: download assets, fork or vendor open-source libraries, write build scripts, restructure `client/` freely. The limits are in section 12 (legal) and section 13 (do not touch server logic).
> Work in phases V0, V1, V2... (not F0-F2 and not Phase 0-2). Track everything in `PROGRESS.md` and `ASSETS.md`. Do not write other design docs.
> Build one phase or one game per session, then stop.

---

## 1. North star

**TBRN Game Night.** The screen is a coffee table on game night. Every game is a different physical printed thing someone pulled out of a closet: a tabloid, a dictionary page, a circus poster, a yearbook, a fortune-teller card. All of it is printed with a few flat spot inks on real-feeling paper, cut out, taped, stamped and doodled on.

Each game has its own personality, but all of them share the same universe: the same paper-and-ink craft language, the same host character, the same motion physics, the same sound family, the same player tokens, the same controller behavior. A player should feel "different game, same night, same table."

The feeling we want: **warm, tactile, funny, a bit chaotic, handmade.** Jackbox-level immersion comes from personality, timing, and sound, not from effects.

### 1.1 Anti-slop rules (hard)
Never use:
- Gradients as a main fill. (Tiny paper-fold shading is OK.)
- Glow, neon, bloom, glassmorphism, blur backdrops, soft diffuse drop shadows
- Purple-to-blue anything, "AI dashboard" bento cards, uniform rounded rectangles everywhere
- Inter, Roboto, Space Grotesk, Orbitron, system-ui as a visible font
- Generic emoji or stock icon sets as the main art. Icons only as small utility glyphs.
- Perfect symmetry and perfect alignment everywhere. Real paper is slightly crooked.
- Centered, evenly spaced "card in the middle of the screen" layouts as the default

Every screen must contain at least three handmade details from this list: tape, pins, staples, paper clips, stamps, scribbles, torn edge, coffee ring, sticker, crayon or marker underline, folded corner, cut-out letters, misregistered ink.

### 1.2 Self-audit checklist (run before ticking any game)
- [ ] Shrink a screenshot to 320 px wide: is the hierarchy still obvious (1 big thing, 1-2 medium things)?
- [ ] Only the game's paper + 2 spot inks + ink-black are used (plus player colors on tokens)?
- [ ] Any gradient, glow, blur, or soft shadow? Remove it.
- [ ] Hard offset shadows only (see 3.5)?
- [ ] At least three handmade details visible?
- [ ] Player text (answers, names) fits its box at every length (text-fit working)?
- [ ] Mox (host) appears at least once with a line?
- [ ] Sound plays on start, reveal, score, and win?
- [ ] 60 fps on a 4x CPU-throttled run?

---

## 2. The universe and its cast

### 2.1 The Table (lobby and game picker)
- A top-down tabletop on a warm wooden surface (flat color + wood-grain texture, not a photo). A paper lamp shade casts a soft warm circle (one flat translucent shape, no blur).
- **Games are boxes on a shelf strip** along the top or side. Each box has its own box art in its own skin (title lettering, 2 inks, one simple illustration). Hover or focus: the box tilts and lifts. Select: the box slides to the table, the lid lifts off, and the game's paper unfolds out of it. Back: reverse.
- **Room code** on a luggage tag tied with string. **QR code** on a white sticker with a hand-drawn arrow and "scan me". Both big enough to read from across a room.
- **Players** appear as paper tokens sitting at table edges (see 2.3) with name tags. When someone joins: the token drops in with a thud and a little paper puff.
- **Disabled game** ("needs 3 players") = the box has a hand-written sticky note "NEED 3" and sits slightly lower. Never just fade it.
- Mox (the host) leans in from a corner and comments on the room.

### 2.2 Mox, the host (the personality of the platform)
An original cut-paper emcee character. Built from simple SVG shapes so it scales and animates cheaply:
- Body: lopsided round blob with a vest or jacket (outfit changes per skin: bow tie, top hat, sunglasses, detective hat, chef hat, party hat...)
- Face: two eyes (circle + pupil that can look at the active player), one expressive eyebrow, a mouth with 5 shapes (closed, open-a, open-o, smile, frown)
- Hands: a megaphone or microphone prop, pointing hand, shrug
- Expressions: idle, talk, gasp, laugh, smug, sad, celebrate (7)
- Voice: **no TTS.** Each character typed in the caption triggers a tiny pitched blip (Web Audio, per-skin pitch). Captions type out in a torn-paper speech banner; the mouth flaps with the blips. Zero audio files.
- Lines come from the S6 host-announcer library in `GAMES-SPEC.md` (events: gameStart, allSubmitted, reveal, tie, bigWin, roundEnd, winner, disconnect), 4+ variants each, plus per-skin flavor. Keep lines short and warm, never cruel to real people.
- Mox is never in the way of gameplay: bottom corner, max 18% of the screen height.

### 2.3 Player tokens
Four paper-cut creatures, one per slot, built from parts:
- Body shape: circle, triangle-ish, square-ish, star-ish (shape + color so color-blind players can tell them apart)
- Player colors (always with an ink-black outline and hard offset shadow): Slot 1 Bubblegum `#FF5BA7`, Slot 2 Sun `#FFC21A`, Slot 3 Teal `#0E8C8C`, Slot 4 Sky `#3AA7E8`
- Face: random eye pair (6 variants) + mouth (6 variants), chosen once per join and persisted with the rejoin token
- Nametag: a ribbon or masking-tape strip with the name in the marker font
- States: idle bob, thinking (looking up), submitted (token slaps a "SENT" stamp), winner (hops and tosses confetti), disconnected (sleeping Zs, grayscale paper)
- The same token appears on the phone header so players recognize themselves.

---

## 3. Global design system (shared by every game)

### 3.1 Paper
Each skin chooses a paper. Pre-baked, tiled, low-contrast textures (512x512 WebP):
`cream #F4EBD9`, `newsprint #E7E0CC`, `kraft #C8A26B`, `butter #FBE7A1`, `mint #D9F0E8`, `pale-pink #FBD9E3`, `chalkboard #2C4A3E`, `blueprint #1F4E9C`, `felt #0F5C3F`, `night #1E1B3A`.
A fixed full-screen grain overlay (WebP, 6-8% opacity, `mix-blend-mode: multiply`) sits on top. Optional subtle fold lines and a vignette made of one flat translucent shape (no blur).

### 3.2 Spot inks
Master ink set (no other colors appear, apart from player tokens and tiny accents):
`Bubblegum #FF5BA7`, `Tomato #F0453A`, `Tangerine #FF8A1F`, `Sun #FFC21A`, `Grass #2FB56A`, `Teal #0E8C8C`, `Sky #3AA7E8`, `Cobalt #2447C8`, `Grape #7A4FD0`, `Ink #1D1B26` (near-black, used for all text and outlines).
Each skin uses **paper + 2 spot inks + Ink**. Where two inks overlap, use `mix-blend-mode: multiply` so they overprint like risograph. Offset one ink layer 2-3 px for misregistration on big shapes and headlines.

### 3.3 Halftone and print texture
- Halftone dots for shading (pre-baked patterns or SVG pattern). Never smooth gradients.
- Stamps: rough-edged, slightly rotated, ink slightly uneven (use an SVG turbulence mask pre-rendered to a bitmap, not a live filter).
- Hand-drawn lines: use `rough.js` or `perfect-freehand` style wobble pre-baked into SVG paths. Outline weight 3-4 px at 1080p, rounded joins.

### 3.4 Typography
Fonts are OFL or similar, self-hosted (`@fontsource/*` packages or direct woff2), subset to Latin to save weight.
- **House display:** Bricolage Grotesque (ExtraBold) for platform UI, scores, room code, names
- **House body:** Atkinson Hyperlegible (very readable at a distance)
- **Handwriting:** one marker font (Permanent Marker or Caveat Brush) for notes and corrections
- Each game adds ONE display font (section 9) and optionally one text font. Verify each font exists in fontsource; if not, substitute one with the same personality and record it.
- On-screen minimums at 1080p: body 28 px, labels 22 px, scores 72 px+, titles 110 px+. Scores use tabular figures.
- **Text-fit is mandatory:** player-written text must auto-shrink to fit (binary search font size), then wrap, then ellipsize at the last resort. Test with 1 character, 100 characters, and no spaces.

### 3.5 Shape and depth
- Hard offset shadows only: `4px 4px 0 Ink` (large elements 8px 8px 0). No blur.
- Corner radius: mixed on purpose. Paper cards 4-10 px with one slightly uneven corner; stickers fully round or die-cut blobs; ticket and label shapes with notches.
- Slight rotation on most placed items (-3 to +3 degrees). Overlaps with tape or pins.
- 12-column grid is only a loose guide. Break it on purpose.

### 3.6 Layout principles
- One hero element per screen (the question, the drawing, the prompt). It is the largest and most contrasting thing.
- Scoreboard lives on a consistent edge (side rail of paper tags) so players always know where to look.
- Safe margin 64 px at 1920x1080. Design at 1920x1080 logical, scale to fit, verify at 1280x720.

---

## 4. Motion language ("snappy paper")
- Things enter like paper: slide + slight rotation + a small overshoot (easeOutBack, 280 ms). Stagger 50 ms.
- Impacts are **stamps**: scale 1.5 to 1 in 120 ms with a 6 px screen shake that decays in 200 ms. Stamp particles = small ink flecks.
- Idle life: cutouts wobble +-1.5 degrees on stepped timing (6 fps feel, via `steps()` or a 6 fps ticker). It reads as stop-motion and is cheap.
- Reveals: a paper flap peels, a curtain pulls, or a sticky note is torn away. Not fade-ins.
- Scores count up with a ratchet tick; the total pops with a stamp.
- Always use delta time. Respect `prefers-reduced-motion`: disable shake and wobble.
- Particles: ink flecks, paper confetti, tape bits. Hard cap 250 live. No blur filters.

## 5. Sound language
Sound is half of the immersion. Build `client/kit/sound.ts` (Web Audio, with a master mute, master volume saved locally, default 60%). Audio starts after a first click: the screen shows a "Click to start the party" ticket.
- Layers: UI, game sfx, host blips, optional music bed.
- **Prefer synthesized sound** (Web Audio oscillators and noise, or sfxr-style generated one-shots) for UI and host blips: it costs zero bytes. Use CC0 recorded sounds for tactile things (wood, paper, chalk, stamps, crowds).
- Shared sounds (every game): join pop, stamp thud, paper slide, sticker peel, timer tick (last 5 s speeds up), correct ding, wrong buzz, reveal drum roll, win fanfare, disconnect sigh.
- Each skin has a sound "bank" flavor (section 9): for example wood thunks, chalk taps, cardboard flaps, tape rips.
- Music is optional: a short looping bed per game, 60-90 s, 96 kbps mono Opus, CC0 or CC-BY with credit. Duck music under host captions.
- Phones: no audio by default, only haptics (`navigator.vibrate`) for taps, submit, and your-turn.

---

## 6. Controller (phone) design
The phone is a **mini version of the game's printed thing**: same paper, inks, and display font, trimmed to a header strip and big controls.
- Portrait, safe-area insets respected, no hover states, tap targets at least 56 px, body text at least 18 px.
- Header: your token + name + a status ribbon ("your turn", "waiting for others", "look at the screen").
- Controls look like physical objects: stamped buttons with hard offset shadows that press down on tap (shadow collapses, 2 px move). Sliders look like pencils or rulers. Text fields are ruled paper with a handwriting font.
- Submitting: a "SENT" stamp slams down and the form locks. Waiting state: something alive (token reading a magazine, whistling), never a blank spinner.
- Reconnect state: a friendly "finding the table..." with a token sleeping.
- New layouts to style (from `GAMES-SPEC.md`): `text`, `slider`, `rank`, `draw`, `chat`, `role`, `aim`, plus the existing `one-button`, `dpad`, `choice`, `card-hand`, `private-grid`, `left-right`.

---

## 7. Technical approach
- Read the three existing renderers and the screen client first. **Match the real renderer interface.**
- Use **DOM + CSS + SVG** for text-heavy games (answers, voting, definitions, bracket) because typography and text-fit are far better. Use **PixiJS** (or plain canvas) for real-time action games (Racing, Snakes, Golf, Darts, Archery, Slingshot, Slot Car, Gravity Run, Knife Throw, Spin War). The kit supports both, with a DOM overlay on top of a canvas for scores and captions.
- Pre-render everything possible: SVG to bitmap atlases at fixed scale, paper and grain as tiles, stamps as bitmaps. Avoid live SVG filters and CSS blur on large areas.
- Atlas size max 4096x4096. Keep total texture memory modest (the target machine has 8 GB RAM and integrated graphics).
- Offline at runtime: no CDN, no remote fonts, no remote images. Downloading is for development; commit the processed results.
- Asset budgets: each game folder at most 3 MB of art, whole repo assets at most 60 MB, music optional and counted in that.
- Shared code goes in `client/kit/`: skin loader, paper and grain, ink-blend helpers, stamp/tape/pin/sticker primitives, text-fit, sound manager, Mox, player tokens, transitions, confetti, ratchet counter, victory screen, shelf and box components.
- Skin file per game: `client/skins/<game>/skin.ts`.

```ts
export interface Skin {
  id: string;            // "factorfiction"
  title: string;         // display name
  vibe: string;          // one line: the printed thing
  paper: PaperId;        // see 3.1
  inks: [InkId, InkId];  // see 3.2
  fonts: { display: string; body: string; accent?: string };
  props: string[];       // asset ids (tape, stamps, pins, etc.)
  enter: "slide-tilt" | "stamp" | "drop" | "unfold" | "curtain";
  sound: { bank: string; hostPitch: number };
  mox: { outfit: string };
}
```

---

## 8. Accessibility
- Text contrast at least 4.5:1 on its paper. Check with a script (compute contrast from the skin tokens).
- Never rely on color alone: players have shapes, right/wrong have icons and words, ranks have numbers.
- Reduced-motion mode, mute button, and a high-contrast toggle (swaps to paper white + Ink only) reachable on the screen.
- Text readable from 3 meters.

---

## 9. Game skins (all games)
Every game gets: its own printed-thing vibe, paper, two inks, one display font, a signature moment, and a sound bank. The vibe decides the props (what is taped, stamped, or pinned). Existing games first, then new games from `GAMES-SPEC.md`.

### 9.1 Existing games
| Game | Vibe (printed thing) | Paper + inks | Display font | Signature moment | Sound |
|---|---|---|---|---|---|
| Archery | Medieval tournament woodcut poster + parchment scorecard | butter + Tomato, Teal | Pirata One | Arrow thunks in, target rings wobble, score scratched in quill | wood thunk, bowstring, parchment scratch |
| Bluff | Carnival barker banner and stage curtains | cream + Tomato, Sun | Rye | Curtains swish open, giant "TALL TALE!" stamp | brass blat, curtain whoosh, crowd gasp |
| Darts | Pub chalkboard with beer-mat scoreboard | chalkboard + Sun, Bubblegum (chalk white lines) | Caveat Brush | Chalk tally strokes draw themselves, bullseye chalk burst | chalk taps, dart thwack, pub murmur |
| Golf | Putt-putt course sign and pencil scorecard | mint + Grass, Sun | Lilita One | Ball plops in the cup, flag wiggles, pencil adds the score | ball clack, cup plop, polite clap |
| Gravity Run | Comic-book panels with halftone space | night + Sky, Bubblegum | Bangers | Panel borders shatter on big jumps, "WHOOSH" lettering | whoosh, boing, comic pow |
| Guess Who | Detective case file with polaroid mugshots and paper clips | kraft + Cobalt, Tomato | Special Elite | Polaroids flip down as suspects are eliminated, "CLOSED" stamp | typewriter keys, paper clip clink, desk bell |
| Hangman | School notebook doodle page | cream (lined) + Cobalt, Tomato | Patrick Hand | Hand-drawn stick figure builds line by line, red-pen word reveal | pencil scratch, eraser rub, page flip |
| Knife Throw | Circus poster with a spinning wheel | butter + Tomato, Cobalt | Bowlby One | Knife sticks with wobble, wheel rattles, balloons pop | knife thunk, circus drum, balloon pop |
| Most Likely To | School yearbook superlatives with photo frames | cream + Cobalt, Sun | DM Serif Display | Tokens get pasted into photo frames, winner gets a cap and sash | page flip, camera click, school bell |
| Poker | Kitchen-table card night with felt and chips | felt + Sun, Tomato | Alfa Slab One | Cards slap down, chips stack with a slide, showdown flips | card slap, chip clatter, felt rustle |
| Quiz | Retro TV game-show set with podiums and marquee bulbs | cream + Cobalt, Sun | Titan One | Marquee bulbs chase, buzz-in thunk, answer card slams | buzzer, rim-shot, studio applause |
| Racing | Vintage Grand Prix poster, big flat shapes, speed lines | cream + Tangerine, Teal | Anton | Cars rip past the camera, checkered flag waves, speed-line wipe | engine growl, tire squeal, crowd roar |
| Sea Battle | Nautical chart on graph paper with pencils | pale-blue paper (use mint tint) + Cobalt, Tomato | Bungee | Splash rings are inked, hit marks as red X, sunk ship gets a stamp | splash, sonar ping, ship horn |
| Slot Car | 1960s toy-catalog spread with orange track | cream + Tangerine, Sky | Shrikhand | Cars tilt through loops, sparks as ink flecks, catalog price-tag score | slot-car buzz, tick-tick, click-clack |
| Snakes | Board-game box lid and wooden board | butter + Grass, Grape | Modak | Dice tumble, tokens hop, snakes slither with stepped wobble | dice rattle, hop pop, hiss |
| Spin War | Spinning-top battle on a carnival tray | cream + Grape, Tangerine | Rubik Mono One | Tops clash with spark flecks, loser wobbles and falls over | whirr, clack, tiny crowd oohs |
| Traffic Jam | City street map with road signs and sticky arrows | newsprint + Sun, Cobalt | Oswald | Cars honk and shuffle, "ROAD OPEN" sign flips | horns, engine idle, blinker tick |
| Write & Vote | Corkboard with sticky notes and marker | kraft (cork) + Bubblegum, Teal on Sun notes | Permanent Marker | Notes slap onto the board, winner note gets a gold star sticker | pin push, paper slap, marker squeak |

### 9.2 New games (from `GAMES-SPEC.md`)
| Game | Vibe (printed thing) | Paper + inks | Display font | Signature moment | Sound |
|---|---|---|---|---|---|
| Word Fraud | Old dictionary page with a red edge and ribbon | cream + Tomato, Ink | Fraunces | Definitions appear as typed entries, the real one gets a ribbon marker | page turn, quill scratch, book thud |
| Fence Sitters | Backyard picket fence and hand-lettered yard-sale signs | mint + Teal, Tangerine | Sedgwick Ave Display | Tokens climb to either side of the fence, split bar is a tug-of-war rope | wood creak, rope snap, birds |
| Gut Check | Pressure gauge and thermometer on a doctor's chart | pale-pink + Tomato, Teal | Fredoka (bold) | Needle swings and settles, guesses are pinned on the dial | gauge tick, spring boing, ding |
| Fact or Fiction | Tabloid newspaper with rubber stamps | newsprint + Tomato, Ink | Abril Fatface + Playfair Display | Headline slams, TRUE or FALSE stamp hits | press rumble, rubber stamp thump, camera flash |
| Mind Meld | Overlapping cellophane circles (multiply overprint) | butter + Bubblegum, Sky (Sun overlap) | Baloo 2 (ExtraBold) | Circles drift together, matches glow as overprint color | soft chime, bubble pop, harmony swell |
| Dumb Inventions | Patent blueprint and infomercial product boxes | blueprint + Sun, cream lines | Staatliches | Blueprint draws itself, product box pops with "AS SEEN ON..." burst | pencil draw, cash register, infomercial sting |
| Slide Roulette | Cheesy corporate slide deck on an overhead projector | cream + Teal, Tangerine | Archivo Black | Slide clicks in with projector fan hum, laser-pointer dot | projector clunk, slide click, polite clap |
| Bracket Brawl | Pro-wrestling and boxing tournament poster | cream + Tomato, Cobalt | Bebas Neue | Answers clash like fighters, winner's name stamped on a championship belt | bell ding, crowd chant, thwack |
| Twist It | Ransom-note collage of cut-out letters | newsprint + Bubblegum, Ink | mixed per character (Abril Fatface, Special Elite, Bangers, Rye) | Letters are glued on one by one, pairs snap together | scissor snip, glue squelch, paper rip |
| Frankenanswers | Magnetic word tiles on a fridge door | pale fridge-white + Grape, Tangerine | Libre Baskerville | Tiles slide and click into a sentence line | magnet click, tile clack, fridge hum |
| Clue Crafters | Fill-in-the-blank paperback puzzle book | butter + Cobalt, Tomato | Patrick Hand | Blanks fill with pencil, wrong guesses crossed out in red | pencil scribble, page flip, ding |
| Word Chain | Wooden letter tiles around a ring table | kraft + Tangerine, Teal | Chango | Tiles clack into a ring, chain curls, lost life = a tile cracks | wood clack, tile slide, crack |
| Mind Reader | Fortune-teller tarot cards with stars | night + Sun, Grape | Cinzel Decorative | Cards flip with a shimmer-free paper flip, crystal ball shows the average | card flip, soft bell, mystic hum |
| The Fake Out | Spy dossier with rubber stamps and coffee rings | newsprint + Tomato, Ink | Allerta Stencil | "CLASSIFIED" stamp, caught bluffer gets a mugshot photo | stamp thump, typewriter, film projector |
| Stowaway | Ship's cargo manifest and stenciled crates, rope | kraft + Teal, Tomato | Stardos Stencil | Crates open to reveal clues, stowaway is "found" under a tarp | creak, rope, seagulls, ship bell |
| Last Seat | Midnight game show with chairs and a wobbly spotlight | night + Tomato, Grape | Eater (or similar spooky-cheeky display) | Chairs vanish one by one with a puff, last chair gets a spotlight | spooky organ, chair scrape, crowd gasp |
| Blind Date Chat | Newspaper lonely-hearts personals and valentine cards | pale-pink + Tomato, Bubblegum | Pacifico | Messages appear as typed postcards, LOL taps become paper hearts | typewriter, heart pop, kiss smack |
| Slingshot Arena | Toy-box arena with rubber bands and plastic blobs | cream + Sky, Tangerine | Boogaloo | Rubber band stretches, blobs boing off the edge | rubber twang, boing, plop |
| Sketch & Lie | Kid's sketchbook with crayon textures and gallery frames | cream + crayon set (Bubblegum, Sun, Sky, Grass) | Gochi Hand | Drawings are hung on a wall with tape, real title is read like a museum plaque | crayon scribble, tape rip, gallery murmur |
| Slogan Shirts | Screen-print shop with squeegee and tee hang-tags | kraft + Cobalt, Tangerine | Londrina Solid | Shirt gets squeegeed with a design, hang-tag shows the slogan | squeegee swipe, press clunk, cheer |
| Mash-Up Monsters | Folded paper flip-book and sticker sheet | butter + Grape, Grass | Sniglet | Fold-over sheets unfold into a full monster, stickers add eyes | paper fold, sticker peel, silly roar |

Fonts above: verify each in fontsource, and if one is missing, substitute a font with the same personality and record it in `ASSETS.md`.

### 9.3 Lobby and shared screens
House display + body fonts, wood table surface, game boxes. The shared victory screen: a podium built from cardboard boxes, tokens climbing up, paper confetti, big score tags, Mox holding a trophy made of a wrapped candy.

---

## 10. Asset sourcing (you may go to any extent, with rules)

### 10.1 What you may do
- Search the web and download assets and code. Use WebSearch/WebFetch, `curl`, `git clone`, `npm`.
- **Fork or vendor open-source libraries** (MIT, Apache-2.0, ISC, BSD) when they save real time: for example `rough.js` (hand-drawn wobble), `perfect-freehand` (smooth drawing strokes, also for the draw controller), `canvas-confetti` or a small custom particle emitter, `howler` (only if Web Audio helpers are not enough), `matter-js` (only for Slingshot Arena if you do not write simple circle physics yourself), `pixi.js` (already added). Pin versions. Read the code you pull in. No packages that phone home, run postinstall scripts, or add analytics.
- Hand-author SVG and generate assets with scripts. Writing a small Node script that generates paper textures, halftone patterns, stamps, tape, and tokens is encouraged.
- Use dev tools: `sharp` (Apache-2.0) for WebP/PNG, `svgo` (MIT), `ffmpeg` for audio (Opus/MP3), ImageMagick, Inkscape CLI if installed. Install as devDependencies or use system tools. Do not commit tooling caches.
- Look at reference imagery only to understand a style (public pages, Pinterest-like boards, old catalogs). **Never copy or trace a specific copyrighted illustration, character, logo, poster, or screenshot.** Make original work in that genre.

### 10.2 Good places to look (check each asset's own license page)
- Sprites, UI, audio: Kenney (CC0), OpenGameArt (filter to CC0 and CC-BY), itch.io asset packs (only where the license explicitly allows redistribution)
- Textures and patterns: ambientCG (CC0), Poly Haven (CC0), Subtle Patterns-style pattern sources with a clear free license
- Fonts: Google Fonts and Fontshare/Fontsource (OFL and equivalents)
- Icons (utility only): Lucide (ISC), Phosphor (MIT), Tabler (MIT)
- Sound: Freesound (CC0 only), Kenney audio (CC0), OpenGameArt CC0 audio, or synthesize with Web Audio
- Music (optional): CC0 first; CC-BY tracks are allowed if credited in the in-app Credits screen
- Illustration and silhouettes: public-domain archives (Wikimedia Commons public domain, Smithsonian Open Access CC0, Internet Archive public-domain scans, vintage ads and woodcut engravings out of copyright) for texture and ornament, always recording the exact license

### 10.3 Allowed licenses
- Allowed: CC0, public domain, MIT, Apache-2.0, ISC, BSD, OFL (fonts), CC-BY (with attribution in an in-app Credits screen)
- Not allowed: CC-BY-NC, CC-BY-ND, CC-BY-SA for bundled assets (the project is MIT), GPL art or code, anything "free for personal use only", anything without a clear license, anything ripped from commercial games or from Jackbox, any trademarked character or logo
- If unsure, do not use it.

### 10.4 Recording (mandatory)
`ASSETS.md` at the repo root, one row per external asset or library: name, source URL, author, license, date retrieved, files in the repo, modifications. A script `npm run assets:check` fails if a file under `client/assets/` is not listed. Add a Credits screen (in the screen client menu) listing CC-BY items.

### 10.5 Process per asset
Search, preview in the browser (Playwright), check the license on the source page, download, convert and optimize (`svgo`, `sharp`, `ffmpeg`), commit, record in `ASSETS.md`.

---

## 11. Verification
- Playwright MCP tools (use exact names to save tokens): `browser_navigate`, `browser_resize` (1280x720 first), `browser_take_screenshot` (`scale=css`), `browser_snapshot`, `browser_console_messages` (`level=error`), `browser_evaluate` for objective checks.
- Chromium lives at `/usr/bin/chromium`. For your own Node scripts set the Playwright executable path to it.
- **Build `npm run shots`:** a script that starts a room, joins bot clients (`tests/bot-client.ts`), starts a given game, steps through its phases, and saves PNGs to `design/shots/<game>/<phase>.png` at 1920x1080 and 1280x720 for the screen, and 390x844 for the phone controller. It also writes `design/shots/index.html`, a contact sheet the human can open to review every game at a glance. This works even if your model cannot see images.
- **Vision rule:** if you cannot actually see screenshots, say so once, do not claim the look is good, run the objective checks below, and tell the human to review `design/shots/index.html`.
- Objective checks (script them in `scripts/check-design.ts`): contrast ratios, no text overflow (compare `scrollWidth` to `clientWidth` for key elements), console errors, text-fit with 1/100/no-space strings, frame time p95 under 20 ms with CPU throttling 4x, memory not growing across 3 restarts of the game.
- A `?debug=1` query flag on the screen shows an FPS and frame-time overlay.

---

## 12. Hard constraints
- **Do not change server logic, rules, or protocols.** Changes allowed: client code, skins, assets, kit, styles, scripts, and new controller layouts (visual layer only). New server-side games come only from `GAMES-SPEC.md`.
- **No secret leakage on the shared screen.** Poker hole cards before showdown, Guess Who secrets and attributes, Sea Battle ship positions, Traffic Jam private grids, hidden answers and roles before reveal. Only render what the state already exposes to the screen.
- Gameplay randomness stays on the server. Cosmetic randomness (wobble, confetti, token faces) may use `Math.random()` on the client.
- 60 fps on modest hardware. 8 GB RAM machine: run ONE OpenCode session at a time, no leftover watchers.
- `npm test`, `npm run typecheck`, `npm run lint` must pass after every change. Do not break the 57 passing tests.
- Git: work on the `visual-overhaul` branch, one commit per game or phase with a clear message. No secrets, no huge binaries beyond the budgets in section 7.

---

## 13. Phases

### V0: Clean slate and foundation (one session)
1. Read the three existing renderers, `client/screen/main.ts`, `client/controller/main.ts`. Write a 6-line summary of the renderer interface in `PROGRESS.md`.
2. Remove Synthwave styling from the previous work. Keep reusable mechanics (PixiJS loading, counters, particles, shake), but restyle them.
3. Install fonts (house + all skins) into `client/assets/fonts/`. Subset to Latin. Record in `ASSETS.md`.
4. Generate or download paper textures, grain, halftone patterns, tape, pins, stamps, stickers. Record every source.
5. Build `client/kit/`: skin loader, paper and grain, ink overprint helpers, text-fit, stamp/tape/pin primitives, sound manager (synth + banks), Mox, player tokens, transitions, confetti, ratchet counter, victory screen.
6. Build `npm run shots`, `npm run assets:check`, `scripts/check-design.ts`.
7. Create the 39-game checklist in `PROGRESS.md` (18 existing + 21 new). Stop.

### V1: The Table (one session)
Lobby, game shelf and boxes (draw box art for all existing games using their skins), room-code tag, QR sticker, player tokens joining, Mox intro, "Click to start the party" audio gate, credits screen. Verify with `npm run shots`. Stop.

### V2: Phone controller shell (one session)
Header, token, status ribbon, stamped buttons, ruled text field, waiting and reconnect states, haptics. Style all existing controller layouts. Stop.

### V3: Reference game: Quiz (one session)
Rebuild Quiz in its skin as the quality bar for the whole platform. Polish until it looks great, with the human reviewing the contact sheet. Stop.

### V4: Second reference: Racing (one session)
Prove the action-game path (canvas or Pixi plus DOM overlay).

### V5+: Remaining existing games (one per session)
Order: Poker, Snakes, Golf, Sea Battle, Darts, Archery, Write & Vote, Bluff, Most Likely To, Guess Who, Hangman, Gravity Run, Slot Car, Spin War, Knife Throw, Traffic Jam.

### New games
When a new game is built from `GAMES-SPEC.md`, apply its skin from 9.2 at the same time. Do not build a plain version first.

### Per-game loop
1. Read this file's section for the game and the game's server state shape.
2. Create `client/skins/<game>/skin.ts` and any new art (source or generate).
3. Build the screen renderer and controller styling.
4. Run `npm run shots` for that game, view or inspect, run the self-audit (1.2), fix.
5. Run test, typecheck, lint, `npm run assets:check`.
6. Update `PROGRESS.md` (2 lines: what was built, what is weak) and `ASSETS.md`.
7. Commit. Stop. Report in 3 lines.

## 14. Definition of done (per game)
- Skin matches this file: paper, two inks, display font, props, signature moment, sound bank
- Self-audit (1.2) fully ticked, contact sheet reviewed
- Text-fit works at all lengths, nothing overflows at 1280x720 and 1920x1080
- Mox appears with at least one line; sound plays on start, reveal, score, win
- Phone controller matches the skin
- No secret leakage, no console errors, 60 fps under throttling
- Tests, typecheck, lint, assets check pass
- `ASSETS.md` and `PROGRESS.md` updated

## 15. Token discipline
- Reports in 3 lines. No long summaries.
- Do not re-read unchanged files or take screenshots after every edit. Capture when a state is functionally complete.
- If blocked or unsure about the renderer interface, ask one short question and wait.
