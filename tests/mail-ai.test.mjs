import test from "node:test";
import assert from "node:assert/strict";
import {
  mailAiEnabled,
  classifyMail,
  parseMailClassification,
} from "../lib/mail-ai.mjs";
const valid = {
  email_type: "story",
  category: "pravni",
  urgency: "medium",
  summary: "Pisatel uvádí potřebu právní podpory.",
  help_type: "Osobně ověřit potřeby.",
};
test("mail classification requires independent approval and source flag even with global AI on", async () => {
  const old = { ...process.env };
  try {
    process.env.AI_TRIAGE_ENABLED = "true";
    process.env.AI_EMAIL_CLASSIFICATION_ENABLED = "true";
    delete process.env.AI_EMAIL_PROCESSING_APPROVED;
    assert.equal(mailAiEnabled(), false);
    let calls = 0;
    await assert.rejects(
      classifyMail({
        messages: [{ body_text: "test" }],
        categories: ["pravni"],
        key: "synthetic",
        fetcher: async () => {
          calls++;
        },
      }),
      /disabled/,
    );
    assert.equal(calls, 0);
    process.env.AI_EMAIL_PROCESSING_APPROVED = "true";
    assert.equal(mailAiEnabled(), true);
    process.env.AI_TRIAGE_ENABLED = "false";
    assert.equal(mailAiEnabled(), false);
  } finally {
    process.env = old;
  }
});
test("mail classification validates source type, category and bounded fields", () => {
  assert.deepEqual(parseMailClassification(valid, ["pravni"]), valid);
  assert.equal(
    parseMailClassification({ ...valid, email_type: "other", category: null }, [
      "pravni",
    ]).category,
    null,
  );
  for (const patch of [
    { email_type: "published" },
    { category: "fake" },
    { urgency: "urgent" },
    { summary: "" },
    { summary: "x".repeat(1001) },
    { help_type: "x".repeat(501) },
  ])
    assert.throws(() =>
      parseMailClassification({ ...valid, ...patch }, ["pravni"]),
    );
});
test("mail AI uses no tools, no storage, bounded untrusted input and strict structured output", async () => {
  const old = { ...process.env };
  Object.assign(process.env, {
    AI_TRIAGE_ENABLED: "true",
    AI_EMAIL_CLASSIFICATION_ENABLED: "true",
    AI_EMAIL_PROCESSING_APPROVED: "true",
  });
  try {
    const output = await classifyMail({
      messages: [{ subject: "test", body_text: "x".repeat(30000) }],
      categories: ["pravni"],
      key: "synthetic",
      fetcher: async (url, opts) => {
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        const b = JSON.parse(opts.body);
        assert.equal(b.store, false);
        assert.equal(b.tools, undefined);
        assert.equal(b.messages[1].content.length, 20000);
        assert.match(b.messages[0].content, /nedůvěryhodná data/);
        assert.equal(b.response_format.json_schema.strict, true);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(valid) } }],
          }),
        );
      },
    });
    assert.equal(output.email_type, "story");
    await assert.rejects(
      classifyMail({
        messages: [{ body_text: "test" }],
        categories: ["pravni"],
        key: "synthetic",
        fetcher: async () => {
          throw new DOMException("timeout", "TimeoutError");
        },
      }),
    );
    await assert.rejects(
      classifyMail({
        messages: [{ body_text: "test" }],
        categories: ["pravni"],
        key: "synthetic",
        fetcher: async () => new Response("{}", { status: 500 }),
      }),
      /mail_ai_failed/,
    );
  } finally {
    process.env = old;
  }
});
