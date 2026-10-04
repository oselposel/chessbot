// Optional end-to-end QA. Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  // Lichess rejects the HeadlessChrome marker; use the normal browser UA for live API QA.
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (useLive && /\/api\/games(?:\?|\/user\/)/.test(response.url()))
    console.log("Live request:", response.status(), response.url());
});
const name = "TestPlayer";
const fixture = (id, moves, color = "white") => ({
  id,
  moves,
  variant: "standard",
  status: "resign",
  players: { [color]: { user: { id: name.toLowerCase(), name } } },
  opening: { eco: "C50", name: "Italian Game" },
});
const white = [
  fixture("a", "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O"),
  fixture("b", "d4 d5 c4 e6 Nc3 Nf6"),
];
const black = [fixture("c", "e4 c5 Nf3 d6 d4 cxd4 Nxd4", "black")];
let useLive = false;
await page.route(/\/api\/games(?:\?|\/user\/)/, async (route) => {
  if (useLive) return route.continue();
  const url = new URL(route.request().url());
  if ((url.searchParams.get("username") || url.pathname.split("/").pop()) === "MissingPlayer")
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Hráč nebyl nalezen." }),
    });
  const games = url.searchParams.get("color") === "black" ? black : white;
  return route.fulfill({
    status: 200,
    contentType: "application/x-ndjson",
    body: games.map((x) => JSON.stringify(x)).join("\n") + "\n",
  });
});
const choose = async (id, label) => {
  await page.locator("#" + id).click();
  await page.getByRole("option", { name: label, exact: true }).click();
};
const move = async (from, to) => {
  await page
    .getByRole("button", { name: new RegExp("^" + from + "(?:,|$)") })
    .click();
  await page
    .getByRole("button", { name: new RegExp("^" + to + "(?:,|$)") })
    .click();
};
const waitPlayer = async () => {
  await page
    .getByText("Klikni na figuru a cílové pole", { exact: true })
    .waitFor();
};
try {
  await page.goto(origin + "/");
  await page
    .getByRole("heading", { name: "Hraj jako tvůj oblíbený hráč." })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.ready === "true",
  );
  await page.locator("#nickname").fill(name);
  await choose("sample", "100 partií · rychlé načtení");
  await page
    .getByRole("button", { name: "Načíst repertoár", exact: true })
    .click();
  await waitPlayer();
  assert.match(await page.locator(".loaded-info").innerText(), /2 partií/);
  await move("a2", "a3");
  assert.match(
    await page.locator(".feedback").innerText(),
    /v načteném repertoáru hráče není/,
  );
  assert.match(await page.locator(".board-badge").innerText(), /^0 \/ /);
  await page.getByRole("button", { name: "Nápověda", exact: true }).click();
  assert.match(await page.locator(".hint-list").innerText(), /e4/);
  assert.match(await page.locator(".hint-list").innerText(), /d4/);
  await move("e2", "e4");
  await waitPlayer();
  assert.match(await page.locator(".move-history").innerText(), /e4.*e5/s);
  await move("g1", "f3");
  await waitPlayer();
  await move("f1", "c4");
  await waitPlayer();
  await move("e1", "g1");
  await page
    .getByRole("heading", { name: "Varianta dokončena.", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Nová varianta", exact: true })
    .click();
  await waitPlayer();
  await move("d2", "d4");
  await waitPlayer();
  assert.match(await page.locator(".move-history").innerText(), /d4.*d5/s);
  await page.locator("#nickname").fill("MissingPlayer");
  await page
    .getByRole("button", { name: "Načíst repertoár", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.locator(".loaded-info").innerText(), /TestPlayer/);
  await page.locator("#nickname").fill(name);
  await choose("color", "Černé figury");
  await page
    .getByRole("button", { name: "Načíst repertoár", exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector(".loaded-info")?.textContent.includes("černé"));
  await waitPlayer();
  assert.match(await page.locator(".move-history").innerText(), /e4/);
  assert.equal(
    await page.locator(".square").first().getAttribute("aria-label"),
    "h1, bílá věž",
  );
  await move("c7", "c5");
  await waitPlayer();
  assert.match(await page.locator(".move-history").innerText(), /c5.*Nf3/s);
  await page.screenshot({
    path: "outputs/trainer-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "outputs/trainer-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "mobile must not overflow horizontally",
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  // Verify a real anonymous Lichess request, including CORS for the static build.
  useLive = true;
  await page.locator("#nickname").fill("DrNykterstein");
  await page
    .getByRole("button", { name: "Načíst repertoár", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".loading-info"),
    {},
    { timeout: 90_000 },
  );
  if (await page.locator(".load-error").count())
    throw new Error(
      "Live import: " + (await page.locator(".load-error").innerText()),
    );
  assert.match(await page.locator(".loaded-info").innerText(), /DrNykterstein/);
  await waitPlayer();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: loading, two accepted opening branches, wrong answer rollback, hints, opponent response, castling, terminal state, restart, failed import preservation, black orientation, mobile layout, live Lichess import.",
  );
  console.log(await page.locator(".loaded-info").innerText());
} finally {
  await browser.close();
}
