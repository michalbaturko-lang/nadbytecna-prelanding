import test from "node:test";
import assert from "node:assert/strict";
import { parseTriage, triageText, triageEnabled } from "../lib/triage.mjs";
const valid = {
  summary:
    "Osoba hledá pomoc v náročné situaci. Další postup vyžaduje lidské ověření.",
  category: "potrebuji_pomoc",
  urgency: "high",
  help_type: "Ověřit bezpečný kontakt a nabídnout odbornou konzultaci.",
};
test("pevný číselník odmítne nevalidní kategorii i naléhavost", () => {
  assert.equal(parseTriage(valid, "story").category, "potrebuji_pomoc");
  for (const patch of [
    { category: "jiné" },
    { urgency: "watch" },
    { summary: "" },
    { help_type: 42 },
  ])
    assert.throws(
      () => parseTriage({ ...valid, ...patch }, "story"),
      /invalid/,
    );
});
test("AI vypnutá i pro ručního volajícího, nevolá žádný model", async () => {
  delete process.env.AI_TRIAGE_ENABLED;
  assert.equal(triageEnabled(), false);
  let calls = 0;
  await assert.rejects(
    () =>
      triageText({
        kind: "story",
        text: "syntetické",
        key: "test",
        fetcher: async () => {
          calls++;
        },
      }),
    /ai_disabled/,
  );
  assert.equal(calls, 0);
});
test("structured output, timeout, API chyba a nevalidní JSON", async () => {
  process.env.AI_TRIAGE_ENABLED = "true";
  let body;
  const fetcher = async (u, opt) => {
    body = JSON.parse(opt.body);
    assert.ok(opt.signal);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(valid) } }],
      }),
    };
  };
  const out = await triageText({
    kind: "story",
    text: "syntetické",
    key: "test",
    fetcher,
  });
  assert.equal(out.category, valid.category);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  for (const fetcher of [
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
    async () => ({ ok: false }),
    async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not JSON" } }] }),
    }),
  ])
    await assert.rejects(() =>
      triageText({ kind: "story", text: "syntetické", key: "test", fetcher }),
    );
  delete process.env.AI_TRIAGE_ENABLED;
});
