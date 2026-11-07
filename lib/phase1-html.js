// Pracovní náhled fáze 1. Žádný formulář, žádné odeslání, žádné úložiště.
// Padající nápis v hero je stejný lockup a stejné fluid.js jako pre-landing.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CATEGORIES = [
  ["pribeh", "Sdílej svůj příběh", "Sem patří příběh, který chceš svěřit."],
  ["potencial", "Nabídni svůj potenciál — hledám novou práci", "Hledáš novou práci a nabízíš, co umíš."],
  ["prace", "Nabídni práci — hledáme někoho do týmu", "Hledáte někoho do týmu."],
  ["terapie", "Nabídni terapii — psychoterapeuti, psychologové, psychiatři, fyzioterapeuti apod.", "Nabídka terapie. Patří sem psychoterapeuti, psychologové, psychiatři, fyzioterapeuti apod."],
  ["pravni", "Nabídni právní pomoc — právní zástupci, vyjednavači, mediátoři", "Nabídka právní pomoci. Patří sem právní zástupci, vyjednavači a mediátoři."],
  ["pomoc", "Nabídni pomoc — přidej se k nám", "Chceš se přidat k nám."],
  ["vyrobky", "Nabídni své výrobky a služby", "Máš výrobky nebo služby, které chceš nabídnout."],
  ["potrebuji", "Potřebuji pomoc", "Sem patří prosba o pomoc. Pomoc zatím neběží a tenhle formulář nikoho nekontaktuje."],
];

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

function categoryForm([slug, title, lead], index) {
  const prefix = `f${index + 1}`;
  const heading = `Formulář: ${title}`;
  return `<li>
<details class="cat" id="kat-${slug}" name="zapoj"${index === 0 ? " open" : ""}>
<summary>${esc(title)}</summary>
<div class="cat-body">
<p>${esc(lead)}</p>
<h3 id="${prefix}-h">${esc(heading)}</h3>
<fieldset disabled aria-labelledby="${prefix}-h">
${FIELDS.map((f) => field(prefix, f)).join("\n")}
<div class="consent">
<input id="${prefix}-gdpr" type="checkbox" disabled aria-describedby="${prefix}-gdpr-hint">
<label id="${prefix}-gdpr-text" for="${prefix}-gdpr">Návrh souhlasu se zpracováním údajů. Není to souhlas se zveřejněním.</label>
</div>
<p class="hint" id="${prefix}-gdpr-hint">Právní znění musí potvrdit právnička. Zatím se nic neodesílá ani neukládá.</p>
</fieldset>
<p class="form-off" id="${prefix}-off">Odesílání zatím není spuštěné.</p>
<button type="button" class="send" disabled aria-describedby="${prefix}-off">Spouštíme 11. 11.</button>
</div>
</details>
</li>`;
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

const NAV = `<header class="top">
<nav aria-label="Hlavní">
<ul class="topnav">
<li><a href="/#pribeh">Věřin příběh</a></li>
<li><a href="/#zapoj-se">Zapoj se</a></li>
<li><a href="/#pripravujeme">Připravujeme</a></li>
<li><a href="/#very-vera">Very Vera</a></li>
</ul>
</nav>
</header>`;

const FOOT = `<footer class="foot">
<img class="dom" src="/img/nadbytecna-script.svg" width="2480" height="528" alt="Nadbytečná.cz">
<p><a class="mail" href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
<p>Správce a provozovatel: Zapsaný ústav — název, IČO, sídlo a zápis v rejstříku doplníme po založení.</p>
<ul class="foot-links">
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
${NAV}
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
<section class="block" id="pribeh" aria-labelledby="pribeh-h">
<h2 id="pribeh-h">Věřin příběh</h2>
<aside class="placeholder">
<p class="kicker">Zástupný blok</p>
<p>Tady bude osobní výpověď Věry Komárové. Čekáme na její text.</p>
<p class="hint">Žádná domyšlená citace, fotografie ani svědectví.</p>
</aside>
</section>
<section class="block" id="zapoj-se" aria-labelledby="zapoj-h">
<h2 id="zapoj-h">Zapoj se</h2>
<p>Osm možností, jak se přidat. Každá má vlastní formulář a je pojmenovaná tak, jak to napsala Věra.</p>
<p>Pole jsou vypnutá. Nic se nevyplňuje, neodesílá ani neukládá. Enter ani přepnutí kategorie nic nepošle.</p>
<p>Anonymní oslovení je zatím návrh. Samo o sobě záznam s e-mailem neanonymizuje. Jestli se při zveřejnění skryje jen jméno, nebo půjde o podání bez identity, ještě není rozhodnuté. Telefon a odkazy na Instagram, Facebook, e-shop a web nejsou povinné.</p>
<p>Zaškrtnutí souhlasu ve formuláři je jen návrh. Souhlas se zpracováním a souhlas se zveřejněním jsou dvě různé věci. Znění musí potvrdit právnička. Víc je v <a href="/ochrana-osobnich-udaju/">ochraně osobních údajů</a> a v <a href="/pravidla-zverejnovani/">pravidlech zveřejňování</a>. Obojí je pracovní návrh.</p>
<ul class="join">
${CATEGORIES.map(categoryForm).join("\n")}
</ul>
</section>
<section class="block" id="pripravujeme" aria-labelledby="pripravujeme-h">
<h2 id="pripravujeme-h">Připravujeme</h2>
<p>Tahle část ještě nefunguje. Není to krizová pomoc a nikdo tu hned neodpoví. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>
<h3>Prověřené kontakty</h3>
<p class="badge">Připravujeme</p>
<div class="prep">
<article class="slot">
<h4>Právní pomoc</h4>
<p>Připravujeme. Žádný kontakt tu není a nic tu není prověřené.</p>
</article>
<article class="slot">
<h4>Wellbeing</h4>
<p>Připravujeme. Žádný kontakt tu není a nic tu není prověřené.</p>
</article>
</div>
<h3>Chat</h3>
<div class="chat-note">
<p>Právní i jinou pomoc připravujeme.</p>
<p>Chat neběží. Není tu kam psát a odpověď nikdo neslibuje.</p>
</div>
</section>
<section class="block" id="very-vera" aria-labelledby="vera-h">
<h2 id="vera-h">Very Vera</h2>
<p>VERY VERA je produktová značka. E-shop se teprve připravuje.</p>
<p>První produkt je parfém Very Vera Nadbytečná. Předprodej je v plánu od 11. 11. 2026.</p>
<p><a class="out" href="https://veryvera.cz" rel="noopener noreferrer">Připravovaný e-shop veryvera.cz</a></p>
<p class="hint">Odkaz vede na veryvera.cz. Jestli stránka už funguje, u tohoto úkolu se neověřovalo.</p>
</section>`;
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

export function renderPhase1({ css, preload, heart, logoAttrs }) {
  const ochrana = docPage({
    css, preload,
    title: "Ochrana osobních údajů — pracovní návrh — Nadbytečná.cz",
    desc: "Pracovní návrh. Formuláře na náhledu nic neodesílají a nic neukládají.",
    body: `<h1>Ochrana osobních údajů</h1>
<p><a class="backlink" href="/">Zpět na náhled</a></p>
<h2>Co se děje teď</h2>
<p>Formuláře na tomto náhledu nic neodesílají a nic neukládají. Pole jsou vypnutá. Žádný příběh, e-mail ani telefon se nezpracovává.</p>
<h2>Správce</h2>
<p>Zapsaný ústav — název, IČO, sídlo a zápis v rejstříku doplníme po založení.</p>
<p>Kontaktní e-mail dodaný pro tuto fázi: <a href="mailto:veryvera@nadbytecna.cz">veryvera@nadbytecna.cz</a></p>
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
<p>Tyhle body doplníme až po založení správce a po právní kontrole. Starší text o přihlášení e-mailem k novinkám se tohoto náhledu netýká, protože ten sběr tu není zapojený.</p>`,
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
<p>Správce a provozovatel: Zapsaný ústav — název, IČO, sídlo a zápis v rejstříku doplníme po založení.</p>
<p>Tohle není krizová linka. Chat ani prověřené kontakty neběží. Právní i jinou pomoc připravujeme. V ohrožení života volej 155, v jiném akutním nebezpečí 158.</p>`,
  });
  return {
    pages: {
      "/": home({ css, preload, heart, logoAttrs }),
      "/ochrana-osobnich-udaju/": ochrana,
      "/pravidla-zverejnovani/": pravidla,
      "/kontakt/": kontakt,
    },
    robots: "User-agent: *\nDisallow: /\n",
    llms: `# Nadbytečná.cz

Pracovní náhled. Formuláře nic neodesílají a nic neukládají. Stránka se neindexuje.

- [Náhled](/)
- [Ochrana osobních údajů (pracovní návrh)](/ochrana-osobnich-udaju/)
- [Pravidla zveřejňování příběhů (pracovní návrh)](/pravidla-zverejnovani/)
- [Kontakt](/kontakt/)
`,
  };
}
