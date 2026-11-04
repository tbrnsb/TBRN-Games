# TBRN-Games

Free, open-source local party games. One laptop = host (shared screen). Up to 4 phones = controllers (browser, QR join, no install). No cloud, no accounts, works on LAN/hotspot.

## Quick Start

```bash
# Install dependencies
npm install

# Start server (runs on port 3000)
npm start

# Or dev mode with auto-reload
npm run dev
```

Open `http://localhost:3000` on laptop (screen).
Open `http://<laptop-lan-ip>:3000/controller` on phones (or scan QR code).

## Royal Rumble

Pick **5**, **8**, or **all** games for one series. Each round the phones vote on
the next game, or the wheel picks it for you. Placement points (**10 / 6 / 3 /
1**) add up across the series; the final board crowns a champion and hands out
honorary trophies: Most Wins, Podium Regular, Wooden Spoon, High Roller, and Most
Accurate when a quiz round is played.

The host can press **End game** during any round. The round is abandoned without
points and voting reopens for the same round. New phones wait until the rumble
ends; a phone that drops out can rejoin its seat.

## HTTPS / WSS (optional)

Plain HTTP is the default for LAN play. For a secure context (PWA install, some
mobile APIs), generate a local certificate and point the server at it:

```bash
mkcert localhost 192.168.1.50
TLS_CERT=./localhost+1.pem TLS_KEY=./localhost+1-key.pem npm start
```

The screen and controller switch to `https`/`wss` automatically, and the QR
code uses the HTTPS LAN address. Without both variables the server runs plain
HTTP exactly as before.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run server |
| `npm run dev` | Run with `--watch` for auto-reload |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Run tests (node --test) |
| `npm run probe` | Deep invariant probe across all games |
| `npm run test:watch` | Run tests in watch mode |

## Project Structure

```
server/          # HTTP + WebSocket, rooms, game loop, plugin loader
shared/          # Message types, constants, theme tokens
client/screen/   # Laptop display page
client/controller/ # Phone controller page
games/<name>/    # Game plugins (manifest, server, screen, controller)
packs/           # Content packs (JSON)
tests/           # Bot test clients
```

## Architecture

- **Server is authority** — all game logic runs server-side
- **Phones only send inputs** — "tap", "raise 50", etc.
- **Privacy enforced on server** — hole cards, secret picks never reach laptop screen
- **Plugin system** — each game is a folder with fixed interface

## Development

See `AGENTS.md` for project rules, workflow, and handoff protocol.

## License

MIT (code) — separate license for content packs.