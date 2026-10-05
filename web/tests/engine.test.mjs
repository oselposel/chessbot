import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  EngineClient,
  parseEngineInfo,
  formatEvaluation,
  whiteShare,
  terminalEvaluation,
  principalVariation,
} from "../lib/engine.ts";
import { parseOpening } from "../lib/training.ts";
const initial = new Chess().fen();
const black = parseOpening("e4").fen();
const info =
  "info depth 18 seldepth 23 multipv 1 score cp 35 nodes 10000 pv e2e4 e7e5 g1f3";
class FakeWorker {
  sent = [];
  terminated = false;
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  postMessage(message) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage?.({ data });
  }
  ready() {
    this.emit("uciok");
    this.emit("readyok");
  }
}
test("converts UCI cp/mate from either side to White's view and ignores bound/secondary scores", () => {
  assert.equal(parseEngineInfo(info, initial).score.value, 35);
  assert.equal(parseEngineInfo(info, black).score.value, -35);
  for (const fen of [initial, black]) {
    const positive = parseEngineInfo("info depth 10 score mate 3 pv e2e4", fen);
    const negative = parseEngineInfo(
      "info depth 10 score mate -2 pv e2e4",
      fen,
    );
    assert.equal(positive.score.winner, fen === initial ? "white" : "black");
    assert.equal(negative.score.winner, fen === initial ? "black" : "white");
    assert.equal(whiteShare(positive.score), fen === initial ? 100 : 0);
  }
  assert.equal(parseEngineInfo(info + " lowerbound", initial), null);
  assert.equal(
    parseEngineInfo(info.replace("multipv 1", "multipv 2"), initial),
    null,
  );
  assert.equal(parseEngineInfo("info depth 10 nodes 10000", initial), null);
  assert.equal(parseEngineInfo("bestmove e2e4", initial), null);
  assert.equal(formatEvaluation({ kind: "cp", value: 35 }), "+0,35");
  assert.equal(formatEvaluation({ kind: "cp", value: -120 }), "−1,20");
  assert.equal(formatEvaluation({ kind: "cp", value: 0 }), "0,00");
  assert.equal(
    formatEvaluation({ kind: "mate", value: -3, winner: "black" }),
    "−M3",
  );
  assert.equal(whiteShare({ kind: "cp", value: 0 }), 50);
});
test("terminal mate/stalemate have unambiguous evaluation and PV is legal SAN with move numbers", () => {
  const mate = terminalEvaluation(parseOpening("f3 e5 g4 Qh4#").fen());
  assert.equal(mate.score.winner, "black");
  assert.equal(formatEvaluation(mate.score), "Mat · vyhrál černý");
  assert.equal(
    terminalEvaluation("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").score.value,
    0,
  );
  assert.equal(terminalEvaluation(initial), null);
  assert.equal(
    principalVariation(initial, ["e2e4", "e7e5", "g1f3", "b8c6"]),
    "1. e4 e5 2. Nf3 Nc6",
  );
  assert.equal(
    principalVariation(black, ["e7e5", "g1f3", "a1a8"]),
    "1... e5 2. Nf3",
  );
  assert.equal(
    principalVariation(parseOpening("e4 e5 Nf3 Nc6 Bc4 Bc5").fen(), ["e1g1"]),
    "4. O-O",
  );
  assert.equal(
    principalVariation("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", ["a7a8q"]),
    "1. a8=Q+",
  );
});
test("initializes UCI, emits progressive depth, rejects obsolete scores and serializes stop/new search", () => {
  const worker = new FakeWorker();
  const client = new EngineClient(() => worker);
  const updates = [];
  const status = [];
  client.analyze(
    initial,
    (v) => updates.push(v),
    (s) => status.push(s),
  );
  assert.deepEqual(worker.sent, ["uci"]);
  worker.ready();
  assert.ok(worker.sent.includes("setoption name Hash value 16"));
  assert.match(worker.sent.at(-1), /^go depth 20 movetime 1500$/);
  worker.emit(info);
  worker.emit(info.replace("depth 18", "depth 12"));
  assert.equal(updates.length, 1);
  client.analyze(
    black,
    (v) => updates.push(v),
    (s) => status.push(s),
  );
  assert.equal(worker.sent.at(-1), "stop");
  worker.emit(info);
  assert.equal(updates.length, 1);
  worker.emit("bestmove e2e4");
  assert.equal(worker.sent.at(-2), "position fen " + black);
  worker.emit("info depth 16 score cp 25 pv e7e5");
  assert.equal(updates.at(-1).fen, black);
  assert.equal(updates.at(-1).score.value, -25);
  worker.emit("bestmove e7e5");
  assert.equal(status.at(-1), "done");
  const sent = worker.sent.length;
  client.analyze(
    black,
    (v) => updates.push(v),
    (s) => status.push(s),
  );
  assert.equal(worker.sent.length, sent, "completed position is cached");
  client.dispose();
  assert.equal(worker.terminated, true);
  worker.emit(info);
  assert.equal(updates.at(-1).fen, black);
});
test("latest rapid position wins and cancel/dispose prevent stale callbacks", () => {
  const worker = new FakeWorker();
  const client = new EngineClient(() => worker);
  const updates = [];
  const next = parseOpening("e4 e5").fen();
  const after = parseOpening("e4 e5 Nf3").fen();
  client.analyze(
    initial,
    (v) => updates.push(v),
    () => {},
  );
  worker.ready();
  client.analyze(
    black,
    (v) => updates.push(v),
    () => {},
  );
  client.analyze(
    next,
    (v) => updates.push(v),
    () => {},
  );
  worker.emit("bestmove e2e4");
  assert.equal(worker.sent.at(-2), "position fen " + next);
  client.cancel();
  worker.emit(info);
  worker.emit("bestmove g1f3");
  assert.equal(updates.length, 0);
  client.analyze(
    after,
    (v) => updates.push(v),
    () => {},
  );
  worker.emit("info depth 10 score cp 30 pv b8c6");
  assert.equal(updates.at(-1).fen, after);
  client.dispose();
});
test("load/search watchdog reports recoverable errors and terminates the worker", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const ready of [false, true]) {
    const worker = new FakeWorker();
    const status = [];
    const client = new EngineClient(() => worker);
    client.analyze(
      initial,
      () => {},
      (s) => status.push(s),
    );
    if (ready) worker.ready();
    t.mock.timers.tick(ready ? 8_000 : 20_000);
    assert.equal(status.at(-1), "error");
    assert.equal(worker.terminated, true);
    client.dispose();
  }
});
