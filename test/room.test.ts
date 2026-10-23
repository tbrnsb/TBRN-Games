import assert from "node:assert/strict";
import test from "node:test";

import { Room } from "../src/server/room.js";
import { SEAT_TTL_MS } from "../src/shared/protocol.js";

function makeRoom(now: () => number): Room {
  let sequence = 0;

  return new Room({
    now,
    generateId: () => `player-${++sequence}`,
    generateToken: () => `token-${++sequence}`,
  });
}

function join(room: Room, name: unknown) {
  const result = room.join(name);

  if (!result.ok) {
    assert.fail(result.message);
  }

  return result;
}

test("uses four players and a two-minute seat reservation by default", () => {
  assert.equal(SEAT_TTL_MS, 120_000);
  assert.equal(makeRoom(() => 0).publicState().maxPlayers, 4);
});

test("trims names, assigns server IDs and tokens, and hides tokens from public state", () => {
  const room = makeRoom(() => 0);
  const joined = join(room, "  Alice  ");

  assert.equal(joined.player.name, "Alice");
  assert.match(joined.player.id, /^player-/);
  assert.match(joined.token, /^token-/);
  assert.deepEqual(room.publicState(), {
    phase: "lobby",
    maxPlayers: 4,
    players: [{ id: joined.player.id, name: "Alice", connected: true }],
  });
  assert.ok(!JSON.stringify(room.publicState()).includes(joined.token));
});

test("allows duplicate names with distinct server IDs", () => {
  const room = makeRoom(() => 0);
  const first = join(room, "Sam");
  const second = join(room, "Sam");

  assert.equal(first.player.name, second.player.name);
  assert.notEqual(first.player.id, second.player.id);
  assert.notEqual(first.token, second.token);
});

test("accepts a trimmed 20-character name", () => {
  const room = makeRoom(() => 0);
  const joined = join(room, `  ${"x".repeat(20)}  `);

  assert.equal(joined.player.name.length, 20);
});

test("rejects blank, overlong, and control-character names without changing state", () => {
  const room = makeRoom(() => 0);
  const invalidNames = [
    "",
    "   ",
    "x".repeat(21),
    "bad\u0000name",
    "line\nbreak",
    "tab\there",
  ];

  for (const name of invalidNames) {
    const result = room.join(name);

    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(name)}`);

    if (!result.ok) {
      assert.equal(result.code, "invalid_name");
      assert.ok(result.message.length > 0);
    }
  }

  assert.deepEqual(room.publicState().players, []);
});

test("seats four players and rejects a fifth with a clear message", () => {
  const room = makeRoom(() => 0);

  for (let index = 1; index <= 4; index += 1) {
    join(room, `Player ${index}`);
  }

  const fifth = room.join("Player 5");

  assert.equal(fifth.ok, false);

  if (!fifth.ok) {
    assert.equal(fifth.code, "room_full");
    assert.match(fifth.message, /full/i);
  }

  assert.equal(room.publicState().players.length, 4);
});

test("disconnect reserves the seat and a valid token resumes the same player", () => {
  let now = 1_000;
  const room = makeRoom(() => now);
  const joined = join(room, "Alice");

  assert.equal(room.disconnect(joined.player.id), true);
  assert.equal(room.disconnect(joined.player.id), false);
  assert.equal(room.publicState().players[0]?.connected, false);

  now += SEAT_TTL_MS - 1;
  const resumed = room.resume(joined.token);

  if (!resumed.ok) {
    assert.fail(resumed.message);
  }

  assert.equal(resumed.player.id, joined.player.id);
  assert.equal(resumed.player.name, "Alice");
  assert.equal(resumed.player.connected, true);
  assert.equal(room.publicState().players[0]?.connected, true);
});

test("expiry frees the seat after the reservation window", () => {
  let now = 1_000;
  const room = makeRoom(() => now);
  const joined = join(room, "Alice");

  room.disconnect(joined.player.id);
  now += SEAT_TTL_MS;

  assert.deepEqual(room.pruneExpired(), [joined.player.id]);
  assert.deepEqual(room.publicState().players, []);

  const resumed = room.resume(joined.token);
  assert.equal(resumed.ok, false);

  if (!resumed.ok) {
    assert.equal(resumed.code, "invalid_token");
  }

  join(room, "New player");
  assert.equal(room.publicState().players.length, 1);
});

test("rejects unknown tokens and resumes of seats that are still connected", () => {
  const room = makeRoom(() => 0);
  const unknown = room.resume("not-a-token");

  assert.equal(unknown.ok, false);

  if (!unknown.ok) {
    assert.equal(unknown.code, "invalid_token");
  }

  const joined = join(room, "Alice");
  const stillConnected = room.resume(joined.token);

  assert.equal(stillConnected.ok, false);

  if (!stillConnected.ok) {
    assert.equal(stillConnected.code, "seat_connected");
  }
});

test("a new room starts empty, as after a server restart", () => {
  assert.deepEqual(new Room().publicState(), {
    phase: "lobby",
    maxPlayers: 4,
    players: [],
  });
});
