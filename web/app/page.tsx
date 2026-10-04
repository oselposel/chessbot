"use client";
import { useEffect, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import {
  Lightbulb,
  RefreshCw,
  BookOpen,
  Check,
  X,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  loadRepertoire,
  responses,
  sampleMove,
  playUci,
  uci,
  type Repertoire,
  type PlayerColor,
} from "@/lib/repertoire";

const symbols: Record<string, string> = {
  wk: "♔",
  wq: "♕",
  wr: "♖",
  wb: "♗",
  wn: "♘",
  wp: "♙",
  bk: "♚",
  bq: "♛",
  br: "♜",
  bb: "♝",
  bn: "♞",
  bp: "♟",
};
const names: Record<string, string> = {
  k: "král",
  q: "dáma",
  r: "věž",
  b: "střelec",
  n: "jezdec",
  p: "pěšec",
};
const pieceLabel = (color: string, type: string) =>
  `${color === "w" ? (type === "q" || type === "r" ? "bílá" : "bílý") : type === "q" || type === "r" ? "černá" : "černý"} ${names[type]}`;
type Phase = "idle" | "player" | "opponent" | "complete";
type Feedback = { kind: "neutral" | "success" | "error"; text: string };
type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
function Choice({
  id,
  value,
  onChange,
  options,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="select-control">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [username, setUsername] = useState("");
  const [color, setColor] = useState<PlayerColor>("white");
  const [sample, setSample] = useState("300");
  const [depth, setDepth] = useState("12");
  const [mode, setMode] = useState("weighted");
  const [book, setBook] = useState<Repertoire | null>(null);
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(0);
  const [loadError, setLoadError] = useState("");
  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState(chessRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selected, setSelected] = useState<Square | null>(null);
  const [hint, setHint] = useState(false);
  const [promotion, setPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({
    kind: "neutral",
    text: "Načti repertoár hráče a zahaj první trénink.",
  });
  const [stats, setStats] = useState({ correct: 0, mistakes: 0, hints: 0 });
  const loadController = useRef<AbortController | null>(null);
  const trainingColor = book?.color || color;
  const side = trainingColor === "white" ? "w" : "b";
  const limit = Number(depth) * 2;
  const options = book ? responses(book, chessRef.current) : [];
  const latest = chessRef.current.history({ verbose: true }).at(-1);
  const sync = () => {
    setFen(chessRef.current.fen());
    setHistory(chessRef.current.history());
    setSelected(null);
    setHint(false);
    setPromotion(null);
  };
  function continueRound() {
    const chess = chessRef.current;
    if (
      chess.history().length >= limit ||
      chess.isGameOver() ||
      !book ||
      !responses(book, chess).length
    ) {
      setPhase("complete");
      setFeedback({
        kind: "success",
        text:
          chess.history().length >= limit
            ? "Hotovo! Dosáhl jsi zvolené hloubky zahájení."
            : "Tady načtený repertoár končí. Zkus další variantu.",
      });
    } else setPhase(chess.turn() === side ? "player" : "opponent");
  }
  function newRound() {
    if (!book || busy) return;
    chessRef.current.reset();
    sync();
    setPhase(trainingColor === "white" ? "player" : "opponent");
    setFeedback({
      kind: "neutral",
      text:
        trainingColor === "white"
          ? `Zahraj první tah jako ${book.name}.`
          : "Soupeř vybírá první tah…",
    });
  }
  useEffect(() => {
    if (phase !== "opponent" || !book || busy) return;
    const timer = setTimeout(() => {
      const move = sampleMove(
        responses(book, chessRef.current),
        mode === "uniform",
      );
      if (!move) {
        continueRound();
        return;
      }
      playUci(chessRef.current, move.uci);
      sync();
      setFeedback({
        kind: "neutral",
        text: `Soupeř zahrál ${move.san}. Jak odpoví ${book.name}?`,
      });
      continueRound();
    }, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fen, book, busy, mode, depth]);
  useEffect(() => () => loadController.current?.abort(), []);
  async function load() {
    if (loadController.current) return;
    const name = username.trim();
    if (!/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
      setLoadError("Zadej platný Lichess nickname (2–30 znaků).");
      return;
    }
    const controller = new AbortController();
    loadController.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);
    setBusy(true);
    setReceived(0);
    setLoadError("");
    try {
      const data = await loadRepertoire(
        name,
        color,
        Number(sample),
        setReceived,
        controller.signal,
      );
      setBook(data);
      setUsername(data.name);
      chessRef.current.reset();
      sync();
      setStats({ correct: 0, mistakes: 0, hints: 0 });
      setPhase(color === "white" ? "player" : "opponent");
      setFeedback({
        kind: "neutral",
        text:
          color === "white"
            ? `Zahraj první tah jako ${data.name}.`
            : "Soupeř vybírá první tah…",
      });
    } catch (error) {
      setLoadError(
        controller.signal.aborted
          ? timedOut
            ? "Načítání trvalo příliš dlouho. Zkus menší vzorek."
            : "Načítání bylo zrušeno."
          : error instanceof Error
            ? error.message
            : "Partie se nepodařilo načíst.",
      );
    } finally {
      clearTimeout(timer);
      loadController.current = null;
      setBusy(false);
    }
  }
  function submitMove(text: string) {
    if (phase !== "player" || busy || !book)
      return { accepted: false, error: "Teď není tvůj tah." };
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text))
      return {
        accepted: false,
        error: "Použij platný tah UCI, například e2e4.",
      };
    let move;
    try {
      move = playUci(new Chess(fen), text);
    } catch {
      setFeedback({ kind: "error", text: "Tento tah není v pozici legální." });
      setSelected(null);
      return { accepted: false, error: "Nelegální tah." };
    }
    const known = options.find((option) => option.uci === uci(move));
    if (!known) {
      setStats((s) => ({ ...s, mistakes: s.mistakes + 1 }));
      setFeedback({
        kind: "error",
        text: `${move.san} v načteném repertoáru hráče není. Zkus jiný tah nebo nápovědu.`,
      });
      setSelected(null);
      return { accepted: false, error: "Tah není v repertoáru." };
    }
    playUci(chessRef.current, known.uci);
    sync();
    setStats((s) => ({ ...s, correct: s.correct + 1 }));
    setFeedback({
      kind: "success",
      text: `Správně, ${known.san}! Tento tah je doložený v ${known.count} ${known.count === 1 ? "partii" : "partiích"}.`,
    });
    continueRound();
    return { accepted: true, move: known.san };
  }
  function clickSquare(square: Square) {
    if (phase !== "player" || busy) return;
    const chess = chessRef.current;
    const piece = chess.get(square);
    if (selected === square) {
      setSelected(null);
      return;
    }
    if (piece?.color === side) {
      setSelected(square);
      return;
    }
    if (!selected) return;
    const moves = chess
      .moves({ square: selected, verbose: true })
      .filter((move) => move.to === square);
    if (moves.some((move) => move.promotion)) {
      setPromotion({ from: selected, to: square });
      return;
    }
    submitMove(selected + square);
  }
  const destinations = selected
    ? new Set(
        chessRef.current
          .moves({ square: selected, verbose: true })
          .map((move) => move.to),
      )
    : new Set<string>();
  const cells = chessRef.current.board().flat();
  const ordered = trainingColor === "white" ? cells : [...cells].reverse();
  const actionsRef = useRef({ submitMove });
  actionsRef.current = { submitMove };
  const stateRef = useRef({
    phase,
    fen,
    name: book?.name || null,
    color: trainingColor,
  });
  stateRef.current = {
    phase,
    fen,
    name: book?.name || null,
    color: trainingColor,
  };
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContext["registerTool"]>[0]) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "get_training_position",
      description:
        "Read the current opening-training position, player and turn.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => stateRef.current,
    });
    register({
      name: "play_training_move",
      description:
        "Submit a UCI move to the same repertoire trainer as the chessboard. A wrong answer leaves the position unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          move: { type: "string", pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$" },
        },
        required: ["move"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => {
        if (
          !input ||
          typeof input !== "object" ||
          !("move" in input) ||
          typeof input.move !== "string"
        )
          throw new Error("A UCI move is required.");
        return actionsRef.current.submitMove(input.move);
      },
    });
    return () => lifecycle.abort();
  }, []);
  const openings = book
    ? [...book.openings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    : [];
  return (
    <main className="workspace" data-ready={ready}>
      <header className="topbar">
        <a className="brand" href="./">
          <span>♞</span>chessbot <small>Opening studio</small>
        </a>
        <span>Osobní trénink</span>
      </header>
      <div className="intro">
        <p className="eyebrow">REPERTOÁR Z LICHESSU</p>
        <h1>Hraj jako tvůj oblíbený hráč.</h1>
        <p>Nauč se jeho zahájení. Tah po tahu.</p>
      </div>
      <div className="studio">
        <aside className="setup panel">
          <h2>Koho chceš následovat?</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <label htmlFor="nickname">Lichess nickname</label>
            <Input
              id="nickname"
              autoComplete="off"
              spellCheck={false}
              maxLength={30}
              placeholder="např. DrNykterstein"
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
            />
            <label htmlFor="color">Trénovat za</label>
            <Choice
              id="color"
              value={color}
              onChange={(v) => setColor(v as PlayerColor)}
              disabled={busy}
              options={[
                ["white", "Bílé figury"],
                ["black", "Černé figury"],
              ]}
            />
            <label htmlFor="sample">Vzorek nejnovějších partií</label>
            <Choice
              id="sample"
              value={sample}
              onChange={setSample}
              disabled={busy}
              options={[
                ["100", "100 partií · rychlé načtení"],
                ["300", "300 partií"],
                ["1000", "1 000 partií · širší repertoár"],
              ]}
            />
            <Button
              type="submit"
              className="primary-action"
              disabled={busy || !username.trim()}
            >
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={17} />
                  Načítání…
                </>
              ) : (
                "Načíst repertoár"
              )}
            </Button>
          </form>
          {busy && (
            <div className="loading-info" role="status">
              <p>
                Načteno {received} / {sample} partií
              </p>
              <Progress
                value={(received / Number(sample)) * 100}
                aria-label="Průběh načítání"
              />
              <Button
                variant="ghost"
                className="wide"
                onClick={() => loadController.current?.abort()}
              >
                Zrušit načítání
              </Button>
            </div>
          )}
          {loadError && (
            <p className="load-error" role="alert">
              {loadError}
            </p>
          )}
          {book && (
            <div className="loaded-info">
              <Check size={16} />
              <span>
                <strong>{book.name}</strong> · {book.games} partií ·{" "}
                {book.color === "white" ? "bílé" : "černé"}
                {book.skipped > 0 && (
                  <small>{book.skipped} nepoužitelných partií vynecháno</small>
                )}
              </span>
            </div>
          )}
          <p className="note">
            Bullet, blitz, rapid a classical. Soupeřovy tahy i tvé odpovědi
            pocházejí z těchto partií.
          </p>
          <div className="setup-bottom">
            <label htmlFor="depth">Hloubka zahájení</label>
            <Choice
              id="depth"
              value={depth}
              disabled={busy || phase === "opponent"}
              onChange={(v) => {
                setDepth(v);
                if (book) {
                  chessRef.current.reset();
                  sync();
                  setPhase(trainingColor === "white" ? "player" : "opponent");
                  setFeedback({
                    kind: "neutral",
                    text: "Nový trénink se zvolenou hloubkou.",
                  });
                }
              }}
              options={[
                ["8", "8 tahů"],
                ["12", "12 tahů"],
                ["16", "16 tahů"],
              ]}
            />
            <label htmlFor="mode">Soupeřovy odpovědi</label>
            <Choice
              id="mode"
              value={mode}
              onChange={setMode}
              disabled={busy}
              options={[
                ["weighted", "Náhodně podle četnosti"],
                ["uniform", "Každá odpověď stejně často"],
              ]}
            />
          </div>
        </aside>
        <section className="board-area">
          <div className="player-strip">
            <span className="avatar">{side === "w" ? "♟" : "♙"}</span>
            <div>
              <strong>Soupeř</strong>
              <small>
                {mode === "weighted"
                  ? "Náhodné odpovědi podle četnosti"
                  : "Rovnoměrně náhodné odpovědi"}
              </small>
            </div>
            <span className="board-badge">
              {history.length} / {limit} půltahů
            </span>
          </div>
          <div
            className="board"
            aria-label={`Šachovnice, ${trainingColor === "white" ? "bílé" : "černé"} dole`}
            aria-busy={phase === "opponent"}
          >
            {ordered.map((piece, i) => {
              const f = trainingColor === "white" ? i % 8 : 7 - (i % 8);
              const r =
                trainingColor === "white"
                  ? 8 - Math.floor(i / 8)
                  : 1 + Math.floor(i / 8);
              const square = (String.fromCharCode(97 + f) + r) as Square;
              const last =
                latest && (latest.from === square || latest.to === square);
              return (
                <button
                  type="button"
                  key={square}
                  aria-label={`${square}${piece ? `, ${pieceLabel(piece.color, piece.type)}` : ""}`}
                  aria-pressed={selected === square}
                  onClick={() => clickSquare(square)}
                  className={`square ${(f + r) % 2 ? "light" : "dark"} ${last ? "last-move" : ""} ${selected === square ? "selected" : ""}`}
                  disabled={!book || busy || phase !== "player" || !!promotion}
                >
                  {piece && (
                    <span className={`piece ${piece.color}`}>
                      {symbols[piece.color + piece.type]}
                    </span>
                  )}
                  {destinations.has(square) && (
                    <span className={piece ? "capture-ring" : "move-dot"} />
                  )}{" "}
                  {i % 8 === 0 && <span className="rank-label">{r}</span>}
                  {i > 55 && (
                    <span className="file-label">
                      {String.fromCharCode(97 + f)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {promotion && (
            <div className="promotion" role="group" aria-label="Proměna pěšce">
              <span>Proměnit na:</span>
              {["q", "r", "b", "n"].map((piece) => (
                <Button
                  key={piece}
                  variant="outline"
                  onClick={() => {
                    submitMove(promotion.from + promotion.to + piece);
                    setPromotion(null);
                  }}
                >
                  {names[piece]}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setPromotion(null)}>
                Zrušit
              </Button>
            </div>
          )}
          <div className="player-strip">
            <span className="avatar self">{side === "w" ? "♔" : "♚"}</span>
            <div>
              <strong>
                {book ? `Ty jako ${book.name}` : "Ty"} ·{" "}
                {trainingColor === "white" ? "bílé" : "černé"}
              </strong>
              <small>
                {phase === "opponent"
                  ? "Soupeř vybírá odpověď…"
                  : phase === "player"
                    ? "Klikni na figuru a cílové pole"
                    : phase === "complete"
                      ? "Varianta dokončena"
                      : "Vyber hráče pro svůj repertoár"}
              </small>
            </div>
          </div>
          <div className="moves-panel">
            <span className="eyebrow">ODEHRANÉ TAHY</span>
            <div className="move-history">
              {!history.length ? (
                <p>Tady se objeví tvoje varianta.</p>
              ) : (
                Array.from(
                  { length: Math.ceil(history.length / 2) },
                  (_, i) => (
                    <span key={i}>
                      <small>{i + 1}.</small> <b>{history[i * 2]}</b>{" "}
                      {history[i * 2 + 1] || "…"}
                    </span>
                  ),
                )
              )}
            </div>
          </div>
        </section>
        <aside className="training panel">
          <p className="eyebrow">TRÉNINK</p>
          <h2>
            {phase === "complete"
              ? "Varianta dokončena."
              : phase === "opponent"
                ? "Soupeř je na tahu."
                : "Tvůj další tah."}
          </h2>
          <div
            className={`feedback ${feedback.kind}`}
            role="status"
            aria-live="polite"
          >
            {feedback.kind === "success" ? (
              <Check size={19} />
            ) : feedback.kind === "error" ? (
              <X size={19} />
            ) : (
              <BookOpen size={19} />
            )}
            <p>{feedback.text}</p>
          </div>
          {!book && (
            <div className="training-empty">
              <span>♘</span>
              <h3>Poznej jeho přemýšlení</h3>
              <p>
                Soupeřovy tahy se střídají. Ty si postupně osvojíš reakce
                vybraného hráče.
              </p>
            </div>
          )}
          {book && (
            <>
              <div className="round-progress">
                <span>Postup variantou</span>
                <strong>{Math.round((history.length / limit) * 100)} %</strong>
              </div>
              <Progress
                value={(history.length / limit) * 100}
                aria-label="Postup variantou"
              />
              <div className="stats">
                <div>
                  <strong>{stats.correct}</strong>
                  <span>Správných tahů</span>
                </div>
                <div>
                  <strong>{stats.mistakes}</strong>
                  <span>Mimo repertoár</span>
                </div>
                <div>
                  <strong>{stats.hints}</strong>
                  <span>Nápověd</span>
                </div>
              </div>
            </>
          )}
          <Button
            variant="outline"
            className="wide"
            disabled={busy || phase !== "player" || !book}
            onClick={() => {
              if (!hint) setStats((s) => ({ ...s, hints: s.hints + 1 }));
              setHint(true);
            }}
          >
            <Lightbulb size={17} />
            Nápověda
          </Button>
          {hint && (
            <div className="hint-list">
              <p>Hráč v této pozici používá:</p>
              {options.map((move) => (
                <div key={move.uci}>
                  <strong>{move.san}</strong>
                  <span>{move.count}×</span>
                </div>
              ))}
              <p className="note">
                Zahraj některý z těchto tahů na šachovnici.
              </p>
            </div>
          )}
          <Button
            variant={phase === "complete" ? "default" : "ghost"}
            className="wide"
            disabled={busy || !book}
            onClick={newRound}
          >
            <RefreshCw size={17} />
            Nová varianta
          </Button>
          {book && (
            <div className="opening-list">
              <p className="eyebrow">ZAHÁJENÍ HRÁČE</p>
              {openings.map(([name, count]) => (
                <div key={name}>
                  <span>{name}</span>
                  <strong>{Math.round((count / book.games) * 100)} %</strong>
                </div>
              ))}
            </div>
          )}
          <div className="repertoire-note">
            <strong>Repertoár ≠ nejlepší tah</strong>
            <p>
              Ověřujeme, co hráč skutečně hraje. Tah mimo vzorek nemusí být
              šachově špatný. Data se po zavření stránky neukládají.
            </p>
          </div>
        </aside>
      </div>
      <footer>
        Trénuj v klidu. Chyba je další příležitost si tah zapamatovat.
      </footer>
    </main>
  );
}
