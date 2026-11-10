import test from "node:test";
import assert from "node:assert/strict";
import {
  startAdminServer,
  token,
  otherToken,
} from "./helpers/admin-server.mjs";
import { getDelegatedMailToken, oauthRpc } from "../lib/mail-oauth-service.mjs";
import { decryptM365Cache } from "../lib/m365-oauth-client.mjs";
let s,
  identity = "veryvera@nadbytecna.cz",
  msalCalls = 0,
  graphCalls = 0,
  expectedChallenge;
let exchangeError = null, folderStatus = 200;
const failures = [];
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test.before(async () => {
  s = await startAdminServer({
    mailConnectClient: {
      reportFailure: (record) => failures.push(record),
      authUrl: async ({ state, codeChallenge }) => {
        msalCalls++;
        expectedChallenge = codeChallenge;
        return {
          enabled: true,
          url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?state=${state}`,
        };
      },
      exchange: async ({ code, codeVerifier }) => {
        msalCalls++;
        if (exchangeError) throw exchangeError;
        assert.equal(code, "synthetic-code");
        assert.ok(codeVerifier.length >= 43);
        return {
          enabled: true,
          accountId: "synthetic-home",
          tenantId: tenant,
          accessToken: "synthetic-access",
          cache: JSON.stringify({ RefreshToken: { synthetic: "test-only" } }),
        };
      },
      fetcher: async (url, opts) => {
        graphCalls++;
        assert.equal(opts.method, "GET");
        assert.equal(opts.redirect, "error");
        assert.equal(opts.headers.Authorization, "Bearer synthetic-access");
        if (
          url ===
          "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName"
        )
          return Response.json({
            id: "synthetic-user",
            mail: identity,
            userPrincipalName: identity,
          });
        assert.equal(
          url,
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id",
        );
        return Response.json({ id: "synthetic-inbox" }, { status: folderStatus });
      },
    },
  });
  Object.assign(process.env, {
    M365_AUTH_MODE: "delegated",
    M365_CONNECT_ENABLED: "true",
    M365_MAILBOX: "veryvera@nadbytecna.cz",
    M365_TENANT_ID: tenant,
    M365_CLIENT_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    M365_CLIENT_SECRET: "synthetic-client-secret",
    M365_OAUTH_REDIRECT_URI:
      "https://nadbytecna.cz/api/mail-connect/?step=callback",
    M365_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
  });
});
test.after(async () => {
  await s?.close();
});
const admin = (body, t = token) =>
  s.fetch(s.url + "/api/admin-mail/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: "Bearer " + t } : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
const begin = (invite, origin = "https://nadbytecna.cz") =>
  s.fetch(s.url + "/api/mail-connect/?step=begin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ invite }),
    redirect: "manual",
  });
const cookieOf = (r) =>
  r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .find((x) => x.startsWith("__Host-nb-mail-flow="));
async function invitation() {
  const r = await admin({ action: "connect_invite" });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(
    d.url,
    /^https:\/\/nadbytecna\.cz\/api\/mail-connect\/#invite=[A-Za-z0-9_-]{43}$/,
  );
  assert.ok(new Date(d.expiresAt) > Date.now());
  return new URLSearchParams(new URL(d.url).hash.slice(1)).get("invite");
}
async function started() {
  const invite = await invitation(),
    r = await begin(invite);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(expectedChallenge, /^[A-Za-z0-9_-]{43}$/);
  const proof = cookieOf(r);
  assert.match(r.headers.getSetCookie()[0], /Secure; HttpOnly; SameSite=Lax/);
  return { invite, state: new URL(d.url).searchParams.get("state"), proof };
}
const callback = (a, proof = a.proof, extra = "code=synthetic-code") =>
  s.fetch(
    s.url + "/api/mail-connect/?step=callback&state=" + a.state + "&" + extra,
    { headers: proof ? { Cookie: proof } : {}, redirect: "manual" },
  );
test("public landing requires no admin, is private and opening does not consume invitation", async () => {
  const inv = await invitation(),
    before = msalCalls;
  const r = await s.fetch(s.url + "/api/mail-connect/");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Účet v adminu nadbytečné nepotřebujete/);
  assert.ok(!html.includes(inv));
  assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(msalCalls, before);
  assert.equal((await begin(inv, "https://foreign.invalid")).status, 403);
  const good = await begin(inv);
  assert.equal(good.status, 200);
  assert.equal((await begin(inv)).status, 400);
});
test("only actual admin issues a link and callback never creates admin identity", async () => {
  assert.equal((await admin({ action: "connect_invite" }, "")).status, 401);
  assert.equal(
    (await admin({ action: "connect_invite" }, otherToken)).status,
    403,
  );
  const before = (await s.db.query("SELECT count(*)::int n FROM admins"))
    .rows[0].n;
  const a = await started(),
    calls = msalCalls;
  const noCookie = await callback(a, "");
  assert.equal(noCookie.status, 303);
  assert.equal(msalCalls, calls);
  const r = await callback(a);
  assert.equal(r.status, 303);
  assert.equal(
    r.headers.get("Location"),
    "https://nadbytecna.cz/api/mail-connect/?step=result",
  );
  assert.equal(
    (await s.db.query("SELECT count(*)::int n FROM admins")).rows[0].n,
    before,
  );
  const resultProof = r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .find((x) => x.startsWith("__Host-nb-mail-result="));
  const resultPage = await s.fetch(s.url + "/api/mail-connect/?step=result", {
    headers: { Cookie: resultProof },
  });
  assert.match(await resultPage.text(), /Schránka byla připojena\./);
  assert.match(resultPage.headers.get("Set-Cookie"), /Max-Age=0/);
  const invalid = await s.fetch(s.url + "/api/mail-connect/?step=result", {
    headers: { Cookie: resultProof + "tampered" },
  });
  assert.doesNotMatch(await invalid.text(), /Schránka byla připojena\./);
  const saved = await oauthRpc("cache_get");
  assert.equal(saved.mailbox, "veryvera@nadbytecna.cz");
  assert.ok(!saved.ciphertext.includes("test-only"));
  assert.ok(
    decryptM365Cache({
      encrypted: saved.ciphertext,
      context: "oauth-cache",
    }).includes("test-only"),
  );
  const replayBefore = msalCalls;
  await callback(a);
  assert.equal(msalCalls, replayBefore);
  const state = await (await admin({ action: "status" })).json();
  assert.equal(state.connected, true);
  assert.ok(!JSON.stringify(state).includes("RefreshToken"));
  assert.ok(!JSON.stringify(state).includes("ciphertext"));
});
test("wrong mailbox and denied consent do not replace the connection", async () => {
  let a = await started();
  identity = "other@example.invalid";
  const original = await oauthRpc("cache_get");
  await callback(a);
  const still = await oauthRpc("cache_get");
  assert.equal(still.ciphertext, original.ciphertext);
  identity = "veryvera@nadbytecna.cz";
  a = await started();
  const before = msalCalls;
  const r = await callback(a, a.proof, "error=access_denied");
  assert.equal(msalCalls, before);
  assert.equal(r.status, 303);
});
test("forged success result is rejected; disconnect invalidates late callback and keeps copied messages", async () => {
  const fake = await s.fetch(
    s.url + "/api/mail-connect/?step=result&outcome=connected",
  );
  assert.doesNotMatch(await fake.text(), /Schránka byla připojena\./);
  const a = await started();
  const messages = (
    await s.db.query("SELECT count(*)::int n FROM email_messages")
  ).rows[0].n;
  assert.equal((await admin({ action: "disconnect" })).status, 400);
  assert.equal(
    (await admin({ action: "disconnect", confirm: "ODPOJIT" })).status,
    200,
  );
  const calls = msalCalls;
  await callback(a);
  assert.equal(msalCalls, calls);
  assert.equal((await oauthRpc("status")).connected, false);
  assert.equal(
    (await s.db.query("SELECT count(*)::int n FROM email_messages")).rows[0].n,
    messages,
  );
});
test("delegated refresh uses encrypted cache and refuses token if disconnected during refresh", async () => {
  const a = await started();
  await callback(a);
  Object.assign(process.env, {
    M365_INGEST_ENABLED: "true",
    M365_FOLDER_ID: "inbox",
    M365_SINCE: "2026-11-01T00:00:00Z",
  });
  const refresh = async ({ cache, accountId }) => ({
    enabled: true,
    cache,
    accountId,
    tenantId: tenant,
    accessToken: "synthetic-refreshed",
  });
  assert.equal(
    (await getDelegatedMailToken({ refresh })).accessToken,
    "synthetic-refreshed",
  );
  await assert.rejects(
    getDelegatedMailToken({
      refresh: async (args) => {
        await admin({ action: "disconnect", confirm: "ODPOJIT" });
        return refresh(args);
      },
    }),
    (e) => e.code === "mail_connection_changed",
  );
  process.env.M365_INGEST_ENABLED = "false";
  assert.deepEqual(
    await getDelegatedMailToken({
      refresh: () => {
        throw Error("must not refresh");
      },
    }),
    { enabled: false, accessToken: null },
  );
  assert.equal(s.metrics.external, 0);
});


test("callback failures report safe stages without credentials or provider payloads", async () => {
  const previous = await oauthRpc("cache_get");
  try {
    for (const code of ["oauth_client_rejected", "secret-value-in-error-code"]) {
      exchangeError = Object.assign(new Error("secret-value token-payload provider-response"), { code, response: "provider-response" });
      const a = await started(), before = failures.length;
      assert.equal((await callback(a)).status, 303);
      assert.equal(failures.length, before + 1);
      assert.deepEqual(failures.at(-1), { event: "mail_oauth_callback_failed", stage: "token_exchange", code: code === "oauth_client_rejected" ? code : "unexpected" });
      const after = await oauthRpc("cache_get");
      assert.deepEqual(after, previous);
    }
    exchangeError = null;
    folderStatus = 403;
    assert.equal((await callback(await started())).status, 303);
    assert.equal(failures.at(-1).stage, "mailbox_lookup");
    folderStatus = 200;
    const a = await started();
    assert.equal((await callback(a, "")).status, 303);
    assert.equal(failures.at(-1).stage, "callback_validation");
    const safe = JSON.stringify(failures);
    for (const secret of ["secret-value", "token-payload", "provider-response", "synthetic-code", "synthetic-access"]) assert.ok(!safe.includes(secret));
  } finally { exchangeError = null; folderStatus = 200; }
});
