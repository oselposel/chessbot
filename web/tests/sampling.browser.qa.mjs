// Independent frequency draws across restarts, using isolated fake auth/data.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const origin = (
  process.env.APP_ORIGIN || "http://127.0.0.1:5174/chessbot"
).replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  for (const { color, progressive } of [
    { color: "white", progressive: false },
    { color: "black", progressive: false },
    { color: "white", progressive: true },
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ color, progressive }) => {
        sessionStorage.setItem(
          "chessbot.lichess.session.v1",
          JSON.stringify({
            token: "fake-sampling-qa",
            username: "QA",
            expiresAt: Date.now() + 3600_000,
          }),
        );
        sessionStorage.setItem(
          "chessbot.training.draft.v2",
          JSON.stringify({
            name: "SamplingPlayer",
            color,
            mode: "uniform",
            text: color === "white" ? "e4" : "",
            seed: color === "white" ? ["e2e4"] : [],
          }),
        );
        window.samplingQA = { draw: 0.6, calls: 0 };
        Math.random = () => {
          window.samplingQA.calls++;
          return window.samplingQA.draw;
        };
        const nativeFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
          if (!String(url).startsWith("https://explorer.lichess.org/player?"))
            return nativeFetch(url, options);
          const fen = new URL(url).searchParams.get("fen");
          const initial =
            color === "black"
              ? fen.endsWith("0 1") && fen.includes(" w ")
              : fen.endsWith("0 1") && fen.includes(" b ");
          const moves = initial
            ? color === "white"
              ? [
                  ["e7e5", 70],
                  ["c7c5", 30],
                ]
              : [
                  ["e2e4", 70],
                  ["d2d4", 30],
                ]
            : [[fen.includes(" w ") ? "g1f3" : "g8f6", 100]];
          const row = {
            white: 100,
            draws: 0,
            black: 0,
            queuePosition: 0,
            moves: moves.map(([uci, count]) => ({
              uci,
              san: "ignored",
              white: count,
              draws: 0,
              black: 0,
            })),
          };
          if (initial && progressive) {
            const encode = (row) =>
              new TextEncoder().encode(JSON.stringify(row) + "\n");
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    encode({
                      ...row,
                      queuePosition: 5,
                      moves: row.moves.map((move) => ({
                        ...move,
                        white: 100 - move.white,
                      })),
                    }),
                  );
                  const timer = setTimeout(() => {
                    controller.enqueue(encode(row));
                    controller.close();
                  }, 100);
                  options.signal.addEventListener(
                    "abort",
                    () => {
                      clearTimeout(timer);
                      controller.error(options.signal.reason);
                    },
                    { once: true },
                  );
                },
              }),
            );
          }
          return new Response(JSON.stringify(row) + "\n");
        };
      },
      { color, progressive },
    );
    await page.goto(origin + "/");
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.ready === "true",
    );
    assert.equal(
      await page.locator("#mode").count(),
      0,
      "legacy uniform settings cannot control sampling",
    );
    await page
      .getByRole("button", { name: "Spustit trénink", exact: true })
      .click();
    const player = () =>
      page
        .getByText("Klikni na figuru a cílové pole", { exact: true })
        .waitFor();
    const history = () => page.locator(".move-history").innerText();
    await player();
    const first = await history();
    assert.match(
      first,
      color === "white" ? /e5/ : /e4/,
      "0.6 must use the latest 70% move, not a uniform draw or stale first snapshot",
    );
    assert.match(
      await page.locator(".feedback").innerText(),
      /70 %/,
      "feedback uses the same newest snapshot as sampling",
    );
    const restart = async (draw) => {
      await page.evaluate((draw) => {
        window.samplingQA.draw = draw;
      }, draw);
      await page
        .getByRole("button", {
          name: "Nový průchod ze stejného úvodu",
          exact: true,
        })
        .click();
      await player();
      return history();
    };
    assert.equal(
      await restart(0.6),
      first,
      "a fresh draw may repeat exactly the same first move",
    );
    assert.equal(
      await restart(0.69999),
      first,
      "the leading move keeps its full 70% range after repetition",
    );
    const second = await restart(0.7);
    assert.notEqual(second, first);
    assert.match(
      second,
      color === "white" ? /c5/ : /d4/,
      "the less common branch remains available at the exact boundary",
    );
    assert.equal(
      await restart(0.99),
      second,
      "even the less common move can repeat without exclusion",
    );
    assert.equal(
      await restart(0),
      first,
      "no quota, cycling or previous-choice bias",
    );
    const beforeReplay = await page.evaluate(() => window.samplingQA.calls);
    await page.evaluate(() => {
      window.samplingQA.draw = 0.99;
    });
    await page
      .getByRole("button", { name: "Zopakovat stejnou variantu", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Dosavadní část zopakovaná.", exact: true })
      .waitFor();
    assert.equal(
      await history(),
      first,
      "exact replay preserves the recorded move even with opposite randomness",
    );
    assert.equal(
      await page.evaluate(() => window.samplingQA.calls),
      beforeReplay,
      "exact replay does not draw again",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS ${color}${progressive ? " streaming" : ""}: independent 70/30 draws, latest snapshot, repeated first moves, rare branch, ignored legacy uniform setting and exact replay without randomness.`,
    );
  }
} finally {
  await browser.close();
}
