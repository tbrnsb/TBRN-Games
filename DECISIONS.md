# Decisions

Append new decisions at the top. Keep each entry short: the decision, the
reason, and the date.

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
