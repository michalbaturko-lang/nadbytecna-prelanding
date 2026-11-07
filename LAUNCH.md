# Spuštění 11. 11. 2026

Kód z tohoto PR je určený na `main`. 11. 11. se nespouští novou funkcí, ale těmito kroky. Do té doby zůstává `noindex` a `robots.txt` má `Disallow: /`. Nic z tohoto souboru samo o sobě indexaci nezapne.

## 1. Produkční proměnné ve Vercelu

Projekt `nadbytecna-prelanding`, cíl **Production**.

Už mají být nastavené (preview i production):

- `NEXT_PUBLIC_SUPABASE_URL` = `https://gjzsifxldxaogcuqzivb.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable key (veřejný, ne service role)
- `OPENAI_API_KEY` = klíč k přepisu (sensitive). Bez něj funkce `/api/transcribe` nic nevolá.

Doplnit, až budou:

- `SUPABASE_URL` = stejná URL (server)
- `SUPABASE_SERVICE_ROLE_KEY` = service role. Bez něj se neodešle potvrzovací e-mail a přepis se ukládá jen úzkou funkcí `save_transcript`.
- `RESEND_API_KEY` = až má doména DNS u Resendu. Bez něj `/api/notify` nic neposílá. Odesílatel je `Nadbytečná <veryvera@nadbytecna.cz>`.
- `SITE_URL` = `https://nadbytecna.cz`
- `NEXT_PUBLIC_META_PIXEL_ID` = číselné ID Meta Pixelu
- `NEXT_PUBLIC_GA4_ID` = `G-…`
- `NEXT_PUBLIC_GOOGLE_ADS_ID` = `AW-…`
- `NEXT_PUBLIC_GOOGLE_ADS_STORY_LABEL`, `NEXT_PUBLIC_GOOGLE_ADS_HELP_LABEL`, `NEXT_PUBLIC_GOOGLE_ADS_SHOP_LABEL` = popisky konverzí, volitelné
- `NEXT_PUBLIC_TIKTOK_PIXEL_ID`

Značky se nenačtou, dokud chybí ID a dokud člověk v liště nezvolí „Souhlasím“. Události: `story_submit`, `help_submit`, `shop_click`.

Po změně proměnných, které vstupují do buildu (`NEXT_PUBLIC_*`), je potřeba nové nasazení.

## 2. Přepis

`/api/transcribe` po nahrání audia pošle soubor do OpenAI. Model `gpt-4o-transcribe`, jazyk `cs`. Když ten model vrátí jinou chybu než 401/403, zkusí se `whisper-1`. Text se uloží do `stories.transcript`.

Odhad z ceníku OpenAI (stránka Pricing, stav k říjnu 2026): `gpt-4o-transcribe` účtuje tokeny, odhad je 0,006 USD za minutu. `whisper-1` je 0,006 USD za minutu. Minuta záznamu tedy stojí zhruba 0,006 USD, ať doběhne první, nebo záložní model. Když první model selže a doběhne až záloha, může se minuta započítat dvakrát.

## 3. Administrátor

Na `/admin` přijde magic link ze Supabase Auth. Účet se do přehledu dostane až po SQL v `docs/pridat-admina.sql`. Nikoho nepřidáváme dopředu.

V Supabase Auth nastav Site URL na `https://nadbytecna.cz` a mezi Redirect URLs dej:

- `https://nadbytecna.cz/admin/`
- `https://www.nadbytecna.cz/admin/`
- `https://nadbytecna-prelanding.vercel.app/admin/`

## 4. Zrušení noindex

Až má být web vidět ve vyhledávání:

1. V `vercel.json` u hlavičky pro `/(.*)` smaž `X-Robots-Tag: noindex, nofollow, noarchive`. Nech ji na `/api/:path*`.
2. V `lib/phase1-html.js` v `head()` změň robots meta na `index, follow` (googlebot stejně).
3. V `lib/phase1-html.js` nahraď obsah `robots` za soubor `launch/robots.txt` a při buildu zapiš `launch/sitemap.xml` jako `sitemap.xml`.
4. Nové nasazení produkce. Ověř, že `https://nadbytecna.cz/robots.txt` obsahuje `Allow: /` a `Disallow: /admin/`, a že úvod nemá `noindex`.

## 5. Doména, coming soon a DNS

Domény `nadbytecna.cz` a `www.nadbytecna.cz` jsou v projektu Vercel připojené. DNS zatím není. Až se má jít na veřejnou adresu, záznamy ber z obrazovky domény. Obvykle:

- apex `A` → `76.76.21.21`
- `www` `CNAME` → `cname.vercel-dns.com`

Do spuštění middleware (`middleware.js`) rozhoduje podle hostitele:

- `www.nadbytecna.cz` trvale přesměruje na `https://nadbytecna.cz` se stejnou cestou.
- `nadbytecna.cz` ukazuje jen coming soon (padající nápis, věta, datum 11. 11. 2026, e-mail k upozornění). Formuláře příběhu a pomoci tam nejsou. `noindex` zůstává.
- Adresa `*.vercel.app` ukazuje plný web jako dosud.

Přepínač je proměnná `SITE_LIVE`. Když chybí, nebo není přesně `true` či `1`, platí coming soon. Ve výchozím stavu ji nenastavuj.

V den spuštění, až má apex ukázat plný web:

1. Ve Vercelu pro **Production** nastav `SITE_LIVE` = `true`.
2. Nasaď znovu. Middleware čte proměnnou při běhu, nové nasazení ji vezme jistě.
3. Ověř, že `https://nadbytecna.cz/` je úvod fáze 1 a `https://www.nadbytecna.cz/` přesměruje na apex.

Přihlášky k upozornění jsou v `public.launch_signups` (`email`, `created_at`, `consent`). Anon smí jen vložit řádek s `consent = true`. Číst je smí jen administrátor. Potvrzovací e-mail se neposílá.

Resend, pro odesílání z `veryvera@nadbytecna.cz`: v Resendu přidej doménu a do DNS opiš přesně ty TXT a CNAME, které Resend ukáže (SPF, DKIM, return-path). Vlastní hodnoty sem nepatří, Resend je ukáže až pro tuto doménu.

## 6. Test v den spuštění

1. Otevři produkci, lišta cookies je dole, značky v síti nejsou, dokud není souhlas a dokud nejsou ID.
2. Pošli krátký textový příběh a nabídku pomoci. V tabulce je řádek s `consent = true`. Testovací řádky smaž.
3. Nahraj krátké české audio. V `stories.transcript` je text. Když OpenAI vrátí 401, funkce odpoví `openai-auth` a klíč v odpovědi není.
4. Magic link na `/admin` otevře přehled jen účtu z `public.admins`.
5. E-shopový odkaz po souhlasu pošle `shop_click`. Bez souhlasu značku nespouští.
6. Potvrzovací e-mail odejde až ve chvíli, kdy jsou `RESEND_API_KEY` i `SUPABASE_SERVICE_ROLE_KEY` a DNS u Resendu sedí.

## Souhlasy ve formulářích

Ve formuláři příběhu jsou tři nepředzaškrtnuté souhlasy: zpracování včetně citlivých údajů (povinné), přepis hlasu (jen u audia, tam povinné) a zveřejnění příběhu (nepovinné). U pomoci je povinné zpracování nabídky. Zveřejnění nabídky je ve stránce skryté, `[ROZHODNOUT]`.

Sloupce do databáze doplň ručně ze `docs/consent-columns.sql`. Dokud neběží, odeslání formuláře spadne, protože klient ty sloupce posílá.

Zásady a pravidla zveřejňování mají značky `[DOPLNIT]`, `[ROZHODNOUT]` a `[OVĚŘIT]`. Na preview je nahoře označení „Návrh“. V produkčním buildu (`VERCEL_ENV=production`) to označení není a odkazy na ty dvě stránky zmizí z patičky, dokud značky v textu jsou.

## Zástupné, co 11. 11. pořád může chybět

- Text Věry na úvodu.
- Adresa a IČ správkyně.
- Konečné znění souhlasu a zásad po advokátce. Dnešní text je návrh.
- Pixel ID, Resend a service role, pokud je do té doby nikdo nedoplní.
