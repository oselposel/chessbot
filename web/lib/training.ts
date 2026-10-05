import { Chess } from "chess.js";
import { playUci, uci, type BookMove, type PlayerColor } from "./repertoire.ts";

export type TrainingConfig = {
  name: string;
  color: PlayerColor;
  seed: string[];
  plies: number;
  policy: "repertoire" | "line";
};
export type TrainingStep = {
  fen: string;
  options: BookMove[];
  chosen: BookMove;
  total: number;
  opening?: string;
};
export function chessFromMoves(moves: string[]): Chess {
  const chess = new Chess();
  for (const move of moves) playUci(chess, move);
  return chess;
}
// Accept a simple main line in international SAN or UCI, including PGN move numbers.
export function parseOpening(text: string): Chess {
  const chess = new Chess();
  const tokens = text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\r\n]*/g, " ")
    .replace(/\d+\.(?:\.\.)?/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length > 80)
    throw new Error("Úvod může mít nejvýše 40 úplných tahů.");
  for (const token of tokens) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) break;
    try {
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) playUci(chess, token);
      else chess.move(token.replace(/0/g, "O").replace(/[!?]+$/g, ""));
    } catch {
      throw new Error(
        `Tah „${token}“ není v této posloupnosti legální. Použij mezinárodní SAN (Nf3, Bc4) nebo UCI (g1f3).`,
      );
    }
  }
  return chess;
}
export const movesOf = (chess: Chess) =>
  chess.history({ verbose: true }).map(uci);
export function openingNotation(chess: Chess): string {
  const history = chess.history();
  return Array.from(
    { length: Math.ceil(history.length / 2) },
    (_, i) =>
      `${i + 1}. ${history[i * 2]}${history[i * 2 + 1] ? " " + history[i * 2 + 1] : ""}`,
  ).join(" ");
}
export const RUNNER_UP_RATIO = 0.8;
export function relevantMoves(moves: BookMove[]): BookMove[] {
  const ranked = moves
    .filter((move) => move.count > 0)
    .toSorted((a, b) => b.count - a.count);
  const [first, second] = ranked;
  if (!first) return [];
  // Top two by frequency; ties at the qualifying boundary are treated equally.
  // Even a fragmented repertoire always has a leader, without an absolute cutoff.
  const cutoff =
    second && second.count / first.count >= RUNNER_UP_RATIO
      ? second.count
      : first.count;
  return ranked.filter((move) => move.count >= cutoff);
}
export function formatMovePercentage(move: BookMove, total: number): string {
  if (total <= 0) return "0 %";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format((move.count / total) * 100)} %`;
}
export function judgeMove(
  move: string,
  options: BookMove[],
  accepted: BookMove[],
  target?: string | null,
) {
  const known = options.find((option) => option.uci === move);
  if (!known) return "unknown" as const;
  // Exact replay follows the recorded choice, independently of popularity.
  if (target && move === target) return "correct" as const;
  if (target && move !== target) return "alternative" as const;
  if (!accepted.some((option) => option.uci === move)) return "rare" as const;
  return "correct" as const;
}

export function shouldPauseForSingleGame(
  position: { total: number; complete: boolean },
  replay: boolean,
  acknowledged: boolean,
): boolean {
  return position.complete && position.total === 1 && !replay && !acknowledged;
}
