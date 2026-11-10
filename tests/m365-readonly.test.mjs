import test from "node:test";
import assert from "node:assert/strict";
import {
  readM365DeltaPage,
  readM365Config,
  readM365Scope,
  validateM365Cursor,
} from "../lib/m365-readonly.mjs";
const env = {
  M365_INGEST_ENABLED: "true",
  M365_MAILBOX: "veryvera@nadbytecna.cz",
  M365_FOLDER_ID: "Inbox",
  M365_SINCE: "2026-11-07T00:00:00Z",
};
const base =
  "https://graph.microsoft.com/v1.0/users/veryvera%40nadbytecna.cz/mailFolders/Inbox/messages/delta";
const delta = base + "?$deltatoken=synthetic",
  next = base + "?$skiptoken=synthetic";
const message = {
  id: "ImmutableCaseSensitiveID",
  from: {
    emailAddress: {
      address: "synthetic@example.invalid",
      name: "Syntetická osoba",
    },
  },
  subject: "Syntetická zpráva",
  body: { contentType: "text", content: "Pouze syntetický obsah." },
  receivedDateTime: "2026-11-07T10:00:00Z",
  conversationId: "conversation",
  internetMessageId: "<synthetic@example.invalid>",
  hasAttachments: false,
  webLink: "https://outlook.office.com/mail/0/id/synthetic",
};
const response = (value = [message], links = { "@odata.deltaLink": delta }) =>
  new Response(JSON.stringify({ value, ...links }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const read = (options) =>
  readM365DeltaPage({ env, accessToken: "synthetic-access-token", ...options });
test("M365 off makes no calls and bypasses missing configuration", async () => {
  let calls = 0;
  const r = await readM365DeltaPage({
    env: {},
    fetcher: () => {
      calls++;
      throw 0;
    },
  });
  assert.equal(r.enabled, false);
  assert.equal(calls, 0);
});
test("M365 requires explicit dedicated mailbox, folder and valid UTC since", async () => {
  for (const patch of [
    { M365_MAILBOX: "other@example.invalid" },
    { M365_FOLDER_ID: "" },
    { M365_FOLDER_ID: "../Inbox" },
    { M365_SINCE: "" },
    { M365_SINCE: "2026-02-30T00:00:00Z" },
  ])
    await assert.rejects(
      () =>
        read({
          env: { ...env, ...patch },
          fetcher: () => {
            throw new Error("must not call");
          },
        }),
      (e) => e.code === "invalid_configuration",
    );
});
test("M365 initial GET has minimal select, since, immutable and text preferences; IDs stable", async () => {
  let calls = 0;
  const fetcher = async (url, opt) => {
    calls++;
    const u = new URL(url);
    assert.equal(opt.method, "GET");
    assert.equal(opt.body, undefined);
    assert.equal(opt.headers.Authorization, "Bearer synthetic-access-token");
    assert.match(opt.headers.Prefer, /ImmutableId/);
    assert.match(opt.headers.Prefer, /body-content-type="text"/);
    assert.equal(opt.redirect, "error");
    assert.ok(opt.signal);
    assert.match(
      u.searchParams.get("$filter"),
      /^receivedDateTime ge 2026-11-07T00:00:00/,
    );
    assert.equal(
      u.searchParams.get("$select"),
      "id,from,subject,body,conversationId,internetMessageId,receivedDateTime,hasAttachments,webLink",
    );
    return response([message, message]);
  };
  const a = await read({ fetcher }),
    b = await read({ fetcher });
  assert.equal(calls, 2);
  assert.equal(a.messages.length, 1);
  assert.equal(a.messages[0].dedupKey, b.messages[0].dedupKey);
  assert.equal(a.messages[0].source, "microsoft365");
  for (const k of ["consent", "consentPublish", "ageConfirmed"])
    assert.equal(a.messages[0][k], null);
  assert.equal(a.messages[0].aiEligible, false);
});
test("M365 one-page cursor is returned without following it; removals deduplicate", async () => {
  let calls = 0;
  const r = await read({
    cursor: next,
    fetcher: async (url) => {
      calls++;
      assert.equal(url, next);
      return response(
        [message, { id: message.id, "@removed": { reason: "deleted" } }],
        { "@odata.nextLink": base + "?$skiptoken=second" },
      );
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.messages.length, 0);
  assert.equal(r.removals[0].externalId, message.id);
  assert.equal(r.deltaLink, null);
  assert.ok(r.nextLink);
});

test("approved epoch history uses unfiltered folder delta and keeps the local lower date boundary", async () => {
  for (const mode of [undefined, "delegated"]) {
    const scopeEnv = { ...env, M365_SINCE: "1970-01-01T00:00:00Z", M365_AUTH_MODE: mode };
    const endpoint = mode === "delegated"
      ? "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages/delta" : base;
    const result = await read({
      env: scopeEnv,
      fetcher: async (url, options) => {
        const request = new URL(url);
        assert.equal(request.origin + request.pathname, endpoint);
        assert.equal(request.searchParams.has("$filter"), false);
        assert.deepEqual([...request.searchParams.keys()], ["$select"]);
        assert.equal(options.method, "GET");
        assert.equal(options.body, undefined);
        assert.match(options.headers.Prefer, /odata.maxpagesize=25/);
        return response([
          { ...message, id: "before-epoch", receivedDateTime: "1969-12-31T23:59:59Z" },
          { ...message, id: "at-epoch", receivedDateTime: "1970-01-01T00:00:00Z" },
          { ...message, id: "historical", receivedDateTime: "1999-01-01T00:00:00Z" },
        ], { "@odata.deltaLink": endpoint + "?$deltatoken=all-history" });
      },
    });
    assert.deepEqual(result.messages.map((m) => m.externalId), ["at-epoch", "historical"]);
    assert.equal(readM365Config(scopeEnv).since, "1970-01-01T00:00:00.000Z");
  }
});

test("full historical Inbox can continue beyond 5,000 synthetic messages in bounded token-only pages", async () => {
  const scopeEnv = { ...env, M365_SINCE: "1970-01-01T00:00:00Z" };
  const total = 5010;
  const ids = new Set();
  let calls = 0, cursor = null, completed = false;
  const fetcher = async (url, options) => {
    const request = new URL(url);
    assert.equal(request.searchParams.has("$filter"), false);
    assert.equal(options.method, "GET");
    if (calls === 0) assert.deepEqual([...request.searchParams.keys()], ["$select"]);
    else {
      assert.deepEqual([...request.searchParams.keys()], ["$skiptoken"]);
      assert.equal(request.searchParams.get("$skiptoken"), "history-" + calls);
    }
    const start = calls++ * 25;
    const values = Array.from({ length: Math.min(25, total - start) }, (_, n) => ({
      ...message, id: "historical-" + (start + n), receivedDateTime: "1999-01-01T00:00:00Z",
    }));
    return response(values, start + values.length < total
      ? { "@odata.nextLink": base + "?$skiptoken=history-" + calls }
      : { "@odata.deltaLink": base + "?$deltatoken=history-complete" });
  };
  do {
    const previousCalls = calls;
    const result = await read({ env: scopeEnv, cursor, fetcher });
    assert.equal(calls, previousCalls + 1, "one read never follows another page internally");
    assert.ok(result.messages.length <= 25);
    for (const item of result.messages) ids.add(item.externalId);
    cursor = result.nextLink;
    completed = result.deltaLink === base + "?$deltatoken=history-complete";
  } while (cursor);
  assert.equal(ids.size, total);
  assert.equal(calls, Math.ceil(total / 25));
  assert.equal(completed, true);
});

test("a non-epoch start still requests and enforces its precise received-date filter", async () => {
  for (const since of ["1970-01-01T00:00:00.001Z", "1970-01-01T00:00:01Z"]) {
    const result = await read({
      env: { ...env, M365_SINCE: since },
      fetcher: async (url) => {
        assert.equal(new URL(url).searchParams.get("$filter"), "receivedDateTime ge " + new Date(since).toISOString());
        return response([
          { ...message, id: "at-epoch", receivedDateTime: "1970-01-01T00:00:00Z" },
          message,
        ]);
      },
    });
    assert.deepEqual(result.messages.map((m) => m.externalId), [message.id]);
  }
});
test("M365 continuation rejects other origins, paths, credentials, fragments and query expansion before bearer transmission", async () => {
  const malicious = [
    "https://evil.invalid/path",
    "http://graph.microsoft.com" + new URL(next).pathname + "?$skiptoken=x",
    next.replace("graph.microsoft.com", "graph.microsoft.com.evil.invalid"),
    next.replace("graph.microsoft.com", "user:pass@graph.microsoft.com"),
    next + "#secret",
    next.replace("Inbox", "SentItems"),
    next.replace("veryvera%40nadbytecna.cz", "other%40example.invalid"),
    next.replace("v1.0", "beta"),
    next + "&$expand=attachments",
    next.replace("Inbox", "Inbox%2Fmessages"),
  ];
  for (const cursor of malicious) {
    let calls = 0;
    await assert.rejects(
      () =>
        read({
          cursor,
          fetcher: () => {
            calls++;
          },
        }),
      (e) => e.code === "invalid_cursor",
    );
    assert.equal(calls, 0);
  }
  await assert.rejects(
    () =>
      read({
        fetcher: async () =>
          response([], { "@odata.nextLink": "https://evil.invalid/" }),
      }),
    (e) => e.code === "invalid_cursor",
  );
});
test("M365 body must be plain text, bounded and structurally valid; older records skipped", async () => {
  for (const patch of [
    { body: { contentType: "html", content: "<script>secret</script>" } },
    { body: { contentType: "text", content: "x".repeat(210000) } },
    { hasAttachments: "false" },
    { webLink: "javascript:secret" },
  ])
    await assert.rejects(
      () => read({ fetcher: async () => response([{ ...message, ...patch }]) }),
      (e) => e.code === "invalid_response",
    );
  const r = await read({
    fetcher: async () =>
      response([{ ...message, receivedDateTime: "2026-11-06T00:00:00Z" }]),
  });
  assert.equal(r.messages.length, 0);
});
test("M365 auth, throttling, redirect, network and oversized errors never expose payload/token", async () => {
  for (const status of [401, 403, 429, 302, 500])
    await assert.rejects(
      () =>
        read({
          fetcher: async () =>
            new Response("synthetic-secret-payload", {
              status,
              headers: { "retry-after": "60" },
            }),
        }),
      (e) =>
        !String(e.stack).includes("synthetic-secret") &&
        (status !== 429 || e.retryAfterSeconds === 60),
    );
  await assert.rejects(
    () =>
      read({
        fetcher: async () => {
          throw new Error("synthetic-access-token secret body");
        },
      }),
    (e) =>
      e.code === "network_error" &&
      !String(e.stack).includes("synthetic-access-token"),
  );
  await assert.rejects(
    () =>
      read({
        fetcher: async () =>
          new Response("x".repeat(2100000), {
            headers: { "content-type": "application/json" },
          }),
      }),
    (e) => e.code === "response_too_large",
  );
});

test("M365 exported config validates scope without network and expired cursor never resets history", async () => {
  assert.deepEqual(readM365Config(env), {
    mailbox: env.M365_MAILBOX,
    folderId: "Inbox",
    since: "2026-11-07T00:00:00.000Z",
  });
  let calls = 0;
  await assert.rejects(
    () =>
      read({
        cursor: next,
        fetcher: async () => {
          calls++;
          return new Response("opaque payload", { status: 410 });
        },
      }),
    (e) => e.code === "cursor_expired",
  );
  assert.equal(calls, 1);
});

test("M365 cursor validator accepts exported configuration shape and documented token-only continuation", () => {
  assert.equal(validateM365Cursor(next, readM365Config(env)), next);
  assert.equal(
    validateM365Cursor(delta.replace("%40", "@"), readM365Config(env)),
    delta.replace("%40", "@"),
  );
});
test("delegated sync reads only authenticated /me mailbox and validates its continuation", async () => {
  const delegated = { ...env, M365_AUTH_MODE: "delegated" },
    me = "https://graph.microsoft.com/v1.0/me/mailFolders/Inbox/messages/delta";
  const r = await readM365DeltaPage({
    env: delegated,
    accessToken: "synthetic",
    fetcher: async (url, opts) => {
      assert.equal(
        new URL(url).pathname,
        "/v1.0/me/mailFolders/Inbox/messages/delta",
      );
      assert.equal(opts.method, "GET");
      return response([message], {
        "@odata.deltaLink": me + "?$deltatoken=synthetic",
      });
    },
  });
  assert.equal(r.messages.length, 1);
  assert.equal(r.deltaLink, me + "?$deltatoken=synthetic");
});
test("delegated sync rejects old certificate and other-user cursors before transmitting bearer", async () => {
  let calls = 0;
  await assert.rejects(
    readM365DeltaPage({
      env: { ...env, M365_AUTH_MODE: "delegated" },
      accessToken: "synthetic",
      cursor: delta,
      fetcher: async () => {
        calls++;
      },
    }),
    (e) => e.code === "invalid_cursor",
  );
  assert.equal(calls, 0);
});
