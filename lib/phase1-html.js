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
<label class="opt" for="pomoc-zverejneni"><input id="pomoc-zverejneni" type="checkbox" disabled><span>Souhlasím se zveřejněním nabídky. [ROZHODNOUT]</span></label>
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
<meta property="og:image" content="https://nadbytecna.cz/og.jpg">
<meta property="og:image:alt" content="Nadbytečná.cz">
<meta name="twitter:card" content="summary_large_image">
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

function footer() {
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

function shell({ css, preload, title, desc, main, script = "", track = true }) {
  const base = `<script src="/config.js" defer></script>\n${track ? `<script src="/cookies.js" defer></script>\n` : ""}`;
  return `${head({ css, preload, title, desc })}
<body data-page="phase1">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="page">
<main id="obsah" class="main main-top">
${main}
</main>
${footer()}
</div>
${base}${script}
</body>
</html>
`;
}

function home({ css, preload, heart, logoAttrs }) {
  const main = `<div class="hero">
<div class="brand">
<img class="logo" src="/img/nadbytecna-lockup.svg" ${logoAttrs} fetchpriority="high" decoding="async">
<div class="rule" aria-hidden="true">${heart}</div>
</div>
<div class="content">
<h1>Žádná žena není nadbytečná.</h1>
<p class="lead">Místo pro ženy, které si prošly něčím podobným.</p>
<blockquote class="aim"><p>Hlavní cíl - změnit systém - více ochrany našimi zákony pro ženy, manželky, partnerky, matky, podnikatelky.</p></blockquote>
<p class="hint">Cíl, jak ho napsala Věra.</p>
<p>Sdílej příběh, nebo nabídni pomoc. Propojujeme ženy, které si prošly něčím podobným, s lidmi, kteří mohou pomoct.</p>
</div>
</div>
<div class="fork">
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
</div>`;
  return shell({
    css, preload,
    title: "Nadbytečná.cz",
    desc: "Místo pro ženy, které si prošly něčím podobným. Sdílej příběh, nebo nabídni pomoc.",
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
<label class="opt" for="sdilet-help"><input id="sdilet-help" type="checkbox"><span>Chci i pomáhat (být aktivní a podílet se na platformě)</span></label>
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
<label for="sdilet-zverejneni">Souhlasím se zveřejněním příběhu. Není povinné.</label>
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
<p>Povinná je tahle volba. Upřesnění typu pomoci je nepovinné a patří jen k možnosti „Pomáhám takovým lidem“.</p>
<h2 id="pomoc-h">Formulář: Mohu pomoci</h2>
<div id="help-form">
<fieldset aria-labelledby="pomoc-h">
<fieldset class="opts">
<legend>Povinná volba</legend>
<label class="opt"><input type="radio" name="jak" value="lived_experience"><span>Už jsem si tím prošla / prošel</span></label>
<label class="opt"><input type="radio" name="jak" value="professional"><span>Pomáhám takovým lidem</span></label>
</fieldset>
<div class="refine">
<p id="typ-h">Upřesnění typu pomoci. Jen když zvolíš „Pomáhám takovým lidem“. Není povinné.</p>
<div role="group" aria-labelledby="typ-h">
<label class="opt"><input type="checkbox" name="kind" value="prace"><span>práce</span></label>
<label class="opt"><input type="checkbox" name="kind" value="terapie"><span>terapie</span></label>
<label class="opt"><input type="checkbox" name="kind" value="pravni"><span>právní pomoc</span></label>
<label class="opt"><input type="checkbox" name="kind" value="vyrobky"><span>výrobky a služby</span></label>
<label class="opt"><input type="checkbox" name="kind" value="jine"><span>jiné</span></label>
</div>
</div>
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
${contactFields("potrebuji", "S čím potřebuješ pomoct")}
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
  const admin = shell({
    css, preload, track: false,
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
<div class="admin-filters">
<label class="lbl" for="admin-type">Typ</label>
<select id="admin-type"></select>
<label class="lbl" for="admin-filter-status">Stav</label>
<select id="admin-filter-status">
<option value="">Všechny stavy</option>
<option value="new">nové</option>
<option value="read">přečtené</option>
<option value="contacted">kontaktované</option>
<option value="archived">archiv</option>
</select>
<button type="button" id="admin-csv">Export CSV</button>
<button type="button" id="admin-out">Odhlásit</button>
</div>
<p id="admin-count"></p>
<div class="table-wrap">
<table>
<caption>Záznamy</caption>
<thead><tr><th scope="col">Kdy</th><th scope="col">Jméno</th><th scope="col">Typ</th><th scope="col">Stav</th><th scope="col">Akce</th></tr></thead>
<tbody id="admin-rows"></tbody>
</table>
</div>
<div id="admin-detail" hidden></div>
</div>
<p class="form-msg" id="admin-msg" role="status"></p>
</article>`,
    script: `<script src="/admin.js" defer></script>`,
  });
  const kontakt = docPage({
    css, preload,
    title: "Kontakt — Nadbytečná.cz",
    desc: "Napiš na veryvera@nadbytecna.cz. Není to krizová linka.",
    body: `<h1>Kontakt</h1>
<p><a class="backlink" href="/">Zpět na úvod</a></p>
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Věra Komárová, fyzická osoba. Adresa: doplníme. IČ: doplníme.</p>
<p>Není to krizová linka. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>`,
  });
  return {
    pages: {
      "/": home({ css, preload, heart, logoAttrs }),
      "/sdilet-pribeh/": sdilet,
      "/mohu-pomoci/": pomoc,
      "/potrebuji-pomoc/": potrebuji,
      "/ochrana-osobnich-udaju/": ochrana,
      "/pravidla-zverejnovani/": pravidla,
      "/kontakt/": kontakt,
      "/admin/": admin,
    },
    robots: "User-agent: *\nDisallow: /\n",
    llms: `# Nadbytečná.cz

Místo pro ženy, které si prošly něčím podobným. Sdílej příběh, nebo nabídni pomoc.

- [Úvod](/)
- [Sdílej svůj příběh](/sdilet-pribeh/)
- [Mohu pomoci](/mohu-pomoci/)
- [Ochrana osobních údajů](/ochrana-osobnich-udaju/)
- [Pravidla zveřejňování příběhů](/pravidla-zverejnovani/)
- [Kontakt](/kontakt/)
`,
  };
}
