# Akceptační kontrola adminu

**Stav: připraveno k revizi, produkce NEOVĚŘENA / NENASAZENO agentem.** Lokální PostgreSQL je rekonstrukce základního schématu, nikoli kopie produkce. Testy neposílaly zprávy skutečným lidem ani skutečné příběhy do OpenAI.

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
| Anon nemůže SELECT/UPDATE/DELETE; outsider nevidí data | **PASS na rekonstrukci** | PostgreSQL role/RLS, práva na RPC, server-only mutace; neověřeno proti skutečným policies projektu. |
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
3. Veškeré produkční potvrzení je podmíněno skutečným schématem, staging Auth/Storage testy a schválením migrace/nasazení. Vercel plán a CSP pro přesnou preview databázovou větev jsou v předávacím postupu.
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
