import { domainToASCII } from "node:url";

// Přísná validace e-mailu. Cíl: do databáze ani do hlaviček e-mailu se nikdy nedostane nic než jedna
// obyčejná adresa. Nepovolujeme uvozovky, mezery, čárky, závorky, lomítka ani řídicí znaky (e-mail pak nejde
// použít pro vložení hlavičky, víc příjemců ani skript). Doména s diakritikou se převede na punycode.
const LOCAL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;

export function parseEmail(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length < 6 || s.length > 254) return null;
  if (s.normalize("NFC") !== s) return null;
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return null;
  const local = s.slice(0, at);
  if (local.length > 64 || !LOCAL_RE.test(local) || local.includes("..")) return null;
  // Doména: před převodem na punycode povolíme jen písmena, číslice, tečky a pomlčky. (domainToASCII jinak mlčky ořízne
  // vše za „?“, „#“, „/“ apod., takže „a@example.cz?x=1“ by prošlo jako „a@example.cz“.)
  const rawDomain = s.slice(at + 1);
  if (!/^[\p{L}\p{N}.-]+$/u.test(rawDomain)) return null;
  const domain = domainToASCII(rawDomain.toLowerCase());
  if (!domain || domain.length > 253) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l)) || !TLD_RE.test(labels[labels.length - 1])) return null;
  return { email: `${local}@${domain}`, normalized: `${local.toLowerCase()}@${domain}` };
}
