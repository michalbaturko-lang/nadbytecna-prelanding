// Výběr potvrzovací šablony. Odeslání je v api/notify.js a jen s RESEND_API_KEY.

const KINDS = new Set(["prace", "terapie", "pravni", "vyrobky", "jine"]);

export function storyTemplateId(row) {
  const voice = row.input_type === "recording" || row.input_type === "upload";
  const who = row.anonymous ? "anonymous" : "named";
  const what = voice ? "voice" : "text";
  const tail = row.wants_to_help ? "also-help" : "story";
  return `share-${who}-${what}-${tail}`;
}

export function helpTemplateId(row) {
  if (row.helper_type === "lived_experience") return "help-been-through";
  const kinds = Array.isArray(row.help_kinds) ? row.help_kinds : [];
  if (kinds.length === 1 && KINDS.has(kinds[0])) return `help-others-${kinds[0]}`;
  return "help-others";
}

export function mailEnabled(env = process.env) {
  return Boolean(String(env.RESEND_API_KEY || "").trim() && String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
}
