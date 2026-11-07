import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify, constants } from "node:crypto";
import {
  getM365AccessToken,
  validateM365AuthConfig,
} from "../lib/m365-auth.mjs";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const env = {
  M365_INGEST_ENABLED: "true",
  M365_MAILBOX: "veryvera@nadbytecna.cz",
  M365_FOLDER_ID: "Inbox",
  M365_SINCE: "2026-11-07T00:00:00Z",
  M365_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  M365_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  M365_CERT_SHA256_THUMBPRINT: "a".repeat(64),
  M365_CERT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const ok = () =>
  new Response(
    JSON.stringify({
      token_type: "Bearer",
      access_token: "synthetic-token",
      expires_in: 3600,
    }),
    { headers: { "content-type": "application/json" } },
  );
test("M365 token off first bypasses config and makes no request", async () => {
  let calls = 0;
  assert.deepEqual(
    await getM365AccessToken({
      env: {},
      fetcher: () => {
        calls++;
      },
    }),
    { enabled: false, accessToken: null },
  );
  assert.equal(calls, 0);
});
test("M365 token uses fixed tenant endpoint and valid short-lived certificate assertion", async () => {
  let assertion;
  const result = await getM365AccessToken({
    env,
    now: () => 1794042000000,
    fetcher: async (url, opt) => {
      assert.equal(
        url,
        "https://login.microsoftonline.com/" +
          env.M365_TENANT_ID +
          "/oauth2/v2.0/token",
      );
      assert.equal(opt.method, "POST");
      assert.equal(opt.redirect, "error");
      assert.ok(opt.signal);
      const body = new URLSearchParams(opt.body);
      assert.equal(body.get("scope"), "https://graph.microsoft.com/.default");
      assert.equal(body.get("grant_type"), "client_credentials");
      assert.equal(body.get("client_secret"), null);
      assertion = body.get("client_assertion");
      return ok();
    },
  });
  const [head, payload, sig] = assertion.split(".");
  const h = JSON.parse(Buffer.from(head, "base64url")),
    p = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(h.alg, "PS256");
  assert.equal(
    h["x5t#S256"],
    Buffer.from(env.M365_CERT_SHA256_THUMBPRINT, "hex").toString("base64url"),
  );
  assert.equal(p.iss, env.M365_CLIENT_ID);
  assert.equal(p.sub, env.M365_CLIENT_ID);
  assert.equal(p.exp - p.nbf, 330);
  assert.ok(p.jti);
  assert.equal(
    verify(
      "sha256",
      Buffer.from(head + "." + payload),
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      Buffer.from(sig, "base64url"),
    ),
    true,
  );
  assert.deepEqual(result, {
    enabled: true,
    accessToken: "synthetic-token",
    expiresIn: 3600,
  });
});
test("M365 token rejects unscoped mailbox, malformed tenant, thumbprint and PEM before fetch", async () => {
  for (const patch of [
    { M365_MAILBOX: "other@example.invalid" },
    { M365_FOLDER_ID: "" },
    { M365_TENANT_ID: "../evil" },
    { M365_CERT_SHA256_THUMBPRINT: "secret" },
    { M365_CERT_PRIVATE_KEY: "synthetic-secret" },
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        getM365AccessToken({
          env: { ...env, ...patch },
          fetcher: () => {
            calls++;
          },
        }),
      (e) =>
        e.code === "invalid_configuration" &&
        !String(e.stack).includes("synthetic-secret"),
    );
    assert.equal(calls, 0);
  }
});
test("M365 token failures redact remote and local payloads", async () => {
  await assert.rejects(
    () =>
      getM365AccessToken({
        env,
        fetcher: async () => new Response("synthetic-secret", { status: 401 }),
      }),
    (e) =>
      e.code === "token_request_failed" &&
      !String(e.stack).includes("synthetic-secret"),
  );
  await assert.rejects(
    () =>
      getM365AccessToken({
        env,
        fetcher: async () => {
          throw new Error(env.M365_CERT_PRIVATE_KEY);
        },
      }),
    (e) =>
      e.code === "token_request_failed" &&
      !String(e.stack).includes("PRIVATE KEY"),
  );
  for (const data of [
    { token_type: "Bearer", access_token: "bad token", expires_in: 300 },
    { token_type: "Bearer", access_token: "ok", expires_in: 0 },
  ])
    await assert.rejects(
      () =>
        getM365AccessToken({
          env,
          fetcher: async () => new Response(JSON.stringify(data)),
        }),
      (e) => e.code === "invalid_token_response",
    );
});

test("M365 credential status validates RSA configuration without exposing credentials or acquiring a token", () => {
  const config = validateM365AuthConfig({
    ...env,
    M365_INGEST_ENABLED: "false",
  });
  assert.deepEqual(
    Object.keys(config).sort(),
    [
      "mailbox",
      "folderId",
      "since",
      "tenantId",
      "clientId",
      "credentialType",
    ].sort(),
  );
  assert.equal(config.credentialType, "certificate");
  assert.ok(!JSON.stringify(config).includes("PRIVATE KEY"));
  for (const patch of [
    { M365_TENANT_ID: "invalid" },
    { M365_CERT_PRIVATE_KEY: "invalid" },
    { M365_CERT_SHA256_THUMBPRINT: "abc" },
  ])
    assert.throws(
      () => validateM365AuthConfig({ ...env, ...patch }),
      (e) => e.code === "invalid_configuration",
    );
  const ec = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }).privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(
    () => validateM365AuthConfig({ ...env, M365_CERT_PRIVATE_KEY: ec }),
    (e) => e.code === "invalid_configuration",
  );
});
