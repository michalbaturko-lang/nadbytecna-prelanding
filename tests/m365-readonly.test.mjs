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
