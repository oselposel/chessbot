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
node tests/frequency.browser.qa.mjs
node tests/replay.browser.qa.mjs
node tests/recovery.browser.qa.mjs
node tests/engine.browser.qa.mjs
```

Browser QA mockuje OAuth i Explorer. Ověřuje tok přihlášení a trénink, ale nespotřebovává autorizaci skutečného účtu. Živý autorizovaný import vyžaduje ruční přihlášení uživatele.

Streaming QA používá skutečné otevřené `ReadableStream` s mockovanými daty. Ověřuje hraní před koncem indexace, aktualizované nápovědy a pořadí tahů, bezpečné hodnocení neznámých tahů a uvolnění fronty při přechodu na další pozici.

Single-game QA ověřuje upozornění až po potvrzení jediné partie, pozastavení hráče i soupeře, přesné opakování, výběr jiné pozice, pokračování bez dalších upozornění v daném průchodu a mobilní/tabletový layout.

Frequency QA ověřuje top dvě volby s relativní tolerancí 80 %, přesnou hranici bez zaokrouhlení, shody četností, nejhranější tah pod absolutními 20 %, procenta z celkového počtu partií a odstranění starých nastavení prahu.

Replay QA ověřuje opakování před koncem, během načítání či tahu soupeře a po chybě, vynucení původních odpovědí za obě barvy, stejné tahy soupeře bez losování i síťových požadavků, zrušení starých požadavků/timerů, restart uvnitř opakování a pokračování s rozšířením původního záznamu.

Recovery QA ověřuje nečinný stream s frontou 29, automatickou obnovu, omezený počet pokusů, zrušení při čekání na obnovu, uvolnění fronty i při zaseknutém rušení spojení a ruční obnovu bez ztráty tahů nebo skóre. Časovače jsou v izolovaném prohlížeči zrychlené; unit testy navíc ověřují keepalive řádky, nezměněné snapshoty, měnící se frontu a zaseknuté hlavičky odpovědi.

Engine QA spouští skutečný vendored Stockfish WASM (trénink/OAuth nadále mockuje). Ověřuje stažení až po zapnutí, výpočet v prohlížeči, mat za černého, hloubku, změny pozic, skrytou PV, vypnutí a obnovu po chybě. Nápověda musí zvýraznit pouze výchozí figuru bez cílových polí; plná odpověď odhalí SAN/PV bez zahrání tahu a při přesném opakování respektuje zaznamenaný tah místo nejhranějšího. Unit testy kontrolují znaménko pro obě strany, bounds, SAN/promotion/castling, cache, přerušení výpočtu a ochranu před zastaralými výsledky.
