import { json } from "../lib/http.js";
import { transcribeCzech, transcriptionEnabled } from "../lib/transcribe.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 8 * 1024 * 1024;
const hits = new Map();

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase(); }
  catch { return false; }
}

function limited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "x").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 20) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

async function bytesOf(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (typeof req.body === "string" && req.body) return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX) {
      const err = new Error("size");
      err.code = "size";
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function filenameOf(req, mime) {
  const raw = decodeURIComponent(String(req.headers["x-audio-name"] || "hlas"));
  const base = raw.split(/[/\\]/).pop().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 80);
  if (base) return base;
  return String(mime).includes("wav") ? "hlas.wav" : "hlas.webm";
}

async function saveTranscript(id, text) {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "");
  if (!url || !key) return false;
  const res = await fetch(`${url}/rest/v1/rpc/save_transcript`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id, p_text: text }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  if (!sameOrigin(req)) return json(res, 403, { error: "origin" });
  if (limited(req)) return json(res, 429, { error: "rate" });
  const id = String(req.headers["x-story-id"] || "");
  if (!UUID.test(id)) return json(res, 400, { error: "id" });
  if (!transcriptionEnabled()) return json(res, 200, { skipped: true });
  try {
    const buf = await bytesOf(req);
    if (!buf.length) return json(res, 400, { error: "empty" });
    const mime = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
    const out = await transcribeCzech(buf, {
      filename: filenameOf(req, mime),
      mime,
      key: process.env.OPENAI_API_KEY,
    });
    const saved = await saveTranscript(id, out.text);
    return json(res, 200, { ok: true, saved, model: out.model });
  } catch (e) {
    if (e && e.code === "size") return json(res, 413, { error: "size" });
    if (e && e.code === "openai-auth") return json(res, 502, { error: "openai-auth" });
    return json(res, 502, { error: "openai" });
  }
}
