# Handoff

- Current phase and step: F4 — reconnect/leave, selection, Darts, UI.
  Committed, pushed, and CI green on Ubuntu and Windows.
- Last commit: `3e5f702` F4: harden reconnects, add leaving, selection, Darts,
  and new UI.
- Status: `foundation/f4` from `acb8e34`, pushed to `origin/foundation/f4`.
  Ubuntu and Windows CI passed (run 39997799007). F0–F3 remain on their
  branches; `main` is `5b0e54e`. Not merged. The 24 Same Wave prompts still need
  owner review, and the real-phone checklist is unrun.

## Done

- Diagnosed the logout: a resume hit `seat_connected` while the old socket
  lingered; the phone stalled after five retries; a backgrounded tab past the
  two-minute TTL was silently dropped. The fix is a valid resume token taking
  over the seat, the old socket receiving `seat_replaced` and close code 4001, a
  heartbeat that terminates silent sockets, a five-minute TTL, and bounded
  phone backoff with a recovery overlay.
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
  `/theme.css`, with explicit connection, lobby, vote, gameplay, score, and end
  states plus per-game adapters. Server time is sent on connect and heartbeat so
  countdowns track server deadlines; scoring remains server-side.
- Tests: 117 pass, covering reconnect/resume/refresh/expiry, leave, selection
  privacy/eligibility/ties/deadline/disconnects, Darts, heartbeat, theme, and
  time sync. Reviewer returned CLEAR on the final two passes.

## Next three actions

1. Run the real-phone checklist below and report the results.
2. Address any real-device findings with tests first.
3. Wait for owner approval before merging `foundation/f4`.

## Run and test

- `npm run dev` or `PORT=4000 npm run dev`.
- `npm run lint`, `npm run typecheck`, `npm test` (117 pass), `npm run build`.
- `npm start` runs `dist/server/main.js`. CI runs lint, typecheck, and tests on
  Ubuntu and Windows.

## Real-phone checklist (unrun)

1. Laptop plus 2–4 phones on one Wi-Fi; open the printed `/play` LAN URL.
2. Refresh one phone and toggle another's Wi-Fi off for ~10s: both must resume
   the same seat with the retry overlay, never create a new player.
3. Leave as host and as non-host in the lobby: the seat disappears and host
   control transfers.
4. Vote, then play Darts to the end: ballots stay private, one game starts, and
   turn order, countdown, scores, and ties match on every screen.

## Failing tests and known issues

- No failing tests or known code defects.
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
