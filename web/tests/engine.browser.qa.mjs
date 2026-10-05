// Real vendored Stockfish WASM + isolated mocked training data/auth.
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  const errors = [];
  const engineRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/engine/")) engineRequests.push(request.url());
  });
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "chessbot.lichess.session.v1",
      JSON.stringify({
        token: "fake-engine-qa",
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
    window.engineQA = { calls: 0 };
    window.fetch = async (url, options) => {
      if (!String(url).startsWith("https://explorer.lichess.org/player?"))
        return nativeFetch(url, options);
      window.engineQA.calls++;
      const fen = new URL(url).searchParams.get("fen");
      const moves = fen.includes(" b ")
        ? [item("b8c6", 20)]
        : fen.endsWith("0 2")
          ? [item("g1f3", 60), item("f1c4", 50)]
          : [item("g1f3", 60), item("d2d3", 50)];
      return new Response(
        JSON.stringify({
          moves,
          white: 110,
          draws: 0,
          black: 0,
          queuePosition: 0,
        }) + "\n",
      );
    };
  });
  await page.goto(origin + "/");
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.ready === "true",
  );
  assert.equal(
    engineRequests.length,
    0,
    "engine does not download until explicitly enabled",
  );
  const toggle = page.getByRole("switch", { name: "Engine", exact: true });
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await toggle.click();
  const panel = page.getByRole("region", {
    name: "Hodnocení pozice enginem",
    exact: true,
  });
  await panel.getByText(/výpočet dokončen/).waitFor({ timeout: 25_000 });
  assert.match(
    await panel.locator(".engine-score").innerText(),
    /^[+−]?\d+,\d\d$/,
  );
  assert.match(
    await panel.locator(".engine-status").innerText(),
    /Hloubka [1-9]\d*/,
  );
  assert.ok(
    engineRequests.some((url) => url.endsWith("stockfish-19-lite-single.wasm")),
  );
  assert.equal(
    await panel.locator(".engine-pv").count(),
    0,
    "no best line before reveal",
  );
  const move = async (from, to) => {
    await page
      .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
      .click();
    await page
      .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
      .click();
  };
  // Actual opposite-side analysis: Fool's Mate immediately displays Black's win.
  await move("f2", "f3");
  await move("e7", "e5");
  await move("g2", "g4");
  await panel.getByText(/výpočet dokončen/).waitFor({ timeout: 15_000 });
  assert.match(await panel.locator(".engine-score").innerText(), /^−M\d+$/);
  assert.equal(await panel.locator(".engine-pv").count(), 0);
  await move("d8", "h4");
  await panel.getByText("Mat · vyhrál černý", { exact: true }).waitFor();
  assert.equal(
    await panel
      .locator(".evaluation-bar > span")
      .evaluate((el) => el.style.width),
    "0%",
  );
  // Editor reset clears mate and rapidly changed FEN never keeps stale evaluation.
  await page.getByRole("button", { name: "Vymazat", exact: true }).click();
  await panel.getByText(/výpočet dokončen/).waitFor({ timeout: 15_000 });
  assert.doesNotMatch(
    await panel.locator(".engine-score").innerText(),
    /Mat|M\d/,
  );
  await page.locator("#nickname").fill("EnginePlayer");
  await page.locator("#opening").fill("e4 e5");
  await page
    .getByRole("button", { name: "Spustit trénink", exact: true })
    .click();
  await page
    .getByText("Klikni na figuru a cílové pole", { exact: true })
    .waitFor();
  await panel.getByText(/výpočet dokončen/).waitFor({ timeout: 15_000 });
  const calls = await page.evaluate(() => window.engineQA.calls);
  const before = await page.locator(".move-history").innerText();
  await page.getByRole("button", { name: "Nápověda", exact: true }).click();
  assert.equal(await page.locator(".square.hinted").count(), 1);
  assert.match(
    await page.locator(".square.hinted").getAttribute("aria-label"),
    /^g1,/,
  );
  assert.equal(await page.locator(".square.selected").count(), 0);
  assert.equal(
    await page.locator(".move-dot, .capture-ring").count(),
    0,
    "weak hint reveals no destination",
  );
  assert.equal(await page.locator(".hint-list").count(), 0);
  assert.equal(await panel.locator(".engine-pv").count(), 0);
  await page
    .getByRole("button", { name: "Prozradit správnou odpověď", exact: true })
    .click();
  assert.match(
    await page.locator(".hint-list").innerText(),
    /Správná odpověď: Nf3 \(uznáme také Bc4\)/,
  );
  await panel.locator(".engine-pv").waitFor();
  assert.match(
    await panel.locator(".engine-pv").innerText(),
    /Doporučení enginu \(ne repertoáru\)/,
  );
  assert.equal(
    await page.locator(".move-history").innerText(),
    before,
    "reveal must not play the move",
  );
  assert.equal(
    await page.evaluate(() => window.engineQA.calls),
    calls,
    "hints/engine do not query Explorer",
  );
  assert.match(await page.locator(".stats").innerText(), /1\s+Nápověd/);
  assert.match(await page.locator(".stats").innerText(), /0\s+Správných tahů/);
  // Choose the close second, then exact replay must hint its piece, not the leader's.
  await move("f1", "c4");
  await page
    .getByText("Klikni na figuru a cílové pole", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Zopakovat stejnou variantu", exact: true })
    .click();
  await page
    .getByText("Klikni na figuru a cílové pole", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".square.hinted, .hint-list, .engine-pv").count(),
    0,
  );
  await page.getByRole("button", { name: "Nápověda", exact: true }).click();
  assert.match(
    await page.locator(".square.hinted").getAttribute("aria-label"),
    /^f1,/,
  );
  assert.equal(await page.locator(".hint-list, .engine-pv").count(), 0);
  await page
    .getByRole("button", { name: "Prozradit správnou odpověď", exact: true })
    .click();
  assert.match(
    await page.locator(".hint-list").innerText(),
    /Správná odpověď: Bc4\./,
  );
  assert.doesNotMatch(
    await page.locator(".hint-list").innerText(),
    /uznáme také/,
  );
  await move("g1", "f3");
  assert.match(
    await page.locator(".feedback").innerText(),
    /není tah zaznamenané větve/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
  );
  await page.screenshot({ path: "outputs/engine-mobile.png", fullPage: true });
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  assert.equal(await panel.locator(".engine-pv").count(), 0);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.ready === "true",
  );
  assert.equal(
    await toggle.getAttribute("aria-checked"),
    "false",
    "off setting persists only within the tab session",
  );
  await page.locator("#nickname").fill("BlackPlayer");
  await page.locator("#opening").fill("e4");
  await page.locator("#color").click();
  await page.getByRole("option", { name: "Černé figury", exact: true }).click();
  await page
    .getByRole("button", { name: "Spustit trénink", exact: true })
    .click();
  await page
    .getByText("Klikni na figuru a cílové pole", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Nápověda", exact: true }).click();
  assert.match(
    await page.locator(".square.hinted").getAttribute("aria-label"),
    /^b8, černý jezdec/,
  );
  assert.equal(
    await page
      .locator(".hint-list, .engine-pv, .move-dot, .capture-ring")
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Prozradit správnou odpověď", exact: true })
    .click();
  assert.match(
    await page.locator(".hint-list").innerText(),
    /Správná odpověď: Nc6/,
  );
  assert.deepEqual(errors, []);
  await context.close();
  // Worker/WASM load failure is isolated from training and can be retried.
  const failure = await browser.newContext();
  const failedPage = await failure.newPage();
  await failedPage.route("**/engine/stockfish-19/*.wasm", (route) =>
    route.abort(),
  );
  await failedPage.goto(origin + "/");
  await failedPage.waitForFunction(
    () => document.querySelector("main")?.dataset.ready === "true",
  );
  await failedPage.getByRole("switch", { name: "Engine", exact: true }).click();
  await failedPage
    .getByText("Engine není dostupný. Trénink může pokračovat.", {
      exact: true,
    })
    .waitFor({ timeout: 25_000 });
  await failedPage.unroute("**/engine/stockfish-19/*.wasm");
  await failedPage
    .getByRole("button", { name: "Zkusit engine znovu", exact: true })
    .click();
  await failedPage
    .locator(".engine-status")
    .getByText(/výpočet dokončen/)
    .waitFor({ timeout: 25_000 });
  await failure.close();
  console.log(
    "PASS: actual Stockfish WASM evaluation/mate, lazy assets, progressive depth, latest FEN, engine toggle/error retry, private local analysis, piece-only hints without destinations, full answers/PV only on reveal, exact replay hint target, unchanged scoring and mobile layout.",
  );
} finally {
  await browser.close();
}
