# Redesign Nadbytečná.cz: scroll-cesta (8. 11. 2026)

Stav: nasazeno na produkci (PR #27–#30, větev `main`, Vercel nasazuje z `main`).

## Proč
Původní úvodní strana působila „naťukaně v HTML“. Cíl: manifest Věry Komárové jako scroll-cesta (inspirace plátnem „manifest“), světle růžová paleta, obsah beze změny. Video a jeho plakát se nesmí měnit.

## Co se změnilo
- **Úvod** (`homeScroll()` v `lib/phase1-html.js`, `src/scroll.css`, `src/scroll.js`): hero, sticky manifest (šest hesel, aktivní heslo je vždy uprostřed, ostatní se zmenšují a blednou, počítadlo), kapitoly Věřin příběh, tři cesty, parfém. Pozadí se mezi kapitolami plynule mění (pět „scén“). Postranní tečky na desktopu.
- **Třetí řádek cest:** „Předprodej parfému“ (kotva `#parfem`) místo „Změnit systém“. Tlačítko „Předobjednat parfém“ v sekci parfému vede na https://veryvera22.cz.
- **Hlavička:** „Chci sdílet svůj příběh“ (`/sdilet-pribeh/`) místo „Potřebuji pomoc“; „Předprodej parfému“ místo „E-shop“ (na podstránkách `/#parfem`). Totéž v patičce.
- **Mobil:** spodní lišta „Parfém Nadbytečná ↓“ s odkazem na sekci s parfémem (u sekce zmizí). Cookie lišta je malá a těsně nad ní.
- **Plynulý posun:** odkazy na kapitoly a lišta se rozjedou animovaným scrollem (`glide()` v `scroll.js`), nepřeskočí. Při „omezit pohyb“ je to běžný skok.
- **Odstraněno:** blok „Okamžitá pomoc“ (155/158 + tlačítko) i plovoucí tlačítko „Okamžitá pomoc“ na všech stránkách. Čísla 155/158 zůstávají v patičce. Stránka `/potrebuji-pomoc/` existuje dál (odkaz v patičce).
- **Větší video** Věřina příběhu (obsah a plakát beze změny).
- **Podstránky** `/sdilet-pribeh/`, `/mohu-pomoci/`, `/potrebuji-pomoc/`: stejný jazyk jako úvod (`body[data-form]`, funkce `formLayout()`): nadpis vlevo, formulář na kartě vpravo. Pole, souhlasy a odesílání beze změny.

## Technické poznámky
- Strict CSP: žádné inline styly ani skripty; nové CSS a JS jsou externí (`/scroll.css`, `/scroll.js`, kopírované v `build.mjs`).
- Vše je progresivní vylepšení: bez JS nebo s „omezit pohyb“ je stránka obyčejně pod sebou.
- Stará `home()` je v kódu zachovaná pro případný návrat.
- Testy: `node --test tests/*.test.mjs` (169 prošlo).

## Otevřené
- Adresa a IČ v patičce jsou pořád „doplníme“.
- Samostatná děkovací stránka po odeslání formulářů není; po odeslání se na stejné stránce zobrazí „Děkujeme.“.
- Nezkoušeno na skutečném iPhonu a Androidu.
- Návrhy na plátně (Design artifact) nejsou aktualizované podle posledních úprav podstránek.
