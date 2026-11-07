# Admin Nadbytečná.cz — podklady k revizi

Stav k 7. 11. 2026: implementace a lokální ověření jsou připravené k revizi. Produkční admin nebyl tímto ověřen ani nasazen. Základ testovací databáze nyní vychází ze skutečných metadat přečtených read-only přes přihlášený SQL editor 7. 11.; jde pouze o strukturu, nikoli produkční osobní data. Snapshot je v `tests/fixtures/admin-schema-2026-11-07.json`.

## Co je připravené

- Český mobilní a desktopový přehled příběhů a nabídek: počty, filtry, hledání bez diakritiky, řazení a stránky po 25.
- Detail, ruční kategorie a naléhavost s předností před AI, workflow, poznámky, historie a potvrzované párování.
- Magic link, allowlist, 12h nečinnost, serverové mutace, audit, privátní audio s podpisem 120 s, noindex a no-store.
- Nové potvrzení 18+ a evidence souhlasů, CSV, GDPR ZIP a opakovatelný výmaz podle přesného e-mailu včetně registrací.
- Retenční běh s výchozím náhledem, fronta pro budoucí AI, validace výstupů a zachování lidských rozhodnutí. AI i přepis zůstávají ve výchozím stavu vypnuté.
- Další zprávy stejného kontaktu, koncept odpovědi a upozornění na akutní případy i blížící se výmaz.

## Ověření a ukázky

- [Souhrn výsledků](test-results.json): 96/96 lokálních unit a integračních testů, 29 prohlížečových kontrol, 18 screenshotů.
- [Prohlížečové výsledky](browser-results.json): seznam, detail a filtry na 320, 375, 768, 1024, 1440 a 1920 px; veřejné formuláře a globální GDPR dialog. Bez zjištěného přetékání a nálezů axe v testovaných pohledech.
- [Regrese veřejného webu](public-regression.json): porovnání devíti veřejných HTML se základním commitem, povolená změna 18+; vybrané vizuální soubory a cookie skript shodné.
- Lighthouse Accessibility v režimu snapshot: [mobilní seznam](lighthouse-mobile-list.json), [mobilní detail](lighthouse-mobile-detail.json), [desktopový seznam](lighthouse-desktop-list.json), [desktopový detail](lighthouse-desktop-detail.json), všechny 100/100. Nejde o produkční měření výkonu.
- Ukázky se syntetickými daty: [mobil — seznam](screenshots/375-list.png), [mobil — detail](screenshots/375-detail.png), [desktop — seznam a detail](screenshots/1440-detail.png). [Úplná tabulka screenshotů](checklist.md#screenshoty-všechno-syntetické).

Testy nevkládaly data do produkce, neposílaly skutečné e-maily a nevolaly skutečný model OpenAI. Auth a Storage transport jsou v lokálních průchodech nahrazené testovacími implementacemi.

## Co je nutné před produkcí

1. Před aplikací ověřit případný drift proti již získanému read-only snapshotu skutečných tabulek, typů, triggerů, policies a Storage. MCP čtení odmítlo; přihlášený SQL editor jej umožnil. K opakování slouží [read-only preflight](schema-preflight.sql).
2. Ověřit migraci na samostatné Supabase větvi, skutečný magic link, 401/403, privátní Storage a vypršení podpisu. Pro preview je nutná samostatná DB a přesný hostname v CSP.
3. Doplnit dvě schválené adresy administrátorů a provozní tajemství přímo do důvěryhodného nastavení, ověřit scheduler a plán Vercelu.
4. Schválit konkrétní migraci a nasazení. Sladit změnu DB s formulářem 18+, aby mezi nimi nevzniklo období nefunkčního odesílání.
5. Rozhodnout retenční základ, způsob veřejného publikování a krizový postup. Zapnutí AI a přepisu vyžaduje souhlas advokátky. Staré soubory v produkčním bucketu vyžadují samostatný souhlas s konkrétním seznamem.

Automatická AI v této variantě čeká na pětiminutový worker, který zpracuje jeden záznam za běh; nejde o okamžitou triáž po odeslání. Hledaný citlivý text se neukládá do URL a fulltext nepoužívá český stemmer. Tyto odchylky jsou výslovně určené k revizi.

## Dokumenty pro revizi

- [Návrh a odůvodnění](../admin-plan.md)
- [Úplný akceptační checklist, funkce a omezení](checklist.md)
- [Předání, konfigurace a postup nasazení](deployment.md)
- [SQL pro čtení skutečného schématu](schema-preflight.sql)
- [Navržená migrace](../../supabase/migrations/20261108000000_admin_workspace.sql)

Ověřený [draft PR #11](https://github.com/michalbaturko-lang/nadbytecna-prelanding/pull/11) je otevřený a nesloučený. Vercel preview build byl Ready; to není funkční staging test propojení s databází.

## Lokální ukázka

`npm run preview:admin` spustí na tomto počítači syntetický náhled na `http://127.0.0.1:4477/admin/?sort=urgency`. Přihlášení je v tomto výhradně lokálním testovacím serveru nahrazené testovací session, nikoli heslem ani produkčním účtem. Všechny změny žijí jen v paměti a po vypnutí náhledu zmizí. Produkční Vercel tyto testovací routy nepoužívá.
