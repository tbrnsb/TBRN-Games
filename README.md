# TBRN Games

Party games for a room full of phones. One laptop runs the server and the shared screen. Everyone else joins from their browser over Wi-Fi. No app to install, no accounts, no cloud.

## What you need

- A laptop with [Node.js 26 or newer](https://nodejs.org/)
- Phones on the same Wi-Fi or hotspot
- A screen the room can see (the laptop screen works)

## Run a game night

```bash
git clone https://github.com/tbrnsb/TBRN-Games.git
cd TBRN-Games
npm ci
npm start
```

Open `http://localhost:3000` on the laptop. The screen shows a QR code. Players scan it, type a name, and their phone becomes a controller. Press `Ctrl+C` to stop the server.

## Games

22 games ship enabled:

- **Writing and voting:** Bluff, Write & Vote, Split the Room, Survive the Internet, Frankenanswers, Bracket Brawl, Dumb Inventions
- **Deduction:** Stowaway, Fakin' It, Guess the Imposter
- **Drawing:** Drawful, Slogan Shirts
- **Trivia and party:** Quiz, Percentile, Mind Meld, Most Likely To, Blather Round, Slide Roulette
- **Skill and cards:** Darts, Slingshot Arena, Tap Race, Texas Hold'em

Rooms hold up to 8 players. Each game has its own player range; the lobby greys out a game that does not fit the current table and says why. Rules for every game live in `GAMES.md`.

## Royal Rumble

Pick one of five preset playlists and the platform builds the night. The host screen shows the playlist, the next game, and a live points table. Each game awards placement points, the last game pays double, and the finale crowns a champion with awards drawn from the night's stats. The host can pause, swap a game, skip a game, or end the night early.

## Phones and reconnects

Phones join by QR or room code. A dropped phone keeps its seat and can rejoin with the same link. Someone who joins mid-game watches as a spectator and plays from the next round. Players can leave without losing their Rumble points.

## HTTPS (optional)

Plain HTTP works on a LAN. For a secure context, generate a local certificate and point the server at it:

```bash
mkcert localhost 192.168.1.50
TLS_CERT=./localhost+1.pem TLS_KEY=./localhost+1-key.pem npm start
```

The screen and controllers switch to `https` and `wss` automatically.

## Develop

```bash
npm test                # full test suite
npx tsc --noEmit        # type check
npm run lint            # ESLint
npm run probe           # every enabled game at every player count
npm run probe -- --all  # include retired games
```

Games live in `games/<id>/` as plugins behind a fixed server interface. A game needs `manifest.json`, `server.ts`, and an optional `screen.ts`; the engine loads it without changes. `shared/game-catalog.ts` controls what the lobby shows.

CI runs the suite and the probe on Ubuntu and Windows.

## License

MIT, see `LICENSE`. Bundled npm packages keep their own licenses.
