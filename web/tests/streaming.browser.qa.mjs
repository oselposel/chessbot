// Real browser streams held open until explicitly completed. All data/auth are fake.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const origin = (
  process.env.APP_ORIGIN || "http://127.0.0.1:5174/chessbot"
).replace(/\/$/, "");
try {
  for (const policy of ["repertoire", "line", "advance", "empty"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ policy }) => {
        sessionStorage.setItem(
          "chessbot.lichess.session.v1",
          JSON.stringify({
            token: "fake-stream-test",
            username: "QA",
            expiresAt: Date.now() + 3600_000,
          }),
        );
        const nativeFetch = window.fetch.bind(window);
        const item = (uci, count) => ({
          uci,
          san: "ignored",
          white: count,
          draws: 0,
          black: 0,
        });
        const row = (moves) => ({
          moves,
          white: moves.reduce((n, m) => n + m.white, 0),
          draws: 0,
          black: 0,
          queuePosition: 0,
        });
        window.streamQA = { requests: 0, aborted: 0 };
        window.fetch = async (url, options) => {
          if (!String(url).startsWith("https://explorer.lichess.org/player?"))
            return nativeFetch(url, options);
          const qa = window.streamQA;
          qa.requests++;
          if (qa.requests > 1) {
            const fen = new URL(url).searchParams.get("fen");
            // After Nf3 the opponent can play Nc6, then the next player position is empty.
            const moves = fen.includes(" b ") ? [item("b8c6", 10)] : [];
            return new Response(JSON.stringify(row(moves)) + "\n");
          }
          return new Response(
            new ReadableStream({
              start(controller) {
                qa.emit = (moves, close = false) => {
                  controller.enqueue(
                    new TextEncoder().encode(JSON.stringify(row(moves)) + "\n"),
                  );
                  if (close) controller.close();
                };
                qa.final = () =>
                  qa.emit([item("g1f3", 1), item("f1c4", 99)], true);
                options.signal.addEventListener(
                  "abort",
                  () => {
                    qa.aborted++;
                    controller.error(options.signal.reason);
                  },
                  { once: true },
                );
                qa.emit(policy === "empty" ? [] : [item("g1f3", 1)]);
              },
            }),
          );
        };
      },
      { policy },
    );
    await page.goto(origin + "/");
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.ready === "true",
    );
    await page.locator("#nickname").fill("StreamPlayer");
    await page.locator("#opening").fill("e4 e5");
    if (policy === "line") {
      await page.locator("#policy").click();
      await page
        .getByRole("option", {
          name: "Konkrétní varianta · hlavní tah",
          exact: true,
        })
        .click();
    }
    await page
      .getByRole("button", { name: "Spustit trénink", exact: true })
      .click();
    const player = page.getByText("Klikni na figuru a cílové pole", {
      exact: true,
    });
    const move = async (from, to) => {
      await page
        .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
        .click();
      await page
        .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
        .click();
    };
    if (policy === "empty") {
      await page.waitForFunction(() => window.streamQA.requests === 1);
      await page
        .locator(".opening-list")
        .getByText(/Průběžná data/)
        .waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "Varianta dokončena.", exact: true })
          .count(),
        0,
      );
      assert.equal(await player.count(), 0);
      await page.evaluate(() => window.streamQA.emit([], true));
      await page
        .getByRole("heading", { name: "Varianta dokončena.", exact: true })
        .waitFor();
    } else {
      await player.waitFor({ timeout: 5000 });
      assert.equal(await page.evaluate(() => window.streamQA.requests), 1);
      await page
        .locator(".loading-info")
        .getByText(/Data se doplňují/)
        .waitFor();
      // The stream remains open: unknown legal moves must not be scored as mistakes.
      await move("f1", "c4");
      assert.match(
        await page.locator(".feedback").innerText(),
        /Data se ještě doplňují/,
      );
      assert.match(
        await page.locator(".stats").innerText(),
        /0\s+Mimo repertoár/,
      );
      await page.getByRole("button", { name: "Nápověda", exact: true }).click();
      if (policy === "advance") {
        // Move while indexing is unfinished: abort must release the serial queue.
        await move("g1", "f3");
        await page
          .getByRole("heading", { name: "Varianta dokončena.", exact: true })
          .waitFor({ timeout: 5000 });
        assert.equal(await page.evaluate(() => window.streamQA.aborted), 1);
        assert.equal(await page.evaluate(() => window.streamQA.requests), 3);
        assert.match(
          await page.locator(".move-history").innerText(),
          /Nf3.*Nc6/s,
        );
        assert.equal(
          await page
            .getByRole("heading", { name: "Trénink pozastaven.", exact: true })
            .count(),
          0,
        );
      } else {
        await page.evaluate(() => window.streamQA.final());
        await page.waitForFunction(
          () => !document.querySelector(".loading-info"),
        );
        assert.match(await page.locator(".hint-list").innerText(), /Bc4/);
        if (policy === "line") {
          assert.match(
            await page.locator(".hint-list").innerText(),
            /Nf3 · cíl/,
          );
          await move("f1", "c4");
          assert.match(
            await page.locator(".feedback").innerText(),
            /platná alternativa/,
          );
          assert.match(
            await page.locator(".stats").innerText(),
            /0\s+Mimo repertoár/,
          );
        } else {
          await move("a2", "a3");
          assert.match(
            await page.locator(".feedback").innerText(),
            /v datech této pozice není/,
          );
          assert.match(
            await page.locator(".stats").innerText(),
            /1\s+Mimo repertoár/,
          );
          await move("f1", "c4");
          await page
            .getByRole("heading", { name: "Varianta dokončena.", exact: true })
            .waitFor();
        }
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: playable before EOF, pending unknown moves not scored, live hints, stable fixed target, clean empty EOF, cancellation releases next position and ignores obsolete errors.",
  );
} finally {
  await browser.close();
}
