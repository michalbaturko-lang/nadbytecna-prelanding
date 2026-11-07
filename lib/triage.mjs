// Třídění příběhů a nabídek. Text se nikam neloguje.
export const STORY_CATEGORIES = ["práce", "rodina a děti", "zdraví", "finance", "šikana/obtěžování", "bydlení", "jiné"];
export const STORY_HELP = ["právník", "terapeut", "práce", "jiné"];
export const OFFER_TYPES = ["právník", "terapeut", "práce", "výrobky/služby", "jiné"];
const URGENCY = ["none", "watch", "acute"];

export function triageEnabled() {
  const v = String(process.env.AI_TRIAGE_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export function classifyLocal(text, kind) {
  const t = String(text || "").toLowerCase();
  const acute = /sebevra|ublížit si|nechci žít|zabij|znásiln|bije|bijí|vyhrožuje|násilí|akutn/.test(t);
  let category = "jiné";
  if (/šikan|obtěž|násil|bije|bijí|znásiln/.test(t)) category = "šikana/obtěžování";
  else if (/dítě|děti|manžel|opatrov|škola|rodin/.test(t)) category = "rodina a děti";
  else if (/práce|zaměst|výpověď|šéf|brigád/.test(t)) category = "práce";
  else if (/dluh|peníz|exekuc|aliment|financ/.test(t)) category = "finance";
  else if (/byt|nájem|vystěh|bydlen/.test(t)) category = "bydlení";
  else if (/nemoc|lékař|depres|úzkost|zdrav/.test(t)) category = "zdraví";
  let help = "jiné";
  if (/právn|soud|advokát/.test(t)) help = "právník";
  else if (/terap|psycholog/.test(t)) help = "terapeut";
  else if (category === "práce") help = "práce";
  if (kind === "help") {
    if (/výrob|služb|e-shop|eshop/.test(t)) help = "výrobky/služby";
    return {
      summary: acute ? "Nabídka pomoci. Text naznačuje akutní situaci." : "Nabídka pomoci. " + help + ".",
      category: help,
      urgency: acute ? "acute" : "none",
      help_type: help,
      matches: [],
    };
  }
  const bits = t.replace(/\s+/g, " ").trim().slice(0, 180);
  return {
    summary: (acute ? "Text naznačuje akutní ohrožení. " : "") + (bits ? bits.slice(0, 140) + "." : "Krátký příběh bez dalšího upřesnění."),
    category,
    urgency: acute ? "acute" : /strach|bojím|nevím si rady/.test(t) ? "watch" : "none",
    help_type: help,
    matches: [],
  };
}

export function parseTriage(raw, kind) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const cats = kind === "help" ? OFFER_TYPES : STORY_CATEGORIES;
  const helps = kind === "help" ? OFFER_TYPES : STORY_HELP;
  const category = cats.includes(data.category) ? data.category : "jiné";
  const help = helps.includes(data.help_type) ? data.help_type : "jiné";
  const urgency = URGENCY.includes(data.urgency) ? data.urgency : "none";
  const summary = String(data.summary || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!summary) throw new Error("summary");
  const matches = Array.isArray(data.matches) ? data.matches.map((x) => String(x)).slice(0, 5) : [];
  return { summary, category, urgency, help_type: help, matches };
}

export async function triageText({ kind, text, key, fetcher }) {
  const call = fetcher || fetch;
  const model = "gpt-4o-mini";
  const cats = kind === "help" ? OFFER_TYPES : STORY_CATEGORIES;
  const helps = kind === "help" ? OFFER_TYPES : STORY_HELP;
  if (!key) {
    const err = new Error("no-key");
    err.code = "no-key";
    throw err;
  }
  const res = await call("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Třídíš citlivé české texty. Vrať jen JSON se klíči summary (2 až 3 věty česky), category (jedna z: " + cats.join(", ") + "), urgency (none, watch, acute), help_type (jedna z: " + helps.join(", ") + "), matches (pole krátkých témat). Akutní je násilí, vyhrožování, sebepoškození nebo bezprostřední nebezpečí. Nic neloguj." },
        { role: "user", content: String(text || "").slice(0, 8000) },
      ],
    }),
  });
  if (!res.ok) {
    const err = new Error("openai");
    err.code = res.status === 401 || res.status === 403 ? "openai-auth" : "openai";
    throw err;
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const parsed = parseTriage(content, kind);
  return { ...parsed, model };
}
