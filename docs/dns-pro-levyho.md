# DNS pro nadbytecna.cz – KONCEPT zprávy pro Vojtěcha Levého (neodesláno)

Stav: 3. 11. 2026. Hodnoty označené [doplnit] se doplní po volbě e-mailového nástroje a po přidání domény ve Vercelu. Odeslání rozhodne Michal.

**Předmět:** nadbytecna.cz – nastavení DNS

Dobrý den,

domény nadbytecna.cz (držitelka Věra Komárová) bude sloužit jako jednostránkový web hostovaný na Vercelu. Prosím o nastavení těchto záznamů v DNS (a ať je zachováno vše, co už na doméně je, pokud něco je):

| Název | Typ | Hodnota | Poznámka |
|---|---|---|---|
| @ (nadbytecna.cz) | A | 76.76.21.21 | hodnotu ověřím ve Vercelu při přidání domény [ověřit] |
| www | CNAME | cname.vercel-dns.com | totéž [ověřit] |
| odesílací subdoména / @ | TXT (SPF) | [doplnit podle e-mailového nástroje] | |
| [selektor]._domainkey | TXT/CNAME (DKIM) | [doplnit] | |
| _dmarc | TXT | v=DMARC1; p=none; rua=mailto:[doplnit] | začneme s p=none, po ověření doručitelnosti zpřísnit |
| @ | MX | [jen pokud bude na doméně i schránka; doplnit] | |

Prosím také o potvrzení, kde je doména aktuálně spravována (Gransy / Flexcloud) a zda existují jiné záznamy (e-mail, ověření), které nemáme rozbít. Pokud bude snazší, Michal může záznamy zadat sám po delegaci přístupu.

Děkuji
[podpis]
