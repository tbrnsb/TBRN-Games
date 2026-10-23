# Handoff

- Current phase and step: F0 Setup — ready for final review and commit decision
- Last commit: `5b0e54e` Initial commit (baseline README and LICENSE)
- Status: F0 is ready for final review in the working tree, uncommitted. Linux
  lint, typecheck, all 17 tests, and the production build pass (exit 0). The real
  phone check passed. Windows CI, commit, and push are pending.

## Done
- Private GitHub repository created and cloned; Git identity and hooks set.
- Node.js, OpenCode, and the F0 npm dependencies are installed; lockfile exists.
- F0 scaffold: ESM + strict TypeScript, ESLint, node:test via tsx, `tsc` build.
- Tests first: LAN URL discovery, HTTP routes, and PORT parsing (17 tests).
- Server: laptop page `/`, phone page `/play`, `/api/health`, 404 fallback.
- Default port 3000 with `PORT` override; binds `0.0.0.0` and prints every LAN
  IPv4 `/play` URL.
- Compiled server verified end to end with curl (200/404/JSON/exit 1 on bad PORT).
- Real phone check passed over Wi-Fi: `/play` displayed
  "Connected to the game server."
- Reviewer/fixer loops: implementation round fixed untested PORT parsing;
  closeout round fixed two doc mismatches (`LESSONS.md`, README startup output).
  The final review returned CLEAR.
- `DECISIONS.md`, `LESSONS.md`, and `README.md` added or updated.
- CI keeps the Ubuntu/Windows matrix and runs lint, typecheck, and tests.

## In progress
- Final human review and commit decision. Windows CI, commit, and push are
  pending.

## Next three actions
1. Review the diff and confirm the F0 done gate.
2. If approved, stage all F0 files including `HANDOFF.md` and commit.
3. Start F1 only after F0 passes its done gate.

## Run and test
- `npm run dev` or `PORT=4000 npm run dev` (PowerShell: `$env:PORT = "4000"`).
- Checks on Linux with Node 24.22.1, all exit 0: `npm run lint`,
  `npm run typecheck`, `npm test` (17 pass), `npm run build`.
- `npm start` runs the compiled `dist/server/main.js`.

## Failing tests and known issues
- No failing tests or known code issues.
- Windows CI has not run yet.
- Commit and push are pending human approval.

## Decisions
- Repository is private for now; free OpenCode models only.
- F0 is HTTP only: no join flow, player IDs, multiplayer state, or WebSockets.
- Default port 3000, `PORT` override, ephemeral ports in tests.
- `actions/checkout@v7` and `actions/setup-node@v7` are approved but unexercised.
- Dependencies were installed outside Build; `package.json` now declares ESLint
  `^10.13.0` and `@eslint/js` `^10.0.1`.

## Open questions
- Confirm the theme palette and font before finalizing the theme.
- Confirm the separate content-pack license before publishing packs.
- Confirm stricter PORT parsing (reject `0x1F`, `1e2`, surrounding spaces).
- Confirm whether all non-GET methods should stay 404 before F1 builds on it.
