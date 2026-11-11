import { adminHtml } from './admin-html.mjs';
import { webAnalyticsHtml } from './web-analytics.js';
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
    : "Souhlasím se zpracováním údajů, aby se mi nadbytečná ozvala.";
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
<div class="consent"><input id="${prefix}-age" type="checkbox"${off}><label for="${prefix}-age">Je mi 18 a více let.</label></div>
${hiddenPublish}
<p class="hint" id="${prefix}-gdpr-hint">Správce osobních údajů je Nadbytečná z. ú. Formulář je pro lidi od 18 let.</p>
</fieldset>
<p class="form-msg" id="${prefix}-msg" role="alert"></p>
<button type="button" class="send" id="${prefix}-send"${off}>Odeslat</button>
<div class="thanks" id="${prefix}-thanks" hidden>
<h2>Děkujeme.</h2>
<p id="${prefix}-thanks-text"></p>
</div>`;
}

let INDEXABLE = false;

function head({ css, preload, title, desc, extraHead = "" }) {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#F4CCD8">
<meta name="referrer" content="no-referrer">
${INDEXABLE ? '<meta name="robots" content="index, follow, max-image-preview:large">' : '<meta name="robots" content="noindex, nofollow, noarchive">\n<meta name="googlebot" content="noindex, nofollow, noarchive">'}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="cs_CZ">
<link rel="canonical" href="https://nadbytecna.cz/">
<meta property="og:url" content="https://nadbytecna.cz/">
<meta property="og:image" content="https://nadbytecna.cz/og-v4.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="nadbytečná. Pro všechny ženy, které poznaly zradu. Společně najdeme sílu znovu vzlétnout.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://nadbytecna.cz/og-v4.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${preload}
<style>${css}</style>${extraHead}
${webAnalyticsHtml}
</head>`;
}

let SHOW_LEGAL = true;
let DRAFT_MARK = false;
let LOGO = "";
// Až budou skutečné kontakty, přepni na true: vrátí položku menu, stránku i odkaz v sitemapě.
const SHOW_CONTACTS = false;

function footerAdmin() {
  const legal = SHOW_LEGAL
    ? `<li><a href="/ochrana-osobnich-udaju/">Ochrana osobních údajů</a></li>
<li><a href="/pravidla-zverejnovani/">Pravidla zveřejňování příběhů</a></li>`
    : "";
  return `<footer class="foot">
<img class="dom" src="/img/nadbytecna-script-v2.svg" width="1802" height="517" alt="nadbytečná">
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Nadbytečná z. ú. Adresa: Lázeňská 9, Praha 1. IČ: 30254442.</p>
<p class="foot-shop"><a id="eshop-link" href="${home ? "#parfem" : "/#parfem"}">Předprodej parfému</a></p>
<ul class="foot-links">
${legal}
<li><a href="/kontakt/">Kontakt</a></li>
<li><button type="button" class="textlink" id="cookie-settings" hidden>Nastavení cookies</button></li>
</ul>
</footer>`;
}

function header(home = false) {
  return `<header class="site-head">
<a class="site-mark" href="/" aria-label="nadbytečná"><img class="wordmark" src="/img/nadbytecna-script-v2.svg" width="1802" height="517" alt="" decoding="async"></a>
<input class="nav-toggle" id="nav-toggle" type="checkbox">
<label class="nav-burger" for="nav-toggle">Menu</label>
<nav class="site-nav" aria-label="Hlavní">
<a href="/verin-pribeh/">Příběh Věry</a>
${SHOW_CONTACTS ? `<a href="/proverene-kontakty/">Prověřené kontakty</a>\n` : ""}<a href="/o-nas/">O nás</a>
<a class="nav-shop" href="${home ? "#parfem" : "/#parfem"}">Předprodej parfému</a>
</nav>
<a class="top-cta" href="/sdilet-pribeh/">Chci sdílet svůj příběh</a>
</header>`;
}

function footer(home = false) {
  const legal = SHOW_LEGAL
    ? `<li><a href="/ochrana-osobnich-udaju/">Ochrana osobních údajů</a></li>
<li><a href="/cookies/">Cookies</a></li>
<li><a href="/pravidla-zverejnovani/">Pravidla zveřejňování příběhů</a></li>`
    : "";
  return `<footer class="foot">
<img class="dom" src="/img/nadbytecna-script-v2.svg" width="1802" height="517" alt="nadbytečná">
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Nadbytečná z. ú. Adresa: Lázeňská 9, Praha 1. IČ: 30254442.</p>
<p>V případě akutního nebezpečí volejte linku 112.</p>
<ul class="foot-links">
${legal}
<li><a href="/o-nas/">O nás</a></li>
<li><button type="button" class="textlink" id="cookie-settings" hidden>Nastavení cookies</button></li>
</ul>
</footer>`;
}

function sos() {
  return `<details class="sos">
<summary>Okamžitá pomoc</summary>
<p>V případě akutního nebezpečí volejte linku <a href="tel:112">112</a>.</p>
</details>`;
}

// Formulářové podstránky: stejný jazyk jako úvod (scéna na pozadí, hlavička, karta s formulářem).
// Obsah formuláře se nemění; jen se obalí (nadpis vlevo, formulář na kartě vpravo).
function formLayout(main) {
  const art = main.match(/^<article[^>]*>\s*/);
  const h1 = main.indexOf("</h1>");
  if (!art || h1 < 0) return main;
  const introEnd = main.indexOf("</p>", h1) + 4;
  let rest = main.slice(introEnd);
  const close = rest.lastIndexOf("</article>");
  const tailEnd = close >= 0 ? rest.slice(close) : "";
  if (close >= 0) rest = rest.slice(0, close);
  return `${art[0]}<div class="fp-head">${main.slice(art[0].length, introEnd)}</div>\n<div class="fp-card">${rest}</div>\n${tailEnd || "</article>"}`;
}

function shell({ css, preload, title, desc, main, script = "", track = true, chrome = true, form = false }) {
  const base = `<script src="/config.js" defer></script>\n${track ? `<script src="/cookies.js" defer></script>\n` : ""}`;
  if (form) {
    return `${head({ css, preload, title, desc, extraHead: `\n<link rel="stylesheet" href="/scroll.css">` })}
<body data-page="scroll" data-form data-scene="3">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="sc-scenes" aria-hidden="true"><i class="sc-scene sc-scene--3"></i></div>
<div class="page">
${header()}
<main id="obsah" class="main main-top">
${formLayout(main)}
</main>
${footer()}
</div>
${base}${script}<script src="/scroll.js" defer></script>
</body>
</html>
`;
  }
  const top = chrome ? header() : "";
  const foot = chrome ? footer() : footerAdmin();
  const help = "";
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

function claim(lead) {
  return `<li class="claim"><span class="claim-lead">${lead}</span><img class="claim-word" src="/img/nadbytecna-word-v2.svg" width="2024" height="536" alt="nadbytečná"></li>`;
}

function home({ css, preload, heart, logoAttrs }) {
  const main = `<div class="hero">
<div class="hero-copy">
<div class="brand">
<img class="logo" src="/img/nadbytecna-script-v2.svg" ${logoAttrs} fetchpriority="high" decoding="async">
</div>
<div class="content">
<h1>Žádná žena není nadbytečná.</h1>
<p class="lead">Místo pro ženy, které si prošly něčím podobným, a pro ty, kdo jim chtějí pomoci.</p>
</div>
</div>
<aside class="claims" aria-label="Hesla">
<ol class="claim-list">
${claim("Nejsi")}
${claim("Žádná žena není")}
${claim("Krása není")}
${claim("Žádná práce není")}
${claim("Žádná láska není")}
${claim("Never")}
</ol>
<div class="rule claim-rule" aria-hidden="true">${heart}</div>
</aside>
</div>
<div class="split">
<section class="block" id="pribeh" aria-labelledby="pribeh-h">
<h2 id="pribeh-h">Příběh Věry</h2>
<a class="vid" href="/verin-pribeh/" data-video-open aria-label="Přehrát Příběh Věry, video, 54 sekund">
<picture>
<source srcset="/video/vera-pribeh-poster-v16.webp" type="image/webp">
<img src="/video/vera-pribeh-poster-v16.jpg" width="540" height="960" alt="Věra Komárová na plese" loading="lazy" decoding="async">
</picture>
<span class="vid-play" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg></span>
<span class="vid-meta" aria-hidden="true">Přehrát · 0:54</span>
</a>
</section>
<div class="choices">
<a class="choice" href="/sdilet-pribeh/"><span class="choice-title">Sdílej svůj příběh</span><span class="choice-note">Napiš ho, nebo nahraj hlas.</span></a>
<a class="choice" href="/mohu-pomoci/"><span class="choice-title">Mohu pomoci</span><span class="choice-note">Nabídni práci, péči, nebo se přidej.</span></a>
</div>
</div>
<section class="block goal" id="cil" aria-labelledby="cil-h">
<h2 id="cil-h">Změnit systém</h2>
<p>Více ochrany našimi zákony pro ženy, manželky, partnerky, matky a podnikatelky.</p>
</section>
<aside class="vera-strip">
<picture>
<source srcset="/img/parfem-nadbytecna.webp" type="image/webp">
<img src="/img/parfem-nadbytecna.jpg" width="1152" height="864" alt="Lahvička parfému nadbytečná" loading="lazy" decoding="async">
</picture>
<div>
<h2>Podpořte platformu nadbytečná předobjednáním parfému!</h2>
<p>Dodání do Vánoc!</p>
<p class="vera-note">Expedujeme v týdnu od 14. 12.</p>
<a class="vera-cta" href="https://veryvera22.cz" rel="noopener noreferrer">Předobjednat parfém</a>
</div>
</aside>`;
  return shell({
    css, preload,
    title: "nadbytečná",
    desc: "Žádná žena není nadbytečná. Místo pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci. Sdílejte příběh, nebo nabídněte pomoc.",
    main,
    script: `<script src="/fluid.js" defer></script>\n<script src="/video.js" defer></script>`,
  });
}

// Úvodní strana jako scroll-cesta: pět kapitol (úvod, hesla, příběh, cesty, e-shop a pomoc).
// Obsah, video a odkazy jsou stejné jako v home(); mění se jen rozvržení a pohyb (scroll.css, scroll.js).
// Bez JavaScriptu nebo při „omezit pohyb“ je to obyčejná stránka pod sebou.
function homeScroll({ css, preload, heart, logoAttrs }) {
  const line = (lead) => `<li class="claim sc-line"><span class="claim-lead">${lead}</span><img class="claim-word" src="/img/nadbytecna-word-lc-v2.svg" width="1802" height="517" alt="nadbytečná"></li>`;
  const dots = [["uvod", "Úvod"], ["pribeh", "Příběh Věry"], ["manifest", "Hesla"], ["cesty", "Zapoj se"], ["parfem", "Parfém"]]
    .map(([id, label]) => `<a href="#${id}"><span>${label}</span></a>`).join("\n");
  const main = `<div class="sc-hero" id="uvod" data-chapter="0" role="region" aria-label="Úvod">
<div class="hero-copy">
<div class="brand">
<img class="logo" src="/img/nadbytecna-script-v2.svg" ${logoAttrs} fetchpriority="high" decoding="async">
</div>
<div class="content">
<h1><span>Pro všechny ženy, které poznaly zradu.</span> <span>Společně najdeme sílu znovu vzlétnout.</span></h1>
</div>
</div>
</div>
<div class="sc-chapter" data-chapter="1">
<section class="block sc-rise" id="pribeh" aria-labelledby="pribeh-h">
<h2 id="pribeh-h">Příběh Věry</h2>
<a class="vid" href="/verin-pribeh/" data-video-open aria-label="Přehrát Příběh Věry, video, 54 sekund">
<picture>
<source srcset="/video/vera-pribeh-poster-v16.webp" type="image/webp">
<img src="/video/vera-pribeh-poster-v16.jpg" width="540" height="960" alt="Věra Komárová na plese" loading="lazy" decoding="async">
</picture>
<span class="vid-play" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg></span>
<span class="vid-meta" aria-hidden="true">Přehrát · 0:54</span>
</a>
<div class="pribeh-text">
<p>Pouze 11 minut stačilo mému manželovi, aby mě označil za nadbytečnou ve firmě, kterou jsme spolu 24 let budovali. Vypnutý email, zákaz vstupu do kanceláře. Svět se zastavil, srdce naštěstí ne. Pro Dermacol jsem dýchala drtivou část mého profesního života. Je to mé první dítě. Vymýšlela jsem nové výrobky, tlačila marketing a nebrala za to ani vzdáleně mzdu, kterou měli ostatní členové vedení.</p>
<p>Po několika dnech jsem v podcastu Všechno začíná dnes Petra Šimůnka dostala otázku na Dermacol: „Milý Petře, prý jsem tam nadbytečná.“ Bývalý šéfredaktor časopisu Forbes mi nevěřil: „Jak to myslíš, nadbytečná? Vždyť Ty jsi Dermacol!“ Jeho podcast vyšel v den úplňku a do 24 hodin mělo hlavní sdělení 600 tisíc shlédnutí. Články o mé nadbytečnosti následně vyšly snad ve všech médiích. Kauza byla veřejná.</p>
<p>Co nebylo vidět, byla obrovská vlna podpory: tisíce zpráv, skoro všechny výhradně od žen. Dostávají se ke mně stovky podobných příběhů, kdy manželé či partneři nekompromisně vyhodili své partnerky ze společného podnikání. Všechno jim vzali. Jako mně.</p>
<p>Já ale nedokážu netvořit, zastavit se a dívat se do zdi. Vždyť je to můj život: celých 24 let vymýšlím, inspiruji se, hledám, co budou ženy milovat.</p>
<p>Proto uvádím na trh novou vůně VERY VERA nadbytečná. Vzdor? Možná. Ale proč my ženy, matky, manželky, partnerky, podnikatelky nejsme v našem státě ochráněny a můžeme být kdykoliv označeny za nadbytečné. Proč jsme v takové situaci prakticky bez pomoci? Proč se v Itálii, Francii, Anglii, Německu či USA muži k ženám takto chovat nemohou? Pojďme to změnit, pomoct ženám, které jsou v takové situaci a zlepšit prostředí, kde je ve společné firmě možné označit ženu za pár minut za nadbytečnou.</p>
</div>
</section>
</div>
<div class="sc-manifest" id="manifest" data-chapter="2" role="region" aria-label="Hesla">
<div class="sc-stage">
<aside class="claims" aria-label="Hesla">
<ol class="claim-list">
${line("Nejsi")}
${line("Žádná žena není")}
${line("Krása není")}
${line("Žádná práce není")}
${line("Žádná láska není")}
${line("Never")}
</ol>
<div class="rule claim-rule" aria-hidden="true">${heart}</div>
</aside>
<p class="sc-count" aria-hidden="true">01 / 06</p>
</div>
</div>
<div class="sc-chapter" id="cesty" data-chapter="3">
<div class="sc-paths sc-rise">
<div class="choices">
<a class="choice" href="/sdilet-pribeh/"><span class="choice-title">Sdílej svůj příběh</span><span class="choice-note">Napiš ho, nebo nahraj hlas.</span></a>
<a class="choice" href="/mohu-pomoci/"><span class="choice-title">Mohu pomoci</span><span class="choice-note">Nabídni práci, péči, nebo se přidej.</span></a>
<a class="choice choice-shop" id="cil" href="#parfem"><span class="choice-title">Předprodej parfému</span><span class="choice-note">Podpoř platformu a předobjednej parfém nadbytečná.</span></a>
</div>
</div>
</div>
<div class="sc-chapter sc-chapter--end" data-chapter="4">
<div class="sc-rise" id="parfem">
<aside class="vera-strip">
<picture>
<source srcset="/img/parfem-nadbytecna.webp" type="image/webp">
<img src="/img/parfem-nadbytecna.jpg" width="1152" height="864" alt="Lahvička parfému nadbytečná" loading="lazy" decoding="async">
</picture>
<div>
<h2>Podpořte platformu nadbytečná předobjednáním parfému!</h2>
<p>Dodání do Vánoc!</p>
<p class="vera-note">Expedujeme v týdnu od 14. 12.</p>
<a class="vera-cta" href="https://veryvera22.cz" rel="noopener noreferrer">Předobjednat parfém</a>
</div>
</aside>
</div>
</div>`;
  return `${head({
    css, preload,
    title: "nadbytečná",
    desc: "Žádná žena není nadbytečná. Místo pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci. Sdílejte příběh, nebo nabídněte pomoc.",
    extraHead: `\n<link rel="stylesheet" href="/scroll.css">`,
  })}
<body data-page="scroll" data-scene="0">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="sc-scenes" aria-hidden="true"><i class="sc-scene sc-scene--0"></i><i class="sc-scene sc-scene--1"></i><i class="sc-scene sc-scene--2"></i><i class="sc-scene sc-scene--3"></i><i class="sc-scene sc-scene--4"></i></div>
<div class="page">
${header(true)}
<nav class="sc-dots" aria-label="Kapitoly">
${dots}
</nav>
<main id="obsah" class="main main-top">
${main}
</main>
${footer(true)}
</div>
<a class="sc-bar" href="#parfem"><span>Parfém nadbytečná</span><i aria-hidden="true">↓</i></a>
<script src="/config.js" defer></script>
<script src="/cookies.js" defer></script>
<script src="/fluid.js" defer></script>
<script src="/video.js" defer></script>
<script src="/scroll.js" defer></script>
</body>
</html>
`;
}

function docPage({ css, preload, title, desc, body, banner = false }) {
  const mark = banner && DRAFT_MARK ? `<p class="draft">Návrh</p>` : "";
  const main = `<article class="doc">
${mark}
${body}
</article>`;
  return shell({ css, preload, title, desc, main });
}

function plainPage({ css, preload, title, desc, main, script = "", form = false }) {
  return shell({ css, preload, title, desc, main, script, form });
}

export function renderPhase1({ css, preload, heart, logoAttrs, draft = true, index = false }) {
  INDEXABLE = index === true;
  SHOW_LEGAL = draft !== false;
  DRAFT_MARK = draft !== false;
  LOGO = logoAttrs;
  const sdilet = plainPage({
    form: true,
    css, preload,
    title: "Sdílej svůj příběh — nadbytečná",
    desc: "Napiš příběh, nahraj hlasovou zprávu, nebo přilož audio.",
    main: `<article class="doc" id="story-form">
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<h1>Sdílej svůj příběh</h1>
<p>Napiš ho, nahraj hlasovou zprávu, nebo přilož audio. Hlasovou zprávu uložíme k příběhu, abychom si ji mohli poslechnout. Automatický přepis nyní neprobíhá.</p>
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
<p class="hint">Hlasovou zprávu uložíme k příběhu, abychom si ji mohli poslechnout. Automatický přepis nyní neprobíhá.</p>
<div class="rec-row">
<button type="button" class="rec-btn" id="mic-start"><span class="rec-dot" aria-hidden="true"></span><span class="rec-label">Spustit nahrávání</span></button>
<button type="button" class="rec-btn is-live" id="mic-stop" hidden><span class="rec-dot" aria-hidden="true"></span><span class="rec-label">Zastavit nahrávání</span><span class="rec-time" id="mic-time">0:00</span></button>
</div>
<p id="mic-status" class="hint" role="status"></p>
<audio id="mic-player" controls hidden playsinline></audio>
<div class="rec-row" id="mic-actions" hidden>
<button type="button" id="mic-again">Nahrát znovu</button>
<button type="button" id="mic-delete">Smazat</button>
</div>
</div>
<div role="tabpanel" id="mode-file" aria-labelledby="tab-file" hidden>
<p class="hint">Audio soubor, třeba .m4a z iPhonu. Nejvýš 50 MB. Hlasovou zprávu uložíme k příběhu, abychom si ji mohli poslechnout. Automatický přepis nyní neprobíhá.</p>
<button type="button" class="drop" id="file-drop">
<svg class="drop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V5M12 5l-4 4M12 5l4 4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
<span>Přetáhněte soubor sem nebo vyberte v počítači</span>
</button>
<input id="audio-file" class="drop-input" type="file" accept="audio/*,.m4a,.mp3,.aac,.wav,.caf,.ogg,.webm,audio/mp4,audio/mpeg,audio/aac,audio/wav,audio/x-m4a">
<div class="file-picked" id="file-picked" hidden>
<span id="file-name"></span>
<button type="button" id="file-clear">Odebrat</button>
</div>
<p id="file-status" class="hint" role="status"></p>
<audio id="file-player" controls hidden playsinline></audio>
</div>
<div class="hp" aria-hidden="true"><label>Web<input id="sdilet-hp" type="text" tabindex="-1" autocomplete="off"></label></div>
<p class="hint">Formulář je pro lidi od 18 let. Žádný souhlas není předzaškrtnutý.</p>
<div class="consent">
<input id="sdilet-gdpr" type="checkbox" aria-describedby="sdilet-gdpr-hint">
<label for="sdilet-gdpr">Souhlasím se zpracováním příběhu včetně citlivých údajů o zdraví nebo násilí, pokud je v příběhu uvedu. Povinné.</label>
</div>
<div class="consent"><input id="sdilet-age" type="checkbox"><label for="sdilet-age">Je mi 18 a více let.</label></div>
<div id="sdilet-consent-transcript" hidden>
<div class="consent">
<input id="sdilet-prepis" type="checkbox">
<label for="sdilet-prepis">Souhlasím s případným budoucím přepisem hlasové zprávy na text. Přepis nyní neprobíhá. U audia povinné.</label>
</div>
</div>
<div class="consent">
<input id="sdilet-zverejneni" type="checkbox">
<label for="sdilet-zverejneni">Chci svůj příběh zveřejnit</label>
</div>
<p class="hint" id="sdilet-gdpr-hint">Správce osobních údajů je Nadbytečná z. ú. Souhlas se zpracováním není souhlas se zveřejněním.</p>
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
    form: true,
    css, preload,
    title: "Mohu pomoci — nadbytečná",
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
    form: true,
    css, preload,
    title: "Potřebuji pomoc — nadbytečná",
    desc: "Napiš, s čím potřebuješ pomoct. Není to krizová linka.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<h1>Potřebuji pomoc</h1>
<p>Napiš, s čím potřebuješ pomoct. Ozveme se na e-mail, který uvedeš. Není to krizová linka. V případě akutního nebezpečí volejte linku 112.</p>
<h2 id="potrebuji-h">Formulář: Potřebuji pomoc</h2>
<fieldset disabled aria-labelledby="potrebuji-h">
${["jmeno", "osloveni", "email", "telefon", "text"].map((key) => field("potrebuji", key === "text" ? ["text", "textarea", "S čím potřebuješ pomoct", "", "off", "text", "true"] : FIELDS.find((f) => f[0] === key), false)).join("\n")}
${tail("potrebuji")}`,
  });
  const ochrana = docPage({
    css, preload,
    title: "Ochrana osobních údajů — nadbytečná",
    desc: "Kdo je správce a k čemu jsou údaje z formulářů na nadbytečná.",
    banner: true,
    body: `<h1>Ochrana osobních údajů</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<ol class="principles">
<li><h2>Správce</h2><p>Správce osobních údajů je Nadbytečná z. ú., Lázeňská 9, Praha 1, IČ 30254442.</p></li>
<li><h2>Kontakt</h2><p>Kontaktní e-mail: <a href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a>. Adresa: Lázeňská 9, Praha 1.</p></li>
<li><h2>Věk</h2><p>Web a formuláře jsou pro lidi od 18 let.</p></li>
<li><h2>Jaké údaje</h2><p>Jméno, e-mail, volitelně telefon, text příběhu, hlas, přepis, nabídka pomoci a odkazy, které člověk sám uvede. Údaje o zdraví a o násilí jsou zvláštní kategorie a zpracovávají se jen se souhlasem se zpracováním příběhu.</p></li>
<li><h2>Účel a právní základ</h2><p>Aby se nadbytečná ozvala a věděla, s čím se člověk přidává. Zveřejnění je samostatný souhlas. Právní základ u ostatních operací: [ROZHODNOUT].</p></li>
<li><h2>Kdo údaje čte</h2><p>Příběhy čte Věra Komárová a Michal Baturko [OVĚŘIT formulaci].</p></li>
<li><h2>Zpracovatelé</h2><p>Vercel Inc. (hosting), Supabase (EU, Frankfurt), OpenAI (případný budoucí přepis hlasu, nyní vypnutý; USA – [OVĚŘIT předání mimo EU]), Resend (e-maily).</p></li>
<li><h2>Jak dlouho</h2><p>Navržená lhůta pro audio je 30 dní po případném přepisu; přepis a automatické mazání nyní neprobíhají. Nezveřejněný příběh držíme 12 měsíců. Nabídku pomoci držíme 24 měsíců. Zveřejněný příběh: [ROZHODNOUT].</p></li>
<li><h2>Práva</h2><p>Přístup, oprava, výmaz, omezení, odvolání souhlasu a stížnost u Úřadu pro ochranu osobních údajů. Postup: napiš na veryvera@nadbytecna.cz, odpovíme do jednoho měsíce.</p></li>
<li><h2>Kdy je souhlas nutný</h2><p>Bez souhlasu se zpracováním příběhu, a u audia bez souhlasu s přepisem, se příběh neuloží. Bez souhlasu se zpracováním nabídky se nabídka neuloží. Souhlas se zveřejněním příběhu povinný není.</p></li>
<li><h2>Automatizované rozhodování</h2><p>[ROZHODNOUT].</p></li>
<li><h2>Cookies</h2><p>Web po souhlasu používá analytické a marketingové cookies (GA4, Google Ads, Meta Pixel, TikTok Pixel), bez souhlasu ne.</p></li>
<li><h2>Změny tohoto textu</h2><p>Změny zveřejníme na této stránce. Platí znění z 11. 11. 2026.</p></li>
</ol>`,
  });
  const pravidla = docPage({
    css, preload,
    title: "Pravidla zveřejňování příběhů — nadbytečná",
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
<p>nadbytečná je místo Věry Komárové pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci.</p>
<h2>Proč jsme vznikli?</h2>
<blockquote class="why"><p>Protože reakce na šílenou Věřinu story o nadbytečnosti byla neuvěřitelná: „Spousta žen si prošly, prochází u nás podobným dramatem. Ponížení, nedůstojnost, strach, zoufalství, bezmoc, frustrace nás spojuje. Vím, jak dlouho jsem sama bála, jestli to můžu vůbec udělat. Mám vůbec šanci? Co se stane, když? A pak jsem to udělala a dostala stovky zpráv o podobných příbězích. Nejsem sama a vy nejste samy. Pojďme si pomoct.“</p><footer>Věra Komárová</footer></blockquote>
<p>Není to krizová linka. V případě akutního nebezpečí volejte linku 112.</p>
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
`;
  const oNas = docPage({
    css, preload,
    title: "O nás — nadbytečná",
    desc: "nadbytečná vede Věra Komárová. Není to krizová linka.",
    body: aboutBody,
  });
  const verin = docPage({
    css, preload,
    title: "Příběh Věry — nadbytečná",
    desc: "Příběh Věry Komárové ve videu.",
    body: `<h1>Příběh Věry</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<figure class="vid-page">
<video controls playsinline preload="none" width="720" height="1280" poster="/video/vera-pribeh-poster-v16.jpg" aria-label="Příběh Věry, video, 54 sekund">
<source src="/video/vera-pribeh-v16.mp4" type="video/mp4">
<p>Video se v tomto prohlížeči nepřehraje. <a href="/video/vera-pribeh-v16.mp4">Otevřít soubor s videem</a>.</p>
</video>
</figure>
<div class="choices">
<a class="choice" href="/sdilet-pribeh/"><span class="choice-title">Sdílej svůj příběh</span><span class="choice-note">Napiš ho, nebo nahraj hlas.</span></a>
<a class="choice" href="/mohu-pomoci/"><span class="choice-title">Mohu pomoci</span><span class="choice-note">Nabídni práci, péči, nebo se přidej.</span></a>
</div>`,
  });
  const kontakty = docPage({
    css, preload,
    title: "Prověřené kontakty — nadbytečná",
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
    title: "Cookies — nadbytečná",
    desc: "Analytické a marketingové cookies se načtou jen po souhlasu.",
    body: `<h1>Cookies</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<p>Nezbytné cookies drží jen to, co web potřebuje k zobrazení. Analytické a marketingové cookies (GA4, Google Ads, Meta Pixel, TikTok Pixel) se načtou jen po souhlasu.</p>
<p>Bez souhlasu se žádná z těchto značek nespustí. Volbu můžeš kdykoli změnit.</p>
<div id="cookie-detail">
<label class="opt" for="cookie-analytics"><input id="cookie-analytics" type="checkbox"><span>Analytické cookies</span></label>
<label class="opt" for="cookie-marketing"><input id="cookie-marketing" type="checkbox"><span>Marketingové cookies</span></label>
<button type="button" class="send" id="cookie-save">Uložit volbu</button>
</div>
<p>Podrobnosti o zpracování údajů jsou v <a href="/ochrana-osobnich-udaju/">ochraně osobních údajů</a>.</p>`,
  });
  const admin = adminHtml();
  const soon = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>nadbytečná — spouštíme 11. 11. 2026</title>
<meta name="description" content="11. 11. 2026 spouštíme nadbytečnou. Zanechte e-mail a o spuštění se dozvíte jako první.">
<meta name="theme-color" content="#F4CCD8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="googlebot" content="noindex, nofollow, noarchive">
<link rel="canonical" href="https://nadbytecna.cz/">
<meta property="og:title" content="nadbytečná — spouštíme 11. 11. 2026">
<meta property="og:description" content="11. 11. 2026 spouštíme nadbytečnou. Zanechte e-mail a o spuštění se dozvíte jako první.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://nadbytecna.cz/">
<meta property="og:image" content="https://nadbytecna.cz/og-v4.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="nadbytečná. Pro všechny ženy, které poznaly zradu. Společně najdeme sílu znovu vzlétnout.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="nadbytečná — spouštíme 11. 11. 2026">
<meta name="twitter:description" content="11. 11. 2026 spouštíme nadbytečnou. Zanechte e-mail a o spuštění se dozvíte jako první.">
<meta name="twitter:image" content="https://nadbytecna.cz/og-v4.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${preload}
<style>${css}</style>
${webAnalyticsHtml}
</head>
<body data-page="soon">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="page">
<main id="obsah" class="soon">
<div class="brand">
<img class="logo" src="/img/nadbytecna-script-v2.svg" ${logoAttrs} fetchpriority="high" decoding="async">
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
      "/": homeScroll({ css, preload, heart, logoAttrs }),
      "/coming-soon/": soon,
      "/sdilet-pribeh/": sdilet,
      "/mohu-pomoci/": pomoc,
      "/potrebuji-pomoc/": potrebuji.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow, noarchive">'),
      "/verin-pribeh/": verin,
      "/o-nas/": oNas,
      ...(SHOW_CONTACTS ? { "/proverene-kontakty/": kontakty } : {}),
      "/cookies/": cookies,
      "/ochrana-osobnich-udaju/": ochrana,
      "/zasady/": ochrana,
      "/pravidla-zverejnovani/": pravidla,
      "/kontakt/": oNas,
      "/admin/": admin,
    },
    robots: index === true ? "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\n\nSitemap: https://nadbytecna.cz/sitemap.xml\n" : "User-agent: *\nDisallow: /\n",
    llms: `# nadbytečná

Místo pro ženy, které si prošly něčím podobným. Sdílej příběh, nebo nabídni pomoc.

- [Úvod](/)
- [Příběh Věry](/verin-pribeh/)
${SHOW_CONTACTS ? "- [Prověřené kontakty](/proverene-kontakty/)\n" : ""}- [O nás](/o-nas/)
- [Sdílej svůj příběh](/sdilet-pribeh/)
- [Mohu pomoci](/mohu-pomoci/)
- [Ochrana osobních údajů](/ochrana-osobnich-udaju/)
- [Cookies](/cookies/)
- [Pravidla zveřejňování příběhů](/pravidla-zverejnovani/)
`,
  };
}
