# Microsoft 365 — příprava integrace, 7. 11. 2026

Stav: návrh a lokální příprava, nikoli připojená schránka. Uživatel potvrdil, že veryvera@nadbytecna.cz je vyhrazená schránka projektu. V Microsoft Entra není dostupné přihlášení správce. Nebyla registrována aplikace, udělena oprávnění ani čtena pošta.

## Zadání pro správce

V tenantovi organizace zaregistrovat single-tenant aplikaci Nadbytečná admin. Pro automatický provoz připravit aplikační přístup přes Microsoft Graph pouze ke čtení těla zpráv. Preferované oprávnění je Exchange Online Application RBAC role Application Mail.Read omezená výhradně na veryvera@nadbytecna.cz. Nepřidělovat Mail.Send ani Mail.ReadWrite. Zkontrolovat, že souběžná neomezená oprávnění v Entra omezení neobejdou; oprávnění se sčítají. Ověřit povolení cílové schránky a odmítnutí jiné schránky. Autentizaci aplikace dohodnout certifikátem; žádné heslo schránky ani secret neposílat do chatu či repozitáře.

K předání stačí Tenant ID, Application (client) ID a Object ID příslušného service principalu (Enterprise application, nikoli Object ID registrace aplikace) a výsledek testu rozsahu. Tyto identifikátory samy nejsou přístupové klíče.

## Schvalovací odkaz

Skutečný admin-consent odkaz vyžaduje existující client_id a registrované redirect_uri. Z adresy schránky jej nelze sestavit. U doporučeného Application RBAC samotné kliknutí na běžný consent odkaz nenastaví omezení jediné schránky; potřebný je zásah správce Exchange. Obecný portál https://entra.microsoft.com/ není hotový schvalovací odkaz.

## Připravená implementace (lokálně, bez produkční migrace)

Samostatné email_threads a email_messages, žádný automatický převod na stories/help_offers. Karta vlákna obsahuje originální text a oddělené opravitelné návrhy AI. Požadovat Graph ImmutableId, deduplikovat podle schránky a case-sensitive ID zprávy; conversationId pouze pro seskupení. Delta synchronizace po výslovně zvolených složkách a počátečním datu, bez automatického importu celé historie. Zpočátku bez kopírování příloh.

Pouze Graph GET s textovým tělem, žádné HTML renderování či vzdálené obrázky. Pokračovací URL ověřovat před připojením bearer tokenu. Kurzor a tokeny serverově, ne v klientovi nebo logu. Importní zámek a transakční kurzor jsou nezbytné před zapojením adaptéru.

Souhlas AI, zveřejnění a 18+ jsou neznámé; z přijetí zprávy se neodvozují. Samostatný email AI přepínač navíc ke globálnímu flagu, do schválení vypnuto. Obsah e-mailů je nedůvěryhodný vstup modelu bez možnosti ovládat nástroje. Publikování e-mailového zdroje zakázat.

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
| M365_FOLDER_ID | explicitní složka (např. inbox); jedna složka na tuto konfiguraci |
| M365_SINCE | explicitní počáteční datum UTC ISO, např. 2026-11-07T00:00:00Z; příklad není schválená hranice importu |
| M365_TENANT_ID / M365_CLIENT_ID | GUID organizace / registrované aplikace |
| M365_CERT_SHA256_THUMBPRINT | 64 hex znaků, SHA-256 veřejného X.509 certifikátu |
| M365_CERT_PRIVATE_KEY | PEM privátní RSA klíč min. 2048 bitů pouze v důvěryhodném serverovém secret store |
| M365_SUPPRESSION_SECRET | stabilní náhodný klíč min. 32 znaků; alternativně GDPR_HASH_SECRET; neměnit bez migračního plánu potlačení importu |
| AI_EMAIL_CLASSIFICATION_ENABLED | false |
| AI_EMAIL_PROCESSING_APPROVED | false; doložené schválení zdroje pro AI, nenahrazuje souhlas se zveřejněním |
| AI_TRIAGE_ENABLED | globální vypínač musí být navíc true, jinak e-mailová AI neběží |
| M365_RETENTION_DAYS | bez výchozí lhůty; celé číslo 1–3650 až po rozhodnutí |
| M365_RETENTION_ENABLED | false; nezávislé povolení fyzického výmazu pouze místních kopií |

Autentizace certifikátu: PS256, x5t#S256, krátká pětiminutová assertion, pevný token endpoint a scope Graph .default. Klíč, token ani assertion se neukládají do DB, repozitáře, klientského JS či logů. Certifikát je nutné v Entra nahrát a hlídat jeho platnost; samotný PEM bez odpovídajícího veřejného certifikátu nestačí.

## Postup připojení a ověření

1. Správce založí aplikaci, nahraje veřejný certifikát a ověří RBAC rozsah jen na cílovou schránku. Zaznamenat konkrétní Client ID, Tenant ID a výsledek scope testu. Nepoužívat plošné Entra Mail.Read vedle omezeného RBAC.
2. Schválit a aplikovat obě připravené migrace nejdřív na oddělené testovací DB; tato práce je neaplikuje. Pro preview zachovat oddělení od produkční Supabase DB.
3. Doplnit serverové proměnné, dohodnout počáteční datum a složku. `node tools/m365-check.mjs` ověří formát bez sítě; neprokazuje udělení oprávnění.
4. Po schválení čtení nastavit ingest flag a spustit `node tools/m365-check.mjs --probe`. Ověří jednu stránku, vypíše jen počty, nic neuloží a nevolá AI. Je to skutečné čtení schránky, nikoli mock test.
5. Na staging spustit chráněný `/api/mail-sync/` s CRON_SECRET (nepřenášet jej v URL). Jedna stránka na běh, transakční uložení kurzoru. Zopakovat a ověřit deduplikaci, poznámku, ruční změnu, export, výmaz místní kopie a nemožnost opětovného importu odstraněných kopií. Originál v M365 musí zůstat beze změny.
6. Cron je připraven po pěti minutách, podle plánu hostingu. Při velkém prvotním importu pokračuje po stránkách. Graph s časovým filtrem omezuje výsledek až na 5000 zpráv; před větší historií je nutný samostatný plán dávkování a ověření pokrytí. V1 neimportuje automaticky všechny složky a historii.
7. AI v1 se spouští ručně z detailu až po schválení zdroje a zapnutí všech tří flagů. Nic neposílá e-mailem, nepřevádí e-mail na zveřejněný příběh a nemá nástroje. Souběžná nová zpráva zneplatní starý výsledek AI (revision). Do té doby ruční klasifikace funguje bez AI. Detail stránkuje po 20 zprávách tlačítky Starší/Novější a uvádí počet celého vlákna; AI dále používá nejvýše posledních 20 000 znaků tohoto výřezu. Výsledek proto není úplnou analýzou dlouhé korespondence. Export má samostatnou ochranu limitu odpovědi 3 MiB; větší výsledek se odmítne výslovnou chybou, nikdy se nevydává zkrácený export za kompletní.
8. Retence je bez schválené lhůty přeskočena; po nastavení lhůty nejprve náhled v denním jobu, fyzické odstranění až samostatným flagem. Mazání je vždy jen v místní DB. Při výmazu kontaktu mohou být citlivé údaje třetí osoby i v citacích cizího odesílatele; automatická shoda odesílatele není úplný právní DSAR audit a vyžaduje lidskou kontrolu.

Při 429 import respektuje Retry-After v DB, bez blokujícího čekání v procesu. Při 410 cursor_expired import neobnovuje historii sám; správce musí rozhodnout o novém běhu a zachovat suppression záznamy. Při chybné či příliš velké zprávě se stránka necommitne a kurzor neposune; operátor řeší konkrétní případ bez publikování obsahu v logu. Výmaz originálu/přesun v Outlooku není příkaz k právnímu výmazu místní kopie; změna dostupnosti je vedena samostatně.

Lokální ověření rozšíření: 129 testů celého projektu a 51 prohlížečových kontrol (včetně 22 e-mailových). Čtení skutečné pošty, ověření tokenu Microsoftu ani skutečné AI volání neproběhlo.
