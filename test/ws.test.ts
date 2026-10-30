import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import WebSocket from "ws";

import { createServer } from "../src/server/app.js";
import { createDartsGame } from "../src/server/games/darts/index.js";
import { createGameRegistry } from "../src/server/games/registry.js";
import { createSameWaveGame } from "../src/server/games/same-wave/index.js";
import { attachGameSocket } from "../src/server/ws.js";
import type { ServerMessage } from "../src/shared/protocol.js";

type LobbyMessage = Extract<ServerMessage, { type: "lobby" }>;
type JoinedMessage = Extract<ServerMessage, { type: "joined" }>;
type ControllerMessage = Extract<ServerMessage, { type: "controller" }>;
type ErrorMessage = Extract<ServerMessage, { type: "error" }>;
type ScreenMessage = Extract<ServerMessage, { type: "screen" }>;
type TimeMessage = Extract<ServerMessage, { type: "time" }>;

class TestClient {
  readonly messages: ServerMessage[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
    });
    socket.on("error", () => {
      // Connection errors surface through close; tests assert on messages.
    });
  }

  static connect(
    url: string,
    options?: WebSocket.ClientOptions,
  ): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, options);
      const client = new TestClient(socket);

      socket.once("open", () => {
        resolve(client);
      });
      socket.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  terminate(): void {
    this.socket.terminate();
  }
}

function lobbies(client: TestClient): LobbyMessage[] {
  return client.messages.filter(
    (message): message is LobbyMessage => message.type === "lobby",
  );
}

function lastLobby(client: TestClient): LobbyMessage | undefined {
  return lobbies(client).at(-1);
}

function joinedMessage(client: TestClient): JoinedMessage | undefined {
  return client.messages.find(
    (message): message is JoinedMessage => message.type === "joined",
  );
}

function lastJoined(client: TestClient): JoinedMessage | undefined {
  return client.messages
    .filter((message): message is JoinedMessage => message.type === "joined")
    .at(-1);
}

function hasLeft(client: TestClient): boolean {
  return client.messages.some((message) => message.type === "left");
}

function controllerMessage(client: TestClient): ControllerMessage | undefined {
  return client.messages.find(
    (message): message is ControllerMessage => message.type === "controller",
  );
}

function lastController(client: TestClient): ControllerMessage | undefined {
  return client.messages
    .filter(
      (message): message is ControllerMessage => message.type === "controller",
    )
    .at(-1);
}

function lastScreen(client: TestClient): ScreenMessage | undefined {
  return client.messages
    .filter((message): message is ScreenMessage => message.type === "screen")
    .at(-1);
}

function errorMessages(client: TestClient): ErrorMessage[] {
  return client.messages.filter(
    (message): message is ErrorMessage => message.type === "error",
  );
}

function timeMessages(client: TestClient): TimeMessage[] {
  return client.messages.filter(
    (message): message is TimeMessage => message.type === "time",
  );
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  if (predicate()) {
    return;
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function connect(
  url: string,
  clients: TestClient[],
  options?: WebSocket.ClientOptions,
): Promise<TestClient> {
  const client = await TestClient.connect(url, options);
  clients.push(client);
  return client;
}

async function joinPlayers<const T extends readonly string[]>(
  url: string,
  clients: TestClient[],
  names: T,
): Promise<{ [K in keyof T]: TestClient }> {
  const players: TestClient[] = [];

  for (const name of names) {
    const client = await connect(url, clients);
    client.send({ type: "join", name });
    await waitFor(() => joinedMessage(client) !== undefined, `${name} joined`);
    players.push(client);
  }

  return players as { [K in keyof T]: TestClient };
}

async function startGame(
  options: {
    seatTtlMs?: number;
    sweepIntervalMs?: number;
    heartbeatIntervalMs?: number;
    selectionWindowMs?: number;
    random?: () => number;
    registry?: ReturnType<typeof createGameRegistry>;
  } = {},
) {
  const server = createServer();
  const game = attachGameSocket(server, {
    sweepIntervalMs: 20,
    ...options,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${address.port}/ws`,
    room: game.room,
    manager: game.manager,
    async close(): Promise<void> {
      game.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function terminateAll(clients: TestClient[]): void {
  for (const client of clients) {
    client.terminate();
  }
}

test("sends server time on connect and refreshes it on the heartbeat", async () => {
  const game = await startGame({ heartbeatIntervalMs: 30 });
  const clients: TestClient[] = [];

  try {
    const client = await connect(game.url, clients);

    await waitFor(() => timeMessages(client).length >= 1, "initial server time");
    const first = timeMessages(client)[0];

    assert.ok(first);
    assert.ok(Math.abs(first.now - Date.now()) < 5_000);

    await waitFor(
      () => timeMessages(client).length >= 2,
      "heartbeat server time",
      4_000,
    );
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("broadcasts public lobby state and keeps controllers and tokens private", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    await waitFor(
      () => lastLobby(observer)?.state.players.length === 0,
      "initial lobby",
    );

    const alice = await connect(game.url, clients);
    alice.send({ type: "join", name: "  Alice  " });

    await waitFor(() => joinedMessage(alice) !== undefined, "joined message");
    const joined = joinedMessage(alice);
    assert.ok(joined);
    assert.equal(typeof joined.playerId, "string");
    assert.equal(typeof joined.token, "string");

    await waitFor(
      () =>
        lastLobby(observer)?.state.players.some(
          (player) =>
            player.id === joined.playerId &&
            player.name === "Alice" &&
            player.connected,
        ) === true,
      "lobby with Alice",
    );

    await waitFor(
      () => controllerMessage(alice)?.state.name === "Alice",
      "Alice's controller",
    );
    assert.equal(controllerMessage(observer), undefined);
    assert.ok(!JSON.stringify(observer.messages).includes(joined.token));
    assert.ok(!JSON.stringify(lastLobby(observer)).includes(joined.token));
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("seats four players and rejects the fifth with a clear message", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    for (let index = 1; index <= 4; index += 1) {
      const client = await connect(game.url, clients);
      client.send({ type: "join", name: `Player ${index}` });
      await waitFor(() => joinedMessage(client) !== undefined, `join ${index}`);
    }

    const fifth = await connect(game.url, clients);
    fifth.send({ type: "join", name: "Player 5" });

    await waitFor(() => errorMessages(fifth).length === 1, "room full error");
    const error = errorMessages(fifth)[0];
    assert.ok(error);
    assert.equal(error.code, "room_full");
    assert.match(error.message, /full/i);
    assert.equal(game.room.publicState().players.length, 4);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("validates names server-side and trims accepted names", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const client = await connect(game.url, clients);
    const invalidNames = [
      "",
      "   ",
      "x".repeat(21),
      "bad\u0000name",
      "line\nbreak",
    ];

    for (const [index, name] of invalidNames.entries()) {
      client.send({ type: "join", name });
      await waitFor(
        () => errorMessages(client).length === index + 1,
        `invalid name error ${index + 1}`,
      );
      assert.equal(errorMessages(client)[index]?.code, "invalid_name");
    }

    client.send({ type: "join", name: "  Bob  " });
    await waitFor(() => joinedMessage(client) !== undefined, "valid join");
    await waitFor(
      () => controllerMessage(client)?.state.name === "Bob",
      "trimmed controller name",
    );
    assert.equal(game.room.publicState().players[0]?.name, "Bob");
    assert.equal(game.room.publicState().players.length, 1);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("allows duplicate names and distinguishes players by server ID", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const first = await connect(game.url, clients);
    const second = await connect(game.url, clients);

    first.send({ type: "join", name: "Sam" });
    second.send({ type: "join", name: "Sam" });

    await waitFor(() => joinedMessage(first) !== undefined, "first Sam");
    await waitFor(() => joinedMessage(second) !== undefined, "second Sam");

    const firstJoined = joinedMessage(first);
    const secondJoined = joinedMessage(second);
    assert.ok(firstJoined && secondJoined);
    assert.notEqual(firstJoined.playerId, secondJoined.playerId);
    assert.notEqual(firstJoined.token, secondJoined.token);
    assert.equal(game.room.publicState().players.length, 2);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("reserves a disconnected seat and resumes it with the valid token", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const alice = await connect(game.url, clients);

    alice.send({ type: "join", name: "Alice" });
    await waitFor(() => joinedMessage(alice) !== undefined, "Alice joined");
    const joined = joinedMessage(alice);
    assert.ok(joined);

    alice.terminate();

    await waitFor(
      () =>
        lastLobby(observer)?.state.players.find(
          (player) => player.id === joined.playerId,
        )?.connected === false,
      "reserved seat",
    );

    const resumer = await connect(game.url, clients);
    resumer.send({ type: "resume", token: joined.token });

    await waitFor(
      () => joinedMessage(resumer)?.playerId === joined.playerId,
      "resume joined",
    );
    await waitFor(
      () =>
        lastLobby(observer)?.state.players.find(
          (player) => player.id === joined.playerId,
        )?.connected === true,
      "resumed lobby",
    );
    await waitFor(
      () => controllerMessage(resumer)?.state.playerId === joined.playerId,
      "resumed controller",
    );
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("rejects an invalid token and lets a valid token take over a live seat", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const invalid = await connect(game.url, clients);
    invalid.send({ type: "resume", token: "not-a-token" });
    await waitFor(() => errorMessages(invalid).length === 1, "invalid token");
    assert.equal(errorMessages(invalid)[0]?.code, "invalid_token");

    const alice = await connect(game.url, clients);
    alice.send({ type: "join", name: "Alice" });
    await waitFor(() => joinedMessage(alice) !== undefined, "Alice joined");
    const joined = joinedMessage(alice);
    assert.ok(joined);

    const replacement = await connect(game.url, clients);
    replacement.send({ type: "resume", token: joined.token });
    await waitFor(
      () => joinedMessage(replacement)?.playerId === joined.playerId,
      "seat takeover",
    );
    await waitFor(
      () => errorMessages(alice).some((error) => error.code === "seat_replaced"),
      "old connection replaced",
    );

    assert.equal(game.room.publicState().players.length, 1);
    assert.equal(game.room.publicState().players[0]?.id, joined.playerId);
    assert.equal(game.room.publicState().players[0]?.connected, true);
    assert.equal(game.room.hostId(), joined.playerId);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("recovers a brief disconnect by resuming the same seat, not joining again", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const alice = await connect(game.url, clients);

    alice.send({ type: "join", name: "Alice" });
    await waitFor(() => joinedMessage(alice) !== undefined, "Alice joined");
    const joined = joinedMessage(alice);
    assert.ok(joined);

    alice.terminate();

    const resumer = await connect(game.url, clients);
    resumer.send({ type: "resume", token: joined.token });

    await waitFor(
      () => joinedMessage(resumer)?.playerId === joined.playerId,
      "same seat resumed",
    );
    await waitFor(
      () => lastController(resumer)?.state.phase === "lobby",
      "resumed controller",
    );

    assert.equal(game.room.publicState().players.length, 1);
    assert.equal(game.room.publicState().players[0]?.id, joined.playerId);
    assert.equal(lastLobby(observer)?.state.hostId, joined.playerId);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("expired reservations free the seat", async () => {
  const game = await startGame({ seatTtlMs: 60, sweepIntervalMs: 10 });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const alice = await connect(game.url, clients);

    alice.send({ type: "join", name: "Alice" });
    await waitFor(() => joinedMessage(alice) !== undefined, "Alice joined");
    const joined = joinedMessage(alice);
    assert.ok(joined);

    alice.terminate();
    await waitFor(
      () => lastLobby(observer)?.state.players.length === 0,
      "expired seat removed",
    );

    const resumer = await connect(game.url, clients);
    resumer.send({ type: "resume", token: joined.token });
    await waitFor(() => errorMessages(resumer).length === 1, "expired token");
    assert.equal(errorMessages(resumer)[0]?.code, "invalid_token");

    const replacement = await connect(game.url, clients);
    replacement.send({ type: "join", name: "Replacement" });
    await waitFor(
      () => joinedMessage(replacement) !== undefined,
      "replacement joined",
    );
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("rejects malformed and unknown messages without changing room state", async () => {
  const game = await startGame();
  const clients: TestClient[] = [];

  try {
    const client = await connect(game.url, clients);

    client.socket.send("not json");
    await waitFor(() => errorMessages(client).length === 1, "bad JSON error");
    assert.equal(errorMessages(client)[0]?.code, "invalid_message");

    client.send({ type: "join", name: 42 });
    await waitFor(() => errorMessages(client).length === 2, "bad name type");
    assert.equal(errorMessages(client)[1]?.code, "invalid_message");

    client.send({ type: "dance" });
    await waitFor(() => errorMessages(client).length === 3, "unknown type");
    assert.equal(errorMessages(client)[2]?.code, "invalid_message");

    client.socket.send(Buffer.from("binary"));
    await waitFor(() => errorMessages(client).length === 4, "binary frame");
    assert.equal(errorMessages(client)[3]?.code, "invalid_message");

    assert.deepEqual(game.room.publicState().players, []);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("starts Same Wave only for the host and sends private controllers", async () => {
  const registry = createGameRegistry([createSameWaveGame()]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    await waitFor(
      () => lastLobby(observer)?.state.players.length === 0,
      "initial lobby",
    );

    const alice = await connect(game.url, clients);
    const bob = await connect(game.url, clients);
    const carol = await connect(game.url, clients);

    for (const [client, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carol, "Carol"],
    ] as const) {
      client.send({ type: "join", name });
      await waitFor(() => joinedMessage(client) !== undefined, `${name} joined`);
    }

    const hostId = joinedMessage(alice)?.playerId;
    assert.ok(hostId);

    await waitFor(
      () => lastLobby(observer)?.state.hostId === hostId,
      "host in lobby",
    );
    assert.deepEqual(
      lastLobby(observer)?.state.games.map((entry) => entry.id),
      ["same-wave"],
    );

    bob.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(
      () => errorMessages(bob).length === 1,
      "non-host start error",
    );
    assert.equal(errorMessages(bob)[0]?.code, "not_host");

    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "game screen");

    const screen = lastScreen(observer);
    assert.ok(screen);
    assert.equal(screen.state.phase, "game");
    assert.equal(screen.state.gameId, "same-wave");
    assert.equal(screen.state.hostId, hostId);

    const voting = screen.state.view as { phase: string; votedCount: number };
    assert.equal(voting.phase, "voting");
    assert.equal(voting.votedCount, 0);
    assert.ok(!JSON.stringify(screen).includes('"myVote"'));

    await waitFor(
      () => lastController(alice)?.state.phase === "game",
      "Alice game controller",
    );
    await waitFor(
      () => lastController(bob)?.state.phase === "game",
      "Bob game controller",
    );

    const aliceController = lastController(alice);
    assert.ok(aliceController);
    assert.equal(aliceController.state.phase, "game");

    if (aliceController.state.phase === "game") {
      assert.equal(aliceController.state.isHost, true);
      assert.equal(aliceController.state.gameId, "same-wave");
      assert.equal(
        (aliceController.state.view as { phase: string }).phase,
        "voting",
      );
    }

    assert.equal(controllerMessage(observer), undefined);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("reveals votes, advances rounds, and returns to the lobby", async () => {
  const registry = createGameRegistry([createSameWaveGame()]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const alice = await connect(game.url, clients);
    const bob = await connect(game.url, clients);
    const carol = await connect(game.url, clients);

    for (const [client, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carol, "Carol"],
    ] as const) {
      client.send({ type: "join", name });
      await waitFor(() => joinedMessage(client) !== undefined, `${name} joined`);
    }

    await waitFor(
      () => lastLobby(observer)?.state.hostId === joinedMessage(alice)?.playerId,
      "host in lobby",
    );
    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "game screen");

    alice.send({ type: "game_action", action: { type: "vote", side: "a" } });
    bob.send({ type: "game_action", action: { type: "vote", side: "b" } });
    carol.send({ type: "game_action", action: { type: "vote", side: "a" } });

    await waitFor(
      () =>
        (lastScreen(observer)?.state.view as { phase?: string } | undefined)
          ?.phase === "reveal",
      "reveal screen",
    );

    const reveal = lastScreen(observer)?.state.view as {
      counts: { a: number; b: number };
      winner: string | null;
    };
    assert.deepEqual(reveal.counts, { a: 2, b: 1 });
    assert.equal(reveal.winner, "a");

    bob.send({ type: "host_action", action: { type: "next_round" } });
    await waitFor(
      () => errorMessages(bob).length === 1,
      "non-host round error",
    );
    assert.equal(errorMessages(bob)[0]?.code, "not_host");

    alice.send({ type: "host_action", action: { type: "next_round" } });
    await waitFor(
      () =>
        (lastScreen(observer)?.state.view as { round?: number } | undefined)
          ?.round === 2,
      "round two",
    );
    await waitFor(
      () =>
        (lastController(alice)?.state as { view?: { myVote?: unknown } })
          .view?.myVote === null,
      "fresh vote",
    );

    alice.send({ type: "return_to_lobby" });
    await waitFor(
      () => lastController(alice)?.state.phase === "lobby",
      "lobby controller",
    );
    assert.equal(game.manager.gameId, null);
    assert.equal(lastLobby(observer)?.state.players.length, 3);

    alice.send({ type: "game_action", action: { type: "vote", side: "a" } });
    await waitFor(
      () => errorMessages(alice).length === 1,
      "action after lobby error",
    );
    assert.equal(errorMessages(alice)[0]?.code, "wrong_phase");
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("transfers host control during a game and never restores it on resume", async () => {
  const registry = createGameRegistry([createSameWaveGame()]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const alice = await connect(game.url, clients);
    const bob = await connect(game.url, clients);
    const carol = await connect(game.url, clients);

    for (const [client, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carol, "Carol"],
    ] as const) {
      client.send({ type: "join", name });
      await waitFor(() => joinedMessage(client) !== undefined, `${name} joined`);
    }

    const aliceId = joinedMessage(alice)?.playerId;
    const bobId = joinedMessage(bob)?.playerId;
    const aliceToken = joinedMessage(alice)?.token;
    assert.ok(aliceId);
    assert.ok(bobId);
    assert.ok(aliceToken);

    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "host in lobby",
    );
    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(
      () => lastScreen(observer)?.state.hostId === aliceId,
      "game screen",
    );

    alice.send({ type: "game_action", action: { type: "vote", side: "a" } });
    bob.send({ type: "game_action", action: { type: "vote", side: "a" } });
    carol.send({ type: "game_action", action: { type: "vote", side: "a" } });

    await waitFor(
      () =>
        (lastScreen(observer)?.state.view as { phase?: string } | undefined)
          ?.phase === "reveal",
      "reveal screen",
    );

    alice.terminate();

    await waitFor(
      () => lastScreen(observer)?.state.hostId === bobId,
      "host transfer",
    );
    await waitFor(
      () =>
        lastController(bob)?.state.phase === "game" &&
        lastController(bob)?.state.isHost === true,
      "Bob is host",
    );

    bob.send({ type: "host_action", action: { type: "next_round" } });
    await waitFor(
      () =>
        (lastScreen(observer)?.state.view as { round?: number } | undefined)
          ?.round === 2,
      "Bob advanced the round",
    );

    const resumer = await connect(game.url, clients);
    resumer.send({ type: "resume", token: aliceToken });
    await waitFor(
      () => joinedMessage(resumer)?.playerId === aliceId,
      "Alice resumed",
    );
    await waitFor(
      () => lastController(resumer)?.state.phase === "game",
      "resumed controller",
    );
    assert.equal(lastController(resumer)?.state.isHost, false);
    assert.equal(lastScreen(observer)?.state.hostId, bobId);

    resumer.send({ type: "host_action", action: { type: "next_round" } });
    await waitFor(
      () => errorMessages(resumer).length === 1,
      "old host error",
    );
    assert.equal(errorMessages(resumer)[0]?.code, "not_host");
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("closes a round on the server deadline and keeps abstentions", async () => {
  const registry = createGameRegistry([
    createSameWaveGame({ voteWindowMs: 150 }),
  ]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const alice = await connect(game.url, clients);
    const bob = await connect(game.url, clients);
    const carol = await connect(game.url, clients);

    for (const [client, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carol, "Carol"],
    ] as const) {
      client.send({ type: "join", name });
      await waitFor(() => joinedMessage(client) !== undefined, `${name} joined`);
    }

    await waitFor(
      () => lastLobby(observer)?.state.hostId === joinedMessage(alice)?.playerId,
      "host in lobby",
    );
    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "game screen");

    alice.send({ type: "game_action", action: { type: "vote", side: "a" } });
    bob.send({ type: "game_action", action: { type: "vote", side: "b" } });

    await waitFor(
      () =>
        (lastScreen(observer)?.state.view as { phase?: string } | undefined)
          ?.phase === "reveal",
      "deadline reveal",
      4_000,
    );

    const reveal = lastScreen(observer)?.state.view as {
      counts: { a: number; b: number };
      winner: string | null;
    };
    assert.deepEqual(reveal.counts, { a: 1, b: 1 });
    assert.equal(reveal.winner, null);

    await waitFor(
      () => lastController(carol)?.state.phase === "game",
      "Carol controller",
    );
    const carolController = lastController(carol);

    if (carolController?.state.phase !== "game") {
      assert.fail("expected a game controller");
    }

    const carolView = carolController.state.view as {
      phase: string;
      myVote: string | null;
    };
    assert.equal(carolView.phase, "reveal");
    assert.equal(carolView.myVote, null);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("rejects game messages before joining and moves late players to spectating", async () => {
  const registry = createGameRegistry([createSameWaveGame()]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    observer.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(
      () => errorMessages(observer).length === 1,
      "not joined error",
    );
    assert.equal(errorMessages(observer)[0]?.code, "not_joined");

    const alice = await connect(game.url, clients);
    const bob = await connect(game.url, clients);
    const carol = await connect(game.url, clients);

    for (const [client, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carol, "Carol"],
    ] as const) {
      client.send({ type: "join", name });
      await waitFor(() => joinedMessage(client) !== undefined, `${name} joined`);
    }

    await waitFor(
      () => lastLobby(observer)?.state.hostId === joinedMessage(alice)?.playerId,
      "host in lobby",
    );
    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "game screen");

    const dave = await connect(game.url, clients);
    dave.send({ type: "join", name: "Dave" });
    await waitFor(() => joinedMessage(dave) !== undefined, "Dave joined");
    await waitFor(
      () => lastController(dave)?.state.phase === "spectating",
      "spectator controller",
    );
    assert.equal(lastController(dave)?.state.phase, "spectating");

    dave.send({ type: "game_action", action: { type: "vote", side: "a" } });
    await waitFor(
      () => errorMessages(dave).length === 1,
      "spectator action error",
    );
    assert.equal(errorMessages(dave)[0]?.code, "not_in_game");
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("host leaving the lobby releases the seat, transfers control, and cannot silently resume", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice, bob] = await joinPlayers(game.url, clients, ["Alice", "Bob"]);
    const aliceId = joinedMessage(alice)?.playerId;
    const aliceToken = joinedMessage(alice)?.token;
    const bobId = joinedMessage(bob)?.playerId;

    assert.ok(aliceId && aliceToken && bobId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );

    alice.send({ type: "leave_room" });
    await waitFor(() => hasLeft(alice), "left acknowledgement");
    await waitFor(
      () => game.room.publicState().players.length === 1,
      "seat released",
    );

    assert.equal(game.room.publicState().players[0]?.id, bobId);
    assert.equal(game.room.hostId(), bobId);
    assert.equal(lastLobby(bob)?.state.hostId, bobId);
    assert.equal(lastLobby(observer)?.state.players.length, 1);

    const resumer = await connect(game.url, clients);
    resumer.send({ type: "resume", token: aliceToken });
    await waitFor(() => errorMessages(resumer).length === 1, "left token invalid");
    assert.equal(errorMessages(resumer)[0]?.code, "invalid_token");

    alice.send({ type: "join", name: "Alice again" });
    await waitFor(
      () => lastJoined(alice)?.playerId !== undefined && lastJoined(alice)?.playerId !== aliceId,
      "same phone can join again",
    );
    assert.equal(game.room.publicState().players.length, 2);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("a non-host can leave during a game without ending it", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice, bob, carol] = await joinPlayers(game.url, clients, [
      "Alice",
      "Bob",
      "Carol",
    ]);
    const aliceId = joinedMessage(alice)?.playerId;
    const bobId = joinedMessage(bob)?.playerId;

    assert.ok(aliceId && bobId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );
    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "game screen");

    bob.send({ type: "leave_room" });
    await waitFor(() => hasLeft(bob), "Bob left");
    await waitFor(
      () => game.room.publicState().players.length === 2,
      "Bob seat released",
    );

    assert.equal(game.manager.gameId, "same-wave");
    assert.equal(lastScreen(observer)?.state.hostId, aliceId);
    assert.equal(
      lastController(alice)?.state.phase,
      "game",
    );
    assert.equal(
      lastController(carol)?.state.phase,
      "game",
    );
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("a host can leave during a game and the new host can return everyone to the lobby", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice, bob, carol] = await joinPlayers(game.url, clients, [
      "Alice",
      "Bob",
      "Carol",
    ]);
    const aliceId = joinedMessage(alice)?.playerId;
    const bobId = joinedMessage(bob)?.playerId;

    assert.ok(aliceId && bobId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );
    alice.send({ type: "start_game", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "game screen");

    alice.send({ type: "leave_room" });
    await waitFor(() => hasLeft(alice), "Alice left");
    await waitFor(
      () => lastScreen(observer)?.state.hostId === bobId,
      "Bob host during game",
    );
    await waitFor(
      () =>
        lastController(bob)?.state.phase === "game" &&
        lastController(bob)?.state.isHost === true,
      "Bob has host controls",
    );

    bob.send({ type: "return_to_lobby" });
    await waitFor(
      () => lastController(bob)?.state.phase === "lobby",
      "returned to lobby",
    );
    assert.equal(game.manager.gameId, null);
    assert.equal(lastLobby(observer)?.state.players.length, 2);
    assert.equal(lastLobby(observer)?.state.hostId, bobId);
    assert.equal(lastController(carol)?.state.phase, "lobby");
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("random selection starts exactly one eligible game", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry, random: () => 0.99 });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice] = await joinPlayers(game.url, clients, [
      "Alice",
      "Bob",
      "Carol",
    ]);
    const aliceId = joinedMessage(alice)?.playerId;

    assert.ok(aliceId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );

    alice.send({ type: "select_random" });
    await waitFor(() => lastScreen(observer) !== undefined, "random game");
    await waitFor(
      () => game.manager.gameId !== null,
      "game started",
    );

    assert.equal(game.manager.gameId, "darts");
    assert.equal(lastScreen(observer)?.state.gameId, "darts");
    assert.equal(lastLobby(observer)?.state.selection, null);
    assert.equal(lastController(alice)?.state.phase, "game");
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("group vote keeps ballots private, closes early, and starts the winner", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice, bob, carol] = await joinPlayers(game.url, clients, [
      "Alice",
      "Bob",
      "Carol",
    ]);
    const aliceId = joinedMessage(alice)?.playerId;

    assert.ok(aliceId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );

    alice.send({ type: "start_game_vote" });
    await waitFor(
      () => lastLobby(observer)?.state.selection !== null,
      "vote open",
    );

    const selection = lastLobby(observer)?.state.selection;

    assert.ok(selection);
    assert.equal(selection.ballotsCast, 0);
    assert.equal(selection.voterCount, 3);
    assert.deepEqual(
      selection.games.map((entry) => entry.id),
      ["same-wave", "darts"],
    );
    assert.ok(!JSON.stringify(selection).includes('"myBallot"'));
    assert.ok(!JSON.stringify(selection).includes('"winner"'));

    await waitFor(
      () => lastController(alice)?.state.phase === "lobby",
      "lobby controller",
    );
    const aliceLobby = lastController(alice)?.state;

    if (aliceLobby?.phase !== "lobby") {
      assert.fail("expected lobby controller");
    }

    assert.ok(aliceLobby.selection);
    assert.equal(aliceLobby.selection.myBallot, null);

    alice.send({ type: "cast_ballot", gameId: "same-wave" });
    bob.send({ type: "cast_ballot", gameId: "same-wave" });
    await waitFor(
      () => lastLobby(observer)?.state.selection?.ballotsCast === 2,
      "two ballots",
    );

    carol.send({ type: "cast_ballot", gameId: "same-wave" });
    await waitFor(() => lastScreen(observer) !== undefined, "winner started");

    assert.equal(game.manager.gameId, "same-wave");
    assert.equal(lastScreen(observer)?.state.gameId, "same-wave");
    assert.equal(game.manager.lobbyState().selection, null);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("a disconnect during the vote removes a voter and can close the vote early", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice, bob, carol, dave] = await joinPlayers(game.url, clients, [
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ]);
    const aliceId = joinedMessage(alice)?.playerId;

    assert.ok(aliceId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );
    alice.send({ type: "start_game_vote" });
    await waitFor(
      () => lastLobby(observer)?.state.selection !== null,
      "vote open",
    );

    alice.send({ type: "cast_ballot", gameId: "same-wave" });
    bob.send({ type: "cast_ballot", gameId: "same-wave" });
    carol.send({ type: "cast_ballot", gameId: "same-wave" });
    await waitFor(
      () => lastLobby(observer)?.state.selection?.ballotsCast === 3,
      "three ballots",
    );

    dave.terminate();

    await waitFor(
      () => lastScreen(observer) !== undefined,
      "vote closed on disconnect",
    );
    assert.equal(game.manager.gameId, "same-wave");
    assert.equal(game.manager.lobbyState().selection, null);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("the vote deadline closes with abstentions and starts one game", async () => {
  const registry = createGameRegistry([
    createSameWaveGame(),
    createDartsGame(),
  ]);
  const game = await startGame({ registry, selectionWindowMs: 100 });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice] = await joinPlayers(game.url, clients, [
      "Alice",
      "Bob",
      "Carol",
    ]);
    const aliceId = joinedMessage(alice)?.playerId;

    assert.ok(aliceId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );

    alice.send({ type: "start_game_vote" });
    await waitFor(
      () => lastLobby(observer)?.state.selection !== null,
      "vote open",
    );
    alice.send({ type: "cast_ballot", gameId: "darts" });

    await waitFor(
      () => lastScreen(observer) !== undefined,
      "deadline started a game",
      4_000,
    );
    assert.equal(game.manager.gameId, "darts");
    assert.equal(game.manager.lobbyState().selection, null);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("a heartbeat frees a silent socket and the seat can still be resumed", async () => {
  const game = await startGame({
    heartbeatIntervalMs: 30,
    sweepIntervalMs: 10,
  });
  const clients: TestClient[] = [];

  try {
    const silent = await connect(game.url, clients, { autoPong: false });

    silent.send({ type: "join", name: "Silent" });
    await waitFor(() => joinedMessage(silent) !== undefined, "Silent joined");
    const joined = joinedMessage(silent);
    assert.ok(joined);

    await waitFor(
      () =>
        game.room.publicState().players[0]?.connected === false,
      "heartbeat disconnect",
      4_000,
    );

    const resumer = await connect(game.url, clients);
    resumer.send({ type: "resume", token: joined.token });
    await waitFor(
      () => joinedMessage(resumer)?.playerId === joined.playerId,
      "resumed after heartbeat",
    );
    assert.equal(game.room.publicState().players[0]?.connected, true);
  } finally {
    terminateAll(clients);
    await game.close();
  }
});

test("Darts routes one-button throws through the server and advances turns", async () => {
  const registry = createGameRegistry([createDartsGame()]);
  const game = await startGame({ registry });
  const clients: TestClient[] = [];

  try {
    const observer = await connect(game.url, clients);
    const [alice, bob] = await joinPlayers(game.url, clients, ["Alice", "Bob"]);
    const aliceId = joinedMessage(alice)?.playerId;
    const bobId = joinedMessage(bob)?.playerId;

    assert.ok(aliceId && bobId);
    await waitFor(
      () => lastLobby(observer)?.state.hostId === aliceId,
      "Alice host",
    );

    alice.send({ type: "start_game", gameId: "darts" });
    await waitFor(() => lastScreen(observer) !== undefined, "Darts screen");

    const start = lastScreen(observer)?.state.view as {
      phase: string;
      currentPlayer: { id: string };
    };

    assert.equal(start.phase, "playing");
    assert.equal(start.currentPlayer.id, aliceId);

    await waitFor(
      () =>
        (lastController(alice)?.state as { view?: { isMyTurn?: boolean } })
          .view?.isMyTurn === true,
      "Alice turn",
    );
    assert.equal(
      (lastController(bob)?.state as { view?: { isMyTurn?: boolean } }).view
        ?.isMyTurn,
      false,
    );

    bob.send({ type: "game_action", action: { type: "throw" } });
    await waitFor(
      () => errorMessages(bob).length === 1,
      "wrong turn rejected",
    );
    assert.equal(errorMessages(bob)[0]?.code, "invalid_action");

    alice.send({
      type: "game_action",
      action: { type: "throw", score: 180, elapsedMs: 0 },
    });

    await waitFor(
      () =>
        (lastScreen(observer)?.state.view as { currentPlayer?: { id: string } })
          ?.currentPlayer?.id === bobId,
      "Bob turn",
    );

    const view = lastScreen(observer)?.state.view as {
      lastThrow: { playerId: string; score: number };
      scores: Array<{ playerId: string; score: number }>;
    };

    assert.equal(view.lastThrow.playerId, aliceId);
    assert.equal(view.lastThrow.score, 0);
    assert.equal(
      view.scores.find((entry) => entry.playerId === aliceId)?.score,
      0,
    );
  } finally {
    terminateAll(clients);
    await game.close();
  }
});
