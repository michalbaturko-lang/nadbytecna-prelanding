# Odesílací doména Resend — čeká na správný účet

Uživatel 8. 11. 2026 výslovně odmítl otevřený účet michal.baturko@unitedvisions.cz / unitedvisions jako nesprávný. Prozatímní DNS záznamy z něj se NESMÍ publikovat.

V tomto účtu existuje jen neověřená příprava auth.nadbytecna.cz se stavem not started, id 9adcdd8d-6eb5-41f6-a28b-279f8594ec1e. Nevznikl nový API klíč, DNS ani SMTP nebyly změněny. Příprava nic neposílá. Její případné odstranění je samostatný úklid po ověření správného cíle.

Další postup: přihlásit a ověřit správný účet Resend; zjistit, zda má cílovou doménu už ověřenou; případné DNS získat znovu z něj. Zachovat všechny příchozí Microsoft MX a stávající SPF/DMARC hlavní domény. Po ověření použít samostatný klíč omezený na odesílání z cílové subdomény pouze v SMTP Supabase (host smtp.resend.com, port 465, uživatel resend). Klíč nepatří do chatu, veřejného webu ani dokumentace.
