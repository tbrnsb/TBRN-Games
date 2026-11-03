# TBRN-Games: Premium Visual Overhaul (DESIGN.md)

> **AGENT: read this whole file first.** You are the implementer. Do NOT write other design docs or plans.
> 1. If `DESIGN.md` does not exist in the repo root, save this file there verbatim.
> 2. Load the `frontend-design` skill before writing any visual code.
> 3. Start at "Phase 0". Do one phase or one game per session, then stop.

## 0. Goal
15 of 18 games use a text-only fallback renderer. Build custom screen renderers so the whole platform looks like one premium product. Server logic stays untouched. This is a visual layer only.

**Look:** Synthwave (neon on deep dark, grid horizon, glow) + Bento Grid layout + Swiss-style typography (big clean numbers, tight hierarchy).
**Viewing context:** laptop or TV, seen from across a room. Large, high-contrast, readable at distance.

## 1. Environment facts
- Stack: Node/TypeScript server, browser client in `client/screen/`, games in `games/<name>/` (`manifest.json`, `server.ts`, optional `screen.ts`).
- Existing visual references: `games/archery/screen.ts`, `games/darts/screen.ts`, `games/quiz/screen.ts`. **Read them and match the real renderer interface exactly. Never invent one.**
- Machine: Arch/Omarchy, 8 GB RAM. Run ONE OpenCode session at a time. No watch-mode builds left running.
- Must work **fully offline** on a LAN: no CDNs, no remote fonts, no remote assets.
- Run: `npm start` (port 3000). Screen: `/screen/`. Controller: `/controller?room=<CODE>`. Checks: `npm test`, `npm run typecheck`, `npm run lint`.

## 2. Design tokens
Design at **1920x1080 logical**, scale to fit the window, verify at 1280x720.

**Colors**
| Token | Hex | Use |
|---|---|---|
| bg-0 | `#0B0820` | page background |
| bg-1 | `#140F33` | panels |
| surface | `#1B1545` | bento cards |
| surface-hi | `#2A1F6B` | raised or active cards |
| border | `rgba(255,255,255,0.08)` | card edges |
| text | `#F5F3FF` | primary text |
| text-muted | `#A29BCF` | labels, secondary |
| magenta | `#FF2E97` | primary accent |
| cyan | `#00E5FF` | secondary accent |
| violet | `#8B5CF6` | tertiary, gradients |
| amber | `#FFB347` | sun, warnings |
| success | `#3DFFA2` | correct, win |
| danger | `#FF4D6D` | wrong, lose |

**Player colors:** P1 `#FF2E97`, P2 `#00E5FF`, P3 `#FFE45E`, P4 `#3DFFA2`. Always pair color with a **number badge or shape**, never color alone.

**Backgrounds:** vertical gradient `bg-0` to `#1A0B3B`, optional faint perspective grid on the lower third (magenta lines at 15% alpha) and a soft sun gradient circle (amber to magenta) behind the horizon. Keep it subtle; gameplay must stay readable.

**Typography (self-hosted woff2 in `client/assets/fonts/`, via `@fontsource`)**
- Space Grotesk 500/700: headings, scores, names. Scores are huge (64px+).
- Inter 400/600: labels and body.
- Orbitron 700: ONLY logo, room code, and title cards.
- Minimum on-screen sizes: body 28px, labels 22px, scores 64px+, titles 96px+.
- Numbers use tabular figures.

**Shape and space**
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48. Nothing off-scale.
- Radius: cards 16, chips 10, pills 999.
- Bento grid: 12 columns, 24px gap, 48px outer margin. Cards align to the grid. Scoreboard on the side or top, play area gets the largest cell.

**Glow and depth**
- Card: 1px border + `0 0 24px <accent>` at 30% alpha on active elements only.
- Text glow: at most 2 layers, only on titles, scores, and the room code.
- No more than 3 glowing things competing on screen at once.

**Motion**
- Enter: 240ms easeOutCubic. Pop or score: 320ms easeOutBack. Stagger: 40ms.
- Every movement is eased. Nothing snaps.
- Always use delta-time from the frame loop, never `Date.now()` drift.
- Respect `prefers-reduced-motion`: disable shake and particles.

## 3. Game-feel checklist (required in every renderer)
- [ ] Animated score counter (count-up, not instant)
- [ ] Particle burst on score, hit, or correct answer
- [ ] Screen shake on impact (max 6px, 250ms decay)
- [ ] Turn or player indicator with player color
- [ ] Countdown or intro title card at start (Orbitron)
- [ ] Shared victory screen: winner color, big name, confetti, ranked scores
- [ ] Idle or waiting state that is not a blank screen
- [ ] No text overflow at 1280x720 and 1920x1080

## 4. Hard constraints
- **Do not change server logic, protocols, or game rules.** Only `screen.ts`, the shared kit, assets, and styles.
- **No secret leakage on the shared screen:** Poker hole cards (except showdown), Guess Who secrets and attributes, Sea Battle ship positions, Traffic Jam private grids, Bluff/Write & Vote hidden entries before reveal. Render only what the state already exposes to the screen.
- Gameplay randomness stays on the server (`secureShuffle`). Cosmetic-only randomness (particles) may use `Math.random()` in client renderers.
- Only MIT/CC0/OFL assets. Record any third-party asset and its license in `ASSETS.md`.
- Keep 60fps on modest hardware. Limit particles (under 300 live), avoid per-frame allocation, avoid heavy blur filters.
- Run `npm test`, `npm run typecheck`, `npm run lint` after every change. Do not add new lint errors or break the 57 passing tests.

## 5. Tools: use these exact names (saves tokens)
- `playwright.browser_navigate` with `url`
- `playwright.browser_resize` to 1280x720 first
- `playwright.browser_take_screenshot` with `scale=css`
- `playwright.browser_snapshot` (text structure)
- `playwright.browser_console_messages` with `level=error`

The screen shows nothing useful until players join. Join players with `tests/bot-client.ts` (preferred) or by opening controller tabs, then start the game from the screen.

**Vision rule:** if your model cannot actually see images, say so in one line, then fall back to `browser_snapshot` and console errors, and flag the visual quality as "unverified by sight". Never claim something looks good if you did not see it.

## 6. Phases

### Phase 0: Foundation (one session)
1. Read the three existing renderers and the screen client (`client/screen/main.ts`). Summarize the renderer interface in 5 lines in `PROGRESS.md`.
2. Decide how the browser loads PixiJS offline (small esbuild step, or serve ES module from `node_modules`). Choose the simplest option that works with the current Node strip-types setup. Install `pixi.js`. Note the choice in `PROGRESS.md`.
3. Copy fonts from `@fontsource/space-grotesk`, `@fontsource/inter`, `@fontsource/orbitron` into `client/assets/fonts/`.
4. Build a shared kit in `client/screen/kit/`: theme tokens (this file's values), synthwave background, bento card, scoreboard, animated counter, particle emitter, screen shake, title card, victory screen, easing helpers.
5. Port **Quiz** onto the kit as the proof. Screenshot, critique, fix.
6. Create `PROGRESS.md` with a checklist of all 18 games. Stop.

### Phase 1: Reference renderer (one session)
Build **Racing** using the kit. This becomes the quality bar. Polish until it clearly looks premium. Stop.

### Phase 2: The rest (one game per session)
Priority order: Poker, Snakes, Golf, Sea Battle, Gravity Run, Slot Car, Spin War, Knife Throw, Traffic Jam, Bluff, Write & Vote, Most Likely To, Guess Who, Hangman. Then restyle Archery, Darts, Quiz to match.
Text-heavy games (Bluff, Write & Vote, Most Likely To, Guess Who, Hangman) still get the bento layout, big typography, and animated reveals. Use the generic-text look as a floor, never as the result.

### Per-game loop (every game)
1. Read `PROGRESS.md`, this file, and the game's `server.ts` state shape.
2. Build `games/<name>/screen.ts` with the kit.
3. Start server, join bots, start the game, resize to 1280x720.
4. Screenshot (**max 2 passes**), critique against sections 2 and 3, fix.
5. Run test, typecheck, lint.
6. Tick the game in `PROGRESS.md` with 2 lines: what was built, what is weak.
7. Stop. Report in 3 lines max.

## 7. Definition of done (per game)
- Matches tokens, fonts, spacing, and bento layout
- Every item in the game-feel checklist is ticked
- No secret leakage, no console errors
- Readable at 1280x720 and 1920x1080
- Tests, typecheck, lint all pass
- `PROGRESS.md` updated

## 8. Token discipline
- No long summaries. Report in 3 lines.
- Do not re-read unchanged files.
- Do not take a screenshot after every edit, only when the renderer is functionally complete.
- If blocked or unsure about the renderer interface, ask one short question and wait. Note: this is a separate "Visual Overhaul" track (call its phases V0, V1, V2, not Phase 0/1/2). It does not replace or redo my existing plan or its phases (F0-F2 and the per-game phases). Keep tracking this work only in PROGRESS.md, and do not edit my existing plan files except to add one line saying a visual overhaul is in progress.