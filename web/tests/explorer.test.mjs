import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { ExplorerClient } from "../lib/explorer.ts";

const encoder = new TextEncoder();
const row = (queuePosition = 29, count = 10) => ({
  white: count,
  draws: 0,
  black: 0,
  queuePosition,
  moves: [{ uci: "e2e4", san: "e4", white: count, draws: 0, black: 0 }],
});
const chunk = (value) => encoder.encode(JSON.stringify(value) + "\n");
const final = () => new Response(chunk(row(0)));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const load = (client, controller = new AbortController(), progress, update) =>
  client.position(
    "Player",
    "white",
    new Chess(),
    controller.signal,
    progress,
    update,
  );

test("stalled stream renews once, ignores heartbeats/repeated rows and preserves partial data", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let cancelled = 0;
  let stream;
  const messages = [];
  const updates = [];
  const client = new ExplorerClient("fake", async () => {
    calls++;
    if (calls > 1) return final();
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
          controller.enqueue(chunk(row()));
        },
        cancel() {
          cancelled++;
        },
      }),
    );
  });
  const result = load(
    client,
    undefined,
    (m) => messages.push(m),
    (s) => updates.push(s),
  );
  await flush();
  assert.equal(updates[0].complete, false);
  t.mock.timers.tick(30_000);
  stream.enqueue(encoder.encode("\n\n"));
  stream.enqueue(chunk(row()));
  await flush();
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(cancelled, 1);
  assert.equal(calls, 1, "must back off before another request");
  assert.match(messages.at(-1), /obnovuji spojení \(1\/2\)/);
  assert.equal(updates.at(-1).complete, false);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal((await result).complete, true);
  assert.equal(calls, 2);
  await load(client);
  assert.equal(calls, 2, "only a clean final response enters the final cache");
});

test("changing queue positions reset idle detection but cannot bypass the request deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stream;
  let calls = 0;
  let cancelled = 0;
  const client = new ExplorerClient("fake", async () => {
    if (++calls > 1) return final();
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
          controller.enqueue(chunk(row()));
        },
        cancel() {
          cancelled++;
        },
      }),
    );
  });
  const result = load(client);
  await flush();
  for (const position of [28, 27, 26]) {
    t.mock.timers.tick(30_000);
    stream.enqueue(chunk(row(position)));
    await flush();
    assert.equal(cancelled, 0);
  }
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(cancelled, 1);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal((await result).complete, true);
});

test("hung response headers have bounded retries and leave the serial queue usable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const signals = [];
  const client = new ExplorerClient("fake", async (_, options) => {
    signals.push(options.signal);
    return ++calls <= 3 ? new Promise(() => {}) : final();
  });
  const rejected = assert.rejects(
    load(client),
    /opakovaně neposílá nové výsledky/,
  );
  await flush();
  for (let attempt = 0; attempt < 3; attempt++) {
    t.mock.timers.tick(45_000);
    await flush();
    if (attempt < 2) {
      t.mock.timers.tick((attempt + 1) * 5_000);
      await flush();
    }
  }
  await rejected;
  assert.equal(calls, 3);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal((await load(client)).complete, true);
  assert.equal(calls, 4);
});

test("abort releases a stalled reader even if cancellation itself never settles", async () => {
  let calls = 0;
  let cancelled = 0;
  const client = new ExplorerClient("fake", async () => {
    if (++calls > 1) return final();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk(row()));
        },
        cancel() {
          cancelled++;
          return new Promise(() => {});
        },
      }),
    );
  });
  const controller = new AbortController();
  const rejected = assert.rejects(load(client, controller), /manual abort/);
  await flush();
  controller.abort(new Error("manual abort"));
  await rejected;
  assert.equal(cancelled, 1);
  assert.equal((await load(client)).complete, true);
});

test("abort during retry backoff cancels pending renewal and allows the next position", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const client = new ExplorerClient("fake", async () =>
    ++calls === 1 ? new Promise(() => {}) : final(),
  );
  const controller = new AbortController();
  const rejected = assert.rejects(load(client, controller), /abort/i);
  await flush();
  t.mock.timers.tick(45_000);
  await flush();
  controller.abort();
  await rejected;
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(calls, 1);
  assert.equal((await load(client)).complete, true);
});
