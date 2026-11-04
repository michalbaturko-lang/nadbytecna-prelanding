// Test celého průchodu proti paměťové maketě Supabase REST (bez sítě, bez skutečné DB).
import test from "node:test";
import assert from "node:assert/strict";

import { baseEnv, call as call0, captureMails, installMockSupabase } from "./helpers/mock-supabase.mjs";
baseEnv({ RATE_PER_IP_HOUR: "5" });
const { rows } = installMockSupabase();
const { mails } = captureMails();

const { CONSENT_VERSION } = await import("../lib/consent.js");
const subscribe = (await import("../api/subscribe.js")).default;
const confirm = (await import("../api/confirm.js")).default;
const unsubscribe = (await import("../api/unsubscribe.js")).default;
const vote = (await import("../api/vote.js")).default;

const call = (handler, o = {}) => call0(handler, { ...o, headers: { ...(o.headers || {}) } }).then((r) => r);
const { issueFormToken } = await import("../lib/form.js");
const good = (extra = {}) => ({ email: "Zena@Example.cz", consent: true, consent_version: CONSENT_VERSION, website: "", k: issueFormToken(Date.now() - 5000), ...extra });
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
  assert.equal((await call(subscribe, { body: good({ website: "http://spam", email: "aa@bb.cz" }) })).status, 200);
  assert.equal((await call(subscribe, { body: good({ k: issueFormToken(Date.now() - 300), email: "cc@dd.cz" }) })).status, 200);
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
  assert.equal((await call(unsubscribe, { url: unsubUrl.pathname + unsubUrl.search, headers: { origin: undefined, "content-type": undefined } })).status, 200);
  assert.equal(rows[0].status, "unsubscribed");
  assert.ok(rows[0].unsubscribed_at);
  assert.equal((await call(unsubscribe, { body: { t: rows[0].id + ".podvrzeno" } })).status, 400);
});

test("rate limit: po 5 přihláškách z jedné IP za hodinu 429", async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call(subscribe, { body: good({ email: `u${i}@example.cz` }), headers: { "x-vercel-forwarded-for": "9.9.9.9" } });
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

test("souběžný dvojklik téže adresy: jeden e-mail, první odkaz platí", async () => {
  const { startDevServer } = await import("../tools/devserver.mjs");
  const S = await startDevServer({ latency: [20, 40] });
  try {
    const k = async () => (await (await fetch(S.url + "/api/form/")).json()).k;
    const kk = await Promise.all([k(), k(), k()]);
    await new Promise((r) => setTimeout(r, 2800));
    const post = (key) => fetch(S.url + "/api/subscribe/", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://nadbytecna.cz", "x-vercel-forwarded-for": "198.51.100.77" }, body: JSON.stringify({ email: "dvojklik@example.cz", consent: true, consent_version: "2026-11-03-v3", website: "", k: key }) });
    const rs = await Promise.all(kk.map(post));
    assert.ok(rs.every((r) => r.status === 200));
    const mails = await (await fetch(S.url + "/__test/mails")).json();
    assert.equal(mails.length, 1);
  } finally { await S.close(); }
});
