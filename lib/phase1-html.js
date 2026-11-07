// Fáze 1. Formuláře odesílají přes submit.js. Padající nápis v hero je stejný lockup a stejné fluid.js jako pre-landing.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FIELDS = [
  ["jmeno", "text", "Jméno a příjmení", "", "name", "text", "false"],
  ["osloveni", "text", "Anonymní oslovení (nepovinné)", "Samo o sobě záznam s e-mailem neanonymizuje.", "off", "text", "false"],
  ["email", "email", "E-mail", "", "email", "email", "false"],
  ["telefon", "tel", "Telefon (nepovinný)", "", "tel", "tel", "false"],
  ["text", "textarea", "Příběh, nabídka služby nebo výrobku", "", "off", "text", "true"],
  ["ig", "url", "Odkaz na Instagram (nepovinný)", "", "url", "url", "false"],
  ["fb", "url", "Odkaz na Facebook (nepovinný)", "", "url", "url", "false"],
  ["eshop", "url", "Odkaz na e-shop (nepovinný)", "", "url", "url", "false"],
  ["web", "url", "Odkaz na web (nepovinný)", "", "url", "url", "false"],
];

function field(prefix, [key, type, label, hint, auto, mode, spell], live) {
  const id = `${prefix}-${key}`;
  const hintId = hint ? ` id="${id}-hint"` : "";
  const described = hint ? ` aria-describedby="${id}-hint"` : "";
  const common = `id="${id}"${described} autocomplete="${auto}" spellcheck="${spell}"${live ? "" : " disabled"}`;
  const control = type === "textarea"
    ? `<textarea ${common} rows="6"></textarea>`
    : `<input ${common} type="${type}" inputmode="${mode}" maxlength="500">`;
  return `<div class="field"><label class="lbl" for="${id}">${esc(label)}</label>${control}${hint ? `<p class="hint"${hintId}>${esc(hint)}</p>` : ""}</div>`;
}

function contactFields(prefix, textLabel, live) {
  return FIELDS.map((f) => field(prefix, f[0] === "text" ? ["text", "textarea", textLabel, "", "off", "text", "true"] : f, live)).join("\n");
}

function tail(prefix, live) {
  const off = live ? "" : " disabled";
  const help = prefix === "pomoc";
  const label = help
    ? "Souhlasím se zpracováním nabídky pomoci. Povinné."
    : "Souhlasím se zpracováním údajů, aby se mi Nadbytečná ozvala.";
  const hiddenPublish = help
    ? `<div id="pomoc-consent-publish" hidden>
<label class="opt" for="pomoc-zverejneni"><input id="pomoc-zverejneni" type="checkbox" disabled><span>Chci svou nabídku zveřejnit</span></label>
</div>`
    : "";
  return `<div class="hp" aria-hidden="true"><label>Web<input id="${prefix}-hp" type="text" tabindex="-1" autocomplete="off"></label></div>
<div class="consent">
<input id="${prefix}-gdpr" type="checkbox"${off} aria-describedby="${prefix}-gdpr-hint">
<label for="${prefix}-gdpr">${label}</label>
</div>
${hiddenPublish}
<p class="hint" id="${prefix}-gdpr-hint">Správce osobních údajů je Věra Komárová, fyzická osoba. Formulář je pro lidi od 18 let.</p>
</fieldset>
<p class="form-msg" id="${prefix}-msg" role="alert"></p>
<button type="button" class="send" id="${prefix}-send"${off}>Odeslat</button>
<div class="thanks" id="${prefix}-thanks" hidden>
<h2>Děkujeme.</h2>
<p id="${prefix}-thanks-text"></p>
</div>`;
}

function head({ css, preload, title, desc }) {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#F4CCD8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="googlebot" content="noindex, nofollow, noarchive">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="cs_CZ">
<link rel="canonical" href="https://nadbytecna.cz/">
<meta property="og:url" content="https://nadbytecna.cz/">
<meta property="og:image" content="https://nadbytecna.cz/og-v2.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Nadbytečná.cz. Žádná žena není nadbytečná.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://nadbytecna.cz/og-v2.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${preload}
<style>${css}</style>
</head>`;
}

let SHOW_LEGAL = true;
let DRAFT_MARK = false;
let LOGO = "";

function footerAdmin() {
  const legal = SHOW_LEGAL
    ? `<li><a href="/ochrana-osobnich-udaju/">Ochrana osobních údajů</a></li>
<li><a href="/pravidla-zverejnovani/">Pravidla zveřejňování příběhů</a></li>`
    : "";
  return `<footer class="foot">
<img class="dom" src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná.cz">
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Věra Komárová, fyzická osoba. Adresa: doplníme. IČ: doplníme.</p>
<p class="foot-shop"><a id="eshop-link" href="https://veryvera.cz" rel="noopener noreferrer">E-shop Very Vera</a></p>
<ul class="foot-links">
<li><a href="/potrebuji-pomoc/">Potřebuji pomoc</a></li>
${legal}
<li><a href="/kontakt/">Kontakt</a></li>
<li><button type="button" class="textlink" id="cookie-settings" hidden>Nastavení cookies</button></li>
</ul>
</footer>`;
}

function header() {
  const attrs = LOGO.replace(/\sdata-[a-z0-9]+="[^"]*"/g, "").replace(' alt="VERY VERA – Nadbytečná.cz"', ' alt=""');
  return `<header class="site-head">
<a class="site-mark" href="/" aria-label="Nadbytečná.cz"><img class="wordmark" src="/img/nadbytecna-lockup.svg" ${attrs}></a>
<input class="nav-toggle" id="nav-toggle" type="checkbox">
<label class="nav-burger" for="nav-toggle">Menu</label>
<nav class="site-nav" aria-label="Hlavní">
<a href="/verin-pribeh/">Věřin příběh</a>
<a href="/proverene-kontakty/">Prověřené kontakty</a>
<a href="/o-nas/">O nás</a>
<a href="https://veryvera.cz" rel="noopener noreferrer">E-shop VERY VERA</a>
</nav>
<a class="top-cta" href="/potrebuji-pomoc/">Potřebuji pomoc</a>
</header>`;
}

function footer() {
  const legal = SHOW_LEGAL
    ? `<li><a href="/ochrana-osobnich-udaju/">Ochrana osobních údajů</a></li>
<li><a href="/cookies/">Cookies</a></li>
<li><a href="/pravidla-zverejnovani/">Pravidla zveřejňování příběhů</a></li>`
    : "";
  return `<footer class="foot">
<img class="dom" src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná.cz">
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Věra Komárová, fyzická osoba. Adresa: doplníme. IČ: doplníme.</p>
<p>V ohrožení života volej 155. V jiném akutním nebezpečí volej 158.</p>
<ul class="foot-links">
${legal}
<li><button type="button" class="textlink" id="cookie-settings" hidden>Nastavení cookies</button></li>
</ul>
</footer>`;
}

function sos() {
  return `<details class="sos">
<summary>Okamžitá pomoc</summary>
<p>V ohrožení života volej <a href="tel:155">155</a>. V jiném akutním nebezpečí volej <a href="tel:158">158</a>.</p>
<p><a href="/potrebuji-pomoc/">Potřebuji pomoc</a></p>
</details>`;
}

function shell({ css, preload, title, desc, main, script = "", track = true, chrome = true }) {
  const base = `<script src="/config.js" defer></script>\n${track ? `<script src="/cookies.js" defer></script>\n` : ""}`;
  const top = chrome ? header() : "";
  const foot = chrome ? footer() : footerAdmin();
  const help = chrome ? sos() : "";
  return `${head({ css, preload, title, desc })}
<body data-page="phase1">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="page">
${top}
<main id="obsah" class="main main-top">
${main}
</main>
${foot}
</div>
${help}
${base}${script}
</body>
</html>
`;
}

const CATS = [
  ["Sdílej svůj příběh", "/sdilet-pribeh/"],
  ["Nabídni svůj potenciál (hledám práci)", "/mohu-pomoci/?typ=potencial"],
  ["Nabídni práci", "/mohu-pomoci/?typ=prace"],
  ["Nabídni terapii", "/mohu-pomoci/?typ=terapie"],
  ["Nabídni právní pomoc", "/mohu-pomoci/?typ=pravni"],
  ["Nabídni pomoc – přidej se k nám", "/mohu-pomoci/?typ=pridej"],
  ["Nabídni své výrobky a služby", "/mohu-pomoci/?typ=vyrobky"],
  ["Potřebuji pomoc", "/potrebuji-pomoc/"],
];

function home({ css, preload, heart, logoAttrs }) {
  const cards = CATS.map(([label, href]) => `<a class="cat" href="${href}">${esc(label)}</a>`).join("\n");
  const main = `<div class="hero">
<div class="brand">
<img class="logo" src="/img/nadbytecna-lockup.svg" ${logoAttrs} fetchpriority="high" decoding="async">
<div class="rule" aria-hidden="true">${heart}</div>
</div>
<div class="content">
<h1>Žádná žena není nadbytečná.</h1>
<p class="lead">Místo pro ženy, které si prošly něčím podobným, a pro ty, kdo jim chtějí pomoci.</p>
</div>
</div>
<div class="split">
<section class="block" id="pribeh" aria-labelledby="pribeh-h">
<h2 id="pribeh-h">Věřin příběh</h2>
<aside class="placeholder">
<p>Tady bude osobní výpověď Věry Komárové. Čekáme na její text.</p>
</aside>
</section>
<div class="choices">
<a class="choice" href="/sdilet-pribeh/"><span class="choice-title">Sdílej svůj příběh</span></a>
<a class="choice" href="/mohu-pomoci/"><span class="choice-title">Mohu pomoci</span></a>
</div>
</div>
<section class="block" id="kategorie" aria-labelledby="kat-h">
<h2 id="kat-h">Jak se přidat</h2>
<div class="cat-grid">
${cards}
</div>
</section>
<section class="block" id="kontakty" aria-labelledby="kontakty-h">
<h2 id="kontakty-h">Prověřené kontakty</h2>
<div class="contact-cols">
<article class="slot"><h3>Právní</h3><p>připravujeme</p></article>
<article class="slot"><h3>Wellbeing</h3><p>připravujeme</p></article>
</div>
</section>
<section class="block goal" id="cil" aria-labelledby="cil-h">
<h2 id="cil-h">Změnit systém</h2>
<p>Více ochrany našimi zákony pro ženy, manželky, partnerky, matky a podnikatelky.</p>
</section>
<aside class="vera-strip">
<p class="kicker">VERY VERA</p>
<p>E-shop Věry Komárové.</p>
<a href="https://veryvera.cz" rel="noopener noreferrer">Přejít na veryvera.cz</a>
</aside>`;
  return shell({
    css, preload,
    title: "Nadbytečná.cz",
    desc: "Žádná žena není nadbytečná. Místo pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci. Sdílejte příběh, nebo nabídněte pomoc.",
    main,
    script: `<script src="/fluid.js" defer></script>`,
  });
}

function docPage({ css, preload, title, desc, body, banner = false }) {
  const mark = banner && DRAFT_MARK ? `<p class="draft">Návrh</p>` : "";
  const main = `<article class="doc">
${mark}
${body}
</article>`;
  return shell({ css, preload, title, desc, main });
}

function plainPage({ css, preload, title, desc, main, script = "" }) {
  return shell({ css, preload, title, desc, main, script });
}

export function renderPhase1({ css, preload, heart, logoAttrs, draft = true }) {
  SHOW_LEGAL = draft !== false;
  DRAFT_MARK = draft !== false;
  LOGO = logoAttrs;
  const sdilet = plainPage({
    css, preload,
    title: "Sdílej svůj příběh — Nadbytečná.cz",
    desc: "Napiš příběh, nahraj hlasovou zprávu, nebo přilož audio.",
    main: `<article class="doc" id="story-form">
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<h1>Sdílej svůj příběh</h1>
<p>Napiš ho, nahraj hlasovou zprávu, nebo přilož audio. Hlasové zprávy přepisujeme na text.</p>
<div id="sdilet-fields">
<div class="field"><label class="lbl" for="sdilet-jmeno">Jméno a příjmení</label><input id="sdilet-jmeno" type="text" autocomplete="name" maxlength="200"></div>
<div class="field"><label class="lbl" for="sdilet-email">E-mail</label><input id="sdilet-email" type="email" autocomplete="email" inputmode="email" maxlength="254"></div>
<fieldset class="opts">
<legend>Jak příběh sdílet</legend>
<label class="opt"><input type="radio" name="share" value="anonymous"><span>Chci sdílet anonymně</span></label>
<label class="opt"><input type="radio" name="share" value="named"><span>Chci sdílet se jménem</span></label>
</fieldset>
<p class="hint">Když zvolíš anonymní sdílení, u příběhu neuvedeme jméno. E-mail slouží ke kontaktu s tebou.</p>
<label class="opt" for="sdilet-help"><input id="sdilet-help" type="checkbox"><span>Už jsem si tím prošla a chci i pomáhat</span></label>
<h2 id="sdilet-h">Příběh</h2>
<div class="modes" id="story-modes" role="tablist" aria-label="Jak zadat příběh">
<button type="button" role="tab" id="tab-text" data-input="text" aria-selected="true" aria-controls="mode-text">Napsat text</button>
<button type="button" role="tab" id="tab-mic" data-input="recording" aria-selected="false" aria-controls="mode-mic" tabindex="-1">Hlasová zpráva</button>
<button type="button" role="tab" id="tab-file" data-input="file" aria-selected="false" aria-controls="mode-file" tabindex="-1">Nahrát audio</button>
</div>
<div role="tabpanel" id="mode-text" aria-labelledby="tab-text">
<label class="lbl" for="sdilet-text">Text příběhu</label>
<textarea id="sdilet-text" rows="8"></textarea>
</div>
<div role="tabpanel" id="mode-mic" aria-labelledby="tab-mic" hidden>
<p class="hint">Hlasové zprávy přepisujeme na text.</p>
<div class="rec-row">
<button type="button" id="mic-start">Nahrát</button>
<button type="button" id="mic-stop" hidden>Zastavit</button>
</div>
<p id="mic-status" class="hint" role="status"></p>
<audio id="mic-player" controls hidden playsinline></audio>
<div class="rec-row" id="mic-actions" hidden>
<button type="button" id="mic-again">Nahrát znovu</button>
<button type="button" id="mic-delete">Smazat</button>
</div>
</div>
<div role="tabpanel" id="mode-file" aria-labelledby="tab-file" hidden>
<p class="hint">Audio soubor, třeba .m4a z iPhonu. Nejvýš 50 MB. Hlasové zprávy přepisujeme na text.</p>
<label class="lbl" for="audio-file">Vybrat audio</label>
<input id="audio-file" type="file" accept="audio/*,.m4a,.mp3,.aac,.wav,.caf,.ogg,.webm,audio/mp4,audio/mpeg,audio/aac,audio/wav,audio/x-m4a">
<p id="file-status" class="hint" role="status"></p>
<audio id="file-player" controls hidden playsinline></audio>
</div>
<div class="hp" aria-hidden="true"><label>Web<input id="sdilet-hp" type="text" tabindex="-1" autocomplete="off"></label></div>
<p class="hint">Formulář je pro lidi od 18 let. Žádný souhlas není předzaškrtnutý.</p>
<div class="consent">
<input id="sdilet-gdpr" type="checkbox" aria-describedby="sdilet-gdpr-hint">
<label for="sdilet-gdpr">Souhlasím se zpracováním příběhu včetně citlivých údajů o zdraví nebo násilí, pokud je v příběhu uvedu. Povinné.</label>
</div>
<div id="sdilet-consent-transcript" hidden>
<div class="consent">
<input id="sdilet-prepis" type="checkbox">
<label for="sdilet-prepis">Souhlasím s přepisem hlasové zprávy na text. U audia povinné.</label>
</div>
</div>
<div class="consent">
<input id="sdilet-zverejneni" type="checkbox">
<label for="sdilet-zverejneni">Chci svůj příběh zveřejnit</label>
</div>
<p class="hint" id="sdilet-gdpr-hint">Správce osobních údajů je Věra Komárová, fyzická osoba. Souhlas se zpracováním není souhlas se zveřejněním.</p>
<p class="form-msg" id="sdilet-msg" role="alert"></p>
<button type="button" class="send" id="sdilet-send">Odeslat</button>
</div>
<div class="thanks" id="sdilet-thanks" hidden>
<h2>Děkujeme.</h2>
<p id="sdilet-thanks-text"></p>
</div>
</article>`,
    script: `<script src="/submit.js" defer></script>\n<script src="/story-form.js" defer></script>`,
  });
  const pomoc = plainPage({
    css, preload,
    title: "Mohu pomoci — Nadbytečná.cz",
    desc: "Napiš, jestli sis tím prošla, nebo pomáháš takovým lidem.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<h1>Mohu pomoci</h1>
<p>Vyber jednu možnost. Podle ní tě dokážeme zařadit.</p>
<h2 id="pomoc-h">Formulář: Mohu pomoci</h2>
<div id="help-form">
<fieldset aria-labelledby="pomoc-h">
<fieldset class="opts">
<legend>Jak chceš pomoci</legend>
<label class="opt"><input type="radio" name="druh" value="potencial"><span>Nabídni svůj potenciál (hledám práci)</span></label>
<label class="opt"><input type="radio" name="druh" value="prace"><span>Nabídni práci</span></label>
<label class="opt"><input type="radio" name="druh" value="terapie"><span>Nabídni terapii</span></label>
<label class="opt"><input type="radio" name="druh" value="pravni"><span>Nabídni právní pomoc</span></label>
<label class="opt"><input type="radio" name="druh" value="pridej"><span>Nabídni pomoc – přidej se k nám</span></label>
<label class="opt"><input type="radio" name="druh" value="vyrobky"><span>Nabídni své výrobky a služby</span></label>
</fieldset>
${contactFields("pomoc", "Příběh, nabídka služby nebo výrobku", true)}
${tail("pomoc", true)}
</div>`,
    script: `<script src="/submit.js" defer></script>\n<script src="/help-form.js" defer></script>`,
  });
  const potrebuji = plainPage({
    css, preload,
    title: "Potřebuji pomoc — Nadbytečná.cz",
    desc: "Napiš, s čím potřebuješ pomoct. Není to krizová linka.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<h1>Potřebuji pomoc</h1>
<p>Napiš, s čím potřebuješ pomoct. Ozveme se na e-mail, který uvedeš. Není to krizová linka. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>
<h2 id="potrebuji-h">Formulář: Potřebuji pomoc</h2>
<fieldset disabled aria-labelledby="potrebuji-h">
${["jmeno", "osloveni", "email", "telefon", "text"].map((key) => field("potrebuji", key === "text" ? ["text", "textarea", "S čím potřebuješ pomoct", "", "off", "text", "true"] : FIELDS.find((f) => f[0] === key), false)).join("\n")}
${tail("potrebuji")}`,
  });
  const ochrana = docPage({
    css, preload,
    title: "Ochrana osobních údajů — Nadbytečná.cz",
    desc: "Kdo je správce a k čemu jsou údaje z formulářů na Nadbytečná.cz.",
    banner: true,
    body: `<h1>Ochrana osobních údajů</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<ol class="principles">
<li><h2>Správce</h2><p>Správce osobních údajů je Věra Komárová, fyzická osoba. Adresa: [DOPLNIT]. IČ: [DOPLNIT].</p></li>
<li><h2>Kontakt</h2><p>Kontaktní e-mail: <a href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a>. Jiný kontakt: [DOPLNIT].</p></li>
<li><h2>Věk</h2><p>Web a formuláře jsou pro lidi od 18 let.</p></li>
<li><h2>Jaké údaje</h2><p>Jméno, e-mail, volitelně telefon, text příběhu, hlas, přepis, nabídka pomoci a odkazy, které člověk sám uvede. Údaje o zdraví a o násilí jsou zvláštní kategorie a zpracovávají se jen se souhlasem se zpracováním příběhu.</p></li>
<li><h2>Účel a právní základ</h2><p>Aby se Nadbytečná ozvala a věděla, s čím se člověk přidává. Zveřejnění je samostatný souhlas. Právní základ u ostatních operací: [ROZHODNOUT].</p></li>
<li><h2>Kdo údaje čte</h2><p>Příběhy čte Věra Komárová a Michal Baturko [OVĚŘIT formulaci].</p></li>
<li><h2>Zpracovatelé</h2><p>Vercel Inc. (hosting), Supabase (EU, Frankfurt), OpenAI (přepis hlasu, USA – [OVĚŘIT předání mimo EU]), Resend (e-maily).</p></li>
<li><h2>Jak dlouho</h2><p>Audio mažeme do 30 dní po přepisu. Nezveřejněný příběh držíme 12 měsíců. Nabídku pomoci držíme 24 měsíců. Zveřejněný příběh: [ROZHODNOUT].</p></li>
<li><h2>Práva</h2><p>Přístup, oprava, výmaz, omezení, odvolání souhlasu a stížnost u Úřadu pro ochranu osobních údajů. Postup: [DOPLNIT].</p></li>
<li><h2>Kdy je souhlas nutný</h2><p>Bez souhlasu se zpracováním příběhu, a u audia bez souhlasu s přepisem, se příběh neuloží. Bez souhlasu se zpracováním nabídky se nabídka neuloží. Souhlas se zveřejněním příběhu povinný není.</p></li>
<li><h2>Automatizované rozhodování</h2><p>[ROZHODNOUT].</p></li>
<li><h2>Cookies</h2><p>Web po souhlasu používá analytické a marketingové cookies (GA4, Google Ads, Meta Pixel, TikTok Pixel), bez souhlasu ne.</p></li>
<li><h2>Změny tohoto textu</h2><p>[DOPLNIT].</p></li>
</ol>`,
  });
  const pravidla = docPage({
    css, preload,
    title: "Pravidla zveřejňování příběhů — Nadbytečná.cz",
    desc: "Příběh zveřejníme jen se samostatným souhlasem se zveřejněním.",
    banner: true,
    body: `<h1>Pravidla zveřejňování příběhů</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<ol class="principles">
<li><p>Příběh zveřejníme jen tehdy, když k tomu dáš souhlas zvlášť. Souhlas se zpracováním údajů a souhlas se zveřejněním příběhu jsou dvě různé věci.</p></li>
<li><p>Souhlas se zpracováním na zveřejnění nestačí.</p></li>
<li><p>Když zvolíš anonymní sdílení, jméno u příběhu neuvedeme. E-mail u záznamu zůstane, abychom se ti ozvali.</p></li>
<li><p>Citlivé pasáže před zveřejněním: [ROZHODNOUT].</p></li>
<li><p>Stažení zveřejněného příběhu: [DOPLNIT].</p></li>
<li><p>Nabídku pomoci zatím nezveřejňujeme. Souhlas se zveřejněním nabídky je skrytý. [ROZHODNOUT].</p></li>
<li><p>Kdo zveřejnění schvaluje: [ROZHODNOUT].</p></li>
<li><p>Kde se příběh objeví: [DOPLNIT].</p></li>
<li><p>Úpravy textu před zveřejněním: [ROZHODNOUT].</p></li>
<li><p>Zveřejnění je jen pro lidi od 18 let.</p></li>
</ol>`,
  });
  const aboutBody = `<h1>O nás</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<p>Nadbytečná.cz je místo Věry Komárové pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci.</p>
<p>Není to krizová linka. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Věra Komárová, fyzická osoba. Adresa: doplníme. IČ: doplníme.</p>`;
  const oNas = docPage({
    css, preload,
    title: "O nás — Nadbytečná.cz",
    desc: "Nadbytečná.cz vede Věra Komárová. Není to krizová linka.",
    body: aboutBody,
  });
  const verin = docPage({
    css, preload,
    title: "Věřin příběh — Nadbytečná.cz",
    desc: "Osobní výpověď Věry Komárové připravujeme.",
    body: `<h1>Věřin příběh</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<aside class="placeholder"><p>Tady bude osobní výpověď Věry Komárové. Čekáme na její text.</p></aside>`,
  });
  const kontakty = docPage({
    css, preload,
    title: "Prověřené kontakty — Nadbytečná.cz",
    desc: "Prověřené právní a wellbeing kontakty připravujeme.",
    body: `<h1>Prověřené kontakty</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<div class="contact-cols">
<article class="slot"><h2>Právní</h2><p>připravujeme</p></article>
<article class="slot"><h2>Wellbeing</h2><p>připravujeme</p></article>
</div>`,
  });
  const cookies = docPage({
    css, preload,
    title: "Cookies — Nadbytečná.cz",
    desc: "Analytické a marketingové cookies se načtou jen po souhlasu.",
    body: `<h1>Cookies</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<p>Nezbytné cookies drží jen to, co web potřebuje k zobrazení. Analytické a marketingové cookies (GA4, Google Ads, Meta Pixel, TikTok Pixel) se načtou jen po souhlasu.</p>
<p>Bez souhlasu se žádná z těchto značek nespustí. Volbu můžeš kdykoli změnit.</p>
<p><button type="button" class="textlink" id="cookie-settings">Nastavení cookies</button></p>
<p>Podrobnosti o zpracování údajů jsou v <a href="/ochrana-osobnich-udaju/">ochraně osobních údajů</a>.</p>`,
  });
  const admin = shell({
    css, preload, track: false, chrome: false,
    title: "Přehled — Nadbytečná.cz",
    desc: "Přehled příběhů a nabídek pomoci.",
    main: `<article class="doc" id="admin">
<h1>Přehled</h1>
<div id="admin-login">
<p>Přihlášení přijde e-mailem jako magic link. Účet musí být v seznamu administrátorů.</p>
<div class="field"><label class="lbl" for="admin-email">E-mail</label><input id="admin-email" type="email" autocomplete="username" inputmode="email" maxlength="254"></div>
<button type="button" class="send" id="admin-send">Poslat odkaz</button>
</div>
<div id="admin-app" hidden>
<div class="modes" role="tablist" aria-label="Co zobrazit">
<button type="button" id="tab-stories" role="tab" aria-selected="true">Příběhy</button>
<button type="button" id="tab-help" role="tab" aria-selected="false">Nabídky pomoci</button>
</div>
<button type="button" id="admin-filters-open" class="filters-open">Filtry</button>
<div id="admin-filters" class="admin-filters">
<label class="lbl" for="admin-q">Hledat</label>
<input id="admin-q" type="search" placeholder="Hledat v textu">
<label class="lbl" for="admin-named">Jméno</label>
<select id="admin-named"><option value="">Vše</option><option value="named">se jménem</option><option value="anon">anonymně</option></select>
<label class="lbl" for="admin-publish">Zveřejnění</label>
<select id="admin-publish"><option value="">Vše</option><option value="yes">chce zveřejnit</option><option value="no">nechce zveřejnit</option></select>
<label class="lbl" for="admin-helpflag">Pomoc</label>
<select id="admin-helpflag"><option value="">Vše</option><option value="yes">chce i pomáhat</option></select>
<label class="lbl" for="admin-voice">Podoba</label>
<select id="admin-voice"><option value="">Vše</option><option value="text">text</option><option value="voice">hlas</option></select>
<label class="lbl" for="admin-category">Kategorie</label>
<select id="admin-category"></select>
<label class="lbl" for="admin-urgency">Naléhavost</label>
<select id="admin-urgency"><option value="">Vše</option><option value="acute">akutní</option><option value="watch">k hlídání</option><option value="none">běžné</option></select>
<label class="lbl" for="admin-filter-status">Stav</label>
<select id="admin-filter-status">
<option value="">Všechny stavy</option>
<option value="new">nový</option>
<option value="read">přečtený</option>
<option value="in_progress">v řešení</option>
<option value="resolved">vyřešený</option>
<option value="published">zveřejněný</option>
</select>
<button type="button" id="admin-csv">Export CSV</button>
<button type="button" id="admin-out">Odhlásit</button>
<button type="button" id="admin-filters-close" class="filters-open">Zavřít</button>
</div>
<p id="admin-count"></p>
<div id="admin-cards"></div>
<div id="admin-detail" hidden></div>
</div>
<p class="form-msg" id="admin-msg" role="status"></p>
</article>`,
    script: `<script src="/admin.js" defer></script>`,
  });
  const soon = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Nadbytečná.cz — spouštíme 11. 11. 2026</title>
<meta name="description" content="11. 11. 2026 spouštíme Nadbytečná.cz. Zanechte e-mail a o spuštění se dozvíte jako první.">
<meta name="theme-color" content="#F4CCD8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="googlebot" content="noindex, nofollow, noarchive">
<link rel="canonical" href="https://nadbytecna.cz/">
<meta property="og:title" content="Nadbytečná.cz — spouštíme 11. 11. 2026">
<meta property="og:description" content="11. 11. 2026 spouštíme Nadbytečná.cz. Zanechte e-mail a o spuštění se dozvíte jako první.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://nadbytecna.cz/">
<meta property="og:image" content="https://nadbytecna.cz/og-v2.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Nadbytečná.cz. Žádná žena není nadbytečná.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Nadbytečná.cz — spouštíme 11. 11. 2026">
<meta name="twitter:description" content="11. 11. 2026 spouštíme Nadbytečná.cz. Zanechte e-mail a o spuštění se dozvíte jako první.">
<meta name="twitter:image" content="https://nadbytecna.cz/og-v2.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${preload}
<style>${css}</style>
</head>
<body data-page="soon">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="page">
<main id="obsah" class="soon">
<div class="brand">
<img class="logo" src="/img/nadbytecna-lockup.svg" ${logoAttrs} fetchpriority="high" decoding="async">
<div class="rule" aria-hidden="true">${heart}</div>
</div>
<h1 class="soon-date">Spouštíme 11. 11. 2026</h1>
<p class="soon-note">Zanechte nám e-mail a o spuštění se dozvíte jako první.</p>
<form id="brzy-form" novalidate>
<div class="hp" aria-hidden="true"><label>Web<input id="brzy-hp" type="text" tabindex="-1" autocomplete="off"></label></div>
<div class="field"><label class="lbl" for="brzy-email">E-mail</label><input id="brzy-email" type="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="Váš e-mail" required></div>
<div class="consent">
<input id="brzy-gdpr" type="checkbox" required>
<label for="brzy-gdpr">Souhlasím se zasláním zprávy o spuštění platformy. <a href="/zasady/">Zásady</a>.</label>
</div>
<p class="form-msg" id="brzy-msg" role="alert"></p>
<button type="submit" class="send" id="brzy-send">Chci být u toho</button>
</form>
<div class="thanks" id="brzy-thanks" hidden>
<p>Děkujeme. 11. 11. se vám ozveme jako prvním.</p>
</div>
<p class="soon-mail"><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p><button type="button" class="textlink" id="cookie-settings" hidden>Nastavení cookies</button></p>
</main>
</div>
<script src="/config.js" defer></script>
<script src="/cookies.js" defer></script>
<script src="/launch-form.js" defer></script>
<script src="/fluid.js" defer></script>
</body>
</html>
`;
  return {
    pages: {
      "/": home({ css, preload, heart, logoAttrs }),
      "/coming-soon/": soon,
      "/sdilet-pribeh/": sdilet,
      "/mohu-pomoci/": pomoc,
      "/potrebuji-pomoc/": potrebuji,
      "/verin-pribeh/": verin,
      "/o-nas/": oNas,
      "/proverene-kontakty/": kontakty,
      "/cookies/": cookies,
      "/ochrana-osobnich-udaju/": ochrana,
      "/zasady/": ochrana,
      "/pravidla-zverejnovani/": pravidla,
      "/kontakt/": oNas,
      "/admin/": admin,
    },
    robots: "User-agent: *\nDisallow: /\n",
    llms: `# Nadbytečná.cz

Místo pro ženy, které si prošly něčím podobným. Sdílej příběh, nebo nabídni pomoc.

- [Úvod](/)
- [Věřin příběh](/verin-pribeh/)
- [Prověřené kontakty](/proverene-kontakty/)
- [O nás](/o-nas/)
- [Sdílej svůj příběh](/sdilet-pribeh/)
- [Mohu pomoci](/mohu-pomoci/)
- [Potřebuji pomoc](/potrebuji-pomoc/)
- [Ochrana osobních údajů](/ochrana-osobnich-udaju/)
- [Cookies](/cookies/)
- [Pravidla zveřejňování příběhů](/pravidla-zverejnovani/)
`,
  };
}
