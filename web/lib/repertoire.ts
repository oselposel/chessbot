import { Chess, type Move } from "chess.js";

export type PlayerColor = "white" | "black";
export type Game = {
  id: string;
  variant: string;
  status: string;
  moves?: string;
  players: {
    white?: { user?: { id?: string; name?: string } };
    black?: { user?: { id?: string; name?: string } };
  };
  opening?: { eco: string; name: string; ply?: number };
};
export type BookMove = { uci: string; san: string; count: number };
export type Repertoire = {
  positions: Map<string, Map<string, BookMove>>;
  games: number;
  skipped: number;
  openings: Map<string, number>;
  name: string;
  color: PlayerColor;
};
export const positionKey = (chess: Chess) =>
  chess.fen().split(" ").slice(0, 4).join(" ");
export const uci = (move: Move) => move.from + move.to + (move.promotion || "");
export const playUci = (chess: Chess, text: string) =>
  chess.move({
    from: text.slice(0, 2),
    to: text.slice(2, 4),
    ...(text[4] ? { promotion: text[4] } : {}),
  });
export function createRepertoire(name: string, color: PlayerColor): Repertoire {
  return {
    positions: new Map(),
    games: 0,
    skipped: 0,
    openings: new Map(),
    name,
    color,
  };
}

export function addGame(book: Repertoire, game: Game): boolean {
  const player = game.players?.[book.color]?.user;
  if (
    game.variant !== "standard" ||
    !game.moves ||
    !player ||
    (player.id || player.name || "").toLowerCase() !==
      book.name.toLowerCase() ||
    ["created", "started", "aborted", "noStart"].includes(game.status)
  ) {
    book.skipped++;
    return false;
  }
  // Parse the entire opening before indexing: malformed games cannot add partial branches.
  const chess = new Chess();
  const entries: { key: string; move: BookMove }[] = [];
  try {
    for (const token of game.moves.trim().split(/\s+/).slice(0, 32)) {
      const key = positionKey(chess);
      const move = chess.move(token);
      entries.push({ key, move: { uci: uci(move), san: move.san, count: 1 } });
    }
  } catch {
    book.skipped++;
    return false;
  }
  if (!entries.length) {
    book.skipped++;
    return false;
  }
  const seen = new Set<string>();
  for (const { key, move } of entries) {
    if (seen.has(key)) continue;
    seen.add(key);
    let options = book.positions.get(key);
    if (!options) {
      options = new Map();
      book.positions.set(key, options);
    }
    const previous = options.get(move.uci);
    if (previous) previous.count++;
    else options.set(move.uci, move);
  }
  book.games++;
  book.name = player.name || book.name;
  const opening = game.opening
    ? `${game.opening.eco} · ${game.opening.name}`
    : "Nerozpoznané zahájení";
  book.openings.set(opening, (book.openings.get(opening) || 0) + 1);
  return true;
}
export function responses(book: Repertoire, chess: Chess): BookMove[] {
  const legal = new Set(chess.moves({ verbose: true }).map(uci));
  return [...(book.positions.get(positionKey(chess))?.values() || [])]
    .filter((move) => legal.has(move.uci))
    .sort((a, b) => b.count - a.count);
}
export function sampleMove(
  moves: BookMove[],
  uniform = false,
  random = Math.random,
): BookMove | undefined {
  if (!moves.length) return undefined;
  let target =
    random() * moves.reduce((sum, m) => sum + (uniform ? 1 : m.count), 0);
  for (const move of moves) {
    target -= uniform ? 1 : move.count;
    if (target < 0) return move;
  }
  return moves[moves.length - 1];
}

declare const __DIRECT_LICHESS__: boolean;
let downloading = false;
let blockedUntil = 0;

export async function loadRepertoire(
  username: string,
  color: PlayerColor,
  max: number,
  onProgress: (count: number) => void,
  signal: AbortSignal,
  direct = typeof __DIRECT_LICHESS__ !== "undefined" && __DIRECT_LICHESS__,
): Promise<Repertoire> {
  if (downloading) throw new Error("Počkej na dokončení předchozího načítání.");
  if (Date.now() < blockedUntil)
    throw new Error("Lichess omezil požadavky. Počkej alespoň minutu a zkus to znovu.");
  downloading = true;
  try {
    return await downloadRepertoire(username, color, max, onProgress, signal, direct);
  } finally {
    downloading = false;
  }
}

async function downloadRepertoire(
  username: string,
  color: PlayerColor,
  max: number,
  onProgress: (count: number) => void,
  signal: AbortSignal,
  direct: boolean,
): Promise<Repertoire> {
  const url = direct
    ? `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${new URLSearchParams({
        color, max: String(max), perfType: "bullet,blitz,rapid,classical",
        opening: "true", moves: "true", ongoing: "false", finished: "true", sort: "dateDesc",
      })}`
    : `/api/games?${new URLSearchParams({ username, color, max: String(max) })}`;
  const response = await fetch(
    url,
    { signal, headers: { Accept: "application/x-ndjson" }, credentials: "omit" },
  );
  if (!response.ok) {
    if (response.status === 429) {
      blockedUntil = Date.now() + 60_000;
      throw new Error("Lichess omezil požadavky. Počkej alespoň minutu a zkus to znovu.");
    }
    if (response.status === 404) throw new Error("Hráč nebyl nalezen.");
    const error = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(error.error || "Partie se nepodařilo načíst.");
  }
  if (!response.body) throw new Error("Prohlížeč nepodporuje načítání partií.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const book = createRepertoire(username, color);
  const ids = new Set<string>();
  let buffer = "";
  let received = 0;
  const processLine = (line: string) => {
    if (received >= max) return;
    if (!line.trim()) return;
    const game = JSON.parse(line) as Game & { error?: string };
    if (game.error) throw new Error(game.error);
    if (!game.id || !game.players)
      throw new Error("Lichess vrátil neočekávaná data.");
    if (ids.has(game.id)) return;
    ids.add(game.id);
    received++;
    addGame(book, game);
    onProgress(received);
  };
  try {
    while (received < max) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        processLine(line);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!book.games)
    throw new Error(
      "Hráč nemá pro tuto barvu žádné použitelné dokončené partie ve vybraném vzorku.",
    );
  return book;
}
