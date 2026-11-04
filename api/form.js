import { issueFormToken } from "../lib/form.js";
import { json } from "../lib/http.js";

// Vydá podepsaný token pro formulář (viz lib/form.js). Nic neukládá.
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { error: "method" }); }
  try { return json(res, 200, { k: issueFormToken() }); }
  catch (e) { console.error("form token failed"); return json(res, 500, { error: "server" }); }
}
