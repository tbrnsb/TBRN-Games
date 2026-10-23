# Handoff

- Current phase and step: F4 — reconnect/leave, selection, Darts, UI.
  Implemented and locally green; commit, push, and CI pending.
- Last commit: `acb8e34` docs: record F3 commit and CI results.
- Status: `foundation/f4` from `acb8e34`. F0–F3 remain on their branches;
  `main` is `5b0e54e`. Not merged. The 24 Same Wave prompts still need owner
  review. Commit, push, and CI are the remaining steps.

## Done

- Diagnosed the logout: a resume hit `seat_connected` while the old socket
  lingered; the phone stalled after five retries; a backgrounded tab past the
  two-minute TTL was silently dropped.
- Reconnect: a valid token takes over the seat, the old socket receives
  `seat_replaced` and close code 4001, the heartbeat terminates silent sockets,
  the TTL is five minutes, and the phone uses bounded backoff plus a recovery
  overlay.
- Leave: persistent confirmed control in lobby and game. The server releases the
  seat, transfers host control, removes the player's ballot, and clears the
  session when empty; the old token cannot resume. The host's return-to-lobby
  control stays separate.
- Selection: direct start, Random, and group vote. Random is uniform over
  eligible games. A vote uses private ballots, closes on all connected votes or
  after 30 seconds, abstains missing votes, breaks ties with the injected random,
  falls back to a uniform eligible game when nobody votes, and starts exactly one
  game. Disconnected seats are not voters.
- Darts (G1): 1–4 players, three rounds, seat-order throws, three-second aim plus
  two-second grace, server receipt-time absolute-distance scoring
  (50/25/20/10/5/0), deadline auto-miss, shared ties. The phone sends only a
  throw action.
- UI: rebuilt phone and laptop pages on shared `public/theme.css` served at
  `/theme.css`. Phone-first controls, laptop shared display, explicit connection,
  lobby, vote, gameplay, score, and end states, and per-game adapters. Server time
  is sent on connect and heartbeat so countdowns track server deadlines; scoring
  remains server-side.
- Tests: 117 pass, covering reconnect/resume/refresh/expiry, leave, selection
  privacy/eligibility/ties/deadline/disconnects, Darts, heartbeat, theme, and
  time sync.
- Reviewer: first pass hit its step limit with no confirmed defects; second pass
  and the clock-sync re-review returned CLEAR.

## Next three actions

1. Commit and push `foundation/f4`.
2. Confirm CI and update this handoff with the commit and CI result.
3. Run the real-phone checklist; do not merge until the owner decides.

## Run and test

- `npm run dev` or `PORT=4000 npm run dev`.
- `npm run lint`, `npm run typecheck`, `npm test` (117 pass), `npm run build`.
- `npm start` runs `dist/server/main.js`. CI runs lint, typecheck, and tests on
  Ubuntu and Windows.

## Failing tests and known issues

- No failing tests or known code defects.
- No real-phone check has been run for F4 reconnect, leave, selection, or Darts.
- G2–G18 roadmap names and order are not in the repository; only G1 Darts is
  recorded and implemented. Supply the list before the next game phase.

## Decisions

- A valid resume token owns the seat; old sockets are replaced and closed.
- Intentional leave is distinct from disconnect and never resumes.
- Host is the earliest seated connected player; leaving/disconnect transfers it.
- Selection is server-authoritative, private until close, and registry-driven.
- Darts uses absolute-distance timing tiers and shares ties.
- Clock sync is display-only; the server still owns scoring and deadlines.
- A mid-game leaver stays as an abstention/auto-miss.

## Open questions

- Approve or revise the 24 Same Wave prompts.
- Supply the G2–G18 roadmap names and order.
- Confirm the theme palette and font.
- Confirm whether a mid-game leaver should stay as an abstention/auto-miss or
  leave the roster (current: stay).
- Run and report the real-phone checks.
