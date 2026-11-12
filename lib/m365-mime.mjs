// Read-only original-message retrieval. No parsing, AI, persistence or mailbox writes.
// Microsoft Graph message-get /$value and outlook-immutable-id contracts.
import { createHash } from "node:crypto";
import { m365Error } from "./m365-readonly.mjs";
import { graphGet } from "./m365-transport.mjs";

const MAILBOX = "veryvera@nadbytecna.cz";
const MAX_BYTES = 50 * 1024 * 1024;
const MIME_TYPES = new Set(["message/rfc822", "text/plain", "application/octet-stream"]);

export async function readM365Mime({ env = process.env, accessToken, externalId, fetcher = fetch, maxBytes = MAX_BYTES } = {}) {
  if (env.M365_INGEST_ENABLED !== "true" || env.M365_MAIL_ARCHIVE_ENABLED !== "true")
    return { enabled: false };
  if (env.M365_MAILBOX !== MAILBOX ||
      !["delegated", "certificate"].includes(env.M365_AUTH_MODE) ||
      typeof accessToken !== "string" || !accessToken || accessToken.length > 32768 || /\s/.test(accessToken) ||
      typeof externalId !== "string" || !/^[A-Za-z0-9_+=/\-]{1,2048}$/.test(externalId) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES)
    throw m365Error("invalid_configuration");
  const owner = env.M365_AUTH_MODE === "delegated" ? "me" : `users/${encodeURIComponent(MAILBOX)}`;
  const target = `https://graph.microsoft.com/v1.0/${owner}/messages/${encodeURIComponent(externalId)}/$value`;
  return graphGet({url:target,fetcher,timeoutMs:45000,
    headers:{Authorization:`Bearer ${accessToken}`,Accept:"message/rfc822",Prefer:'IdType="ImmutableId"'},
    consume:async response=>{
  if (response.redirected) throw m365Error("http_error");
  if (response.status === 401 || response.status === 403) throw m365Error("authentication_failed");
  if (response.status === 404 || response.status === 410) throw m365Error("source_missing");
  if (response.status === 429) {
    const error = m365Error("throttled");
    const retry = response.headers?.get?.("retry-after");
    if (/^\d{1,6}$/.test(retry || "")) error.retryAfterSeconds = Math.min(Number(retry), 86400);
    throw error;
  }
  if (response.status !== 200) throw m365Error("http_error");
  const type = (response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!MIME_TYPES.has(type)) throw m365Error("invalid_response");
  const length = response.headers?.get?.("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes)
    throw m365Error("response_too_large");
  // Require a stream to enforce the bound before allocating the full payload.
  if (!response.body?.getReader) throw m365Error("invalid_response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw m365Error("response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error?.name === "M365ReadError") throw error;
    throw m365Error(["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "network_error");
  } finally {
    reader.releaseLock();
  }
  if (!size) throw m365Error("invalid_response");
  const bytes = Buffer.concat(chunks, size);
  return { enabled: true, bytes, size, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "message/rfc822" };
    }
  });
}
