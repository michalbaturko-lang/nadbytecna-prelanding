import { CONSENT_VERSIONS, consentText, controller, controllerLine, isLang } from "../lib/consent.js";
import { db } from "../lib/db.js";
import { parseEmail } from "../lib/email.js";
import { MAX_AGE_MS, MIN_FILL_MS, readFormToken } from "../lib/form.js";
import { body, bodyError, isDemo, json, originOk } from "../lib/http.js";
import { confirmationEmail } from "../lib/emails.js";
import { sendMail } from "../lib/mailer.js";
import { clientIp, ipHash, randomToken, sha256 } from "../lib/tokens.js";

const num = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
const RESEND_COOLDOWN_MS = 10 * 60e3;
const TOKEN_TTL_MS = 48 * 3600e3;
const IP_RETENTION_MS = 30 * 24 * 3600e3;

// Celkový strop nových přihlášek za hodinu (ochrana před zaplavením cizími adresami z mnoha IP).
// Počet se krátce drží v paměti instance, aby při náporu nezatěžoval databázi každým požadavkem.
let globalCache = { at: 0, n: 0 };
async function globalCount(now, iso) {
  if (now - globalCache.at < 5000) return globalCache.n;
  globalCache = { at: now, n: await db.countCreatedSince(iso(now - 3600e3)) };
  return globalCache.n;
}

// Počítadlo pokusů na IP přímo v paměti instance: zvyšuje se synchronně ještě před čekáním na databázi, takže se
// souběžné požadavky z jedné IP nedají „proklouznout“ dřív, než se dotaz do databáze vrátí. Databázová kontrola níž
// platí napříč instancemi.
const mem = new Map();
function takeIp(hash, now, limit) {
  let e = mem.get(hash);
  if (!e || e.reset < now) { e = { n: 0, reset: now + 3600e3 }; mem.set(hash, e); if (mem.size > 50_000) for (const [k, v] of mem) if (v.reset < now) mem.delete(k); }
  if (e.n >= limit) return false;
  e.n++;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });

  // Sběr je zavřený, dokud nebude doplněn správce údajů a Michal neotevře COLLECTION_OPEN=true.
  const c = controller();
  // Výjimka: ukázkový režim na *.vercel.app (isDemo), kde se přihláška jen potvrdí a nic se neukládá.
  const demo = isDemo(req);
  if (!demo && (process.env.COLLECTION_OPEN !== "true" || !c.complete)) return json(res, 503, { error: "closed" });

  let b;
  try { b = await body(req); } catch (e) { return bodyError(res, e); }

  // Honeypot: tváříme se, že je vše v pořádku, aby bot nevěděl.
  if (typeof b.website === "string" ? b.website !== "" : b.website != null) return json(res, 200, { ok: true });
  // Ukázka bez nastaveného TOKEN_SECRET (nic se neukládá): token se nevyžaduje. Mimo ukázku vždy.
  if (!(demo && !process.env.TOKEN_SECRET)) {
    let form;
    try { form = readFormToken(b.k); } catch { return json(res, 500, { error: "server" }); }
    if (!form) return json(res, 400, { error: "stale" });
    if (form.age < MIN_FILL_MS) return json(res, 200, { ok: true });
    if (form.age > MAX_AGE_MS) return json(res, 400, { error: "stale" });
  }

  // Jazyk stránky, ze které přihláška přišla (chybí = čeština, kvůli starším načteným stránkám). Cokoli jiného je chyba.
  if (b.lang != null && !isLang(b.lang)) return json(res, 400, { error: "lang" });
  const lang = b.lang || "cs";

  const parsed = parseEmail(b.email);
  if (!parsed) return json(res, 400, { error: "email" });
  if (b.consent !== true) return json(res, 400, { error: "consent" });
  if (b.consent_version !== CONSENT_VERSIONS[lang]) return json(res, 409, { error: "version" });

  // Ukázka: nic neukládáme, neodesíláme e-mail, neukládáme ani IP.
  if (demo) return json(res, 200, { ok: true, demo: true });

  try {
    const { email, normalized: norm } = parsed;
    const hash = ipHash(clientIp(req));
    const now = Date.now();
    const iso = (t) => new Date(t).toISOString();

    const ipLimit = num("RATE_PER_IP_HOUR", 30);
    if (!takeIp(hash, now, ipLimit)) return json(res, 429, { error: "rate" });
    if ((await db.recentFromIp(hash, iso(now - 3600e3))) >= ipLimit) return json(res, 429, { error: "rate" });
    const gl = num("RATE_GLOBAL_HOUR", 3000);
    if ((await globalCount(now, iso)) >= gl) return json(res, 429, { error: "busy" });
    globalCache.n++;

    const existing = await db.findByEmail(norm);
    // Neprozrazujeme, zda adresa už v seznamu je: odpověď je vždy stejná.
    if (existing && existing.status === "confirmed") return json(res, 200, { ok: true });
    // Cooldown podle posledního pokusu (nastaví se hned při zápisu), ne podle odeslání mailu:
    // jinak by druhý souběžný požadavek přepsal token a první odkaz by přestal platit.
    const lastTry = existing && existing.status === "pending"
      ? Math.max(Date.parse(existing.confirm_sent_at) || 0, Date.parse(existing.last_attempt_at) || 0) : 0;
    if (lastTry && now - lastTry < RESEND_COOLDOWN_MS) return json(res, 200, { ok: true });

    const token = randomToken();
    const fields = {
      consent_version: CONSENT_VERSIONS[lang],
      lang,
      consent_text: consentText(c, lang),
      consented_at: iso(now),
      ip_hash: hash,
      ip_hash_expires_at: iso(now + IP_RETENTION_MS),
      confirm_token_hash: sha256(token),
      confirm_token_expires_at: iso(now + TOKEN_TTL_MS),
      confirm_sent_at: null,
      confirmed_at: null,
      unsubscribed_at: null,
      status: "pending",
      last_attempt_at: iso(now),
    };
    let row;
    try {
      row = existing ? await db.update(existing.id, fields) : await db.insert({ email, email_normalized: norm, ...fields });
    } catch (e) {
      // Dvě souběžné přihlášky téže adresy: jedinečný index jednu odmítl. Druhá nic nepokazila, e-mail už míří ven.
      if (e.conflict) return json(res, 200, { ok: true });
      throw e;
    }

    try {
      await sendMail({ to: email, ...confirmationEmail({ id: row.id, token, controllerLine: controllerLine(c, lang), lang }) });
    } catch (e) {
      console.error("mail failed", e.message);
      return json(res, 502, { error: "mail" });
    }
    await db.update(row.id, { confirm_sent_at: iso(Date.now()) });
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("subscribe failed", e.message);
    return json(res, 500, { error: "server" });
  }
}
