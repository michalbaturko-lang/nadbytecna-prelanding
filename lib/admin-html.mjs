export function adminHtml() {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pracovní přehled — Nadbytečná.cz</title><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin.css"><script src="/config.js" defer></script><script src="/admin.js" defer></script></head><body>
<a class="skip" href="#admin-cards">Přejít na zprávy</a>
<header class="top"><img src="/img/nadbytecna-script.svg" width="200" height="44" alt="Nadbytečná.cz"><p>Prostor pro pomoc</p><button id="admin-out" hidden>Odhlásit</button></header>
<main id="admin"><div class="intro"><p class="eyebrow">PRACOVNÍ PŘEHLED</p><h1>Každý příběh má své místo.</h1><p>Zprávy, nabídky a další krok k pomoci.</p></div>
<section id="admin-login" class="panel" aria-labelledby="login-title"><h2 id="login-title">Vstup pro administrátory</h2><p>Na svůj e-mail si nechte poslat přihlašovací odkaz.</p><form id="login-form"><label for="admin-email">E-mail</label><input id="admin-email" type="email" autocomplete="username" required maxlength="254"><button class="primary" id="admin-send">Poslat přihlašovací odkaz</button></form></section>
<p id="admin-msg" role="status" aria-live="polite"></p>
<div id="admin-app" hidden>
<section id="admin-counts" class="counts" aria-label="Rychlý přehled"></section><details class="secondary-counts"><summary>Další přehled</summary><div id="secondary-counts" class="counts"></div></details>
<details class="category-counts"><summary>Nabídky pomoci podle kategorií</summary><div id="offer-counts"></div></details>
<div class="toolbar"><div class="tabs" role="group" aria-label="Typ zprávy"><button data-entity="" aria-pressed="true">Vše</button><button data-entity="stories" aria-pressed="false">Příběhy</button><button data-entity="help_offers" aria-pressed="false">Nabídky pomoci</button></div><button id="admin-filters-open" aria-controls="admin-filters" aria-expanded="false">Filtry</button><button id="admin-csv">Export CSV</button><button id="admin-person">Údaje osoby</button></div>
<div id="admin-filters" class="filter-panel" hidden>
<div class="filter-heading"><h2>Najít správnou zprávu</h2><button id="admin-filters-close">Zavřít filtry</button></div>
<div id="filter-fields" class="filter-grid"></div><button id="admin-reset">Zrušit filtry</button>
<label class="check"><input id="csv-text" type="checkbox"> Do CSV zahrnout i celý text a přepis</label>
</div>
<div class="results-head"><p id="admin-count" role="status"></p><label for="admin-sort">Řazení <select id="admin-sort"><option value="newest">Nejnovější</option><option value="oldest">Nejstarší</option><option value="urgency">Naléhavost</option><option value="status">Stav</option><option value="changed">Poslední změna</option></select></label></div>
<div class="workspace"><section id="list-panel" aria-label="Zprávy"><div id="admin-cards"></div><nav class="pager" aria-label="Stránkování"><button id="prev-page">Předchozí</button><span id="page-info"></span><button id="next-page">Další</button></nav></section><section id="admin-detail" class="panel detail" aria-label="Detail zprávy" hidden tabindex="-1"></section></div>
</div></main><footer>Citlivé příběhy. Opatrná rozhodnutí. Pomoc člověka člověku.</footer></body></html>`;
}
