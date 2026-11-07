import test from "node:test";
import assert from "node:assert/strict";
import { classifyLocal, parseTriage, triageText } from "../lib/triage.mjs";

const stories = [
  ["Dostala jsem výpověď a šéf mě vyhodil z práce.", "práce", "none"],
  ["Manžel mi nechce dát děti a řešíme opatrovnictví.", "rodina a děti", "none"],
  ["Mám úzkost a lékař mi říká, že je to deprese.", "zdraví", "none"],
  ["Exekuce a dluhy, nezvládám peníze na nájem.", "finance", "none"],
  ["Manžel mě bije a vyhrožuje, že mě zabije. Nechci žít.", "šikana/obtěžování", "acute"],
];

test("pět českých příběhů vrátí kategorii a akutní vlajku", () => {
  for (const [text, category, urgency] of stories) {
    const out = classifyLocal(text, "story");
    assert.equal(out.category, category, text);
    assert.equal(out.urgency, urgency, text);
    assert.ok(out.summary.length > 20);
    const parsed = parseTriage(JSON.stringify(out), "story");
    assert.equal(parsed.category, category);
    assert.equal(parsed.urgency, urgency);
  }
});

test("OpenAI JSON se přečte a chyba volání neshodí volajícího", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: "Krátké shrnutí příběhu o práci a nejistotě.", category: "práce", urgency: "none", help_type: "práce", matches: [] }) } }] }),
  });
  const out = await triageText({ kind: "story", text: "Výpověď z práce.", key: "test", fetcher });
  assert.equal(out.category, "práce");
  assert.equal(out.model, "gpt-4o-mini");
  const bad = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => triageText({ kind: "story", text: "x", key: "test", fetcher: bad }), /openai/);
});
