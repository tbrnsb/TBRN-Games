# TBRN-Games Handoff — Paper & Ink on Games-expansion

## Current state
`Games-expansion` is merged into `paper-overhaul`. The platform has **37 games:
22 enabled, 15 retired**. Every enabled game has a renderer and uses the
paper-and-ink system; Darts has replaced Archery on the shelf (Archery stays in
the tree, disabled).

Last gate: `npm test` 1039/1039 · `npx tsc --noEmit` clean · `npm run lint`
0 errors (warnings only).

## Last commit
Darts paper adaptation: the TV draws the board as a cream-rimmed ink chalkboard
with sun/bubblegum bands and a paper header; the phone uses the read-only
two-stage timing lock with a compact layout so both tracks and the lock button
fit above the reaction bar at 390x844. `showsScores` suppresses the duplicate
ticker. The merge of the darts timing-lock mechanic and roster swap came from
`Games-expansion` (`ebbe48a`).

## Done
- **Merge**: 22 enabled games, 8 seats, Rumble presets/slots/interlude/host
  controls/finale, score ticker, pause, results/awards, settings,
  presence/reactions, sound/TTS.
- **Host board**: paper table, 8-seat roster at 1280x720, illustrated shelf
  (six boxes per row, tape, pins, per-game paper), Rumble preset picker, slot
  progress, swap controls, finale podium/leaderboard/awards, settings, pause,
  interlude, scroll hint.
- **Controllers**: paper shell over every layout (`one-button`, `left-right`,
  `dpad`, `choice`, `text`, `card-hand`, `private-grid`, `slider`, `rank`,
  `draw`, `chat`, `role`, `aim`, `numpad`, `race`, `board`, `dual-slider`),
  seat badge, reactions, haptics, "Eyes on the TV" wait card. Drawing phones
  hide reactions while the canvas is up so the palette and Done fit; short
  phones (<=700px tall) hide them for Darts so both aim tracks fit.
- **Renderers**: one paper header (`paperTitle`/`paperMeta`) across all 22;
  shared paper board for the 11 new games; poker felt, race track and imposter
  panels repainted; shared finish celebration and winner card.
- **Darts**: timing-lock aim (`AIM_SWEEP_MS = 1200`, X then Y), 3 darts a turn,
  501, 20 standalone / 8 Rumble rounds, both presets list it. Paper board and
  compact read-only controller. Parity keeps Darts EXEMPT while pinning the
  20-round count, 180 ceiling and throw-score mapping.
- **Audio**: all 22 games publish screen sound cues; synthesis is offline
  WebAudio (no assets). Platform adds a win fanfare on every finish. Speech
  covers authored `announce` lines plus turn fallbacks (`turnName`,
  `currentPlayerName`, `currentPlayer`, single `waitingOn`). TV toggles persist
  and mute cues/voice; phone haptics fire on control taps.
- **Docs**: `GAMES.md`, `docs/PLAYER_COUNTS.md`, `docs/DECISIONS.md` record the
  roster swap and darts rules.

## In progress
Final image-capable critic pass on the post-swap roster, darts board and host.

## Next three actions
1. Apply any concrete critic findings, re-review to 10/10 (max 3 rounds).
2. Commit the darts paper adaptation and docs (after secret scan).
3. Human gate: review, push, merge. Do not push without being asked.

## Known issues
- `tests/wordchain.test.ts` can flake: random starting letter with dictionary
  gaps. Pre-existing; needs a deterministic fixture.
- Occasional fixture/port race (reconnect, randomised poker). Treat as flakes
  until reproduced.
- Lint baseline is warning-only; do not treat warnings as failures.
- Archery renderer/skin remain for the retired game; not reachable from the
  lobby.

## How to run
```bash
npm start          # PORT env, default 3000
npm test
npx tsc --noEmit
npm run lint
npm run shots      # screenshots to design/shots/
npm run probe      # --all includes retired games
```
Do not push, merge or tag without being asked.
