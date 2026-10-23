# TBRN-Games

Local-first party games. A laptop runs the authoritative server and the shared
screen; up to four phones join as browser controllers over the same local
network.

F1 adds a WebSocket lobby: up to four phones join with a name, the laptop screen
shows the public lobby, and each phone receives only its own controller state.
F2 adds the game/plugin interface. F3 adds the first playable game, Same Wave:
three or four players answer five two-option prompts and score when they land
with the majority. F4 hardens reconnects and leaving, adds Random and group-vote
game selection, redesigns the shared screen and phone controller, and adds
Darts.

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

## Lobby

- Up to four players can join from `/play` with a display name.
- Names are trimmed and must be 1–20 characters with no control characters.
  Duplicate names are allowed; the server assigns each player a unique ID.
- The laptop screen and every phone see the same public lobby.
- Each phone gets its own private controller state; resume tokens are stored in
  the phone browser and sent only over the WebSocket connection.
- A disconnected seat is reserved for five minutes and resumes with the saved
  token. A valid token takes the seat back even if the server has not yet
  noticed the old connection died; the old connection is told its seat moved.
  A server restart clears the room.
- The earliest seated connected player is the host. If the host disconnects,
  control passes to the earliest connected player; reconnecting does not
  automatically restore control to the original host.
- Every phone has a persistent "Leave room" control. It asks for confirmation,
  releases the seat immediately, transfers host control if needed, and returns
  the phone to the join screen. A left seat is not resumed by an old token.
- A brief network drop shows a reconnecting state and retries with a bounded
  backoff. If the seat expired, the phone says so and offers the join screen.

## Choosing a game

The host can start a game directly from the game library, ask the server to pick
a random eligible game, or start a group vote. The library and its descriptions
come from the server registry; the phone does not hardcode a game list.

- Random picks uniformly from games whose player range fits the connected
  players.
- Group vote gives every connected player one private ballot. It closes when
  every connected player has voted or after 30 seconds. Missing votes abstain,
  the most-voted game wins, and ties are broken uniformly by the server. If
  nobody votes, the server picks uniformly from the eligible games. The winner
  is revealed only after the vote closes, and exactly one game starts.
- Disconnected reserved seats do not count as connected players or voters.

## Darts

Darts needs one to four connected players and runs for three rounds. Each
player throws once per round in seat order.

1. A turn starts with a three-second aim countdown, then a short throw window.
2. The phone sends only "throw"; the server scores the receipt time against the
   target. Closer timing scores higher: 50, 25, 20, 10, 5, or 0.
3. A missed window scores zero and play passes to the next player. The highest
   total wins; tied leaders share the win.
4. The server owns turn order, timing, scores, and the finished state. The phone
   never sends a score or timing value.

## Same Wave

Same Wave needs three or four connected players and runs for five rounds.

1. The laptop shows a two-option prompt. Every phone secretly picks A or B.
2. Voting closes when every player has voted or after 30 seconds. Players who do
   not vote abstain.
3. The reveal shows only the vote counts. The side with more votes scores one
   point for each player on it. A tie, or fewer than two cast votes, scores
   nothing.
4. The host starts the next round from their phone. After round five, the host
   returns everyone to the lobby. The highest score wins, and tied leaders share
   the win.
5. The host can end the game early from their phone. The laptop is display-only.

The 24 original prompts live in
`src/server/games/same-wave/prompts.ts`. That file is a draft that the project
owner reviews before the branch is merged or released.

## Game plugins

The engine loads games through a server-side plugin contract
(`src/server/games/`). A plugin owns private state and returns a public screen
view plus a private controller view for each player. The server never sends the
private state. Plugins may also expose an optional deadline, a deadline handler,
and host-only actions; the game manager checks host control before routing them.
Game metadata includes a required description, player range, and name; the lobby
uses that metadata to build the library and eligibility list.

Same Wave and Darts are registered in `src/server/main.ts`. Adding another game
means adding a plugin and registering it, without editing the engine.

## Test from your phone

1. Put the laptop and one to four phones on the same Wi-Fi network.
2. Run `npm run dev` on the laptop.
3. Open the printed `/play` URL on each phone, for example
   `http://192.168.1.20:3000/play`. Do not use `localhost`.
4. Enter a name and join. Closing the page reserves your seat for five minutes;
   reopening the page on the same phone resumes it.
5. Try a brief disconnect (turn Wi-Fi off and on) and confirm the phone
   reconnects to the same seat. Try "Leave room" and confirm the seat disappears
   from the lobby and the phone returns to the join screen.
6. The host starts a game directly, with "Surprise me", or with "Let everyone
   vote". In a vote, each phone picks privately and the result appears only when
   the vote closes.
7. For Darts, tap Throw when the phone countdown reaches zero. Confirm the laptop
   and all phones show the same turn, scores, and winner.
8. If a page does not load, check that the laptop firewall allows Node on
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
