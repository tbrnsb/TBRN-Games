# Decisions

Append new decisions at the top. Keep each entry short: the decision, the
reason, and the date.

## 2026-10-23 — F4 reconnect, leaving, selection, Darts, and UI

- Logout fix: a valid resume token takes over its seat even if the server still
  sees the old socket as open. The old socket receives `seat_replaced` and is
  closed with code 4001. The server pings every 15 seconds and terminates
  sockets that miss a heartbeat. The seat reservation is five minutes
  (`SEAT_TTL_MS = 300_000`). The phone retries with bounded exponential backoff
  and shows a recovery overlay instead of silently creating a new player.
- Leave room: every phone has a persistent, confirmed "Leave room" control in
  the lobby and during a game. The server removes the seat immediately, transfers
  host control if needed, removes the player's open ballot, and clears the game
  session if no connected players remain. The old token cannot resume a left
  seat. This is separate from the host's "Return everyone to lobby" control.
  A player who leaves mid-game stays in that game's roster as an abstention or
  auto-miss, matching the existing expired-seat rule.
- Game selection: the host can still start a game directly, or use Random or a
  group vote. Random picks uniformly from games whose player range fits the
  connected players. A group vote gives each connected player one private ballot,
  closes when all connected players vote or after 30 seconds, treats missing
  votes as abstentions, starts the most-voted eligible game, breaks ties
  uniformly with the injected server random, and falls back to a uniform
  eligible game when nobody votes. Only connected players count as voters;
  disconnected reserved seats are excluded. Ballots and the winner are not
  exposed before the vote closes. Exactly one game starts.
- Game metadata: every plugin must provide a non-blank description of at most
  160 characters. The lobby builds its library, descriptions, and eligibility
  from the registry; the phone does not hardcode a game list.
- Darts (G1): one to four players, three rounds, one dart per player per round
  in seat order. Each turn has a three-second aim delay and a two-second grace
  window. The server scores the absolute distance between receipt time and the
  target: at most 80 ms = 50, 200 ms = 25, 400 ms = 20, 700 ms = 10, 1200 ms = 5,
  otherwise 0. Missing the deadline scores 0. Highest total wins; tied leaders
  share the win. The phone sends only a throw action; it never sends timing or a
  score.
- UI: the phone is a mobile-first, thumb-friendly controller; the laptop is the
  shared display. Both pages share `public/theme.css` (served at `/theme.css`).
  The phone uses per-game view adapters (`same-wave`, `darts`) so the engine stays
  plugin-driven. Connection, lobby, selection, voting, gameplay, scoring, and
  end states have explicit visual states; private choices stay on the phone.
- Clock display: the server sends a `time` message on connect and on each
  heartbeat. Phones and the laptop compute a clock offset and use it for
  countdown displays only; the server remains authoritative for scoring and
  deadlines.
- Roadmap: G1 Darts is implemented in F4. Quiz is planned later and is not
  implemented. The full G2–G18 names and order were not present in the
  repository or the available F4 brief, so they remain an owner-supplied list;
  do not invent or implement them in F4.

Reason: fix the observed logout failure at its source, make leaving explicit,
let the room choose games without leaking ballots, and add one complete
server-authoritative game without expanding the engine or the F4 scope.

## 2026-10-23 — F3 Same Wave

- Same Wave is the only game in F3: 3–4 connected players, five rounds, a
  30-second vote window, two secret options per round, and no free text.
- A player's first vote is final for that round. Voting also closes early when
  every player in the game roster has voted. Non-voters abstain.
- The majority side scores 1 point per player on it. A tie, or fewer than two
  cast votes, scores 0. Highest score wins; tied leaders share the win.
- The host starts, starts each next round, ends the game early, and returns
  everyone to the lobby. The laptop stays display-only.
- The earliest seated connected player is host. On host disconnect, control
  passes to the earliest connected player. A reconnect never automatically
  restores control; if the original host is later the earliest connected player
  when another host disconnects, the ordinary transfer rule applies.
- Start uses the connected players only; reserved disconnected seats are
  excluded. Players who join during a game spectate until the next lobby.
- "Return to lobby" is the early-end control: it ends the game immediately and
  returns everyone to the lobby; there is no separate early-final screen.
- A game-roster player whose reserved seat expires mid-game stays in the
  scoreboard as an abstention for the rest of the game; the game continues.
- Extend the F2 contract with optional `deadline`, `onDeadline`, and
  `applyHostAction` hooks. The game manager checks the current host before
  routing host actions; plugins still validate phase and action shape.
- Keep the 24 original prompts in
  `src/server/games/same-wave/prompts.ts` as a draft. Show their text to the
  project owner before merge or release.

Reason: settle the first playable game and the generic hooks it needs without
putting game-specific branches in the engine.

## 2026-10-23 — F2 game/plugin interface

- Games implement one server-side `GamePlugin` contract: private state, action
  reducer, public screen view, per-player controller view, and a finish check.
- The engine injects `random` and `now`; plugins must validate raw actions.
- `GameRegistry` validates metadata and stores games. `GameSession` owns one
  running game, checks seat membership, and delegates rule validation.
- Only plugin-produced views leave the server; private state stays server-side.
- F2 adds no game rules, content, start/host flow, or UI; those come with the
  first game.

Reason: fix the engine boundary so a new game is a plugin plus registration,
not an engine edit.

## 2026-10-23 — F1 lobby and transport

- Use WebSockets via the `ws` runtime dependency; install with scripts disabled.
- Allow four players. Trim names, require 1–20 characters, reject blank names
  and control characters, and allow duplicate names; server IDs distinguish
  players. Reject a fifth player with a clear message.
- Generate player IDs and random resume tokens on the server. The phone stores
  its token; tokens are sent only in WebSocket messages, never URLs or logs.
- Reserve a disconnected seat for two minutes. A valid token resumes the same
  seat; expiry frees it; a server restart clears the room.
- Broadcast public lobby state to everyone. Send each player's private
  controller state only to that player. Defer the game/plugin interface.

Reason: the lobby needs a real-time channel without expanding into gameplay.

## 2026-10-23 — Review-fix-review workflow

- Project-local subagents: `reviewer` (GLM-5.3 Flash Free, read-only) and
  `fixer` (DeepSeek V4.1 Flash Free, bounded edits).
- Build calls Reviewer after each coherent change. Fixer addresses only clear
  in-scope findings, then Reviewer re-reviews the revised diff.
- At most two fix/re-review rounds, then stop and ask the human.
- The human gates ambiguous design choices, new dependencies, installs, scope
  changes, commits, and pushes.

Reason: separate review from implementation without letting the loop grow.

## 2026-10-23 — F0 scope

- F0 is a cross-platform HTTP hello-world server with a laptop page and a
  simple phone connectivity page.
- No name/join flow, player IDs, multiplayer state, gameplay protocol, or
  WebSockets in F0. Those are deferred to F1.

## 2026-10-23 — Toolchain

- Node's built-in `node:test` runs TypeScript tests through `tsx`.
- ESLint with `typescript-eslint` handles linting.
- `tsc` builds `src/` to `dist/` for plain Node; `tsx` is used for development.
- TypeScript tests are written before the behavior they cover.

## 2026-10-23 — Networking

- The server listens on port `3000` by default; `PORT` overrides it.
- Tests use ephemeral ports.
- LAN IPv4 URLs are discovered with `os.networkInterfaces()`; the server binds
  for LAN access and prints every usable candidate.

## 2026-10-23 — CI

- CI keeps the Ubuntu and Windows matrix, `actions/checkout@v7`, and
  `actions/setup-node@v7`.
- CI runs `npm ci`, `npm run lint`, `npm run typecheck`, and `npm test`.

## 2026-10-23 — Documentation

- `DECISIONS.md` and `LESSONS.md` are required project documents, as stated in
  `AGENTS.md`.
