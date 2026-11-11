# Přehled e-shopu VERY VERA v adminu

Záložka „E-shop“ v `/admin/` (stejné přihlášení jako ostatní části). Data: Shopify `qhq4hi-z0.myshopify.com` → tabulka `shop_orders` (bez osobních údajů zákazníků).

## Toky dat
- **Webhooky** `POST /api/shopify-webhooks` (HMAC `X-Shopify-Hmac-Sha256`, secret `SHOPIFY_WEBHOOK_SECRET`). Témata: `orders/create`, `orders/paid`, `orders/updated`, `orders/cancelled`, `orders/fulfilled`. Zápis je idempotentní (starší stav nepřepíše novější).
- **Dorovnání** `GET /api/shop-reconcile` každou hodinu (:17), objednávky posledních 48 h přes Admin GraphQL, jen čtení. Chrání ho `CRON_SECRET`.
- **Návštěvnost** přes ShopifyQL (`read_reports`); bez oprávnění se zobrazí vysvětlení.

## Proměnné ve Vercelu (hodnoty nikdy do repa ani chatu)
`SHOPIFY_STORE_DOMAIN=qhq4hi-z0.myshopify.com`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`; `CRON_SECRET` už existuje.

## Scopes custom app (jen čtení)
`read_orders`, `read_reports`; `read_all_orders` jen kdyby byla potřeba historie starší 60 dní.

## Nasazení (pořadí)
1. Schválit PR, nasadit.
2. Spustit migraci `20261111210000_shop_orders.sql` v Supabase.
3. Ve Vercelu nastavit proměnné, přenasadit.
4. Ve Shopify zaregistrovat webhooky na `https://nadbytecna.cz/api/shopify-webhooks` (verze API 2025-10).
5. Ověření: testovací webhook ze Shopify → řádek v `shop_orders` → zobrazení v adminu; porovnat počty se Shopify adminem.
