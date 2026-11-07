import test from "node:test";
import assert from "node:assert/strict";
import { transcribeCzech, transcriptionEnabled, TRANSCRIBE_MODELS } from "../lib/transcribe.mjs";
import { storyTemplateId, helpTemplateId, mailEnabled } from "../lib/phase1-mail.mjs";

test("přepis je vypnutý bez klíče a při chybě autentizace neprozradí klíč", async () => {
  assert.equal(transcriptionEnabled({}), false);
  assert.equal(TRANSCRIBE_MODELS[0], "gpt-4o-transcribe");
  assert.equal(TRANSCRIBE_MODELS[1], "whisper-1");
  await assert.rejects(() => transcribeCzech(Buffer.from("x"), { key: "", fetchImpl() { throw new Error("nemělo se volat"); } }), (e) => e.code === "skipped");
  const secret = "sk-test-secret-value";
  await assert.rejects(() => transcribeCzech(Buffer.from("abcd"), {
    key: secret,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: secret } }) }),
  }), (e) => e.code === "openai-auth" && !String(e.message).includes(secret) && !String(e.stack || "").includes("should-not"));
});

test("přepis zkusí gpt-4o-transcribe v češtině a pak whisper-1", async () => {
  const calls = [];
  const out = await transcribeCzech(Buffer.from("abcd"), {
    key: "present",
    filename: "hlas.wav",
    mime: "audio/wav",
    fetchImpl: async (_url, opt) => {
      calls.push({ model: opt.body.get("model"), language: opt.body.get("language") });
      if (calls.length === 1) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ text: "  Dobrý den.  " }) };
    },
  });
  assert.deepEqual(calls, [
    { model: "gpt-4o-transcribe", language: "cs" },
    { model: "whisper-1", language: "cs" },
  ]);
  assert.equal(out.text, "Dobrý den.");
  assert.equal(out.model, "whisper-1");
});

test("e-mail se bez klíčů neposílá a šablona sedí na typ formuláře", () => {
  assert.equal(mailEnabled({}), false);
  assert.equal(mailEnabled({ RESEND_API_KEY: "x" }), false);
  assert.equal(storyTemplateId({ anonymous: true, input_type: "upload", wants_to_help: false }), "share-anonymous-voice-story");
  assert.equal(storyTemplateId({ anonymous: false, input_type: "text", wants_to_help: true }), "share-named-text-also-help");
  assert.equal(helpTemplateId({ helper_type: "lived_experience", help_kinds: [] }), "help-been-through");
  assert.equal(helpTemplateId({ helper_type: "professional", help_kinds: ["pravni"] }), "help-others-pravni");
  assert.equal(helpTemplateId({ helper_type: "professional", help_kinds: ["prace", "terapie"] }), "help-others");
});
