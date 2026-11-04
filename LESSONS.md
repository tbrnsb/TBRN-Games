# Lessons

Append new lessons at the top.

## 2026-11-04 — A finished game sends a lobby state before its last frame

The finish tick broadcasts `roomState` with `status: "lobby"`, then sends the
final `gameState` whose screen is `finished: true`. A controller that renders
every game frame re-entered the finished game after the lobby reset and got stuck
on "Waiting for the host" with no session card. Track the room status and ignore
a finished game frame once the room is already back in the lobby. Also move that
check before any game-view mutation, or the early return still hides the session.

## 2026-11-04 — Tie UI affordances to view transitions, not room broadcasts

The host "End game" button only appeared after a reload because the server starts
a game without broadcasting a new `roomState`; only `gameState` arrives. Toggle
game-only controls in `showPlaying()` / `showLobby()` so every path into those
views updates them, and keep the room-state handler as a second layer.

## 2026-10-23 — A live socket is not proof of a live seat

The F3 reconnect path rejected a resume whenever the server still saw the old
socket as connected. On a brief network drop, the old socket could linger, the
phone exhausted its retries, and the player appeared logged out. Treat a valid
resume token as ownership of the seat: take it over, tell the old socket
`seat_replaced`, close it, and let the new socket continue. Add a heartbeat so a
silently dead socket is eventually terminated. Also make the client show a
reconnecting state with bounded backoff and a recovery action instead of
silently starting a new player.

## 2026-10-23 — Intentional leave is not a disconnect

A disconnect should reserve the seat for reconnection; a deliberate leave should
release it immediately. Keep these as separate server operations. The leave path
must remove the seat, transfer host control, drop the player's open ballot, and
make the old token invalid. Do not reuse the disconnect timer for a leave, or a
phone that tapped "Leave room" can silently resume later.

## 2026-10-23 — Recompute voters when a vote closes

Ballots can arrive just before a disconnect, and a disconnected seat can stay
reserved. Counting every ballot in the map lets an absent player decide the
result. Recompute the connected voter set at close time, filter ballots to that
set, and recompute eligible games from the current connected count. Keep the raw
ballot in case the player reconnects, but do not count it while they are away.

## 2026-10-23 — Timing games need fake clocks and display sync

Darts scores from server receipt time, so tests must inject `now` and cover the
exact tier boundaries, early throws, late throws, and the deadline miss. The
phone countdown compares against server-absolute deadlines; device clock skew
can make a correct server decision look wrong. Send the server time on connect
and on the heartbeat, compute an offset on the client, and use it for display
only. Keep scoring server-authoritative.

## 2026-10-23 — Do not print `location.origin` as the join URL

When the laptop page is opened at `localhost`, `location.origin` is not usable
from a phone. Show the `/play` path and point the host at the LAN URL printed by
the server. A shared display should never send players to `localhost`.

## 2026-10-23 — Timed, host-driven games need generic engine hooks

F2 covered actions and views but not clocks or host controls. F3 needed a vote
deadline, a deadline handler, and host-only actions. Adding optional
`deadline`, `onDeadline`, and `applyHostAction` hooks to the plugin contract
kept Same Wave out of the engine; the manager checks the current host, and the
plugin checks phase and action shape. Prefer optional, generic hooks over
game-specific branches in the session or socket layer.

## 2026-10-23 — Keep configuration parsing out of entry points

`main.ts` parsed `PORT` and also started the server at import time, so the
default and override behavior could not be tested. Extract pure configuration
into its own module (`src/server/config.ts`) and test it directly.

## 2026-10-23 — URL parsers can hide traversal tests

`fetch` normalizes `/%2e%2e/package.json` to `/package.json` before sending, so
that path never exercises traversal. F0 also serves no static files, so every
traversal-style request reaches the same unknown-route 404 fallback. The
separate traversal test was kept, but it only asserts that fallback; add
traversal coverage with raw socket requests if static file serving is
introduced.

## 2026-10-23 — Notes can drift from the repository

`HANDOFF.md` described the scaffold as in progress and a hello-world phone check
as done, but no scaffold files existed in the repository. The phone check was a
temporary setup test before the project scaffold. Check notes against the
working tree and correct them instead of trusting them blindly.

## 2026-10-23 — Keep phases small

F0 is deliberately limited to an HTTP hello-world server and two static pages.
Joining, player IDs, and real-time state belong to F1, which keeps the first
reviewable change small.
