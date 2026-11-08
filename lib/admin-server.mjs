import crypto from "node:crypto";
import { UUID } from "./admin-model.mjs";
export const fail = (status, code) =>
  Object.assign(new Error(code), { status, code });
function config() {
  const url = String(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  ).replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail(503, "configuration");
  if (
    process.env.VERCEL_ENV === "preview" &&
    new URL(url).hostname === "gjzsifxldxaogcuqzivb.supabase.co"
  )
    throw fail(503, "preview_database_required");
  return { url, key };
}
export async function supa(
  path,
  { method = "GET", body, raw = false, prefer } = {},
) {
  const { url, key } = config();
  const res = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw fail(res.status === 404 ? 404 : 503, "database");
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
export const rpc = (name, body) =>
  supa("/rest/v1/rpc/" + name, { method: "POST", body });
export function exact(v) {
  return (
    'eq."' + String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"'
  );
}
export function restPath(table, params = {}) {
  return "/rest/v1/" + table + "?" + new URLSearchParams(params);
}
export async function authorize(req) {
  const token = /^Bearer (.+)$/i.exec(req.headers.authorization || "")?.[1];
  if (!token) throw fail(401, "auth");
  const { url, key } = config();
  const r = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!r.ok) throw fail(401, "auth");
  const user = await r.json();
  if (!UUID.test(user.id) || !user.email || !user.email_confirmed_at)
    throw fail(403, "admin");
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
  } catch {
    throw fail(401, "auth");
  }
  // /user validated the bearer; use only its signed session identity, never editable metadata.
  if (claims.sub !== user.id || !UUID.test(claims.session_id))
    throw fail(401, "auth");
  if (
    (await rpc("admin_access", {
      p_user_id: user.id,
      p_email: user.email.toLowerCase(),
      p_session_id: claims.session_id,
    })) !== true
  )
    throw fail(403, "admin");
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    sessionId: claims.session_id,
    token,
  };
}
export async function audit(user, action, entity = null, id = null, diff = {}) {
  await supa("/rest/v1/admin_audit_log", {
    method: "POST",
    body: {
      user_id: user?.id || null,
      email: user?.email || null,
      action,
      entity,
      entity_id: id,
      diff,
    },
  });
}
export async function readBody(req) {
  const max = 20000;
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (JSON.stringify(req.body).length > max) throw fail(413, "size");
    return req.body;
  }
  let text = typeof req.body === "string" ? req.body : "";
  if (!text) {
    for await (const chunk of req) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > max) throw fail(413, "size");
    }
  }
  try {
    const b = JSON.parse(text || "{}");
    if (!b || Array.isArray(b) || typeof b !== "object") throw 0;
    return b;
  } catch {
    throw fail(400, "json");
  }
}
export function checkOrigin(req) {
  if (!req.headers.origin) return;
  let host;
  try {
    host = new URL(req.headers.origin).host;
  } catch {
    throw fail(403, "origin");
  }
  if (host !== req.headers.host) throw fail(403, "origin");
}
export function identity(body) {
  if (
    !["stories", "help_offers"].includes(body.entity) ||
    !UUID.test(body.id || "")
  )
    throw fail(400, "identity");
  return { entity: body.entity, id: body.id };
}
export async function record(entity, id, includePending = false) {
  const rows = await supa(
    restPath("admin_records", {
      entity: exact(entity),
      id: exact(id),
      ...(includePending ? {} : { erasure_requested_at: "is.null" }),
      select: "*",
      limit: "1",
    }),
  );
  if (!rows?.length) throw fail(404, "missing");
  const { search_document, ...row } = rows[0];
  return row;
}
export const mutate = (user, entity, id, patch) =>
  rpc("admin_mutate", {
    p_entity: entity,
    p_id: id,
    p_actor: user.id,
    p_email: user.email,
    p_patch: patch,
  });
export function emailHash(email) {
  const secret = process.env.GDPR_HASH_SECRET;
  if (!secret || secret.length < 32) throw fail(503, "hash_configuration");
  return crypto
    .createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex");
}
export function assertAudioPath(path, id) {
  if (
    !UUID.test(id || "") ||
    typeof path !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/i.test(
      path,
    ) ||
    path.slice(0, 36).toLowerCase() !== id.toLowerCase()
  )
    throw fail(400, "audio_path");
}
export async function removeAudio(path, id) {
  assertAudioPath(path, id);
  await supa("/storage/v1/object/story-audio", {
    method: "DELETE",
    body: { prefixes: [path] },
  });
}
