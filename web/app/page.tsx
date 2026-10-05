"use client";
import { useEffect, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import {
  Lightbulb,
  RefreshCw,
  Check,
  LoaderCircle,
  LogIn,
  LogOut,
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
  playUci,
  sampleMove,
  uci,
  type BookMove,
  type PlayerColor,
} from "@/lib/repertoire";
import {
  AuthenticationError,
  clearAuth,
  finishLogin,
  login,
  logout,
  type AuthSession,
} from "@/lib/lichess-auth";
import { ExplorerClient, type PositionData } from "@/lib/explorer";
import {
  chessFromMoves,
  judgeMove,
  movesOf,
  openingNotation,
  parseOpening,
  relevantMoves,
  type TrainingConfig,
  type TrainingStep,
} from "@/lib/training";

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
type Phase = "setup" | "loading" | "player" | "opponent" | "complete" | "error";
type Feedback = { kind: "neutral" | "success" | "error"; text: string };
type Round = {
  steps: TrainingStep[];
  cursor: number;
  replay: boolean;
  errors: string[];
};
const emptyRound = (): Round => ({
  steps: [],
  cursor: 0,
  replay: false,
  errors: [],
});
const DRAFT = "chessbot.training.draft.v2";
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
  const [authBusy, setAuthBusy] = useState(true);
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState("");
  const [username, setUsername] = useState("");
  const [color, setColor] = useState<PlayerColor>("white");
  const [depth, setDepth] = useState("8");
  const [mode, setMode] = useState("weighted");
  const [policy, setPolicy] = useState("repertoire");
  const [minimumShare, setMinimumShare] = useState("0");
  const [openingText, setOpeningText] = useState("");
  const [draftSeed, setDraftSeed] = useState<string[]>([]);
  const [session, setSession] = useState<TrainingConfig | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [data, setData] = useState<PositionData | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [loadMessage, setLoadMessage] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState(false);
  const [stats, setStats] = useState({
    correct: 0,
    mistakes: 0,
    hints: 0,
    alternatives: 0,
  });
  const [feedback, setFeedback] = useState<Feedback>({
    kind: "neutral",
    text: "Zadej úvodní tahy, přihlas se a spusť trénink.",
  });
  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState(chessRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const roundRef = useRef<Round>(emptyRound());
  const clientRef = useRef<ExplorerClient | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const initialization = useRef<Promise<AuthSession | null> | null>(null);
  const [generation, setGeneration] = useState(0);
  const trainingColor = session?.color || color;
  const side = trainingColor === "white" ? "w" : "b";
  const editing = phase === "setup";
  const seedLength = session?.seed.length || 0;
  const played = Math.max(0, history.length - seedLength);
  const limit =
    phase === "complete"
      ? played
      : roundRef.current.replay
        ? roundRef.current.steps.length
        : session?.plies || Number(depth) * 2;
  const accepted = data?.complete
    ? relevantMoves(data.moves, session?.minimumShare || 0)
    : data?.moves || [];
  const latest = chessRef.current.history({ verbose: true }).at(-1);
  function sync() {
    setFen(chessRef.current.fen());
    setHistory(chessRef.current.history());
    setSelected(null);
    setHint(false);
    setPromotion(null);
  }
  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT) || "null");
      if (draft) {
        if (typeof draft.name === "string") setUsername(draft.name);
        if (["white", "black"].includes(draft.color)) setColor(draft.color);
        if (["4", "8", "12", "16"].includes(draft.depth)) setDepth(draft.depth);
        if (["weighted", "uniform"].includes(draft.mode)) setMode(draft.mode);
        if (["repertoire", "line"].includes(draft.policy))
          setPolicy(draft.policy);
        if (["0", "0.05", "0.1"].includes(draft.minimumShare))
          setMinimumShare(draft.minimumShare);
        const chess = chessFromMoves(
          Array.isArray(draft.seed) ? draft.seed : [],
        );
        chessRef.current = chess;
        setDraftSeed(movesOf(chess));
        setOpeningText(
          typeof draft.text === "string" ? draft.text : openingNotation(chess),
        );
        sync();
      }
    } catch {
      try {
        sessionStorage.removeItem(DRAFT);
      } catch {}
    }
    let alive = true;
    initialization.current ||= finishLogin();
    initialization.current
      .then((value) => {
        if (alive) {
          setAuth(value);
          clientRef.current = value ? new ExplorerClient(value.token) : null;
        }
      })
      .catch((e) => {
        if (alive) {
          try {
            clearAuth();
          } catch {}
          setAuthError(
            e instanceof Error ? e.message : "Přihlášení se nezdařilo.",
          );
        }
      })
      .finally(() => {
        if (alive) {
          setReady(true);
          setAuthBusy(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(
        DRAFT,
        JSON.stringify({
          name: username,
          color,
          depth,
          mode,
          policy,
          minimumShare,
          seed: draftSeed,
          text: openingText,
        }),
      );
    } catch {}
  }, [
    ready,
    username,
    color,
    depth,
    mode,
    policy,
    minimumShare,
    draftSeed,
    openingText,
  ]);
  useEffect(() => {
    if (!auth) return;
    // Check periodically instead of overflowing the browser's maximum timer duration.
    const timer = setInterval(() => {
      if (Date.now() >= auth.expiresAt) {
        stopRequest();
        clearAuth();
        setAuth(null);
        clientRef.current = null;
        setAuthError("Přihlášení vypršelo. Přihlas se znovu.");
        if (session) setPhase("error");
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [auth, session]);
  function finish(reason: string) {
    setPhase("complete");
    setFeedback({ kind: "success", text: reason });
  }
  function stopRequest() {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
  }
  useEffect(() => {
    if (phase !== "loading" || !session || !auth || !clientRef.current) return;
    const round = roundRef.current;
    if (round.replay && round.cursor >= round.steps.length) {
      finish("Stejná větev je zopakovaná až do konce.");
      return;
    }
    if (played >= session.plies || chessRef.current.isGameOver()) {
      finish(
        chessRef.current.isGameOver()
          ? "Pozice ukončuje partii. Větev je dokončená."
          : "Dosáhl jsi zvolené hloubky pokračování.",
      );
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error("Indexování trvalo příliš dlouho. Obnov pozici za chvíli."),
        ),
      120_000,
    );
    let alive = true;
    const isCurrent = () =>
      alive &&
      controllerRef.current === controller &&
      chessRef.current.fen() === fen;
    setError("");
    setLoadMessage("Načítání aktuální pozice…");
    const saved = round.replay ? round.steps[round.cursor] : undefined;
    let frozenTarget: string | null | undefined;
    const receive = (position: PositionData) => {
      if (!isCurrent()) return;
      setData(position);
      if (!position.moves.length) {
        if (position.complete)
          finish(
            "Pro tuto pozici už hráč nemá doložené pokračování. Tady větev končí.",
          );
        return;
      }
      if (frozenTarget === undefined) {
        const choices = relevantMoves(position.moves, session.minimumShare);
        frozenTarget =
          saved?.chosen.uci ||
          (session.policy === "line" ? choices[0]?.uci || null : null);
        setTarget(frozenTarget);
        setPhase(
          chessRef.current.turn() === (session.color === "white" ? "w" : "b")
            ? "player"
            : "opponent",
        );
      }
      if (position.complete)
        setFeedback((previous) =>
          previous.text.startsWith("Data se ještě doplňují")
            ? {
                kind: "neutral",
                text: "Indexování je dokončené. Zkus svou odpověď znovu nebo použij nápovědu.",
              }
            : previous,
        );
    };
    const fetchData = saved
      ? Promise.resolve({
          moves: saved.options,
          total: saved.total,
          opening: saved.opening,
          complete: true,
        })
      : clientRef.current.position(
          session.name,
          session.color,
          chessRef.current,
          controller.signal,
          (message) => {
            if (isCurrent()) setLoadMessage(message);
          },
          receive,
        );
    fetchData
      .then(receive)
      .catch((e) => {
        if (!isCurrent()) return;
        if (e instanceof AuthenticationError) {
          clearAuth();
          setAuth(null);
          clientRef.current = null;
          setAuthError(e.message);
        }
        setError(
          controller.signal.aborted
            ? controller.signal.reason instanceof Error
              ? controller.signal.reason.message
              : "Načítání bylo zrušeno. Můžeš obnovit stejnou pozici."
            : e instanceof Error
              ? e.message
              : "Pozici se nepodařilo načíst.",
        );
        setPhase("error");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
    // Switching from loading to a playable phase must keep the same stream alive.
    // A new FEN/session or explicit retry starts a new request instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, session, auth, generation]);
  function commit(move: BookMove) {
    if (!data || !session) return;
    stopRequest();
    if (!roundRef.current.replay)
      roundRef.current.steps.push({
        fen,
        options: data.moves,
        chosen: move,
        total: data.total,
        opening: data.opening,
      });
    roundRef.current.cursor++;
    playUci(chessRef.current, move.uci);
    sync();
    setData(null);
    setTarget(null);
    setPhase("loading");
  }
  useEffect(() => {
    if (phase !== "opponent" || !session || !data) return;
    const timer = setTimeout(() => {
      const saved = roundRef.current.replay
        ? roundRef.current.steps[roundRef.current.cursor]
        : undefined;
      const move = saved
        ? saved.chosen
        : sampleMove(data.moves, session.uniform);
      if (!move) {
        finish("V této pozici už není další odpověď.");
        return;
      }
      commit(move);
      setFeedback({
        kind: "neutral",
        text: `Soupeř zahrál ${move.san}. Jak odpoví ${session.name}?`,
      });
    }, 550);
    return () => clearTimeout(timer);
    // Keep the opponent's delay anchored to the first usable snapshot, not
    // restarted by every background indexing update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fen, session]);
  function setDraft(chess: Chess) {
    chessRef.current = chess;
    setDraftSeed(movesOf(chess));
    setOpeningText(openingNotation(chess));
    setError("");
    sync();
  }
  function applyOpening() {
    try {
      setDraft(parseOpening(openingText));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function editOpening() {
    stopRequest();
    setSession(null);
    roundRef.current = emptyRound();
    setData(null);
    setTarget(null);
    setPhase("setup");
    setError("");
    chessRef.current = chessFromMoves(draftSeed);
    sync();
    setFeedback({
      kind: "neutral",
      text: "Zadej tahy obou stran a potvrď začátek tréninku.",
    });
  }
  function start() {
    if (!auth || !clientRef.current || auth.expiresAt <= Date.now()) {
      setAuthError("Nejdřív se přihlas přes Lichess.");
      return;
    }
    const name = username.trim();
    if (!/^[a-zA-Z0-9_-]{2,30}$/.test(name)) {
      setError("Zadej platný Lichess nickname (2–30 znaků).");
      return;
    }
    try {
      const chess = parseOpening(openingText);
      setDraft(chess);
      roundRef.current = emptyRound();
      setSession({
        name,
        color,
        seed: movesOf(chess),
        plies: Number(depth) * 2,
        policy: policy as TrainingConfig["policy"],
        minimumShare: Number(minimumShare),
        uniform: mode === "uniform",
      });
      setStats({ correct: 0, mistakes: 0, hints: 0, alternatives: 0 });
      setError("");
      setPhase("loading");
      setFeedback({
        kind: "neutral",
        text: "Trénink pokračuje z tvého úvodu. Soupeř vybírá jen doložené tahy.",
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function restart(replay: boolean) {
    if (!session || (replay && !roundRef.current.steps.length)) return;
    stopRequest();
    roundRef.current = replay
      ? { ...roundRef.current, cursor: 0, replay: true, errors: [] }
      : emptyRound();
    chessRef.current = chessFromMoves(session.seed);
    sync();
    setData(null);
    setError("");
    setStats({ correct: 0, mistakes: 0, hints: 0, alternatives: 0 });
    setGeneration((n) => n + 1);
    setPhase("loading");
    setFeedback({
      kind: "neutral",
      text: replay
        ? "Opakuješ stejnou větev z téhož úvodu. Očekáváme zaznamenané tahy."
        : "Nové náhodné pokračování z téhož úvodu.",
    });
  }
  function submitMove(text: string) {
    if (phase !== "player" || !session || !data)
      return { accepted: false, error: "Teď není tvůj tah." };
    let move;
    try {
      move = playUci(new Chess(fen), text);
    } catch {
      setFeedback({ kind: "error", text: "Tento tah není legální." });
      setSelected(null);
      return { accepted: false, error: "Nelegální tah." };
    }
    const verdict = judgeMove(uci(move), data.moves, accepted, target);
    if (verdict !== "correct" && roundRef.current.replay) {
      setStats((s) => ({ ...s, alternatives: s.alternatives + 1 }));
      setFeedback({
        kind: "neutral",
        text: `${move.san} není tah zaznamenané větve. Nehodnotíme jej jako šachovou chybu; zkus cílový tah nebo nápovědu.`,
      });
      setSelected(null);
      return { accepted: false, error: "alternative" };
    }
    if (verdict === "unknown" && !data.complete) {
      setFeedback({
        kind: "neutral",
        text: `Data se ještě doplňují. Tah ${move.san} zatím není doložený, proto jej nepočítáme jako chybu. Zkus jej později nebo zahraj známou odpověď.`,
      });
      setSelected(null);
      return { accepted: false, error: "pending" };
    }
    if (verdict !== "correct") {
      if (verdict === "alternative" || verdict === "rare") {
        setStats((s) => ({ ...s, alternatives: s.alternatives + 1 }));
        setFeedback({
          kind: "neutral",
          text:
            verdict === "alternative"
              ? `${move.san} je platná alternativa v repertoáru, ale ne tah této konkrétní větve. Zkus cílový tah nebo nápovědu.`
              : `${move.san} je doložený, ale pod zvoleným prahem četnosti. Není to šachová chyba; procvičujeme běžnější odpovědi.`,
        });
      } else {
        setStats((s) => ({ ...s, mistakes: s.mistakes + 1 }));
        roundRef.current.errors.push(
          `${chessRef.current.history().length + 1}. půltah: ${move.san}`,
        );
        setFeedback({
          kind: "error",
          text: `${move.san} v datech této pozice není. Nemusí být šachově špatný; zkus doloženou odpověď.`,
        });
      }
      setSelected(null);
      return { accepted: false, error: verdict };
    }
    const known = data.moves.find((m) => m.uci === uci(move))!;
    setStats((s) => ({ ...s, correct: s.correct + 1 }));
    setFeedback({
      kind: "success",
      text: `Správně, ${known.san}! Doloženo ${known.count}× v této pozici.`,
    });
    commit(known);
    return { accepted: true, move: known.san };
  }
  function boardMove(text: string) {
    if (!editing) return submitMove(text);
    try {
      playUci(chessRef.current, text);
      setDraft(chessRef.current);
    } catch {
      setFeedback({ kind: "error", text: "Tento tah není legální." });
      setSelected(null);
    }
  }
  function clickSquare(square: Square) {
    if ((!editing && phase !== "player") || promotion) return;
    const chess = chessRef.current;
    const piece = chess.get(square);
    if (selected === square) {
      setSelected(null);
      return;
    }
    if (piece?.color === (editing ? chess.turn() : side)) {
      setSelected(square);
      return;
    }
    if (!selected) return;
    if (
      chess
        .moves({ square: selected, verbose: true })
        .some((move) => move.to === square && move.promotion)
    ) {
      setPromotion({ from: selected, to: square });
      return;
    }
    boardMove(selected + square);
  }
  async function signIn() {
    setAuthError("");
    setAuthBusy(true);
    try {
      await login();
    } catch {
      setAuthBusy(false);
      setAuthError(
        "Přihlášení nelze spustit. Povol úložiště stránky a použij HTTPS nebo localhost.",
      );
    }
  }
  async function signOut() {
    if (!auth) return;
    const previous = auth;
    stopRequest();
    setAuth(null);
    clientRef.current?.clear();
    clientRef.current = null;
    editOpening();
    setAuthBusy(true);
    const revoked = await logout(previous);
    setAuthBusy(false);
    setAuthError(
      revoked
        ? ""
        : "V aplikaci jsi odhlášený. Odvolání tokenu na Lichessu se nepodařilo; odeber jej v nastavení Lichessu → propojené aplikace.",
    );
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
    name: session?.name || null,
    color: trainingColor,
  });
  stateRef.current = {
    phase,
    fen,
    name: session?.name || null,
    color: trainingColor,
  };
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "get_training_position",
      description:
        "Read the training position without exposing authentication.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => stateRef.current,
    });
    register({
      name: "play_training_move",
      description:
        "Submit a UCI training answer. Wrong answers leave the position unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          move: { type: "string", pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$" },
        },
        required: ["move"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
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
        <p>Vyber úvod. Nauč se celou větev. Zopakuj ji.</p>
      </div>
      <div className="auth-panel panel">
        <div>
          <strong>
            {auth
              ? `Přihlášen jako ${auth.username}`
              : "Připoj svůj Lichess účet"}
          </strong>
          <p>
            Jen čtení veřejného repertoáru. Heslo zadáváš pouze na Lichessu;
            aplikace nežádá oprávnění měnit účet ani hrát partie.
          </p>
        </div>
        <Button
          variant={auth ? "outline" : "default"}
          disabled={authBusy}
          onClick={() => void (auth ? signOut() : signIn())}
        >
          {authBusy ? (
            <LoaderCircle className="spin" size={17} />
          ) : auth ? (
            <LogOut size={17} />
          ) : (
            <LogIn size={17} />
          )}
          {auth ? "Odhlásit" : "Přihlásit přes Lichess"}
        </Button>
        {authError && (
          <p className="load-error" role="alert">
            {authError}
          </p>
        )}
      </div>
      <div className="studio">
        <aside className="setup panel">
          <h2>Vyber hráče a úvod</h2>
          <label htmlFor="nickname">Lichess nickname kopírovaného hráče</label>
          <Input
            id="nickname"
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            placeholder="např. DrNykterstein"
            value={username}
            disabled={!editing}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="color">Trénovat za</label>
          <Choice
            id="color"
            value={color}
            onChange={(v) => setColor(v as PlayerColor)}
            disabled={!editing}
            options={[
              ["white", "Bílé figury"],
              ["black", "Černé figury"],
            ]}
          />
          <label htmlFor="opening">Úvodní tahy (SAN nebo UCI)</label>
          <textarea
            id="opening"
            className="opening-input"
            value={openingText}
            onChange={(e) => setOpeningText(e.target.value)}
            disabled={!editing}
            placeholder="1. e4 e5 2. Nf3 Nc6 3. Bc4"
            rows={3}
            spellCheck={false}
          />
          <p className="note">
            Zadej tahy obou stran zápisem nebo klikáním na šachovnici. Prázdný
            úvod začíná ze základní pozice.
          </p>
          {editing ? (
            <>
              <div className="setup-actions">
                <Button variant="outline" onClick={applyOpening}>
                  Zobrazit úvod
                </Button>
                <Button
                  variant="ghost"
                  disabled={!draftSeed.length}
                  onClick={() => {
                    chessRef.current.undo();
                    setDraft(chessRef.current);
                  }}
                >
                  Zpět
                </Button>
                <Button variant="ghost" onClick={() => setDraft(new Chess())}>
                  Vymazat
                </Button>
              </div>
              <label htmlFor="policy">Režim odpovědí</label>
              <Choice
                id="policy"
                value={policy}
                onChange={setPolicy}
                options={[
                  ["repertoire", "Repertoár · více správných odpovědí"],
                  ["line", "Konkrétní varianta · hlavní tah"],
                ]}
              />
              <p className="note">
                {policy === "line"
                  ? "Očekáváme nejčastější tah z prvních dostupných dat; cíl v téže pozici zůstává stejný. Soupeřova větev se losuje; po dokončení ji můžeš přesně zopakovat."
                  : "Správná je každá doložená odpověď nad zvoleným prahem četnosti."}
              </p>
              <label htmlFor="threshold">Minimální četnost odpovědi</label>
              <Choice
                id="threshold"
                value={minimumShare}
                onChange={setMinimumShare}
                options={[
                  ["0", "Všechny doložené tahy"],
                  ["0.05", "Alespoň 5 %"],
                  ["0.1", "Alespoň 10 %"],
                ]}
              />
              <label htmlFor="depth">Délka pokračování za úvodem</label>
              <Choice
                id="depth"
                value={depth}
                onChange={setDepth}
                options={[
                  ["4", "4 úplné tahy"],
                  ["8", "8 úplných tahů"],
                  ["12", "12 úplných tahů"],
                  ["16", "16 úplných tahů"],
                ]}
              />
              <label htmlFor="mode">Soupeřovy odpovědi</label>
              <Choice
                id="mode"
                value={mode}
                onChange={setMode}
                options={[
                  ["weighted", "Náhodně podle četnosti"],
                  ["uniform", "Každá odpověď stejně často"],
                ]}
              />
              <Button
                className="primary-action"
                disabled={!auth || authBusy || !username.trim()}
                onClick={start}
              >
                Spustit trénink
              </Button>
            </>
          ) : (
            <>
              <div className="loaded-info">
                <Check size={16} />
                <span>
                  <strong>{session?.name}</strong> ·{" "}
                  {trainingColor === "white" ? "bílé" : "černé"}
                  <small>
                    {roundRef.current.replay
                      ? "Opakování zaznamenané větve"
                      : session?.policy === "line"
                        ? "Konkrétní varianta"
                        : "Repertoár"}{" "}
                    · úvod {seedLength} půltahů
                  </small>
                </span>
              </div>
              <Button variant="outline" className="wide" onClick={editOpening}>
                Upravit úvod a nastavení
              </Button>
            </>
          )}
          <p className="note">
            Data se načítají pro aktuální pozici, ne jako balík partií. Bullet,
            blitz, rapid a classical. Indexace může chvíli trvat.
          </p>
          {error && (
            <p className="load-error" role="alert">
              {error}
            </p>
          )}
        </aside>
        <section className="board-area">
          <div className="player-strip">
            <span className="avatar">♟</span>
            <div>
              <strong>{editing ? "Zadání úvodní varianty" : "Soupeř"}</strong>
              <small>
                {editing
                  ? `Na tahu ${chessRef.current.turn() === "w" ? "bílé" : "černé"}`
                  : roundRef.current.replay
                    ? "Stejné tahy jako v předchozí větvi"
                    : "Náhodné doložené odpovědi"}
              </small>
            </div>
            <span className="board-badge">
              {editing
                ? `${history.length} půltahů úvodu`
                : `${played} / ${limit} půltahů`}
            </span>
          </div>
          <div
            className="board"
            aria-label={`Šachovnice, ${trainingColor === "white" ? "bílé" : "černé"} dole`}
            aria-busy={phase === "loading" || phase === "opponent"}
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
                  disabled={(!editing && phase !== "player") || !!promotion}
                >
                  {piece && (
                    <span className={`piece ${piece.color}`}>
                      {symbols[piece.color + piece.type]}
                    </span>
                  )}
                  {destinations.has(square) && (
                    <span className={piece ? "capture-ring" : "move-dot"} />
                  )}
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
                    boardMove(promotion.from + promotion.to + piece);
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
            <span className="avatar self">♔</span>
            <div>
              <strong>
                {session ? `Ty jako ${session.name}` : "Tvůj úvod"} ·{" "}
                {trainingColor === "white" ? "bílé" : "černé"}
              </strong>
              <small>
                {editing
                  ? "Hraj za obě strany, pak spusť trénink"
                  : phase === "loading"
                    ? "Načítání pozice…"
                    : phase === "opponent"
                      ? "Soupeř vybírá odpověď…"
                      : phase === "player"
                        ? "Klikni na figuru a cílové pole"
                        : phase === "error"
                          ? "Trénink je pozastavený, pozice zachována"
                          : "Varianta dokončena"}
              </small>
            </div>
          </div>
          <div className="moves-panel">
            <span className="eyebrow">CELÁ VĚTEV · ÚVOD + POKRAČOVÁNÍ</span>
            <div className="move-history">
              {!history.length ? (
                <p>Tady se objeví tvoje varianta.</p>
              ) : (
                Array.from(
                  { length: Math.ceil(history.length / 2) },
                  (_, i) => (
                    <span key={i}>
                      <small>{i + 1}.</small>{" "}
                      <b className={i * 2 < seedLength ? "seed-move" : ""}>
                        {history[i * 2]}
                      </b>{" "}
                      <b className={i * 2 + 1 < seedLength ? "seed-move" : ""}>
                        {history[i * 2 + 1] || "…"}
                      </b>
                    </span>
                  ),
                )
              )}
            </div>
            {session && (
              <p className="note">
                Zvýrazněný úvod se přehrává automaticky; hodnotí se až tvoje
                pokračování.
              </p>
            )}
          </div>
        </section>
        <aside className="training panel">
          <p className="eyebrow">TRÉNINK</p>
          <h2>
            {editing
              ? "Nejdřív vyber úvod."
              : phase === "complete"
                ? "Varianta dokončena."
                : phase === "loading"
                  ? "Načítání pozice…"
                  : phase === "opponent"
                    ? "Soupeř je na tahu."
                    : phase === "error"
                      ? "Trénink pozastaven."
                      : "Tvůj další tah."}
          </h2>
          <div
            className={`feedback ${feedback.kind}`}
            role="status"
            aria-live="polite"
          >
            <p>{feedback.text}</p>
          </div>
          {(phase === "loading" ||
            ((phase === "player" || phase === "opponent") &&
              data &&
              !data.complete)) && (
            <div className="loading-info" role="status">
              <p>
                <LoaderCircle className="spin inline-icon" size={16} />
                {loadMessage}
              </p>
              <Button
                variant="ghost"
                className="wide"
                onClick={() =>
                  controllerRef.current?.abort(
                    new Error(
                      "Načítání bylo zrušeno. Obnov stejnou pozici nebo uprav úvod.",
                    ),
                  )
                }
              >
                Zrušit načítání
              </Button>
            </div>
          )}
          {phase === "error" && (
            <Button
              className="wide"
              disabled={!auth}
              onClick={() => {
                setGeneration((n) => n + 1);
                setPhase("loading");
              }}
            >
              Obnovit pozici
            </Button>
          )}
          {session && (
            <>
              <div className="round-progress">
                <span>Pokračování za úvodem</span>
                <strong>
                  {Math.min(
                    100,
                    Math.round((played / Math.max(1, limit)) * 100),
                  )}{" "}
                  %
                </strong>
              </div>
              <Progress
                value={Math.min(100, (played / Math.max(1, limit)) * 100)}
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
              <p className="note">
                Platné alternativy mimo cíl: {stats.alternatives} (nepočítají se
                jako chyby).
              </p>
            </>
          )}
          <Button
            variant="outline"
            className="wide"
            disabled={phase !== "player"}
            onClick={() => {
              if (!hint) setStats((s) => ({ ...s, hints: s.hints + 1 }));
              setHint(true);
            }}
          >
            <Lightbulb size={17} />
            Nápověda
          </Button>
          {hint && data && (
            <div className="hint-list">
              <p>
                {target
                  ? "Cílový tah této větve a doložené alternativy:"
                  : "Hráč v této pozici používá:"}
              </p>
              {data.moves.map((move) => (
                <div key={move.uci}>
                  <strong>
                    {move.san}
                    {target === move.uci ? " · cíl" : ""}
                  </strong>
                  <span>
                    {move.count}× ·{" "}
                    {Math.round(
                      (move.count /
                        data.moves.reduce((n, m) => n + m.count, 0)) *
                        100,
                    )}{" "}
                    %
                    {!accepted.some((m) => m.uci === move.uci)
                      ? " · vzácný"
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {session && (
            <>
              <Button
                variant="outline"
                className="wide"
                disabled={
                  phase !== "complete" ||
                  !roundRef.current.steps.length ||
                  !auth
                }
                onClick={() => restart(true)}
              >
                <RefreshCw size={17} />
                Zopakovat stejnou variantu
              </Button>
              <Button
                variant="ghost"
                className="wide"
                disabled={phase === "loading" || !auth}
                onClick={() => restart(false)}
              >
                Jiné pokračování ze stejného úvodu
              </Button>
            </>
          )}
          {phase === "complete" && (
            <div className="round-summary">
              <h3>Shrnutí celé větve</h3>
              <p>
                {stats.correct} správných odpovědí · {stats.mistakes} mimo
                repertoár · {stats.hints} nápověd
              </p>
              <p>
                Úvod: {seedLength} půltahů · procvičeno: {played} půltahů.
              </p>
              {roundRef.current.errors.length > 0 && (
                <>
                  <strong>K opakování</strong>
                  <ul>
                    {roundRef.current.errors.map((move, i) => (
                      <li key={i}>{move}</li>
                    ))}
                  </ul>
                </>
              )}
              <p>
                Celou posloupnost najdeš pod šachovnicí. Opakování zachová i
                všechny tahy soupeře.
              </p>
            </div>
          )}
          {data && (
            <div className="opening-list">
              <p className="eyebrow">AKTUÁLNÍ POZICE</p>
              <p>{data.opening || "Bez rozpoznaného názvu zahájení"}</p>
              <p className="note">
                {data.total} partií hráče v této pozici. Četnost odpovědí není
                hodnocení enginem.
              </p>
              {!data.complete && (
                <p className="note">
                  Průběžná data: doložené tahy můžeš hrát bez čekání na
                  dokončení. Během indexace přijímáme všechny doložené tahy;
                  neznámé zatím nepočítáme jako chyby. Cíl konkrétní varianty
                  zůstává podle prvních dostupných dat.
                </p>
              )}
            </div>
          )}
          <div className="repertoire-note">
            <strong>Repertoár ≠ nejlepší tah</strong>
            <p>
              Ověřujeme, co hráč skutečně hraje. Tah mimo data nemusí být
              šachově špatný. Cache a větev jsou jen v paměti; přihlášení a
              rozpracovaný úvod pouze v úložišti této karty.
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
