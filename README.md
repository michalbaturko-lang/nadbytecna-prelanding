# Nadbytečná – pre-landing (nadbytecna.cz)

Jednostránkový pre-landing: e-mail + souhlas, double opt-in. Static-first (Vercel CDN), 3 serverové funkce, Supabase jako zdroj pravdy. Bez cookies, bez třetích stran.

## Stav k 3. 11. 2026
Hotovo lokálně a otestováno. Čeká na: účty Vercel/Supabase (pod s.r.o. Věry), správce údajů (název, IČO, sídlo, e-mail), volbu e-mailového nástroje, schválení textů Věrou.
**Sběr je zavřený**, dokud není `COLLECTION_OPEN=true` a vyplněn správce (API vrací 503).

## Struktura
- `build.mjs` – generuje `dist/` (stránky, inline CSS, self-hosted fonty). `node build.mjs --all` vytvoří i náhledy `preview/v1..v3` (3 varianty claimu). Varianta pro ostrý web: `CLAIM=1|2|3`.
- `src/` – `site.css`, `app.js`. `public/` – loga, favicony, OG obrázek, `llms.txt`.
- `lib/consent.js` – text souhlasu a správce (jeden zdroj pro stránku i API; mění se `CONSENT_VERSION` při jakékoli změně znění).
- `api/subscribe.js`, `api/confirm.js`, `api/unsubscribe.js` – serverové funkce.
- `lib/mailer.js` – provider e-mailů (`console`, `resend`; `ecomail` zatím není implementován).
- `supabase/migrations/` – tabulka `preregistrations` (RLS zapnuté, bez politik), retenční funkce, výmaz.
- `tests/flow.test.mjs` – průchod celým flow proti paměťové maketě (`node --test tests/flow.test.mjs`).
- `tools/og.html` – zdroj OG obrázku (render headless Chrome, 1200×630).

## Nasazení (až budou účty)
1. Supabase (EU region): spustit migraci, pak `get_advisors` (security + performance). Naplánovat `purge_preregistrations()` (pg_cron).
2. Vercel: nový projekt z tohoto adresáře; env podle `.env.example`; zapnout Web Analytics; deployment protection nechat zapnutou, dokud není sběr otevřený.
3. Doména: záznamy dle `docs/dns-pro-levyho.md` (zpráva je jen koncept).
4. Test celého průchodu na reálné adrese (odeslání → e-mail → potvrzení → odhlášení), OG náhled ve sdílecím nástroji, Lighthouse na produkci.
5. Až poté `COLLECTION_OPEN=true`.

## Rozhodnutí v návrhu
- Potvrzení e-mailu je **POST po kliknutí na tlačítko** (stránka `/potvrzeni/`), ne GET z odkazu: skenery e-mailů by jinak potvrzovaly adresy samy.
- Tokeny: potvrzovací se ukládá jen jako SHA-256; odhlašovací je bezstavový HMAC. IP se ukládá jen jako hash se solí, nejdéle 30 dní.
- Odpověď API je stejná, ať adresa v seznamu už je, nebo ne (žádné vyzrazení členství).
- Ochrana proti botům: honeypot, časová pastička (≥ 2,5 s), limit 5 přihlášek/h na IP hash. Turnstile se nepoužívá (GDPR posouzení chybí).
- Stránka vyžaduje JavaScript (časová pastička); bez něj se zobrazí upozornění.

## Co ověřeno a co ne
Ověřeno: migrace na skutečném Postgresu (PGlite), flow testy proti maketě, Lighthouse mobil (výkon 99, přístupnost 100, best practices 96, SEO 100). Neověřeno: reálný Supabase, reálné odeslání e-mailu, Vercel Analytics jako cookieless, OG náhled ve sdílecích nástrojích, iPhone Safari / Android Chrome na skutečných zařízeních.
