"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  EngineClient,
  formatEvaluation,
  principalVariation,
  whiteShare,
  type EngineStatus,
  type Evaluation,
} from "../lib/engine.ts";

const PREFERENCE = "chessbot.engine.enabled.v1";
const ASSETS = "engine/stockfish-19/";
export function EnginePanel({ fen, reveal }: { fen: string; reveal: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    fen: string;
    status: EngineStatus;
    value?: Evaluation;
  } | null>(null);
  const clientRef = useRef<EngineClient | null>(null);
  useEffect(() => {
    try {
      setEnabled(sessionStorage.getItem(PREFERENCE) === "true");
    } catch {}
    return () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    if (!enabled) {
      clientRef.current?.dispose();
      clientRef.current = null;
      setSnapshot(null);
      return;
    }
    setSnapshot({ fen, status: "loading" });
    try {
      clientRef.current ||= new EngineClient(
        () =>
          new Worker(
            new URL(ASSETS + "stockfish-19-lite-single.js", document.baseURI),
          ),
      );
      clientRef.current.analyze(
        fen,
        (value) => {
          if (alive)
            setSnapshot((s) => ({
              fen,
              status: s?.fen === fen ? s.status : "searching",
              value,
            }));
        },
        (status) => {
          if (alive)
            setSnapshot((s) => ({
              fen,
              status,
              value: s?.fen === fen ? s.value : undefined,
            }));
        },
      );
    } catch {
      clientRef.current?.dispose();
      clientRef.current = null;
      setSnapshot({ fen, status: "error" });
    }
    return () => {
      alive = false;
      clientRef.current?.cancel();
    };
  }, [fen, enabled, retry]);
  const current = snapshot?.fen === fen ? snapshot : null;
  const evaluation = enabled ? current?.value : undefined;
  const value = evaluation ? formatEvaluation(evaluation.score) : "—";
  const pv = evaluation && reveal ? principalVariation(fen, evaluation.pv) : "";
  return (
    <section
      className="engine-panel"
      aria-label="Hodnocení pozice enginem"
      data-fen={fen}
    >
      <div className="engine-heading">
        <div>
          <span className="eyebrow">HODNOCENÍ POZICE</span>
          <strong
            className="engine-score"
            aria-label={`Hodnocení z pohledu bílého: ${value}`}
          >
            {value}
          </strong>
        </div>
        <Button
          variant="outline"
          role="switch"
          aria-label="Engine"
          aria-checked={enabled}
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            try {
              sessionStorage.setItem(PREFERENCE, String(next));
            } catch {}
          }}
        >
          {enabled ? "Vypnout engine" : "Zapnout engine"}
        </Button>
      </div>
      <div
        className="evaluation-bar"
        role="img"
        aria-label={
          evaluation
            ? `Výhoda z pohledu bílého: ${value}. Lišta není pravděpodobnost výhry.`
            : "Hodnocení zatím není dostupné"
        }
      >
        <span
          style={{
            width: `${evaluation ? whiteShare(evaluation.score) : 50}%`,
          }}
        />
      </div>
      <p className="engine-status" role="status">
        {!enabled
          ? "Zapni lokální výpočet. Trénink na něj nečeká."
          : current?.status === "error"
            ? "Engine není dostupný. Trénink může pokračovat."
            : current?.status === "loading" || !current
              ? "Načítám Stockfish…"
              : `${evaluation ? `Hloubka ${evaluation.depth} · ` : ""}${current.status === "done" ? "výpočet dokončen" : "počítám…"}`}
      </p>
      {enabled && current?.status === "error" && (
        <Button
          variant="outline"
          onClick={() => {
            clientRef.current?.dispose();
            clientRef.current = null;
            setRetry((n) => n + 1);
          }}
        >
          Zkusit engine znovu
        </Button>
      )}
      {pv && (
        <div className="engine-pv">
          <strong>Doporučení enginu (ne repertoáru)</strong>
          <p>{pv}</p>
        </div>
      )}
      <p className="note engine-note">
        + pro bílé, − pro černé; M značí mat. Průběžný odhad neovlivňuje
        uznávání tahů.
      </p>
      <details className="engine-about">
        <summary>Stockfish 19 Lite · běží na tvém zařízení</summary>
        <p>
          Jedno vlákno, nejvýše 1,5 s výpočtu na pozici. Lehčí NNUE síť; nejde o
          plnou serverovou analýzu. Engine se stáhne až po zapnutí. Pro samotný
          výpočet se pozice neposílá na analytický server.
        </p>
        <p>
          Stockfish.js © 2026 Chess.com, LLC a přispěvatelé Stockfish.{" "}
          <a href={ASSETS + "Copying.txt"}>GPLv3</a> ·{" "}
          <a href={ASSETS + "stockfish.js-v19.0.0-source.zip"}>
            Zdrojový kód a build skripty
          </a>{" "}
          · <a href={ASSETS + "nn-61e7af4bb97d.nnue"}>NNUE síť</a> ·{" "}
          <a href={ASSETS + "SOURCE.md"}>Původ a sestavení</a>
        </p>
      </details>
    </section>
  );
}
