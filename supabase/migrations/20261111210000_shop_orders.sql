-- Přehled objednávek e-shopu VERY VERA (Shopify). Jen technické údaje a agregovatelná data:
-- žádné jméno, e-mail, telefon ani adresa zákazníka. Čte a zapisuje výhradně server (service_role).
BEGIN;
CREATE TABLE IF NOT EXISTS public.shop_orders (
 shopify_id bigint PRIMARY KEY,
 name text NOT NULL CHECK (length(name) <= 40),
 created_at timestamptz NOT NULL,
 shopify_updated_at timestamptz NOT NULL,
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 total numeric(12,2) NOT NULL,
 total_czk numeric(12,2) NOT NULL,
 refunded_amount numeric(12,2) NOT NULL DEFAULT 0,
 items_qty integer NOT NULL DEFAULT 0 CHECK (items_qty >= 0),
 shipping_method text CHECK (shipping_method IS NULL OR length(shipping_method) <= 120),
 country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
 financial_status text CHECK (financial_status IS NULL OR length(financial_status) <= 40),
 fulfillment_status text CHECK (fulfillment_status IS NULL OR length(fulfillment_status) <= 40),
 referrer text CHECK (referrer IS NULL OR length(referrer) <= 120),
 utm_source text CHECK (utm_source IS NULL OR length(utm_source) <= 80),
 cancelled_at timestamptz,
 is_test boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_orders_created_idx ON public.shop_orders (created_at DESC);
CREATE TABLE IF NOT EXISTS public.shop_sync (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 last_webhook_at timestamptz,
 last_reconcile_at timestamptz
);
INSERT INTO public.shop_sync (singleton) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_orders, public.shop_sync FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shop_orders, public.shop_sync TO service_role;
-- Idempotentní zápis: starší nebo opožděný webhook nikdy nepřepíše novější stav.
CREATE OR REPLACE FUNCTION public.shop_upsert_order(p jsonb) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $f$
 INSERT INTO public.shop_orders AS o (shopify_id,name,created_at,shopify_updated_at,currency,total,total_czk,refunded_amount,items_qty,shipping_method,country,financial_status,fulfillment_status,referrer,utm_source,cancelled_at,is_test,updated_at)
 SELECT (p->>'shopify_id')::bigint, p->>'name', (p->>'created_at')::timestamptz, (p->>'shopify_updated_at')::timestamptz, p->>'currency',
  (p->>'total')::numeric, (p->>'total_czk')::numeric, coalesce((p->>'refunded_amount')::numeric,0), coalesce((p->>'items_qty')::int,0),
  p->>'shipping_method', p->>'country', p->>'financial_status', p->>'fulfillment_status', p->>'referrer', p->>'utm_source',
  (p->>'cancelled_at')::timestamptz, coalesce((p->>'is_test')::boolean,false), now()
 ON CONFLICT (shopify_id) DO UPDATE SET
  name=EXCLUDED.name, shopify_updated_at=EXCLUDED.shopify_updated_at, currency=EXCLUDED.currency, total=EXCLUDED.total, total_czk=EXCLUDED.total_czk,
  refunded_amount=EXCLUDED.refunded_amount, items_qty=EXCLUDED.items_qty, shipping_method=EXCLUDED.shipping_method, country=EXCLUDED.country,
  financial_status=EXCLUDED.financial_status, fulfillment_status=EXCLUDED.fulfillment_status,
  referrer=coalesce(EXCLUDED.referrer,o.referrer), utm_source=coalesce(EXCLUDED.utm_source,o.utm_source),
  cancelled_at=EXCLUDED.cancelled_at, is_test=EXCLUDED.is_test, updated_at=now()
 WHERE o.shopify_updated_at <= EXCLUDED.shopify_updated_at;
$f$;
REVOKE ALL ON FUNCTION public.shop_upsert_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_upsert_order(jsonb) TO service_role;
COMMIT;
