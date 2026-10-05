// Deterministic UI QA. No real account/token or Lichess requests are used.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { parseOpening } from "../lib/training.ts";
import { positionKey } from "../lib/repertoire.ts";
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const origin = (
  process.env.APP_ORIGIN || "http://127.0.0.1:5174/chessbot"
).replace(/\/$/, "");
const fixtures = Object.fromEntries(
  [
    ["e4 e5", "g1f3", 2],
    ["e4 e5 Nf3", "b8c6", 1],
    ["e4 e5 Nf3 Nc6", "f1c4", 1],
    ["e4 e5 Nf3 Nc6 Bc4", null, 0],
  ].map(([line, uci, total]) => [
    positionKey(parseOpening(line)),
    {
      white: total,
      draws: 0,
      black: 0,
      queuePosition: 0,
      moves: uci
        ? [{ uci, san: "ignored", white: total, draws: 0, black: 0 }]
        : [],
    },
  ]),
);
try {
  for (const scenario of ["flow", "start", "terminal", "stream"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ fixtures, scenario }) => {
        sessionStorage.setItem(
          "chessbot.lichess.session.v1",
          JSON.stringify({
            token: "fake-single-game-test",
            username: "QA",
            expiresAt: Date.now() + 3600_000,
          }),
        );
        const nativeFetch = window.fetch.bind(window);
        window.singleQA = { requests: 0 };
        window.fetch = async (url, options) => {
          if (!String(url).startsWith("https://explorer.lichess.org/player?"))
            return nativeFetch(url, options);
          const qa = window.singleQA;
          qa.requests++;
          const key = new URL(url).searchParams
            .get("fen")
            .split(" ")
            .slice(0, 4)
            .join(" ");
          const data = fixtures[key];
          if (!data) throw new Error("Unknown QA position");
          if (scenario === "stream" && qa.requests === 1) {
            return new Response(
              new ReadableStream({
                start(controller) {
                  const row = {
                    ...data,
                    white: 1,
                    moves: data.moves.map((m) => ({ ...m, white: 1 })),
                  };
                  controller.enqueue(
                    new TextEncoder().encode(JSON.stringify(row) + "\n"),
                  );
                  qa.finish = () => controller.close();
                  options.signal.addEventListener(
                    "abort",
                    () => controller.error(options.signal.reason),
                    { once: true },
                  );
                },
              }),
            );
          }
          return new Response(
            JSON.stringify(
              scenario === "terminal" ? { ...data, white: 1 } : data,
            ) + "\n",
          );
        };
      },
      { fixtures, scenario },
    );
    await page.goto(origin + "/");
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.ready === "true",
    );
    await page.locator("#nickname").fill("SingleGamePlayer");
    await page
      .locator("#opening")
      .fill(
        scenario === "start"
          ? "e4 e5 Nf3 Nc6"
          : scenario === "terminal"
            ? "e4 e5 Nf3 Nc6 Bc4"
            : "e4 e5",
      );
    if (scenario === "start") {
      await page.locator("#policy").click();
      await page
        .getByRole("option", {
          name: "Konkrétní varianta · hlavní tah",
          exact: true,
        })
        .click();
    }
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    const player = () =>
      page
        .getByText("Klikni na figuru a cílové pole", { exact: true })
        .waitFor();
    const single = () =>
      page
        .getByRole("heading", {
          name: "Ve větvi zbývá jediná partie.",
          exact: true,
        })
        .waitFor();
    const complete = () =>
      page
        .getByRole("heading", {
          name: /^(Varianta dokončena|Dosavadní část zopakovaná)\.$/,
        })
        .waitFor();
    const move = async (from, to) => {
      await page
        .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
        .click();
      await page
        .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
        .click();
    };
    await click("Spustit trénink");
    if (scenario === "flow") {
      await player();
      assert.equal(
        await page.locator(".single-game-notice").count(),
        0,
        "two games sharing one move are not a single game",
      );
      await move("g1", "f3");
      await single();
      assert.equal(
        await page.evaluate(async () => {
          await new Promise((r) => setTimeout(r, 700));
          return window.singleQA.requests;
        }),
        2,
        "opponent must stay paused",
      );
      assert.match(await page.locator(".move-history").innerText(), /Nf3/);
      assert.doesNotMatch(
        await page.locator(".move-history").innerText(),
        /Nc6/,
      );
      const requestsBeforeReplay = await page.evaluate(
        () => window.singleQA.requests,
      );
      await click("Zopakovat dosavadní variantu");
      await player();
      await move("g1", "f3");
      await complete();
      assert.equal(
        await page.evaluate(() => window.singleQA.requests),
        requestsBeforeReplay,
      );
      await click("Jiné pokračování ze stejného úvodu");
      await player();
      await move("g1", "f3");
      await single();
      await click("Vybrat jinou pozici");
      assert.match(await page.locator("#opening").inputValue(), /Nf3/);
      await click("Zpět");
      assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
      await click("Spustit trénink");
      await player();
      await move("g1", "f3");
      await single();
      await page.screenshot({
        path: "outputs/single-game-desktop.png",
        fullPage: true,
      });
      for (const width of [900, 390]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Vybrat jinou pozici", exact: true })
            .isVisible(),
          true,
        );
      }
      await page.screenshot({
        path: "outputs/single-game-mobile.png",
        fullPage: true,
      });
      await click("Pokračovat v této partii");
      await player();
      assert.match(
        await page.locator(".move-history").innerText(),
        /Nf3.*Nc6/s,
      );
      assert.equal(
        await page.locator(".single-game-notice").count(),
        0,
        "acknowledgment applies to the entire remaining round",
      );
      await move("f1", "c4");
      await complete();
      await click("Jiné pokračování ze stejného úvodu");
      await player();
      await move("g1", "f3");
      await single(); // A fresh round warns again, including from completed cache.
    } else if (scenario === "terminal") {
      await single();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Zopakovat dosavadní variantu",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await click("Dokončit variantu");
      await complete();
    } else if (scenario === "start") {
      await single();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Zopakovat dosavadní variantu",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await click("Pokračovat v této partii");
      await player();
      await click("Nápověda");
      assert.match(
        await page.locator(".hint-list").innerText(),
        /Bc4 · doporučení/,
      );
      await move("f1", "c4");
      await complete();
    } else {
      await player();
      assert.equal(
        await page.locator(".single-game-notice").count(),
        0,
        "one game during indexing is provisional",
      );
      await page.evaluate(() => window.singleQA.finish());
      await single();
      await click("Pokračovat v této partii");
      await player();
      await move("g1", "f3");
      await player();
      await move("f1", "c4");
      await complete();
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: confirmed one-game counts pause player/opponent, one move with many games does not, exact replay without requests, other-position editor, per-round acknowledgment/reset, stable target, terminal game, unfinished index and responsive layout.",
  );
} finally {
  await browser.close();
}
