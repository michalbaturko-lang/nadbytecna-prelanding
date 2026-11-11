import test from "node:test";
import assert from "node:assert/strict";
import { classifyMailRules, blockedMailSenders, MAIL_RULES_VERSION } from "../lib/mail-rules.mjs";
import { runMailRules } from "../lib/mail-rules-worker.mjs";
import { createMailSyncHandler } from "../api/mail-sync.js";

const job = (patch = {}) => ({ id: "11111111-1111-4111-8111-111111111111", revision: 3,
  message_count: 1, context_truncated: false, messages: [{ subject: "Newsletter", body_text: "Odhlásit se z odběru.", sender_email: "news@example.invalid" }], ...patch });

test("rules are local, retain independent labels and distinguish newsletters from human requests", () => {
  let result = classifyMailRules(job());
  assert.equal(result.disposition, "normal");
  assert.ok(result.labels.some(label => label.code === "newsletter"));
  result = classifyMailRules(job({ messages: [{ subject: "Automatická odpověď", sender_email: "no-reply@example.invalid", body_text: "Potřebuji právní pomoc po výpovědi. Odhlásit se z odběru." }] }));
  const codes = result.labels.map(label => label.code);
  for (const code of ["request_help", "newsletter", "automated", "work", "legal", "review"]) assert.ok(codes.includes(code));
  assert.equal(result.disposition, "review");
  result = classifyMailRules(job({ messages: [{ subject: "Pomoc projektu", body_text: "Ráda bych Vám pomohla.", sender_email: "helper@example.invalid" }] }));
  assert.ok(result.labels.some(label => label.code === "offer_help"));
});

test("disabled local rules avoid all configuration and database work", async () => {
  assert.deepEqual(await runMailRules({ env: { MAIL_RULES_ENABLED: "false", MAIL_RULES_BLOCKED_SENDERS: "malformed" }, rpc() { assert.fail(); } }), { skipped: true });
});

test("worker applies bounded versioned snapshots, recognizes stale revisions and returns counters only", async () => {
  const calls = [];
  const result = await runMailRules({ env: {}, rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === "mail_rules_pending") return { jobs: [job(), job({ id: "22222222-2222-4222-8222-222222222222" })] };
    if (name === "mail_rules_apply") return { applied: args.p_thread.startsWith("111") };
    assert.fail(name);
  } });
  assert.deepEqual(result, { processed: 2, saved: 1, stale: 1, failed: 0 });
  assert.deepEqual(calls[0].args, { p_limit: 25, p_version: MAIL_RULES_VERSION });
  assert.equal(calls[1].args.p_revision, 3);
  assert.equal(calls[1].args.p_version, MAIL_RULES_VERSION);
  assert.ok(calls[1].args.p_labels.every(label => Object.keys(label).sort().join(",") === "code,reason"));
  assert.ok(!JSON.stringify(result).includes("Newsletter"));
});

test("blocked sender configuration is exact, normalized and version changes trigger historical reevaluation", async () => {
  assert.deepEqual(blockedMailSenders({ MAIL_RULES_BLOCKED_SENDERS: '["BLOCKED@example.invalid","blocked@example.invalid"]' }), ["blocked@example.invalid"]);
  assert.throws(() => blockedMailSenders({ MAIL_RULES_BLOCKED_SENDERS: '["*.example.invalid"]' }), /mail_rules_configuration/);
  const versions = [];
  for (const values of [[], ["one@example.invalid"], ["two@example.invalid"]]) await runMailRules({ env: { MAIL_RULES_BLOCKED_SENDERS: JSON.stringify(values) }, rpc: async (name, args) => { versions.push(args.p_version); return { jobs: [] }; } });
  assert.equal(new Set(versions).size, 3);
  assert.equal(versions[0], MAIL_RULES_VERSION);
});

test("invalid snapshots and per-item failures stay bounded and never return source errors", async () => {
  const result = await runMailRules({ env: {}, rpc: async name => {
    if (name === "mail_rules_pending") return { jobs: [job({ revision: 0 }), job()] };
    throw new Error("SECRET_PRIVATE_DATABASE_CONTENT");
  } });
  assert.deepEqual(result, { processed: 1, saved: 0, stale: 0, failed: 2 });
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  await assert.rejects(runMailRules({ env: {}, rpc: async () => ({ jobs: Array.from({ length: 26 }, () => job()) }) }), /mail_rules_configuration/);
});

test("the rules deadline and a changed kill switch stop the next apply", async () => {
  let clock = 0, applies = 0;
  const env = {};
  const result = await runMailRules({ env, now: () => clock, rpc: async name => {
    if (name === "mail_rules_pending") return { jobs: [job(), job()] };
    applies++; clock = 31000; return { applied: true };
  } });
  assert.equal(applies, 1); assert.equal(result.deadline, true);
  applies = 0;
  await runMailRules({ env, rpc: async name => {
    if (name === "mail_rules_pending") return { jobs: [job(), job()] };
    applies++; env.MAIL_RULES_ENABLED = "false"; return { applied: true };
  } });
  assert.equal(applies, 1);
});

function response() { return { statusCode: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.body = JSON.parse(text); } }; }
test("cron runs bounded rules after sync and isolates labeling failure from a committed import", async () => {
  let calls = 0;
  let handler = createMailSyncHandler({ authorized: () => true, run: async () => ({ ok: true, imported: 2 }), runRules: async () => ({ processed: 2, saved: 2 }) });
  let res = response(); await handler({ method: "GET", headers: {} }, res);
  assert.deepEqual(res.body, { ok: true, imported: 2, rules: { processed: 2, saved: 2 } });
  handler = createMailSyncHandler({ authorized: () => true, run: async () => ({ ok: true, imported: 1 }), runRules: async () => { throw new Error("SECRET_PRIVATE_MAIL"); } });
  res = response(); await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { ok: true, imported: 1, rules: { failed: true } });
  assert.ok(!JSON.stringify(res).includes("SECRET"));
  handler = createMailSyncHandler({ authorized: () => true, run: async () => { throw Object.assign(new Error("SECRET_GRAPH_ERROR"), { code: "throttled" }); }, runRules: async () => ({ processed: 1, saved: 1 }) });
  res = response(); await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 503); assert.deepEqual(res.body, { error: "throttled", rules: { processed: 1, saved: 1 } });
  handler = createMailSyncHandler({ authorized: () => false, run: async () => { calls++; }, runRules: async () => { calls++; } });
  res = response(); await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401); assert.equal(calls, 0);
});
