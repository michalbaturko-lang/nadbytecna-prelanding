// Server-side, read-only adapter. No token acquisition, persistence, AI or mailbox writes.
// Graph v1.0 contract checked against Microsoft Learn message-delta and immutable-id docs.
import { createHash } from "node:crypto";
import { graphGet } from "./m365-transport.mjs";

const MAILBOX = "veryvera@nadbytecna.cz";
const FIELDS =
  "id,from,subject,body,conversationId,internetMessageId,receivedDateTime,hasAttachments,webLink,changeKey";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_CHARACTERS = 100000;
const ALL_HISTORY_SINCE = "1970-01-01T00:00:00.000Z";
export const m365Enabled = (env = process.env) =>
  env.M365_INGEST_ENABLED === "true";
export function m365Error(code) {
  return Object.assign(new Error("Microsoft 365 read-only operation failed."), {
    name: "M365ReadError",
    code,
  });
}
function text(value, max, required = false) {
  if (value == null && !required) return null;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.length) ||
    /\u0000/.test(value)
  )
    throw m365Error("invalid_response");
  return value;
}
function bodyPreview(content) {
  if (content.includes("\u0000")) throw m365Error("invalid_response");
  let end = 0, count = 0;
  // Bound the stored preview by PostgreSQL characters, preserving astral pairs.
  for (const character of content) {
    if (count === MAX_PREVIEW_CHARACTERS) break;
    end += character.length;
    count++;
  }
  return { text: content.slice(0, end), truncated: end < content.length };
}
function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)
  )
    throw m365Error("invalid_configuration");
  const d = new Date(value);
  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw m365Error("invalid_configuration");
  return d.toISOString();
}
export function readM365Config(env = process.env) {
  const mailbox =
    typeof env.M365_MAILBOX === "string"
      ? env.M365_MAILBOX.trim().toLowerCase()
      : "";
  const folder = env.M365_FOLDER_ID;
  if (
    mailbox !== MAILBOX ||
    typeof folder !== "string" ||
    !/^[A-Za-z0-9_=+\-]{1,256}$/.test(folder)
  )
    throw m365Error("invalid_configuration");
  const since = date(env.M365_SINCE);
  return { mailbox, folderId: folder, since };
}
export function readM365Scope(env = process.env) {
  const scope = readM365Config(env);
  return {
    ...scope,
    folder: scope.folderId,
    delegated: env.M365_AUTH_MODE === "delegated",
  };
}
function pathFor(scope) {
  return (
    (scope.delegated
      ? "/v1.0/me"
      : "/v1.0/users/" + encodeURIComponent(scope.mailbox)) +
    "/mailFolders/" +
    encodeURIComponent(scope.folderId ?? scope.folder) +
    "/messages/delta"
  );
}
export function validateM365Cursor(value, scope) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 16384 ||
    value.trim() !== value ||
    /[\r\n\\]/.test(value)
  )
    throw m365Error("invalid_cursor");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw m365Error("invalid_cursor");
  }
  if (
    url.protocol !== "https:" ||
    url.host !== "graph.microsoft.com" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw m365Error("invalid_cursor");
  // Compare decoded segments, including Graph's documented OData key notation.
  // Only the fixed collection name and well-known Inbox alias are case insensitive.
  let actual, expected;
  try {
    actual = url.pathname.split("/").map(decodeURIComponent);
    expected = pathFor(scope).split("/").map(decodeURIComponent);
  } catch {
    throw m365Error("invalid_cursor");
  }
  const folderAt = scope.delegated ? 3 : 4;
  const ownerStyle = actual[2] === "me" ? "me"
    : actual[2] === "users" ? "users_path"
    : /^users\('/.test(actual[2] || "") ? "users_odata" : "other";
  const originalFolder = actual[folderAt];
  const keyedFolder = /^mailfolders\('([^']+)'\)$/i.exec(originalFolder || "");
  const folderStyle = keyedFolder ? "odata"
    : /^mailfolders$/i.test(originalFolder || "") ? "path" : "other";
  const invalid = () => Object.assign(m365Error("invalid_cursor"), {
    // Constant enums/booleans only: never retain URL, IDs, mailbox or token values.
    cursorShape: {
      ownerStyle, folderStyle,
      sameOwner: actual.slice(0, folderAt).join("/") === expected.slice(0, folderAt).join("/"),
      sameFolder: false,
      queryStyle: url.searchParams.size === 1 && url.searchParams.has("$skiptoken") ? "skip"
        : url.searchParams.size === 1 && url.searchParams.has("$deltatoken") ? "delta" : "other",
    },
  });
  if (actual.some((segment) => /[\\/]/.test(segment))) throw invalid();
  if (keyedFolder) actual.splice(folderAt, 1, "mailFolders", keyedFolder[1]);
  else if (folderStyle === "path") actual[folderAt] = "mailFolders";
  if (expected[folderAt + 1]?.toLowerCase() === "inbox" &&
      actual[folderAt + 1]?.toLowerCase() === "inbox")
    actual[folderAt + 1] = expected[folderAt + 1];
  const sameFolder = actual[folderAt + 1] === expected[folderAt + 1];
  const reject = () => {
    const error = invalid();
    error.cursorShape.sameFolder = sameFolder;
    return error;
  };
  if (
    actual.length !== expected.length ||
    actual.some((s, i) => s !== expected[i] || /[\\/]/.test(s))
  )
    throw reject();
  if (
    !url.search ||
    [...url.searchParams.keys()].some(
      (k) => !["$skiptoken", "$deltatoken"].includes(k),
    ) ||
    url.searchParams.size !== 1 ||
    ![...url.searchParams.values()][0]
  )
    throw reject();
  return url.href;
}
function key(scope, id) {
  return createHash("sha256")
    .update(JSON.stringify(["microsoft365", scope.mailbox, id]))
    .digest("hex");
}
function normalize(message, scope) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw m365Error("invalid_response");
  const id = text(message.id, 2048, true);
  const base = {
    source: "microsoft365",
    externalId: id,
    dedupKey: key(scope, id),
    mailbox: scope.mailbox,
    folderId: scope.folderId ?? scope.folder,
  };
  if (Object.hasOwn(message, "@removed")) {
    if (
      !message["@removed"] ||
      typeof message["@removed"] !== "object" ||
      Array.isArray(message["@removed"])
    )
      throw m365Error("invalid_response");
    return { removed: true, record: base };
  }
  if (
    !message.body ||
    message.body.contentType !== "text" ||
    typeof message.body.content !== "string"
  )
    throw m365Error("invalid_response");
  let receivedAt;
  try {
    receivedAt = date(message.receivedDateTime);
  } catch {
    throw m365Error("invalid_response");
  }
  if (receivedAt < scope.since) return null;
  const sender = message.from?.emailAddress;
  if (
    !sender ||
    typeof sender !== "object" ||
    typeof message.hasAttachments !== "boolean"
  )
    throw m365Error("invalid_response");
  const senderEmail = text(sender.address, 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail))
    throw m365Error("invalid_response");
  const webLink = text(message.webLink, 4096);
  if (webLink) {
    let link;
    try {
      link = new URL(webLink);
    } catch {
      throw m365Error("invalid_response");
    }
    if (link.protocol !== "https:" || link.username || link.password)
      throw m365Error("invalid_response");
  }
  const preview = bodyPreview(message.body.content);
  return {
    removed: false,
    record: {
      ...base,
      senderName: text(sender.name, 500),
      senderEmail,
      subject: text(message.subject, 2000) ?? "",
      text: preview.text,
      bodyTruncated: preview.truncated,
      receivedAt,
      conversationId: text(message.conversationId, 2048),
      internetMessageId: text(message.internetMessageId, 2048),
      hasAttachments: message.hasAttachments,
      sourceChangeKey: text(message.changeKey, 2048),
      webLink,
      consent: null,
      consentPublish: null,
      ageConfirmed: null,
      aiEligible: false,
    },
  };
}
export async function readM365Json(response, maxBytes = MAX_RESPONSE_BYTES) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw m365Error("response_too_large");
  }
  if (
    !(response.headers?.get?.("content-type") || "")
      .toLowerCase()
      .includes("application/json")
  )
    throw m365Error("invalid_response");
  let raw;
  if (response.body?.getReader) {
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw m365Error("response_too_large");
        }
        chunks.push(Buffer.from(value));
      }
      raw = Buffer.concat(chunks).toString("utf8");
    } finally {
      reader.releaseLock();
    }
  } else {
    raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maxBytes)
      throw m365Error("response_too_large");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw m365Error("invalid_response");
  }
}
export async function readM365DeltaPage({
  env = process.env,
  accessToken,
  fetcher = fetch,
  cursor = null,
} = {}) {
  if (!m365Enabled(env))
    return {
      enabled: false,
      messages: [],
      removals: [],
      nextLink: null,
      deltaLink: null,
    };
  const scope = readM365Scope(env);
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    accessToken.length > 16384 ||
    /\s/.test(accessToken) ||
    typeof fetcher !== "function"
  )
    throw m365Error("invalid_configuration");
  const initial = new URL("https://graph.microsoft.com" + pathFor(scope));
  initial.searchParams.set("$select", FIELDS);
  // Microsoft caps filtered message-delta synchronization at 5,000 messages.
  // The explicitly configured epoch scope means full Inbox history: start an
  // unfiltered folder delta instead. Local date validation/normalization and
  // bounded pages remain unchanged, including on token-only continuations.
  // https://learn.microsoft.com/en-us/graph/delta-query-messages
  if (scope.since !== ALL_HISTORY_SINCE)
    initial.searchParams.set("$filter", "receivedDateTime ge " + scope.since);
  const target =
    cursor === null ? initial.href : validateM365Cursor(cursor, scope);
  async function fetchPage(pageSize) {
    return graphGet({url:target,fetcher,timeoutMs:30000,
      headers:{Authorization:"Bearer "+accessToken,Accept:"application/json",Prefer:'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize='+pageSize},
      consume:async response=>{
    if (response.status === 410) throw m365Error("cursor_expired");
    if (response.status === 401 || response.status === 403)
      throw m365Error("authentication_failed");
    if (response.status === 429) {
      const e = m365Error("throttled"),
        retry = response.headers?.get?.("retry-after");
      if (/^\d{1,6}$/.test(retry || ""))
        e.retryAfterSeconds = Math.min(Number(retry), 86400);
      throw e;
    }
    if (response.status !== 200 || response.redirected)
      throw m365Error("http_error");
    try {
      return await readM365Json(response);
    } catch (e) {
      if (e?.name === "M365ReadError") throw e;
      throw m365Error("invalid_response");
    }
      }
    });
  }
  let data;
  try {
    data = await fetchPage(25);
  } catch (error) {
    if (error?.code !== "response_too_large") throw error;
    // Retry the exact same cursor once; page-size is a preference header only.
    // If even one message is too large, preserve the cursor and fail explicitly.
    data = await fetchPage(1);
  }
  if (!data || !Array.isArray(data.value) || data.value.length > 100)
    throw m365Error("invalid_response");
  const nextLink =
    data["@odata.nextLink"] == null
      ? null
      : validateM365Cursor(data["@odata.nextLink"], scope);
  const deltaLink =
    data["@odata.deltaLink"] == null
      ? null
      : validateM365Cursor(data["@odata.deltaLink"], scope);
  if (
    (!nextLink && !deltaLink) ||
    (nextLink && deltaLink) ||
    nextLink === target
  )
    throw m365Error("invalid_response");
  const normalized = new Map();
  for (const value of data.value) {
    const n = normalize(value, scope);
    if (n) normalized.set(n.record.externalId, n);
  }
  return {
    enabled: true,
    messages: [...normalized.values()]
      .filter((n) => !n.removed)
      .map((n) => n.record),
    removals: [...normalized.values()]
      .filter((n) => n.removed)
      .map((n) => n.record),
    nextLink,
    deltaLink,
  };
}
