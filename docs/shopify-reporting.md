# Přehled e-shopu VERY VERA v adminu

Záložka „E-shop“ v `/admin/` (stejné přihlášení jako ostatní části). Data: Shopify `qhq4hi-z0.myshopify.com` → tabulka `shop_orders` (bez osobních údajů zákazníků).

## Toky dat
- **Webhooky** `POST /api/shopify-webhooks` (HMAC `X-Shopify-Hmac-Sha256`, secret `SHOPIFY_WEBHOOK_SECRET`). Témata: `orders/create`, `orders/paid`, `orders/updated`, `orders/cancelled`, `orders/fulfilled`. Zápis je idempotentní (starší stav nepřepíše novější).
- **Dorovnání** `GET /api/shop-reconcile` každou hodinu (:17), objednávky posledních 48 h přes Admin GraphQL, jen čtení. Chrání ho `CRON_SECRET`.
- **Návštěvnost** přes ShopifyQL (`read_reports`); bez oprávnění se zobrazí vysvětlení.

## Proměnné ve Vercelu (hodnoty nikdy do repa ani chatu)
`SHOPIFY_STORE_DOMAIN=qhq4hi-z0.myshopify.com`. Doména musí být ve tvaru `obchod.myshopify.com` (stejná kontrola jako dřív).

Aplikace VERY VERA je v Shopify Dev Dashboard, takže Admin API token platí jen asi 24 hodin. Když jsou nastavené `SHOPIFY_CLIENT_ID` a `SHOPIFY_CLIENT_SECRET`, server si token vyžádá sám:

`POST https://{SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token` s tělem `application/x-www-form-urlencoded` (`grant_type=client_credentials`, `client_id`, `client_secret`). Odpověď je `{access_token, scope, expires_in}`.

Token se drží jen v paměti procesu, a to do 5 minut před `expires_in`. Když Admin GraphQL vrátí 401, cache se zahodí a ten samý požadavek se jednou zopakuje s novým tokenem. Token ani client secret se nelogují.

`SHOPIFY_ADMIN_TOKEN` je záloha pro případ, že client id a secret nastavené nejsou (dočasný statický token).

`SHOPIFY_WEBHOOK_SECRET` ověřuje HMAC webhooků (`X-Shopify-Hmac-Sha256`). U aplikace z Dev Dashboard je to stejná hodnota jako client secret. `CRON_SECRET` už existuje.

Verze Admin API zůstává `2025-10`. Přepsat ji může `SHOPIFY_API_VERSION`.

## Scopes aplikace (jen čtení)
`read_orders`, `read_reports`; `read_all_orders` jen kdyby byla potřeba historie starší 60 dní.

## Nasazení (pořadí)
1. Schválit PR, nasadit.
2. Spustit migraci `20261111210000_shop_orders.sql` v Supabase.
3. Ve Vercelu nastavit `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` a `SHOPIFY_WEBHOOK_SECRET`, přenasadit. `SHOPIFY_ADMIN_TOKEN` jen jako dočasná záloha.
4. Ve Shopify zaregistrovat webhooky na `https://nadbytecna.cz/api/shopify-webhooks` (verze API 2025-10).
5. Ověření: testovací webhook ze Shopify → řádek v `shop_orders` → zobrazení v adminu; porovnat počty se Shopify adminem.
