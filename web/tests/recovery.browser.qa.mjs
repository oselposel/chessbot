// Isolated browser, fake OAuth/Explorer. No real account or token is accessed.
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
  for (const scenario of ["automatic", "manual", "exhausted", "cancel"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(
      ({ scenario }) => {
        sessionStorage.setItem(
          "chessbot.lichess.session.v1",
          JSON.stringify({
            token: "fake-recovery-qa",
            username: "QA",
            expiresAt: Date.now() + 3600_000,
          }),
        );
        const nativeFetch = window.fetch.bind(window);
        const item = (uci, count = 10) => ({
          uci,
          san: "ignored",
          white: count,
          draws: 0,
          black: 0,
        });
        const row = (moves, queuePosition = 0) => ({
          white: moves.reduce((n, m) => n + m.white, 0),
          draws: 0,
          black: 0,
          moves,
          queuePosition,
        });
        const encode = (data) =>
          new TextEncoder().encode(JSON.stringify(data) + "\n");
        window.recoveryQA = { calls: 0, aborted: 0, cancelled: 0, renewed: 0 };
        window.fetch = async (url, options) => {
          if (!String(url).startsWith("https://explorer.lichess.org/player?"))
            return nativeFetch(url, options);
          const qa = window.recoveryQA;
          qa.calls++;
          const fen = new URL(url).searchParams.get("fen");
          if (scenario === "manual" && fen.endsWith("0 2"))
            return new Response(encode(row([item("g1f3")])));
          if (scenario === "manual" && fen.includes(" b "))
            return new Response(encode(row([item("b8c6")])));
          qa.renewed++;
          if (scenario === "cancel" && qa.renewed > 1)
            return new Response(encode(row([item("g1f3")])));
          if (scenario !== "exhausted" && qa.renewed > 1)
            return new Response(
              encode(
                row([
                  item("f1c4", 99),
                  ...(scenario === "automatic" ? [item("g1f3", 1)] : []),
                ]),
              ),
            );
          return new Response(
            new ReadableStream({
              start(controller) {
                options.signal.addEventListener(
                  "abort",
                  () => {
                    qa.aborted++;
                  },
                  { once: true },
                );
                controller.enqueue(
                  encode(
                    row([item(scenario === "manual" ? "f1c4" : "g1f3")], 29),
                  ),
                );
              },
              // Deliberately never settle cancellation: queue release must not depend on it.
              cancel() {
                qa.cancelled++;
                return new Promise(() => {});
              },
            }),
          );
        };
      },
      { scenario },
    );
    await page.goto(origin + "/");
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.ready === "true",
    );
    await page.locator("#nickname").fill("RecoveryPlayer");
    await page.locator("#opening").fill("e4 e5");
    await page
      .getByRole("button", { name: "Spustit trénink", exact: true })
      .click();
    const player = page.getByText("Klikni na figuru a cílové pole", {
      exact: true,
    });
    await player.waitFor();
    const move = async (from, to) => {
      await page
        .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
        .click();
      await page
        .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
        .click();
    };
    if (scenario === "manual") {
      await move("g1", "f3");
      await page.clock.fastForward(600);
      await player.waitFor();
      await page
        .locator(".loading-info")
        .getByText(/frontě 29/)
        .waitFor();
      const history = await page.locator(".move-history").innerText();
      const stats = await page.locator(".stats").innerText();
      assert.match(history, /Nf3.*Nc6/s);
      await page
        .getByRole("button", { name: "Obnovit pozici", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector(".loading-info"),
      );
      assert.equal(await page.locator(".move-history").innerText(), history);
      assert.equal(await page.locator(".stats").innerText(), stats);
      assert.match(
        await page.locator(".feedback").innerText(),
        /Pozice je načtená/,
      );
      assert.equal(await page.evaluate(() => window.recoveryQA.aborted), 1);
      assert.equal(await page.evaluate(() => window.recoveryQA.calls), 4);
      await move("f1", "c4");
      assert.match(
        await page.locator(".move-history").innerText(),
        /Nf3.*Nc6.*Bc4/s,
      );
    } else {
      await page
        .locator(".loading-info")
        .getByText(/frontě 29/)
        .waitFor();
      await move("f1", "c4");
      assert.match(
        await page.locator(".feedback").innerText(),
        /Data se ještě doplňují/,
      );
      const initialFen = await page.locator(".move-history").innerText();
      await page.clock.fastForward(45_001);
      await page
        .locator(".loading-info")
        .getByText(/obnovuji spojení \(1\/2\)/)
        .waitFor();
      if (scenario === "cancel") {
        await page
          .getByRole("button", { name: "Zrušit načítání", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Trénink pozastaven.", exact: true })
          .waitFor();
        await page.clock.fastForward(10_000);
        assert.equal(await page.evaluate(() => window.recoveryQA.calls), 1);
        await page
          .getByRole("button", { name: "Obnovit pozici", exact: true })
          .click();
        await page.waitForFunction(
          () => !document.querySelector(".loading-info"),
        );
        await player.waitFor();
        assert.equal(await page.evaluate(() => window.recoveryQA.calls), 2);
      } else {
        await page.clock.fastForward(5_001);
        if (scenario === "automatic") {
          await page.waitForFunction(
            () => !document.querySelector(".loading-info"),
          );
          assert.equal(await page.evaluate(() => window.recoveryQA.calls), 2);
          assert.equal(
            await page.evaluate(() => window.recoveryQA.cancelled),
            1,
          );
          await page
            .getByRole("button", { name: "Nápověda", exact: true })
            .click();
          assert.match(await page.locator(".hint-list").innerText(), /Bc4/);
        } else {
          await page.waitForFunction(() => window.recoveryQA.calls === 2);
          await page
            .locator(".loading-info")
            .getByText(/frontě 29/)
            .waitFor();
          await page.clock.fastForward(45_001);
          await page
            .locator(".loading-info")
            .getByText(/obnovuji spojení \(2\/2\)/)
            .waitFor();
          await page.clock.fastForward(10_001);
          await page.waitForFunction(() => window.recoveryQA.calls === 3);
          await page
            .locator(".loading-info")
            .getByText(/frontě 29/)
            .waitFor();
          await page.clock.fastForward(45_001);
          await page
            .getByRole("heading", { name: "Trénink pozastaven.", exact: true })
            .waitFor();
          await page
            .getByText(/Lichess opakovaně neposílá nové výsledky/)
            .waitFor();
          await page
            .getByRole("button", { name: "Obnovit pozici", exact: true })
            .waitFor();
          assert.equal(await page.evaluate(() => window.recoveryQA.calls), 3);
          await page.clock.fastForward(120_000);
          assert.equal(
            await page.evaluate(() => window.recoveryQA.calls),
            3,
            "must not loop indefinitely",
          );
        }
      }
      assert.equal(await page.locator(".move-history").innerText(), initialFen);
      assert.match(
        await page.locator(".stats").innerText(),
        /0\s+Mimo repertoár/,
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Varianta dokončena.", exact: true })
          .count(),
        0,
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: stalled indexing auto-reconnects, cancellation cannot block the queue, manual refresh keeps history/stats, retry backoff cancels safely, retries are bounded and incomplete data never finishes/scores unknown moves.",
  );
} finally {
  await browser.close();
}
