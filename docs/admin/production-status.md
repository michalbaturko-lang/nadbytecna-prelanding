# Nasazení a aktuální předání

## Oprava po uživatelském testu — 8. 11. 2026

**Admin je nasazený, ale přihlašovací e-mail není provozně připravený bez vlastního SMTP.** V provozním logu je 8. 11. v 11:26:59 Europe/Prague požadavek POST /auth/v1/otp se stavem 429. Dashboard potvrzuje vestavěné testovací odesílání Supabase; má limit 2 e-maily/hodinu a omezené příjemce. Dřívější úspěšný test jednoho přihlášení proto nepotvrzoval spolehlivou produkční doručitelnost pro oba uživatele.

- Přihlašovací formulář rozlišuje omezení odesílání a chybu konfigurace. Neúspěšné opakování zachová dřívější nevypršelý PKCE verifier; nově odmítnutá žádost svůj nepoužitý verifier odstraní. Platnost se opakováním neprodlužuje.
- Na výslovné přání uživatele je bezpatkové písmo Jost z Dermacol.cz sjednoceno v adminu, veřejném webu a připojovací stránce. Soubory z @fontsource-variable/jost 5.3.0 (OFL-1.1) jsou hostovány lokálně, včetně češtiny a licence. Nepřebíráme soubory z cizího webu.
- Nutný další krok: účet odesílací služby a ověření odesílací domény, následně nastavení SMTP v Supabase. Uživatel zatím žádnou službu nemá. Připravená varianta Resend: smtp.resend.com, port 465, uživatel resend; API klíč patří pouze do pole hesla SMTP, nikdy do veřejného webu nebo dokumentace. Doporučený samostatný odesílatel prihlaseni@auth.nadbytecna.cz po ověření této subdomény. Příchozí schránka Microsoftu se nemění.
- Po připojení je nutné skutečně ověřit doručení a přihlášení obou schválených účtů. Nejde o hotovou opravu doručování, dokud není služba nastavena a tento test proveden.

Zdroje: https://www.dermacol.cz/common/build/assets/index-Bm0o-WNL.css, https://supabase.com/docs/guides/auth/rate-limits, https://supabase.com/docs/guides/auth/auth-smtp, https://resend.com/docs/send-with-supabase-smtp.

## Původní produkční ověření — 8. 11. 2026

Admin je nasazený na https://nadbytecna.cz/admin/. PR #11 byl sloučen; zachovává veřejné změny z main 70e6104. Veřejný web zůstává coming soon.

- Na ověřeném projektu gjzsifxldxaogcuqzivb byly po kontrole shody 53 sloupců aplikovány migrace admin_workspace, admin_mail a mail_oauth v jedné transakci. Historie migrací je zapsaná.
- Povolené účty: veryvera@nadbytecna.cz a mbo@michalbaturko.com. Skutečné přihlášení mbo přes doručený e-mail v nové kartě je ověřeno; Věřino vlastní přihlášení zatím ne.
- Nastaveny serverové klíče a samostatná náhodná tajemství; hodnoty se do dokumentace ani Git neukládají. Auth Site URL a přesný redirect směřují na produkční admin.
- Opraveno no-store pro HTML adminu, přenos PKCE mezi kartami a skalární PostgREST filtry pro UUID. Přihlašovací tokeny zůstávají v sessionStorage; pouze krátkodobý PKCE verifier může být v localStorage (15 minut).
- Skutečná produkční kontrola: anonymní vložení dvou syntetických záznamů a tichého WAV, zákaz anonymního čtení tabulek, privátní bucket, skutečný přehled/detail, ruční klasifikace, stav/historie, poznámka, CSV a ZIP s daty a audiem. Podepsaná nahrávka měla platnost 120 s: před vypršením HTTP 200, po vypršení HTTP 400 InvalidJWT. Oba syntetické záznamy a audio byly odstraněny úzkým kontrolovaným úklidem přes serverové funkce; není to potvrzení celého hostovaného GDPR UI workflow. Žádné skutečné příběhy nebyly posílány AI.
- AI, přepis, Microsoft connect/import a automatické mazání zůstávají vypnuté. Schránka není připojena; čeká se na registraci aplikace a přístup od správce podle microsoft365-odkaz.md. PowerShell ani certifikát nejsou pro zvolenou delegovanou variantu potřeba.
- Lokálně prošlo 163/163 testů a 80 prohlížečových kontrol (29 základ, 22 e-mail, 14 pozvánka, 11 veřejné připojení, 4 PKCE). Transport Microsoftu je v těchto testech simulovaný. Regrese porovnala 12 veřejných stránek a 5 souborů s main 70e6104.

Zbývá provozní rozhodnutí o retenci, krizovém postupu, publikování a případném zapnutí AI. Testy nejsou právním schválením těchto rozhodnutí.
