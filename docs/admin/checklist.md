# Akceptační kontrola adminu

## Produkční stav — 8. 11. 2026

Admin je nasazený na https://nadbytecna.cz/admin/. PR #11 byl sloučen; zachovává veřejné změny z main 70e6104. Veřejný web zůstává coming soon.

- Na ověřeném projektu gjzsifxldxaogcuqzivb byly po kontrole shody 53 sloupců aplikovány migrace admin_workspace, admin_mail a mail_oauth v jedné transakci. Historie migrací je zapsaná.
- Povolené účty: veryvera@nadbytecna.cz a mbo@michalbaturko.com. Skutečné přihlášení mbo přes doručený e-mail v nové kartě je ověřeno; Věřino vlastní přihlášení zatím ne.
- Nastaveny serverové klíče a samostatná náhodná tajemství; hodnoty se do dokumentace ani Git neukládají. Auth Site URL a přesný redirect směřují na produkční admin.
- Opraveno no-store pro HTML adminu, přenos PKCE mezi kartami a skalární PostgREST filtry pro UUID. Přihlašovací tokeny zůstávají v sessionStorage; pouze krátkodobý PKCE verifier může být v localStorage (15 minut).
- Skutečná produkční kontrola: anonymní vložení dvou syntetických záznamů a tichého WAV, zákaz anonymního čtení tabulek, privátní bucket, skutečný přehled/detail, ruční klasifikace, stav/historie, poznámka, CSV a ZIP s daty a audiem. Podepsaná nahrávka měla platnost 120 s: před vypršením HTTP 200, po vypršení HTTP 400 InvalidJWT. Oba syntetické záznamy a audio byly odstraněny úzkým kontrolovaným úklidem přes serverové funkce; není to potvrzení celého hostovaného GDPR UI workflow. Žádné skutečné příběhy nebyly posílány AI.
- AI, přepis, Microsoft connect/import a automatické mazání zůstávají vypnuté. Schránka není připojena; čeká se na registraci aplikace a přístup od správce podle microsoft365-odkaz.md. PowerShell ani certifikát nejsou pro zvolenou delegovanou variantu potřeba.
- Lokálně prošlo 163/163 testů a 80 prohlížečových kontrol (29 základ, 22 e-mail, 14 pozvánka, 11 veřejné připojení, 4 PKCE). Transport Microsoftu je v těchto testech simulovaný. Regrese porovnala 12 veřejných stránek a 5 souborů s main 70e6104.

Zbývá provozní rozhodnutí o retenci, krizovém postupu, publikování a případném zapnutí AI. Testy nejsou právním schválením těchto rozhodnutí.

Následující části zachovávají implementační a původní přednasazovací podklady; pro aktuální stav platí souhrn výše.

**Historický stav před nasazením: připraveno k revizi, produkce NEOVĚŘENA / NENASAZENO agentem.** Lokální PostgreSQL základ nyní vychází ze skutečného read-only snapshotu struktury z 7. 11., nikoli z osobních produkčních dat. Migrace nebyla na produkci aplikována. Testy neposílaly zprávy skutečným lidem ani skutečné příběhy do OpenAI.

## Dodané funkce

- Magic link PKCE, fresh allowlist kontrola na každém serverovém požadavku, zápis admina při prvním ověřeném přístupu, odhlášení a 12h nečinnost serverově i v UI.
- Výjimka pro `/admin` a jeho chráněná API při nezměněném `SITE_LIVE`, noindex a no-store. Preview odmítá známou produkční Supabase URL.
- Přehled počtů a klikatelné filtry; všechny typy zpráv, pojmenované/anonymní, souhlasy, spolupráce, vstup, pomocník, kategorie, naléhavost, stav, AI a potvrzení; řazení a stránky po 25. Necitlivé filtry v URL, hledaný text v paměti.
- Číselník osmi kategorií v DB. Kategorie a naléhavost admina mají přednost; autor a čas přepisu. Zveřejnění blokováno bez doloženého souhlasu a 18+.
- Seznam + detail vedle sebe na desktopu; mobilní detail a panel filtrů, fokus, klávesnice, velké cíle.
- Audio přes podpis 120 s, celý text, přepis se štítkem nejistoty, kontakty, kopírování, bezpečné odkazy a mailto.
- Souhlasy s časem, verzí a přesným zněním nových souhlasů; žádné domyšlené časy u historických dat.
- Vlákno interních poznámek, editace jen vlastních, historie stavů, deterministické návrhy párů a potvrzení/zamítnutí bez rozesílání.
- CSV s BOM, oddělovačem `;`, výchozí bez textu, ochrana před tabulkovými vzorci. Auditované JSON+audio ZIP a výmaz osoby včetně vazeb, obou seznamů registrací a auditu s HMAC místo e-mailu osoby.
- Denní retence s náhledem jako výchozím režimem, varování do 14 dnů. Oddělené mazání audia a jednotlivých prošlých záznamů, nikoli všech mladších záznamů téhož e-mailu.
- AI structured output + lokální validace a bezpečná chyba, lidská klasifikace zachována. Fronta po insertu, worker po budoucím zapnutí, nejvýše dvě opakování. AI a transkripce výchozí vypnuté, ruční akce flag neobchází.
- Vlastní doplnění: další zprávy stejného kontaktu, koncept odpovědi do vlastní pošty, výrazné akutní případy bez automatické diagnózy, viditelné rozpracované výmazy a jejich opakování.

## Kontrolní seznam zadání

| Kritérium | Výsledek | Evidence / omezení |
|---|---|---|
| Veřejné odeslání text/nahrávka/soubor a nabídka | **PASS lokálně** | Skutečné ovládání přes Playwright, anonymní SQL v lokálním PostgreSQL, falešné audio a testovací e-maily. Upload transport je stub, ne skutečný Supabase Storage. |
| Coming soon při `SITE_LIVE=false` | **PASS lokálně** | Testy hostGate/middleware + browser signup do lokální tabulky. Veřejné routy stále zavřené, jen úzká admin výjimka. |
| Cookie lišta a žádný tracking před souhlasem | **PASS lokálně** | Skript i veřejný vzhled jsou proti baseline shodné; browser nezaznamenal tracking request. |
| OG/title/description/noindex veřejného webu | **PASS lokálně** | Porovnání 9 veřejných HTML proti původnímu commitu, jen explicitní 18+ výjimka; 5 souborů obsahově shodných. |
| Admin endpoint 401 / outsider 403 | **PASS lokálně** | Skutečný API handler, stub ověřeného Auth a PostgreSQL allowlist. Skutečný magic-link roundtrip zůstává k ověření. |
| Anon nemůže SELECT/UPDATE/DELETE; outsider nevidí data | **PASS lokálně nad snapshotem** | PostgreSQL role/RLS, práva na RPC a server-only mutace. Výchozí skutečné policies jsou přečtené; nové policies nejsou aplikované ani integračně testované na hostované větvi. |
| Audio soukromé, podpis vyprší | **ČÁSTEČNĚ** | RLS blokuje přímý klientský read, bucket privátní v migraci, požadavek podpisu 120 s ověřen. Skutečné vypršení a chování Supabase Storage se stubem ověřit nelze. |
| AI timeout / API chyba / invalid kategorie | **PASS s mocky** | Formulářový záznam zůstane, chyba je uložena, nevalidní výstup se nepoužije, nové AI výsledky nepřepíší lidskou klasifikaci. |
| `AI_TRIAGE_ENABLED=false` nevolá OpenAI | **PASS s mocky** | Nízká vrstva, ruční API i worker; žádný skutečný model nebyl volán. |
| Příběh/přepis nejsou v aplikačních logách | **PASS kontrolou kódu** | Nové serverové operace nezapisují payloady ani text DB/API chyb; syntetické testy nevypisují data při úspěchu. Retence hostingových logů vyžaduje provozní kontrolu. |
| Audit všech akcí | **PASS lokálně v aplikaci** | Login, detail, update, poznámka, audio, CSV, ZIP, výmaz, manuální/automatická AI, retence. Nejde o audit libovolných přímých DB SELECT mimo aplikaci. |
| Retence maže správně a nic navíc | **PASS lokálně** | Starý vs. čerstvý záznam, zveřejněný příběh, poslední kontakt nabídky, přepsané/30denní audio; výchozí cron dry-run. Reálný storage staging test čeká. |
| Seznam/detail/filtry na 320/375/768/1024/1440/1920 px | **PASS lokálně** | 18 screenshotů, `scrollWidth <= clientWidth`, žádný nález axe. |
| Dotykové cíle ≥44 px | **PASS lokálně** | Měření viditelných interaktivních prvků a skutečné klikací plochy labelu checkboxu. |
| Lighthouse Accessibility ≥95 mobil/desktop | **PASS lokálně, 100/100** | Lighthouse 13.6.0, snapshot přihlášeného seznamu i detailu ve dvou rozlišeních; nejde o produkční navigation/performance měření. |
| Klávesnice / viditelný fokus | **PASS lokálně** | Skip link, zaměření detailu, Escape a cyklus fokusu v mobilním panelu, CSS focus-visible. Manuální audit čtečkou obrazovky neproběhl. |
| Úklid nových testovacích dat | **PASS lokálně** | Vše pouze v paměťové testovací DB, fake Auth/storage; při ukončení serverů DB uzavřené. Nic se nevkládalo do produkce. Screenshoty úmyslně obsahují jen syntetická data. |
| Staré testovací soubory v produkčním bucketu | **ČEKÁ NA SOUHLAS** | Nedotčeno. Neexistuje schválený seznam souborů ani souhlas s mazáním. |

## Výslovné odchylky / před nasazením

1. Automatická AI čeká na pětiminutový worker (jeden záznam na tick), neprobíhá okamžitě při submitu. Pro budoucí spuštění je třeba schválený scheduler/webhook a odpovídající kapacita; UI a veřejné odeslání se tím neblokují. Rychlé anonymní vyvolání AI podle cizího ID není povoleno.
2. Fulltext je bez diakritiky přes `unaccent` + `simple`, bez českého stemmeru. Hledaný text se z důvodu citlivosti neukládá do URL; ostatní filtry jsou sdílené.
3. Skutečné metadata schématu jsou read-only ověřená. Funkční potvrzení stále vyžaduje staging Auth/Storage testy a schválení migrace/nasazení. Vercel plán a CSP pro přesnou preview databázovou větev jsou v předávacím postupu.
4. Dvě adresy administrátorů, souhlas advokátky s AI, retenční základ, způsob veřejného publikování a krizový postup zůstávají lidská rozhodnutí. Předchozí souhlasy se nedoplňují zpětným odhadem.

## Screenshoty (všechno syntetické)

| Šířka | Seznam | Detail | Filtry |
|---|---|---|---|
| 320 | [Seznam](screenshots/320-list.png) | [Detail](screenshots/320-detail.png) | [Filtry](screenshots/320-filters.png) |
| 375 | [Seznam](screenshots/375-list.png) | [Detail](screenshots/375-detail.png) | [Filtry](screenshots/375-filters.png) |
| 768 | [Seznam](screenshots/768-list.png) | [Detail](screenshots/768-detail.png) | [Filtry](screenshots/768-filters.png) |
| 1024 | [Seznam](screenshots/1024-list.png) | [Detail](screenshots/1024-detail.png) | [Filtry](screenshots/1024-filters.png) |
| 1440 | [Seznam](screenshots/1440-list.png) | [Detail](screenshots/1440-detail.png) | [Filtry](screenshots/1440-filters.png) |
| 1920 | [Seznam](screenshots/1920-list.png) | [Detail](screenshots/1920-detail.png) | [Filtry](screenshots/1920-filters.png) |

Strojové výsledky: [browser](browser-results.json), [regrese veřejného webu](public-regression.json), [Lighthouse mobil seznam](lighthouse-mobile-list.json), [mobil detail](lighthouse-mobile-detail.json), [desktop seznam](lighthouse-desktop-list.json), [desktop detail](lighthouse-desktop-detail.json).

Read-only metadata navíc potvrdila prázdný allowlist, privátní bucket story-audio (limit 50 MiB), chybějící SELECT service_role na auth.users a nepřítomnost volitelné tabulky preregistrations. Tyto skutečné podmínky jsou zahrnuté do migračních testů; žádná data osob se nečetla.


## Rozšíření Microsoft 365

Připraveno k revizi, schránka **nepřipojena**. [Konfigurace a předání správci](microsoft365.md). 10 lokálních DB testů, 6 API testů, 14 Graph/auth mock testů a 3 testy e-mailové AI jsou součástí celkem 129 testů. [22 e-mailových prohlížečových kontrol](mail-integration-results.json) doplňuje původních 29; celkem 51.

- PASS lokálně: anon/outsider odmítnutí, explicitní jedna schránka/složka/datum, OAuth certifikát PS256, Graph GET bez zápisů, kontrolované next/delta URL, velikostní limity, neznámé souhlasy a klasifikace.
- PASS lokálně: deduplikace, transakční kurzor a lease, Retry-After, potlačení obnovení po výmazu či změně složky, výmaz jen starých zpráv při retenci a zachování mladších zpráv ve stejném vlákně. Zámky a revize jsou ověřené v lokálním PostgreSQL; nezávislá paralelní hostingová zátěž zůstává staging test.
- PASS lokálně: vlákna a starší zprávy (20+2), ruční klasifikace zachovaná i u neaktivní kategorie, poznámky, export, lokální výmaz, nulová volání skutečného Graph/OAuth/OpenAI/odesílání pošty.
- PASS na 320/375/768/1024/1440/1920: seznam/filtry/detail bez overflow, malé klikací cíle 0 a nálezy axe 0. [Mobil seznam](screenshots/375-mail-list.png), [detail](screenshots/375-mail-detail.png), [desktop seznam](screenshots/1440-mail-list.png), [detail](screenshots/1440-mail-detail.png). Vše smyšlená data.
- ČEKÁ: správce aplikace a certifikát, ověření RBAC omezení jediné schránky, schválení a aplikace nové migrace, staging skutečného delta/HTML-to-text chování, počáteční složka a datum, retenční lhůta a samostatné schválení AI zdroje. Lokální nakonfigurováno neznamená funkční připojení.

AI v e-mailové verzi 1 se spouští ručně nad nejnovějšími 20 zprávami a nejvýše 20 000 znaky, nezávisle na aktuálně prohlížené stránce. Zveřejnění e-mailů není povoleno. Sender export zachovává poznámky se značkou requires_review, protože poznámky a citace mohou obsahovat údaje dalších osob. Nejde o automaticky hotovou odpověď na GDPR žádost. Nadlimitní export selže před SQL agregací (2.5 MiB) nebo při serverové kontrole (3 MiB); nikdy se netváří jako úplný zkrácený export.


## Jednorázové delegované připojení bez účtu v adminu

[Postup připojení odkazem](microsoft365-odkaz.md). Nová varianta nevyžaduje certifikát ani Exchange PowerShell; vyžaduje ale registraci Microsoft Web aplikace, delegovaná User.Read/Mail.Read, serverový client secret a schválené DB/HTTPS nasazení. Žádná ostrá pozvánka zatím nebyla vydána.

- 160/160 lokálních testů celého projektu, včetně 13 MSAL/crypto, 11 OAuth DB, 5 veřejné API flow a delegovaných Graph cest. Skutečný MSAL 7.2.1 byl ověřen s mock discovery; skutečné přihlášení/token Microsoftu neproběhlo.
- [14 admin UI kontrol](mail-connect-admin-results.json): gated vydání a kopírování pozvánky, expirace, vyčištění po odchodu/logout, potvrzené odpojení a bezpečný preview origin.
- [11 veřejných UI kontrol](mail-connect-public-results.json): šest šířek, žádný overflow/axe nález, bez admin účtu, skrytí fragmentu, žádný automatický begin, POST po kliknutí a blokování cizího redirectu.
- Celkem 76 prohlížečových kontrol (29 původní, 22 e-mailová integrace, 14 pozvánka, 11 veřejná stránka) a 26 screenshotů, vše syntetické. [Mobil veřejná stránka](screenshots/375-mail-connect-public.png), [desktop veřejná stránka](screenshots/1440-mail-connect-public.png), [mobil admin pozvánka](screenshots/375-mail-connect-admin.png), [desktop admin pozvánka](screenshots/1440-mail-connect-admin.png).
- Nezávislá revize nenašla potvrzenou cestu k obcházení state/cookie/PKCE, vytvoření admin přístupu nebo obnovení cache/commitnutí synchronizace po odpojení. Ověřené lokální zámky/revize nenahrazují provozní souběžný zátěžový test.
- ČEKÁ: registrace skutečné aplikace, serverové hodnoty, schválení a aplikace migrací, skutečný HTTPS cookie roundtrip (__Host/Secure/HttpOnly/SameSite), tenant consent a owner účet. Nastavená konfigurace ani uložená cache nejsou důkazem funkčního trvalého přístupu.

Veškeré Microsoft/OAuth/Graph odpovědi v automatických kontrolách byly mockované; úmyslnou navigaci na Microsoft test zachytil a zablokoval. AI a skutečné načítání pošty zůstávají vypnuté.
