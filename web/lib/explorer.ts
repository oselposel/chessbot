import { Chess } from "chess.js";
import { AuthenticationError } from "./lichess-auth.ts";
import {
  positionKey,
  uci,
  type BookMove,
  type PlayerColor,
} from "./repertoire.ts";

export type PositionData = {
  moves: BookMove[];
  total: number;
  opening?: string;
  complete: boolean;
};
type RawPosition = {
  white: number;
  draws: number;
  black: number;
  moves: {
    uci: string;
    san: string;
    white: number;
    draws: number;
    black: number;
  }[];
  opening?: { eco: string; name: string } | null;
  queuePosition?: number | null;
  error?: string;
};
class ExplorerTimeoutError extends Error {}

// Do not rely on fetch/reader cancellation alone to settle the serial queue.
// A stalled connection (or a suspended browser tab) must not block future positions.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
function count(values: {
  white: number;
  draws: number;
  black: number;
}): number {
  if (
    ![values.white, values.draws, values.black].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("Explorer vrátil neplatné četnosti.");
  return values.white + values.draws + values.black;
}
export function normalizePosition(
  raw: RawPosition,
  chess: Chess,
  complete = false,
): PositionData {
  if (!raw || !Array.isArray(raw.moves))
    throw new Error("Explorer vrátil neočekávaná data.");
  const legal = chess.moves({ verbose: true });
  const moves: BookMove[] = [];
  for (const option of raw.moves) {
    const amount = count(option);
    // Explorer can represent castling as king-to-rook (Chess960 UCI).
    const move = legal.find(
      (m) =>
        uci(m) === option.uci ||
        (m.isKingsideCastle() && option.uci === m.from + "h" + m.from[1]) ||
        (m.isQueensideCastle() && option.uci === m.from + "a" + m.from[1]),
    );
    if (move && amount > 0 && !moves.some((m) => m.uci === uci(move)))
      moves.push({ uci: uci(move), san: move.san, count: amount });
  }
  return {
    moves: moves.sort((a, b) => b.count - a.count),
    total: count(raw),
    complete,
    opening: raw.opening
      ? `${raw.opening.eco} · ${raw.opening.name}`
      : undefined,
  };
}

export class ExplorerClient {
  private cache = new Map<string, { at: number; value: PositionData }>();
  private queue: Promise<unknown> = Promise.resolve();
  private blockedUntil = 0;
  private token: string;
  private request: typeof fetch;
  constructor(
    token: string,
    request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.token = token;
    this.request = request;
  }
  clear() {
    this.cache.clear();
  }
  position(
    name: string,
    color: PlayerColor,
    chess: Chess,
    signal: AbortSignal,
    progress: (message: string) => void = () => {},
    update: (position: PositionData) => void = () => {},
  ): Promise<PositionData> {
    const copy = new Chess(chess.fen());
    const key = `${name.toLowerCase()}|${color}|${positionKey(copy)}`;
    const cached = this.cache.get(key);
    signal.throwIfAborted();
    if (
      cached &&
      Date.now() - cached.at < (cached.value.complete ? 600_000 : 30_000)
    ) {
      update(cached.value);
      if (cached.value.complete) return Promise.resolve(cached.value);
    }
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        if (Date.now() < this.blockedUntil)
          throw new Error(
            "Lichess omezil požadavky. Počkej alespoň minutu a pak obnov pozici.",
          );
        const params = new URLSearchParams({
          player: name,
          color,
          variant: "standard",
          fen: copy.fen(),
          speeds: "bullet,blitz,rapid,classical",
          moves: "100",
          recentGames: "0",
        });
        for (let attempt = 0; ; attempt++) {
          try {
            return await this.load(key, params, copy, signal, progress, update);
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof ExplorerTimeoutError)) throw error;
            if (attempt >= 2)
              throw new Error(
                "Lichess opakovaně neposílá nové výsledky. Pozice i odehrané tahy jsou zachované. Zkus za chvíli obnovit pozici.",
              );
            progress(
              `Lichess neposílá nové výsledky · obnovuji spojení (${attempt + 1}/2). Pozice zůstává zachovaná.`,
            );
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await abortable(
                new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, (attempt + 1) * 5_000);
                }),
                signal,
              );
            } finally {
              clearTimeout(timer);
            }
          }
        }
      });
    this.queue = task;
    return task;
  }
  private async load(
    key: string,
    params: URLSearchParams,
    copy: Chess,
    signal: AbortSignal,
    progress: (message: string) => void,
    update: (position: PositionData) => void,
  ): Promise<PositionData> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timeout = () =>
      controller.abort(
        new ExplorerTimeoutError("Lichess neposílá nové výsledky."),
      );
    const deadline = setTimeout(timeout, 120_000);
    let idle = setTimeout(timeout, 45_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await abortable(
        this.request(`https://explorer.lichess.org/player?${params}`, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/x-ndjson",
          },
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (response.status === 401)
        throw new AuthenticationError(
          "Přihlášení vypršelo nebo bylo odvoláno. Přihlas se znovu.",
        );
      if (response.status === 429) {
        const retry = Number(response.headers.get("Retry-After"));
        this.blockedUntil =
          Date.now() + Math.max(60, Number.isFinite(retry) ? retry : 60) * 1000;
        throw new Error(
          "Lichess omezil požadavky. Počkej alespoň minutu a pak obnov pozici.",
        );
      }
      if (!response.ok || !response.body)
        throw new Error(
          response.status === 404
            ? "Hráč nebyl nalezen."
            : "Explorer je nedostupný. Obnov načítání pozice za chvíli.",
        );
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let last: RawPosition | undefined;
      let fingerprint: string | undefined;
      const line = (text: string) => {
        if (!text.trim()) return;
        const raw = JSON.parse(text) as RawPosition;
        if (!raw || raw.error)
          throw new Error("Explorer přerušil načítání pozice.");
        if (
          raw.queuePosition != null &&
          (!Number.isSafeInteger(raw.queuePosition) || raw.queuePosition < 0)
        )
          throw new Error("Explorer vrátil neplatnou pozici ve frontě.");
        const snapshot = normalizePosition(raw, copy);
        const nextFingerprint = JSON.stringify(raw);
        // Heartbeats and repeated queue/snapshot rows do not prove progress.
        if (nextFingerprint !== fingerprint) {
          fingerprint = nextFingerprint;
          clearTimeout(idle);
          idle = setTimeout(timeout, 45_000);
        }
        last = raw;
        // A queue position of zero is not a completion signal. Publish data now,
        // but only a clean EOF makes the snapshot final (and allows end-of-book).
        if (this.cache.size >= 500 && !this.cache.has(key))
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { at: Date.now(), value: snapshot });
        update(snapshot);
        progress(
          (raw.queuePosition || 0) > 0
            ? `Indexování hráče · pozice ve frontě ${raw.queuePosition}`
            : `Data se doplňují na pozadí · ${count(raw)} partií`,
        );
      };
      while (true) {
        controller.signal.throwIfAborted();
        const { value, done } = await abortable(
          reader.read(),
          controller.signal,
        );
        buffer += decoder.decode(value, { stream: !done });
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
        }
        if (buffer.length > 2_000_000)
          throw new Error("Explorer vrátil příliš velkou odpověď.");
        if (done) {
          line(buffer);
          break;
        }
      }
      controller.signal.throwIfAborted();
      if (!last || (last.queuePosition || 0) > 0)
        throw new Error(
          "Indexování hráče není dokončené. Zkus za chvíli obnovit pozici.",
        );
      const value = normalizePosition(last, copy, true);
      if (this.cache.size >= 500 && !this.cache.has(key))
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { at: Date.now(), value });
      update(value);
      progress(`Pozice načtena · ${value.total} partií`);
      return value;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(deadline);
      clearTimeout(idle);
      signal.removeEventListener("abort", abort);
      if (reader) {
        // Cancellation itself can stall; never await it before releasing the queue.
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
}
