import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  createRepertoire,
  addGame,
  responses,
  sampleMove,
  positionKey,
  playUci,
  loadRepertoire,
} from "../lib/repertoire.ts";

const game = (id, moves, color = "white") => ({
  id,
  moves,
  variant: "standard",
  status: "resign",
  players: { [color]: { user: { id: "player", name: "Player" } } },
  opening: { eco: "A00", name: "Test" },
});

test("counts repertoire moves and rejects wrong player/color and malformed games atomically", () => {
  const book = createRepertoire("PLAYER", "white");
  assert.equal(addGame(book, game("a", "e4 e5 Nf3 Nc6")), true);
  assert.equal(addGame(book, game("b", "e4 c5 Nf3 d6")), true);
  assert.equal(addGame(book, game("c", "d4 d5 c4")), true);
  assert.equal(addGame(book, game("d", "e4 e5 invalid")), false);
  assert.equal(addGame(book, game("e", "e4 e5", "black")), false);
  assert.equal(book.games, 3);
  const chess = new Chess();
  assert.deepEqual(
    responses(book, chess).map((x) => [x.san, x.count]),
    [
      ["e4", 2],
      ["d4", 1],
    ],
  );
  chess.move("e4");
  assert.deepEqual(
    responses(book, chess).map((x) => x.san),
    ["e5", "c5"],
  );
  assert.equal(
    responses(book, chess).some((x) => x.uci === "g8f6"),
    false,
  );
});
test("merges transpositions without halfmove/fullmove counters", () => {
  const book = createRepertoire("Player", "white");
  addGame(book, game("a", "Nf3 d5 g3 Nf6 Bg2"));
  addGame(book, game("b", "g3 d5 Nf3 Nf6 Bg2"));
  const a = new Chess();
  for (const move of ["Nf3", "d5", "g3", "Nf6"]) a.move(move);
  const b = new Chess();
  for (const move of ["g3", "d5", "Nf3", "Nf6"]) b.move(move);
  assert.equal(positionKey(a), positionKey(b));
  assert.equal(responses(book, a)[0].count, 2);
});
test("handles black repertoire and only returns legal continuations", () => {
  const book = createRepertoire("Player", "black");
  addGame(book, game("a", "e4 c5 Nf3 d6 d4 cxd4 Nxd4", "black"));
  const chess = new Chess();
  assert.equal(sampleMove(responses(book, chess), false, () => 0).uci, "e2e4");
  playUci(chess, "e2e4");
  assert.equal(chess.turn(), "b");
  assert.equal(responses(book, chess)[0].uci, "c7c5");
  while (responses(book, chess).length)
    playUci(chess, responses(book, chess)[0].uci);
  assert.equal(responses(book, chess).length, 0);
});
test("deduplicates repeated positions within one game", () => {
  const book = createRepertoire("Player", "white");
  addGame(book, game("a", "Nf3 Nf6 Ng1 Ng8 Nf3 Nf6"));
  assert.equal(responses(book, new Chess())[0].count, 1);
});
test("weighted and uniform random selection preserve both branches", () => {
  const moves = [
    { uci: "e2e4", san: "e4", count: 9 },
    { uci: "d2d4", san: "d4", count: 1 },
  ];
  assert.equal(sampleMove(moves, false, () => 0.6).san, "e4");
  assert.equal(sampleMove(moves, false, () => 0.95).san, "d4");
  assert.equal(sampleMove(moves, true, () => 0.6).san, "d4");
  assert.equal(
    sampleMove([], false, () => 0),
    undefined,
  );
});
test("castling and SAN promotion are parsed to legal UCI", () => {
  const book = createRepertoire("Player", "white");
  addGame(book, game("a", "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O"));
  const chess = new Chess();
  for (const move of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]) chess.move(move);
  assert.equal(responses(book, chess)[0].uci, "e1g1");
  playUci(chess, "e1g1");
  assert.equal(chess.get("g1").type, "k");
  const promotion = new Chess("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  playUci(promotion, "a7a8n");
  assert.equal(promotion.get("a8").type, "n");
});

test("reads split NDJSON chunks, deduplicates games and enforces the requested sample cap", async () => {
  const original = globalThis.fetch;
  const encoder = new TextEncoder();
  const data =
    [
      game("a", "e4 e5"),
      game("a", "e4 e5"),
      game("b", "d4 d5"),
      game("c", "c4 e5"),
    ]
      .map((g) => JSON.stringify(g))
      .join("\n") + "\n";
  let cancelled = false;
  let index = 0;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (index >= data.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(data.slice(index, index + 37)));
          index += 37;
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  try {
    const progress = [];
    const book = await loadRepertoire(
      "Player",
      "white",
      2,
      (n) => progress.push(n),
      new AbortController().signal,
    );
    assert.equal(book.games, 2);
    assert.deepEqual(progress, [1, 2]);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});
test("does not return a partially downloaded repertoire on an upstream stream error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify(game("a", "e4 e5")) +
        "\n" +
        JSON.stringify({ error: "Export interrupted" }) +
        "\n",
    );
  try {
    await assert.rejects(
      () =>
        loadRepertoire(
          "Player",
          "white",
          100,
          () => {},
          new AbortController().signal,
        ),
      /Export interrupted/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("static build requests public Lichess NDJSON directly without credentials", async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: new URL(url), options };
    return new Response(JSON.stringify(game("static", "e4 e5")) + "\n");
  };
  try {
    const book = await loadRepertoire("Player", "white", 100, () => {}, new AbortController().signal, true);
    assert.equal(book.games, 1);
    assert.equal(request.url.origin, "https://lichess.org");
    assert.equal(request.url.pathname, "/api/games/user/Player");
    assert.equal(request.url.searchParams.get("max"), "100");
    assert.equal(request.url.searchParams.get("color"), "white");
    assert.equal(request.url.searchParams.get("ongoing"), "false");
    assert.equal(request.options.headers.Accept, "application/x-ndjson");
    assert.equal(request.options.credentials, "omit");
  } finally {
    globalThis.fetch = original;
  }
});

test("waits at least a minute before retrying after Lichess HTTP 429", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("Too many requests", { status: 429 })
      : new Response(JSON.stringify(game("retry", "e4 e5")) + "\n");
  };
  const load = () => loadRepertoire("Player", "white", 100, () => {}, new AbortController().signal, true);
  try {
    await assert.rejects(load, /alespoň minutu/);
    await assert.rejects(load, /alespoň minutu/);
    assert.equal(calls, 1);
    now += 60_001;
    assert.equal((await load()).games, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
