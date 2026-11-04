import crypto from "node:crypto";

// Podepsaný „formulářový“ token: ts.nonce.HMAC. Server ho vydá při načtení stránky a při odeslání ověří,
// že není vymyšlený a že od vydání uplynula rozumná doba (člověk vyplňuje déle než skript).
// Čas si tedy nediktuje klient (dřív to byl obyčejný časový údaj z prohlížeče, který robot snadno podvrhl).
export const MIN_FILL_MS = 2500;
export const MAX_AGE_MS = 12 * 3600e3;

function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 24) throw new Error("TOKEN_SECRET chybí nebo je příliš krátký");
  return s;
}
const mac = (payload) => crypto.createHmac("sha256", secret()).update("form:" + payload).digest("base64url").slice(0, 32);

export function issueFormToken(now = Date.now()) {
  const payload = `${now}.${crypto.randomBytes(6).toString("base64url")}`;
  return `${payload}.${mac(payload)}`;
}

// Vrací { age } nebo null, když je token neplatný / podvržený.
export function readFormToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 80) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d{10,16}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{8}$/.test(parts[1])) return null;
  const expected = Buffer.from(mac(`${parts[0]}.${parts[1]}`)), got = Buffer.from(parts[2]);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
  return { age: now - Number(parts[0]) };
}
