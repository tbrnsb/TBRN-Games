# Lessons

Append new lessons at the top.

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
