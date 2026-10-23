# TBRN-Games

Local-first party games. A laptop runs the authoritative server and the shared
screen; up to four phones join as browser controllers over the same local
network.

F0 is the setup phase: a cross-platform HTTP hello-world server with a laptop
page and a simple phone connectivity page. Gameplay, joining, player IDs, and
real-time protocols arrive in later phases.

## Requirements

- Node.js 24 (see `.nvmrc`)
- npm

## Setup

```sh
npm install
```

## Run

```sh
npm run dev
```

The server listens on port `3000` by default. Override it with `PORT`.

Bash:

```sh
PORT=4000 npm run dev
```

PowerShell:

```powershell
$env:PORT = "4000"; npm run dev
```

On startup the server prints the laptop URL and every usable LAN IPv4 `/play`
URL, for example:

```
TBRN-Games server listening on port 3000 (0.0.0.0).
Laptop screen: http://localhost:3000/
Phones on the same Wi-Fi:
  http://192.168.1.20:3000/play
```

## Build and run the compiled server

```sh
npm run build
npm start
```

## Checks

```sh
npm run lint
npm run typecheck
npm test
```

CI runs lint, typecheck, and tests on Ubuntu and Windows.

## Test from your phone

1. Put the laptop and phone on the same Wi-Fi network.
2. Run `npm run dev` on the laptop.
3. Open the printed `/play` URL on the phone, for example
   `http://192.168.1.20:3000/play`. Do not use `localhost`.
4. If the page does not load, check that the laptop firewall allows Node on
   port 3000 and that the Wi-Fi network does not isolate clients from each
   other (guest networks often do).

## Documentation

- `AGENTS.md` — project rules
- `HANDOFF.md` — current phase, status, and next actions
- `DECISIONS.md` — recorded decisions
- `LESSONS.md` — lessons learned
- `CREDITS.md` — external assets and licenses (when assets are added)

## License

Code is MIT licensed. See `LICENSE`.
