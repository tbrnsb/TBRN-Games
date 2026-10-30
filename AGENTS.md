# TBRN-Games project rules

## Project and workflow

- This is a local-first package of party games. A laptop runs the authoritative server and shared screen; up to four phones join as browser controllers over the same local network.
- The human owns game rules, specs, and design decisions. Ask before making a decision that changes a settled rule or architecture.
- Work on one phase or game step at a time. Do not start F1 until F0 passes its done gate.
- Read `AGENTS.md`, `HANDOFF.md`, `DECISIONS.md`, and `LESSONS.md` at session start. Check `git status` and recent history. Trust the repository if notes conflict with code, then correct the notes.
- Write tests before implementation. Use simulated phone clients for server and game behavior.
- Do not commit, push, merge, or tag without the human reviewing the diff and asking for that action.
- Keep each change small. Update `HANDOFF.md` after every commit and update decision or lesson logs when needed.

## Review-fix-review workflow

- After each coherent change, Build calls the `reviewer` subagent before reporting the change as done.
- Reviewer is read-only. It reports clear, in-scope findings with file and line references, and lists separate questions that need a human decision.
- If Reviewer reports clear in-scope findings, Build calls the `fixer` subagent to address only those findings. Fixer must not implement unrelated improvements, choose between design options, add dependencies, install packages, or change scope.
- After Fixer edits, Build calls Reviewer again on the revised diff.
- Allow at most two fix/re-review rounds. If clear findings remain after two rounds, stop and ask the human.
- The human is the gate for ambiguous design choices, new dependencies, installs, scope changes, and all commits or pushes. Stop and ask instead of deciding.
- After the loop, or when no clear findings remain, show the human the complete diff and the lint, typecheck, test, and build results. Do not stage, commit, or push.

## Architecture

- The Node.js/TypeScript server is the only authority for game state.
- Phones send inputs only. The server validates inputs and constructs separate screen and per-player controller states.
- Secret picks, cards, roles, and other private data must never be sent to the laptop screen.
- Games are plugins behind the fixed engine interface. Adding a game must not require editing the engine.
- Keep reusable controller layouts and shared protocol types outside individual games.

## Cross-platform rules

- Support Linux and Windows. Do not add Zorin-, Ubuntu-, or Arch-specific project behavior.
- Use Node.js scripts for project tooling. Do not add Bash scripts.
- Use `path.join` or other Node path APIs for filesystem paths.
- Use `os.networkInterfaces()` to discover LAN addresses. Show all usable candidates and their URLs.
- Set `.gitattributes` for consistent line endings.
- CI must run on Ubuntu and Windows.
- Avoid platform-specific assumptions in tests, scripts, and game code.

## Privacy, security, and content

- Never put API keys, tokens, passwords, or private credentials in the repository, prompts, logs, screenshots, or commits.
- Never read or print secret files. Ask before accessing files outside the project.
- Keep the server authoritative. Validate every controller input on the server.
- Use only original code, names, writing, and art. Commercial game mechanics may inspire broad concepts; do not copy their code, text, art, names, characters, or distinctive presentation.
- Code is MIT licensed. Content packs use a separate license. Track external assets and their licenses in `CREDITS.md`.

## Review checklist

Before reporting a step as done, check:

- Tests cover the requirements and relevant edge cases.
- Hidden state never reaches the screen or another player’s controller state.
- Reconnects and invalid inputs are handled.
- The diff matches the approved spec and contains no credentials or unrelated edits.
- Linux and Windows CI pass.
- `HANDOFF.md` reflects the current repository and next actions.
- Documentation, decisions, and lessons are updated where needed.

## Handoff format

After every commit, rewrite `HANDOFF.md` (do not append to it). Keep it under about 80 lines and include:

- Current phase and step
- Last commit
- Done, in progress, and next three actions
- How to run and test
- Failing tests and known issues
- Decisions made and open questions for the human
