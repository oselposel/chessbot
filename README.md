# Chessbot

[Otevřít aplikaci](https://oselposel.github.io/chessbot/)

Osobní trénink šachových zahájení podle repertoáru libovolného hráče na Lichessu. Data se načítají z Player Exploreru pro aktuální pozici, nikoli stahováním balíku partií.

## Použití

1. Přihlas se přes Lichess svým účtem. Nickname hráče, jehož repertoár kopíruješ, může být jiný.
2. Zvol barvu a zadej úvodní tahy zápisem nebo na šachovnici za obě strany, klikáním či přetahováním figurek. Mezinárodní SAN: `1. e4 e5 2. Nf3 Nc6`; UCI: `e2e4 e7e5 g1f3 b8c6`. Prázdný úvod začíná ze základní pozice.
3. Zvol režim, délku pokračování a způsob losování soupeře. Pak spusť trénink.
4. Kdykoli po prvním odehraném tahu použij „Zopakovat stejnou variantu“, i před dokončením. Při opakování musíš zahrát stejné uznané odpovědi a soupeř zopakuje své stejné tahy. Po procvičení rozpracované větve můžeš pokračovat od poslední dosažené pozice; po dokončení lze také vylosovat jiné pokračování ze stejného úvodu.

## Hodnocení a souvislé varianty

- **Ovládání šachovnice:** tah lze zadat dvěma kliknutími nebo přetažením figury myší, prstem či perem. Tažení se od běžného kliknutí odlišuje po pohybu alespoň 6 px; figura sleduje ukazatel, výchozí figura se dočasně skryje a cílové pole se zvýrazní. Táhnout lze jen figurou strany na tahu; během tréninku pouze v hráčově fázi. Pro obě metody platí stejné ověření legality, repertoáru a přesné větve. Rošáda se zadává tažením krále na cílové pole, proměna nabídne výběr figury včetně podproměny. Puštění mimo šachovnici, na stejné pole, Esc, přerušení dotyku, změna pozice/orientace, scroll, resize nebo ztráta fokusované karty tažení zruší. Neuznaná odpověď vrátí figuru podle běžných pravidel skórování; drop sám nevytváří druhé kliknutí. Dotykové posouvání stránky je zakázané jen na právě táhnutelných figurách, nikoli na celé stránce. Klávesové ovládání tlačítek a slabá nápověda zůstávají zachované.
- **Repertoár:** vždy se uznává nejhranější tah. Druhý se uznává také, pokud dosahuje alespoň 80 % četnosti prvního (poměr počtů, ne rozdíl 20 procentních bodů). Například 45 % / 40 % uznáme obojí, 45 % / 30 % jen první. Další tahy se neuznávají kromě shodné četnosti na uznávaném pořadí; vazby se nerozhodují podle pořadí odpovědi API. Není zde absolutní minimum 20 % ani výběr starých prahů.
- **Procenta:** četnost tahu se dělí celkovým počtem partií hráče v dané pozici z Exploreru, ne pouze součtem zobrazených tahů. Podíl a počty ukazuje odhalení odpovědi i její hodnocení. Zaokrouhlení zobrazených procent nemění uznávání; rozhodují skutečné počty.
- **Konkrétní varianta:** při prvním průchodu se doporučuje nejhranější odpověď a blízká druhá volba se také uznává. Doporučení se může při indexaci aktualizovat. Soupeř se losuje; po dokončení se přesně opakuje skutečně zahraná větev. Doložený tah mimo toleranci není označován za šachovou chybu, ale nepokračuje se jím.
- **Průběžná data:** hrát lze hned po prvním snapshotu s tahy a hodnotí se aktuální top dvě s tolerancí. Podíly i pořadí se mohou ještě změnit; tah mimo aktuální toleranci ani neznámý tah se zatím nepočítá jako chyba. Prázdný průběžný snapshot není konec větve.
- **Jediná partie:** když dokončená indexace potvrdí v pozici právě jednu partii (ne pouze jeden možný tah), trénink se pozastaví i na tahu soupeře. Můžeš zopakovat dosavadní větev, vylosovat jiné pokračování ze stejného úvodu, vybrat jinou pozici v editoru nebo pokračovat v této jedné partii. Editor převezme aktuální větev; pomocí „Zpět“ se můžeš vrátit k dřívější pozici. Potvrzení pokračování platí do konce daného průchodu; přesné opakování upozornění nepřerušuje. Pokud za úvodem ještě nejsou zahrané tahy, opakování je nedostupné.
- **Opakování:** lze spustit i během hry, tahu soupeře, načítání nebo pozastavení, jakmile je zaznamenaný alespoň jeden tah za úvodem. Očekává přesně dříve uznané odpovědi a stejné soupeřovy tahy, i když původní průchod byl v režimu repertoáru a jiná odpověď je častější nebo podobně častá. Používá uložené snapshoty bez síťových požadavků, zruší aktuální načítání/čekání soupeře a skončí na konci zaznamenané části; žádné další tahy nevymýšlí. Po procvičení rozpracované větve nabídne „Pokračovat od poslední pozice“, čímž se nové tahy připojují k původnímu záznamu. Opakovaný restart během procvičování zachová celou původní zaznamenanou část, ne pouze už zopakovaný úsek.
- Úvod se automaticky přehraje. Skóre a limit 4/8/12/16 úplných tahů se počítají až od konce úvodu.
- Trénink končí dosažením limitu, koncem partie nebo chybějícím doloženým pokračováním. Neznamená to vyčerpání všech možných větví ani procvičení celé partie.
- Při 45 sekundách bez změny výsledků/fronty aplikace zruší nečinný stream a nejvýše dvakrát obnoví spojení, s odstupem 5 a 10 sekund. Prázdné keepalive řádky ani opakované stejné snapshoty se nepočítají jako pokrok. Jeden pokus má navíc pevný limit 120 sekund. Zrušení nebo zahrání tahu ukončí i čekání na opakovaný pokus; zaseknuté rušení streamu neblokuje další pozice.
- Tlačítko „Obnovit pozici“ je dostupné i během indexace a pokračuje ze stejného místa se zachováním tahů a skóre. Po vyčerpání automatických pokusů, síťové chybě nebo nedokončeném konci streamu se trénink pozastaví s možností ruční obnovy; nejde o konec repertoáru. Chyby přihlášení a HTTP 429 se automaticky neopakují.
- **Nápověda** jen zakroužkuje figuru na šachovnici, bez výběru figury, cílového pole, seznamu tahů nebo varianty enginu. Při prvním průchodu jde o figuru nejhranějšího uznávaného tahu; při opakování vždy o figuru původní zaznamenané odpovědi. Při změně průběžných dat se aktualizuje. Na mobilu se zvýrazněná figura posune do záběru.
- **Prozradit správnou odpověď** ukáže konkrétní SAN tah, další uznávané odpovědi a četnosti/podíly všech doložených tahů. Při opakování uznává pouze zaznamenaný tah. Pokud je engine zapnutý, zároveň odhalí jeho doporučené pokračování, jasně oddělené od repertoáru. Samo nic nezahraje; nápověda a odhalení se počítají jako jedna asistovaná pozice a po tahu/restartu se skryjí. Procento poslední uznané odpovědi zůstává viditelné i po tahu soupeře.
- **Engine:** u šachovnice lze zapnout/vypnout lokální Stockfish 19 Lite single-threaded WASM. Poprvé je vypnutý, stáhne se až po zapnutí (JS/WASM přibližně 1,8 MB) a preference platí jen pro tuto kartu v `sessionStorage`. Běží v samostatném Web Workeru, s 16 MB hash tabulkou a limitem hloubky 20 nebo 1,5 s na pozici; průběžně ukazuje hodnocení i dosaženou hloubku. `+` je výhoda bílého, `−` černého, `M` mat. Lišta je orientační škála výhody, nikoli pravděpodobnost výhry. Při změně FEN zastaví starý výpočet a ignoruje jeho výsledky, dokončená hodnocení si pamatuje v paměti (100 pozic). Vypnutí ukončí worker. Chyba/timeout enginu nepozastaví trénink a nabízí nový pokus. Jedná se o lehčí NNUE síť a krátký výpočet, nikoli plnou serverovou analýzu.
- Engine nikdy nemění uznávání odpovědí podle repertoáru, počet chyb ani soupeřovy tahy. Samotná analýza neposílá pozice na server; běžné požadavky na Lichess Player Explorer zůstávají beze změny. Zdrojový kód enginu, NNUE síť, GPLv3 a původ nezměněných release assetů jsou dostupné v `web/public/engine/stockfish-19/` i přes odkazy v panelu enginu.

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
