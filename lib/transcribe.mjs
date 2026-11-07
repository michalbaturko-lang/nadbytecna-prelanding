// Přepis češtiny přes OpenAI. Nejdřív gpt-4o-transcribe, při jiné chybě whisper-1.
// Bez OPENAI_API_KEY se nic nevolá. Klíč se nikam nezapisuje do odpovědi ani do chyby.

export const TRANSCRIBE_MODELS = ["gpt-4o-transcribe", "whisper-1"];

export function transcriptionEnabled(env = process.env) {
  return Boolean(String(env.OPENAI_API_KEY || "").trim());
}

export async function transcribeCzech(bytes, { filename = "hlas.webm", mime = "application/octet-stream", key, fetchImpl = fetch } = {}) {
  if (!key) {
    const err = new Error("skipped");
    err.code = "skipped";
    throw err;
  }
  const models = TRANSCRIBE_MODELS;
  let lastStatus = 0;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: mime || "application/octet-stream" }), filename);
    body.append("model", model);
    body.append("language", "cs");
    body.append("response_format", "json");
    const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error("openai-auth");
      err.code = "openai-auth";
      throw err;
    }
    if (!res.ok) {
      lastStatus = res.status;
      continue;
    }
    const data = await res.json();
    const text = String(data && data.text || "").trim();
    if (text) return { model, text };
    lastStatus = res.status || 422;
  }
  const err = new Error("openai");
  err.code = "openai";
  err.status = lastStatus;
  throw err;
}
