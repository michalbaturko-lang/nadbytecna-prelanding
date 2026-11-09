import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://db.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
process.env.RESEND_API_KEY = "re_test";
process.env.MAIL_ENABLED = "true";

const ID = "11111111-2222-4333-8444-555555555555";

async function load() {
  const mod = await import("../lib/confirm-mail.mjs?" + Math.random());
  return mod;
}

test("pendingConfirmations hledá jen neodeslané, se souhlasem, bez výmazu", async () => {
  const urls = [];
  global.fetch = async (u) => { urls.push(String(u)); return new Response(JSON.stringify([{ id: ID }]), { status: 200 }); };
  const { pendingConfirmations } = await load();
  const rows = await pendingConfirmations(180000, 86400000);
  assert.equal(rows.length, 2);
  assert.ok(urls.every((u) => u.includes("mail_sent_at=is.null") && u.includes("consent=eq.true") && u.includes("erasure_requested_at=is.null")));
});

test("sendConfirmation neposílá starší než limit a nevolá Resend", async () => {
  const calls = [];
  global.fetch = async (u) => {
    calls.push(String(u));
    return new Response(JSON.stringify([{ id: ID, email: "a@b.cz", consent: true, created_at: new Date(Date.now() - 3 * 864e5).toISOString(), mail_sent_at: null }]), { status: 200 });
  };
  const { sendConfirmation } = await load();
  const r = await sendConfirmation("stories", ID, 86400000);
  assert.equal(r.sent, false);
  assert.ok(!calls.some((u) => u.includes("resend.com")));
});

test("sendConfirmation odmítne cizí tabulku a špatné id", async () => {
  const { sendConfirmation } = await load();
  assert.equal((await sendConfirmation("admins", ID, 1e9)).sent, false);
  assert.equal((await sendConfirmation("stories", "x", 1e9)).sent, false);
});
