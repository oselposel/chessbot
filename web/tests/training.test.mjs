import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  parseOpening,
  movesOf,
  openingNotation,
  chessFromMoves,
  relevantMoves,
  judgeMove,
} from "../lib/training.ts";
import { ExplorerClient, normalizePosition } from "../lib/explorer.ts";
import {
  AuthenticationError,
  createAuthorization,
  finishLogin,
  readAuth,
  logout,
} from "../lib/lichess-auth.ts";
const item = (uci, count) => ({
  uci,
  san: "ignored",
  white: count,
  draws: 0,
  black: 0,
});
const position = (moves = [item("e2e4", 60), item("d2d4", 40)]) => ({
  white: 100,
  draws: 0,
  black: 0,
  moves,
  opening: null,
});
const signal = () => new AbortController().signal;

test("SAN/UCI prefixes produce the same legal position, support move numbers and reject illegal lines", () => {
  const san = parseOpening("1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.0-0");
  const uci = parseOpening("e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 e1g1");
  assert.equal(san.fen(), uci.fen());
  assert.equal(chessFromMoves(movesOf(san)).fen(), san.fen());
  assert.equal(parseOpening(openingNotation(san)).fen(), san.fen());
  assert.equal(parseOpening(san.pgn()).fen(), san.fen());
  assert.throws(() => parseOpening("1. e4 e5 2. e4"), /není.*legální/);
  assert.equal(parseOpening("").history().length, 0);
});
test("accepts multiple relevant alternatives; fixed-line alternatives are not errors", () => {
  const options = normalizePosition(position(), new Chess()).moves;
  assert.equal(
    judgeMove("d2d4", options, relevantMoves(options, 0)),
    "correct",
  );
  assert.equal(judgeMove("d2d4", options, options, "e2e4"), "alternative");
  assert.equal(judgeMove("a2a3", options, options), "unknown");
  assert.equal(judgeMove("d2d4", options, relevantMoves(options, 0.5)), "rare");
  assert.equal(relevantMoves(options, 0.9)[0].uci, "e2e4");
});
test("normalizes Chess960-style castling and filters impossible moves", () => {
  const chess = parseOpening("e4 e5 Nf3 Nc6 Bc4 Bc5");
  const data = normalizePosition(
    position([item("e1h1", 10), item("a1a8", 90)]),
    chess,
  );
  assert.equal(data.moves[0].uci, "e1g1");
  assert.equal(data.moves[0].san, "O-O");
  assert.equal(data.moves.length, 1);
});
test("waits for the final NDJSON snapshot and caches positions with isolated player/color keys", async () => {
  let calls = 0;
  const encoder = new TextEncoder();
  const client = new ExplorerClient("fake-token", async (url, options) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(new URL(url).host, "explorer.lichess.org");
    assert.equal(params.get("moves"), "100");
    assert.equal(options.headers.Authorization, "Bearer fake-token");
    assert.equal(options.credentials, "omit");
    const text =
      JSON.stringify({ ...position([]), queuePosition: 4 }) +
      "\n\n" +
      JSON.stringify(position());
    let cursor = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (cursor >= text.length) return controller.close();
          controller.enqueue(encoder.encode(text.slice(cursor, cursor + 13)));
          cursor += 13;
        },
      }),
    );
  });
  const messages = [];
  const data = await client.position(
    "Player",
    "white",
    new Chess(),
    signal(),
    (s) => messages.push(s),
  );
  assert.equal(data.moves.length, 2);
  assert.match(messages[0], /frontě 4/);
  await client.position("PLAYER", "white", new Chess(), signal());
  assert.equal(calls, 1);
  await client.position("Player", "black", new Chess(), signal());
  assert.equal(calls, 2);
  await client.position("Other", "white", new Chess(), signal());
  assert.equal(calls, 3);
});
test("incomplete indexing, malformed stream and cancellation do not cache false end-of-book", async () => {
  for (const text of [
    JSON.stringify({ ...position([]), queuePosition: 0 }),
    JSON.stringify(position()) + "\ninvalid",
  ]) {
    let calls = 0;
    const client = new ExplorerClient("fake", async () => {
      calls++;
      return new Response(text);
    });
    await assert.rejects(() =>
      client.position("Player", "white", new Chess(), signal()),
    );
    await assert.rejects(() =>
      client.position("Player", "white", new Chess(), signal()),
    );
    assert.equal(calls, 2);
  }
  const controller = new AbortController();
  controller.abort();
  const client = new ExplorerClient("fake", async () => {
    throw new Error("must not fetch");
  });
  assert.throws(
    () => client.position("Player", "white", new Chess(), controller.signal),
    /abort/i,
  );
});
test("serializes requests and propagates authentication errors", async () => {
  let active = 0,
    peak = 0;
  const client = new ExplorerClient("fake", async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return new Response(JSON.stringify(position()));
  });
  await Promise.all([
    client.position("A", "white", new Chess(), signal()),
    client.position("B", "white", new Chess(), signal()),
  ]);
  assert.equal(peak, 1);
  const unauthorized = new ExplorerClient(
    "fake",
    async () => new Response("", { status: 401 }),
  );
  await assert.rejects(
    () => unauthorized.position("Player", "white", new Chess(), signal()),
    AuthenticationError,
  );
});
test("HTTP 429 prevents another request for at least one minute", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let calls = 0;
  const client = new ExplorerClient("fake", async () => {
    calls++;
    return calls === 1
      ? new Response("", { status: 429 })
      : new Response(JSON.stringify(position()));
  });
  try {
    await assert.rejects(
      () => client.position("Player", "white", new Chess(), signal()),
      /minutu/,
    );
    await assert.rejects(
      () => client.position("Player", "white", new Chess(), signal()),
      /minutu/,
    );
    assert.equal(calls, 1);
    now += 60_001;
    await client.position("Player", "white", new Chess(), signal());
    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
  }
});
test("PKCE uses S256, independent random state and no requested scopes or client secret", async () => {
  const { url, transaction } = await createAuthorization(
    "https://example.com/chessbot/",
  );
  const params = new URL(url).searchParams;
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.has("scope"), false);
  assert.equal(params.has("client_secret"), false);
  assert.notEqual(transaction.state, transaction.verifier);
  assert.equal(url.includes(transaction.verifier), false);
  const hash = Buffer.from(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(transaction.verifier),
    ),
  ).toString("base64url");
  assert.equal(params.get("code_challenge"), hash);
});
test("OAuth callback rejects mismatched state before exchanging a code and consumes transaction", async () => {
  const oldFetch = globalThis.fetch;
  const values = new Map();
  const removed = [];
  globalThis.sessionStorage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => {
      removed.push(k);
      values.delete(k);
    },
  };
  globalThis.location = {
    origin: "https://example.com",
    pathname: "/chessbot/",
    search: "?code=fake&state=wrong",
  };
  let cleanPath;
  globalThis.history = {
    replaceState: (_, __, path) => {
      cleanPath = path;
    },
  };
  values.set(
    "chessbot.lichess.pkce.v1",
    JSON.stringify({
      state: "expected",
      verifier: "fake",
      redirect: "https://example.com/chessbot/",
      createdAt: Date.now(),
    }),
  );
  globalThis.fetch = async () => {
    throw new Error("must not exchange code");
  };
  try {
    await assert.rejects(finishLogin, AuthenticationError);
    assert.equal(cleanPath, "/chessbot/");
    assert.equal(values.has("chessbot.lichess.pkce.v1"), false);
  } finally {
    globalThis.fetch = oldFetch;
    delete globalThis.sessionStorage;
    delete globalThis.location;
    delete globalThis.history;
  }
});
test("OAuth callback validates account, stores token only in session storage and revokes on logout", async () => {
  const oldFetch = globalThis.fetch;
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  globalThis.location = {
    origin: "https://example.com",
    pathname: "/chessbot/",
    search: "?code=fake&state=expected",
  };
  globalThis.history = { replaceState() {} };
  values.set(
    "chessbot.lichess.pkce.v1",
    JSON.stringify({
      state: "expected",
      verifier: "fake-verifier",
      redirect: "https://example.com/chessbot/",
      createdAt: Date.now(),
    }),
  );
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return options.method === "DELETE"
      ? new Response(null, { status: 204 })
      : new Response(
          JSON.stringify(
            url.endsWith("account")
              ? { username: "MyAccount" }
              : { access_token: "fake-token", expires_in: 3600 },
          ),
        );
  };
  try {
    const session = await finishLogin();
    assert.equal(session.username, "MyAccount");
    assert.equal(readAuth().username, "MyAccount");
    assert.equal(calls[0].options.body.get("code_verifier"), "fake-verifier");
    assert.equal(calls[1].options.headers.Authorization, "Bearer fake-token");
    assert.equal(await logout(session), true);
    assert.equal(readAuth(), null);
    assert.equal(calls[2].options.method, "DELETE");
  } finally {
    globalThis.fetch = oldFetch;
    delete globalThis.sessionStorage;
    delete globalThis.location;
    delete globalThis.history;
  }
});

test("OAuth denial/expired transaction never exchanges a code; expired sessions are cleared", async () => {
  const originalFetch = globalThis.fetch;
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  globalThis.location = {
    origin: "https://example.com",
    pathname: "/chessbot/",
    search: "?error=access_denied&state=expected",
  };
  globalThis.history = { replaceState() {} };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("must not exchange");
  };
  const transaction = {
    state: "expected",
    verifier: "fake",
    redirect: "https://example.com/chessbot/",
    createdAt: Date.now(),
  };
  try {
    values.set("chessbot.lichess.pkce.v1", JSON.stringify(transaction));
    await assert.rejects(finishLogin, /zrušeno/);
    location.search = "?code=fake&state=expected";
    values.set(
      "chessbot.lichess.pkce.v1",
      JSON.stringify({ ...transaction, createdAt: Date.now() - 600_001 }),
    );
    await assert.rejects(finishLogin, /vypršelo/);
    assert.equal(calls, 0);
    values.set(
      "chessbot.lichess.session.v1",
      JSON.stringify({
        token: "fake",
        username: "Account",
        expiresAt: Date.now() - 1,
      }),
    );
    assert.equal(readAuth(), null);
    assert.equal(values.has("chessbot.lichess.session.v1"), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.sessionStorage;
    delete globalThis.location;
    delete globalThis.history;
  }
});
