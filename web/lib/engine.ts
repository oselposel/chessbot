import { Chess } from "chess.js";
import { playUci } from "./repertoire.ts";

export type EngineScore =
  | { kind: "cp"; value: number }
  | { kind: "mate"; value: number; winner: "white" | "black" };
export type Evaluation = {
  fen: string;
  depth: number;
  score: EngineScore;
  pv: string[];
};
export type EngineStatus = "loading" | "searching" | "done" | "error";
type EngineWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>;
type Job = {
  id: number;
  fen: string;
  update: (value: Evaluation) => void;
  status: (value: EngineStatus) => void;
  evaluation?: Evaluation;
};

// UCI scores are relative to the side to move. The UI always uses White's view.
export function parseEngineInfo(line: string, fen: string): Evaluation | null {
  if (!line.startsWith("info ") || /\b(?:lowerbound|upperbound)\b/.test(line))
    return null;
  const depth = line.match(/\bdepth (\d+)\b/);
  const score = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  const multi = line.match(/\bmultipv (\d+)\b/);
  if (!depth || !score || (multi && multi[1] !== "1")) return null;
  const raw = Number(score[2]);
  const whiteToMove = fen.split(" ")[1] === "w";
  const value = whiteToMove ? raw : -raw;
  if (!Number.isSafeInteger(raw) || !Number.isSafeInteger(Number(depth[1])))
    return null;
  return {
    fen,
    depth: Number(depth[1]),
    score:
      score[1] === "cp"
        ? { kind: "cp", value }
        : {
            kind: "mate",
            value,
            winner: raw > 0 === whiteToMove ? "white" : "black",
          },
    pv: (line.match(/\bpv (.+)$/)?.[1] || "")
      .split(/\s+/)
      .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)),
  };
}
export function terminalEvaluation(fen: string): Evaluation | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate())
    return {
      fen,
      depth: 0,
      pv: [],
      score: {
        kind: "mate",
        value: 0,
        winner: chess.turn() === "w" ? "black" : "white",
      },
    };
  if (chess.isDraw())
    return { fen, depth: 0, pv: [], score: { kind: "cp", value: 0 } };
  return null;
}
export function formatEvaluation(score: EngineScore): string {
  if (score.kind === "mate") {
    if (!score.value)
      return `Mat · vyhrál ${score.winner === "white" ? "bílý" : "černý"}`;
    return `${score.winner === "white" ? "+" : "−"}M${Math.abs(score.value)}`;
  }
  if (!score.value) return "0,00";
  return `${score.value > 0 ? "+" : "−"}${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(score.value) / 100)}`;
}
// A visual scale of advantage, NOT a win probability.
export const whiteShare = (score: EngineScore) =>
  score.kind === "mate"
    ? score.winner === "white"
      ? 100
      : 0
    : 50 + 45 * Math.tanh(score.value / 400);
export function principalVariation(fen: string, moves: string[]): string {
  const chess = new Chess(fen);
  const parts: string[] = [];
  for (const [i, move] of moves.slice(0, 8).entries()) {
    try {
      const number = chess.fen().split(" ")[5];
      const prefix =
        chess.turn() === "w" ? `${number}. ` : i === 0 ? `${number}... ` : "";
      parts.push(prefix + playUci(chess, move).san);
    } catch {
      break;
    }
  }
  return parts.join(" ");
}

export class EngineClient {
  private worker: EngineWorker;
  private ready = false;
  private disposed = false;
  private failed = false;
  private epoch = 0;
  private latest: Job | null = null;
  private active: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cache = new Map<string, Evaluation>();
  constructor(createWorker: () => EngineWorker) {
    this.worker = createWorker();
    this.worker.onmessage = (event) => {
      if (this.disposed || this.failed || typeof event.data !== "string")
        return;
      for (const line of event.data.split(/\r?\n/)) this.receive(line);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail();
    };
    this.worker.onmessageerror = () => this.fail();
    this.timer = setTimeout(() => this.fail(), 20_000);
    this.worker.postMessage("uci");
  }
  analyze(fen: string, update: Job["update"], status: Job["status"]) {
    if (this.disposed) return;
    const job: Job = { id: ++this.epoch, fen, update, status };
    this.latest = job;
    if (this.active) this.worker.postMessage("stop");
    if (this.failed) {
      status("error");
      return;
    }
    const cached = this.cache.get(fen) || terminalEvaluation(fen);
    if (cached) {
      this.latest = null;
      update(cached);
      status("done");
      return;
    }
    status(this.ready ? "searching" : "loading");
    this.pump();
  }
  cancel() {
    this.epoch++;
    this.latest = null;
    if (this.active && !this.failed && !this.disposed)
      this.worker.postMessage("stop");
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    clearTimeout(this.timer);
    this.worker.terminate();
  }
  private fail() {
    if (this.disposed || this.failed) return;
    this.failed = true;
    clearTimeout(this.timer);
    this.worker.terminate();
    const job = this.latest || this.active;
    if (job?.id === this.epoch) job.status("error");
    this.latest = this.active = null;
  }
  private pump() {
    if (
      !this.ready ||
      this.active ||
      !this.latest ||
      this.failed ||
      this.disposed
    )
      return;
    const job = this.latest;
    this.latest = null;
    this.active = job;
    job.status("searching");
    // Latest FEN waits for the old bestmove; isready alone does not stop a search.
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage("go depth 20 movetime 1500");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(), 8_000);
  }
  private receive(line: string) {
    if (line === "uciok") {
      this.worker.postMessage("setoption name Hash value 16");
      this.worker.postMessage("setoption name MultiPV value 1");
      this.worker.postMessage("isready");
    } else if (line === "readyok") {
      this.ready = true;
      clearTimeout(this.timer);
      this.pump();
    } else if (line.startsWith("bestmove ")) {
      const job = this.active;
      this.active = null;
      clearTimeout(this.timer);
      if (job?.id === this.epoch) {
        if (job.evaluation) {
          if (this.cache.size >= 100)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(job.fen, job.evaluation);
          job.status("done");
        } else job.status("error");
      }
      this.pump();
    } else if (this.active?.id === this.epoch) {
      const job = this.active;
      const evaluation = parseEngineInfo(line, job.fen);
      if (
        evaluation &&
        (!job.evaluation || evaluation.depth >= job.evaluation.depth)
      ) {
        job.evaluation = evaluation;
        job.update(evaluation);
      }
    }
  }
}
