// Společný zdroj pravdy pro text souhlasu a údaje o správci.
// Používá build (vykreslení stránky) i API (uložení důkazu o souhlasu).
// Správce dodá Michal (s.r.o. Věry) – do té doby je v textu zástupný údaj a sběr zůstává zavřený.

export const CONSENT_VERSION = "2026-11-03-v2";

export function controller(env = process.env) {
  const name = (env.CONTROLLER_NAME || "").trim();
  const ico = (env.CONTROLLER_ICO || "").trim();
  const address = (env.CONTROLLER_ADDRESS || "").trim();
  const email = (env.CONTROLLER_EMAIL || "").trim();
  const complete = Boolean(name && ico && address && email);
  return { name, ico, address, email, complete };
}

export function controllerLine(c) {
  return c.complete ? `${c.name}, IČO ${c.ico}, se sídlem ${c.address}` : "[název s.r.o., IČO, sídlo]";
}

export function consentText(c) {
  return (
    `Souhlasím, že ${controllerLine(c)} použije můj e-mail k informování o spuštění platformy Nadbytečná. ` +
    `Souhlas mohu kdykoli odvolat. Více v zásadách ochrany osobních údajů.`
  );
}

// Totéž s odkazem na zásady (pro HTML).
export function consentHtml(c, esc) {
  const text = esc(consentText(c));
  return text.replace(
    "zásadách ochrany osobních údajů",
    '<a href="/zasady-ochrany-osobnich-udaju/">zásadách ochrany osobních údajů</a>'
  );
}
