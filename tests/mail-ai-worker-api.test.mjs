import test from "node:test";
import assert from "node:assert/strict";
import { startAdminServer, token } from "./helpers/admin-server.mjs";

let server, id;
test.before(async () => { server = await startAdminServer(); });
test.after(async () => { await server?.close(); });
const call = async (path, data = {}, authorization = token) => {
  const response = await server.fetch(server.url + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: "Bearer " + authorization } : {}) },
    body: JSON.stringify(data),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
};
const worker = (authorization = process.env.CRON_SECRET) => call("/api/mail-ai-worker/", {}, authorization);
const admin = (data) => call("/api/admin-mail/", data);
const flags = (enabled) => Object.assign(process.env, {
  AI_TRIAGE_ENABLED: enabled ? "true" : "false",
  AI_EMAIL_CLASSIFICATION_ENABLED: enabled ? "true" : "false",
  AI_EMAIL_PROCESSING_APPROVED: enabled ? "true" : "false",
  AI_EMAIL_AUTOMATION_ENABLED: enabled ? "true" : "false",
});

test("imported synthetic mail is queued, while unauthorized or disabled HTTP workers consume no attempt", async () => {
  const rows = (await admin({ action: "list" })).data.rows;
  assert.equal(rows.length, 1);
  id = rows[0].id;
  let state = (await server.db.query("select revision,attempts,done from private.mail_ai_jobs where thread_id=$1", [id])).rows[0];
  assert.equal(state.attempts, 0);
  assert.equal(state.done, false);
  assert.equal((await worker("")).status, 401);
  const disabled = await worker();
  assert.equal(disabled.status, 200);
  assert.deepEqual(disabled.data, { skipped: true });
  assert.equal(disabled.headers.get("cache-control"), "no-store");
  assert.match(disabled.headers.get("x-robots-tag"), /noindex/);
  state = (await server.db.query("select attempts from private.mail_ai_jobs where thread_id=$1", [id])).rows[0];
  assert.equal(state.attempts, 0);
  assert.equal(server.metrics.ai, 0);
  assert.equal(server.metrics.external, 0);
});

test("approved worker executes real local queue and saves analysis visible through admin without changing human decisions", async () => {
  assert.equal((await admin({ action: "update", id, patch: { admin_category: "prace", admin_urgency: "high", status: "in_progress" } })).status, 200);
  flags(true);
  process.env.OPENAI_API_KEY = "synthetic-only";
  server.setAIResponse("success");
  const result = await worker();
  assert.equal(result.status, 200);
  assert.equal(result.data.processed, 1);
  assert.equal(result.data.saved, 1);
  assert.equal(server.metrics.ai, 1);
  const detail = (await admin({ action: "detail", id })).data;
  assert.equal(detail.thread.ai_category, "pravni");
  assert.equal(detail.thread.ai_urgency, "medium");
  assert.equal(detail.thread.category, "prace");
  assert.equal(detail.thread.urgency, "high");
  assert.equal(detail.thread.status, "in_progress");
  assert.ok(detail.thread.ai_summary);
  assert.equal(detail.thread.consent_state, "unknown");
  const again = await worker();
  assert.equal(again.data.processed, 0);
  assert.equal(again.data.empty, true);
  assert.equal(server.metrics.ai, 1);
});

test("new reply refreshes the queue; an invalid model result preserves source messages and retries later", async () => {
  const lease = (await server.db.query("select mail_sync_claim('veryvera@nadbytecna.cz','inbox','2026-11-01T00:00:00Z') result")).rows[0].result;
  await server.db.query("select mail_sync_commit($1,$2::jsonb,'[]'::jsonb,$3,true,$4)", [
    lease.lease,
    JSON.stringify([{
      external_id: "synthetic-reply-2", conversation_id: "synthetic-thread-1",
      sender_email: "pisatelka@example.invalid", subject: "Syntetická aktualizace",
      body_text: "THREAD PRIVATE CANARY — pouze vymyšlený obsah pro test.",
      received_at: new Date(Date.now() - 60000).toISOString(),
    }]),
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=synthetic-next",
    "synthetic-only-hash-secret-for-local-tests",
  ]);
  let queue = (await server.db.query("select * from private.mail_ai_jobs where thread_id=$1", [id])).rows[0];
  assert.equal(queue.done, false);
  assert.equal(queue.attempts, 0);
  server.setAIResponse("invalid");
  const failed = await worker();
  assert.equal(failed.status, 200);
  assert.equal(failed.data.failed, 1);
  const detail = (await admin({ action: "detail", id })).data;
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.thread.ai_error, "classification_failed");
  assert.equal(detail.thread.category, "prace");
  queue = (await server.db.query("select attempts,available_at>now() deferred from private.mail_ai_jobs where thread_id=$1", [id])).rows[0];
  assert.equal(queue.attempts, 1);
  assert.equal(queue.deferred, true);
  const before = server.metrics.ai;
  assert.equal((await worker()).data.processed, 0);
  assert.equal(server.metrics.ai, before);
  // Advancing only the throwaway local queue emulates the next scheduled retry.
  await server.db.query("update private.mail_ai_jobs set available_at=now() where thread_id=$1", [id]);
  server.setAIResponse("success");
  assert.equal((await worker()).data.saved, 1);
  assert.equal(server.metrics.ai, before + 1);
});

test("local erasure removes queued work, no sensitive payload enters audit and no real provider was reached", async () => {
  const audit = JSON.stringify((await server.db.query("select action,diff from admin_audit_log")).rows);
  assert.ok(audit.includes("mail_ai_automatic"));
  assert.ok(!audit.includes("THREAD PRIVATE CANARY"));
  assert.ok(!audit.includes("Syntetické shrnutí"));
  assert.equal((await admin({ action: "erase", id, confirm: "SMAZAT" })).status, 200);
  assert.equal((await server.db.query("select count(*)::int n from private.mail_ai_jobs where thread_id=$1", [id])).rows[0].n, 0);
  const before = server.metrics.ai;
  assert.equal((await worker()).data.processed, 0);
  assert.equal(server.metrics.ai, before);
  assert.equal(server.metrics.external, 0);
  assert.equal(server.metrics.mail, 0);
  assert.equal(server.metrics.graph, 0);
  assert.equal(server.metrics.oauth, 0);
  flags(false);
  server.setAIResponse(null);
});
