// Statický build: public/ + src/ -> dist/ (HTML stránky, inline CSS, fonty).
// Použití:  node build.mjs            (varianta claimu z env CLAIM, default 1)
//           node build.mjs --all      (navíc náhledy preview/v1..v3 pro schvalování s Věrou)
//           PHASE1=1 node build.mjs   (pracovní náhled fáze 1; pre-landing se negeneruje)
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VERSIONS, LANGS, PATHS, consentHtml, controller } from "./lib/consent.js";
import { VOTE_CLAIMS, VOTE_MAX } from "./lib/claims.js";
import { renderPhase1 } from "./lib/phase1-html.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Dokud není připojená doména nadbytecna.cz, na Vercelu míří absolutní URL (OG obrázek, canonical) na vercel.app, aby sdílecí náhledy fungovaly.
const SITE = (process.env.SITE_URL || (process.env.VERCEL ? "https://nadbytecna-prelanding.vercel.app" : "https://nadbytecna.cz")).replace(/\/$/, "");
const C = controller();

const CLAIMS = {
  cs: {
    1: { h1: "Žádná žena není nadbytečná.", lead: "Jsi zvědavá, co se chystá?" },
    2: { h1: "Nejsi nadbytečná.", lead: "Něco se chystá a ty u toho budeš první." },
    3: { h1: "Nadbytečná? Nikdy.", lead: "Zjisti jako první, co se chystá." },
  },
  sk: {
    1: { h1: "Žiadna žena nie je nadbytočná.", lead: "Si zvedavá, čo sa chystá?" },
    2: { h1: "Nie si nadbytočná.", lead: "Niečo sa chystá a ty pri tom budeš prvá." },
    3: { h1: "Nadbytočná? Nikdy.", lead: "Zisti ako prvá, čo sa chystá." },
  },
};
const TXT = {
  cs: {
    locale: "cs_CZ", brand: "Nadbytečná",
    sub: "Připravujeme místo pro ženy, které si prošly něčím podobným. Nech nám e-mail a dáme ti vědět jako první.",
    title: "Nadbytečná – něco se chystá",
    nojsSend: "Pro odeslání je potřeba zapnout JavaScript.", nojsDone: "Pro dokončení je potřeba zapnout JavaScript.",
    email: "E-mail", placeholder: "jmeno@email.cz", cta: "Chci vědět víc", hp: "Web",
    policyLink: "Zásady ochrany osobních údajů", otherLang: { label: "Slovensky", code: "sk" },
    backAlt: "Nadbytečná, zpět na úvodní stránku",
    confirm: { title: "Potvrzení e-mailu", h1: "Potvrď svůj e-mail", p: "Jedním kliknutím potvrdíš, že chceš vědět, co se chystá.", button: "Potvrdit e-mail" },
    thanks: { title: "Děkujeme", h1: "Skoro tam jsi.", lead: "Ještě jedno kliknutí.", sub: "Pošleme ti e-mail. Klikni v něm na tlačítko a potvrď, že chceš vědět, co se chystá. Nic nepřišlo? Zkus složku Spam." },
    confirmed: { title: "Potvrzeno", h1: "Jsi v tom s námi.", lead: "Děkujeme, že jsi tu.", sub: "Ozveme se ti jako první, jakmile bude co ukázat." },
    vote: { h2: "Co z toho jsi ty?", sub: (n) => `Vyber až ${n === 3 ? "tři" : n} věty, které tě vystihují nejvíc. Přidáme je k tvému e-mailu a ukážeme ti, co vybraly ostatní.`, send: "Odeslat výběr", others: "Co vybraly ostatní" },
    unsub: { title: "Odhlášení", h1: "Odhlašuji tě…", p: "Chvilku strpení." },
    policyTitle: "Zásady ochrany osobních údajů – Nadbytečná", policyDesc: "Jak zacházíme s e-mailovou adresou, kterou nám necháš na stránce Nadbytečná.",
  },
  sk: {
    locale: "sk_SK", brand: "Nadbytočná",
    sub: "Pripravujeme miesto pre ženy, ktoré si prešli niečím podobným. Nechaj nám e-mail a dáme ti vedieť ako prvej.",
    title: "Nadbytočná – niečo sa chystá",
    nojsSend: "Na odoslanie je potrebné zapnúť JavaScript.", nojsDone: "Na dokončenie je potrebné zapnúť JavaScript.",
    email: "E-mail", placeholder: "meno@email.sk", cta: "Chcem vedieť viac", hp: "Web",
    policyLink: "Zásady ochrany osobných údajov", otherLang: { label: "Česky", code: "cs" },
    backAlt: "Nadbytočná, späť na úvodnú stránku",
    confirm: { title: "Potvrdenie e-mailu", h1: "Potvrď svoj e-mail", p: "Jedným kliknutím potvrdíš, že chceš vedieť, čo sa chystá.", button: "Potvrdiť e-mail" },
    thanks: { title: "Ďakujeme", h1: "Skoro tam si.", lead: "Ešte jedno kliknutie.", sub: "Pošleme ti e-mail. Klikni v ňom na tlačidlo a potvrď, že chceš vedieť, čo sa chystá. Nič neprišlo? Skús priečinok Spam." },
    confirmed: { title: "Potvrdené", h1: "Si v tom s nami.", lead: "Ďakujeme, že si tu.", sub: "Ozveme sa ti ako prvej, len čo bude čo ukázať." },
    vote: { h2: "Čo z toho si ty?", sub: (n) => `Vyber až ${n === 3 ? "tri" : n} vety, ktoré ťa vystihujú najviac. Pridáme ich k tvojmu e-mailu a ukážeme ti, čo vybrali ostatné.`, send: "Odoslať výber", others: "Čo vybrali ostatné" },
    unsub: { title: "Odhlásenie", h1: "Odhlasujem ťa…", p: "Chvíľku strpenia." },
    policyTitle: "Zásady ochrany osobných údajov – Nadbytočná", policyDesc: "Ako zaobchádzame s e-mailovou adresou, ktorú nám necháš na stránke Nadbytočná.",
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = fs.readFileSync(path.join(ROOT, "src/site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "\n");

// CSP bez 'unsafe-inline': inline <style> povolíme jen podle otisku jeho přesného obsahu.
// Otisk se propíše do vercel.json (test ověří, že sedí; změníš-li CSS, spusť build a commitni vercel.json).
{
  const cssHash = "sha256-" + crypto.createHash("sha256").update(css).digest("base64");
  const vjPath = path.join(ROOT, "vercel.json");
  const vj = JSON.parse(fs.readFileSync(vjPath, "utf8"));
  const h = vj.headers[0].headers.find((x) => x.key === "Content-Security-Policy");
  const next = h.value.replace(/style-src [^;]*;/, `style-src 'self' '${cssHash}';`);
  if (!process.env.OUT_DIR && next !== h.value) { h.value = next; fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2) + "\n"); }
}

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const PRELOAD = [
  "jost-latin-wght-normal.woff2", "jost-latin-ext-wght-normal.woff2",
].map((f) => `<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin>`).join("\n");

// Web se indexuje až po otevření sběru (COLLECTION_OPEN=true při buildu a vyplněný správce); do té doby noindex + Disallow.
const LIVE = process.env.COLLECTION_OPEN === "true" && C.complete;
const HOME_ALT = Object.fromEntries(LANGS.map((l) => [l, PATHS[l].home]));
const POLICY_ALT = Object.fromEntries(LANGS.map((l) => [l, PATHS[l].policy]));

function head({ lang, title, desc, path: p, index = true, og = null, ld = "", alt = null }) {
  index = index && LIVE;
  const url = SITE + p;
  const t = TXT[lang];
  const alternates = alt ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE + alt[l]}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE + alt.cs}">` : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#F4CCD8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="${index ? "index,follow,max-image-preview:large" : "noindex,nofollow"}">
<link rel="canonical" href="${url}">
${alternates}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${og ? `<meta property="og:type" content="website">
<meta property="og:locale" content="${t.locale}">
${LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${TXT[l].locale}">`).join("\n")}
<meta property="og:site_name" content="${t.brand}">
<meta property="og:title" content="${esc(og.title)}">
<meta property="og:description" content="${esc(og.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-v2.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t.brand}. ${esc(og.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(og.title)}">
<meta name="twitter:description" content="${esc(og.desc)}">
<meta name="twitter:image" content="${SITE}/og-v2.jpg">` : ""}
${PRELOAD}
<style>${css}</style>
${ld}
</head>`;
}

const footer = (lang, switcher = null) => {
  const t = TXT[lang];
  const sw = switcher ? `<br><a class="lang" href="${switcher}" hreflang="${t.otherLang.code}" lang="${t.otherLang.code}">${t.otherLang.label}</a>` : "";
  return `<footer class="foot"><img class="dom" src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná.cz"><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a><br><a href="${PATHS[lang].policy}">${t.policyLink}</a>${C.complete ? `<br>${esc(C.name)}, IČO ${esc(C.ico)}` : ""}${sw}</footer>`;
};
const analytics = '<script defer src="/_vercel/insights/script.js"></script>';
const LOGO_ATTRS = 'width="2480" height="528" data-split="0" data-base="0.8403" alt="Nadbytečná.cz"';

function home(lang, variant) {
  const t = TXT[lang], P = PATHS[lang], cl = CLAIMS[lang][variant];
  const jsonld = [{ "@context": "https://schema.org", "@type": "WebSite", name: t.brand, url: SITE + P.home, inLanguage: lang }];
  if (C.complete) jsonld.push({ "@context": "https://schema.org", "@type": "Organization", name: C.name, url: SITE + "/", identifier: C.ico, email: C.email, logo: SITE + "/img/nadbytecna-script.svg" });
  const ld = jsonld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");
  return `${head({ lang, title: t.title, desc: t.sub, path: P.home, og: { title: `${cl.h1} ${cl.lead}`, desc: t.sub }, ld, alt: HOME_ALT })}
<body data-page="home">
<div class="page">
<main class="main">
<div class="brand">
<img class="logo" src="/img/nadbytecna-script.svg" ${LOGO_ATTRS} fetchpriority="high" decoding="async">
<div class="rule" aria-hidden="true">${HEART}</div>
</div>
<div class="content">
<h1>${esc(cl.h1)}</h1>
<p class="lead">${esc(cl.lead)}</p>
<p class="sub">${esc(t.sub)}</p>
<noscript><p class="nojs">${esc(t.nojsSend)}</p></noscript>
<form id="signup" novalidate data-consent-version="${CONSENT_VERSIONS[lang]}" action="/api/subscribe" method="post">
<div class="field">
<label class="lbl" for="email">${t.email}</label>
<input id="email" name="email" type="email" maxlength="254" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="${t.placeholder}" required aria-describedby="msg">
</div>
<div class="hp" aria-hidden="true"><label>${t.hp}<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="consent">
<input id="consent" name="consent" type="checkbox" required aria-describedby="consent-text">
<label id="consent-text" for="consent">${consentHtml(C, esc, lang)}</label>
</div>
<button class="cta" id="send" type="submit">${t.cta}</button>
<p class="msg" id="msg" role="alert"></p>
</form>
</div>
</main>
${footer(lang, PATHS[t.otherLang.code].home)}
</div>
<script src="/app.js" defer></script>
<script src="/fluid.js" defer></script>
${analytics}
</body>
</html>
`;
}

function simplePage(lang, { page, c }) {
  const t = TXT[lang], P = PATHS[lang];
  return `${head({ lang, title: `${c.title} – ${t.brand}`, desc: t.sub, path: page === "confirm" ? P.confirm : P.unsub, index: false })}
<body data-page="${page}">
<div class="page">
<main class="main main-one">
<div class="card">
<a href="${P.home}"><img class="logo" src="/img/nadbytecna-script.svg" ${LOGO_ATTRS}></a>
<div id="state" hidden>
<div id="live" tabindex="-1" aria-live="polite"><h1 id="h">${esc(c.h1)}</h1><p id="p">${esc(c.p)}</p></div>
${c.button ? `<button class="cta" id="action" type="button">${esc(c.button)}</button>` : ""}
</div>
<noscript><h1>${esc(c.h1)}</h1><p>${esc(t.nojsDone)}</p></noscript>
</div>
</main>
${footer(lang)}
</div>
<script src="/app.js" defer></script>
<script src="/fluid.js" defer></script>
</body>
</html>
`;
}

// Zásady: české znění zůstává beze změny; slovenské je samostatný překlad s úpravou na slovenské reálie
// (dozorový úřad, zákon o elektronických komunikacích). Obojí podléhá právní kontrole.
function policy(lang) {
  const T = (s) => `<p class="todo">${s}</p>`;
  const sk = lang === "sk";
  const t = TXT[lang], P = PATHS[lang];
  const who = C.complete
    ? `<p>${esc(C.name)}, IČO ${esc(C.ico)}, ${sk ? "so sídlom" : "se sídlem"} ${esc(C.address)}.<br>${sk ? "Kontakt" : "Kontakt"}: <a href="mailto:${esc(C.email)}">${esc(C.email)}</a></p>`
    : T(sk ? "[Doplniť pred spustením zberu: názov s.r.o., IČO, sídlo, kontaktný e-mail prevádzkovateľa.]" : "[Doplnit před spuštěním sběru: název s.r.o., IČO, sídlo, kontaktní e-mail správce.]");
  const cs = `<h1>Zásady ochrany osobních údajů</h1>
<p>Platí pro přihlášení k informacím o spuštění platformy Nadbytečná na stránce nadbytecna.cz.</p>
<h2>1. Kdo je správce</h2>
${who}
<p>Správce nejmenoval pověřence pro ochranu osobních údajů.</p>
<h2>2. Jaké údaje zpracováváme, proč a na jakém základě</h2>
<ul>
<li><strong>E-mailová adresa, kterou zadáš.</strong> Pošleme ti potvrzovací e-mail a pak informaci, že platforma Nadbytečná byla spuštěna. Základ: tvůj souhlas (čl. 6 odst. 1 písm. a) nařízení GDPR).</li>
<li><strong>Výroky, které si po potvrzení e-mailu nepovinně vybereš</strong> (až tři). Uložíme je k tvému e-mailu, abychom poznali, co tě oslovuje, a zveřejníme jen souhrnné počty, ze kterých nepoznáš nikoho konkrétního. Základ: tvůj souhlas, který dáš samotným výběrem (čl. 6 odst. 1 písm. a) GDPR). Výběr můžeš kdykoli změnit odhlášením, tím se vymaže.</li>
<li><strong>Čas udělení souhlasu, znění souhlasu, které jsi viděla, čas potvrzení e-mailu a čas případného odvolání.</strong> Abychom mohli prokázat, že jsi souhlas udělila, a respektovat jeho odvolání. Základ: povinnost prokázat souhlas (čl. 7 odst. 1 GDPR) a náš oprávněný zájem na obhajobě právních nároků (čl. 6 odst. 1 písm. f) GDPR).</li>
<li><strong>Otisk IP adresy</strong> (hash, ne samotná adresa), ukládaný nejdéle 30 dnů. Ochrana formuláře před zneužitím a automatickým vyplňováním. Základ: náš oprávněný zájem na bezpečném provozu (čl. 6 odst. 1 písm. f) GDPR).</li>
<li><strong>IP adresa a technické údaje o požadavku v serverových logech hostingu.</strong> Provoz a zabezpečení stránky. Základ: náš oprávněný zájem na provozu a zabezpečení (čl. 6 odst. 1 písm. f) GDPR).</li>
</ul>
<p>Nic dalšího se neptáme (výběr výroků je nepovinný). Na stránce nepoužíváme cookies ani nástroje třetích stran, které by tě sledovaly.</p>
<h2>3. Je poskytnutí údajů povinné</h2>
<p>Ne. Bez e-mailové adresy a souhlasu ti ale nemůžeme dát o spuštění vědět.</p>
<h2>4. Jak dlouho údaje uchováváme</h2>
<ul>
<li>nepotvrzené přihlášky mažeme do 7 dnů,</li>
<li>potvrzenou e-mailovou adresu uchováváme, dokud souhlas neodvoláš,</li>
<li>po odvolání ti už nepíšeme; uchováme jen e-mailovou adresu v seznamu odhlášených, aby ti nepřišla další zpráva, a důkaz o souhlasu a jeho odvolání po dobu [3 roky],</li>
<li>otisk IP adresy mažeme nejpozději po 30 dnech,</li>
<li>serverové logy hostingu se uchovávají podle pravidel poskytovatele hostingu [doplnit dobu].</li>
</ul>
${T("[K potvrzení právní kontrolou: doba uchování důkazu o souhlasu a seznamu odhlášených; doba uchování logů hostingu; zda stačí souhlas „činem“ u nepovinného výběru výroků.]")}
<h2>5. Komu údaje předáváme</h2>
<p>Správce používá zpracovatele, kteří pro něj údaje zpracovávají na základě smlouvy o zpracování:</p>
<ul>
<li>Vercel Inc. (USA), hosting stránky. Přenos mimo EU se opírá o certifikaci společnosti v rámci EU-U.S. Data Privacy Framework a standardní smluvní doložky,</li>
<li>Supabase, databáze přihlášek v regionu EU,</li>
<li>poskytovatel odesílání e-mailů: [doplnit podle zvoleného nástroje].</li>
</ul>
${T("[Doplnit před spuštěním: subjekt a region Supabase, poskytovatel e-mailů, sídlo a případný přenos mimo EU, odkazy na smlouvy o zpracování.]")}
<p>Údaje neprodáváme a nepředáváme dalším osobám k jejich vlastním účelům.</p>
<h2>6. Tvoje práva</h2>
<p>Máš právo na přístup k údajům, na opravu, na výmaz, na omezení zpracování a na přenositelnost údajů zpracovávaných na základě souhlasu. U zpracování na základě oprávněného zájmu máš právo vznést námitku. Souhlas můžeš kdykoli odvolat, stejně snadno, jako jsi ho udělila: odkazem na odhlášení v každém e-mailu nebo zprávou správci. Odvoláním souhlasu není dotčena zákonnost zpracování před jeho odvoláním. Nerozhodujeme o tobě automatizovaně a neprofilujeme tě.</p>
<p>Máš také právo podat stížnost u dozorového úřadu, kterým je Úřad pro ochranu osobních údajů (uoou.cz).</p>
<h2>7. Obchodní sdělení</h2>
<p>E-mail o spuštění platformy je obchodní sdělení ve smyslu zákona č. 480/2004 Sb. Pošleme ti ho jen tehdy, pokud jsi nám dala souhlas a potvrdila svou adresu. Bude jasně označen jako obchodní sdělení, bude uvádět odesílatele a bude obsahovat odkaz, kterým se jedním kliknutím odhlásíš.</p>
<h2>8. Kontakt</h2>
${C.complete ? `<p><a href="mailto:${esc(C.email)}">${esc(C.email)}</a></p>` : T("[Doplnit kontaktní e-mail správce.]")}
<p><small>Znění z ${esc(CONSENT_VERSIONS.cs.slice(0, 10))}.</small></p>`;
  const skBody = `<h1>Zásady ochrany osobných údajov</h1>
<p>Platia pre prihlásenie na informácie o spustení platformy Nadbytočná na stránke nadbytecna.cz.</p>
<h2>1. Kto je prevádzkovateľ</h2>
${who}
<p>Prevádzkovateľ nemenoval zodpovednú osobu pre ochranu osobných údajov.</p>
<h2>2. Aké údaje spracúvame, prečo a na akom základe</h2>
<ul>
<li><strong>E-mailová adresa, ktorú zadáš.</strong> Pošleme ti potvrdzovací e-mail a potom informáciu, že platforma Nadbytočná bola spustená. Základ: tvoj súhlas (čl. 6 ods. 1 písm. a) nariadenia GDPR).</li>
<li><strong>Výroky, ktoré si po potvrdení e-mailu nepovinne vyberieš</strong> (až tri). Uložíme ich pri tvojom e-maile, aby sme vedeli, čo ťa oslovuje, a zverejníme len súhrnné počty, z ktorých nespoznáš nikoho konkrétneho. Základ: tvoj súhlas, ktorý dáš samotným výberom (čl. 6 ods. 1 písm. a) GDPR). Výber môžeš kedykoľvek zrušiť odhlásením, tým sa vymaže.</li>
<li><strong>Čas udelenia súhlasu, znenie súhlasu, ktoré si videla, čas potvrdenia e-mailu a čas prípadného odvolania.</strong> Aby sme vedeli preukázať, že si súhlas udelila, a rešpektovať jeho odvolanie. Základ: povinnosť preukázať súhlas (čl. 7 ods. 1 GDPR) a náš oprávnený záujem na obhajobe právnych nárokov (čl. 6 ods. 1 písm. f) GDPR).</li>
<li><strong>Odtlačok IP adresy</strong> (hash, nie samotná adresa), ukladaný najviac 30 dní. Ochrana formulára pred zneužitím a automatickým vypĺňaním. Základ: náš oprávnený záujem na bezpečnej prevádzke (čl. 6 ods. 1 písm. f) GDPR).</li>
<li><strong>IP adresa a technické údaje o požiadavke v serverových logoch hostingu.</strong> Prevádzka a zabezpečenie stránky. Základ: náš oprávnený záujem na prevádzke a zabezpečení (čl. 6 ods. 1 písm. f) GDPR).</li>
</ul>
<p>Nič ďalšie sa nepýtame (výber výrokov je nepovinný). Na stránke nepoužívame cookies ani nástroje tretích strán, ktoré by ťa sledovali.</p>
<h2>3. Je poskytnutie údajov povinné</h2>
<p>Nie. Bez e-mailovej adresy a súhlasu ti však nemôžeme dať o spustení vedieť.</p>
<h2>4. Ako dlho údaje uchovávame</h2>
<ul>
<li>nepotvrdené prihlášky mažeme do 7 dní,</li>
<li>potvrdenú e-mailovú adresu uchovávame, kým súhlas neodvoláš,</li>
<li>po odvolaní ti už nepíšeme; uchováme len e-mailovú adresu v zozname odhlásených, aby ti neprišla ďalšia správa, a dôkaz o súhlase a jeho odvolaní po dobu [3 roky],</li>
<li>odtlačok IP adresy mažeme najneskôr po 30 dňoch,</li>
<li>serverové logy hostingu sa uchovávajú podľa pravidiel poskytovateľa hostingu [doplniť dobu].</li>
</ul>
${T("[Na potvrdenie právnou kontrolou: doba uchovania dôkazu o súhlase a zoznamu odhlásených; doba uchovania logov hostingu; či stačí súhlas „konaním“ pri nepovinnom výbere výrokov; ktoré slovenské a české predpisy sa uplatnia, keď je prevádzkovateľ v Česku a účastníčka na Slovensku.]")}
<h2>5. Komu údaje poskytujeme</h2>
<p>Prevádzkovateľ používa sprostredkovateľov, ktorí pre neho spracúvajú údaje na základe zmluvy o spracúvaní:</p>
<ul>
<li>Vercel Inc. (USA), hosting stránky. Prenos mimo EÚ sa opiera o certifikáciu spoločnosti v rámci EU-U.S. Data Privacy Framework a štandardné zmluvné doložky,</li>
<li>Supabase, databáza prihlášok v regióne EÚ,</li>
<li>poskytovateľ odosielania e-mailov: [doplniť podľa zvoleného nástroja].</li>
</ul>
${T("[Doplniť pred spustením: subjekt a región Supabase, poskytovateľ e-mailov, sídlo a prípadný prenos mimo EÚ, odkazy na zmluvy o spracúvaní.]")}
<p>Údaje nepredávame a neposkytujeme ďalším osobám na ich vlastné účely.</p>
<h2>6. Tvoje práva</h2>
<p>Máš právo na prístup k údajom, na opravu, na vymazanie, na obmedzenie spracúvania a na prenosnosť údajov spracúvaných na základe súhlasu. Pri spracúvaní na základe oprávneného záujmu máš právo namietať. Súhlas môžeš kedykoľvek odvolať, rovnako ľahko, ako si ho udelila: odkazom na odhlásenie v každom e-maile alebo správou prevádzkovateľovi. Odvolaním súhlasu nie je dotknutá zákonnosť spracúvania pred jeho odvolaním. Nerozhodujeme o tebe automatizovane a neprofilujeme ťa.</p>
<p>Máš tiež právo podať sťažnosť dozornému orgánu. Na Slovensku je to Úrad na ochranu osobných údajov Slovenskej republiky (dataprotection.gov.sk), v Česku Úřad pro ochranu osobních údajů.</p>
<h2>7. Obchodné oznámenie</h2>
<p>E-mail o spustení platformy je obchodné oznámenie. Pošleme ti ho len vtedy, ak si nám dala súhlas a potvrdila svoju adresu. Bude jasne označený ako obchodné oznámenie, bude uvádzať odosielateľa a bude obsahovať odkaz, ktorým sa jedným kliknutím odhlásiš.</p>
<h2>8. Kontakt</h2>
${C.complete ? `<p><a href="mailto:${esc(C.email)}">${esc(C.email)}</a></p>` : T("[Doplniť kontaktný e-mail prevádzkovateľa.]")}
<p><small>Znenie z ${esc(CONSENT_VERSIONS.sk.slice(0, 10))}.</small></p>`;
  return `${head({ lang, title: t.policyTitle, desc: t.policyDesc, path: P.policy, index: C.complete, alt: POLICY_ALT })}
<body data-page="policy">
<div class="page">
<main class="main main-one main-top">
<article class="doc">
<a class="back" href="${P.home}"><img src="/img/nadbytecna-script.svg" width="2480" height="528" alt="${t.backAlt}"></a>
${sk ? skBody : cs}
<p><a class="lang" href="${PATHS[t.otherLang.code].policy}" hreflang="${t.otherLang.code}" lang="${t.otherLang.code}">${t.otherLang.label}</a></p>
</article>
</main>
</div>
</body>
</html>
`;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function thanksPage(lang, { slug, c, extra = "", vote = false }) {
  const t = TXT[lang], P = PATHS[lang];
  return `${head({ lang, title: `${c.title} – ${t.brand}`, desc: t.sub, path: slug, index: false })}
<body data-page="thanks"${vote ? " data-vote" : ""}>
<div class="page">
<main class="main">
<div class="brand">
<a href="${P.home}" aria-label="${t.brand}"><img class="logo" src="/img/nadbytecna-script.svg" ${LOGO_ATTRS} fetchpriority="high" decoding="async"></a>
<div class="rule" aria-hidden="true">${HEART}</div>
</div>
<div class="content" role="status">
<h1>${esc(c.h1)}</h1>
<p class="lead">${esc(c.lead)}</p>
<p class="sub">${esc(c.sub)}</p>
</div>
${extra}
</main>
${footer(lang)}
</div>
<script src="/app.js" defer></script>
<script src="/fluid.js" defer></script>
</body>
</html>
`;
}

function voteSection(lang) {
  const t = TXT[lang].vote;
  return `<section class="vote" id="vote" hidden aria-labelledby="vote-h">
<h2 id="vote-h">${t.h2}</h2>
<p class="vote-sub">${t.sub(VOTE_MAX)}</p>
<div class="picks" id="picks" role="group" aria-labelledby="vote-h">
${VOTE_CLAIMS.map((c) => `<button type="button" class="pick" data-id="${c.id}" aria-pressed="false">${esc(lang === "sk" ? c.sk : c.text)}</button>`).join("\n")}
</div>
<button class="cta" id="vote-send" type="button" disabled>${t.send}</button>
<p class="msg" id="vote-msg" role="alert"></p>
<div class="results" id="results" hidden aria-live="polite">
<h3>${t.others}</h3>
<ol class="bars" id="bars"></ol>
<p class="vote-note" id="vote-note"></p>
</div>
</section>`;
}

function stage(out) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "public"), out, { recursive: true });
  fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
  const fontDirs = ["@fontsource-variable/jost"];
  for (const d of fontDirs) {
    const dir = path.join(ROOT, "node_modules", d, "files");
    for (const f of fs.readdirSync(dir)) {
      if (/^jost-(latin|latin-ext)-wght-(normal|italic)\.woff2$/.test(f)) {
        fs.copyFileSync(path.join(dir, f), path.join(out, "fonts", f));
      }
    }
  }
  fs.copyFileSync(path.join(ROOT, "node_modules/@fontsource-variable/jost/LICENSE"), path.join(out, "fonts/OFL-Jost.txt"));
  fs.copyFileSync(path.join(ROOT, "src/app.js"), path.join(out, "app.js"));
  fs.writeFileSync(path.join(out, "fluid.js"), fs.readFileSync(path.join(ROOT, "src/fluid.js"), "utf8").replace("/*LETTERS*/null", () => fs.readFileSync(path.join(ROOT, "src/letters.json"), "utf8")));
}

function build(out, variant) {
  stage(out);
  const file = (p) => path.join(out, p.replace(/^\//, ""), "index.html");
  for (const lang of LANGS) {
    const t = TXT[lang], P = PATHS[lang];
    write(file(P.home), home(lang, variant));
    write(file(P.confirm), simplePage(lang, { page: "confirm", c: t.confirm }));
    write(file(P.thanks), thanksPage(lang, { slug: P.thanks, c: t.thanks }));
    write(file(P.confirmed), thanksPage(lang, { slug: P.confirmed, c: t.confirmed, vote: true, extra: voteSection(lang) }));
    write(file(P.unsub), simplePage(lang, { page: "unsubscribe", c: { ...t.unsub, button: "" } }));
    write(file(P.policy), policy(lang));
  }
  const urls = LANGS.flatMap((l) => [PATHS[l].home].concat(C.complete ? [PATHS[l].policy] : []));
  const altOf = (u) => { const l = LANGS.find((x) => PATHS[x].home === u || PATHS[x].policy === u); const key = PATHS[l].home === u ? "home" : "policy"; return LANGS.map((x) => `<xhtml:link rel="alternate" hreflang="${x}" href="${SITE}${PATHS[x][key]}"/>`).join(""); };
  write(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.map((u) => `<url><loc>${SITE}${u}</loc>${altOf(u)}</url>`).join("\n")}\n</urlset>\n`);
  write(path.join(out, "robots.txt"), LIVE ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n` : `User-agent: *\nAllow: /og-v2.jpg\nDisallow: /\n`);
}

function buildPhase1(out) {
  stage(out);
  fs.rmSync(path.join(out, "app.js"), { force: true });
  fs.copyFileSync(path.join(ROOT, "src/story-form.js"), path.join(out, "story-form.js"));
  fs.copyFileSync(path.join(ROOT, "src/help-form.js"), path.join(out, "help-form.js"));
  fs.copyFileSync(path.join(ROOT, "src/submit.js"), path.join(out, "submit.js"));
  fs.copyFileSync(path.join(ROOT, "src/cookies.js"), path.join(out, "cookies.js"));
  fs.copyFileSync(path.join(ROOT, "src/admin.js"), path.join(out, "admin.js"));
  fs.copyFileSync(path.join(ROOT, "src/admin-pkce.js"), path.join(out, "admin-pkce.js"));
  fs.copyFileSync(path.join(ROOT, "src/admin.css"), path.join(out, "admin.css"));
  fs.copyFileSync(path.join(ROOT, "src/mail-connect.js"), path.join(out, "mail-connect.js"));
  fs.copyFileSync(path.join(ROOT, "src/mail-connect.css"), path.join(out, "mail-connect.css"));
  fs.copyFileSync(path.join(ROOT, "src/launch-form.js"), path.join(out, "launch-form.js"));
  fs.copyFileSync(path.join(ROOT, "src/video.js"), path.join(out, "video.js"));
  fs.copyFileSync(path.join(ROOT, "src/scroll.css"), path.join(out, "scroll.css"));
  fs.copyFileSync(path.join(ROOT, "src/scroll.js"), path.join(out, "scroll.js"));
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supaKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const ads = {
    meta: process.env.NEXT_PUBLIC_META_PIXEL_ID || "",
    ga4: process.env.NEXT_PUBLIC_GA4_ID || "",
    ads: process.env.NEXT_PUBLIC_GOOGLE_ADS_ID || "",
    adsStory: process.env.NEXT_PUBLIC_GOOGLE_ADS_STORY_LABEL || "",
    adsHelp: process.env.NEXT_PUBLIC_GOOGLE_ADS_HELP_LABEL || "",
    adsShop: process.env.NEXT_PUBLIC_GOOGLE_ADS_SHOP_LABEL || "",
    tiktok: process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || "",
  };
  fs.writeFileSync(path.join(out, "config.js"), "window.NADBYTECNA_SUPABASE=" + JSON.stringify({ url: supaUrl, key: supaKey }) + ";\nwindow.NADBYTECNA_ADS=" + JSON.stringify(ads) + ";\n");
  const { pages, robots, llms } = renderPhase1({ css, preload: PRELOAD, heart: HEART, logoAttrs: LOGO_ATTRS, draft: process.env.VERCEL_ENV !== "production" });
  for (const [p, html] of Object.entries(pages)) {
    const rel = p === "/" ? "index.html" : path.join(p.replace(/^\//, ""), "index.html");
    write(path.join(out, rel), html);
  }
  write(path.join(out, "robots.txt"), robots);
  write(path.join(out, "llms.txt"), llms);
  const publicPaths = Object.keys(pages).filter((p) => p !== "/admin/" && p !== "/coming-soon/" && p !== "/kontakt/");
  const urls = publicPaths.map((p) => `<url><loc>${SITE}${p === "/" ? "/" : p}</loc></url>`).join("\n");
  write(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}

const variant = Number(process.env.CLAIM || 1);
if (!CLAIMS.cs[variant]) throw new Error("CLAIM musí být 1, 2 nebo 3");
const out = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(ROOT, "dist");
if (process.env.PHASE1 === "1") buildPhase1(out);
else {
  build(out, variant);
  if (!process.env.OUT_DIR && process.argv.includes("--all")) for (const v of [1, 2, 3]) build(path.join(ROOT, "preview", `v${v}`), v);
}

if (process.env.PHASE1 === "1") console.log(`Build OK (fáze 1, ${SITE})`);
else {
  const todo = [];
  if (!C.complete) todo.push("Správce údajů (CONTROLLER_NAME/ICO/ADDRESS/EMAIL) není vyplněn – text souhlasu a zásady mají zástupné údaje.");
  if (todo.length) console.warn("POZOR:\n- " + todo.join("\n- "));
  console.log(`Build OK (claim ${variant}, ${SITE})`);
}
