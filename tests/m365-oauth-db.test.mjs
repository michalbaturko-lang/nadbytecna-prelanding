import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { freshAdminDb, ADMIN, OTHER, SESSION } from "./helpers/admin-db.mjs";
const dir = new URL("../supabase/migrations/", import.meta.url);
const MAIL_SQL = fs.readFileSync(
  new URL("20261109000000_admin_mail.sql", dir),
  "utf8",
);
const SQL = fs.readFileSync(
  new URL("20261110000000_mail_oauth.sql", dir),
  "utf8",
);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  OTHER_TENANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  MAILBOX = "veryvera@nadbytecna.cz";
const actor = { actor_id: ADMIN, actor_email: "admin@example.invalid" };
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
function seal(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", Buffer.alloc(32, 7), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    }),
  ).toString("base64");
}
const FLOW = seal(
  JSON.stringify({ pkce_verifier: "DO_NOT_STORE_PLAINTEXT_PKCE" }),
);
const CACHE = seal(
  JSON.stringify({ refresh_token: "DO_NOT_STORE_PLAINTEXT_REFRESH" }),
);
let db;
test.beforeEach(async () => {
  db = await freshAdminDb();
  await db.exec(MAIL_SQL);
  await db.exec(SQL);
  await db.exec("SET ROLE service_role");
  await db.query("SELECT admin_access($1,'admin@example.invalid',$2)", [
    ADMIN,
    SESSION,
  ]);
});
test.afterEach(async () => {
  await db?.close();
});
const oauth = async (action, payload = {}, asAdmin = true) =>
  (
    await db.query("SELECT mail_oauth($1,$2::jsonb) result", [
      action,
      JSON.stringify({ ...(asAdmin ? actor : {}), ...payload }),
    ])
  ).rows[0].result;
const issue = async (label = "one") =>
  oauth("issue", {
    tenant_id: TENANT,
    token_hash: hash("INVITE_RAW_" + label),
  });
const begin = async (label = "one") =>
  oauth(
    "begin",
    {
      token_hash: hash("INVITE_RAW_" + label),
      state_hash: hash("STATE_RAW_" + label),
      cookie_hash: hash("COOKIE_RAW_" + label),
      encrypted_flow: FLOW,
    },
    false,
  );
const claim = async (label = "one", cookie = "COOKIE_RAW_" + label) =>
  oauth(
    "callback_claim",
    { state_hash: hash("STATE_RAW_" + label), cookie_hash: hash(cookie) },
    false,
  );
const save = async (id, patch = {}) =>
  oauth(
    "save_connection",
    {
      attempt_id: id,
      ciphertext: CACHE,
      account_id: "synthetic-home-account-id",
      tenant_id: TENANT,
      mailbox: MAILBOX,
      ...patch,
    },
    false,
  );
const connect = async (label = "one") => {
  await issue(label);
  const b = await begin(label);
  const c = await claim(label);
  assert.equal(c.attempt_id, b.attempt_id);
  return save(c.attempt_id);
};

test("service-only OAuth RPC and private storage never grant mailbox user admin access", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec("RESET ROLE;SET ROLE " + role);
    await assert.rejects(() => oauth("status", {}, false), /permission denied/);
    for (const table of [
      "mail_oauth_control",
      "mail_oauth_invitations",
      "mail_oauth_attempts",
    ])
      await assert.rejects(
        () => db.query("SELECT * FROM private." + table),
        /permission denied/,
      );
  }
  await db.exec("RESET ROLE;SET ROLE service_role");
  await assert.rejects(
    () =>
      oauth("issue", {
        tenant_id: TENANT,
        token_hash: hash("outsider"),
        actor_id: OTHER,
        actor_email: "other@example.invalid",
      }),
    /oauth_admin/,
  );
  const adminsBefore = (await db.query("SELECT count(*)::int n FROM admins"))
    .rows[0].n;
  await connect();
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM admins")).rows[0].n,
    adminsBefore,
  );
  assert.equal(
    (
      await db.query(
        "SELECT prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='mail_oauth'",
      )
    ).rows[0].prosecdef,
    false,
  );
});

test("invitations expire in 30 minutes and begin consumes exactly once", async () => {
  const invitation = await issue();
  const ttl = (
    await db.query(
      "SELECT extract(epoch FROM expires_at-issued_at)::int ttl FROM private.mail_oauth_invitations WHERE id=$1",
      [invitation.invitation_id],
    )
  ).rows[0].ttl;
  assert.equal(ttl, 1800);
  const attempt = await begin();
  assert.ok(attempt.attempt_id);
  assert.equal(attempt.mailbox, MAILBOX);
  assert.equal(attempt.tenant_id, TENANT);
  assert.equal(await begin(), null);
  assert.equal(
    (await db.query("SELECT status FROM private.mail_oauth_invitations"))
      .rows[0].status,
    "consumed",
  );
  await issue("expired");
  await db.exec(
    "UPDATE private.mail_oauth_invitations SET expires_at=now()-interval '1 second' WHERE status='issued'",
  );
  assert.equal(await begin("expired"), null);
});

test("callback claim is bound to browser cookie and exposes encrypted flow once before exchange", async () => {
  await issue();
  const attempt = await begin();
  assert.equal(await claim("one", "wrong-browser-cookie"), null);
  const first = await claim();
  assert.equal(first.encrypted_flow, FLOW);
  assert.equal(first.attempt_id, attempt.attempt_id);
  assert.equal(await claim(), null);
  const stored = (
    await db.query(
      "SELECT status,encrypted_flow FROM private.mail_oauth_attempts",
    )
  ).rows[0];
  assert.equal(stored.status, "claimed");
  assert.equal(stored.encrypted_flow, null);
  const connected = await save(attempt.attempt_id);
  assert.equal(connected.saved, true);
  assert.equal((await save(attempt.attempt_id)).saved, false);
});

test("expired attempts cannot exchange saved flow and unused encrypted flow is cleared", async () => {
  await issue();
  const attempt = await begin();
  await db.query(
    "UPDATE private.mail_oauth_attempts SET expires_at=now()-interval '1 second' WHERE id=$1",
    [attempt.attempt_id],
  );
  assert.equal(await claim(), null);
  const stored = (
    await db.query(
      "SELECT status,encrypted_flow FROM private.mail_oauth_attempts",
    )
  ).rows[0];
  assert.equal(stored.status, "expired");
  assert.equal(stored.encrypted_flow, null);
  assert.equal((await save(attempt.attempt_id)).saved, false);
});

test("only configured mailbox and tenant can connect, mismatched exchange burns attempt", async () => {
  for (const [label, patch] of [
    ["mailbox", { mailbox: "different@example.invalid" }],
    ["tenant", { tenant_id: OTHER_TENANT }],
  ]) {
    await issue(label);
    const attempt = await begin(label);
    await claim(label);
    const result = await save(attempt.attempt_id, patch);
    assert.deepEqual(result, { saved: false, reason: "account_mismatch" });
    assert.equal((await save(attempt.attempt_id)).saved, false);
    assert.equal(await oauth("cache_get", {}, false), null);
  }
  await assert.rejects(
    () =>
      oauth("issue", {
        tenant_id: OTHER_TENANT,
        token_hash: hash("wrong-tenant-config"),
      }),
    /oauth_tenant_configuration/,
  );
});

test("cache refresh uses generation and version CAS and reconnect keeps existing connection until success", async () => {
  await connect();
  const cache = await oauth("cache_get", {}, false);
  assert.equal(cache.ciphertext, CACHE);
  const updated = seal("SYNTHETIC_ROTATED_CACHE");
  const result = await oauth(
    "cache_set",
    {
      ciphertext: updated,
      expected_version: cache.version,
      expected_generation: cache.generation,
    },
    false,
  );
  assert.equal(result.saved, true);
  assert.equal(
    (
      await oauth(
        "cache_set",
        {
          ciphertext: CACHE,
          expected_version: cache.version,
          expected_generation: cache.generation,
        },
        false,
      )
    ).saved,
    false,
  );
  const before = await oauth("cache_get", {}, false);
  await issue("reconnect");
  const after = await oauth("cache_get", {}, false);
  assert.equal(after.ciphertext, updated);
  assert.ok(after.generation > before.generation);
  assert.equal(
    (
      await oauth(
        "cache_set",
        {
          ciphertext: CACHE,
          expected_version: before.version,
          expected_generation: before.generation,
        },
        false,
      )
    ).saved,
    false,
  );
});

test("new invitation invalidates already claimed callback and revoke prevents retry", async () => {
  await issue();
  const oldAttempt = await begin();
  await claim();
  const next = await issue("two");
  assert.equal((await save(oldAttempt.attempt_id)).saved, false);
  await oauth("revoke", { invitation_id: next.invitation_id });
  assert.equal(await begin("two"), null);
  assert.equal((await oauth("status", {}, false)).active_invitations, 0);
});

test("save and disconnect invalidate sync cursors or leases without deleting imported copies or suppressions", async () => {
  const since = new Date(Date.now() - 864e5 * 20).toISOString();
  let lease = (
    await db.query("SELECT mail_sync_claim($1,'inbox',$2) result", [
      MAILBOX,
      since,
    ])
  ).rows[0].result;
  const message = {
    external_id: "SYNTHETIC_IMMUTABLE_ID",
    conversation_id: "SYNTHETIC_CONVERSATION",
    sender_email: "sender@example.invalid",
    body_text: "Syntetická místní kopie.",
    received_at: new Date(Date.now() - 864e5).toISOString(),
  };
  await db.query("SELECT mail_sync_commit($1,$2::jsonb,$3::jsonb,$4,true,$5)", [
    lease.lease,
    JSON.stringify([message]),
    "[]",
    "OPAQUE_SYNTHETIC_CURSOR",
    "synthetic-stable-mail-hmac-secret-32-characters",
  ]);
  lease = (
    await db.query("SELECT mail_sync_claim($1,'inbox',$2) result", [
      MAILBOX,
      since,
    ])
  ).rows[0].result;
  await connect();
  let state = (await db.query("SELECT * FROM private.mail_sync_state")).rows[0];
  assert.equal(state.cursor, null);
  assert.equal(state.lease, null);
  assert.equal(state.initial_complete, false);
  assert.equal(new Date(state.not_before).toISOString(), since);
  await assert.rejects(
    () =>
      db.query("SELECT mail_sync_commit($1,$2::jsonb,$3::jsonb,$4,true,$5)", [
        lease.lease,
        "[]",
        "[]",
        "cursor",
        "synthetic-stable-mail-hmac-secret-32-characters",
      ]),
    /mail_lease/,
  );
  await issue("pending");
  const pending = await begin("pending");
  await claim("pending");
  const oldCache = await oauth("cache_get", {}, false);
  lease = (
    await db.query("SELECT mail_sync_claim($1,'inbox',$2) result", [
      MAILBOX,
      since,
    ])
  ).rows[0].result;
  await oauth("disconnect");
  assert.equal(await oauth("cache_get", {}, false), null);
  assert.equal((await save(pending.attempt_id)).saved, false);
  assert.equal(
    (
      await oauth(
        "cache_set",
        {
          ciphertext: CACHE,
          expected_version: oldCache.version,
          expected_generation: oldCache.generation,
        },
        false,
      )
    ).saved,
    false,
  );
  assert.equal(
    (await db.query("SELECT lease FROM private.mail_sync_state")).rows[0].lease,
    null,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM email_messages")).rows[0].n,
    1,
  );
});

test("safe status and audit contain no flow, token hashes, opaque cache or account identifier", async () => {
  await connect();
  const status = await oauth("status", {}, false);
  assert.equal(status.connected, true);
  assert.ok(status.updated_at);
  assert.ok(status.connected_at);
  const audit = JSON.stringify(
      (
        await db.query(
          "SELECT * FROM admin_audit_log WHERE action LIKE 'mail_oauth_%'",
        )
      ).rows,
    ),
    safe = JSON.stringify(status);
  for (const value of [
    FLOW,
    CACHE,
    hash("INVITE_RAW_one"),
    hash("STATE_RAW_one"),
    hash("COOKIE_RAW_one"),
    "DO_NOT_STORE_PLAINTEXT_PKCE",
    "DO_NOT_STORE_PLAINTEXT_REFRESH",
    "synthetic-home-account-id",
  ]) {
    assert.ok(!audit.includes(value));
    assert.ok(!safe.includes(value));
  }
  const tables =
    JSON.stringify(
      (
        await db.query(
          "SELECT to_jsonb(c) row FROM private.mail_oauth_control c",
        )
      ).rows,
    ) +
    JSON.stringify(
      (
        await db.query(
          "SELECT to_jsonb(a) row FROM private.mail_oauth_attempts a",
        )
      ).rows,
    );
  assert.ok(!tables.includes("DO_NOT_STORE_PLAINTEXT_PKCE"));
  assert.ok(!tables.includes("DO_NOT_STORE_PLAINTEXT_REFRESH"));
});

test("removed issuer cannot start a previously issued invite and migration remains repeatable", async () => {
  await issue();
  await db.exec(
    "DELETE FROM public.admin_emails WHERE email='admin@example.invalid'",
  );
  assert.equal(await begin(), null);
  await db.exec("RESET ROLE");
  await db.exec(SQL);
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('anon','public.mail_oauth(text,jsonb)','EXECUTE') permitted",
      )
    ).rows[0].permitted,
    false,
  );
});

test("issuer removal also invalidates callbacks that already began or were claimed", async () => {
  await issue();
  await begin();
  await db.exec(
    "DELETE FROM public.admin_emails WHERE email='admin@example.invalid'",
  );
  assert.equal(await claim(), null);
  await db.exec(
    "INSERT INTO public.admin_emails(email) VALUES('admin@example.invalid')",
  );
  await issue("claimed");
  const attempt = await begin("claimed");
  await claim("claimed");
  await db.exec(
    "DELETE FROM public.admin_emails WHERE email='admin@example.invalid'",
  );
  assert.deepEqual(await save(attempt.attempt_id), {
    saved: false,
    reason: "issuer_revoked",
  });
  assert.equal(await oauth("cache_get", {}, false), null);
});
