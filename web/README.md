# Chessbot · Opening studio

[Veřejná aplikace](https://oselposel.github.io/chessbot/)

Přihlášení přes Lichess (OAuth PKCE), vlastní úvod SAN/UCI nebo zadání na šachovnici, Player Explorer načítaný podle pozice, režim repertoáru/pevné varianty a přesné opakování celé zaznamenané větve ze stejného úvodu.

Úplný popis hodnocení, přihlášení, soukromí, cache a nasazení najdeš v [README projektu](../README.md).

## Lokální vývoj

Node.js 24+:

```sh
npm ci
npm run dev:pages
```

Použij adresu s cestou `/chessbot/`. Sestavení: `npm run build:pages`; náhled: `npm run preview:pages`. Původní Vinext/Sites runtime zůstává přes `npm run dev`/`build`; GitHub Actions nasazuje jen statickou verzi.

## Testy

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build:pages
```

```powershell
$env:PLAYWRIGHT_MODULE = 'ABSOLUTNI_CESTA_K_PLAYWRIGHT/index.mjs'
$env:APP_ORIGIN = 'http://127.0.0.1:5174/chessbot'
node tests/browser.qa.mjs
node tests/streaming.browser.qa.mjs
node tests/single-game.browser.qa.mjs
```

Browser QA mockuje OAuth i Explorer. Ověřuje tok přihlášení a trénink, ale nespotřebovává autorizaci skutečného účtu. Živý autorizovaný import vyžaduje ruční přihlášení uživatele.

Streaming QA používá skutečné otevřené `ReadableStream` s mockovanými daty. Ověřuje hraní před koncem indexace, průběžné nápovědy, stabilní cíl větve, bezpečné hodnocení neznámých tahů a uvolnění fronty při přechodu na další pozici.

Single-game QA ověřuje upozornění až po potvrzení jediné partie, pozastavení hráče i soupeře, přesné opakování, výběr jiné pozice, pokračování bez dalších upozornění v daném průchodu a mobilní/tabletový layout.
