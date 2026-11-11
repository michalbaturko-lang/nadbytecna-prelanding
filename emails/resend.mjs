// Tvar zprávy pro pozdější odeslání přes Resend. Odsud se nic neposílá a nic se nečte z disku.
import { catalog, files } from "./templates.mjs";

export const from = catalog.from;
export const replyTo = catalog.reply_to;
export const templates = catalog.templates;

function fill(s, vars) {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

export function resendPayload(id, { to, jmeno } = {}) {
  const template = templates.find((t) => t.id === id);
  if (!template) throw new Error("neznámá šablona");
  const html = files[template.html];
  const text = files[template.text];
  if (html == null || text == null) throw new Error("chybí šablona");
  const vars = { jmeno: jmeno || "" };
  return {
    from,
    to: [to],
    reply_to: replyTo,
    subject: fill(template.subject, vars),
    html: fill(html, vars),
    text: fill(text, vars),
  };
}
