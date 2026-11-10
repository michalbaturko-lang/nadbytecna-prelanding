import test from "node:test";
import assert from "node:assert/strict";
import {
  startAdminServer,
  token,
  otherToken,
} from "./helpers/admin-server.mjs";
import { unzipSync, strFromU8 } from "fflate";
import { generateKeyPairSync } from "node:crypto";
let s, id;
test.before(async () => {
  s = await startAdminServer();
});
test.after(async () => {
  await s?.close();
});
const call = (body, t = token, path = "/api/admin-mail/") =>
  s.fetch(s.url + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: "Bearer " + t } : {}),
    },
    body: JSON.stringify(body),
  });
test("mail API denies anonymous, outsider and foreign origins before returning mail", async () => {
  assert.equal((await call({ action: "list" }, "")).status, 401);
  assert.equal((await call({ action: "list" }, otherToken)).status, 403);
  assert.equal(
    (
      await s.fetch(s.url + "/api/admin-mail/", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          Origin: "https://foreign.invalid",
        },
        body: "{}",
      })
    ).status,
    403,
  );
});
test("mail status exposes safe setup information and disabled cron does no network or DB changes", async () => {
  const before = s.metrics.external;
  const d = await (await call({ action: "status" })).json();
  assert.equal(d.mailbox, "veryvera@nadbytecna.cz");
  assert.equal(d.syncEnabled, false);
  assert.equal(d.aiEnabled, false);
  assert.equal(JSON.stringify(d).includes("deltatoken"), false);
  assert.equal((await call({}, "", "/api/mail-sync/")).status, 401);
  const r = await call({}, process.env.CRON_SECRET, "/api/mail-sync/");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).skipped, true);
  assert.equal(s.metrics.external, before);
});
test("mail list/detail and classification preserve unknown web consent and block publishing", async () => {
  let r = await call({ action: "list", filters: {} });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.total, 1);
  id = d.rows[0].id;
  d = await (await call({ action: "detail", id })).json();
  assert.equal(d.messages.length, 1);
  assert.match(d.messages[0].body_text, /smyšlený/);
  assert.notEqual(d.thread.consent_publish, true);
  assert.notEqual(d.thread.age_confirmed, true);
  assert.equal(
    (await call({ action: "update", id, patch: { status: "published" } }))
      .status,
    400,
  );
  assert.equal(
    (
      await call({
        action: "update",
        id,
        patch: {
          status: "in_progress",
          email_type: "story",
          admin_category: "pravni",
          admin_urgency: "high",
        },
      })
    ).status,
    200,
  );
  d = await (await call({ action: "detail", id })).json();
  assert.equal(d.thread.category, "pravni");
  assert.equal(d.thread.urgency, "high");
  assert.equal(d.thread.email_type, "story");
  assert.equal(
    (await call({ action: "note", id, text: "Výhradně testovací poznámka." }))
      .status,
    200,
  );
  d = await (await call({ action: "detail", id })).json();
  assert.equal(d.notes.length, 1);
  const before = s.metrics.external;
  assert.equal((await call({ action: "ai", id })).status, 423);
  assert.equal(s.metrics.external, before);
});
test("AI scope marking requires an admin, valid boolean and current content revision", async () => {
  const current=(await(await call({action:"detail",id})).json()).thread;
  const request={action:"ai_scope",id,revision:current.revision,approved:true};
  assert.equal((await call(request,"")).status,401);
  assert.equal((await call(request,otherToken)).status,403);
  assert.equal((await call({...request,approved:"true"})).status,400);
  assert.deepEqual(await(await call({...request,revision:current.revision+1})).json(),{saved:false,reason:"changed"});
  assert.equal((await(await call({action:"detail",id})).json()).thread.ai_scope_approved,false);
});
test("approved mail AI fallback retains messages and successful AI preserves manual category", async () => {
  Object.assign(process.env, {
    AI_TRIAGE_ENABLED: "true",
    AI_EMAIL_CLASSIFICATION_ENABLED: "true",
    AI_EMAIL_PROCESSING_APPROVED: "true",
    OPENAI_API_KEY: "synthetic-only",
    AI_EMAIL_SCOPE: "marked",
  });
  try {
    const before=s.metrics.ai;
    assert.equal((await call({action:"ai",id})).status,423);
    assert.equal(s.metrics.ai,before);
    const current=(await(await call({action:"detail",id})).json()).thread;
    assert.equal((await call({action:"ai_scope",id,revision:current.revision,approved:true})).status,200);
    s.setAIResponse("timeout");
    assert.equal((await call({ action: "ai", id })).status, 502);
    let d = await (await call({ action: "detail", id })).json();
    assert.equal(d.messages.length, 1);
    assert.ok(d.thread.ai_error);
    s.setAIResponse("invalid");
    assert.equal((await call({ action: "ai", id })).status, 502);
    s.setAIResponse("success");
    assert.equal((await call({ action: "ai", id })).status, 200);
    d = await (await call({ action: "detail", id })).json();
    assert.equal(d.thread.category, "pravni");
    assert.equal(d.thread.urgency, "high");
    assert.ok(d.thread.ai_summary);
  } finally {
    s.setAIResponse(null);
    process.env.AI_TRIAGE_ENABLED = "false";
    process.env.AI_EMAIL_CLASSIFICATION_ENABLED = "false";
    process.env.AI_EMAIL_PROCESSING_APPROVED = "false";
    delete process.env.OPENAI_API_KEY;
  }
});
test("person export includes imported email copies and person erase suppresses reimport", async () => {
  let r = await call(
    { action: "person_export", email: "pisatelka@example.invalid" },
    token,
    "/api/admin/",
  );
  assert.equal(r.status, 200);
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const person = JSON.parse(strFromU8(files["data.json"]));
  assert.equal(person.email_source.messages.length, 1);
  r = await call(
    {
      action: "person_erase",
      email: "pisatelka@example.invalid",
      confirm: "SMAZAT",
    },
    token,
    "/api/admin/",
  );
  assert.equal(r.status, 200);
  const d = await (await call({ action: "list", filters: {} })).json();
  assert.equal(d.total, 0);
  // No Graph request occurred during either local operation.
  assert.equal(s.metrics.external, 0);
});
test("cron performs certificate OAuth plus read-only Graph import and respects prior local erasure", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    M365_INGEST_ENABLED: "true",
    M365_MAILBOX: "veryvera@nadbytecna.cz",
    M365_FOLDER_ID: "inbox",
    M365_SINCE: "2026-11-01T00:00:00Z",
    M365_TENANT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    M365_CLIENT_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    M365_CERT_SHA256_THUMBPRINT: "ab".repeat(32),
    M365_CERT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  try {
    s.setMailResponse("success");
    let r = await call({}, process.env.CRON_SECRET, "/api/mail-sync/");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(s.metrics.graph, 1);
    assert.equal(s.metrics.oauth, 1);
    assert.equal((await (await call({ action: "list" })).json()).total, 0);
    s.setMailResponse("expired");
    r = await call({}, process.env.CRON_SECRET, "/api/mail-sync/");
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, "cursor_expired");
    const status = await (await call({ action: "status" })).json();
    assert.equal(status.lastError, "cursor_expired");
    assert.equal(JSON.stringify(status).includes("synthetic2"), false);
    assert.equal(s.metrics.external, 0);
  } finally {
    s.setMailResponse(null);
    process.env.M365_INGEST_ENABLED = "false";
    for (const k of [
      "M365_MAILBOX",
      "M365_FOLDER_ID",
      "M365_SINCE",
      "M365_TENANT_ID",
      "M365_CLIENT_ID",
      "M365_CERT_SHA256_THUMBPRINT",
      "M365_CERT_PRIVATE_KEY",
    ])
      delete process.env[k];
  }
});
