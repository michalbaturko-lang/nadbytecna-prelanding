# Microsoft 365 — integrace e-mailového zdroje

**Aktualizace 10. 11. 2026:** zvolená cesta je delegované připojení jednorázovým odkazem bez přístupu příjemce do adminu. [Nastavení registrace a příjemce odkazu](microsoft365-odkaz.md) doplňuje nový [provozní postup připojení, importu a automatické AI](mail-ai-activation.md). Níže je popis společné implementace a alternativního certifikátového přístupu; certifikát ani PowerShell nejsou pro zvolenou delegovanou cestu potřeba.

Uživatel potvrdil, že veryvera@nadbytecna.cz je vyhrazená schránka projektu, a schválil celou historii Inboxu. Správce dodal Client ID a Tenant ID; vlastní přihlášení a udělení práv se dokončují přímo u Microsoftu. Konfigurace připojení, import a AI jsou samostatné kroky. Připravená implementace a lokální testy samy neprokazují skutečné připojení, pokrytí historie ani modelové zpracování. Rozhodující ověření se zapisuje podle [aktuálního runbooku](mail-ai-activation.md).

## Alternativní certifikátový servisní přístup — zadání pro správce

V tenantovi organizace zaregistrovat single-tenant aplikaci Nadbytečná admin. Pro automatický provoz připravit aplikační přístup přes Microsoft Graph pouze ke čtení těla zpráv. Preferované oprávnění je Exchange Online Application RBAC role Application Mail.Read omezená výhradně na veryvera@nadbytecna.cz. Nepřidělovat Mail.Send ani Mail.ReadWrite. Zkontrolovat, že souběžná neomezená oprávnění v Entra omezení neobejdou; oprávnění se sčítají. Ověřit povolení cílové schránky a odmítnutí jiné schránky. Autentizaci aplikace dohodnout certifikátem; žádné heslo schránky ani secret neposílat do chatu či repozitáře.

K předání stačí Tenant ID, Application (client) ID a Object ID příslušného service principalu (Enterprise application, nikoli Object ID registrace aplikace) a výsledek testu rozsahu. Tyto identifikátory samy nejsou přístupové klíče.

## Omezení odkazu u alternativního Application RBAC

Skutečný admin-consent odkaz vyžaduje existující client_id a registrované redirect_uri. Z adresy schránky jej nelze sestavit. U doporučeného Application RBAC samotné kliknutí na běžný consent odkaz nenastaví omezení jediné schránky; potřebný je zásah správce Exchange. Obecný portál https://entra.microsoft.com/ není hotový schvalovací odkaz.

## Implementace místních kopií a AI

Samostatné email_threads a email_messages, žádný automatický převod na stories/help_offers. Karta vlákna obsahuje originální text a oddělené opravitelné návrhy AI. Požadovat Graph ImmutableId, deduplikovat podle schránky a case-sensitive ID zprávy; conversationId pouze pro seskupení. Delta synchronizace používá výslovně zvolenou složku a rozsah. Aktuálně je schválená složka Inbox s celou dosavadní historií; jiné složky se samy nepřidávají. Přílohy se nekopírují ani neanalyzují. Úplnost historie se musí ověřit vůči skutečnému Microsoftu.

Pouze Graph GET s textovým tělem, žádné HTML renderování či vzdálené obrázky. Pokračovací URL ověřovat před připojením bearer tokenu. Kurzor a tokeny serverově, ne v klientovi nebo logu. Importní zámek a transakční kurzor jsou nezbytné před zapojením adaptéru.

Souhlas AI, zveřejnění a 18+ jsou neznámé; z přijetí zprávy se neodvozují. E-mailová AI vyžaduje globální a zdrojový přepínač i doložené schválení; automatika má navíc vlastní přepínač. Do příslušného schválení zůstávají vypnuté. Přesné čtyři brány jsou v [runbooku](mail-ai-activation.md). Obsah e-mailů je nedůvěryhodný vstup modelu bez možnosti ovládat nástroje. Publikování e-mailového zdroje zakázat.

GDPR export a výmaz pokryjí místní kopie, poznámky a AI výstupy, nikoli originál v Microsoft 365. Retence od původního přijetí, lhůta k rozhodnutí. Potlačení opětovného importu s HMAC identitami zpráv musí přežít reset kurzoru a souběh importu/výmazu. Graph @removed nemusí znamenat odstranění ze schránky; může jít o přesun. Audit bez těl, předmětů, odesílatelů a tokenů.

## Oficiální podklady

- https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent
- https://learn.microsoft.com/en-us/graph/delta-query-messages
- https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0


## Konfigurace po schválení

Serverové proměnné (žádná nesmí mít prefix NEXT_PUBLIC):

| Proměnná | Význam / výchozí stav |
|---|---|
| M365_INGEST_ENABLED | false; teprve po schválení a staging zkoušce true |
| M365_MAILBOX | veryvera@nadbytecna.cz; jiná schránka je odmítnuta i v kódu |
| M365_FOLDER_ID | aktuálně schválený `Inbox`; jedna složka na tuto konfiguraci |
| M365_SINCE | `1970-01-01T00:00:00.000Z` vyjadřuje schválený rozsah bez historické časové hranice; ověřit skutečné pokrytí |
| M365_TENANT_ID / M365_CLIENT_ID | GUID organizace / registrované aplikace |
| M365_CERT_SHA256_THUMBPRINT | 64 hex znaků, SHA-256 veřejného X.509 certifikátu |
| M365_CERT_PRIVATE_KEY | PEM privátní RSA klíč min. 2048 bitů pouze v důvěryhodném serverovém secret store |
| M365_SUPPRESSION_SECRET | stabilní náhodný klíč min. 32 znaků; alternativně GDPR_HASH_SECRET; neměnit bez migračního plánu potlačení importu |
| AI_EMAIL_CLASSIFICATION_ENABLED | false |
| AI_EMAIL_PROCESSING_APPROVED | false; doložené schválení zdroje pro AI, nenahrazuje souhlas se zveřejněním |
| AI_TRIAGE_ENABLED | globální brána; zapíná také worker webových příběhů a nabídek, ověřit rozsah schválení |
| AI_EMAIL_AUTOMATION_ENABLED | false; automatický e-mailový worker navíc vyžaduje všechny tři předchozí AI brány |
| M365_RETENTION_DAYS | bez výchozí lhůty; celé číslo 1–3650 až po rozhodnutí |
| M365_RETENTION_ENABLED | false; nezávislé povolení fyzického výmazu pouze místních kopií |

Autentizace certifikátu: PS256, x5t#S256, krátká pětiminutová assertion, pevný token endpoint a scope Graph .default. Klíč, token ani assertion se neukládají do DB, repozitáře, klientského JS či logů. Certifikát je nutné v Entra nahrát a hlídat jeho platnost; samotný PEM bez odpovídajícího veřejného certifikátu nestačí.

## Alternativní servisní cesta a společné ověření

Pro aktuálně zvolené delegované připojení postupovat podle [mail-ai-activation.md](mail-ai-activation.md), nikoli podle certifikátového kroku 1 níže.

1. Správce založí aplikaci, nahraje veřejný certifikát a ověří RBAC rozsah jen na cílovou schránku. Zaznamenat konkrétní Client ID, Tenant ID a výsledek scope testu. Nepoužívat plošné Entra Mail.Read vedle omezeného RBAC.
2. Ověřit potřebné migrace a jejich evidenci. Po admin_workspace následují admin_mail a mail_oauth; automatika a nové řazení navíc potřebují mail_ai_queue a mail_priority_sort. Pro preview zachovat oddělení od produkční Supabase DB. Již aplikované migrace nepouštět znovu mimo evidovanou historii.
3. Doplnit serverové proměnné, dohodnout počáteční datum a složku. `node tools/m365-check.mjs` ověří formát bez sítě; neprokazuje udělení oprávnění.
4. Po schválení čtení nastavit ingest flag a spustit `node tools/m365-check.mjs --probe`. Ověří jednu stránku, vypíše jen počty, nic neuloží a nevolá AI. Je to skutečné čtení schránky, nikoli mock test.
5. Na staging spustit chráněný `/api/mail-sync/` s CRON_SECRET (nepřenášet jej v URL). Jedna stránka na běh, transakční uložení kurzoru. Zopakovat a ověřit deduplikaci, poznámku, ruční změnu, export, výmaz místní kopie a nemožnost opětovného importu odstraněných kopií. Originál v M365 musí zůstat beze změny.
6. Importní cron běží po pěti minutách a při velkém prvotním importu pokračuje po stránkách. Aktuálně schválená historie se týká pouze Inboxu. Graph dotaz s časovým filtrem může mít limit 5000 zpráv; takto omezený výsledek nesmí být označen za důkaz úplnosti větší historie. Ověřit skutečné pokrytí a pokračování kurzoru podle [runbooku](mail-ai-activation.md); nepřidávat jiné složky bez rozhodnutí.
7. Ruční AI z detailu vyžaduje tři AI brány; automatický worker navíc `AI_EMAIL_AUTOMATION_ENABLED=true`. Minutový worker zpracuje nejvýše tři vlákna za běh, s časovým rozpočtem a omezením opakování. Ruční i automatická AI nyní používají společný kontext nejvýše 30 nejnovějších dostupných zpráv a celkem 20 000 znaků Unicode; přílohy se neanalyzují. Detail se nadále zobrazuje po stránkách 20 zpráv, což je samostatné omezení zobrazení, nikoli AI kontextu. Výsledek není úplnou analýzou dlouhé korespondence. AI nemá nástroje, nikomu neodpovídá, nic nepublikuje a nepřepisuje lidskou klasifikaci ani stav. Nová revize, zdrojová změna, místní výmaz a novější ruční AI výsledek zneplatní starý rozpracovaný automatický výsledek. Postup aktivace, backlog, archivace a chyby jsou v [runbooku](mail-ai-activation.md). Export má samostatnou ochranu limitu odpovědi 3 MiB; větší výsledek se odmítne výslovnou chybou, nikdy se nevydává zkrácený export za kompletní.
8. Retence je bez schválené lhůty přeskočena; po nastavení lhůty nejprve náhled v denním jobu, fyzické odstranění až samostatným flagem. Mazání je vždy jen v místní DB. Při výmazu kontaktu mohou být citlivé údaje třetí osoby i v citacích cizího odesílatele; automatická shoda odesílatele není úplný právní DSAR audit a vyžaduje lidskou kontrolu.

Při 429 import respektuje Retry-After v DB, bez blokujícího čekání v procesu. Při 410 cursor_expired import neobnovuje historii sám; správce musí rozhodnout o novém běhu a zachovat suppression záznamy. Při chybné či příliš velké zprávě se stránka necommitne a kurzor neposune; operátor řeší konkrétní případ bez publikování obsahu v logu. Výmaz originálu/přesun v Outlooku není příkaz k právnímu výmazu místní kopie; změna dostupnosti je vedena samostatně.

Aktuální souhrn lokálních kontrol a jejich omezení je v [runbooku aktivace](mail-ai-activation.md#rozsah-dosavadního-ověření). Skutečný Microsoft OAuth průchod, pokrytí historie a kvalita modelového výsledku vyžadují samostatný provozní test; nelze je odvodit z lokálních mocků.
