// Paměťová maketa Supabase REST (PostgREST) pro testy. Chová se jako skutečná databáze tam, kde na tom záleží:
//  - jedinečný index na email_normalized (druhý INSERT = 409, tělo chyby obsahuje e-mail jako PostgREST),
//  - filtry eq / gte / not.is.null, count=exact s hlavičkou content-range,
//  - přísná kontrola dotazu: neznámý sloupec nebo operátor = 400 a záznam v `violations`
//    (tak se ukáže, kdyby se uživatelský vstup dostal do struktury dotazu),
//  - volitelná latence (jitter) pro zátěžový test.
export function installMockSupabase({ latency = [0, 0], failRate = 0 } = {}) {
  const rows = [];
  const requests = [];
  const violations = [];
  const COLUMNS = new Set(["id", "email", "email_normalized", "status", "consent_version", "consent_text", "consented_at", "ip_hash", "ip_hash_expires_at",
    "confirm_token_hash", "confirm_token_expires_at", "confirm_sent_at", "confirmed_at", "unsubscribed_at", "last_attempt_at", "created_at", "claims", "claims_at", "lang"]);
  const CONTROL = new Set(["select", "limit"]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, opt = {}) => {
    if (!String(url).startsWith("http://supabase.test/")) return realFetch(url, opt);
    const u = new URL(url);
    const lat = latency[0] + Math.random() * (latency[1] - latency[0]);
    if (lat) await sleep(lat);
    const res = (data, status = 200, headers = {}) => ({
      ok: status < 300, status, headers: new Map(Object.entries(headers)),
      text: async () => (data === null || data === undefined ? "" : JSON.stringify(data)),
    });
    requests.push({ method: opt.method || "GET", path: u.pathname, search: u.search, body: opt.body });
    if (failRate && Math.random() < failRate) return res({ message: "boom" }, 503);
    if (u.pathname !== "/rest/v1/preregistrations") { violations.push("path " + u.pathname); return res({}, 404); }
    // dotaz musí mít jen známé parametry; hodnoty jen eq./gte./not.is.null (nic jiného se z kódu posílat nesmí)
    const filters = [];
    for (const part of u.search.slice(1).split("&").filter(Boolean)) {
      const i = part.indexOf("=");
      const k = decodeURIComponent(part.slice(0, i)), v = decodeURIComponent(part.slice(i + 1));
      if (CONTROL.has(k)) continue;
      const op = v.slice(0, v.indexOf(".")), val = v.slice(v.indexOf(".") + 1);
      if (!COLUMNS.has(k) || !["eq", "gte", "not"].includes(op) || (op === "not" && val !== "is.null")) { violations.push(`query ${part}`); return res({ message: "bad" }, 400); }
      filters.push([k, op, val]);
    }
    const matches = (r) => filters.every(([k, op, val]) => op === "eq" ? String(r[k]) === val : op === "gte" ? r[k] != null && r[k] >= val : r[k] != null);
    const method = opt.method || "GET";
    if (method === "POST") {
      const b = JSON.parse(opt.body);
      for (const k of Object.keys(b)) if (!COLUMNS.has(k)) { violations.push(`column ${k}`); return res({ message: "bad column" }, 400); }
      if (rows.some((r) => r.email_normalized === b.email_normalized)) return res({ code: "23505", details: `Key (email_normalized)=(${b.email_normalized}) already exists.` }, 409);
      const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...b };
      rows.push(r);
      return res([r], 201);
    }
    if (method === "PATCH") {
      const patch = JSON.parse(opt.body);
      for (const k of Object.keys(patch)) if (!COLUMNS.has(k)) { violations.push(`column ${k}`); return res({ message: "bad column" }, 400); }
      const hit = rows.filter(matches); hit.forEach((r) => Object.assign(r, patch));
      return res(hit);
    }
    const hit = rows.filter(matches);
    const lim = Number(u.searchParams.get("limit")) || Infinity;
    const out = hit.slice(0, lim);
    return res(out, 200, { "content-range": `0-${Math.max(0, out.length - 1)}/${hit.length}` });
  };
  return { rows, requests, violations, restore: () => { globalThis.fetch = realFetch; } };
}

export function baseEnv(extra = {}) {
  Object.assign(process.env, {
    SUPABASE_URL: "http://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-key",
    TOKEN_SECRET: "x".repeat(40), IP_HASH_SALT: "s".repeat(32), SITE_URL: "https://nadbytecna.cz", COLLECTION_OPEN: "true",
    CONTROLLER_NAME: "Test s.r.o.", CONTROLLER_ICO: "12345678", CONTROLLER_ADDRESS: "Ulice 1, Brno", CONTROLLER_EMAIL: "ahoj@test.cz",
    MAIL_PROVIDER: "console",
  }, extra);
}

// Zachytává „odeslané“ e-maily (provider console).
export function captureMails() {
  const mails = [];
  const orig = console.log;
  console.log = (...a) => { if (a[0] === "[mail:console]") mails.push(JSON.parse(a[1])); else orig(...a); };
  return { mails, restore: () => { console.log = orig; } };
}

// Zavolá handler bez sítě (tvar req/res jako ve Vercelu: req.body je už rozparsované).
export function call(handler, { method = "POST", url = "/api/x", body = {}, headers = {}, rawBody } = {}) {
  return new Promise((resolve) => {
    const req = { method, url, headers: { origin: "https://nadbytecna.cz", "content-type": "application/json", "x-vercel-forwarded-for": "1.2.3.4", ...headers }, body: rawBody !== undefined ? rawBody : body, socket: {} };
    for (const k of Object.keys(req.headers)) if (req.headers[k] === undefined) delete req.headers[k];
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { let j; try { j = JSON.parse(s); } catch { j = null; } resolve({ status: this.statusCode, json: j, headers: this.headers, raw: s }); } };
    Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 599, json: null, crash: e }));
  });
}
