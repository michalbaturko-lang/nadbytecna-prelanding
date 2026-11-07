export function adminHtml() {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pracovní přehled — Nadbytečná.cz</title><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin.css"><script src="/config.js" defer></script><script src="/admin.js" defer></script></head><body>
<a class="skip" href="#admin-cards">Přejít na zprávy</a>
<header class="top"><img src="/img/nadbytecna-script.svg" width="200" height="44" alt="Nadbytečná.cz"><p>Prostor pro pomoc</p><button id="admin-out" hidden>Odhlásit</button></header>
<main id="admin"><div class="intro"><p class="eyebrow">PRACOVNÍ PŘEHLED</p><h1>Každý příběh má své místo.</h1><p>Zprávy, nabídky a další krok k pomoci.</p></div>
<section id="admin-login" class="panel" aria-labelledby="login-title"><h2 id="login-title">Vstup pro administrátory</h2><p>Na svůj e-mail si nechte poslat přihlašovací odkaz.</p><form id="login-form"><label for="admin-email">E-mail</label><input id="admin-email" type="email" autocomplete="username" required maxlength="254"><button class="primary" id="admin-send">Poslat přihlašovací odkaz</button></form></section>
<p id="admin-msg" role="status" aria-live="polite"></p>
<div id="admin-app" hidden>
<nav class="admin-sections" aria-label="Pracovní oblast"><button id="admin-view-stories" aria-controls="admin-stories" data-admin-view="stories" aria-pressed="true">Příběhy a nabídky</button><button id="admin-view-mail" aria-controls="admin-mail" data-admin-view="mail" aria-pressed="false">E-maily</button></nav>
<div id="admin-stories">
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
</div>
<section id="admin-mail" hidden aria-labelledby="mail-title">
<div class="mail-heading"><div><p class="eyebrow">PŘÍCHOZÍ POŠTA</p><h2 id="mail-title">E-maily</h2><p>Schránka <strong>veryvera@nadbytecna.cz</strong></p></div><button id="mail-refresh">Obnovit přehled</button></div>
<p class="mail-notice">Pracujete s místními kopiemi e-mailů. Změny stavů, poznámky ani výmaz v tomto přehledu nemění zprávy ve schránce Microsoft 365. Z adminu se žádné e-maily automaticky neposílají.</p>
<p id="mail-sync-status" class="hint" role="status"></p>
<section class="panel mail-connection" aria-labelledby="mail-connection-title">
<h3 id="mail-connection-title">Připojení schránky</h3>
<p id="mail-connection-status" role="status">Stav připojení se načítá.</p>
<p class="hint">Připojovací odkaz předejte soukromě osobě s přístupem ke schránce veryvera@nadbytecna.cz. Příjemce nepotřebuje účet v adminu. Odkaz se neposílá automaticky.</p>
<div class="actions"><button id="mail-connect-invite" disabled>Vytvořit připojovací odkaz</button><button id="mail-connect-disconnect" class="danger" hidden>Odpojit schránku</button></div>
<p id="mail-connect-msg" role="status" aria-live="polite"></p>
<div id="mail-connect-link" hidden><label for="mail-connect-url">Soukromý jednorázový odkaz</label><div class="mail-invite-copy"><input id="mail-connect-url" type="url" readonly autocomplete="off" spellcheck="false"><button id="mail-connect-copy" disabled>Kopírovat odkaz</button></div><p id="mail-connect-expiry" class="hint"></p><p class="mail-invite-warning">Odkaz lze použít jednou a platí nejvýše 30 minut. Zveřejněním byste umožnili jiné osobě zahájit připojení schránky. Sdílejte ho pouze s určeným příjemcem.</p></div>
</section>
<p id="mail-msg" role="status" aria-live="polite"></p>
<details id="mail-filters"><summary>Hledání a filtry e-mailů</summary><div id="mail-filter-fields" class="mail-filter-grid"></div><button id="mail-reset">Zrušit filtry e-mailů</button></details>
<div class="mail-results"><p id="mail-count" role="status"></p></div>
<div id="mail-workspace" class="workspace mail-workspace"><section id="mail-list-panel" aria-label="E-mailová vlákna"><div id="mail-cards"></div><nav class="pager" aria-label="Stránkování e-mailů"><button id="mail-prev">Předchozí e-maily</button><span id="mail-page"></span><button id="mail-next">Další e-maily</button></nav></section><section id="mail-detail" class="panel detail" aria-label="Detail e-mailového vlákna" hidden tabindex="-1"></section></div>
</section>
</div></main><footer>Citlivé příběhy. Opatrná rozhodnutí. Pomoc člověka člověku.</footer></body></html>`;
}
