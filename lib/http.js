export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function siteUrl() {
  return (process.env.SITE_URL || "https://nadbytecna.cz").replace(/\/$/, "");
}

// Ukázkový režim: jen na adrese *.vercel.app a jen dokud je sběr zavřený. Nic se neukládá ani neodesílá.
export function isDemo(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return process.env.COLLECTION_OPEN !== "true" && host.endsWith(".vercel.app");
}

// Povolíme jen požadavky z naší stránky (Origin chybí u některých klientů – pak neblokujeme, ale POST s JSON stejně vyžaduje CORS preflight).
export function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const s = new URL(siteUrl());
    if (isDemo(req) && o.host === String(req.headers.host || "").toLowerCase()) return true;
    const allowed = new Set([s.host, "www." + s.host.replace(/^www\./, ""), s.host.replace(/^www\./, "")]);
    if (process.env.VERCEL_ENV !== "production" && (o.hostname === "localhost" || o.hostname.endsWith(".vercel.app"))) return true;
    return allowed.has(o.host);
  } catch {
    return false;
  }
}

export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) throw new Error("body too large");
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
