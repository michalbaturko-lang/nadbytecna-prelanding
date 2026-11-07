// Pracovní náhled fáze 1. Žádný formulář, žádné odeslání, žádné úložiště.
// Padající nápis v hero je stejný lockup a stejné fluid.js jako pre-landing.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FIELDS = [
  ["jmeno", "text", "Jméno a příjmení", "", "name", "text", "false"],
  ["osloveni", "text", "Anonymní oslovení (nepovinné, zatím návrh)", "Samo o sobě záznam s e-mailem neanonymizuje.", "off", "text", "false"],
  ["email", "email", "E-mail", "", "email", "email", "false"],
  ["telefon", "tel", "Telefon (nepovinný)", "", "tel", "tel", "false"],
  ["text", "textarea", "Příběh, nabídka služby nebo výrobku", "", "off", "text", "true"],
  ["ig", "url", "Odkaz na Instagram (nepovinný)", "", "url", "url", "false"],
  ["fb", "url", "Odkaz na Facebook (nepovinný)", "", "url", "url", "false"],
  ["eshop", "url", "Odkaz na e-shop (nepovinný)", "", "url", "url", "false"],
  ["web", "url", "Odkaz na web (nepovinný)", "", "url", "url", "false"],
];

function field(prefix, [key, type, label, hint, auto, mode, spell]) {
  const id = `${prefix}-${key}`;
  const hintId = hint ? ` id="${id}-hint"` : "";
  const described = hint ? ` aria-describedby="${id}-hint"` : "";
  const common = `id="${id}"${described} autocomplete="${auto}" spellcheck="${spell}" disabled`;
  const control = type === "textarea"
    ? `<textarea ${common} rows="6"></textarea>`
    : `<input ${common} type="${type}" inputmode="${mode}" maxlength="500">`;
  return `<div class="field"><label class="lbl" for="${id}">${esc(label)}</label>${control}${hint ? `<p class="hint"${hintId}>${esc(hint)}</p>` : ""}</div>`;
}

function contactFields(prefix, textLabel) {
  return FIELDS.map((f) => field(prefix, f[0] === "text" ? ["text", "textarea", textLabel, "", "off", "text", "true"] : f)).join("\n");
}

function tail(prefix) {
  return `<div class="consent">
<input id="${prefix}-gdpr" type="checkbox" disabled aria-describedby="${prefix}-gdpr-hint">
<label for="${prefix}-gdpr">Návrh souhlasu se zpracováním údajů. Není to souhlas se zveřejněním.</label>
</div>
<p class="hint" id="${prefix}-gdpr-hint">Správce osobních údajů je Věra Komárová, fyzická osoba. Právní znění musí potvrdit právnička. Zatím se nic neodesílá ani neukládá.</p>
</fieldset>
<p class="form-off" id="${prefix}-off">Odesílání zatím není spuštěné.</p>
<button type="button" class="send" disabled aria-describedby="${prefix}-off">Spouštíme 11. 11.</button>`;
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${preload}
<style>${css}</style>
</head>`;
}

const FOOT = `<footer class="foot">
<img class="dom" src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná.cz">
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Věra Komárová, fyzická osoba. Adresa: doplníme. IČ: doplníme.</p>
<p class="foot-shop">E-shop Very Vera se připravuje. <a href="https://veryvera.cz" rel="noopener noreferrer">veryvera.cz</a></p>
<ul class="foot-links">
<li><a href="/potrebuji-pomoc/">Potřebuji pomoc</a></li>
<li><a href="/pripravujeme/">Připravujeme</a></li>
<li><a href="/ochrana-osobnich-udaju/">Ochrana osobních údajů (pracovní návrh)</a></li>
<li><a href="/pravidla-zverejnovani/">Pravidla zveřejňování příběhů (pracovní návrh)</a></li>
<li><a href="/kontakt/">Kontakt</a></li>
</ul>
<p>Pracovní náhled. Stránka se neindexuje.</p>
</footer>`;

function shell({ css, preload, title, desc, main, script = "" }) {
  return `${head({ css, preload, title, desc })}
<body data-page="phase1">
<a class="skip" href="#obsah">Přeskočit na obsah</a>
<p class="banner">Pracovní náhled — formuláře zatím nic neodesílají.</p>
<div class="page">
<main id="obsah" class="main main-top">
${main}
</main>
${FOOT}
</div>
${script}
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
<p class="lead">Připravujeme místo pro ženy, které si prošly něčím podobným.</p>
<p class="sub">Připravujeme na 11. 11. 2026.</p>
<blockquote class="aim"><p>Hlavní cíl - změnit systém - více ochrany našimi zákony pro ženy, manželky, partnerky, matky, podnikatelky.</p></blockquote>
<p class="hint">Cíl, jak ho napsala Věra. Není to její osobní výpověď.</p>
<p>Ve druhé fázi má přijít pomoc, poradenství a propojování žen pro nové businessy. To zatím neběží.</p>
<p class="hint">Datum je plán uvedení. Není to hotová pomoc a samo o sobě neotevírá sběr údajů.</p>
</div>
</div>
<div class="fork">
<a class="choice" href="/sdilet-pribeh/"><span class="choice-title">Chci nasdílet svůj příběh</span><span class="choice-note">Jeden formulář pro příběh.</span></a>
<section class="block" id="pribeh" aria-labelledby="pribeh-h">
<h2 id="pribeh-h">Věřin příběh</h2>
<aside class="placeholder">
<p class="kicker">Zástupný blok</p>
<p>Tady bude osobní výpověď Věry Komárové. Čekáme na její text.</p>
<p class="hint">Žádná domyšlená citace, fotografie ani svědectví.</p>
</aside>
</section>
<a class="choice" href="/chci-pomoci/"><span class="choice-title">Chci pomoci</span><span class="choice-note">Jeden formulář. Nejdřív zvolíš, jestli sis tím prošla, nebo pomáháš.</span></a>
</div>`;
  return shell({
    css, preload,
    title: "Nadbytečná.cz — pracovní náhled",
    desc: "Připravujeme místo pro ženy, které si prošly něčím podobným. Pracovní náhled, formuláře nic neodesílají.",
    main,
    script: `<script src="/fluid.js" defer></script>`,
  });
}

function docPage({ css, preload, title, desc, body }) {
  const main = `<article class="doc">
<p class="draft">Pracovní návrh. Není to hotový právní text a nenahrazuje posouzení právničky.</p>
${body}
</article>`;
  return shell({ css, preload, title, desc, main });
}

function plainPage({ css, preload, title, desc, main }) {
  return shell({ css, preload, title, desc, main });
}

export function renderPhase1({ css, preload, heart, logoAttrs }) {
  const sdilet = plainPage({
    css, preload,
    title: "Chci nasdílet svůj příběh — Nadbytečná.cz",
    desc: "Jeden formulář pro příběh. Pole jsou vypnutá a nic se neodesílá.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<h1>Chci nasdílet svůj příběh</h1>
<p>Sem patří příběh, který chceš svěřit. Telefon a odkazy nejsou povinné. Anonymní oslovení je zatím návrh a samo o sobě záznam s e-mailem neanonymizuje.</p>
<p>Pole jsou vypnutá. Nic se nevyplňuje, neodesílá ani neukládá.</p>
<h2 id="sdilet-h">Formulář: Chci nasdílet svůj příběh</h2>
<fieldset disabled aria-labelledby="sdilet-h">
${contactFields("sdilet", "Příběh")}
${tail("sdilet")}`,
  });
  const pomoc = plainPage({
    css, preload,
    title: "Chci pomoci — Nadbytečná.cz",
    desc: "Formulář s volbou, jestli sis tím prošla, nebo pomáháš. Nic se neodesílá.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<h1>Chci pomoci</h1>
<p>Povinná je jen tahle volba. Upřesnění typu pomoci je nepovinné a patří jen k možnosti „Pomáhám takovým lidem“. Není to další rozcestník.</p>
<p>Pole jsou vypnutá. Nic se nevyplňuje, neodesílá ani neukládá.</p>
<h2 id="pomoc-h">Formulář: Chci pomoci</h2>
<fieldset disabled aria-labelledby="pomoc-h">
<fieldset class="opts" disabled>
<legend>Povinná volba</legend>
<label class="opt"><input type="radio" name="jak" disabled><span>Už jsem si tím prošla / prošel</span></label>
<label class="opt"><input type="radio" name="jak" disabled><span>Pomáhám takovým lidem</span></label>
</fieldset>
<div class="refine">
<p id="typ-h">Upřesnění typu pomoci. Jen když zvolíš „Pomáhám takovým lidem“. Není povinné.</p>
<div role="group" aria-labelledby="typ-h">
<label class="opt"><input type="checkbox" disabled><span>práce</span></label>
<label class="opt"><input type="checkbox" disabled><span>terapie</span></label>
<label class="opt"><input type="checkbox" disabled><span>právní pomoc</span></label>
<label class="opt"><input type="checkbox" disabled><span>výrobky a služby</span></label>
<label class="opt"><input type="checkbox" disabled><span>jiné</span></label>
</div>
</div>
${contactFields("pomoc", "Příběh, nabídka služby nebo výrobku")}
${tail("pomoc")}`,
  });
  const potrebuji = plainPage({
    css, preload,
    title: "Potřebuji pomoc — Nadbytečná.cz",
    desc: "Formulář je vypnutý. Pomoc zatím neběží a není to krizová linka.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<h1>Potřebuji pomoc</h1>
<p>Sem patří prosba o pomoc. Pomoc zatím neběží a tenhle formulář nikoho nekontaktuje. Není to krizová linka. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>
<h2 id="potrebuji-h">Formulář: Potřebuji pomoc</h2>
<fieldset disabled aria-labelledby="potrebuji-h">
${contactFields("potrebuji", "S čím potřebuješ pomoct")}
${tail("potrebuji")}`,
  });
  const pripravujeme = plainPage({
    css, preload,
    title: "Připravujeme — Nadbytečná.cz",
    desc: "Prověřené kontakty a chat zatím nejsou. Není to krizová pomoc.",
    main: `<article class="doc">
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<h1>Připravujeme</h1>
<p>Tahle část ještě nefunguje. Není to krizová pomoc a nikdo tu hned neodpoví. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>
<h2>Prověřené kontakty</h2>
<p class="badge">Připravujeme</p>
<div class="prep">
<article class="slot"><h3>Právní pomoc</h3><p>Připravujeme. Žádný kontakt tu není a nic tu není prověřené.</p></article>
<article class="slot"><h3>Wellbeing</h3><p>Připravujeme. Žádný kontakt tu není a nic tu není prověřené.</p></article>
</div>
<h2>Chat</h2>
<div class="chat-note">
<p>Právní i jinou pomoc připravujeme.</p>
<p>Chat neběží. Není tu kam psát a odpověď nikdo neslibuje.</p>
</div>
</article>`,
  });
  const ochrana = docPage({
    css, preload,
    title: "Ochrana osobních údajů — pracovní návrh — Nadbytečná.cz",
    desc: "Pracovní návrh. Formuláře na náhledu nic neodesílají a nic neukládají.",
    body: `<h1>Ochrana osobních údajů</h1>
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<h2>Co se děje teď</h2>
<p>Formuláře na tomto náhledu nic neodesílají a nic neukládají. Pole jsou vypnutá. Žádný příběh, e-mail ani telefon se nezpracovává.</p>
<h2>Správce</h2>
<p>Správce osobních údajů je Věra Komárová, fyzická osoba.</p>
<p>Adresa: doplníme. IČ: doplníme. Jiný kontakt než e-mail: doplníme.</p>
<p>Kontaktní e-mail: <a href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<h2>Až se sběr někdy otevře</h2>
<p>Právní základ sběru a případného zveřejnění příběhu musí zvlášť potvrdit právnička. Souhlas se zpracováním údajů a souhlas se zveřejněním jsou dvě různé věci. Zaškrtávací pole ve formuláři je jen návrh, ne platný souhlas.</p>
<h2>Anonymní oslovení</h2>
<p>Anonymní oslovení je návrh. Samo o sobě neudělá z podání s e-mailem anonymní záznam. Není rozhodnuté, jestli se při zveřejnění skryje jen jméno, nebo jestli má jít o podání bez identity.</p>
<h2>Co tu záměrně není</h2>
<ul>
<li>hotové znění souhlasu,</li>
<li>doba uchování,</li>
<li>výčet zpracovatelů pro příběhy,</li>
<li>pravidla, kdo smí číst citlivé příběhy.</li>
</ul>
<p>Tyhle body doplníme po doplnění adresy a IČ a po právní kontrole. Starší text o přihlášení e-mailem k novinkám se tohoto náhledu netýká, protože ten sběr tu není zapojený.</p>`,
  });
  const pravidla = docPage({
    css, preload,
    title: "Pravidla zveřejňování příběhů — pracovní návrh — Nadbytečná.cz",
    desc: "Pracovní návrh. Příběhy se teď nezveřejňují a formulář je vypnutý.",
    body: `<h1>Pravidla zveřejňování příběhů</h1>
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<p>Příběhy se teď nezveřejňují. Formulář je vypnutý a náhled příběh ani nepřijímá.</p>
<h2>Co ještě není rozhodnuté</h2>
<ul>
<li>kdo příběhy čte a kdo je moderuje,</li>
<li>co se smí zveřejnit a co ne,</li>
<li>kdy a jaký souhlas se zveřejněním je potřeba,</li>
<li>jak se naloží s anonymním oslovením,</li>
<li>jak se chrání zvlášť citlivé příběhy.</li>
</ul>
<p>Dokud tohle není potvrzené, žádný příběh z webu ven nepůjde.</p>`,
  });
  const kontakt = docPage({
    css, preload,
    title: "Kontakt — pracovní náhled — Nadbytečná.cz",
    desc: "Kontaktní e-mail veryvera@nadbytecna.cz. Není to krizová linka.",
    body: `<h1>Kontakt</h1>
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce osobních údajů: Věra Komárová, fyzická osoba. Adresa: doplníme. IČ: doplníme.</p>
<p>Tohle není krizová linka. Chat ani prověřené kontakty neběží. Právní i jinou pomoc připravujeme. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>`,
  });
  return {
    pages: {
      "/": home({ css, preload, heart, logoAttrs }),
      "/sdilet-pribeh/": sdilet,
      "/chci-pomoci/": pomoc,
      "/potrebuji-pomoc/": potrebuji,
      "/pripravujeme/": pripravujeme,
      "/ochrana-osobnich-udaju/": ochrana,
      "/pravidla-zverejnovani/": pravidla,
      "/kontakt/": kontakt,
    },
    robots: "User-agent: *\nDisallow: /\n",
    llms: `# Nadbytečná.cz

Pracovní náhled. Formuláře nic neodesílají a nic neukládají. Stránka se neindexuje.

- [Náhled](/)
- [Chci nasdílet svůj příběh](/sdilet-pribeh/)
- [Chci pomoci](/chci-pomoci/)
- [Ochrana osobních údajů (pracovní návrh)](/ochrana-osobnich-udaju/)
- [Pravidla zveřejňování příběhů (pracovní návrh)](/pravidla-zverejnovani/)
- [Kontakt](/kontakt/)
`,
  };
}
