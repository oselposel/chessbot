# chessbot

Osobní webový trénink šachových zahájení podle skutečných partií hráče na Lichessu.

[Otevřít aplikaci](https://oselposel.github.io/chessbot/)

## GitHub Pages

Statická verze se automaticky sestavuje a nasazuje přes GitHub Actions při pushi do `main`. Komunikuje s veřejným Lichess API přímo z prohlížeče, bez serveru a bez tokenu. Web i zdrojový kód jsou veřejné; načtené partie a skóre se nikam neukládají.

```sh
cd web
npm ci
npm run dev:pages
# Produkční sestavení a lokální náhled:
npm run build:pages
npm run preview:pages
```

Lokální adresu s cestou `/chessbot/` vypíše Vite. Konfigurace je v `web/vite.pages.config.ts`, nasazení v `.github/workflows/pages.yml`. Původní serverová verze pro Sites zůstává dostupná přes `npm run dev` a `npm run build`.

## Spuštění

Vyžaduje Node.js 22.13+ a npm.

```sh
cd web
npm install
npm run dev
```

Aplikace běží na adrese http://127.0.0.1:5173. Zadej Lichess nickname, barvu figur a velikost vzorku. Partie se načítají přímo z veřejného exportu Lichessu přes serverovou route, bez API tokenu. Pozice a trénink zůstávají pouze v paměti otevřené stránky.

## Pravidla tréninku

- Soupeř vybírá náhodně mezi tahy skutečně zahranými v načtených partiích. Výchozí pravděpodobnost odpovídá jejich četnosti; lze zvolit rovnoměrné rozdělení.
- Uživatel hraje kliknutím na figuru a cílové pole. Za správný se uzná každý doložený tah vybraného hráče z dané pozice.
- Legální tah mimo repertoár ponechá pozici beze změny a umožní další pokus. Nejde o hodnocení tahů šachovým enginem.
- Nápověda ukáže všechny doložené odpovědi a jejich četnosti.
- Trénink končí po 8, 12 nebo 16 úplných tazích, při konci partie nebo na konci dostupného repertoáru.
- Shodné pozice jsou spojeny podle FEN bez počítadel tahů, takže se rozpoznávají transpozice. Jedna partie se v opakované pozici počítá pouze jednou.
- Načítají se dokončené standardní partie v tempech bullet, blitz, rapid a classical, za vybranou barvu. Výsledný repertoár závisí na načteném vzorku.
- Stránka povoluje jedno současné stahování a po HTTP 429 čeká alespoň minutu. Serverová verze omezuje souběh také na instanci. Více otevřených karet ani serverových instancí nemá sdílený omezovač; používej jednu relaci. Zrušení načítání a timeout ukončí stream.

## Ověření

```sh
cd web
node --test tests/repertoire.test.mjs
npx tsc --noEmit
npm run build
```

Frontend: React / Vinext. Pravidla šachu a parsování SAN: chess.js. Serverové API: `web/app/api/games/route.ts`. Repertoár a losování tahů: `web/lib/repertoire.ts`.

API dokumentace: https://lichess.org/api#tag/Games/GET/api/games/user/{username}
