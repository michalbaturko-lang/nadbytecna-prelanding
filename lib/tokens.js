import crypto from "node:crypto";

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 24) throw new Error("TOKEN_SECRET chybí nebo je příliš krátký");
  return s;
}

// Odhlašovací token je bezstavový: id.HMAC(id). Nic dalšího se neukládá.
export function signUnsub(id) {
  const sig = crypto.createHmac("sha256", secret()).update("unsub:" + id).digest("base64url").slice(0, 32);
  return `${id}.${sig}`;
}
export function verifyUnsub(token) {
  if (typeof token !== "string") return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = signUnsub(id).split(".")[1];
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

export function ipHash(ip) {
  const salt = process.env.IP_HASH_SALT;
  if (!salt || salt.length < 16) throw new Error("IP_HASH_SALT chybí nebo je příliš krátký");
  return sha256(salt + "|" + (ip || "unknown"));
}

export function clientIp(req) {
  const h = req.headers;
  const raw = h["x-vercel-forwarded-for"] || h["x-forwarded-for"] || req.socket?.remoteAddress || "";
  return String(raw).split(",")[0].trim();
}
