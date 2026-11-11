# Nasazení a aktuální předání

## Příprava na 11. 11. — 8. 11. 2026

Exporty CSV a osobního ZIP používají postupný přenos místo jedné odpovědi omezené na hostingu 4,5 MB. Lokální API ověřuje ZIP s 6 MiB nekomprimovatelného audia, CSV se 600 syntetickými příběhy přes více stránek, zachování bajtů, soukromé hlavičky a zákaz exportu pro cizí účet. Samostatné testy ověřují pomalého klienta a přerušení. Před přenosem zůstává úplná příprava a audit; ZIP má dosavadní hranici 100 MiB audia. Velký export na skutečném hostu zatím ověřen nebyl. Aktuální lokální běh: 168/168 testů a 34/34 základních prohlížečových kontrol; zbývající e-mailové a přihlašovací prohlížečové výsledky jsou z předchozího dnešního průchodu.

[Plán spuštění a ruční postup](launch-2026-11-11.md) výslovně uvádí zástupné položky v současných veřejných zásadách. Jejich právní obsah se nedoplňoval odhadem. Resend a Microsoft zůstávají odložené, přepínače AI/importu/automatického mazání i SITE_LIVE se neměnily.


## Další kontrola ručního zpracování — 8. 11. 2026

Read-only inventář bucketu story-audio: 14 objektů, žádný přiřazený k příběhu, celkem 1 106 998 B. Obsah nebyl čten a nic nebylo smazáno. Nepřiřazený objekt není automaticky testovací ani určený ke smazání; evidence je ve storage-inventory.json.

- Záznam bez výsledku AI už nenese štítek návrhu AI; zpráva i e-mail uvádějí „Zatím bez shrnutí AI“. Ruční klasifikace zůstává dostupná s vypnutou AI.
- Prázdná kolekce, nulové hledání a prázdná stránka staršího stránkovaného odkazu mají odlišné texty. V seznamu lze přímo zrušit filtry nebo se vrátit na první stránku se zachováním řazení.
- Počty zpráv a vláken používají české tvary. Přes skutečný lokální PostgreSQL/API ověřeno 0, 1, 2, 4 a 5 zpráv a jedno e-mailové vlákno.
- Aktuálně prošlo 163/163 testů a 89 browser kontrol (34 admin, 22 e-mail, 14 pozvánky, 11 veřejné připojení, 8 přihlášení/typografie). Čtyři nové Lighthouse Accessibility snapshoty po Jost: mobil/desktop, seznam/detail, všechny 100/100. Připraveno 28 syntetických screenshotů včetně nových prázdných přehledů.
- Akceptační checklist je přepsaný na aktuální důkazy; přednasazovací tvrzení už nejsou prezentována jako dnešní stav. Testy této kontroly neposílaly skutečné e-maily, nevolaly AI/Microsoft a neměnily produkční osobní data.

## Oprava po uživatelském testu — 8. 11. 2026

**Resend je na výslovný pokyn uživatele nyní odložený.** Příplatek 20 USD měsíčně byl schválen, ale uživatel před jeho zapnutím požádal Resend přeskočit. Add-on nebyl zapnut, nová doména nadbytecna.cz ani API klíč nevznikly, DNS a SMTP zůstávají beze změny. Bez nového pokynu se k tomuto kroku nevracet.

Správný účet Resend je michal.baturko@regalmaster.cz / regalmaster Pro (ověřeno přihlášením a přepínačem identity). Uživatel odmítl odesílatele přes send.regalmaster.cz a požaduje přímo nadbytecna.cz; cílem je Nadbytečná <prihlaseni@nadbytecna.cz>. Nepoužitý formulář klíče a rozepsané SMTP pro send.regalmaster.cz byly zrušeny. Účet má všech 10 domén obsazených. Add domain otevírá nabídku Add more domains / Domains add-on / $20 per month / 100 more domains. Samostatný Create team je také označen Paid feature. Příplatek 20 USD/měsíc byl následně schválen, ale před kliknutím odložen spolu s celým Resendem. K dokončení později chybí obnovení tohoto kroku a přístup/správce DNS FlexCloud/ClouDNS. MX Microsoftu a SPF include:spf.protection.outlook.com -all nebyly změněny; send, rsend a resend._domainkey při kontrole neměly záznamy. Doména nadbytecna.cz dosud nebyla přidána, nejsou vytvořené její ostré DKIM údaje ani nový API klíč. SMTP zůstává vypnuté.

**Admin je nasazený, ale přihlašovací e-mail není provozně připravený bez vlastního SMTP.** V provozním logu je 8. 11. v 11:26:59 Europe/Prague požadavek POST /auth/v1/otp se stavem 429. Dashboard potvrzuje vestavěné testovací odesílání Supabase; má limit 2 e-maily/hodinu a omezené příjemce. Dřívější úspěšný test jednoho přihlášení proto nepotvrzoval spolehlivou produkční doručitelnost pro oba uživatele.

- Přihlašovací formulář rozlišuje omezení odesílání a chybu konfigurace. Neúspěšné opakování zachová dřívější nevypršelý PKCE verifier; nově odmítnutá žádost svůj nepoužitý verifier odstraní. Platnost se opakováním neprodlužuje.
- Na výslovné přání uživatele je bezpatkové písmo Jost z Dermacol.cz sjednoceno v adminu, veřejném webu a připojovací stránce. Soubory z @fontsource-variable/jost 5.3.0 (OFL-1.1) jsou hostovány lokálně, včetně češtiny a licence. Nepřebíráme soubory z cizího webu.
- Nutný další krok: účet odesílací služby a ověření odesílací domény, následně nastavení SMTP v Supabase. Uživatel má dva účty Resend. Otevřený účet michal.baturko@unitedvisions.cz / unitedvisions byl uživatelem odmítnut jako nesprávný. V něm vznikla pouze neověřená příprava auth.nadbytecna.cz (domain id 9adcdd8d-6eb5-41f6-a28b-279f8594ec1e, stav not started). DNS, SMTP ani žádný nový API klíč nebyly nastaveny. V tomto účtu nepokračovat; nejprve ověřit přesný správný účet. Jeho DNS záznamy znovu získat přímo z cílového účtu a pak ověřit doručování. Připravená varianta Resend: smtp.resend.com, port 465, uživatel resend; API klíč patří pouze do pole hesla SMTP, nikdy do veřejného webu nebo dokumentace. Doporučený samostatný odesílatel prihlaseni@auth.nadbytecna.cz po ověření této subdomény. Příchozí schránka Microsoftu se nemění.
- Po připojení je nutné skutečně ověřit doručení a přihlášení obou schválených účtů. Nejde o hotovou opravu doručování, dokud není služba nastavena a tento test proveden.

Zdroje: https://www.dermacol.cz/common/build/assets/index-Bm0o-WNL.css, https://supabase.com/docs/guides/auth/rate-limits, https://supabase.com/docs/guides/auth/auth-smtp, https://resend.com/docs/send-with-supabase-smtp.

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
