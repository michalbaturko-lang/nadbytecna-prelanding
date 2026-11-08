import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { freshAdminDb, ADMIN, OTHER, SESSION } from "./helpers/admin-db.mjs";
const SQL = fs.readFileSync(
  new URL(
    "../supabase/migrations/20261109000000_admin_mail.sql",
    import.meta.url,
  ),
  "utf8",
);
const MAILBOX = "veryvera@nadbytecna.cz",
  SECRET = "synthetic-mail-hash-secret-minimum-32-characters";
const actor = { actor_id: ADMIN, actor_email: "admin@example.invalid" };
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const msg = (id = "immutable-1", extra = {}) => ({
  external_id: id,
  conversation_id: "thread-1",
  internet_message_id: "<" + id + "@example.invalid>",
  sender_email: "sender@example.invalid",
  sender_name: "Syntetický odesílatel",
  subject: "Syntetický předmět",
  body_text: "Výhradně syntetický obsah zprávy.",
  received_at: daysAgo(1),
  ...extra,
});
let db;
test.beforeEach(async () => {
  db = await freshAdminDb();
  await db.exec(SQL);
  await db.exec("SET ROLE service_role");
});
test.afterEach(async () => {
  await db?.close();
});
const rpc = async (action, payload = {}) =>
  (
    await db.query("SELECT public.admin_mail($1,$2::jsonb) result", [
      action,
      JSON.stringify({ ...actor, ...payload }),
    ])
  ).rows[0].result;
const claim = async (folder = "inbox", since = daysAgo(90)) =>
  (
    await db.query("SELECT public.mail_sync_claim($1,$2,$3) result", [
      MAILBOX,
      folder,
      since,
    ])
  ).rows[0].result;
const commit = async (lease, messages, options = {}) =>
  (
    await db.query(
      "SELECT public.mail_sync_commit($1,$2::jsonb,$3::jsonb,$4,$5,$6) result",
      [
        lease,
        JSON.stringify(messages),
        JSON.stringify(options.removed || []),
        options.cursor || "opaque-cursor-synthetic",
        options.complete ?? true,
        options.secret || SECRET,
      ],
    )
  ).rows[0].result;
const sync = async (messages, options = {}) => {
  const lease = await claim(options.folder || "inbox");
  return commit(lease.lease, messages, options);
};
const firstThread = async () => (await rpc("list", { filters: {} })).rows[0];

test("email source RLS, RPC permissions and unknown consents", async () => {
  await sync([msg()]);
  const row = await firstThread();
  assert.equal(row.consent_state, "unknown");
  assert.equal(row.status, "new");
  assert.equal(row.email_type, null);
  assert.equal(row.consent_publish, undefined);
  assert.equal(row.age_confirmed, undefined);
  for (const role of ["anon", "authenticated"]) {
    await db.exec("RESET ROLE");
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [OTHER, JSON.stringify({ session_id: SESSION })],
    );
    await db.exec("SET ROLE " + role);
    for (const table of ["email_threads", "email_messages", "email_notes"]) {
      if (role === "anon")
        await assert.rejects(
          () => db.query("SELECT * FROM " + table),
          /permission denied/,
        );
      else
        assert.equal(
          (await db.query("SELECT count(*)::int n FROM " + table)).rows[0].n,
          0,
        );
      await assert.rejects(
        () => db.query("DELETE FROM " + table),
        /permission denied/,
      );
    }
    await assert.rejects(() => rpc("list"), /permission denied/);
    await assert.rejects(() => claim(), /permission denied/);
  }
  await db.exec("RESET ROLE; SET ROLE service_role");
  await db.query("SELECT admin_access($1,'admin@example.invalid',$2)", [
    ADMIN,
    SESSION,
  ]);
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    ADMIN,
  ]);
  await db.exec("SET ROLE authenticated");
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM email_messages")).rows[0].n,
    1,
  );
  await assert.rejects(
    () => db.query("UPDATE email_threads SET status='archived'"),
    /permission denied/,
  );
});

test("HMAC is standard SHA256 and changed secret is refused", async () => {
  const value = "message:" + MAILBOX + ":immutable-1";
  const actual = (
    await db.query("SELECT private.mail_hash($1,$2) value", [value, SECRET])
  ).rows[0].value;
  assert.equal(
    actual,
    crypto.createHmac("sha256", SECRET).update(value).digest("hex"),
  );
  await sync([msg()]);
  const lease = await claim();
  await assert.rejects(
    () =>
      commit(lease.lease, [msg()], {
        secret: "another-synthetic-secret-minimum-32-characters",
      }),
    /mail_hash_changed/,
  );
});

test("immutable-ID dedup and cursor commit are atomic; content revisions preserve manual work", async () => {
  const original = msg();
  await sync([original]);
  let row = await firstThread();
  const revision = row.revision;
  await rpc("mutate", {
    id: row.id,
    patch: {
      admin_category: "pravni",
      admin_urgency: "high",
      email_type: "help",
      status: "in_progress",
    },
  });
  await rpc("note", { id: row.id, body: "Syntetická interní poznámka." });
  assert.equal(
    (
      await rpc("ai_save", {
        id: row.id,
        revision,
        error: false,
        email_type: "story",
        summary: "Syntetické shrnutí.",
        category: "terapie",
        urgency: "low",
        help_type: "Ověřit potřeby.",
        model: "synthetic-model",
      })
    ).saved,
    true,
  );
  await sync([original]);
  row = await firstThread();
  assert.equal(row.revision, revision);
  assert.equal(row.ai_summary, "Syntetické shrnutí.");
  assert.equal(row.category, "pravni");
  assert.equal(row.urgency, "high");
  assert.equal(row.email_type, "help");
  await sync([{ ...original, body_text: "Nový syntetický obsah." }]);
  row = await firstThread();
  assert.ok(row.revision > revision);
  assert.equal(row.ai_summary, null);
  assert.equal(row.category, "pravni");
  assert.equal((await rpc("detail", { id: row.id })).notes.length, 1);
  assert.deepEqual(
    await rpc("ai_save", {
      id: row.id,
      revision,
      error: false,
      email_type: "other",
      summary: "Stará odpověď.",
      category: null,
      urgency: "low",
    }),
    { saved: false, reason: "changed" },
  );
  const lease = await claim();
  await assert.rejects(
    () =>
      commit(
        lease.lease,
        [
          msg("will-rollback"),
          msg("invalid", { body_text: "x".repeat(100001) }),
        ],
        { cursor: "must-not-commit" },
      ),
    /mail_message_input/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM email_messages WHERE external_id='will-rollback'",
      )
    ).rows[0].n,
    0,
  );
  assert.notEqual(
    (await db.query("SELECT cursor FROM private.mail_sync_state")).rows[0]
      .cursor,
    "must-not-commit",
  );
});

test("thread erasure suppresses copies after cursor reset and late AI cannot recreate them", async () => {
  const original = msg();
  await sync([original]);
  const row = await firstThread();
  await rpc("thread_erase", { id: row.id, hash_secret: SECRET });
  assert.equal((await rpc("list")).total, 0);
  await db.exec("UPDATE private.mail_sync_state SET cursor=NULL");
  assert.equal((await sync([original])).skipped, 1);
  assert.equal((await rpc("list")).total, 0);
  assert.deepEqual(
    await rpc("ai_save", {
      id: row.id,
      revision: row.revision,
      error: false,
      email_type: "story",
      summary: "Pozdní výsledek.",
      category: "pribeh",
      urgency: "low",
    }),
    { saved: false, reason: "missing" },
  );
  await sync([msg("new-reply", { received_at: new Date().toISOString() })]);
  assert.equal((await rpc("list")).total, 1);
});

test("sender export and erasure preserve other senders in the same thread without derived-data leakage", async () => {
  const a = msg("person-a", {
      sender_email: "a@example.invalid",
      subject: "Osoba A",
      received_at: daysAgo(2),
    }),
    b = msg("person-b", {
      sender_email: "b@example.invalid",
      subject: "Osoba B",
      body_text: "PRIVATE_OTHER_SENDER",
      received_at: daysAgo(1),
    });
  await sync([a, b]);
  const row = await firstThread();
  await rpc("note", {
    id: row.id,
    body: "Syntetická poznámka ke společnému vláknu.",
  });
  await rpc("ai_save", {
    id: row.id,
    revision: row.revision,
    error: false,
    email_type: "other",
    summary: "PRIVATE_OTHER_DERIVED",
    category: null,
    urgency: "low",
    model: "synthetic",
  });
  const exported = await rpc("export", { email: "a@example.invalid" });
  assert.equal(exported.messages.length, 1);
  assert.equal(exported.messages[0].sender_email, "a@example.invalid");
  assert.ok(!JSON.stringify(exported).includes("PRIVATE_OTHER"));
  assert.equal(exported.notes.length, 1);
  assert.equal(exported.requires_review, true);
  const erased = await rpc("erase", {
    email: "a@example.invalid",
    hash_secret: SECRET,
    email_hash: "a".repeat(64),
  });
  assert.equal(erased.messages_deleted, 1);
  assert.equal(erased.threads_deleted, 0);
  const detail = await rpc("detail", { id: row.id });
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].sender_email, "b@example.invalid");
  assert.equal(detail.thread.ai_summary, null);
  assert.equal(detail.notes.length, 0);
  assert.ok(detail.thread.revision > row.revision);
  assert.equal((await sync([a])).skipped, 1);
  assert.equal(
    (
      await sync([
        msg("old-unseen", {
          sender_email: "a@example.invalid",
          received_at: daysAgo(3),
        }),
      ])
    ).skipped,
    1,
  );
  assert.equal(
    (
      await sync([
        msg("future-a", {
          sender_email: "a@example.invalid",
          received_at: new Date(Date.now() + 60000).toISOString(),
        }),
      ])
    ).imported,
    1,
  );
});

test("retention requires an explicit cutoff and only removes expired local copies", async () => {
  const old = msg("old", { received_at: daysAgo(40) }),
    recent = msg("recent", { received_at: daysAgo(1) });
  await sync([old, recent]);
  const cutoff = daysAgo(30);
  await assert.rejects(
    () => rpc("retention", {}),
    /mail_retention_configuration/,
  );
  const dry = await rpc("retention", { cutoff });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.messages, 1);
  assert.equal(
    (await rpc("detail", { id: (await firstThread()).id })).message_count,
    2,
  );
  const removed = await rpc("retention", {
    cutoff,
    dry_run: false,
    hash_secret: SECRET,
  });
  assert.equal(removed.messages_deleted, 1);
  assert.equal(
    (await rpc("detail", { id: (await firstThread()).id })).message_count,
    1,
  );
  assert.equal((await sync([old])).skipped, 1);
  assert.equal(
    (
      await sync([msg("old-unseen-folder", { received_at: daysAgo(50) })], {
        folder: "new-folder",
      })
    ).skipped,
    1,
  );
});

test("detail limits messages and hides integration identifiers, status hides cursor and body", async () => {
  await sync(
    Array.from({ length: 22 }, (_, i) =>
      msg("many-" + i, { received_at: daysAgo(1 + i / 24) }),
    ),
  );
  const row = await firstThread();
  const detail = await rpc("detail", { id: row.id });
  assert.equal(detail.messages.length, 20);
  assert.equal(detail.message_count, 22);
  assert.equal(detail.messages_truncated, true);
  const older = await rpc("detail", { id: row.id, message_page: 1 });
  assert.equal(older.message_page, 1);
  assert.equal(older.messages.length, 2);
  assert.ok(
    older.messages.every((m) => !detail.messages.some((n) => n.id === m.id)),
  );
  for (const m of detail.messages)
    for (const key of [
      "message_hash",
      "internet_hash",
      "sender_hash",
      "external_id",
      "mailbox",
      "internet_message_id",
    ])
      assert.equal(m[key], undefined);
  const status = await rpc("status");
  assert.ok(status.lastSyncAt);
  assert.equal(status.lastError, null);
  assert.equal(status.cursor, undefined);
  assert.ok(!JSON.stringify(status).includes("opaque-cursor-synthetic"));
});

test("sync leases, retry-after, deletion markers and secret-free audits", async () => {
  let lease = await claim();
  assert.equal(await claim(), null);
  await commit(lease.lease, [msg()], { removed: ["immutable-1"] });
  assert.ok(
    (await db.query("SELECT source_removed_at FROM email_messages")).rows[0]
      .source_removed_at,
  );
  lease = await claim();
  await db.query("SELECT mail_sync_release($1,'throttled',120)", [lease.lease]);
  assert.equal(await claim(), null);
  const status = await rpc("status");
  assert.equal(status.lastError, "throttled");
  assert.ok(status.retryAfter);
  const logs = JSON.stringify(
    (await db.query("SELECT * FROM admin_audit_log WHERE action LIKE 'mail_%'"))
      .rows,
  );
  for (const secret of [
    SECRET,
    "Výhradně syntetický",
    "Syntetický předmět",
    "sender@example.invalid",
    "opaque-cursor-synthetic",
  ])
    assert.ok(!logs.includes(secret));
});

test("mail migration is repeatable without creating legacy preregistrations", async () => {
  await db.exec("RESET ROLE");
  await db.exec(SQL);
  assert.equal(
    (await db.query("SELECT to_regclass('public.preregistrations') name"))
      .rows[0].name,
    null,
  );
});

test("large mail export is rejected before JSON aggregation instead of truncating silently", async () => {
  await sync(
    Array.from({ length: 30 }, (_, i) =>
      msg("large-" + i, { body_text: "x".repeat(95000) }),
    ),
  );
  const row = await firstThread();
  await assert.rejects(
    () => rpc("thread_export", { id: row.id }),
    /mail_export_too_large/,
  );
  await assert.rejects(
    () => rpc("export", { email: "sender@example.invalid" }),
    /mail_export_too_large/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM email_messages")).rows[0].n,
    30,
  );
});
