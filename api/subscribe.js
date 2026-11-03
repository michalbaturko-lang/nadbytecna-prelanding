import { CONSENT_VERSION, consentText, controller, controllerLine } from "../lib/consent.js";
import { db } from "../lib/db.js";
import { body, isDemo, json, originOk } from "../lib/http.js";
import { confirmationEmail } from "../lib/emails.js";
import { sendMail } from "../lib/mailer.js";
import { clientIp, ipHash, randomToken, sha256 } from "../lib/tokens.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_FILL_MS = 2500;          // rychleji než 2,5 s od načtení stránky = bot
const MAX_AGE_MS = 24 * 3600e3;    // starší než 24 h = zastaralá stránka
const RATE_PER_HOUR = 5;
const RESEND_COOLDOWN_MS = 10 * 60e3;
const TOKEN_TTL_MS = 48 * 3600e3;
const IP_RETENTION_MS = 30 * 24 * 3600e3;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "method" }); }
  if (!originOk(req)) return json(res, 403, { error: "origin" });

  // Sběr je zavřený, dokud nebude doplněn správce údajů a Michal neotevře COLLECTION_OPEN=true.
  const c = controller();
  // Výjimka: ukázkový režim na *.vercel.app (isDemo), kde se přihláška jen potvrdí a nic se neukládá.
  const demo = isDemo(req);
  if (!demo && (process.env.COLLECTION_OPEN !== "true" || !c.complete)) return json(res, 503, { error: "closed" });

  let b;
  try { b = await body(req); } catch { return json(res, 400, { error: "body" }); }

  // Honeypot: tváříme se, že je vše v pořádku, aby bot nevěděl.
  if (b.website) return json(res, 200, { ok: true });
  const age = Date.now() - Number(b.ts);
  if (!Number.isFinite(age) || age < MIN_FILL_MS) return json(res, 200, { ok: true });
  if (age > MAX_AGE_MS) return json(res, 400, { error: "version" });

  const email = String(b.email || "").trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) return json(res, 400, { error: "email" });
  if (b.consent !== true) return json(res, 400, { error: "consent" });
  if (b.consent_version !== CONSENT_VERSION) return json(res, 409, { error: "version" });

  // Ukázka: nic neukládáme, neodesíláme e-mail, neukládáme ani IP.
  if (demo) return json(res, 200, { ok: true, demo: true });

  try {
    const norm = email.toLowerCase();
    const hash = ipHash(clientIp(req));
    const now = Date.now();
    const iso = (t) => new Date(t).toISOString();

    if ((await db.recentFromIp(hash, iso(now - 3600e3))) >= RATE_PER_HOUR) return json(res, 429, { error: "rate" });

    const existing = await db.findByEmail(norm);
    // Neprozrazujeme, zda adresa už v seznamu je: odpověď je vždy stejná.
    if (existing && existing.status === "confirmed") return json(res, 200, { ok: true });
    if (existing && existing.status === "pending" && existing.confirm_sent_at &&
        now - Date.parse(existing.confirm_sent_at) < RESEND_COOLDOWN_MS) return json(res, 200, { ok: true });

    const token = randomToken();
    const fields = {
      consent_version: CONSENT_VERSION,
      consent_text: consentText(c),
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
    const row = existing
      ? await db.update(existing.id, fields)
      : await db.insert({ email, email_normalized: norm, ...fields });

    try {
      await sendMail({ to: email, ...confirmationEmail({ id: row.id, token, controllerLine: controllerLine(c) }) });
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
