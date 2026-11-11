# Předání a nasazení adminu

## Produkční stav — 8. 11. 2026

Admin je nasazený na https://nadbytecna.cz/admin/. PR #11 byl sloučen; zachovává veřejné změny z main 70e6104. Veřejný web zůstává coming soon.

- Na ověřeném projektu gjzsifxldxaogcuqzivb byly po kontrole shody 53 sloupců aplikovány migrace admin_workspace, admin_mail a mail_oauth v jedné transakci. Historie migrací je zapsaná.
- Povolené účty: veryvera@nadbytecna.cz a mbo@michalbaturko.com. Skutečné přihlášení mbo přes doručený e-mail v nové kartě je ověřeno; Věřino vlastní přihlášení zatím ne.
- Nastaveny serverové klíče a samostatná náhodná tajemství; hodnoty se do dokumentace ani Git neukládají. Auth Site URL a přesný redirect směřují na produkční admin.
- Opraveno no-store pro HTML adminu, přenos PKCE mezi kartami a skalární PostgREST filtry pro UUID. Přihlášení se pamatuje v tomto prohlížeči nejvýše 30 dní. Stejný pevný limit hlídá server; obnovení tokenu jej neprodlužuje. Ruční odhlášení vymaže uloženou relaci i v ostatních kartách. PKCE verifier má nadále platnost 15 minut.
- Skutečná produkční kontrola: anonymní vložení dvou syntetických záznamů a tichého WAV, zákaz anonymního čtení tabulek, privátní bucket, skutečný přehled/detail, ruční klasifikace, stav/historie, poznámka, CSV a ZIP s daty a audiem. Podepsaná nahrávka měla platnost 120 s: před vypršením HTTP 200, po vypršení HTTP 400 InvalidJWT. Oba syntetické záznamy a audio byly odstraněny úzkým kontrolovaným úklidem přes serverové funkce; není to potvrzení celého hostovaného GDPR UI workflow. Žádné skutečné příběhy nebyly posílány AI.
- AI, přepis, Microsoft connect/import a automatické mazání zůstávají vypnuté. Schránka není připojena; čeká se na registraci aplikace a přístup od správce podle microsoft365-odkaz.md. PowerShell ani certifikát nejsou pro zvolenou delegovanou variantu potřeba.
- Lokálně prošlo 163/163 testů a 80 prohlížečových kontrol (29 základ, 22 e-mail, 14 pozvánka, 11 veřejné připojení, 4 PKCE). Transport Microsoftu je v těchto testech simulovaný. Regrese porovnala 12 veřejných stránek a 5 souborů s main 70e6104.

Zbývá provozní rozhodnutí o retenci, krizovém postupu, publikování a případném zapnutí AI. Testy nejsou právním schválením těchto rozhodnutí.

Následující části zachovávají implementační a původní přednasazovací podklady; pro aktuální stav platí souhrn výše.

## Historický stav před nasazením (7. 11. 2026)
Kód a lokální ověření jsou připravené k revizi. Žádná migrace nebyla aplikována na Supabase, `main` nebyl změněn a produkční nasazení nebylo spuštěno agentem. Není to potvrzení funkčního produkčního adminu. MCP nástroj čtení odmítl, ale následná read-only kontrola přes přihlášený SQL editor poskytla skutečná metadata struktury (bez osobních dat) v `tests/fixtures/admin-schema-2026-11-07.json`. Lokální základ nyní vzniká z tohoto snapshotu. Service role nemá SELECT auth.users a tabulka preregistrations zde není; migrace musí tyto podmínky respektovat. Snapshot není potvrzení aplikace migrace ani funkčních testů reálného Auth/Storage.

## Postup po schválení
1. Zkontrolovat zaznamenaný read-only snapshot a před aplikací ověřit případný drift přes `docs/admin/schema-preflight.sql`. Porovnat skutečné sloupce, typy, triggery, policies, storage a granty s novou migrací. Zkontrolovat zejména typ `links`, stávající `admins`, funkci `is_admin` a vedlejší použití jejich policies. Případný rozdíl nejdřív zapracovat do PR.
2. Ověřit novou migraci na samostatné Supabase větvi včetně Storage a skutečného Auth. Původní migrations zde nezakládají všechny výchozí tabulky, takže samotný čistý reset není kompletní staging.
3. Pro preview použít URL a klíče samostatné databázové větve. Admin API výslovně odmítá známou produkční Supabase URL, pokud `VERCEL_ENV=preview`. CSP pro preview je potřeba nastavit na přesný hostname této větve (současná CSP veřejného webu obsahuje jen produkční Supabase hostname; nebyla plošně rozšiřována).
4. Potvrdit zálohu a rollback, schválit migrační SQL a načasovat migraci s frontendem: nový 18+ souhlas vyžaduje nové DB sloupce a starý frontend po migraci nesplní nový 18+ RLS požadavek. Neaplikovat migraci dlouho před nasazením nového formuláře.
5. Teprve po souhlasu Michala aplikovat novou migraci a mergovat/nasadit PR. Název migrace vznikl přes `supabase migration new`; čas byl posunut za existující soubory z téhož dne, aby byla aplikována jako poslední.
6. Doplnit pouze dvě schválené adresy do `public.admin_emails(email)`, normalizované malými písmeny. Žádné adresy se nesejí v migraci. Při prvním ověřeném přístupu zapíše server uživatele do `admins`; při odstranění e-mailu z allowlistu se přístup zamítne i pro existující session.
7. V Supabase Auth nastavit přesnou redirect URL `https://nadbytecna.cz/admin/`, zkontrolovat PKCE magic link v témže prohlížeči a skutečné přihlášení obou lidí. Testování reálného přihlašovacího e-mailu až po svolení. Před spuštěním nepoužívat skutečné kontakty pro testy.
8. Na nasazení ověřit `/admin`, 401/403, no-store, noindex, CSP, privátní Storage, podpis 120 s a skutečné vypršení. Poté lokální ověření označit v checklistu i jako ověřené proti prostředí.

## Nastavení (hodnoty klíčů nikam nevypisovat)
- Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Veřejné přihlášení/formuláře: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `GDPR_HASH_SECRET`: samostatné náhodné tajemství alespoň 32 znaků pro HMAC e-mailu v auditu výmazu.
- `CRON_SECRET`: náhodné tajemství alespoň 24 znaků; autentizuje denní retenci a AI worker.
- `AI_TRIAGE_ENABLED=false`, `AI_TRANSCRIPTION_ENABLED=false`. Ruční AI neobchází první přepínač. Přepis vyžaduje oba přepínače a klíč; veřejný upload endpoint přepis neprovádí.
- `RETENTION_ENABLED=false`: cron jen vypíše počty kandidátů a zapíše audit náhledu. Fyzické mazání až po schválení pravidla a skutečném staging testu. Pracovní pravidlo je 12 měsíců od odeslání nezveřejněného příběhu a 24 měsíců od posledního kontaktu, jinak vytvoření, nabídky.
- `SITE_LIVE` beze změny. Middleware má úzké výjimky pro admin a jeho chráněné API; veřejný web dál zůstává coming soon.
- Cron po 5 minutách pro AI vyžaduje odpovídající plán Vercelu nebo jiný schválený scheduler. Je vypnutý flagem; nepoužije žádný model bez schválení.

## Provozní význam a meze
- „Zveřejněno“ je interní stav, ne automatické publikování na web nebo sítě. Vyžaduje doložené 18+ i souhlas se zveřejněním. Historická data zůstávají u chybějících důkazů neznámá.
- Kategorie se načítají z DB. Navržené páry jsou podle stejné účinné kategorie; kategorie admina má přednost před AI. Doporučení nejsou odborné posouzení vhodnosti. Admin každý pár potvrdí/zamítne; nikomu se automaticky nepíše.
- Fronta po insertu ukládá jen identifikátory; po budoucím zapnutí AI ji worker zpracovává s maximálně dvěma opakováními. Současná varianta není okamžitá po odeslání: čeká na worker, nejméně do dalšího pětiminutového ticku, při frontě déle. Jeden běh obslouží jeden záznam, aby se vešel do limitu funkce. Bezpečné okamžité spouštění a vyšší kapacita vyžadují schválený scheduler/webhook. Anonymní `/api/triage` záměrně vrací 401 a nemůže vybírat cizí záznamy k externímu zpracování.
- Fulltext používá `unaccent` a konfiguraci `simple`; standardní PostgreSQL nemá vestavěný český stemmer. Hledá bez diakritiky, nikoli se znalostí českého skloňování. Citlivý hledaný text se neukládá do URL prohlížeče; ostatní filtry ano.
- Export i výmaz osoby lze spustit z detailu nebo podle přesné adresy přes „Údaje osoby“. Zahrnují příběhy, nabídky, poznámky, historii, páry, coming soon přihlášení i staré preregistrace, pokud příslušná volitelná tabulka existuje (v ověřeném projektu 7. 11. neexistovala). Nejde o export napříč externími systémy správce. Export vynechá technický hash potvrzovacího tokenu.
- Výmaz označí snapshot záznamů, smaže audio a pak záznamy s jejich vazbami. Při chybě audia zůstane rozpracovaný výmaz viditelný a lze jej zopakovat. Nový souběžný příspěvek po označení není smazán tímto starším snapshotem.
- Retence odstraňuje jednotlivý prošlý záznam, nikoli ostatní mladší záznamy téhož člověka. Denně zpracuje nejvýše 100 záznamů a 100 audio souborů; větší backlog vyžaduje další běhy a monitoring.
- RLS umožňuje adminovi čtení a zakazuje přímé klientské mutace; změny běží přes auditované serverové operace. Audit zachycuje aplikací provedené operace, není náhradou auditování libovolných přímých databázových SELECT administrátorem či service-role nástrojem.
- Nejsou právně schválené krizové instrukce ani kontakty; UI upozorňuje na nutnost lidského posouzení. Šablona odpovědi je pouze koncept pro vlastní poštu. Automatické e-maily ani oznámení se nepřidávají.
- Staré produkční soubory v `story-audio` nebyly smazány; k tomu je potřeba zvláštní souhlas a seznam konkrétních souborů.

## Zdroje ověřené při implementaci
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage](https://supabase.com/docs/guides/storage/security/access-control), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Ověřený formát `json_schema`, `strict`, enum a `additionalProperties:false`; žádné skutečné texty nebyly odeslány modelu.


## E-mailový zdroj Microsoft 365

Nové rozšíření vyžaduje po admin_workspace ještě migraci `supabase/migrations/20261109000000_admin_mail.sql`, kterou agent připravil a testoval pouze lokálně. Produkční změny nebyly aplikovány. Kompletní postup, proměnné, certifikát, RBAC a kontrolní příkazy jsou v [microsoft365.md](microsoft365.md). Nejprve staging, pak výslovné schválení nasazení. Výchozí ingest i zdrojová AI vypnuté, žádné reálné připojení schránky neproběhlo.


## Jednorázový odkaz bez admin účtu příjemce

Delegované připojení používá MSAL Node a novou migraci `20261110000000_mail_oauth.sql` po admin_mail. Postup [microsoft365-odkaz.md](microsoft365-odkaz.md) nahrazuje PowerShell/certifikátový návod pro zvolenou jednodušší variantu. Vyžaduje registraci Web redirect URI, delegované User.Read/Mail.Read a serverový client secret; nic z toho nebylo v tenantovi nastaveno agentem. M365_CONNECT_ENABLED a M365_INGEST_ENABLED jsou oddělené; AI zůstává samostatně vypnutá. Nejprve schválené HTTPS preview s oddělenou DB a explicitním preview callbackem, potom schválení produkce.
