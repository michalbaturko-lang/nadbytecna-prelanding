// Sestavení interní kopie příběhu nebo nabídky pomoci (celý text a kontakt).
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (iso) =>
  new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
const yn = (v) => (v === true ? "ano" : v === false ? "ne" : "neuvedeno");
const HELP = { prace: "práce", terapie: "terapie", pravni: "právní pomoc", vyrobky: "výrobky", pridej: "přidej se / zůstat ve spojení", jine: "jiné" };

export function buildCopy(table, row, audioUrl) {
  const story = table === "stories";
  const rows = [];
  rows.push(["Jméno", row.full_name || "neuvedeno"]);
  rows.push(["E-mail", row.email || "neuvedeno"]);
  if (!story) rows.push(["Telefon", row.phone || "neuveden"]);
  rows.push(["Doručeno", fmt(row.created_at)]);
  if (story) {
    rows.push(["Anonymně", yn(row.anonymous)]);
    rows.push(["Chce také pomáhat", yn(row.wants_to_help)]);
    rows.push(["Souhlas se zveřejněním", yn(row.consent_publish)]);
    rows.push(["Typ", row.input_type === "text" ? "textový příběh" : "zvuková nahrávka / soubor"]);
  } else {
    rows.push(["Typ nabídky", row.helper_type === "professional" ? "odborná pomoc" : "vlastní zkušenost"]);
    const kinds = (Array.isArray(row.help_kinds) ? row.help_kinds : []).map((k) => HELP[k] || k);
    if (kinds.length) rows.push(["Jak chce pomoci", kinds.join(", ")]);
    const links = row.links && typeof row.links === "object" ? Object.entries(row.links).filter(([, v]) => v) : [];
    for (const [k, v] of links) rows.push([k, v]);
    rows.push(["Souhlas se zveřejněním", yn(row.consent_publish)]);
  }
  const text = (story ? row.story_text : row.message) || "";
  const head = story ? "Nový příběh" : "Nová nabídka pomoci";
  const who = row.anonymous ? "anonymně" : row.full_name || "bez jména";
  const subject = `Nadbytečná – ${head.toLowerCase()}: ${who} (${new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" }).format(new Date(row.created_at))})`;
  const audio = audioUrl
    ? `Nahrávka (odkaz platí 7 dní): ${audioUrl}`
    : !text && story ? "Nahrávka je uložená v adminu, přepis zatím není." : "";
  const body = [text, audio].filter(Boolean).join("\n\n");
  const plain = `${head} z formuláře nadbytečná.cz (text beze změn).\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${body}\n\n---\nDůvěrné: obsahuje osobní údaje, nepřeposílejte mimo tým.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222"><p><b>${esc(head)}</b> z formuláře nadbytečná.cz (text beze změn).</p><table cellpadding="4" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table><hr style="border:none;border-top:1px solid #ddd"><div style="white-space:pre-wrap">${esc(text)}</div>${audio ? `<p>${esc(audio)}</p>` : ""}<p style="color:#888;font-size:12px">Důvěrné: obsahuje osobní údaje, nepřeposílejte mimo tým.</p></div>`;
  return { subject, text: plain, html };
}
