// Test celého průchodu proti paměťové maketě Supabase REST (bez sítě, bez skutečné DB).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.TOKEN_SECRET = "x".repeat(40);
process.env.IP_HASH_SALT = "s".repeat(32);
process.env.SITE_URL = "https://nadbytecna.cz";
process.env.COLLECTION_OPEN = "true";
process.env.CONTROLLER_NAME = "Test s.r.o."; process.env.CONTROLLER_ICO = "12345678";
process.env.CONTROLLER_ADDRESS = "Ulice 1, Brno"; process.env.CONTROLLER_EMAIL = "ahoj@test.cz";
process.env.MAIL_PROVIDER = "console";

const rows = [];
const mails = [];
const origLog = console.log;
console.log = (...a) => { if (a[0] === "[mail:console]") mails.push(JSON.parse(a[1])); else origLog(...a); };

globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url);
  const ok = (data, status = 200) => ({ ok: status < 300, status, text: async () => (data === null ? "" : JSON.stringify(data)) });
  const q = u.searchParams;
  const matches = (r) => [...q.entries()].every(([k, v]) => {
    if (["select", "limit"].includes(k)) return true;
    const [op, val] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
    if (op === "eq") return String(r[k]) === val;
    if (op === "gte") return r[k] && r[k] >= val;
    if (op === "not" && val === "is.null") return r[k] != null;
    return false;
  });
  if (opt.method === "POST") { const r = { id: crypto.randomUUID(), ...JSON.parse(opt.body) }; rows.push(r); return ok([r], 201); }
  if (opt.method === "PATCH") { const hit = rows.filter(matches); hit.forEach((r) => Object.assign(r, JSON.parse(opt.body))); return ok(hit); }
  return ok(rows.filter(matches));
};

const { CONSENT_VERSION } = await import("../lib/consent.js");
const subscribe = (await import("../api/subscribe.js")).default;
const confirm = (await import("../api/confirm.js")).default;
const unsubscribe = (await import("../api/unsubscribe.js")).default;
const vote = (await import("../api/vote.js")).default;

function call(handler, { method = "POST", url = "/api/x", body = {}, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, url, headers: { origin: "https://nadbytecna.cz", "x-forwarded-for": "1.2.3.4", ...headers }, body, socket: {} };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } };
    handler(req, res);
  });
}
const good = (extra = {}) => ({ email: "Zena@Example.cz", consent: true, consent_version: CONSENT_VERSION, website: "", ts: Date.now() - 5000, ...extra });
const tokenFromMail = (m) => new URL(m.text.match(/https:\/\/\S+potvrzeni\/\?t=\S+/)[0]).searchParams.get("t");

test("přihláška se uloží jako pending s verzí a zněním souhlasu, odešle se potvrzovací e-mail", async () => {
  const r = await call(subscribe, { body: good() });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].email_normalized, "zena@example.cz");
  assert.equal(rows[0].consent_version, CONSENT_VERSION);
  assert.match(rows[0].consent_text, /Test s\.r\.o\., IČO 12345678/);
  assert.ok(rows[0].confirm_token_hash && !JSON.stringify(rows[0]).includes(tokenFromMail(mails[0])), "token se neukládá v čitelné podobě");
  assert.equal(mails.length, 1);
  assert.ok(mails[0].headers["List-Unsubscribe"].includes("/api/unsubscribe/?t="));
});

test("bez potvrzení se souhlas nepovažuje za udělený (stav zůstává pending)", () => {
  assert.equal(rows[0].confirmed_at ?? null, null);
  assert.equal(rows[0].status, "pending");
});

test("druhé odeslání do 10 minut neposílá další e-mail a neprozradí stav", async () => {
  const r = await call(subscribe, { body: good() });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(mails.length, 1);
});

test("honeypot a příliš rychlé odeslání: 200, ale nic se neuloží", async () => {
  const n = rows.length;
  assert.equal((await call(subscribe, { body: good({ website: "http://spam", email: "a@b.cz" }) })).status, 200);
  assert.equal((await call(subscribe, { body: good({ ts: Date.now() - 300, email: "c@d.cz" }) })).status, 200);
  assert.equal(rows.length, n);
});

test("chybný e-mail, chybějící souhlas, stará verze, cizí origin", async () => {
  assert.equal((await call(subscribe, { body: good({ email: "nesmysl" }) })).json.error, "email");
  assert.equal((await call(subscribe, { body: good({ consent: false }) })).json.error, "consent");
  assert.equal((await call(subscribe, { body: good({ consent_version: "stara" }) })).status, 409);
  assert.equal((await call(subscribe, { body: good(), headers: { origin: "https://evil.example" } })).status, 403);
});

test("potvrzení: špatný token neprojde, správný potvrdí a je idempotentní", async () => {
  assert.equal((await call(confirm, { body: { t: "x".repeat(43) } })).status, 400);
  const t = tokenFromMail(mails[0]);
  assert.equal((await call(confirm, { body: { t } })).json.ok, true);
  assert.equal(rows[0].status, "confirmed");
  assert.ok(rows[0].confirmed_at);
  assert.equal((await call(confirm, { body: { t } })).json.ok, true);
});

test("odhlášení jedním klikem (POST z poštovního klienta i ze stránky), neplatný token neprojde", async () => {
  const unsubUrl = new URL(mails[0].headers["List-Unsubscribe"].slice(1, -1));
  assert.equal((await call(unsubscribe, { url: unsubUrl.pathname + unsubUrl.search, headers: { origin: undefined } })).status, 200);
  assert.equal(rows[0].status, "unsubscribed");
  assert.ok(rows[0].unsubscribed_at);
  assert.equal((await call(unsubscribe, { body: { t: rows[0].id + ".podvrzeno" } })).status, 400);
});

test("rate limit: po 5 přihláškách z jedné IP za hodinu 429", async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call(subscribe, { body: good({ email: `u${i}@example.cz` }), headers: { "x-forwarded-for": "9.9.9.9" } });
  assert.equal(last.status, 429);
});

test("sběr je zavřený, dokud COLLECTION_OPEN není true", async () => {
  process.env.COLLECTION_OPEN = "false";
  assert.equal((await call(subscribe, { body: good({ email: "z@z.cz" }) })).status, 503);
  process.env.COLLECTION_OPEN = "true";
});

test("po potvrzení přijde token pro výběr; výběr se uloží, počty jsou souhrnné, odhlášení výběr smaže", async () => {
  const r0 = await call(subscribe, { body: good({ email: "vyber@example.cz" }) });
  assert.equal(r0.status, 200);
  const m = mails[mails.length - 1];
  const t = tokenFromMail(m);
  const c = await call(confirm, { body: { t } });
  assert.equal(c.status, 200);
  assert.ok(c.json.vote, "potvrzení vrací token pro hlasování");
  const bad = await call(vote, { body: { v: c.json.vote, claims: ["nesmysl"] } });
  assert.equal(bad.status, 400);
  const four = await call(vote, { body: { v: c.json.vote, claims: ["nejsi", "krasa", "zena", "prace"] } });
  assert.equal(four.status, 400, "víc než tři se nepřijme");
  const noTok = await call(vote, { body: { v: "x.y", claims: ["nejsi"] } });
  assert.equal(noTok.status, 400);
  const ok = await call(vote, { body: { v: c.json.vote, claims: ["zena", "never", "zena"] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.counts.zena, 1); assert.equal(ok.json.counts.never, 1); assert.equal(ok.json.counts.nejsi, 0);
  assert.equal(ok.json.voters, 1);
  const row = rows.find((r) => r.email_normalized === "vyber@example.cz");
  assert.deepEqual(row.claims, ["zena", "never"]);
  const pub = await call(vote, { method: "GET" });
  assert.equal(pub.status, 200); assert.equal(pub.json.voters, 1);
  assert.ok(!JSON.stringify(pub.json).includes("example.cz"), "veřejné počty neobsahují e-maily");
  const { signUnsub } = await import("../lib/tokens.js");
  await call(unsubscribe, { body: { t: signUnsub(row.id) } });
  assert.equal(row.claims, null, "odhlášení vymaže výběr");
});

test("výběr nejde bez potvrzeného e-mailu", async () => {
  await call(subscribe, { body: good({ email: "nepotvrzena@example.cz" }) });
  const row = rows.find((r) => r.email_normalized === "nepotvrzena@example.cz");
  const { signVote } = await import("../lib/tokens.js");
  const r = await call(vote, { body: { v: signVote(row.id), claims: ["nejsi"] } });
  assert.equal(r.status, 400);
});
