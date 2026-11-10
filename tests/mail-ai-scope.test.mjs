import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { freshAdminDb, ADMIN, OTHER } from "./helpers/admin-db.mjs";
import { mailAiScopeAllows, mailAiAllowUnmarked } from "../lib/mail-ai-scope.mjs";
import { runMailAiWorker } from "../lib/mail-ai-worker.mjs";
const sql = name => fs.readFileSync(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
const scopeSql = sql("20261110230000_mail_ai_scope.sql");
let db;
test.beforeEach(async () => {
  db = await freshAdminDb();
  for (const name of ["20261109000000_admin_mail.sql", "20261110211204_mail_ai_queue.sql", "20261110211416_mail_priority_sort.sql", "20261110224500_mail_triage_review.sql"])
    await db.exec(sql(name));
  await db.exec(scopeSql);
  await db.query("insert into public.admins(user_id) values($1) on conflict do nothing", [ADMIN]);
  await db.exec("set role service_role");
});
test.afterEach(async () => { await db?.close(); });
const rpc = async (name, payload = {}) => {
  const entries = Object.entries(payload);
  return (await db.query("select public." + name + "(" + entries.map(([key], index) => key + "=>$" + (index + 1)).join(",") + ") result", entries.map(([, value]) => typeof value === "object" && value !== null ? JSON.stringify(value) : value))).rows[0].result;
};
const fixture = async (suffix = "first", age = 0) => {
  const t = (await db.query("insert into public.email_threads(mailbox,conversation_id,last_received_at) values('veryvera@nadbytecna.cz',$1,now()-make_interval(days=>$2)) returning *", [suffix, age])).rows[0];
  await db.query("insert into public.email_messages(thread_id,mailbox,external_id,sender_email,subject,body_text,received_at,message_hash,sender_hash) values($1,'veryvera@nadbytecna.cz',$2,'synthetic@example.invalid','Syntetický projekt','Pouze smyšlený obsah.',now(),repeat('a',64),repeat('b',64))", [t.id, suffix]);
  return t;
};
const setScope = (t, approved) => rpc("mail_set_ai_scope", { p_id: t.id, p_revision: t.revision, p_approved: approved, p_actor: ADMIN, p_email: "admin@example.invalid" });
const claim = allow => rpc("mail_ai_claim_scoped", { p_allow_unmarked: allow });
const output = { email_type: "story", category: "pribeh", urgency: "medium", summary: "Smyšlený projektový příběh.", help_type: "Ověřit kontext.", model: "synthetic-model" };
const finish = lease => rpc("mail_ai_finish", { p_lease: lease, p_output: output, p_error: false });

test("safe default is marked-only, explicit blocks win over all, migration is guarded and idempotent", async () => {
  const t = await fixture();
  let snap = await rpc("mail_ai_snapshot", { p_id: t.id });
  assert.equal(snap.ai_scope_approved, false); assert.equal(snap.ai_scope_blocked, false); assert.equal(snap.ai_scope_version, 1);
  for (const env of [{}, { AI_EMAIL_SCOPE: "marked" }, { AI_EMAIL_SCOPE: "ALL" }]) {
    assert.equal(mailAiScopeAllows(snap, env), false); assert.equal(mailAiAllowUnmarked(env), false);
  }
  assert.equal(mailAiScopeAllows(snap, { AI_EMAIL_SCOPE: "all" }), true);
  await setScope(t, true); const job = await claim(false);
  await db.exec("reset role"); await db.exec(scopeSql); await db.exec("set role service_role");
  snap = await rpc("mail_ai_snapshot", { p_id: t.id });
  assert.equal(snap.ai_scope_approved, true);
  assert.equal((await db.query("select lease from private.mail_ai_jobs where thread_id=$1", [t.id])).rows[0].lease, job.lease);
  const clean = new PGlite(); try { await clean.exec(scopeSql); } finally { await clean.close(); }
  await setScope(t, false);
  snap = await rpc("mail_ai_snapshot", { p_id: t.id });
  assert.equal(mailAiScopeAllows(snap, { AI_EMAIL_SCOPE: "all" }), false);
  assert.equal(await claim(true), null);
});

test("unmarked newer mail never consumes a model call or starves an older approved thread", async () => {
  const approved = await fixture("approved-old", 30);
  for (let index = 0; index < 8; index++) await fixture("unapproved-new-" + index);
  const env = { AI_TRIAGE_ENABLED: "true", AI_EMAIL_CLASSIFICATION_ENABLED: "true", AI_EMAIL_PROCESSING_APPROVED: "true", AI_EMAIL_AUTOMATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" };
  let calls = 0;
  const opts = { env, rpc, loadCategories: async () => ["pribeh"], classify: async () => { calls++; return output; } };
  assert.equal((await runMailAiWorker(opts)).processed, 0); assert.equal(calls, 0);
  assert.equal((await db.query("select sum(attempts)::int n from private.mail_ai_jobs")).rows[0].n, 0);
  await setScope(approved, true);
  const result = await runMailAiWorker(opts);
  assert.equal(result.saved, 1); assert.equal(calls, 1);
  assert.equal((await db.query("select count(*)::int n from public.email_threads where ai_at is not null")).rows[0].n, 1);
  assert.equal((await db.query("select ai_at from public.email_threads where id=$1", [approved.id])).rows[0].ai_at !== null, true);
});

test("revocation cancels a leased result, reapproval does not revive its lease, and block wins in all mode", async () => {
  const t = await fixture(); await setScope(t, true); const old = await claim(false);
  assert.equal((await rpc("mail_ai_scope_active", { p_lease: old.lease, p_allow_unmarked: false })).active, true);
  await setScope(t, false);
  assert.equal((await rpc("mail_ai_scope_active", { p_lease: old.lease, p_allow_unmarked: true })).active, false);
  assert.equal((await finish(old.lease)).saved, false);
  assert.equal(await claim(true), null);
  await setScope(t, true);
  assert.equal((await finish(old.lease)).saved, false);
  const next = await claim(false); assert.notEqual(next.lease, old.lease);
  assert.equal((await finish(next.lease)).saved, true);
});

test("manual save is atomic with scope version, including revoke then reapprove without a content change", async () => {
  const t = await fixture(); await setScope(t, true);
  const before = await rpc("mail_ai_snapshot", { p_id: t.id });
  const payload = { id: t.id, revision: t.revision, actor_id: ADMIN, actor_email: "admin@example.invalid", ...output, error: false, scope_version: before.ai_scope_version };
  await setScope(t, false); await setScope(t, true);
  assert.deepEqual(await rpc("mail_ai_save_scoped", { p_payload: payload, p_allow_unmarked: true }), { saved: false, reason: "scope" });
  const current = await rpc("mail_ai_snapshot", { p_id: t.id });
  assert.deepEqual(await rpc("mail_ai_save_scoped", { p_payload: { ...payload, scope_version: current.ai_scope_version }, p_allow_unmarked: false }), { saved: true });
});

test("approval persists for future replies but changing content still invalidates old AI snapshots", async () => {
  const t = await fixture(); await setScope(t, true); const old = await claim(false);
  await db.query("update public.email_threads set revision=revision+1 where id=$1", [t.id]);
  const current = await rpc("mail_ai_snapshot", { p_id: t.id });
  assert.equal(current.ai_scope_approved, true); assert.equal(current.ai_scope_version, 2);
  assert.equal((await finish(old.lease)).saved, false);
  const next = await claim(false); assert.equal(next.revision, t.revision + 1);
  const stale = await setScope(t, false); assert.deepEqual(stale, { saved: false, reason: "changed" });
  assert.equal((await rpc("mail_ai_snapshot", { p_id: t.id })).ai_scope_approved, true);
});

test("scope mutations require verified admin identity and all scope RPCs remain service-only", async () => {
  const t = await fixture();
  await assert.rejects(rpc("mail_set_ai_scope", { p_id: t.id, p_revision: t.revision, p_approved: true, p_actor: OTHER, p_email: "admin@example.invalid" }), /mail_scope_identity/);
  await setScope(t, true);
  const audit = JSON.stringify((await db.query("select diff from public.admin_audit_log where action='mail_ai_scope'")).rows);
  assert.equal(audit.includes("synthetic@example.invalid"), false); assert.equal(audit.includes("Pouze smyšlený"), false);
  for (const role of ["anon", "authenticated"]) {
    await db.exec("reset role"); await db.exec("set role " + role);
    for (const query of ["select public.mail_ai_claim_scoped(false)", "select public.mail_ai_scope_active(null,false)", "select public.mail_ai_save_scoped('{}',false)", "select public.mail_set_ai_scope(null,1,true,null,null)", "select public.mail_ai_status_scoped(false)"])
      await assert.rejects(db.query(query), /permission denied/);
  }
});

test("scoped status distinguishes eligible queue from unmarked and explicitly blocked mail", async () => {
  const first=await fixture("first"), second=await fixture("second");
  const status=allow=>rpc("mail_ai_status_scoped",{p_allow_unmarked:allow});
  assert.deepEqual(await status(false),{queued:0,awaitingScope:2,processing:0,failed:0,completed:0});
  await setScope(first,true);
  assert.deepEqual(await status(false),{queued:1,awaitingScope:1,processing:0,failed:0,completed:0});
  assert.equal((await status(true)).queued,2);
  await setScope(second,false);
  assert.deepEqual(await status(true),{queued:1,awaitingScope:1,processing:0,failed:0,completed:0});
  assert.equal((await rpc("mail_ai_status")).queued,2);
  const active=await claim(false);
  assert.deepEqual(await status(false),{queued:0,awaitingScope:1,processing:1,failed:0,completed:0});
  await finish(active.lease);
  assert.deepEqual(await status(false),{queued:0,awaitingScope:1,processing:0,failed:0,completed:1});
});
