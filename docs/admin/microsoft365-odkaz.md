# Microsoft 365: připojení schránky jednorázovým odkazem

Stav k 7. 11. 2026: připravený a lokálně ověřený kód k revizi, nikoli vydaná ostrá pozvánka. Schránka není připojena; neproběhlo skutečné přihlášení u Microsoftu, čtení pošty ani AI volání. Registrace Microsoft aplikace a schválené hostované DB/nasazení dosud chybí. Dřívější PDF popisuje alternativní servisní variantu s certifikátem; pro tento způsob se Exchange RBAC ani PowerShell nepoužívají.

## Co udělá příjemce odkazu

1. Otevře soukromě předanou pozvánku. Účet v adminu Nadbytečné nepotřebuje.
2. Na samostatné stránce uvidí cílovou schránku veryvera@nadbytecna.cz, účel a rozsah čtení.
3. Klikne na **Připojit přes Microsoft**. Teprve toto kliknutí spotřebuje pozvánku a zahájí přihlášení; pouhý GET/preview e-mailového skeneru nic nepřipojí.
4. Přihlásí se přímo Microsoftu účtem dané schránky a potvrdí čtení. Heslo se do aplikace Nadbytečné neposílá.
5. Uvidí potvrzení připojení, nebo jasné odmítnutí/požadavek na novou pozvánku. Nevznikne účet ani přístup do adminu.

Pozvánka má platnost 30 minut, po zahájení musí být přihlášení dokončeno do 10 minut a nejpozději do expirace pozvánky. Nový odkaz ruší starší nedokončené pozvánky. Pokud Microsoft vyžaduje souhlas správce organizace, správce nejprve schválí aplikaci a potom se pro vlastníka schránky vydá nová pozvánka. Přihlášení jiným správcovským účtem místo účtu schránky je odmítnuto.

## Ověřená veřejná organizace

Veřejná Microsoft OIDC metadata pro doménu `nadbytecna.cz` dne 7. 11. 2026 vrací issuer `https://login.microsoftonline.com/a3e40c5f-05a5-42b5-8a02-4002a1cbafbe/v2.0`. Tenant ID je tedy **a3e40c5f-05a5-42b5-8a02-4002a1cbafbe**. Jde o veřejný identifikátor, nikoli heslo. Toto ověřuje organizaci domény, nikoli existenci, licenci ani oprávnění konkrétní schránky. Zdroj: https://login.microsoftonline.com/nadbytecna.cz/v2.0/.well-known/openid-configuration . Správce musí aplikaci založit v odpovídající organizaci a shodu ID ověřit.

## Jednorázové nastavení Microsoft aplikace (správce)

1. V https://entra.microsoft.com/ vybrat správnou organizaci a otevřít **App registrations → New registration**. Název **Nadbytečná admin**, typ **Single tenant**.
2. V **Authentication → Add a platform → Web** zaregistrovat přesnou návratovou adresu `https://nadbytecna.cz/api/mail-connect/?step=callback`. Jde o Web/serverovou aplikaci, ne SPA. Tato adresa je připravená v kódu; její ostré nasazení musí být nejprve schválené.
3. V **API permissions → Microsoft Graph → Delegated permissions** nastavit `User.Read` a `Mail.Read`. MSAL při přihlášení žádá také standardní `offline_access` pro obnovování přístupu. Nepřidávat aplikační `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` ani sdílený přístup `Mail.Read.Shared`. Pokud to vyžaduje politika organizace, správce potvrdí tyto delegované souhlasy. Jde o čtení jménem přihlášeného uživatele, nikoli o plošné aplikační čtení všech schránek.
4. V **Certificates & secrets → Client secrets** vytvořit přihlašovací údaj aplikace. Jeho **Value** uložit přímo do důvěryhodného serverového secret store jako `M365_CLIENT_SECRET`; nepřenášet ho v chatu, běžném e-mailu ani repozitáři. Zaznamenat jeho expiraci. Implementátor potřebuje `Tenant ID` a `Application (client) ID`; ty nejsou heslem.

Certifikát, Object ID Enterprise application, Exchange management scope ani PowerShell nejsou pro tento způsob nutné. Je potřeba běžná uživatelská schránka, do které se příjemce může přihlásit přímo. Sdílená schránka otevíraná z jiného účtu vyžaduje jiný rozsah a není touto variantou pokryta.

## Příprava aplikace a vydání odkazu (provozovatel)

Nejprve aplikovat připravené migrace na schválené oddělené testovací DB v pořadí admin_workspace, admin_mail, mail_oauth. Poslední soubor je `supabase/migrations/20261110000000_mail_oauth.sql`. Produkční migrace a nasazení se nespouštějí tímto návodem automaticky.

Serverové nastavení:

| Proměnná | Hodnota / účel |
|---|---|
| M365_AUTH_MODE | `delegated` |
| M365_CONNECT_ENABLED | `true` až při schváleném zprovoznění propojení; nezapíná import ani AI |
| M365_MAILBOX | `veryvera@nadbytecna.cz` |
| M365_TENANT_ID | `a3e40c5f-05a5-42b5-8a02-4002a1cbafbe` (ověřit shodu v Entra) |
| M365_CLIENT_ID | Application (client) ID |
| M365_CLIENT_SECRET | Hodnota secretu, pouze v serverovém secret store |
| M365_OAUTH_REDIRECT_URI | Přesná registrovaná návratová adresa |
| M365_TOKEN_ENCRYPTION_KEY | Samostatný náhodný klíč 32 bajtů v kanonickém base64, pouze na serveru |
| M365_INGEST_ENABLED | Při prvním připojení a ověřování ponechat `false` |
| AI_TRIAGE_ENABLED / AI_EMAIL_CLASSIFICATION_ENABLED / AI_EMAIL_PROCESSING_APPROVED | Ponechat `false` do samostatného schválení |

`node tools/m365-check.mjs` ověří formát bez sítě. Neprokazuje skutečné oprávnění. `--probe` je skutečné čtení Microsoftu a smí následovat až po schválení; u delegované varianty může obnovit šifrovanou cache, zprávy však neukládá a nevypisuje.

Po nastavení se přihlášený admin přesune do **E-maily → Připojení schránky → Vytvořit připojovací odkaz**. Aplikace vygeneruje pozvánku s expirací; admin ji zkopíruje a soukromě předá určenému příjemci. Žádný e-mail se neposílá automaticky. Samotná adresa `/api/mail-connect/` bez pozvánky neuděluje přístup a není hotovým připojovacím odkazem.

## HTTPS ověření na preview před produkcí

Konkrétní preview callback musí správce rovněž přesně zaregistrovat jako Web redirect URI. Kód dovolí HTTPS adresu pod `.vercel.app` pouze pokud `VERCEL_ENV=preview` a `M365_OAUTH_ALLOW_PREVIEW=true`, cesta je přesně `/api/mail-connect/` a query přesně `?step=callback`. Žádné wildcard callbacky. Odkaz vydaný v preview míří na tentýž nastavený preview origin. Preview nesmí používat známou produkční Supabase DB; to server již odmítá. Použít vlastní testovací DB a samostatné šifrovací klíče.

Ověřit skutečné `__Host-`, Secure, HttpOnly a SameSite=Lax cookies přes HTTPS, návrat od Microsoftu, politiky souhlasu a správný účet. Lokální testy s ručně vloženou Cookie hlavičkou tuto část neprokazují. Teprve potom schválit ostré nasazení, složku/datum a samostatně zapnout import. Případná odvolaná autorizace nebo politika organizace může vyžadovat nové přihlášení; nelze slíbit trvalý přístup bez dalších výzev.

## Bezpečnost a ověřené chování

- Pozvánku vydá pouze současný admin, callback kontroluje i platnost vydávajícího admina. Příjemce se nikdy nezapisuje do admins/admin_emails.
- Token pozvánky je ve fragmentu `#invite=...`, neposílá se v HTTP URL a stránka jej ihned odstraní z historie. V DB je jen SHA-256 hash, nikoli původní pozvánka.
- Zahájení je POST po kliknutí se stejným originem; OAuth používá PKCE S256, jednorázový state a vazbu na HttpOnly cookie prohlížeče. Výměna kódu je serverová přes oficiální MSAL Node.
- Před uložením se ověří tenant, přihlášený účet přes Graph `/me` a přístup k metadatům jeho Inboxu. Delegovaný import pak používá pouze `/me`, žádný libovolný cizí mailbox.
- MSAL cache a PKCE flow jsou AES-256-GCM šifrované, v privátních tabulkách dostupných pouze service_role. Do prohlížeče se nevrací přístupový ani obnovovací token, client secret nebo cache.
- Callback jde spotřebovat pouze jednou; nové vydání/revokace/odpojení zneplatní staré pokusy a souběžnou obnovu cache. Úspěšné nové připojení resetuje pouze synchronizační kurzor a leases, zachovává kopie, retenci i ochranu proti opětovnému importu.
- Odpojení v adminu odstraní zdejší uloženou cache a zastaví další zdejší přístup. Nemaže zprávy ani místní kopie a není totožné s odebráním souhlasu v Microsoftu. Již odeslaný Microsoft požadavek může doběhnout; zneplatněný synchronizační lease zabrání uložení jeho výsledku.
- Potvrzení výsledku je podepsané a nelze si jej vyrobit přidáním `outcome=connected` do URL. Cache/flow/kódy se nevypisují do aplikačních logů; provozovatel musí prověřit také nastavení hostingových přístupových logů callbacku.

Nové lokální ověření: 13 testů MSAL/šifrování, 11 DB testů a 5 API integračních testů s mockovaným Microsoftem, navíc delegovaná Graph cesta. UI má samostatné výsledky v `mail-connect-admin-results.json` a `mail-connect-public-results.json`. Skutečné tenant oprávnění a HTTPS cookie roundtrip dosud nebyly potvrzené.

## Oficiální podklady

- https://learn.microsoft.com/en-us/graph/auth-v2-user
- https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests
- https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
