// Compatibility endpoint: same authorization and hard AI gate as the admin API.
import admin from "./admin.js";
import { readBody } from "../lib/admin-server.mjs";
import { json } from "../lib/http.js";
export default async function handler(req, res) {
  // Anonymous public submission cannot select arbitrary records for external processing.
  if (!req.headers.authorization) return json(res, 401, { error: "auth" });
  try {
    const b = await readBody(req);
    req.body = { action: "ai", entity: b.table, id: b.id };
    return admin(req, res);
  } catch {
    return json(res, 400, { error: "json" });
  }
}
