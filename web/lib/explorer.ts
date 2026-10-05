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
  queuePosition?: number;
  error?: string;
};
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
  ): Promise<PositionData> {
    const copy = new Chess(chess.fen());
    const key = `${name.toLowerCase()}|${color}|${positionKey(copy)}`;
    const cached = this.cache.get(key);
    signal.throwIfAborted();
    if (cached && Date.now() - cached.at < 600_000)
      return Promise.resolve(cached.value);
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
        const response = await this.request(
          `https://explorer.lichess.org/player?${params}`,
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: "application/x-ndjson",
            },
            credentials: "omit",
            redirect: "error",
            signal,
          },
        );
        if (response.status === 401)
          throw new AuthenticationError(
            "Přihlášení vypršelo nebo bylo odvoláno. Přihlas se znovu.",
          );
        if (response.status === 429) {
          const retry = Number(response.headers.get("Retry-After"));
          this.blockedUntil =
            Date.now() +
            Math.max(60, Number.isFinite(retry) ? retry : 60) * 1000;
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
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let last: RawPosition | undefined;
        const line = (text: string) => {
          if (!text.trim()) return;
          const raw = JSON.parse(text) as RawPosition;
          if (raw.error) throw new Error("Explorer přerušil načítání pozice.");
          normalizePosition(raw, copy); // Validate every snapshot, but only use the final one.
          last = raw;
          progress(
            raw.queuePosition !== undefined
              ? `Indexování hráče · pozice ve frontě ${raw.queuePosition}`
              : `Načítání pozice · ${count(raw)} partií`,
          );
        };
        try {
          while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
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
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        signal.throwIfAborted();
        if (!last || last.queuePosition !== undefined)
          throw new Error(
            "Indexování hráče není dokončené. Zkus za chvíli obnovit pozici.",
          );
        const value = normalizePosition(last, copy);
        if (this.cache.size >= 500)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { at: Date.now(), value });
        return value;
      });
    this.queue = task;
    return task;
  }
}
