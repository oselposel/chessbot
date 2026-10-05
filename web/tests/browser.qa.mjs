// Deterministic end-to-end QA of the real app, with OAuth and Explorer responses mocked.
// No user account, secret, or live authorization is used by this test.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Chess } from "chess.js";
import { uci, positionKey } from "../lib/repertoire.ts";
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const origin = (
  process.env.APP_ORIGIN || "http://127.0.0.1:5174/chessbot"
).replace(/\/$/, "");
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const graph = new Map();
for (const [line, amount] of [
  ["e4 e5 Nf3 Nc6 Bc4 Bc5 O-O", 60],
  ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4", 40],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4", 30],
]) {
  const chess = new Chess();
  for (const token of line.split(" ")) {
    const key = positionKey(chess);
    const move = chess.move(token);
    if (!graph.has(key)) graph.set(key, new Map());
    const existing = graph.get(key).get(uci(move));
    graph.get(key).set(uci(move), {
      uci: uci(move),
      san: move.san,
      white: amount + (existing?.white || 0),
      draws: 0,
      black: 0,
    });
  }
}
let tokenExchanges = 0,
  requests = 0,
  fail = null;
let challenge;
await context.route("https://lichess.org/oauth?*", async (route) => {
  const url = new URL(route.request().url());
  const params = url.searchParams;
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.has("scope"), false);
  assert.equal(params.has("code_verifier"), false);
  assert.equal(params.get("redirect_uri"), origin + "/");
  challenge = params.get("code_challenge");
  const callback = new URL(params.get("redirect_uri"));
  callback.search = new URLSearchParams({
    code: "test-code",
    state: params.get("state"),
  }).toString();
  await route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<meta charset="utf-8"><h1>Testovací přihlášení</h1><a href="${callback.href.replaceAll("&", "&amp;")}">Potvrdit testovací přihlášení</a>`,
  });
});
await context.route("https://lichess.org/api/token", async (route) => {
  if (route.request().method() === "DELETE")
    return route.fulfill({ status: 204 });
  tokenExchanges++;
  const params = new URLSearchParams(route.request().postData());
  assert.equal(params.get("code"), "test-code");
  const hash = Buffer.from(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(params.get("code_verifier")),
    ),
  ).toString("base64url");
  assert.equal(hash, challenge);
  assert.equal(params.has("client_secret"), false);
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      access_token: "fake-test-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
  });
});
await context.route("https://lichess.org/api/account", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ username: "MyAccount" }),
  }),
);
await context.route("https://explorer.lichess.org/player?*", async (route) => {
  requests++;
  assert.equal(
    route.request().headers().authorization,
    "Bearer fake-test-token",
  );
  const url = new URL(route.request().url());
  assert.equal(url.searchParams.get("player"), "TestPlayer");
  if (fail) {
    const status = fail;
    fail = null;
    return route.fulfill({ status, body: "" });
  }
  const key = positionKey(new Chess(url.searchParams.get("fen")));
  const moves = [...(graph.get(key)?.values() || [])];
  const data = {
    queuePosition: 0,
    moves,
    white: moves.reduce((n, m) => n + m.white, 0),
    draws: 0,
    black: 0,
    opening: { eco: "C50", name: "Italian Game" },
  };
  await route.fulfill({
    contentType: "application/x-ndjson",
    body:
      JSON.stringify({ ...data, moves: [], queuePosition: 3 }) +
      "\n\n" +
      JSON.stringify(data) +
      "\n",
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
const waitPlayer = () =>
  page.getByText("Klikni na figuru a cílové pole", { exact: true }).waitFor();
const complete = () =>
  page
    .getByRole("heading", { name: "Varianta dokončena.", exact: true })
    .waitFor();
const edit = () =>
  page
    .getByRole("button", { name: "Upravit úvod a nastavení", exact: true })
    .click();
try {
  await page.goto(origin + "/");
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.ready === "true",
  );
  await page.locator("#nickname").fill("TestPlayer");
  assert.equal(
    await page
      .getByRole("button", { name: "Spustit trénink", exact: true })
      .isDisabled(),
    true,
  );
  // The editor accepts moves for both sides without login or network calls.
  await move("e2", "e4");
  await move("e7", "e5");
  assert.match(await page.locator("#opening").inputValue(), /e4 e5/);
  assert.equal(requests, 0);
  await page.getByRole("button", { name: "Zpět", exact: true }).click();
  assert.match(await page.locator("#opening").inputValue(), /e4/);
  await page.locator("#opening").fill("1. e4 e5 2. Nf3 Nc6");
  await page
    .getByRole("button", { name: "Zobrazit úvod", exact: true })
    .click();
  // Test a full same-tab OAuth round trip, preserving settings across navigation.
  await page
    .getByRole("button", { name: "Přihlásit přes Lichess", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Potvrdit testovací přihlášení" })
    .click();
  await page.getByText("Přihlášen jako MyAccount", { exact: true }).waitFor();
  assert.equal(page.url(), origin + "/");
  assert.equal(tokenExchanges, 1);
  assert.equal(await page.locator("#nickname").inputValue(), "TestPlayer");
  assert.match(await page.locator("#opening").inputValue(), /Nf3 Nc6/);
  await page
    .getByRole("button", { name: "Spustit trénink", exact: true })
    .click();
  await waitPlayer();
  assert.equal(requests, 1);
  assert.match(await page.locator(".board-badge").innerText(), /^0 \/ /);
  await move("a2", "a3");
  assert.match(
    await page.locator(".feedback").innerText(),
    /v datech této pozice není/,
  );
  assert.match(await page.locator(".board-badge").innerText(), /^0 \/ /);
  await page.getByRole("button", { name: "Nápověda", exact: true }).click();
  assert.match(await page.locator(".hint-list").innerText(), /Bc4/);
  assert.match(await page.locator(".hint-list").innerText(), /Bb5/);
  // The second-most-common answer is accepted in repertoire mode.
  await move("f1", "b5");
  await waitPlayer();
  assert.match(await page.locator(".move-history").innerText(), /Bb5.*a6/s);
  await move("b5", "a4");
  await complete();
  const originalHistory = await page.locator(".move-history").innerText();
  const firstRequests = requests;
  assert.match(await page.locator(".round-summary").innerText(), /a3/);
  await page
    .getByRole("button", { name: "Zopakovat stejnou variantu", exact: true })
    .click();
  await waitPlayer();
  await move("f1", "c4");
  assert.match(
    await page.locator(".feedback").innerText(),
    /není tah zaznamenané větve/,
  );
  assert.match(await page.locator(".stats").innerText(), /0\s+Mimo repertoár/);
  await move("f1", "b5");
  await waitPlayer();
  await move("b5", "a4");
  await complete();
  assert.equal(
    await page.locator(".move-history").innerText(),
    originalHistory,
  );
  assert.equal(
    requests,
    firstRequests,
    "exact replay must use recorded positions, not fetch",
  );
  // A new branch keeps the seed and accepts another relevant answer, including castling.
  await page
    .getByRole("button", {
      name: "Jiné pokračování ze stejného úvodu",
      exact: true,
    })
    .click();
  await waitPlayer();
  await move("f1", "c4");
  await waitPlayer();
  await move("e1", "g1");
  await complete();
  assert.match(
    await page.locator(".move-history").innerText(),
    /e4.*e5.*Nf3.*Nc6.*Bc4.*Bc5.*O-O/s,
  );
  // A fixed-line round guides the principal answer without calling alternatives mistakes.
  await edit();
  await choose("policy", "Konkrétní varianta · hlavní tah");
  await page
    .getByRole("button", { name: "Spustit trénink", exact: true })
    .click();
  await waitPlayer();
  await move("f1", "b5");
  assert.match(
    await page.locator(".feedback").innerText(),
    /platná alternativa/,
  );
  await page.getByRole("button", { name: "Nápověda", exact: true }).click();
  assert.match(await page.locator(".hint-list").innerText(), /Bc4 · cíl/);
  await move("f1", "c4");
  await waitPlayer();
  await move("e1", "g1");
  await complete();
  await page.screenshot({
    path: "outputs/trainer-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "outputs/trainer-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  // Black training automatically plays the opponent's move after an odd-length seed.
  await edit();
  await choose("color", "Černé figury");
  await choose("policy", "Repertoár · více správných odpovědí");
  await page.locator("#opening").fill("1. e4 c5");
  await page
    .getByRole("button", { name: "Spustit trénink", exact: true })
    .click();
  await waitPlayer();
  assert.equal(
    await page.locator(".square").first().getAttribute("aria-label"),
    "h1, bílá věž",
  );
  assert.match(await page.locator(".move-history").innerText(), /e4.*c5.*Nf3/s);
  await move("d7", "d6");
  await waitPlayer();
  await move("c5", "d4");
  await complete();
  // A transport error pauses rather than pretending the line is complete; retry preserves seed.
  await edit();
  await choose("color", "Bílé figury");
  await page.locator("#opening").fill("1. d4");
  fail = 503;
  await page
    .getByRole("button", { name: "Spustit trénink", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Trénink pozastaven.", exact: true })
    .waitFor();
  assert.match(await page.locator(".move-history").innerText(), /d4/);
  await page
    .getByRole("button", { name: "Obnovit pozici", exact: true })
    .click();
  await complete();
  // Logout revokes the token and clears the local session.
  await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
  await page
    .getByRole("button", { name: "Přihlásit přes Lichess", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("chessbot.lichess.session.v1"),
    ),
    null,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: PKCE OAuth roundtrip, preserved draft, board editor, on-demand final snapshots, multiple answers, wrong rollback, exact replay without requests, same-seed branching, fixed-line alternatives, castling, black orientation, retry, mobile layout and logout.",
  );
} catch (error) {
  console.log("QA failed at", page.url().split("?")[0]);
  console.log((await page.locator("body").innerText()).slice(0, 3000));
  await page.screenshot({ path: "outputs/qa-failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}
