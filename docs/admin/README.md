# Admin Nadbytečná.cz — podklady k revizi

[Plán spuštění 11. 11. a denní ruční postup](launch-2026-11-11.md) rozlišuje nutné kroky od volitelných integrací.

## Aktuální omezení přihlášení

Přihlašovací e-maily používají testovací službu Supabase s limitem 2/hodinu. Produkční doručování zatím vyžaduje vlastní SMTP; stav a konkrétní náprava jsou v [aktuálním předání](production-status.md). Uživatelský pokus 11:26:59 skončil HTTP 429. UI nyní vysvětluje limit a odmítnuté opakování nepoškodí dřívější platný odkaz. Typografie je sjednocena na bezpatkové Jost podle Dermacol.cz.

## Původní produkční ověření — 8. 11. 2026

Admin je nasazený na https://nadbytecna.cz/admin/. PR #11 byl sloučen; zachovává veřejné změny z main 70e6104. Veřejný web zůstává coming soon.

- Na ověřeném projektu gjzsifxldxaogcuqzivb byly po kontrole shody 53 sloupců aplikovány migrace admin_workspace, admin_mail a mail_oauth v jedné transakci. Historie migrací je zapsaná.
- Povolené účty: veryvera@nadbytecna.cz a mbo@michalbaturko.com. Skutečné přihlášení mbo přes doručený e-mail v nové kartě je ověřeno; Věřino vlastní přihlášení zatím ne.
- Nastaveny serverové klíče a samostatná náhodná tajemství; hodnoty se do dokumentace ani Git neukládají. Auth Site URL a přesný redirect směřují na produkční admin.
- Opraveno no-store pro HTML adminu, přenos PKCE mezi kartami a skalární PostgREST filtry pro UUID. Přihlášení se pamatuje v tomto prohlížeči nejvýše 30 dní. Stejný pevný limit hlídá server; obnovení tokenu jej neprodlužuje. Ruční odhlášení vymaže uloženou relaci i v ostatních kartách. PKCE verifier má nadále platnost 15 minut.
- Skutečná produkční kontrola: anonymní vložení dvou syntetických záznamů a tichého WAV, zákaz anonymního čtení tabulek, privátní bucket, skutečný přehled/detail, ruční klasifikace, stav/historie, poznámka, CSV a ZIP s daty a audiem. Podepsaná nahrávka měla platnost 120 s: před vypršením HTTP 200, po vypršení HTTP 400 InvalidJWT. Oba syntetické záznamy a audio byly odstraněny úzkým kontrolovaným úklidem přes serverové funkce; není to potvrzení celého hostovaného GDPR UI workflow. Žádné skutečné příběhy nebyly posílány AI.
- AI, přepis, Microsoft connect/import a automatické mazání zůstávají vypnuté. Schránka není připojena; čeká se na registraci aplikace a přístup od správce podle microsoft365-odkaz.md. PowerShell ani certifikát nejsou pro zvolenou delegovanou variantu potřeba.
- Lokálně prošlo 163/163 testů a 80 prohlížečových kontrol (29 základ, 22 e-mail, 14 pozvánka, 11 veřejné připojení, 4 PKCE). Transport Microsoftu je v těchto testech simulovaný. Regrese porovnala 12 veřejných stránek a 5 souborů s main 70e6104.

Zbývá provozní rozhodnutí o retenci, krizovém postupu, publikování a případném zapnutí AI. Testy nejsou právním schválením těchto rozhodnutí.

## Ruční práce bez AI

Nezpracované zprávy se již netváří jako návrh AI. Prázdný seznam se odlišuje od nulových výsledků hledání; filtry lze přímo zrušit a starší stránkovaný odkaz vrátit na první stránku. Počty mají správné české tvary. Nové prázdné přehledy: [mobil](screenshots/375-empty-list.png) a [desktop](screenshots/1440-empty-list.png). Aktuální [checklist](checklist.md) rozlišuje lokální testy, skutečně ověřené nasazení a otevřené provozní kroky.

## Co je připravené

- Český mobilní a desktopový přehled příběhů a nabídek: počty, filtry, hledání bez diakritiky, řazení a stránky po 25.
- Detail, ruční kategorie a naléhavost s předností před AI, workflow, poznámky, historie a potvrzované párování.
- Magic link, allowlist, 12h nečinnost, serverové mutace, audit, privátní audio s podpisem 120 s, noindex a no-store.
- Nové potvrzení 18+ a evidence souhlasů, CSV, GDPR ZIP a opakovatelný výmaz podle přesného e-mailu včetně registrací.
- Retenční běh s výchozím náhledem, fronta pro budoucí AI, validace výstupů a zachování lidských rozhodnutí. AI i přepis zůstávají ve výchozím stavu vypnuté.
- Další zprávy stejného kontaktu, koncept odpovědi a upozornění na akutní případy i blížící se výmaz.

## E-maily Microsoft 365

Připravená samostatná záložka pro veryvera@nadbytecna.cz: vlákna a stránkované zprávy, hledání a filtry, ruční zařazení, poznámky, JSON export a výmaz místní kopie. Zvolený serverový import používá delegované připojení jednorázovým odkazem, pouze Graph GET, kontrolované pokračovací odkazy, transakční kurzor, deduplikaci, backoff a ochranu před opětovným importem vymazaných kopií. AI pouze ručně po odděleném schválení a zapnutí; žádné odesílání e-mailů.

Schránka není připojena. Po předání přístupu zbývá doplnit konfiguraci aplikace a ověřit skutečný Microsoft. [Přesný postup a omezení](microsoft365.md), [22 integračních kontrol](mail-integration-results.json), [desktop ukázka](screenshots/1440-mail-detail.png), [mobil](screenshots/375-mail-detail.png).

## Připojení schránky odkazem

Připravená delegovaná varianta: admin vytvoří soukromý jednorázový odkaz, příjemce se přihlásí přímo u Microsoftu bez účtu v adminu. Pozvánka platí 30 minut; správný tenant a schránka se ověřují před uložením šifrované cache. Přístup do adminu tím nevzniká. [Krátké nastavení správce a provozní postup](microsoft365-odkaz.md). Registrace aplikace a její serverové tajemství zatím chybí, takže nebyla vydána ostrá funkční pozvánka.

## Ověření a ukázky

- [Souhrn výsledků](test-results.json): 163/163 lokálních unit a integračních testů, 89 prohlížečových kontrol (34 základní admin + 22 e-mailových + 14 admin pozvánky + 11 veřejná stránka + 8 přihlášení a typografie), 28 screenshotů.
- [Prohlížečové výsledky](browser-results.json): seznam, detail a filtry na 320, 375, 768, 1024, 1440 a 1920 px; veřejné formuláře a globální GDPR dialog. Bez zjištěného přetékání a nálezů axe v testovaných pohledech.
- [Regrese veřejného webu](public-regression.json): porovnání 12 veřejných HTML se základním commitem, povolená změna 18+; vybrané vizuální soubory a cookie skript shodné.
- Lighthouse Accessibility v režimu snapshot: [mobilní seznam](lighthouse-mobile-list.json), [mobilní detail](lighthouse-mobile-detail.json), [desktopový seznam](lighthouse-desktop-list.json), [desktopový detail](lighthouse-desktop-detail.json), všechny 100/100. Nejde o produkční měření výkonu.
- Ukázky se syntetickými daty: [mobil — seznam](screenshots/375-list.png), [mobil — detail](screenshots/375-detail.png), [desktop — seznam a detail](screenshots/1440-detail.png). [Úplná tabulka screenshotů](checklist.md#screenshoty-všechno-syntetické).

Lokální testy nevkládaly data do produkce, neposílaly skutečné e-maily a nevolaly skutečný model OpenAI. Oddělená produkční kontrola je popsána výše. Auth a Storage transport jsou v lokálních průchodech nahrazené testovacími implementacemi.

## Zbývající provozní kroky

Viz [aktuální předání](production-status.md), zejména Microsoft, Věřino první přihlášení a rozhodnutí o AI/retenci.

Automatická AI v této variantě čeká na pětiminutový worker, který zpracuje jeden záznam za běh; nejde o okamžitou triáž po odeslání. Hledaný citlivý text se neukládá do URL a fulltext nepoužívá český stemmer. Tyto odchylky jsou výslovně určené k revizi.

## Dokumenty pro revizi

- [Microsoft 365: e-mailový zdroj, přístup a ověření po schválení](microsoft365.md) — lokálně připravené rozšíření pro vyhrazenou schránku veryvera@nadbytecna.cz; není připojena a zatím nebyly čteny skutečné zprávy.
- [Návrh a odůvodnění](../admin-plan.md)
- [Úplný akceptační checklist, funkce a omezení](checklist.md)
- [Předání, konfigurace a postup nasazení](deployment.md)
- [SQL pro čtení skutečného schématu](schema-preflight.sql)
- [Navržená migrace](../../supabase/migrations/20261108000000_admin_workspace.sql)

[PR #11](https://github.com/michalbaturko-lang/nadbytecna-prelanding/pull/11) je sloučený a admin nasazený. Aktuální produkční ověření je oddělené od lokálních výsledků výše.

## Lokální ukázka

`npm run preview:admin` spustí na tomto počítači syntetický náhled na `http://127.0.0.1:4477/admin/?sort=urgency`. Přihlášení je v tomto výhradně lokálním testovacím serveru nahrazené testovací session, nikoli heslem ani produkčním účtem. Všechny změny žijí jen v paměti a po vypnutí náhledu zmizí. Produkční Vercel tyto testovací routy nepoužívá.

## Přehled seznam–detail — 11. 11. 2026

E-maily i příběhy/nabídky používají kompaktní seznam vlevo a čtení vpravo; na mobilu se seznam a detail střídají. Hlavní text nebo přehrávač jsou první. Poznámky, zařazení, kontakt/souhlasy, AI a historie se otevírají jednotlivě. Vyhledávání zůstává viditelné, další filtry a provozní nastavení jsou rozbalovací.

Migrace `20261111153428_admin_inbox_previews.sql` přidává úryvky do 180 znaků; služební pohled má `security_invoker=true`, veřejné a běžné přihlášené role nemají přístup. Původní texty a zvukové soubory se nemění. V produkci ověřena shoda počtů záznamů, omezení délky a oprávnění. Aktivace AI ani změna Microsoft oprávnění nejsou součástí úpravy.

Lokálně: 351 testů, 34 obecných browser kontrol, 22 průchodů poštou s reálnou testovací databází, šest šířek 320–1920 px, 8 kontrol přihlášení a 6 kontrol dlouhodobé relace. Poznámky, stavy, export, výmaz pouze místních kopií, přehrávání a vyčištění hlasovky při zavření/odhlášení jsou součástí syntetických průchodů. Produkční ověření nového rozhraní je omezené na čtení; ostré záznamy se kvůli vizuální změně neupravují.

## Stažení příběhu do PDF

V horní liště detailu příběhu je tlačítko **Stáhnout PDF** (na mobilu **PDF ↓**). Vytvoří čtecí kopii s vloženým bezpatkovým písmem Jost, datem v českém časovém pásmu, automatickým stránkováním a původním textem. Krátký úvod může sloužit jako nadpis; žádný nový nadpis ani shrnutí se negeneruje. Zvolená anonymita se respektuje u jména autorky/autora. Kontakty, interní poznámky, pracovní stavy a podepsané odkazy na zvuk se neexportují.

U hlasovky bez přepisu PDF výslovně uvádí, že je k dispozici jen zvuk v přihlášeném adminu. Existující přepis je označený jako AI přepis, který může obsahovat chyby. PDF není publikace ani GDPR ZIP.

Export používá existující oprávnění administrátora a uložený záznam, není veřejně dostupný, neukládá další kopii textu do databáze ani nespouští AI. Audit obsahuje pouze typ exportu, ID záznamu a počet stran. Není potřeba migrace databáze ani další služba.

Ověření doplnění: 355 testů, 34 obecných browser kontrol, skutečné stažení přes lokální API/databázi při šesti šířkách 320–1920 px, nulové nálezy přístupnosti a ochrana proti opožděnému stažení po odhlášení. Kontrola výsledného PDF ověřila českou diakritiku a úplnou shodu všech odstavců se zdrojovým textem.

## Místní štítky a Podezřelé — první fáze

Příchozí i historické místní kopie e-mailů dostávají více orientačních štítků podle pevných pravidel. Zpracování běží v existujícím minutovém načítání, po dávkách 25 vláken; nové a změněné zprávy mají přednost před opakováním historické klasifikace. Lokální třídění pokračuje i při výpadku Microsoftu. AI se tím nezapíná a Microsoft zůstává pouze pro čtení.

V Poště je výchozí pohled Doručené, samostatný pohled Podezřelé a filtr podle štítku. Tlačítko Štítky otevře důvod pravidla a ruční úpravy. Ruční odebrání automatického štítku se pamatuje; obnovení normální pošty potlačí štítky Spam / Podezření na podvod. Změna obsahu mezitím vyžaduje nové potvrzení. Zprávy, workflow stavy a originály se tříděním nemažou ani nemění.

Pravidla jsou orientační. Žádosti o pomoc, smíšená vlákna, neúplný kontext a přihlašovací či platební výzvy zůstávají viditelné k ověření. Signály Microsoft antispamu zatím nejsou součástí rozhodování; svévolné hlavičky ze zprávy se ignorují. Bez výslovně nastaveného seznamu blokovaných odesílatelů se žádná zpráva automaticky neschová.

Přepínač `MAIL_RULES_ENABLED=false` zastaví automatické vyhodnocování; výchozí stav je zapnuto. Volitelné `MAIL_RULES_BLOCKED_SENDERS` obsahuje JSON pole maximálně 200 přesných e-mailových adres, nikoli domén nebo vzorů. Shoda se seznamem může odložit pouze úplné jediné vlákno bez chráněného/nejasného obsahu. Změna seznamu vyvolá přehodnocení; ruční rozhodnutí zůstávají nad pravidly.

Migrační verze `20261111202111` ukládá soukromé štítky, původ a verzi pravidel. Běžné nové odpovědi zachovávají ruční úpravy; skutečné odstranění zdrojové zprávy vyčistí nové závěry i související audit a zneplatní staré rozpracované výsledky. GDPR a JSON exporty zahrnují štítky a jejich původ.

Ověřeno: 384 testů, 8 databázových scénářů včetně soukromých oprávnění, revizí, exportů a částečného výmazu; 11 nezávislých rizikových scénářů. Skutečný lokální průchod API/databáze/prohlížeče ověřil přidání a odebrání štítku, odložení a návrat pošty na šesti šířkách 320–1920 px bez přetékání či nálezů přístupnosti. Produkční zkouška migrace proběhla nejprve s ROLLBACK a beze změny počtu zdrojových zpráv.
