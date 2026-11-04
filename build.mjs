// Statický build: public/ + src/ -> dist/ (HTML stránky, inline CSS, fonty).
// Použití:  node build.mjs            (varianta claimu z env CLAIM, default 1)
//           node build.mjs --all      (navíc náhledy preview/v1..v3 pro schvalování s Věrou)
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VERSION, consentHtml, controller } from "./lib/consent.js";
import { VOTE_CLAIMS, VOTE_MAX } from "./lib/claims.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Dokud není připojená doména nadbytecna.cz, na Vercelu míří absolutní URL (OG obrázek, canonical) na vercel.app, aby sdílecí náhledy fungovaly.
const SITE = (process.env.SITE_URL || (process.env.VERCEL ? "https://nadbytecna-prelanding.vercel.app" : "https://nadbytecna.cz")).replace(/\/$/, "");
const C = controller();

const CLAIMS = {
  1: { h1: "Žádná žena není nadbytečná.", lead: "Jsi zvědavá, co se chystá?" },
  2: { h1: "Nejsi nadbytečná.", lead: "Něco se chystá a ty u toho budeš první." },
  3: { h1: "Nadbytečná? Nikdy.", lead: "Zjisti jako první, co se chystá." },
};
const SUB = "Připravujeme místo pro ženy, které si prošly něčím podobným. Nech nám e-mail a dáme ti vědět jako první.";
const TITLE = "Nadbytečná – něco se chystá";

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
  if (next !== h.value) { h.value = next; fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2) + "\n"); }
}

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const PRELOAD = [
  "playfair-display-latin-600-normal.woff2", "playfair-display-latin-ext-600-normal.woff2",
  "hanken-grotesk-latin-wght-normal.woff2", "hanken-grotesk-latin-ext-wght-normal.woff2",
].map((f) => `<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin>`).join("\n");

// Web se indexuje až po otevření sběru (COLLECTION_OPEN=true při buildu a vyplněný správce); do té doby noindex + Disallow.
const LIVE = process.env.COLLECTION_OPEN === "true" && C.complete;
function head({ title, desc, path: p, index = true, og = null, ld = "" }) {
  index = index && LIVE;
  const url = SITE + p;
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#F4CCD8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="${index ? "index,follow,max-image-preview:large" : "noindex,nofollow"}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${og ? `<meta property="og:type" content="website">
<meta property="og:locale" content="cs_CZ">
<meta property="og:site_name" content="Nadbytečná">
<meta property="og:title" content="${esc(og.title)}">
<meta property="og:description" content="${esc(og.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Nadbytečná. ${esc(og.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(og.title)}">
<meta name="twitter:description" content="${esc(og.desc)}">
<meta name="twitter:image" content="${SITE}/og.jpg">` : ""}
${PRELOAD}
<style>${css}</style>
${ld}
</head>`;
}

const footer = () => `<footer class="foot"><img class="dom" src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná.cz"><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a><br><a href="/zasady-ochrany-osobnich-udaju/">Zásady ochrany osobních údajů</a>${C.complete ? `<br>${esc(C.name)}, IČO ${esc(C.ico)}` : ""}</footer>`;
const analytics = '<script defer src="/_vercel/insights/script.js"></script>';

function home(variant) {
  const cl = CLAIMS[variant];
  const jsonld = [{ "@context": "https://schema.org", "@type": "WebSite", name: "Nadbytečná", url: SITE + "/", inLanguage: "cs" }];
  if (C.complete) jsonld.push({ "@context": "https://schema.org", "@type": "Organization", name: C.name, url: SITE + "/", identifier: C.ico, email: C.email, logo: SITE + "/img/nadbytecna-script.svg" });
  const ld = jsonld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n");
  return `${head({ title: TITLE, desc: SUB, path: "/", og: { title: `${cl.h1} ${cl.lead}`, desc: SUB }, ld })}
<body data-page="home">
<div class="page">
<main class="main">
<div class="brand">
<img class="logo" src="/img/nadbytecna-lockup.svg" width="2480" height="1219" data-split="0.5385" data-base="0.8403" data-na0="0.6444" data-na1="0.8065" data-hat="0.6589" data-haty="0.7048" alt="VERY VERA – Nadbytečná.cz" fetchpriority="high" decoding="async">
<div class="rule" aria-hidden="true">${HEART}</div>
</div>
<div class="content">
<h1>${esc(cl.h1)}</h1>
<p class="lead">${esc(cl.lead)}</p>
<p class="sub">${esc(SUB)}</p>
<noscript><p class="nojs">Pro odeslání je potřeba zapnout JavaScript.</p></noscript>
<form id="signup" novalidate data-consent-version="${CONSENT_VERSION}" action="/api/subscribe" method="post">
<div class="field">
<label class="lbl" for="email">E-mail</label>
<input id="email" name="email" type="email" maxlength="254" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="jmeno@email.cz" required aria-describedby="msg">
</div>
<div class="hp" aria-hidden="true"><label>Web<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="consent">
<input id="consent" name="consent" type="checkbox" required aria-describedby="consent-text">
<label id="consent-text" for="consent">${consentHtml(C, esc)}</label>
</div>
<button class="cta" id="send" type="submit">Chci vědět víc</button>
<p class="msg" id="msg" role="alert"></p>
</form>
</div>
</main>
${footer()}
</div>
<script src="/app.js" defer></script>
<script src="/fluid.js" defer></script>
${analytics}
</body>
</html>
`;
}

function simplePage({ page, title, h1, p, button, extra = "" }) {
  return `${head({ title: `${title} – Nadbytečná`, desc: SUB, path: `/${page === "confirm" ? "potvrzeni" : "odhlaseni"}/`, index: false })}
<body data-page="${page}">
<div class="page">
<main class="main main-one">
<div class="card">
<a href="/"><img class="logo" src="/img/nadbytecna-lockup.svg" width="2480" height="1219" data-split="0.5385" data-base="0.8403" data-na0="0.6444" data-na1="0.8065" data-hat="0.6589" data-haty="0.7048" alt="VERY VERA – Nadbytečná.cz"></a>
<div id="state" hidden>
<div id="live" tabindex="-1" aria-live="polite"><h1 id="h">${esc(h1)}</h1><p id="p">${esc(p)}</p></div>
${button ? `<button class="cta" id="action" type="button">${esc(button)}</button>` : ""}
</div>
<noscript><h1>${esc(h1)}</h1><p>Pro dokončení je potřeba zapnout JavaScript.</p></noscript>
${extra}
</div>
</main>
${footer()}
</div>
<script src="/app.js" defer></script>
<script src="/fluid.js" defer></script>
</body>
</html>
`;
}

function policy() {
  const T = (s) => `<p class="todo">${s}</p>`;
  const who = C.complete
    ? `<p>${esc(C.name)}, IČO ${esc(C.ico)}, se sídlem ${esc(C.address)}.<br>Kontakt: <a href="mailto:${esc(C.email)}">${esc(C.email)}</a></p>`
    : T("[Doplnit před spuštěním sběru: název s.r.o., IČO, sídlo, kontaktní e-mail správce.]");
  return `${head({ title: "Zásady ochrany osobních údajů – Nadbytečná", desc: "Jak zacházíme s e-mailovou adresou, kterou nám necháš na stránce Nadbytečná.", path: "/zasady-ochrany-osobnich-udaju/", index: C.complete })}
<body data-page="policy">
<div class="page">
<main class="main main-one main-top">
<article class="doc">
<a class="back" href="/"><img src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná, zpět na úvodní stránku"></a>
<h1>Zásady ochrany osobních údajů</h1>
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
<p><small>Znění z ${esc(CONSENT_VERSION.slice(0, 10))}.</small></p>
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

function thanksPage({ slug, title, h1, lead, sub, extra = "", vote = false }) {
  return `${head({ title: `${title} – Nadbytečná`, desc: SUB, path: `/${slug}/`, index: false })}
<body data-page="thanks"${vote ? " data-vote" : ""}>
<div class="page">
<main class="main">
<div class="brand">
<a href="/" aria-label="Nadbytečná"><img class="logo" src="/img/nadbytecna-lockup.svg" width="2480" height="1219" data-split="0.5385" data-base="0.8403" data-na0="0.6444" data-na1="0.8065" data-hat="0.6589" data-haty="0.7048" alt="VERY VERA – Nadbytečná.cz" fetchpriority="high" decoding="async"></a>
<div class="rule" aria-hidden="true">${HEART}</div>
</div>
<div class="content" role="status">
<h1>${esc(h1)}</h1>
<p class="lead">${esc(lead)}</p>
<p class="sub">${esc(sub)}</p>
</div>
${extra}
</main>
${footer()}
</div>
<script src="/app.js" defer></script>
<script src="/fluid.js" defer></script>
</body>
</html>
`;
}

function build(out, variant) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "public"), out, { recursive: true });
  fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
  const fontDirs = ["@fontsource/playfair-display", "@fontsource-variable/hanken-grotesk"];
  for (const d of fontDirs) {
    const dir = path.join(ROOT, "node_modules", d, "files");
    for (const f of fs.readdirSync(dir)) {
      if (/^playfair-display-(latin|latin-ext)-(600-normal|500-italic)\.woff2$/.test(f) || /^hanken-grotesk-(latin|latin-ext)-wght-normal\.woff2$/.test(f)) {
        fs.copyFileSync(path.join(dir, f), path.join(out, "fonts", f));
      }
    }
  }
  fs.copyFileSync(path.join(ROOT, "src/app.js"), path.join(out, "app.js"));
  fs.writeFileSync(path.join(out, "fluid.js"), fs.readFileSync(path.join(ROOT, "src/fluid.js"), "utf8").replace("/*LETTERS*/null", () => fs.readFileSync(path.join(ROOT, "src/letters.json"), "utf8")));
  write(path.join(out, "index.html"), home(variant));
  write(path.join(out, "potvrzeni/index.html"), simplePage({ page: "confirm", title: "Potvrzení e-mailu", h1: "Potvrď svůj e-mail", p: "Jedním kliknutím potvrdíš, že chceš vědět, co se chystá.", button: "Potvrdit e-mail" }));
  write(path.join(out, "dekujeme/index.html"), thanksPage({ slug: "dekujeme", title: "Děkujeme", h1: "Skoro tam jsi.", lead: "Ještě jedno kliknutí.", sub: "Pošleme ti e-mail. Klikni v něm na tlačítko a potvrď, že chceš vědět, co se chystá. Nic nepřišlo? Zkus složku Spam." }));
  write(path.join(out, "potvrzeno/index.html"), thanksPage({ slug: "potvrzeno", title: "Potvrzeno", h1: "Jsi v tom s námi.", lead: "Děkujeme, že jsi tu.", sub: "Ozveme se ti jako první, jakmile bude co ukázat.", vote: true, extra: `<section class="vote" id="vote" hidden aria-labelledby="vote-h">
<h2 id="vote-h">Co z toho jsi ty?</h2>
<p class="vote-sub">Vyber až ${VOTE_MAX === 3 ? "tři" : VOTE_MAX} věty, které tě vystihují nejvíc. Přidáme je k tvému e-mailu a ukážeme ti, co vybraly ostatní.</p>
<div class="picks" id="picks" role="group" aria-labelledby="vote-h">
${VOTE_CLAIMS.map((c) => `<button type="button" class="pick" data-id="${c.id}" aria-pressed="false">${esc(c.text)}</button>`).join("\n")}
</div>
<button class="cta" id="vote-send" type="button" disabled>Odeslat výběr</button>
<p class="msg" id="vote-msg" role="alert"></p>
<div class="results" id="results" hidden aria-live="polite">
<h3>Co vybraly ostatní</h3>
<ol class="bars" id="bars"></ol>
<p class="vote-note" id="vote-note"></p>
</div>
</section>` }));
  write(path.join(out, "odhlaseni/index.html"), simplePage({ page: "unsubscribe", title: "Odhlášení", h1: "Odhlašuji tě…", p: "Chvilku strpení.", button: "" }));
  write(path.join(out, "zasady-ochrany-osobnich-udaju/index.html"), policy());
  const urls = ["/"].concat(C.complete ? ["/zasady-ochrany-osobnich-udaju/"] : []);
  write(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  write(path.join(out, "robots.txt"), LIVE ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n` : `User-agent: *\nAllow: /og.jpg\nDisallow: /\n`);
}

const variant = Number(process.env.CLAIM || 1);
if (!CLAIMS[variant]) throw new Error("CLAIM musí být 1, 2 nebo 3");
build(path.join(ROOT, "dist"), variant);
if (process.argv.includes("--all")) for (const v of [1, 2, 3]) build(path.join(ROOT, "preview", `v${v}`), v);

const todo = [];
if (!C.complete) todo.push("Správce údajů (CONTROLLER_NAME/ICO/ADDRESS/EMAIL) není vyplněn – text souhlasu a zásady mají zástupné údaje.");
if (todo.length) console.warn("POZOR:\n- " + todo.join("\n- "));
console.log(`Build OK (claim ${variant}, ${SITE})`);
