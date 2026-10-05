"use client";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
} from "react";
import type { Square, Piece } from "chess.js";

type Options = {
  position: string;
  piece: (square: Square) => Piece | undefined;
  drop: (from: Square, to: Square) => void;
  select: (square: Square | null) => void;
};
type Gesture = {
  id: number;
  from: Square;
  position: string;
  source: HTMLElement;
  startX: number;
  startY: number;
  active: boolean;
  piece: Piece;
  size: number;
};
type Visual = {
  from: Square;
  over: Square | null;
  x: number;
  y: number;
  size: number;
  piece: Piece;
};

export function usePieceDrag(options: Options) {
  const current = useRef(options);
  current.current = options;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<Visual | null>(null);
  function release(g: Gesture) {
    if (g.source.hasPointerCapture(g.id)) g.source.releasePointerCapture(g.id);
  }
  function cancel() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    release(g);
    if (g.active) {
      suppressClick.current = true;
      setDrag(null);
      current.current.select(null);
    }
  }
  function destination(x: number, y: number): Square | null {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-square]");
    return element && boardRef.current?.contains(element)
      ? (element.dataset.square as Square)
      : null;
  }
  function valid(g: Gesture) {
    return (
      g.position === current.current.position && !!current.current.piece(g.from)
    );
  }
  useEffect(() => {
    // A new board/turn/orientation invalidates even a drag with the same FEN.
    cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.position]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hidden);
    };
    // Callbacks read current options, not a stale board closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    boardRef,
    drag,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!event.isPrimary || event.button !== 0 || gesture.current) return;
        suppressClick.current = false;
        const source = (event.target as Element).closest<HTMLElement>(
          "[data-square]",
        );
        const from = source?.dataset.square as Square | undefined;
        const piece = from && current.current.piece(from);
        if (!source || !from || !piece) return;
        gesture.current = {
          id: event.pointerId,
          from,
          position: current.current.position,
          source,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
          piece,
          size: parseFloat(
            getComputedStyle(source.querySelector(".piece")!).fontSize,
          ),
        };
        // Capture on the source button: simple taps/clicks still target that button.
        source.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        if (!valid(g)) {
          cancel();
          return;
        }
        if (
          !g.active &&
          Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 6
        )
          return;
        event.preventDefault();
        if (!g.active) {
          g.active = true;
          current.current.select(g.from);
        }
        setDrag({
          from: g.from,
          piece: g.piece,
          size: g.size,
          x: event.clientX,
          y: event.clientY,
          over: destination(event.clientX, event.clientY),
        });
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.id !== event.pointerId) return;
        const usable = valid(g);
        gesture.current = null;
        release(g);
        if (!g.active) return;
        event.preventDefault();
        suppressClick.current = true;
        setDrag(null);
        current.current.select(null);
        const to = destination(event.clientX, event.clientY);
        if (usable && to && to !== g.from) current.current.drop(g.from, to);
      },
      onPointerCancel(event: PointerEvent<HTMLDivElement>) {
        if (gesture.current?.id === event.pointerId) cancel();
      },
      onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
        if (gesture.current?.id === event.pointerId) cancel();
      },
      onClickCapture(event: MouseEvent<HTMLDivElement>) {
        // A drop must not also execute the browser's synthetic click.
        // Keyboard/assistive clicks (detail=0) remain fully functional.
        if (suppressClick.current && event.detail > 0) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onDragStart(event: MouseEvent<HTMLDivElement>) {
        event.preventDefault();
      },
    },
  };
}
