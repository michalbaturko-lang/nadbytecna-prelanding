// Společný zdroj pravdy pro text souhlasu a údaje o správci.
// Používá build (vykreslení stránky) i API (uložení důkazu o souhlasu).
// Správce dodá Michal (s.r.o. Věry) – do té doby je v textu zástupný údaj a sběr zůstává zavřený.

export const LANGS = ["cs", "sk"];
export const CONSENT_VERSIONS = { cs: "2026-11-03-v3", sk: "2026-11-04-sk-v1" };
export const CONSENT_VERSION = CONSENT_VERSIONS.cs; // zpětná kompatibilita (čeština)

// Cesty stránek podle jazyka. Zdroj pravdy pro build, e-maily i klienta.
export const PATHS = {
  cs: { home: "/", thanks: "/dekujeme/", confirmed: "/potvrzeno/", confirm: "/potvrzeni/", unsub: "/odhlaseni/", policy: "/zasady-ochrany-osobnich-udaju/" },
  sk: { home: "/sk/", thanks: "/sk/dakujeme/", confirmed: "/sk/potvrdene/", confirm: "/sk/potvrdenie/", unsub: "/sk/odhlasenie/", policy: "/sk/zasady-ochrany-osobnych-udajov/" },
};
export const isLang = (x) => typeof x === "string" && LANGS.includes(x);

export function controller(env = process.env) {
  const name = (env.CONTROLLER_NAME || "").trim();
  const ico = (env.CONTROLLER_ICO || "").trim();
  const address = (env.CONTROLLER_ADDRESS || "").trim();
  const email = (env.CONTROLLER_EMAIL || "").trim();
  const complete = Boolean(name && ico && address && email);
  return { name, ico, address, email, complete };
}

export function controllerLine(c, lang = "cs") {
  if (lang === "sk") return c.complete ? `${c.name}, IČO ${c.ico}, so sídlom ${c.address}` : "[názov s.r.o., IČO, sídlo]";
  return c.complete ? `${c.name}, IČO ${c.ico}, se sídlem ${c.address}` : "[název s.r.o., IČO, sídlo]";
}

const POLICY_LINK = { cs: "zásadách ochrany osobních údajů", sk: "zásadách ochrany osobných údajov" };

export function consentText(c, lang = "cs") {
  if (lang === "sk") {
    return (
      `Súhlasím, že ${controllerLine(c, "sk")} použije môj e-mail na zaslanie informácie o spustení platformy Nadbytočná. ` +
      `Súhlas môžem kedykoľvek odvolať. Viac v ${POLICY_LINK.sk}.`
    );
  }
  return (
    `Souhlasím, že ${controllerLine(c)} použije můj e-mail k zaslání informace o spuštění platformy Nadbytečná. ` +
    `Souhlas mohu kdykoli odvolat. Více v ${POLICY_LINK.cs}.`
  );
}

// Totéž s odkazem na zásady (pro HTML).
export function consentHtml(c, esc, lang = "cs") {
  const text = esc(consentText(c, lang));
  return text.replace(POLICY_LINK[lang], `<a href="${PATHS[lang].policy}">${POLICY_LINK[lang]}</a>`);
}
