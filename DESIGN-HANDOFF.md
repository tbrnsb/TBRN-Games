# Designer Handoff

Everything below is implemented and verified. This is what you are inheriting.

Last gate: **194 tests · typecheck clean · lint 0 errors · probe 0 issues across 36 games**.

---

## 1. What exists

36 games in `games/<id>/`. Each has:

```
manifest.json    id, name, minPlayers, maxPlayers, controllerType, description, howTo
theme.json       art style, palette, motion profile  (yours to use)
server.ts        authoritative game logic
screen.ts        optional custom renderer (most games use the fallback)
content/*.json   content packs where the game needs them
```

`manifest.json` is merged over the plugin's inline manifest at load, so **the JSON is
authoritative** for name, description, limits and `howTo`.

---

## 2. theme.json — your starting point per game

Every game already has one, pre-filled by genre:

```json
{
  "gameId": "darts",
  "displayName": "Darts",
  "artStyle": "sport",
  "palette": {
    "background": "#0E2A3A",
    "primary": "#F2F7FA",
    "accent": "#FF7A00",
    "surface": "#14384C",
    "text": "#FFFFFF"
  },
  "animationProfile": { "style": "fast_slide", "easings": "cubic-bezier(0.1,0.9,0.2,1)" }
}
```

Six palettes are seeded: `gameshow`, `newspaper`, `ink`, `noir`, `candy`, `sport`.
Nothing consumes these yet — the engine does not read `theme.json`, so you can reshape the
schema freely as long as `gameId` and `palette` stay. Swap the values; the games keep working.

---

## 3. screen.ts contract

Drop a file at `games/<id>/screen.ts` and the loader picks it up. Export either
`render` or a single `render<Anything>` function.

```ts
export function render(
  ctx: CanvasRenderingContext2D,
  state: unknown,          // game.screenState()
  width: number, height: number,
  scale: number,           // logical 1920x1080 scaled to the real window
  now: number,             // ms, for animation
): void
```

Read `games/quiz/screen.ts` for a complete example. Games already carrying a custom
renderer: quiz, racing, poker, snakes, golf, archery, darts, guesswho, bluff, writevote,
mostlikely, hangman, knifethrow, spinwar.

**The ~14 newer games use the fallback text renderer**: percentile, splitroom,
dictionarium, drawful, fakin, trivia, wordspud, survive, blather, mindmeld, mindreader,
stowaway, bdate, frankenanswers, bracket, dumbinventions, wordchain, sloganshirts,
mashup, slideroulette, lastseat, arena. Those are your highest-value targets.

---

## 4. Controller layouts — style these, don't rewrite them

The phone renders from `shared/controllers.ts`. Class names are stable:

| Layout | Classes |
|---|---|
| slider | `.slider-wrap .slider-track .slider-fill .slider-knob .slider-readout` |
| dual-slider | plus `.dual-slider .dual-hint .action-btn` |
| pad (joystick) | `.pad .pad-cross .pad-knob` |
| aim | `.aim .aim-row .aim-pad .aim-power .aim-action` |
| tap-race | `.race .race-meter .race-fill .race-btn .race-count .race-rival` |
| board | `.board .board-grid .board-tile.marked .board-img .board-name` |
| numpad | `.numpad .numpad-display .numpad-key .numpad-preset` |
| rank | `.rank .rank-item .rank-slot .rank-pos .rank-submit` |
| role | `.role .role-card.visible .role-hold` |
| canvas | `.draw-surface .canvas-swatch .canvas-size .canvas-tools` |
| chat | `.chat .chat-contact .chat-thread .chat-msg .chat-compose` |
| card-hand | `.hand .card .actions .raise-row .raise-step .raise-amount` |

Tutorial text renders in `#howTo` under the status bar, populated from the manifest.

---

## 5. What is *not* done (your call, in priority order)

1. **Screen renderers** for the 22 games listed in §3 — biggest visual win.
2. **Host announcer** — no caption channel exists yet; it needs a line library and a hook
   in each game's screen state. Design the captions, engineering wires them.
3. **Canvas undo** — the phone has colours and 3 brush sizes but no undo; it requires
   server-side stroke removal in drawful, sloganshirts and mashup.
4. **Global theme** — `public/theme.css` still uses the old synthwave/neon direction.
   `DESIGN.md` describes it. Since each game now has its own palette, the global sheet
   should become the neutral frame, not the identity.

---

## 6. Constraints that are not negotiable

- **Offline LAN only.** No CDNs, no remote fonts, no remote images. Everything ships in
  `client/assets/`.
- **The laptop screen is public.** Secrets must never reach `screenState()`: card hands,
  roles, secret words, other players' answers, chat text.
- **Phones send inputs only.** All state and all scoring is server-side.
- **No copying.** No Jackbox names, art, prompts or text. Mechanics may inspire, content
  must be original.
- 1280×720 and 1920×1080 both matter.

---

## 7. Running it

```bash
npm start          # PORT env, default 3000
npm test           # 194 tests
npm run typecheck
npm run lint
npm run probe      # invariant harness: every game, 1-4 players, hostile input
```

Phones connect over the LAN; ufw allows 3000 and 3100/tcp on this machine. The QR encodes
`http://<lan-ip>:<port>/controller?room=<id>`.

Commit after each game and each significant change (repo rule). The pre-commit hook
requires `HANDOFF.md` to be staged — append a line to its Commit log.
