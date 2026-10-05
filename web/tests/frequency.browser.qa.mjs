// Deterministic frequency/tolerance QA using fake auth and Explorer data.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const origin = (
  process.env.APP_ORIGIN || "http://127.0.0.1:5174/chessbot"
).replace(/\/$/, "");
const cases = [
  {
    name: "close",
    counts: [45, 40, 15],
    total: 100,
    accepted: true,
    percent: "40 %",
  },
  {
    name: "close-line",
    policy: "line",
    counts: [45, 40, 15],
    total: 100,
    accepted: true,
    percent: "40 %",
  },
  {
    name: "far",
    counts: [45, 30, 25],
    total: 100,
    accepted: false,
    percent: "30 %",
  },
  {
    name: "exact-boundary",
    counts: [50, 40, 10],
    total: 100,
    accepted: true,
    percent: "40 %",
  },
  {
    name: "unrounded-boundary",
    counts: [10000, 7999, 2001],
    total: 20000,
    accepted: false,
    percent: "40 %",
  },
  {
    name: "fragmented",
    counts: [19, 18, 17, 16, 15, 15],
    total: 100,
    accepted: true,
    percent: "18 %",
  },
  {
    name: "joint-first",
    counts: [40, 40, 20],
    total: 100,
    accepted: true,
    percent: "40 %",
  },
  {
    name: "joint-second",
    counts: [45, 36, 36],
    total: 117,
    third: true,
    accepted: true,
    percent: "30,8 %",
  },
  {
    name: "missing-other-moves",
    counts: [45, 40],
    total: 100,
    accepted: true,
    percent: "40 %",
  },
];
try {
  for (const fixture of cases) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ fixture }) => {
        sessionStorage.setItem(
          "chessbot.lichess.session.v1",
          JSON.stringify({
            token: "fake-frequency-test",
            username: "QA",
            expiresAt: Date.now() + 3600_000,
          }),
        );
        sessionStorage.setItem(
          "chessbot.training.draft.v2",
          JSON.stringify({ minimumShare: "0", name: "OldDraft" }),
        );
        const nativeFetch = window.fetch.bind(window);
        let requests = 0;
        window.fetch = async (url, options) => {
          if (!String(url).startsWith("https://explorer.lichess.org/player?"))
            return nativeFetch(url, options);
          requests++;
          if (requests > 1) {
            // Keep the next position loading so the accepted-answer feedback remains visible.
            return new Response(
              new ReadableStream({
                start(controller) {
                  options.signal.addEventListener(
                    "abort",
                    () => controller.error(options.signal.reason),
                    { once: true },
                  );
                },
              }),
            );
          }
          const ucis = ["f1c4", "f1b5", "d2d4", "b1c3", "h2h3", "a2a3"];
          const row = {
            white: fixture.total,
            draws: 0,
            black: 0,
            queuePosition: 0,
            moves: fixture.counts.map((count, i) => ({
              uci: ucis[i],
              san: "ignored",
              white: count,
              draws: 0,
              black: 0,
            })),
          };
          return new Response(JSON.stringify(row) + "\n");
        };
      },
      { fixture },
    );
    await page.goto(origin + "/");
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.ready === "true",
    );
    assert.equal(
      await page.locator("#threshold").count(),
      0,
      "old saved thresholds cannot override the new rule",
    );
    await page.locator("#nickname").fill("FrequencyPlayer");
    await page.locator("#opening").fill("e4 e5 Nf3 Nc6");
    if (fixture.policy === "line") {
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
    await page
      .getByText("Klikni na figuru a cílové pole", { exact: true })
      .waitFor();
    await page.waitForFunction(() => !document.querySelector(".loading-info"));
    await page.getByRole("button", { name: "Nápověda", exact: true }).click();
    const moveName = fixture.third ? "d4" : "Bb5";
    const hint = page.locator(".hint-list > div").filter({
      has: page.locator("strong", {
        hasText: new RegExp("^" + moveName + "(?: ·|$)"),
      }),
    });
    assert.match(await hint.innerText(), new RegExp(fixture.percent));
    assert.match(
      await hint.innerText(),
      fixture.accepted ? /uznáváme/ : /mimo toleranci/,
    );
    const move = async (from, to) => {
      await page
        .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
        .click();
      await page
        .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
        .click();
    };
    if (fixture.name === "close") {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: "outputs/frequency-mobile.png",
        fullPage: true,
      });
    }
    await move(fixture.third ? "d2" : "f1", fixture.third ? "d4" : "b5");
    if (fixture.accepted) {
      await page
        .locator(".feedback")
        .getByText(/^Správně/)
        .waitFor();
      assert.match(
        await page.locator(".feedback").innerText(),
        new RegExp(fixture.percent),
      );
      assert.match(await page.locator(".feedback").innerText(), /případů/);
      assert.match(
        await page.locator(".last-answer").innerText(),
        new RegExp(fixture.percent),
      );
      assert.match(await page.locator(".board-badge").innerText(), /^1 \/ /);
    } else {
      assert.match(
        await page.locator(".feedback").innerText(),
        /mimo toleranci/,
      );
      assert.match(
        await page.locator(".feedback").innerText(),
        new RegExp(fixture.percent),
      );
      assert.match(await page.locator(".board-badge").innerText(), /^0 \/ /);
      assert.match(
        await page.locator(".stats").innerText(),
        /0\s+Mimo repertoár/,
      );
      await move("f1", "c4");
      await page
        .locator(".feedback")
        .getByText(/^Správně/)
        .waitFor();
      assert.match(await page.locator(".board-badge").innerText(), /^1 \/ /);
    }
    assert.deepEqual(errors, [], fixture.name);
    await context.close();
  }
  console.log(
    "PASS: near/far top two, inclusive 80% ratio, actual counts instead of rounded percentages, leader below 20%, tied first/second, full-position denominator, both first-pass modes, legacy settings ignored, percentage feedback and mobile layout.",
  );
} finally {
  await browser.close();
}
