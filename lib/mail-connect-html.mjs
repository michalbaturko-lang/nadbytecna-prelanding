const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function mailConnectHtml({
  message = "",
  result = false,
  ready = false,
} = {}) {
  return (
    '<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Připojení schránky | nadbytečná</title><link rel="stylesheet" href="/mail-connect.css">' +
    (!result ? '<script src="/mail-connect.js" defer></script>' : "") +
    '</head><body><main><p class="brand">NADBYTEČNÁ</p><h1>' +
    (result ? "Připojení schránky" : "Připojit schránku Microsoft 365") +
    '</h1><p class="mailbox">veryvera@nadbytecna.cz</p>' +
    (result
      ? '<p role="status">' +
        escape(message) +
        "</p><p>Toto okno můžete zavřít. Přístup do adminu vám nebyl vytvořen.</p>"
      : '<p>Na následující stránce se přihlásíte přímo u Microsoftu a potvrdíte čtení pošty. Účet v adminu nadbytečné nepotřebujete.</p><p>Provozovatel nadbytečné získá možnost načítat a ukládat místní kopie pošty této schránky do svého adminu podle nastavení importu.</p><ul><li>Pouze čtení schránky. Žádné odesílání ani změny zpráv.</li><li>Heslo zadáváte pouze Microsoftu.</li><li>Připojení samo nezapíná import ani zpracování pomocí AI.</li></ul><p id="connect-status" role="status">' +
        escape(message || "Připravuje se kontrola pozvánky…") +
        '</p><button id="connect-microsoft" disabled data-ready="' +
        String(ready) +
        '">Připojit přes Microsoft</button><noscript>Pro bezpečné připojení je potřeba povolit JavaScript.</noscript>') +
    '<p class="hint">Pozvánka je jednorázová. Pokud vypršela nebo přihlášení nevyšlo, požádejte o nový odkaz.</p></main></body></html>'
  );
}
