let downloading = false;
let blockedUntil = 0;

const error = (message: string, status = 400) =>
  Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const username = params.get("username") || "";
  const color = params.get("color");
  const max = Number(params.get("max") || 300);
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username))
    return error("Zadej platný Lichess nickname (2–30 znaků).");
  if (color !== "white" && color !== "black")
    return error("Vyber barvu figur.");
  if (![100, 300, 1000].includes(max))
    return error("Neplatná velikost vzorku.");
  if (Date.now() < blockedUntil)
    return error("Lichess požádal o pauzu. Zkus načtení za jednu minutu.", 429);
  if (downloading)
    return error(
      "Probíhá jiné načítání partií. Počkej na jeho dokončení.",
      429,
    );
  downloading = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 85_000);
  const cleanup = () => {
    clearTimeout(timer);
    downloading = false;
    request.signal.removeEventListener("abort", abort);
  };
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    const url = new URL(
      `https://lichess.org/api/games/user/${encodeURIComponent(username)}`,
    );
    url.search = new URLSearchParams({
      color,
      max: String(max),
      perfType: "bullet,blitz,rapid,classical",
      opening: "true",
      moves: "true",
      ongoing: "false",
      finished: "true",
      sort: "dateDesc",
    }).toString();
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/x-ndjson",
        "User-Agent": "ChessbotOpeningStudio/1.0",
      },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      cleanup();
      if (upstream.status === 429) {
        blockedUntil = Date.now() + 60_000;
        return error(
          "Lichess omezuje požadavky. Zkus to znovu za jednu minutu.",
          429,
        );
      }
      if (upstream.status === 404)
        return error(
          "Hráč nebyl nalezen nebo Lichess dočasně nemůže exportovat jeho partie. Zkontroluj nickname.",
          404,
        );
      return error(
        "Lichess je momentálně nedostupný. Zkus to znovu za chvíli.",
        502,
      );
    }
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            cleanup();
            stream.close();
          } else stream.enqueue(value);
        } catch {
          cleanup();
          stream.enqueue(
            new TextEncoder().encode(
              '\n{"error":"Načítání partií bylo přerušeno. Zkus menší vzorek nebo opakuj načtení."}\n',
            ),
          );
          stream.close();
        }
      },
      async cancel() {
        controller.abort();
        cleanup();
        await reader.cancel().catch(() => {});
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    cleanup();
    return error(
      "Nepodařilo se spojit s Lichessem. Zkus to znovu za chvíli.",
      502,
    );
  }
}
