// Statický build: public/ + src/ -> dist/ (HTML stránky, inline CSS, fonty).
// Použití:  node build.mjs            (varianta claimu z env CLAIM, default 1)
//           node build.mjs --all      (navíc náhledy preview/v1..v3 pro schvalování s Věrou)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VERSION, consentHtml, controller } from "./lib/consent.js";

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

const footer = () => `<footer class="foot"><a href="/zasady-ochrany-osobnich-udaju/">Zásady ochrany osobních údajů</a>${C.complete ? `<br>${esc(C.name)}, IČO ${esc(C.ico)}` : ""}</footer>`;
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
<img class="logo" src="/img/nadbytecna-script.svg" width="1994" height="528" alt="Nadbytečná" fetchpriority="high" decoding="async">
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
<input id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="jmeno@email.cz" required aria-describedby="msg">
</div>
<div class="hp" aria-hidden="true"><label>Web<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<input type="hidden" id="ts" name="ts" value="">
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
${analytics}
</body>
</html>
`;
}

function simplePage({ page, title, h1, p, button, extra = "" }) {
  return `${head({ title: `${title} – Nadbytečná`, desc: SUB, path: `/${page === "confirm" ? "potvrzeni" : "odhlaseni"}/`, index: false })}
<body data-page="${page}">
<div class="page">
<main class="main" style="grid-template-columns:1fr">
<div class="card">
<a href="/"><img class="logo" src="/img/nadbytecna-script.svg" width="1994" height="528" alt="Nadbytečná"></a>
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
<main class="main" style="grid-template-columns:1fr;align-content:start">
<article class="doc">
<a class="back" href="/"><img src="/img/nadbytecna-script.svg" width="1994" height="528" alt="Nadbytečná, zpět na úvodní stránku"></a>
<h1>Zásady ochrany osobních údajů</h1>
<p>Platí pro přihlášení k informacím o spuštění platformy Nadbytečná na stránce nadbytecna.cz.</p>
<h2>Kdo je správce</h2>
${who}
<h2>Jaké údaje zpracováváme</h2>
<ul>
<li>e-mailovou adresu, kterou nám zadáš,</li>
<li>čas, kdy jsi souhlas udělila, a znění souhlasu, které jsi viděla,</li>
<li>čas, kdy jsi e-mailovou adresu potvrdila (nebo souhlas odvolala),</li>
<li>technický otisk IP adresy (hash, ne samotnou adresu), který slouží k ochraně před zneužitím formuláře; mažeme ho nejpozději po 30 dnech.</li>
</ul>
<p>Nic dalšího se neptáme. Nepoužíváme cookies.</p>
<h2>Proč a na jakém základě</h2>
<p>Abychom ti dali vědět, až bude platforma Nadbytečná spuštěna. Právním základem je tvůj souhlas (čl. 6 odst. 1 písm. a) nařízení GDPR). Bez potvrzení e-mailu nic neposíláme a souhlas se nepovažuje za udělený.</p>
<h2>Jak dlouho údaje uchováváme</h2>
<ul>
<li>nepotvrzené přihlášky mažeme do 7 dnů,</li>
<li>potvrzenou adresu uchováváme do odvolání souhlasu,</li>
<li>po odvolání uchováváme jen e-mailovou adresu v seznamu odhlášených, abychom ti už nepsali; ostatní údaje mažeme.</li>
</ul>
${T("[K potvrzení legal session: délka uchování důkazu o souhlasu a seznam odhlášených.]")}
<h2>Komu údaje předáváme</h2>
<p>Správce používá zpracovatele, kteří mu pomáhají stránku provozovat:</p>
<ul>
<li>Vercel Inc. – hosting stránky,</li>
<li>Supabase – databáze přihlášek (region EU),</li>
<li>poskytovatel odesílání e-mailů: [doplnit podle zvoleného nástroje].</li>
</ul>
${T("[Doplnit před spuštěním: poskytovatel e-mailů, sídlo a případný přenos mimo EU, odkaz na doložení záruk.]")}
<h2>Tvoje práva</h2>
<p>Máš právo na přístup k údajům, na opravu, na výmaz, na omezení zpracování a na přenositelnost. Souhlas můžeš kdykoli odvolat odkazem v každém e-mailu nebo zprávou správci; odvoláním souhlasu není dotčena zákonnost zpracování před jeho odvoláním. Můžeš podat stížnost u Úřadu pro ochranu osobních údajů (uoou.cz).</p>
<h2>Kontakt</h2>
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

function thanksPage({ slug, title, h1, lead, sub }) {
  return `${head({ title: `${title} – Nadbytečná`, desc: SUB, path: `/${slug}/`, index: false })}
<body data-page="thanks">
<div class="page">
<main class="main">
<div class="brand">
<a href="/" aria-label="Nadbytečná"><img class="logo" src="/img/nadbytecna-script.svg" width="1994" height="528" alt="Nadbytečná" fetchpriority="high" decoding="async"></a>
<div class="rule" aria-hidden="true">${HEART}</div>
</div>
<div class="content" role="status">
<h1>${esc(h1)}</h1>
<p class="lead">${esc(lead)}</p>
<p class="sub">${esc(sub)}</p>
</div>
</main>
${footer()}
</div>
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
  write(path.join(out, "index.html"), home(variant));
  write(path.join(out, "potvrzeni/index.html"), simplePage({ page: "confirm", title: "Potvrzení e-mailu", h1: "Potvrď svůj e-mail", p: "Jedním klepnutím potvrdíš, že chceš vědět, co se chystá.", button: "Potvrdit e-mail" }));
  write(path.join(out, "dekujeme/index.html"), thanksPage({ slug: "dekujeme", title: "Děkujeme", h1: "Skoro tam jsi.", lead: "Ještě jedno klepnutí.", sub: "Pošleme ti e-mail. Klikni v něm na tlačítko a potvrď, že chceš vědět, co se chystá. Nic nepřišlo? Zkus složku Spam." }));
  write(path.join(out, "potvrzeno/index.html"), thanksPage({ slug: "potvrzeno", title: "Potvrzeno", h1: "Jsi v tom s námi.", lead: "Děkujeme, že jsi tu.", sub: "Ozveme se ti jako první, jakmile bude co ukázat." }));
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
