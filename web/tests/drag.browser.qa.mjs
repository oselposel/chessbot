// Real mouse and CDP touch input in an isolated browser; fake auth/Explorer only.
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
  for (const input of ["mouse", "touch"]) {
    const context = await browser.newContext({
      viewport:
        input === "touch"
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1080 },
      hasTouch: input === "touch",
      isMobile: input === "touch",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Math.random = () => 0;
      sessionStorage.setItem(
        "chessbot.lichess.session.v1",
        JSON.stringify({
          token: "fake-drag-qa",
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
      window.dragQA = { calls: 0 };
      window.fetch = async (url, options) => {
        if (!String(url).startsWith("https://explorer.lichess.org/player?"))
          return nativeFetch(url, options);
        window.dragQA.calls++;
        const fen = new URL(url).searchParams.get("fen");
        const moves = fen.includes(" b ")
          ? [item("b8c6", 60), item("g8f6", 50)]
          : fen.endsWith("0 2")
            ? [item("g1f3", 60), item("f1c4", 50)]
            : [item("d2d3", 60), item("d2d4", 50)];
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
    const square = (sq) => page.locator(`[data-square="${sq}"]`);
    const point = async (sq) => {
      const rect = await square(sq).boundingBox();
      assert.ok(rect);
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    const down = async (p) => {
      if (input === "mouse") {
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
      } else
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...p, id: 1 }],
        });
    };
    const movePointer = async (p) => {
      if (input === "mouse") await page.mouse.move(p.x, p.y, { steps: 8 });
      else
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...p, id: 1 }],
        });
    };
    const up = async () => {
      if (input === "mouse") await page.mouse.up();
      else
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
    };
    const drag = async (from, to, preview = true) => {
      await page.locator(".board").scrollIntoViewIfNeeded();
      const start = await point(from),
        end = await point(to);
      const scroll = await page.evaluate(() => window.scrollY);
      await down(start);
      await movePointer(end);
      if (preview) {
        await page.locator(".drag-ghost").waitFor();
        assert.equal(
          await square(from)
            .locator(".piece")
            .evaluate((el) => getComputedStyle(el).opacity),
          "0",
        );
        assert.equal(
          await square(to).evaluate((el) =>
            el.classList.contains("drag-target"),
          ),
          true,
        );
        assert.equal(
          await page
            .locator(".drag-ghost")
            .evaluate((el) => getComputedStyle(el).pointerEvents),
          "none",
        );
      }
      await up();
      await page.locator(".drag-ghost").waitFor({ state: "detached" });
      if (input === "touch" && preview)
        assert.equal(
          await page.evaluate(() => window.scrollY),
          scroll,
          "piece drag must not scroll the page",
        );
    };
    const apply = async (text) => {
      await page.locator("#opening").fill(text);
      await page
        .getByRole("button", { name: "Zobrazit úvod", exact: true })
        .click();
    };
    // Jitter remains a normal tap/click, and click-to-move still works.
    await page.locator(".board").scrollIntoViewIfNeeded();
    const initial = await point("e2");
    await down(initial);
    await movePointer({ x: initial.x + 2, y: initial.y + 1 });
    assert.equal(await page.locator(".drag-ghost").count(), 0);
    await up();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-square="e2"]')
          ?.getAttribute("aria-pressed") === "true",
    );
    await square("e4").click();
    assert.equal(await page.locator("#opening").inputValue(), "1. e4");
    await drag("e7", "e5");
    assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    assert.equal(
      await page.locator(".square.selected").count(),
      0,
      "drop must not synthesize selection/click",
    );
    // Opponent pieces cannot start a drag; illegal moves snap back.
    await drag("e5", "f5", false);
    assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    await drag("g1", "g4");
    assert.match(await page.locator(".feedback").innerText(), /není legální/);
    assert.equal(await square("g1").locator(".piece").count(), 1);
    assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    await page.locator(".board").scrollIntoViewIfNeeded();
    const from = await point("g1"),
      to = await point("f3");
    // Cancel outside, Esc, pointercancel and changing the board mid-gesture.
    await down(from);
    await movePointer(to);
    await page.keyboard.press("Escape");
    await up();
    assert.equal(await page.locator(".drag-ghost").count(), 0);
    assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    await down(from);
    const boardRect = await page.locator(".board").boundingBox();
    await movePointer({ x: Math.max(1, boardRect.x - 6), y: from.y });
    await up();
    assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    if (input === "touch") {
      await down(from);
      await movePointer(to);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await page.locator(".drag-ghost").waitFor({ state: "detached" });
      assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    }
    await down(from);
    await movePointer(to);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await up();
    assert.equal(await page.locator("#opening").inputValue(), "1. e4 e5");
    // Programmatic UI actions deliberately avoid scrolling: a position change
    // itself must invalidate the old gesture before release on a different board.
    await down(from);
    await movePointer(to);
    await page.evaluate(() => {
      const opening = document.querySelector("#opening");
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      ).set.call(opening, "d4 d5");
      opening.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page
      .getByRole("button", { name: "Zobrazit úvod", exact: true })
      .evaluate((button) => button.click());
    await page.locator(".drag-ghost").waitFor({ state: "detached" });
    await up();
    assert.equal(await page.locator("#opening").inputValue(), "1. d4 d5");
    await apply("e4 e5");
    await square("g1").focus();
    await page.keyboard.press("Enter");
    await square("f3").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#opening").inputValue(),
      "1. e4 e5 2. Nf3",
      "keyboard click must not be suppressed after drag cancellation",
    );
    // Captures, castling, white/black promotion and cancellation all share click logic.
    await apply("e4 d5");
    await drag("e4", "d5");
    assert.equal(
      await page.locator("#opening").inputValue(),
      "1. e4 d5 2. exd5",
    );
    assert.match(await square("d5").getAttribute("aria-label"), /bílý pěšec/);
    await apply("e4 e5 Nf3 Nc6 Bc4 Bc5");
    await drag("e1", "g1");
    assert.match(await page.locator("#opening").inputValue(), /4\. O-O$/);
    assert.match(await square("f1").getAttribute("aria-label"), /bílá věž/);
    await apply("a4 h5 a5 h4 a6 h3 axb7 hxg2");
    await drag("b7", "a8");
    const promotion = page.getByRole("group", {
      name: "Proměna pěšce",
      exact: true,
    });
    await promotion.waitFor();
    assert.match(await square("b7").getAttribute("aria-label"), /bílý pěšec/);
    await promotion
      .getByRole("button", { name: "Zrušit", exact: true })
      .click();
    await drag("b7", "a8");
    await promotion
      .getByRole("button", { name: "jezdec", exact: true })
      .click();
    assert.match(await square("a8").getAttribute("aria-label"), /bílý jezdec/);
    await drag("g2", "h1");
    await promotion
      .getByRole("button", { name: "jezdec", exact: true })
      .click();
    assert.match(await square("h1").getAttribute("aria-label"), /černý jezdec/);
    // Training: accepted close second by drag; an unknown move restores the piece.
    await apply("e4 e5");
    await page.locator("#nickname").fill("DragPlayer");
    await page
      .getByRole("button", { name: "Spustit trénink", exact: true })
      .click();
    const player = page.getByText("Klikni na figuru a cílové pole", {
      exact: true,
    });
    await player.waitFor();
    const history = await page.locator(".move-history").innerText();
    await drag("a2", "a3");
    assert.equal(await page.locator(".move-history").innerText(), history);
    assert.match(
      await page.locator(".stats").innerText(),
      /1\s+Mimo repertoár/,
    );
    assert.match(await square("a2").getAttribute("aria-label"), /bílý pěšec/);
    await drag("f1", "c4");
    await player.waitFor();
    assert.match(await page.locator(".move-history").innerText(), /Bc4.*Nc6/s);
    assert.match(
      await page.locator(".stats").innerText(),
      /1\s+Správných tahů/,
    );
    // Exact replay still rejects another accepted first-pass move, including by drag.
    await page
      .getByRole("button", { name: "Zopakovat stejnou variantu", exact: true })
      .click();
    await player.waitFor();
    const replay = await page.locator(".move-history").innerText();
    await drag("g1", "f3");
    assert.equal(await page.locator(".move-history").innerText(), replay);
    assert.match(
      await page.locator(".feedback").innerText(),
      /není tah zaznamenané větve/,
    );
    await drag("f1", "c4");
    await page
      .getByRole("heading", { name: "Dosavadní část zopakovaná.", exact: true })
      .waitFor();
    assert.match(await page.locator(".move-history").innerText(), /Bc4.*Nc6/s);
    const completed = await page.locator(".move-history").innerText();
    await drag("g1", "f1", false);
    assert.equal(
      await page.locator(".move-history").innerText(),
      completed,
      "paused/completed board must ignore drags",
    );
    // Reversed orientation maps pointer coordinates to the same chess squares.
    await page
      .getByRole("button", { name: "Upravit úvod a nastavení", exact: true })
      .click();
    await apply("e4");
    await page.locator("#color").click();
    await page
      .getByRole("option", { name: "Černé figury", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Spustit trénink", exact: true })
      .click();
    await player.waitFor();
    assert.ok((await point("a8")).y > (await point("a1")).y);
    await drag("g8", "f6");
    await player.waitFor();
    assert.match(await page.locator(".move-history").innerText(), /Nf6.*d3/s);
    assert.match(
      await page.locator(".stats").innerText(),
      /1\s+Správných tahů/,
    );
    // A valid move after all cancellations still works; no phantom selections remain.
    assert.equal(
      await page.locator(".drag-ghost, .drag-source, .drag-target").count(),
      0,
    );
    if (input === "touch") {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: "outputs/drag-mobile.png",
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS ${input}: drag/click coexist, jitter, invalid/outside/Esc/cancel/blur rollback, capture/castling/promotion, repertoire scoring, exact replay and reversed board.`,
    );
  }
} finally {
  await browser.close();
}
