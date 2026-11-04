// Minimální klient pro Supabase REST (PostgREST) se service role klíčem. Bez SDK, bez závislostí.
// Klíč je jen na serveru (env), nikdy v prohlížeči.
function conf() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY chybí");
  return { url, key };
}

async function rest(pathAndQuery, { method = "GET", body, prefer, count } = {}) {
  const { url, key } = conf();
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  // Do chyby nedáváme tělo odpovědi: PostgREST do něj u konfliktu vkládá hodnotu (e-mail) a dostal by se do logu.
  if (!res.ok) throw Object.assign(new Error(`Supabase ${method} ${pathAndQuery.split("?")[0]} -> ${res.status}`), { status: res.status, conflict: res.status === 409 });
  if (count) return Number((res.headers?.get?.("content-range") || "").split("/")[1]) || 0;
  return text ? JSON.parse(text) : null;
}

const T = "preregistrations";
const enc = encodeURIComponent;

export const db = {
  findByEmail: async (emailNorm) =>
    (await rest(`${T}?email_normalized=eq.${enc(emailNorm)}&select=*&limit=1`))[0] || null,
  findByTokenHash: async (hash) =>
    (await rest(`${T}?confirm_token_hash=eq.${enc(hash)}&select=*&limit=1`))[0] || null,
  findById: async (id) => (await rest(`${T}?id=eq.${enc(id)}&select=*&limit=1`))[0] || null,
  recentFromIp: async (hash, sinceIso) =>
    (await rest(`${T}?ip_hash=eq.${enc(hash)}&last_attempt_at=gte.${enc(sinceIso)}&select=id&limit=20`)).length,
  countCreatedSince: async (sinceIso) =>
    await rest(`${T}?created_at=gte.${enc(sinceIso)}&select=id&limit=1`, { prefer: "count=exact", count: true }),
  confirmedClaims: async () =>
    await rest(`${T}?status=eq.confirmed&claims=not.is.null&select=claims&limit=100000`),
  insert: async (row) => (await rest(T, { method: "POST", body: row, prefer: "return=representation" }))[0],
  update: async (id, patch) =>
    (await rest(`${T}?id=eq.${enc(id)}`, { method: "PATCH", body: patch, prefer: "return=representation" }))[0],
};
