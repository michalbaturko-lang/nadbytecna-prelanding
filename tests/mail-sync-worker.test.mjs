import test from "node:test";
import assert from "node:assert/strict";
import { runMailSync } from "../lib/mail-sync-worker.mjs";
import { createMailSyncHandler } from "../api/mail-sync.js";

const env = { M365_INGEST_ENABLED: "true", M365_MAILBOX: "veryvera@nadbytecna.cz", M365_FOLDER_ID: "inbox", M365_SINCE: "1970-01-01T00:00:00Z" };
function fixture({ pageCount = 9, busyAt = 0, failPage = 0, failCommit = 0, failAuth = false, error = new Error("private-graph-body-token"), elapsedPerPage = 0 } = {}) {
  const calls = [], committed = [];
  let current = 0, lease = null, clock = 0;
  const options = {
    env,
    now: () => clock,
    prepare: async () => { calls.push("prepare"); return "synthetic-hash-secret"; },
    getToken: async () => { calls.push("auth"); if (failAuth) throw error; return { accessToken: "synthetic-access" }; },
    rpc: async (method, args) => {
      calls.push(method);
      if (method === "mail_sync_claim") {
        assert.equal(lease, null, "every previous lease must be committed before another claim");
        assert.deepEqual(args, { p_mailbox: env.M365_MAILBOX, p_folder: env.M365_FOLDER_ID, p_since: env.M365_SINCE });
        if (busyAt === current + 1) return null;
        lease = `lease-${current + 1}`;
        return { lease, cursor: current ? `cursor-${current}` : null, since: env.M365_SINCE };
      }
      if (method === "mail_sync_commit") {
        assert.equal(args.p_lease, lease);
        assert.equal(args.p_next_cursor, `cursor-${current + 1}`);
        assert.equal(args.p_complete, current + 1 === pageCount);
        assert.equal(args.p_hash_secret, "synthetic-hash-secret");
        assert.equal(args.p_messages[0].body_text, "private-message-text");
        assert.deepEqual(args.p_removed, ["removed-id"]);
        if (failCommit === current + 1) throw error;
        committed.push(args);
        current++;
        lease = null;
        clock += elapsedPerPage;
        return { imported: 2, skipped: 1, removed: 1, private_extra: "private-database-body" };
      }
      if (method === "mail_sync_release") {
        assert.equal(args.p_lease, lease);
        calls.push(args);
        lease = null;
        return null;
      }
      throw new Error("Unexpected RPC");
    },
    readPage: async (args) => {
      calls.push("graph");
      assert.equal(args.accessToken, "synthetic-access");
      assert.equal(args.cursor, current ? `cursor-${current}` : null);
      assert.equal(args.env.M365_SINCE, "1970-01-01T00:00:00.000Z");
      if (failPage === current + 1) throw error;
      const complete = current + 1 === pageCount;
      return {
        messages: [{ externalId: "synthetic-external", conversationId: "synthetic-conversation", internetMessageId: "synthetic-internet", senderName: "Synthetic", senderEmail: "synthetic@example.invalid", subject: "private-subject", text: "private-message-text", receivedAt: "2026-11-01T00:00:00Z", hasAttachments: false }],
        removals: [{ externalId: "removed-id" }],
        nextLink: complete ? null : `cursor-${current + 1}`,
        deltaLink: complete ? `cursor-${current + 1}` : null,
      };
    },
  };
  return { options, calls, committed };
}
test("disabled sync does not touch credentials, authentication, DB or Graph", async () => {
  const f = fixture();
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    assert.deepEqual(await runMailSync({ ...f.options, env: { M365_INGEST_ENABLED: flag } }), { skipped: true });
  }
  assert.deepEqual(f.calls, []);
});
test("catchup commits at most five pages sequentially with current cursor and one token", async () => {
  const f = fixture();
  const result = await runMailSync(f.options);
  assert.deepEqual(result, { ok: true, pages: 5, imported: 10, skipped: 5, removed: 5, more: true });
  assert.equal(f.committed.length, 5);
  assert.equal(f.calls.filter((c) => c === "auth").length, 1);
  assert.deepEqual(f.calls.slice(0, 5), ["prepare", "mail_sync_claim", "auth", "graph", "mail_sync_commit"]);
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("delta completion stops immediately, including an empty final page", async () => {
  const f = fixture({ pageCount: 2 });
  const read = f.options.readPage;
  f.options.readPage = async (args) => {
    const page = await read(args);
    if (page.deltaLink) page.messages = [];
    return page;
  };
  const commit = f.options.rpc;
  f.options.rpc = (method, args) => {
    // Fixture checks its synthetic body; preserve that check for the first page only.
    if (method === "mail_sync_commit" && args.p_complete) {
      assert.deepEqual(args.p_messages, []);
      return commit(method, { ...args, p_messages: [{ body_text: "private-message-text" }] });
    }
    return commit(method, args);
  };
  const result = await runMailSync(f.options);
  assert.equal(result.pages, 2);
  assert.equal(result.more, false);
  assert.equal(f.calls.filter((c) => c === "graph").length, 2);
});
test("busy first claim avoids authentication; busy later claim preserves prior progress", async () => {
  for (const busyAt of [1, 3]) {
    const f = fixture({ busyAt });
    const result = await runMailSync(f.options);
    assert.equal(result.busy, true);
    assert.equal(f.committed.length, busyAt - 1);
    assert.equal(f.calls.filter((c) => c === "auth").length, busyAt === 1 ? 0 : 1);
  }
});
test("deadline leaves a full page and release reserve before starting the next claim", async () => {
  const f = fixture({ elapsedPerPage: 15000 });
  const result = await runMailSync(f.options);
  assert.equal(result.pages, 2);
  assert.equal(result.deadline, true);
  assert.equal(result.more, true);
  assert.equal(f.calls.filter((c) => c === "mail_sync_claim").length, 2);
});
test("throttling stops the batch, releases only its lease and persists Retry-After", async () => {
  const f = fixture({ failPage: 3, error: Object.assign(new Error("private-body"), { code: "throttled", retryAfterSeconds: 120 }) });
  await assert.rejects(() => runMailSync(f.options), (error) => error.code === "throttled" && !error.stack.includes("private-body"));
  assert.equal(f.committed.length, 2);
  assert.deepEqual(f.calls.at(-1), { p_lease: "lease-3", p_error: "throttled", p_retry_after_seconds: 120 });
  assert.equal(f.calls.filter((c) => c === "graph").length, 3);
});
test("auth, Graph and ambiguous commit failures never fetch another page or repeat a commit", async () => {
  for (const config of [{ failAuth: true }, { failPage: 2 }, { failCommit: 2 }]) {
    const f = fixture(config);
    await assert.rejects(() => runMailSync(f.options), (error) => {
      assert.equal(error.code, "mail_sync_failed");
      assert.equal(error.cause, undefined);
      assert.equal(error.stack.includes("private-graph-body-token"), false);
      return true;
    });
    assert.equal(f.committed.length, config.failAuth ? 0 : 1);
    assert.equal(f.calls.filter((c) => c === "mail_sync_release").length, 1);
    assert.equal(f.calls.filter((c) => c === "mail_sync_commit").length, config.failAuth ? 0 : config.failCommit ? 2 : 1);
  }
});
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
}
test("HTTP rejects methods and unauthorized calls before work and returns only fixed safe errors", async () => {
  let calls = 0, authCalls = 0;
  const handler = createMailSyncHandler({ authorized: () => { authCalls++; return false; }, run: () => { calls++; } });
  const wrongMethod = response();
  await handler({ method: "PUT" }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, "GET, POST");
  assert.equal(authCalls, 0);
  const unauthorized = response();
  await handler({ method: "POST" }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(calls, 0);
  for (const method of ["GET", "POST"]) {
    const r = response();
    await createMailSyncHandler({ authorized: () => true, run: async () => { throw Object.assign(new Error("private-payload"), { code: "private-code-token" }); } })({ method }, r);
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.body, { error: "mail_sync_failed" });
    assert.equal(r.headers["Cache-Control"], "no-store");
    assert.match(r.headers["X-Robots-Tag"], /noindex/);
  }
});

test("failure diagnostics contain only constant stage/code and release errors remain private", async () => {
  for (const [config, stage] of [[{ failAuth: true }, "auth"], [{ failPage: 2 }, "read"], [{ failCommit: 2 }, "commit"]]) {
    const f = fixture({ ...config, error: Object.assign(new Error("private-message-token"), { code: "invalid_cursor" }) });
    const diagnostics = [];
    f.options.reportFailure = (record) => diagnostics.push(record);
    const rpc = f.options.rpc;
    f.options.rpc = (method, args) => {
      if (method === "mail_sync_release") throw new Error("private-release-error");
      return rpc(method, args);
    };
    await assert.rejects(() => runMailSync(f.options), (error) => error.code === "invalid_cursor");
    assert.deepEqual(diagnostics, [
      { event: "mail_sync_failed", stage, code: "invalid_cursor" },
      { event: "mail_sync_failed", stage: "release", code: "mail_sync_failed" },
    ]);
  }
});
test("disconnect or new connection generation between pages prevents any further Graph read", async () => {
  for (const changed of [{ connected: false, generation: 1 }, { connected: true, generation: 2 }]) {
    const f = fixture();
    const getToken = f.options.getToken;
    f.options.getToken = async () => ({ ...await getToken(), generation: 1 });
    f.options.getConnection = async () => changed;
    await assert.rejects(() => runMailSync(f.options), (error) => error.code === "mail_connection_changed");
    assert.equal(f.committed.length, 1);
    assert.equal(f.calls.filter((c) => c === "graph").length, 1);
    assert.deepEqual(f.calls.at(-1), { p_lease: "lease-2", p_error: "mail_connection_changed" });
  }
});
