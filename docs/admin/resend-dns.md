# DNS pro přihlašovací e-maily Nadbytečná

Získáno přímo z účtu Resend unitedvisions 8. 11. 2026. Odesílací subdoména auth.nadbytecna.cz, region Ireland, přijímání pošty vypnuté. DNS ještě nebylo změněno.

| Typ | Úplný název | Hodnota | TTL |
|---|---|---|---|
| TXT | resend._domainkey.auth.nadbytecna.cz | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCtnebuByHufcTE0wQPS5AQsIbJeTtTcqIJMYGO2bNjnzCD+Op2d+zHjk0q8snm2eM8gnT3p0FbNHWEaJB/4Zmif+ZLg3htucV/6/4UZHcSCRD9uvKpmsb3dab8elw3Mvy763C8sQ/dl7jt7l12qpji3gB29K3CNZ5hrDLU3VbVMQIDAQAB | Auto |
| CNAME | rsend.auth.nadbytecna.cz | rsend-euw1.forge.rmta.net | Auto |
| CNAME | send.auth.nadbytecna.cz | send.forge.rmta.net | Auto |

V administraci zóny nadbytecna.cz lze použít relativní názvy bez koncového .nadbytecna.cz. Neměnit stávající MX, SPF ani DMARC hlavní domény. Resend zde navrhl dva CNAME, nikoli starší variantu s AWS MX a TXT; platí výše uvedené konkrétní hodnoty z tohoto účtu. Nepřidávat navržený volitelný root DMARC p=none, který by mohl přepsat současnou politiku. Pro CNAME vypnout případnou HTTP proxy.

Po publikování ověřit všechny tři záznamy a stav Verified v Resend. Poté vytvořit klíč s oprávněním pouze Sending access pro auth.nadbytecna.cz a použít jej jako SMTP heslo v Supabase; host smtp.resend.com, port 465, uživatel resend, odesílatel prihlaseni@auth.nadbytecna.cz, jméno Nadbytečná. Klíč nepatří do dokumentace ani veřejných proměnných.
