# Nasazení a aktuální předání

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
