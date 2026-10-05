# Chessbot

[Otevřít aplikaci](https://oselposel.github.io/chessbot/)

Osobní trénink šachových zahájení podle repertoáru libovolného hráče na Lichessu. Data se načítají z Player Exploreru pro aktuální pozici, nikoli stahováním balíku partií.

## Použití

1. Přihlas se přes Lichess svým účtem. Nickname hráče, jehož repertoár kopíruješ, může být jiný.
2. Zvol barvu a zadej úvodní tahy zápisem nebo na šachovnici za obě strany. Mezinárodní SAN: `1. e4 e5 2. Nf3 Nc6`; UCI: `e2e4 e7e5 g1f3 b8c6`. Prázdný úvod začíná ze základní pozice.
3. Zvol režim, četnost, délku pokračování a způsob losování soupeře. Pak spusť trénink.
4. Po dokončení zopakuj přesně stejnou větev, nebo vylosuj jiné pokračování ze stejného úvodu.

## Hodnocení a souvislé varianty

- **Repertoár:** správná je každá doložená odpověď nad zvoleným prahem (všechny, 5 %, 10 %). Nejčastější tah se zachovává vždy. Podíl se počítá mezi doloženými legálními pokračováními dané pozice.
- **Konkrétní varianta:** při prvním průchodu se očekává nejčastější odpověď hráče z prvních použitelných dat; cíl se v téže pozici při další indexaci nemění. Soupeř se losuje. Doložené alternativy nejsou šachové chyby, ale nechají pozici beze změny.
- **Průběžná data:** hrát lze hned po prvním snapshotu s tahy. Během indexace se přijímají všechny doložené odpovědi bez prahu četnosti; neznámé tahy se zatím nepočítají jako chyby. Prázdný průběžný snapshot není konec větve.
- **Opakování:** očekává přesně zaznamenané odpovědi a stejné soupeřovy tahy, i když původní průchod byl v režimu repertoáru. Používá uložené snapshoty bez síťových požadavků.
- Úvod se automaticky přehraje. Skóre a limit 4/8/12/16 úplných tahů se počítají až od konce úvodu.
- Trénink končí dosažením limitu, koncem partie nebo chybějícím doloženým pokračováním. Neznamená to vyčerpání všech možných větví ani procvičení celé partie.
- Síťová chyba, timeout a nedokončená indexace trénink pozastaví. Tlačítko „Obnovit pozici“ pokračuje ze stejného místa; nejde o konec repertoáru.
- Nápověda ukazuje tahy, četnosti, podíly a cíl pevné větve. Tah mimo data nemusí být šachově špatný: aplikace nepoužívá engine.

## Přihlášení a soukromí

OAuth Authorization Code s PKCE/S256 a náhodným `state`. Nevyžaduje client secret ani dodatečné OAuth scopes. Heslo se zadává pouze na Lichessu. Callback se vrací na kořen aplikace `/chessbot/`, takže na GitHub Pages nepotřebuje další route. Kód se před výměnou odstraní z adresy; přístupový token se neposílá v URL ani na GitHub, jen v hlavičce požadavků na Lichess.

Token s expirací a rozpracovaný úvod jsou v `sessionStorage` této karty, nikoli v `localStorage`, repozitáři nebo backendu. Skóre, větev a cache pozic jsou pouze v paměti. Odhlášení odstraní lokální token, vymaže cache a pokusí se token odvolat také na Lichessu. Pokud síťové odvolání selže, aplikace upozorní na možnost odebrat autorizaci v nastavení Lichessu.

Explorer může nejprve vrátit neúplné snapshoty během indexace. Aplikace je průběžně zobrazuje, zatímco stream pokračuje na pozadí. Teprve korektní konec streamu s poslední pozicí ve frontě `0` (nebo bez tohoto údaje) potvrzuje dokončená data; samotná `queuePosition: 0` během otevřeného streamu dokončení neznamená. Při zahrání tahu se starý požadavek zruší a načítá se další pozice. Požadavky jsou sériové, cache rozlišuje hráče/barvu/pozici a platí 10 minut pro dokončená data; průběžná data lze ukázat z cache po dobu 30 sekund, ale vždy se znovu načítají (nejvýše 500 pozic). Po HTTP 429 se čeká alespoň minutu. Více karet nemá sdílený omezovač; používej jednu relaci.

## Spuštění a nasazení

Node.js **24+** (testy používají nativní TypeScript strip) a npm:

```sh
cd web
npm ci
npm run dev:pages
```

Otevři vypsanou lokální adresu s cestou `/chessbot/`. Produkční sestavení a náhled:

```sh
npm run build:pages
npm run preview:pages
```

GitHub Actions automaticky sestaví a nasadí `web/dist-pages` při pushi do `main`. Konfigurace je v `.github/workflows/pages.yml` a `web/vite.pages.config.ts`. Aplikace a kód jsou veřejné; žádný serverový tajný klíč není potřeba. `npm run dev`/`build` zůstávají pro původní Vinext/Sites runtime; jeho staré nasazení se tímto workflow neaktualizuje.

## Ověření

```sh
cd web
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build:pages
```

Volitelný browser test (Playwright + Microsoft Edge): nastav `PLAYWRIGHT_MODULE` na absolutní cestu k `playwright/index.mjs` a spusť `node tests/browser.qa.mjs`. `APP_ORIGIN` určuje adresu včetně `/chessbot`, bez koncového lomítka. Test mockuje OAuth a Explorer: nepřihlašuje skutečný účet ani neověřuje autorizovaný živý import. Ověřuje PKCE roundtrip, zachování úvodu, obě barvy, alternativy, rošádu, síťové chyby, přesné opakování bez požadavků, odhlášení a mobilní layout.

Hlavní soubory: `web/app/page.tsx` (UI a průchod), `web/lib/lichess-auth.ts` (OAuth), `web/lib/explorer.ts` (NDJSON/cache), `web/lib/training.ts` (úvod a hodnocení). `web/lib/repertoire.ts` a serverová export route zůstávají pro původní import a testy; nové rozhraní je nepoužívá pro stahování partií.

[Lichess OAuth](https://lichess.org/api#tag/OAuth) · [Player Explorer](https://lichess.org/api#tag/Opening-Explorer/operation/openingExplorerPlayer)
