import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readM365Mime } from "../lib/m365-mime.mjs";

const env = { M365_INGEST_ENABLED: "true", M365_MAIL_ARCHIVE_ENABLED: "true", M365_AUTH_MODE: "delegated", M365_MAILBOX: "veryvera@nadbytecna.cz" };
const original = Buffer.concat([
  Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test"\r\n\r\n--test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPříběh bez změn\r\n--test\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\n'),
  Buffer.from([0, 1, 2, 127, 255]), Buffer.from("\r\n--test--\r\n"),
]);
const options = { env, accessToken: "synthetic-access", externalId: "AAmb+/=_-case" };
test("both import and archive gates off bypass configuration, token access and network", async () => {
  let calls = 0;
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    for (const name of ["M365_INGEST_ENABLED", "M365_MAIL_ARCHIVE_ENABLED"]) {
      const result = await readM365Mime({ env: { ...env, [name]: flag, M365_MAILBOX: "invalid" }, fetcher: async () => { calls++; throw new Error(); } });
      assert.deepEqual(result, { enabled: false });
    }
  }
  assert.equal(calls, 0);
});
test("GET preserves original bytes and hash, fixed mailbox and case-sensitive encoded immutable ID", async () => {
  for (const mode of ["delegated", "certificate"]) {
    for (const type of ["message/rfc822", "text/plain; charset=utf-8", "application/octet-stream"]) {
      let calls = 0;
      const result = await readM365Mime({ ...options, env: { ...env, M365_AUTH_MODE: mode }, fetcher: async (url, request) => {
        calls++;
        const owner = mode === "delegated" ? "me" : "users/veryvera%40nadbytecna.cz";
        assert.equal(url, `https://graph.microsoft.com/v1.0/${owner}/messages/AAmb%2B%2F%3D_-case/$value`);
        assert.equal(request.method, "GET");
        assert.equal(request.body, undefined);
        assert.equal(request.redirect, "error");
        assert.equal(request.cache, "no-store");
        assert.equal(request.headers.Authorization, "Bearer synthetic-access");
        assert.equal(request.headers.Prefer, 'IdType="ImmutableId"');
        assert.ok(request.signal);
        return new Response(original, { headers: { "content-type": type } });
      } });
      assert.equal(calls, 1);
      assert.deepEqual(result.bytes, original);
      assert.equal(result.size, original.length);
      assert.equal(result.sha256, createHash("sha256").update(original).digest("hex"));
      assert.equal(result.contentType, "message/rfc822");
    }
  }
});
test("hostile IDs, invalid mailbox/token/mode and limits fail before network", async () => {
  let calls = 0;
  for (const extra of [
    { externalId: "../other" }, { externalId: "x?token=secret" }, { externalId: "https://evil.invalid" },
    { externalId: "x\nheader" }, { externalId: "x".repeat(2049) },
    { accessToken: "invalid token" }, { accessToken: "" },
    { env: { ...env, M365_MAILBOX: "other@example.invalid" } },
    { env: { ...env, M365_AUTH_MODE: "other" } },
    { maxBytes: 0 }, { maxBytes: 50 * 1024 * 1024 + 1 }, { maxBytes: Infinity },
  ]) await assert.rejects(() => readM365Mime({ ...options, ...extra, fetcher: () => { calls++; } }), (error) => error.code === "invalid_configuration");
  assert.equal(calls, 0);
});
test("bounded MIME stream accepts exact limit and cancels oversize with no partial return", async () => {
  const exact = await readM365Mime({ ...options, maxBytes: original.length, fetcher: async () => new Response(original, { headers: { "content-type": "text/plain" } }) });
  assert.deepEqual(exact.bytes, original);
  let cancelled = false, consumed = 0;
  const body = new ReadableStream({ pull(controller) { consumed++; controller.enqueue(Buffer.alloc(8, 7)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => readM365Mime({ ...options, maxBytes: 10, fetcher: async () => new Response(body, { headers: { "content-type": "message/rfc822" } }) }), (error) => error.code === "response_too_large");
  assert.equal(cancelled, true);
  assert.ok(consumed <= 3);
  let read = false;
  await assert.rejects(() => readM365Mime({ ...options, maxBytes: 10, fetcher: async () => ({ status: 200, headers: new Headers({ "content-type": "text/plain", "content-length": "11" }), get body() { read = true; throw new Error(); } }) }), (error) => error.code === "response_too_large");
  assert.equal(read, false);
});
test("HTTP failures never consume private error bodies and use fixed classifications", async () => {
  for (const [status, code] of [[401, "authentication_failed"], [403, "authentication_failed"], [404, "source_missing"], [410, "source_missing"], [429, "throttled"], [500, "http_error"], [302, "http_error"]]) {
    await assert.rejects(() => readM365Mime({ ...options, fetcher: async () => ({ status, headers: new Headers({ "retry-after": "120" }), get body() { throw new Error("private-error-body"); } }) }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes("private-error-body"), false);
      if (status === 429) assert.equal(error.retryAfterSeconds, 120);
      return true;
    });
  }
  await assert.rejects(() => readM365Mime({ ...options, fetcher: async () => ({ status: 200, redirected: true }) }), (error) => error.code === "http_error");
});
test("invalid success payloads, interrupted streams and network errors never expose content", async () => {
  for (const [fetcher, code] of [
    [async () => new Response("private-json-error", { headers: { "content-type": "application/json" } }), "invalid_response"],
    [async () => new Response("", { headers: { "content-type": "text/plain" } }), "invalid_response"],
    [async () => { throw new Error("private-network-token"); }, "network_error"],
    [async () => { throw Object.assign(new Error("private-timeout-token"), { name: "TimeoutError" }); }, "timeout"],
    [async () => new Response(new ReadableStream({ start(c) { c.error(new Error("private-stream-token")); } }), { headers: { "content-type": "text/plain" } }), "network_error"],
  ]) await assert.rejects(() => readM365Mime({ ...options, fetcher }), (error) => error.code === code && !error.stack.includes("private-") && error.cause === undefined);
});
