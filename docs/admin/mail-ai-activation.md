# E-maily a automatická AI — provozní postup

Stav přípravy k 10. 11. 2026. Tento postup odděluje připojení Microsoftu, import místních kopií a schválené zpracování AI. Samotné uložení secretu žádný z těchto kroků nezapíná.

## Připravený rozsah

- Schránka: `veryvera@nadbytecna.cz`, vyhrazená projektu.
- Organizace: `a3e40c5f-05a5-42b5-8a02-4002a1cbafbe`.
- Aplikace: `088856cf-672f-45f2-8cae-8a0bb26ba96d`.
- Zvolená varianta: delegované přihlášení soukromým jednorázovým odkazem. [Nastavení registrace aplikace](microsoft365-odkaz.md).
- Schválený rozsah importu: **celá dosavadní historie složky Inbox**, včetně další příchozí pošty. Konfigurace `M365_FOLDER_ID=Inbox`, `M365_SINCE=1970-01-01T00:00:00.000Z` vyjadřuje, že aplikace nemá historickou časovou hranici. Není to souhlas se čtením dalších složek nebo schránek.
- Microsoft se používá pouze ke čtení. Zprávy se v Outlooku neposílají, nemažou, nepřesouvají ani neoznačují jako přečtené. Textový náhled neobsahuje přílohy. Samostatně povolený soukromý archiv ukládá původní `.eml` včetně jeho příloh; AI obsah příloh nedostává.

Schválený rozsah ještě není důkaz úplnosti importu. Úplnost a pokračování po stránkách se musí ověřit na skutečné schránce; počet místních vláken nemusí odpovídat počtu zpráv v Inboxu.

## Výchozí vypnutý stav

V produkci ponechat `M365_CONNECT_ENABLED=false`, `M365_INGEST_ENABLED=false` a všechny čtyři AI přepínače níže na `false`, dokud není dokončen příslušný krok postupu. Přepis a automatické mazání se tímto postupem nezapínají.

| Přepínač | Co dovolí hodnota `true` |
|---|---|
| `AI_TRIAGE_ENABLED` | Globální AI brána. Zároveň povoluje stávající worker webových příběhů a nabídek; není to pouze e-mailový přepínač. |
| `AI_EMAIL_CLASSIFICATION_ENABLED` | AI klasifikaci e-mailového zdroje. |
| `AI_EMAIL_PROCESSING_APPROVED` | Potvrzuje schválení zpracování tohoto zdroje AI. Nastavit až po doloženém schválení. |
| `AI_EMAIL_AUTOMATION_ENABLED` | Automatický e-mailový worker. Při `false` zůstává automatika vypnutá i tehdy, když je ruční AI povolená. |

Ruční AI v detailu vyžaduje první tři přepínače; automatický worker všechny čtyři. Při chybějícím přepínači automatický endpoint nečte frontu ani zprávy a nevolá model. Povolení samotného importu AI nepovolí.

**Před změnou globálního přepínače ověřit rozsah schválení také pro webové příběhy a nabídky.** Souhlas pouze s e-mailovou AI neopravňuje automaticky ke zpracování ostatních zdrojů.

## 1. Doplnit secret a ověřit připravenost

1. Hodnotu **Value** příslušného client secretu vložit přímo do zabezpečeného nastavení Vercelu pro tento projekt a prostředí **Production** jako `M365_CLIENT_SECRET`. Secret ID tuto hodnotu nenahrazuje. Secret nepatří do chatu, běžného e-mailu, repozitáře, screenshotu ani klientského JavaScriptu. Zaznamenat datum expirace a zajistit včasnou obnovu.
2. Ověřit shodu Client ID/Tenant ID, delegovaná oprávnění `User.Read` a `Mail.Read` a přesnou registraci **Web** návratové adresy `https://nadbytecna.cz/api/mail-connect/?step=callback`. MSAL při přihlášení využívá také standardní `offline_access`. Nepřidávat `Mail.Send` nebo `Mail.ReadWrite`.
3. Zachovat připravený `M365_TOKEN_ENCRYPTION_KEY` v serverovém secret store. Po vytvoření cache jej neměnit bez migračního plánu; nově vygenerovaný klíč původní cache neodemkne. Rovněž zachovat stabilní klíč potlačení opětovného importu (`M365_SUPPRESSION_SECRET`, případně stávající `GDPR_HASH_SECRET`).
4. `node tools/m365-readiness.mjs` vypíše pouze stav konfigurace a přepínačů, bez hodnot klíčů a bez sítě. `configurationFormatValidExceptSecret=true` znamená pouze připravenou ostatní konfiguraci. Ani `configurationFormatValid=true` neprokazuje správnost oprávnění, skutečné hodnoty secretu či přístup do Microsoftu. Redigované hodnoty z exportu nastavení nejsou skutečné přístupové údaje.
5. Před nasazením ověřit potřebné migrace `admin_workspace`, `admin_mail`, `mail_oauth`, `mail_ai_queue` a `mail_priority_sort` a shodu aplikace s databází. Již aplikované migrace nepouštět znovu mimo evidovanou historii. Pro testovací preview používat oddělenou DB; produkční DB v preview kód odmítá.

## 2. Připojit účet, zatím bez importu

1. Ponechat import i všechny AI přepínače vypnuté. Nastavit pouze `M365_CONNECT_ENABLED=true` a provést nové produkční nasazení, aby server nové nastavení načetl.
2. Přihlášený admin otevře **E-maily → Připojení schránky → Vytvořit připojovací odkaz**. Pozvánku předá soukromě určenému příjemci. Samotná veřejná adresa `/api/mail-connect/` bez pozvánky nic nepřipojí a není hotovým připojovacím odkazem.
3. Pozvánka platí 30 minut. Po kliknutí **Připojit přes Microsoft** má přihlášení vlastní limit 10 minut a musí skončit nejpozději do expirace pozvánky. Otevření pouhého náhledu odkazu pozvánku nespotřebuje.
4. Přihlášení dokončit přímo u Microsoftu účtem dané schránky. Příjemce nepotřebuje účet v adminu Nadbytečné. Je-li nutný souhlas správce organizace, správce nejprve schválí aplikaci a pak se vystaví nová pozvánka pro účet schránky. Jiný správcovský účet místo `veryvera@nadbytecna.cz` nebude přijat jako vlastník cílové schránky.
5. Ověřit úspěšný návrat do aplikace, správný tenant i schránku a stav připojení v adminu. Skutečný průchod musí ověřit také HTTPS cookies a návrat od Microsoftu; lokální mocky tento krok nenahrazují. Při chybě uchovat jen bezpečný kód chyby, nikoli URL s kódem, tokeny nebo obsah schránky.

## 3. Zapnout read-only import, AI ještě vypnutá

1. Zkontrolovat schválený rozsah **Inbox / celá historie**, stav připojení a vypnuté AI přepínače. Nastavit `M365_INGEST_ENABLED=true` a znovu nasadit produkci.
2. Chráněný `/api/mail-sync/` běží každých pět minut a načítá jednu stránku za běh. Pozdější běhy pokračují uloženým kurzorem. Případný ruční provozní test autentizovat hlavičkou s `CRON_SECRET`; tajemství nikdy nepřidávat do URL ani dokumentace.
3. Ve skutečné schránce ověřit nové vložení, opakované načtení bez duplicit, další stránku, správný původní text a zachování ručních poznámek a klasifikace. Ověřit pokrytí historie a dokončení počátečního importu; samotný úspěch jedné stránky neprokazuje načtení celé schránky.
4. Veškeré kopie a jejich fronta jsou místní. Import nepřevádí e-mail automaticky na veřejný příběh. Věk a souhlas se zveřejněním zůstávají neznámé a z přijetí e-mailu se neodvozují.
5. Při 429 se respektuje `Retry-After`. Při neplatném kurzoru se historie neobnovuje automaticky; nový běh musí zachovat ochranu proti opětovnému importu již vymazaných kopií. Při nepřiměřeně velké nebo neplatné zprávě se stránka neuloží a kurzor neposune. Operátor řeší bezpečný chybový stav bez kopírování obsahu do logu.

## 4. Po schválení zapnout AI

1. Zaznamenat právní/provozní schválení rozsahu AI zpracování, jeho datum a odpovědnou osobu. Ověřit také dopad globálního přepínače na webové příběhy a nabídky. Zkontrolovat dostupnost modelového klíče a stav fronty.
2. Pro automatiku nastavit všechny čtyři AI přepínače na `true` a provést nové produkční nasazení. `AI_TRANSCRIPTION_ENABLED` ponechat `false`; tento krok nepovoluje přepis zvuku.
3. Nejprve ověřit schválený kontrolní případ: uložený souhrn, druh e-mailu (`story` / `help` / `other`), kategorii, naléhavost, návrh dalšího kroku a stav fronty. Kvalitu skutečného modelového výsledku posuzuje člověk; úspěšný mock neprokazuje věcnou správnost modelu.
4. Fronta zahrnuje také dříve importovaná neanalyzovaná místní vlákna. Zapnutím se tedy zpracuje i schválený historický backlog. Fronta upřednostňuje ručně označenou akutní/vysokou naléhavost a potom novější zprávy; starší backlog může čekat déle.
5. V adminu sledovat počet čekajících, právě zpracovávaných a trvale neúspěšných vláken. Výchozí řazení e-mailů je podle účinné naléhavosti s předností lidského zařazení; lze přepnout na nejnovější nebo nejstarší. Nezpracovaný či chybový záznam lze řešit ručně.

## Jak automatika pracuje

- `/api/mail-ai-worker/` má minutový cron. Jeden běh zpracuje postupně nejvýše deset vlákna. To je horní mez, nikoli příslib tří výsledků každou minutu: worker má rozpočet 105 sekund a hostingový limit 120 sekund. Při pomalých požadavcích už další práci nepřebírá.
- Ruční i automatická AI používají stejný omezený kontext: nejvýše 30 nejnovějších dostupných zpráv a celkem 20 000 znaků Unicode. U dlouhé korespondence jde o výřez; starší část musí případně posoudit člověk. Přílohy se neanalyzují.
- Změna obsahu, odstranění/přesun zdrojové zprávy nebo místní výmaz zneplatní starý rozpracovaný výsledek. Návrat zprávy zpět do sledované složky může vytvořit novou revizi. Pouhé opakování stejného importu nový AI pokus nevytváří.
- Lease brání převzetí téhož aktivního jobu více workery. Na jednu revizi jsou nejvýše deset pokusy; po chybě následuje odklad pět a pak patnáct minut. Také opuštěný či přerušený běh podléhá omezení pokusů. Po vyčerpání je nutná ruční kontrola.
- AI ukládá pouze své návrhy. Nemění lidskou klasifikaci ani stav, nerozesílá odpovědi, nenabízí služby automaticky a nic nepublikuje. Novější ručně vyžádaný AI výsledek má před rozpracovaným automatickým během přednost. U nové zprávy v dříve ručně zařazeném vláknu člověk ověří, zda původní zařazení ještě platí.
- Archivované vlákno se automaticky nezpracovává. Archivace zruší rozpracovaný job; po obnovení neanalyzovaného vlákna se práce znovu zařadí. AI archiv sama neotevírá.
- Audit a provozní odpovědi obsahují stavové údaje a počty, nikoli těla, předměty, adresy odesílatelů nebo tokeny. Obsah zprávy je nedůvěryhodný vstup modelu a nesmí se stát příkazem pro aplikaci.

## Zastavení a řešení chyb

Pro zastavení automatické AI nastavit `AI_EMAIL_AUTOMATION_ENABLED=false` a znovu nasadit produkci. Pro úplné vypnutí e-mailové AI vypnout i `AI_EMAIL_CLASSIFICATION_ENABLED` a `AI_EMAIL_PROCESSING_APPROVED`. Již zahájený modelový požadavek může doběhnout; změna prostředí není odvoláním už odeslaného požadavku.

Pro zastavení importu nastavit `M365_INGEST_ENABLED=false` a znovu nasadit. Odpojení v adminu navíc odstraní zdejší připojovací cache a zneplatní rozpracované připojení/synchronizaci; nemaže místní kopie ani originály Microsoftu. Výmaz a retenční pravidla místních kopií jsou samostatné operace.

Při chybě neobcházet souhlasy a nepřepisovat historické klasifikace hromadně. Nejprve rozlišit připojení Microsoftu, synchronizaci, čekání ve frontě a chybu AI. Při vyčerpaných pokusech lze po opravě příčiny spustit ruční AI nad aktuálním vláknem. Automatické odpovědi ani přepis tím nevznikají.

## Rozsah dosavadního ověření

Před doplněním secretu prošlo 211 lokálních automatických testů, 34 základních prohlížečových kontrol, 22 integračních e-mailových kontrol a tři nové kontroly prioritního řazení. Použita byla syntetická data a náhrady Microsoft/modelových transportů. Tyto výsledky nepotvrzují skutečný Microsoft OAuth průchod, úplnost historického importu, doručování e-mailů ani kvalitu skutečné AI analýzy.

Závěrečné produkční ověření zaznamenat samostatně s konkrétním nasazením a rozsahem testu. Bez něj neoznačovat napojení schránky ani AI jako provozně ověřené.

## Produkční kontrola databáze 10. 11. 2026

Obě migrace aplikované v jedné transakci s evidencí verzí. Syntetická zkouška v produkční databázi ověřila 11 podmínek (fronta, výběr práce, uložení výsledku, přednost ruční klasifikace, řazení, audit, změna revize a výmaz). Test byl celý vrácen přes ROLLBACK; počty vláken, zpráv a úloh po testu jsou 0. Žádné volání modelu nebo Microsoftu. Bezpečnostní poradce nehlásí nové nálezy oproti stavu před migrací.

Schválená celá historie Inboxu používá první delta dotaz bez časového filtru, aby se neuplatnil limit 5 000 zpráv filtrované varianty. Regrese prošla 5 010 syntetických zpráv ve 201 stránkách; skutečný počet a úplnost historie potvrdí až import Microsoftu. Viz [Microsoft Graph](https://learn.microsoft.com/en-us/graph/delta-query-messages#use-query-parameters-in-a-delta-query-for-messages).


## Příprava před spuštěním 11. 11. 2026

Import běží každou minutu, nejvýše pět stránek za běh; po každé stránce ukládá zprávy a kurzor v jedné transakci. Novou stránku nezačíná po 25 sekundách běhu. Vadná dávka se neoznačí za načtenou. Při nadměrné odpovědi zkusí tentýž pokračovací odkaz jednou s menší stránkou; chybu ukáže v adminu. Text nad 100 000 znaků Unicode je výslovně označený náhled, plný obsah patří do originálního `.eml`.

Originály jsou v neveřejném bucketu `mail-originals`, jejich stav, cesta, velikost, revize a SHA-256 jsou v databázi. `M365_MAIL_ARCHIVE_ENABLED` je samostatný vypínač. Archivní worker zvládne nejvýše 20 postupných úloh v jednom běhu, má časový rozpočet 270 sekund a limit hostingu 300 sekund. Jeden originál má limit 50 MiB; větší nebo chybující soubor se výslovně označí jako neuložený a původní zpráva zůstane v Microsoftu. Žádný z těchto stropů není slib měřené kapacity. Stav „text načten“ neznamená „originál zazálohován“.

V adminu je pod „Kontrola načítání a ukládání“ porovnání počtu zpráv s Inboxem a test zápisu, načtení, SHA-256 a odstranění syntetického souboru. Test nepoužívá skutečnou poštu. Jednotlivý originál lze stáhnout až po uložení přes autorizovaný přístup s krátkou platností. Osobní ZIP obsahuje skutečné dostupné `.eml`; nedokončený archiv má manifest `complete:false`. Velikost exportu je omezená, překročení se odmítne výslovně.

Pro serverové ověření bez otevřeného adminu lze dočasně nastavit `M365_MAIL_ARCHIVE_VERIFY_ENABLED=true` a spustit existující chráněný cron `/api/mail-archive-worker/`. Tento režim pracuje pouze se syntetickým souborem, skutečnou archivaci přeskočí a úspěch zaznamená jako `archive_storage_verified` (217 bajtů). Po ověření se příznak vrátí na `false`; pro ukládání skutečné pošty musí být zvlášť zapnuté `M365_MAIL_ARCHIVE_ENABLED=true`. Změny nastavení vyžadují nové nasazení.

AI má navíc režim rozsahu `AI_EMAIL_SCOPE=marked` (bezpečný výchozí stav). Operátor označí konkrétní projektovou konverzaci; globální AI tím nezapne. Výslovný zákaz platí i při pozdějším režimu `all`. Odvolání zneplatní rozpracovaný výsledek, včetně odvolání následovaného novým povolením. Schránka obsahuje i nesouvisející poštu, proto režim `all` nepoužívat bez výslovného rozhodnutí vlastníka.

AI vrací hlavní druh, jeden z devíti podtypů, kategorii pomoci, naléhavost, shrnutí, návrh dalšího kroku, orientační slovní jistotu a důvod kontroly. Nízká jistota, akutní návrh nebo zkrácený zdroj vynutí lidskou kontrolu. Data přijetí a aktuální UTC pomáhají vyložit časové odkazy; marketingové akce nejsou automaticky naléhavé případy. Návrh není odborný závěr, souhlas se zveřejněním ani doklad věku.

Lidské „Zkontrolováno“ se váže k revizi vlákna. Nová odpověď či změna zdroje otevře vlákno znovu ke kontrole. Lidské zařazení má před návrhem AI přednost. Odlišovat „Bez povolení pro AI“ od skutečně povolené fronty.

Výmaz nejprve zablokuje originály příslušného rozsahu, poté je odstraní a až po ověření dokončení potvrdí úspěch. Rozpracovaný upload může vyžadovat doběhnutí ochranné lhůty; admin vrátí výslovný stav čekajícího úklidu. Trvalý anonymizovaný rozsah dovolí dokončit úklid i po smazání původních databázových řádků. Úklid probíhá i při vypnutém importu nebo archivu. Automatická retence má nadále samostatné schválení a není tímto postupem povolená.
