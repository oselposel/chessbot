// In-progress replay QA: fake auth/data, held streams, timer cancellation and no network on replay.
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
const seed = "e4 e5 Nf3 Nc6";
const fixtures = Object.fromEntries(
  [
    [
      seed,
      [
        ["f1c4", 60],
        ["f1b5", 50],
      ],
    ],
    [
      seed + " Bb5",
      [
        ["a7a6", 60],
        ["g8f6", 50],
      ],
    ],
    [
      seed + " Bb5 Nf6",
      [
        ["e1g1", 60],
        ["d2d3", 50],
      ],
    ],
    [seed + " Bb5 Nf6 O-O", [["f8e7", 30]]],
    [seed + " Bb5 Nf6 O-O Be7", [["f1e1", 30]]],
    [seed + " Bb5 Nf6 O-O Be7 Re1", []],
    [
      seed + " Bb5 Nf6 d3",
      [
        ["a7a6", 60],
        ["d7d6", 50],
      ],
    ],
  ].map(([line, moves]) => [
    positionKey(parseOpening(line)),
    {
      queuePosition: 0,
      white: moves.reduce((n, m) => n + m[1], 0),
      draws: 0,
      black: 0,
      moves: moves.map(([uci, count]) => ({
        uci,
        san: "ignored",
        white: count,
        draws: 0,
        black: 0,
      })),
    },
  ]),
);
try {
  for (const scenario of ["player", "loading", "opponent", "error", "black"]) {
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
            token: "fake-replay-test",
            username: "QA",
            expiresAt: Date.now() + 3600_000,
          }),
        );
        Math.random = () => 0.99;
        const nativeFetch = window.fetch.bind(window);
        window.replayQA = { requests: 0, aborted: 0, denyNetwork: false };
        window.fetch = async (url, options) => {
          if (!String(url).startsWith("https://explorer.lichess.org/player?"))
            return nativeFetch(url, options);
          const qa = window.replayQA;
          qa.requests++;
          if (qa.denyNetwork)
            throw new Error("Replay must not request live Explorer data");
          if (qa.requests === 2 && scenario === "error")
            return new Response("", { status: 503 });
          if (qa.requests === 2 && scenario === "loading") {
            return new Response(
              new ReadableStream({
                start(controller) {
                  options.signal.addEventListener(
                    "abort",
                    () => {
                      qa.aborted++;
                      controller.error(options.signal.reason);
                    },
                    { once: true },
                  );
                },
              }),
            );
          }
          const key = new URL(url).searchParams
            .get("fen")
            .split(" ")
            .slice(0, 4)
            .join(" ");
          if (!fixtures[key]) throw new Error("Unknown replay QA position");
          return new Response(JSON.stringify(fixtures[key]) + "\n");
        };
      },
      { fixtures, scenario },
    );
    await page.goto(origin + "/");
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.ready === "true",
    );
    await page.locator("#nickname").fill("ReplayPlayer");
    await page.locator("#opening").fill(seed);
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    if (scenario === "black") {
      await page.locator("#color").click();
      await page
        .getByRole("option", { name: "Černé figury", exact: true })
        .click();
    }
    await click("Spustit trénink");
    const player = () =>
      page
        .getByText("Klikni na figuru a cílové pole", { exact: true })
        .waitFor();
    const opponent = () =>
      page
        .getByRole("heading", { name: "Soupeř je na tahu.", exact: true })
        .waitFor();
    const complete = () =>
      page
        .getByRole("heading", {
          name: /^(Varianta dokončena|Dosavadní část zopakovaná)\.$/,
        })
        .waitFor();
    const history = () => page.locator(".move-history").innerText();
    const move = async (from, to) => {
      await page
        .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
        .click();
      await page
        .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
        .click();
    };
    const repeat = () => click("Zopakovat stejnou variantu");
    await player();
    if (scenario !== "black") {
      assert.equal(
        await page
          .getByRole("button", {
            name: "Zopakovat stejnou variantu",
            exact: true,
          })
          .isDisabled(),
        true,
        "nothing to repeat before a recorded ply",
      );
      await move("f1", "b5");
    } else {
      await move("g8", "f6");
    }
    if (scenario === "loading")
      await page.waitForFunction(() => window.replayQA.requests === 2);
    else if (scenario === "opponent") await opponent();
    else if (scenario === "error")
      await page
        .getByRole("heading", { name: "Trénink pozastaven.", exact: true })
        .waitFor();
    else await player();
    const checkpoint = await history();
    const requestsBefore = await page.evaluate(() => window.replayQA.requests);
    assert.equal(
      await page
        .getByRole("button", {
          name: "Zopakovat stejnou variantu",
          exact: true,
        })
        .isEnabled(),
      true,
    );
    await page.evaluate(() => {
      window.replayQA.denyNetwork = true;
      Math.random = () => 0;
    });
    await repeat();
    if (scenario === "black") {
      // Restart the first replay opponent at exactly the same seed FEN.
      await opponent();
      await repeat();
    }
    await player();
    const beforeWrong = await history();
    await move(
      scenario === "black" ? "a7" : "f1",
      scenario === "black" ? "a6" : "c4",
    );
    assert.match(
      await page.locator(".feedback").innerText(),
      /není tah zaznamenané větve/,
    );
    assert.equal(
      await history(),
      beforeWrong,
      "a valid and more popular alternative must not advance exact replay",
    );
    assert.equal(
      await page.locator(".stats > div").first().locator("strong").innerText(),
      "0",
    );
    await click("Prozradit správnou odpověď");
    assert.match(
      await page.locator(".hint-list").innerText(),
      scenario === "black" ? /Nf6 · cíl/ : /Bb5 · cíl/,
    );
    await move(
      scenario === "black" ? "g8" : "f1",
      scenario === "black" ? "f6" : "b5",
    );
    if (scenario === "player") {
      // Restart while the replay opponent's timer is active: preserve the entire saved prefix.
      await opponent();
      await repeat();
      await player();
      await move("f1", "b5");
    }
    await complete();
    assert.equal(
      await history(),
      checkpoint,
      "replay must stop at the original checkpoint with identical opponent replies",
    );
    assert.equal(
      await page.evaluate(() => window.replayQA.requests),
      requestsBefore,
      "replay uses no network",
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Pokračovat od poslední pozice",
          exact: true,
        })
        .isEnabled(),
      true,
    );
    if (scenario === "loading")
      assert.equal(await page.evaluate(() => window.replayQA.aborted), 1);
    if (scenario === "opponent") {
      await page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 700)),
      );
      assert.equal(
        await history(),
        checkpoint,
        "old opponent timer cannot append an unsaved reply",
      );
    }
    if (scenario === "player") {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: "outputs/replay-mobile.png",
        fullPage: true,
      });
      await page.evaluate(() => {
        window.replayQA.denyNetwork = false;
      });
      await click("Pokračovat od poslední pozice");
      await player();
      assert.equal(await history(), checkpoint);
      await move("e1", "g1");
      await player();
      const extended = await history();
      assert.match(extended, /Bb5.*Nf6.*O-O.*Be7/s);
      const afterResumeRequests = await page.evaluate(
        () => window.replayQA.requests,
      );
      await page.evaluate(() => {
        window.replayQA.denyNetwork = true;
      });
      await repeat();
      await player();
      await move("f1", "b5");
      await player();
      await move("d2", "d3");
      assert.match(
        await page.locator(".feedback").innerText(),
        /není tah zaznamenané větve/,
      );
      await move("e1", "g1");
      await complete();
      assert.equal(
        await history(),
        extended,
        "resuming must append to, not replace, the original record",
      );
      assert.equal(
        await page.evaluate(() => window.replayQA.requests),
        afterResumeRequests,
      );
      await page.evaluate(() => {
        window.replayQA.denyNetwork = false;
      });
      await click("Pokračovat od poslední pozice");
      await player();
      await move("f1", "e1");
      await complete();
      const finished = await history();
      const afterFinishedRequests = await page.evaluate(
        () => window.replayQA.requests,
      );
      await page.evaluate(() => {
        window.replayQA.denyNetwork = true;
      });
      await repeat();
      await player();
      await move("f1", "b5");
      await player();
      await move("e1", "g1");
      await player();
      await move("f1", "e1");
      await complete();
      assert.equal(await history(), finished);
      assert.equal(
        await page.evaluate(() => window.replayQA.requests),
        afterFinishedRequests,
      );
      assert.equal(
        await page
          .getByRole("button", {
            name: "Pokračovat od poslední pozice",
            exact: true,
          })
          .count(),
        0,
        "fully completed original rounds are not resumable",
      );
    }
    assert.deepEqual(errors, [], scenario);
    await context.close();
  }
  console.log(
    "PASS: in-progress replay from player/loading/opponent/error and both colors, exact accepted choices despite popular alternatives, identical opponent replies despite changed randomness, zero replay requests, aborted streams/timers, restart mid-replay, checkpoint resume/appended history and responsive UI.",
  );
} finally {
  await browser.close();
}
