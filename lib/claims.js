// Výroky z kampaně, ze kterých si žena po potvrzení e-mailu vybírá. Zdroj pravdy pro stránku i API.
// Texty jsou převzaté ze série na Instagramu; schvaluje Věra.
export const VOTE_CLAIMS = [
  { id: "nejsi", text: "Nejsi nadbytečná.", sk: "Nie si nadbytočná." },
  { id: "krasa", text: "Krása není nadbytečná.", sk: "Krása nie je nadbytočná." },
  { id: "zena", text: "Žádná žena není nadbytečná.", sk: "Žiadna žena nie je nadbytočná." },
  { id: "prace", text: "Žádná práce není nadbytečná.", sk: "Žiadna práca nie je nadbytočná." },
  { id: "laska", text: "Žádná láska není nadbytečná.", sk: "Žiadna láska nie je nadbytočná." },
  { id: "never", text: "Never nadbytečná.", sk: "Never nadbytočná." },
];
export const VOTE_IDS = VOTE_CLAIMS.map((c) => c.id);
export const VOTE_MAX = 3;

// Vrátí očištěný seznam id (unikátní, jen známá, max VOTE_MAX), nebo null při neplatném vstupu.
export function cleanClaims(input) {
  if (!Array.isArray(input) || input.length > VOTE_IDS.length) return null;
  const out = [];
  for (const x of input) {
    if (typeof x !== "string" || !VOTE_IDS.includes(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  if (out.length < 1 || out.length > VOTE_MAX) return null;
  return out;
}

export function tally(rows) {
  const counts = Object.fromEntries(VOTE_IDS.map((id) => [id, 0]));
  let voters = 0;
  for (const r of rows) {
    if (!Array.isArray(r.claims) || !r.claims.length) continue;
    voters++;
    for (const id of r.claims) if (id in counts) counts[id]++;
  }
  return { counts, voters };
}
