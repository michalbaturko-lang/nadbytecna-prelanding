# Admin Nadbytečná.cz — plán a rozhodnutí

Datum: 7. 11. 2026. Výchozí commit: c237d5b. Práce ve větvi, bez mergování a produkčních zápisů.

## Ověřený základ
Repo je statický generátor + Vercel funkce, ne Next.js. Zachováváme jej. Schéma stories/help_offers/admins nebylo založeno původními migracemi; přístup MCP ke skutečnému projektu byl odmítnut. Novou migraci ověřujeme na výslovně označené lokální rekonstrukci základního schématu. To není ověření kompatibility produkce. Před aplikací je nutné porovnat skutečné sloupce, triggery a policies.

## Používání na telefonu
Nejprve přehled nových, akutních a rozpracovaných zpráv. Karta začíná shrnutím a rozlišením návrhu AI a lidského rozhodnutí. Příběh až v detailu, aby nebylo nutné číst několik traumatických výpovědí najednou. Mobil má samostatný detail, velká tlačítka a zavírací panel filtrů; desktop seznam vedle detailu. Žádné údaje ani text vyhledávání do URL; URL ukládá pouze necitlivé filtry. Vyhledávání jménem/e-mailem v URL by odporovalo soukromí (historie a sdílení odkazu).

## Bezpečnost a souhlasy
Jeden serverový vstup pro admin operace, ověření bearer tokenu přes Auth a čerstvý allowlist pro každý požadavek. Samostatný záznam aktivity pro 12 hodin nečinnosti. RLS vyžaduje aktivního admina, allowlist a aktivní session. Mutace s auditním záznamem v jedné DB transakci. Audit má jen kódy, identifikátory a změněná necitlivá pole, nikdy text příběhu/přepisu/poznámky. Audio podepsané na 120 s. Admin bez analytiky, bez cache a noindex.

AI i transkripce musí mít výslovně zapnuté vlastní přepínače; žádné ruční obejití. Výstupy validované proti aktivnímu číselníku. Lidská klasifikace má vždy přednost. Automatická AI po veřejném submitu potřebuje bezpečné serverové doručení, nesmí dovolit anonymní výběr libovolného příběhu. E-maily neodesíláme.

Nové formuláře ověří 18+; DB nastaví časy a uchová přesné znění souhlasů. Historické souhlasy nedatujeme zpětně. Historická hodnota 18+ je neznámá, nikoli splněná. Stav „Zveřejněno“ znamená interní workflow, samotný veřejný web nic nepublikuje.

## Další užitečné funkce
- Výrazné akutní případy a možnost ruční naléhavosti i při vypnuté AI. Žádná automatická diagnóza ani záruka odhalení krize. Postup a krizové kontakty doplnit až po schválení odpovědnou osobou.
- Šablona odpovědi pouze jako upravitelný koncept pro vlastní poštu, žádná automatická rozesílka.
- Duplicitní kontakty podle přesné normalizované e-mailové adresy; nejde o důkaz totožnosti.
- Upozornění na smazání do 14 dnů a možnost zobrazit jen takové záznamy.
- Explicitní potvrzení páru; žádný kontakt se neposílá pomocníkovi automaticky.
- Skrytí citlivého obsahu při odhlášení, deaktivace exportu během zpracování.

## Pořadí
1. Migrace číselníků, metadat, RLS, historie, poznámek, párů a auditu.
2. Serverová autorizace, dotazy, mutace, audit a CSV/GDPR ZIP.
3. Český responzivní seznam, dashboard, filtry a detail.
4. AI validace a pevné vypnutí; časová razítka a 18+.
5. Retenční plán a job, nejprve dry-run; fyzické mazání až po schválení retenčního pravidla.
6. Lokální DB a API testy, prohlížeč, screenshoty, PR s přesnými výsledky a omezeními.

## Rozhodnutí před produkcí
Dvě přesné adresy pro allowlist; schválení AI a přepisu advokátkou; způsob zveřejňování a kontrola autorkou; retence od odeslání vs. kontaktu; schválený krizový postup; nasazení migrace a PR. Staré soubory v produkčním bucketu se nemažou bez výslovného souhlasu. V repu připravujeme retenci od odeslání pro příběhy a od posledního kontaktu (jinak vytvoření) pro nabídky, fyzické mazání výchozí vypnuté.

## Implementovaný stav
Předání a přesné výsledky viz `docs/admin/checklist.md` a `docs/admin/deployment.md`. Doplněno globální GDPR vyhledání podle e-mailu, včetně původních preregistrací. Ověření nikdy nepoužilo produkční data. Automatická AI je nyní oddělená fronta obsluhovaná workerem po pěti minutách, nikoli okamžitý běh ze submitu; toto je výslovná odchylka k revizi. Další externí změna vyžaduje schválení konkrétní migrace a nasazení.
