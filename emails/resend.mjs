// Tvar zprávy pro pozdější odeslání přes Resend. Odsud se nic neposílá.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));

export const from = catalog.from;
export const replyTo = catalog.reply_to;
export const templates = catalog.templates;

function fill(s, vars) {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

export function resendPayload(id, { to, jmeno } = {}) {
  const template = templates.find((t) => t.id === id);
  if (!template) throw new Error("neznámá šablona");
  const vars = { jmeno: jmeno || "" };
  return {
    from,
    to: [to],
    reply_to: replyTo,
    subject: fill(template.subject, vars),
    html: fill(fs.readFileSync(path.join(root, template.html), "utf8"), vars),
    text: fill(fs.readFileSync(path.join(root, template.text), "utf8"), vars),
  };
}
