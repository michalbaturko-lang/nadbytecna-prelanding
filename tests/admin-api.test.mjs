import test from "node:test";
import assert from "node:assert/strict";
import {
  startAdminServer,
  token,
  otherToken,
} from "./helpers/admin-server.mjs";
import { STORY } from "./helpers/admin-db.mjs";
import { unzipSync, strFromU8 } from "fflate";
let s;
test.before(async () => {
  s = await startAdminServer();
});
test.after(async () => {
  await s?.close();
});
const call = (body, t = token) =>
  s.fetch(s.url + "/api/admin/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: "Bearer " + t } : {}),
    },
    body: JSON.stringify(body),
  });
test("admin API rejects unauthenticated 401 and outsider 403 before data", async () => {
  assert.equal((await call({ action: "list" }, "")).status, 401);
  assert.equal((await call({ action: "init" }, otherToken)).status, 403);
});
test("dashboard, pagination, accent-free search and URL filter validation", async () => {
  let r = await call({ action: "init" });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.categories.length, 8);
  assert.equal(d.aiEnabled, false);
  d = await (await call({ action: "list", filters: {} })).json();
  assert.equal(d.rows.length, 25);
  assert.equal(d.total, 30);
  const second = await (
    await call({ action: "list", filters: { page: 1 } })
  ).json();
  assert.equal(second.rows.length, 5);
  assert.ok(second.rows.every((x) => !d.rows.some((y) => x.id === y.id)));
  assert.equal(
    (await call({ action: "list", filters: { entity: "stories)" } })).status,
    400,
  );
});
test("AI disabled never calls external network and manual publish is guarded", async () => {
  const before = s.metrics.external;
  assert.equal(
    (await call({ action: "ai", entity: "stories", id: STORY })).status,
    423,
  );
  assert.equal(s.metrics.external, before);
  assert.equal(
    (
      await call({
        action: "update",
        entity: "stories",
        id: "66666666-6666-4666-8666-666666666666",
        patch: { status: "published" },
      })
    ).status,
    404,
  );
});
test("detail, note, signed audio, CSV and GDPR ZIP are audited", async () => {
  let r = await call({ action: "detail", entity: "stories", id: STORY });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.proposals.length, 1);
  assert.equal(
    (
      await call({
        action: "note",
        entity: "stories",
        id: STORY,
        body: "Syntetická interní poznámka.",
      })
    ).status,
    200,
  );
  d = await (
    await call({ action: "audio", entity: "stories", id: STORY })
  ).json();
  assert.equal(d.expiresIn, 120);
  r = await call({ action: "csv", filters: {}, includeText: false });
  assert.equal(r.status, 200);
  const csv = await r.text();
  assert.ok(csv.includes(";"));
  assert.ok(!csv.includes("Pouze syntetická zpráva"));
  r = await call({ action: "person_export", entity: "stories", id: STORY });
  assert.equal(r.status, 200);
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  assert.ok(files["data.json"]);
  assert.ok(Object.keys(files).some((x) => x.startsWith("audio/")));
  assert.equal(JSON.parse(strFromU8(files["data.json"])).records.length, 1);
  const actions = (
    await s.db.query("select action from admin_audit_log")
  ).rows.map((x) => x.action);
  for (const a of [
    "login",
    "view_detail",
    "note",
    "play_audio",
    "export_csv",
    "export_person",
  ])
    assert.ok(actions.includes(a), a);
});
test("retention dry run and worker disabled; zero mail and external calls", async () => {
  for (const path of ["retention", "ai-worker"]) {
    let r = await s.fetch(s.url + "/api/" + path + "/", {
      headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
    });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.ok(d.dryRun || d.skipped);
  }
  assert.equal(s.metrics.external, 0);
  assert.equal(s.metrics.mail, 0);
});

test("AI timeout, API error and invalid category preserve submission and show a persisted safe error", async () => {
  process.env.AI_TRIAGE_ENABLED = "true";
  process.env.OPENAI_API_KEY = "synthetic-only";
  for (const mode of ["timeout", "error", "invalid"]) {
    s.setAIResponse(mode);
    assert.equal(
      (await call({ action: "ai", entity: "stories", id: STORY })).status,
      502,
    );
    const row = (
      await s.db.query(
        "select ai_error,admin_category,story_text from stories where id=$1",
        [STORY],
      )
    ).rows[0];
    assert.equal(row.ai_error, "triage_failed");
    assert.equal(row.admin_category, "pravni");
    assert.ok(row.story_text);
  }
  s.setAIResponse("valid");
  assert.equal(
    (await call({ action: "ai", entity: "stories", id: STORY })).status,
    200,
  );
  const r = (
    await s.db.query("select category,urgency from admin_records where id=$1", [
      STORY,
    ])
  ).rows[0];
  assert.equal(r.category, "pravni");
  assert.equal(r.urgency, "acute");
  s.setAIResponse(null);
  process.env.AI_TRIAGE_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
});

test("person erasure removes stored audio and record; audit retains hash only", async () => {
  const r = await call({
    action: "person_erase",
    entity: "stories",
    id: STORY,
    confirm: "SMAZAT",
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await s.db.query("select count(*)::int n from stories where id=$1", [
        STORY,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(s.storage.size, 0);
  const logs = JSON.stringify(
    (await s.db.query("select * from admin_audit_log")).rows,
  );
  assert.ok(!logs.includes(STORY));
  assert.ok(logs.includes("email_hash"));
});

test("email-based GDPR handles a signup without a story and exports original preregistration", async () => {
  await s.db.query(
    `INSERT INTO preregistrations(email,email_normalized,consent_version,consent_text) VALUES('gdpr@example.invalid','gdpr@example.invalid','synthetic-v1','Syntetický souhlas')`,
  );
  const r = await call({
    action: "person_export",
    email: "gdpr@example.invalid",
  });
  assert.equal(r.status, 200);
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const d = JSON.parse(strFromU8(files["data.json"]));
  assert.equal(d.records.length, 0);
  assert.equal(d.preregistrations.length, 1);
  assert.equal(
    (
      await call({
        action: "person_erase",
        email: "gdpr@example.invalid",
        confirm: "SMAZAT",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await s.db.query(
        `select count(*)::int n from preregistrations where email_normalized='gdpr@example.invalid'`,
      )
    ).rows[0].n,
    0,
  );
});
test("legacy foreign audio reference fails closed for signing, export, erasure, worker and retention", async () => {
  const victim = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const legacy = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const victimPath = victim + "/victim.wav";
  await s.db.query(
    `INSERT INTO stories(id,email,consent,age_confirmed,audio_path) VALUES($1,'victim@example.invalid',true,true,$2)`,
    [victim, victimPath],
  );
  await s.db.query(
    `INSERT INTO stories(id,email,consent,consent_transcript,age_confirmed,created_at,audio_path) VALUES($1,'legacy-binding@example.invalid',true,true,true,now()-interval '13 months',$2)`,
    [legacy, legacy + "/legacy.wav"],
  );
  s.storage.set(victimPath, Buffer.from("synthetic-victim-audio"));
  // Emulate a pre-migration row without weakening the production insert guard.
  await s.db.exec("ALTER TABLE stories DISABLE TRIGGER workspace_guard");
  try {
    await s.db.query("UPDATE stories SET audio_path=$2 WHERE id=$1", [
      legacy,
      victimPath,
    ]);
  } finally {
    await s.db.exec("ALTER TABLE stories ENABLE TRIGGER workspace_guard");
  }
  const signedBefore = s.metrics.signed;
  assert.equal(
    (await call({ action: "audio", entity: "stories", id: legacy })).status,
    400,
  );
  assert.equal(s.metrics.signed, signedBefore);
  assert.equal(
    (
      await call({
        action: "person_export",
        email: "legacy-binding@example.invalid",
      })
    ).status,
    400,
  );
  // Worker must reject the old reference before downloading it or calling a model.
  await s.db.exec("UPDATE private.ai_jobs SET done=true");
  await s.db.query("UPDATE private.ai_jobs SET done=false WHERE entity_id=$1", [
    legacy,
  ]);
  const aiBefore = s.metrics.ai;
  process.env.AI_TRIAGE_ENABLED = "true";
  process.env.AI_TRANSCRIPTION_ENABLED = "true";
  process.env.OPENAI_API_KEY = "synthetic-only";
  s.setAIResponse("valid");
  const worker = await s.fetch(s.url + "/api/ai-worker/", {
    headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
  });
  assert.equal(worker.status, 200);
  assert.equal((await worker.json()).ok, false);
  assert.equal(s.metrics.ai, aiBefore);
  process.env.AI_TRIAGE_ENABLED = "false";
  process.env.AI_TRANSCRIPTION_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
  s.setAIResponse(null);
  assert.equal(
    (
      await call({
        action: "person_erase",
        email: "legacy-binding@example.invalid",
        confirm: "SMAZAT",
      })
    ).status,
    400,
  );
  assert.ok(s.storage.has(victimPath));
  process.env.RETENTION_ENABLED = "true";
  const retention = await s.fetch(s.url + "/api/retention/", {
    headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
  });
  process.env.RETENTION_ENABLED = "false";
  assert.equal(retention.status, 503);
  assert.ok(s.storage.has(victimPath));
  assert.equal(
    (
      await s.db.query("SELECT count(*)::int n FROM stories WHERE id=$1", [
        victim,
      ])
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.query("SELECT count(*)::int n FROM stories WHERE id=$1", [
        legacy,
      ])
    ).rows[0].n,
    1,
  );
});

test("manual AI requires processing consent even when the global flag is enabled", async () => {
  const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await s.db.query(
    `INSERT INTO stories(id,email,consent,story_text) VALUES($1,'no-consent@example.invalid',false,'Syntetická zpráva bez souhlasu.')`,
    [id],
  );
  process.env.AI_TRIAGE_ENABLED = "true";
  process.env.OPENAI_API_KEY = "synthetic-only";
  s.setAIResponse("valid");
  const before = s.metrics.ai;
  assert.equal(
    (await call({ action: "ai", entity: "stories", id })).status,
    409,
  );
  assert.equal(s.metrics.ai, before);
  s.setAIResponse(null);
  process.env.AI_TRIAGE_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
});
