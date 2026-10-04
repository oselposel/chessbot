# Chessbot · Opening studio

Osobní trénink šachových zahájení podle dokončených partií vybraného hráče na Lichessu. Zadej nickname, vyber barvu figur a načti 100, 300 nebo 1 000 nejnovějších partií. Správnými odpověďmi jsou tahy doložené v načteném repertoáru; soupeř náhodně vybírá z jeho skutečných odpovědí.

## Lokální spuštění

Veřejná aplikace: [GitHub Pages](https://oselposel.github.io/chessbot/).

Pro statickou verzi bez serveru spusť `npm run dev:pages`; produkční sestavení vytvoří `npm run build:pages` do `dist-pages`, náhled spustí `npm run preview:pages`. Použij adresu s cestou `/chessbot/`. Na GitHubu probíhá sestavení a nasazení automaticky při pushi do `main`, podle `.github/workflows/pages.yml`.

Statická verze stahuje partie přímo z Lichessu (CORS, NDJSON, bez tokenu). Nemá serverové API. Zachovává stejné rozhraní i tréninkovou logiku jako původní Sites verze popsaná níže.

Node.js 22.13+ a npm:

```sh
npm install
npm run dev
```

Otevři http://127.0.0.1:5173. Token Lichessu není pro veřejné dokončené partie potřeba. Data i skóre zůstávají pouze v paměti stránky. Hloubka tréninku je 8, 12 nebo 16 úplných tahů; konec dostupného repertoáru ukončí variantu dříve.

## Ověření

```sh
node --test tests/repertoire.test.mjs
npx tsc --noEmit
npm run build
```

Volitelné end-to-end ověření přes nainstalovaný Playwright a Microsoft Edge:

```powershell
$env:PLAYWRIGHT_MODULE = 'ABSOLUTNI_CESTA_K_PLAYWRIGHT/index.mjs'
node tests/browser.qa.mjs
```

`APP_ORIGIN` přepne test na jinou adresu, například na lokálně spuštěný produkční Worker. Test ověří bílé i černé, chybné a správné odpovědi, nápovědu, rošádu, restart, mobilní rozložení i živý import Lichessu.

## Struktura

- `app/page.tsx`: trénink, šachovnice a rozhraní.
- `app/api/games/route.ts`: streamovaný export z Lichessu, validace parametrů, timeout a omezení souběžných požadavků.
- `lib/repertoire.ts`: index pozic, transpozice, četnosti a náhodný výběr tahů.
- `app/studio.css`, `app/training.css`: responzivní vzhled.

Repertoár spojuje shodné pozice podle FEN bez počítadel tahů. Tah mimo vzorek není hodnocený jako chyba šachovým enginem. Po chybě lze odpověď opakovat nebo zobrazit doložené tahy. Síťová chyba zahodí nedokončený import a zachová předchozí repertoár.

Prohlížeč omezuje stahování na jeden současný stream a po HTTP 429 dodržuje alespoň minutovou pauzu. Sites server omezuje souběh i na instanci. Více karet ani serverových instancí nemá sdílený omezovač. Pro osobní použití je jedna otevřená relace očekávaný režim.

Rozhraní také volitelně registruje WebMCP nástroje ve podporovaných prohlížečích. Jejich ověření v podporovaném WebMCP prostředí zde nebylo dostupné; běžný webový trénink na této funkci nezávisí.

Použité technologie: React, Vite (GitHub Pages), Vinext (Sites), chess.js. Původní Cloudflare Worker nasazení spravuje Sites; identita je v `.openai/hosting.json`. GitHub Pages používá samostatný statický entry point `pages/main.tsx` se společnou tréninkovou komponentou.

[Dokumentace exportu partií Lichessu](https://lichess.org/api#tag/Games/GET/api/games/user/{username})
