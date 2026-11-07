export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Fáze 1 je pracovní náhled. Na preview nasazení (a při PHASE1=1) staré API
// odmítne požadavek dřív, než přečte tělo: nic se neukládá, neposílá ani neloguje.
export function phase1Closed(res) {
  if (process.env.PHASE1 !== "1" && process.env.VERCEL_ENV !== "preview") return false;
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  json(res, 503, { error: "closed" });
  return true;
}

export function siteUrl() {
  return (process.env.SITE_URL || "https://nadbytecna.cz").replace(/\/$/, "");
}

// Ukázkový režim: jen na adrese *.vercel.app a jen dokud je sběr zavřený. Nic se neukládá ani neodesílá.
const VERCEL_HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app(?::\d{1,5})?$/;
export function isDemo(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return process.env.COLLECTION_OPEN !== "true" && VERCEL_HOST_RE.test(host);
}

// Povolíme jen požadavky z naší stránky (Origin chybí u některých klientů – pak neblokujeme, ale POST s JSON stejně vyžaduje CORS preflight).
export function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const s = new URL(siteUrl());
    const local = o.hostname === "localhost" || o.hostname === "127.0.0.1";
    if (o.protocol !== "https:" && !(local && process.env.VERCEL_ENV !== "production")) return false;
    if (o.username || o.password) return false;
    if (isDemo(req) && o.host === String(req.headers.host || "").toLowerCase()) return true;
    const allowed = new Set([s.host, "www." + s.host.replace(/^www\./, ""), s.host.replace(/^www\./, "")]);
    if (process.env.VERCEL_ENV !== "production" && (o.hostname === "localhost" || o.hostname.endsWith(".vercel.app"))) return true;
    return allowed.has(o.host);
  } catch {
    return false;
  }
}

export const MAX_BODY = 4096;

// Načte tělo požadavku jako JSON objekt. Vyhodí chybu s kódem (400/413/415), když to není obyčejný objekt.
// (Vercel tělo obvykle předzpracuje do req.body; ručně čteme jen když ne.)
export async function body(req, { requireJson = true } = {}) {
  const fail = (status, code) => Object.assign(new Error(code), { status, code });
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (requireJson && !ct.startsWith("application/json")) throw fail(415, "type");
  const len = Number(req.headers["content-length"]);
  if (Number.isFinite(len) && len > MAX_BODY) throw fail(413, "size");
  let v = req.body;
  if (v === undefined || v === null || v === "") {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw fail(413, "size");
      chunks.push(c);
    }
    try { v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); } catch { throw fail(400, "json"); }
  } else if (Buffer.isBuffer(v) || typeof v === "string") {
    if (v.length > MAX_BODY) throw fail(413, "size");
    try { v = JSON.parse(String(v)); } catch { throw fail(400, "json"); }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw fail(400, "json");
  if (JSON.stringify(v).length > MAX_BODY) throw fail(413, "size");
  return v;
}

// Odpověď na chybu z body().
export function bodyError(res, e) {
  return json(res, e && e.status ? e.status : 400, { error: e && e.code ? e.code : "body" });
}
