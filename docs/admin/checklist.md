# Akceptační kontrola adminu

Stav k 8. 11. 2026. Admin je nasazený; podrobné provozní ověření a historie jsou v [aktuálním předání](production-status.md). **Spolehlivé přihlašovací e-maily čekají na vlastní SMTP; Resend je nyní výslovně odložený uživatelem.** Microsoft není připojený. AI, přepis, import a automatické mazání zůstávají vypnuté.

## Souhrn ověření

- 169/169 lokálních unit a integračních testů (včetně velkých exportů a přerušení přenosu).
- 89 prohlížečových kontrol: 34 základní admin a ruční zpracování, 22 e-mailová integrace, 14 administrátorské pozvánky, 11 veřejné připojení, 8 přihlášení a typografie.
- Lighthouse Accessibility po sjednocení na Jost: mobilní i desktopový seznam a detail 100/100, režim snapshot. Není to produkční měření výkonu.
- Lokální testy používají syntetická data a skutečný lokální PostgreSQL/API, s adaptéry externího Auth, Storage a Microsoftu. Neodeslaly e-mail skutečnému příjemci ani příběh modelu. [Výsledky](test-results.json).

## Kritéria a rozsah důkazů

| Kritérium | Lokální ověření | Skutečné nasazení / zbývající krok |
|---|---|---|
| Veřejné formuláře text/nahrávka/soubor a nabídka | PASS: browser, API, SQL, souhlasy a 18+ | Syntetický příběh, nabídka a tichý WAV byly skutečně vložené a uklizené; produkční formuláře nebyly všechny znovu projité jako E2E. |
| Coming soon a veřejná regrese | PASS: 12 stránek a 5 souborů, explicitně povolené 18+ a Jost | SITE_LIVE se neměnil. |
| Cookies a tracking před souhlasem | PASS: bez tracking requestu, skript obsahově shodný | Žádná nová změna cookies. |
| OG/title/description/noindex | PASS: veřejná regrese; fonty výslovně změněné na Jost | Průběžné změny veřejného main zachované. |
| Magic link, allowlist, 401/403 | PASS: Auth adapter, skutečné API a DB allowlist | Vlastní mbo login doručeným e-mailem byl ověřen. Pozdější pokus narazil na limit testovacího SMTP; Věřin první login a spolehlivá doručitelnost nejsou potvrzené. Skutečné API bez beareru vrací 401; outsider 403 je ověřen lokálně. |
| RLS a serverové mutace | PASS nad skutečným snapshotem schématu | Tři migrace aplikované. Anonymní čtení tabulek zakázané; authenticated nemá přímý UPDATE. |
| No-store a noindex adminu | PASS: middleware/API | HTTP GET/HEAD /admin/ a chráněné API ověřené na hostu. [HTTP evidence](production-http-results.json). |
| Privátní audio a vypršení podpisu | PASS | Tichý syntetický WAV: unsigned denied, signed 200, po 120 s 400 InvalidJWT. Testovací soubor odstraněn. |
| AI fallback a ochrana ruční klasifikace | PASS: timeout, chyba, nevalidní výstup, zachování lidských údajů | Skutečné modely se nevolaly. Nezpracovaný záznam nyní nenese nepravdivý štítek návrhu AI. |
| AI vypnutá | PASS: ruční API i worker nevolají model | Produkční tlačítko neaktivní, bez doloženého skutečného zpracování. |
| Seznam, detail, poznámky a historie | PASS | Skutečný syntetický detail, ruční kategorie/naléhavost/stav, historie a poznámka ověřené. |
| Prázdné přehledy a filtry | PASS přes skutečné lokální API/DB | Nulová kolekce, nulové hledání a prázdná starší stránka mají odlišné texty; reset filtrů a návrat na první stránku fungují. České počty 0/1/2/4/5 ověřené. |
| Párování bez rozesílání | PASS: návrhy a potvrzení/zamítnutí | Žádné zprávy příjemcům se neposílají; vhodnost posuzuje člověk. |
| CSV a GDPR ZIP | PASS: filtr, BOM/oddělovač, vzorce, JSON a audio; 6 MiB nekomprimovatelné audio a CSV přes 600 syntetických řádků | Malé skutečné syntetické CSV a ZIP s WAV byly dříve staženy. Nový postupný přenos řeší limit hostingu 4,5 MB; větší export na hostu zatím nebyl ověřen. |
| GDPR výmaz a opakovatelnost | PASS: snapshot, vazby, selhání Storage a opakování | Úzký produkční úklid syntetických dat přes serverové funkce ověřen; celý hostovaný GDPR UI handler není tímto potvrzený. |
| Audit bez textu příběhu | PASS: všechny aplikační operace, bez citlivých payloadů | Hosted detail, update, poznámky a exporty prošly; nejde o audit přímého čtení DB mimo aplikaci. |
| Retence | PASS: staré/čerstvé záznamy, souhlasy, poslední kontakt a audio | Automatické mazání vypnuté; pravidla a reálný provozní běh čekají na rozhodnutí. |
| Šířky 320–1920 px a dotykové cíle | PASS: bez overflow, cíle nejméně 44 px a žádné nálezy axe v kontrolovaných pohledech | Syntetické screenshoty; ruční audit čtečkou obrazovky neproběhl. |
| Klávesnice a fokus | PASS: skip link, detail, Escape a mobilní filtr | Bez tvrzení úplné manuální přístupnosti všech kombinací. |
| Microsoft 365 | PASS s mocky: read-only Graph, deduplikace, OAuth/PKCE, šifrování a odpojení | Skutečná schránka není připojená. Zvolená varianta je delegovaný jednorázový odkaz, bez PowerShellu a certifikátu. [Postup](microsoft365-odkaz.md). |
| Úklid testovacích dat | PASS: lokální DB v paměti; nové hosted syntetické záznamy/audio uklizené | Read-only inventář našel 14 nepřiřazených objektů (1 106 998 B), bez čtení jejich obsahu. Nejsou tím prokázané jako testovací; nebyly smazány. [Evidence](storage-inventory.json). |

## Nové ověření audia a souhlasu — 8. 11.

Texty formuláře, potvrzení a e-mailových šablon již neslibují vypnutý přepis. Nový audio klient posílá verzi 2026-11-08-audio-v2; server ukládá přesné znění souhlasu. Starší klient bez značky si zachovává původní v1. Historické snapshoty se nepřepisují. Lokální browser nyní kontroluje i skutečně uložený typ nahrávky, vazbu audio_path na příběh, verzi a text souhlasu pro soubor i mikrofon.

Na skutečném produkčním nasazení byly přes formulář vložené dva označené testovací příběhy se souborem a mikrofonem. Soukromé soubory byly zpětně načtené a dekódované; WAV se shodoval bajt po bajtu s originálem a v adminu se přehrál. Celý průchod včetně dalšího přehrání a úklidu se dokumentuje odděleně; tento odstavec není tvrzení o ověření všech prohlížečů či iPhonu.

## Nové průchody pro ruční práci

Nezpracovaný webový záznam i e-mail musí ukazovat „Zatím bez shrnutí AI“. „Návrh AI“ se ukáže pouze při existujícím výsledku. Ruční klasifikace funguje i s vypnutou AI. Bez záznamů je vysvětleno, že kolekce je prázdná; při neúspěšném hledání lze rovnou zrušit filtry; starý stránkovaný odkaz umožní návrat na první stránku se zachováním řazení.

## Screenshoty — všechno syntetické

| Šířka | Seznam | Detail | Filtry |
|---|---|---|---|
| 320 | [Seznam](screenshots/320-list.png) | [Detail](screenshots/320-detail.png) | [Filtry](screenshots/320-filters.png) |
| 375 | [Seznam](screenshots/375-list.png) | [Detail](screenshots/375-detail.png) | [Filtry](screenshots/375-filters.png) |
| 768 | [Seznam](screenshots/768-list.png) | [Detail](screenshots/768-detail.png) | [Filtry](screenshots/768-filters.png) |
| 1024 | [Seznam](screenshots/1024-list.png) | [Detail](screenshots/1024-detail.png) | [Filtry](screenshots/1024-filters.png) |
| 1440 | [Seznam](screenshots/1440-list.png) | [Detail](screenshots/1440-detail.png) | [Filtry](screenshots/1440-filters.png) |
| 1920 | [Seznam](screenshots/1920-list.png) | [Detail](screenshots/1920-detail.png) | [Filtry](screenshots/1920-filters.png) |

Nové prázdné přehledy: [mobil](screenshots/375-empty-list.png), [desktop](screenshots/1440-empty-list.png). E-mailové pohledy a připojovací stránka: [mobilní detail](screenshots/375-mail-detail.png), [desktopový detail](screenshots/1440-mail-detail.png), [veřejný odkaz](screenshots/375-mail-connect-public.png). Celkem 28 screenshotů.

## Co zbývá rozhodnout nebo dokončit

Konkrétní [plán spuštění 11. 11.](launch-2026-11-11.md) obsahuje denní ruční postup i závěrečný hosted průchod. Aktuální veřejné zásady stále mají [DOPLNIT], [ROZHODNOUT] a [OVĚŘIT]; právní obsah nelze označit za připravený podle funkčních testů adminu.

1. Obnovit odložené odesílání přes Resend, doplnit DNS správce a skutečně ověřit doručitelnost. Požadovaný odesílatel je prihlaseni@nadbytecna.cz ve správném účtu michal.baturko@regalmaster.cz. Schválený příplatek 20 USD/měsíc dosud nebyl zapnut.
2. Údaje a schválení správce Microsoftu, případně složka, datum importu a retenční lhůta e-mailových kopií. Skutečný Graph/OAuth roundtrip neproběhl.
3. Právní souhlas a podmínky případného zapnutí AI/přepisu. Automatický worker je pětiminutový, jeden záznam za běh; nejde o okamžitou triáž při odeslání.
4. Pravidla publikování/anonymizace, krizový postup, retenční základ a seznam starých souborů případně určených ke smazání. Nic z toho není automaticky schválené implementací.
5. Věřino první vlastní přihlášení. Přístup dalších lidí se nepřidával.

Hledání je bez diakritiky (unaccent + simple), bez českého stemmeru. Hledaný citlivý text zůstává mimo URL. „Zveřejněno“ je interní workflow stav; samotné uložení nic nepublikuje na web ani sítě.
