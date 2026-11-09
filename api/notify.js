import { json } from "../lib/http.js";
import { mailEnabled } from "../lib/phase1-mail.mjs";
import { UUID, sendConfirmation } from "../lib/confirm-mail.mjs";

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase(); }
  catch { return false; }
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2000) throw Object.assign(new Error("size"), { code: "size" });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  if (!sameOrigin(req)) return json(res, 403, { error: "origin" });
  if (!mailEnabled()) return json(res, 200, { sent: false });
  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: "json" }); }
  const table = body && body.table === "help_offers" ? "help_offers" : body && body.table === "stories" ? "stories" : "";
  const id = String(body && body.id || "");
  if (!table || !UUID.test(id)) return json(res, 400, { error: "id" });
  const r = await sendConfirmation(table, id, 30 * 60e3);
  return json(res, 200, { sent: r.sent });
}
