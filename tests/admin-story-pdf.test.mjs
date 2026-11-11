import test from "node:test";
import assert from "node:assert/strict";
import { createStoryPdf, storyPdfContent } from "../lib/story-pdf.mjs";
import { startAdminServer, token, otherToken } from "./helpers/admin-server.mjs";
import { STORY } from "./helpers/admin-db.mjs";

const source = {
  full_name: "Ukázková autorka", created_at: "2026-11-11T16:34:00Z", input_type: "text",
  body: "Začínám znovu. Mám co nabídnout.\n\nPříliš žluťoučký kůň úpěl ďábelské ódy.\n\nPůvodní text zůstává celý.",
  email: "private@example.invalid", notes: ["SECRET_INTERNAL_NOTE"], status: "new",
};

test("PDF reading copy preserves the author's opening, full text and Prague time; anonymity omits identity", async () => {
  const content = storyPdfContent(source);
  assert.equal(content.title, "Začínám znovu.");
  assert.equal(content.deck, "Mám co nabídnout.");
  assert.equal(content.paragraphs.join("\n\n"), source.body.split("\n\n").slice(1).join("\n\n"));
  assert.match(content.date, /17:34/);
  const anonymous = storyPdfContent({ ...source, anonymous: true });
  assert.equal(anonymous.author, "Anonymní příběh");
  assert.ok(!JSON.stringify(anonymous).includes(source.full_name));
  assert.ok(!JSON.stringify(anonymous).includes(source.email));
  assert.ok(!JSON.stringify(anonymous).includes("SECRET_INTERNAL_NOTE"));
  const pdf = await createStoryPdf({ ...source, anonymous: true });
  assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pdf.pages, 1);
  assert.ok(!pdf.bytes.includes(Buffer.from("SECRET_INTERNAL_NOTE")));
  assert.match(pdf.bytes.toString("latin1"), /\/FontFile2/);
});

test("audio-only PDF states that transcription is unavailable; existing transcript stays explicitly labelled", async () => {
  const audio = { ...source, body: "", input_type: "recording", audio_path: "private/audio.webm" };
  assert.equal(storyPdfContent(audio).audioOnly, true);
  const transcript = storyPdfContent({ ...audio, transcript: "Skutečně uložený přepis." });
  assert.equal(transcript.audioOnly, false);
  assert.equal(transcript.transcript, "Skutečně uložený přepis.");
  const pdf = await createStoryPdf(audio);
  assert.equal(pdf.pages, 1);
  assert.ok(!pdf.bytes.includes(Buffer.from(audio.audio_path)));
});

test("long paragraphs and unbroken text paginate without a fixed text limit or trailing blank page", async () => {
  const body = "Dlouhý příběh s českou diakritikou. ".repeat(1800) + "\n\n" + "DlouhéSlovo".repeat(80) + "\n\nKONEC PŘÍBĚHU.";
  const content = storyPdfContent({ ...source, body });
  assert.equal(content.paragraphs.join("\n\n"), body);
  const pdf = await createStoryPdf({ ...source, body });
  assert.ok(pdf.pages > 8);
  assert.equal((pdf.bytes.toString("latin1").match(/\/Type \/Page\b/gu) || []).length, pdf.pages);
  assert.ok(pdf.bytes.length < 2_000_000);
});

test("PDF API requires existing admin access and a valid stored story; it exports without changing the story", async () => {
  const s = await startAdminServer();
  const call = (body, t = token) => s.fetch(s.url + "/api/admin/", { method: "POST", headers: {
    "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}),
  }, body: JSON.stringify(body) });
  try {
    const request = { action: "story_pdf", entity: "stories", id: STORY };
    assert.equal((await call(request, "")).status, 401);
    assert.equal((await call(request, otherToken)).status, 403);
    assert.equal((await call({ ...request, id: "invalid" })).status, 400);
    assert.equal((await call({ ...request, id: "99999999-9999-4999-8999-999999999999" })).status, 404);
    const before = (await s.db.query("SELECT * FROM public.stories WHERE id=$1", [STORY])).rows[0];
    const r = await call(request);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("content-disposition"), /attachment; filename="pribeh-[a-f0-9]{8}\.pdf"/);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual((await s.db.query("SELECT * FROM public.stories WHERE id=$1", [STORY])).rows[0], before);
    const audits = (await s.db.query("SELECT diff FROM public.admin_audit_log WHERE action='export_story_pdf' AND entity_id=$1", [STORY])).rows;
    assert.equal(audits.length, 1);
    assert.deepEqual(Object.keys(audits[0].diff), ["pages"]);
    assert.equal(s.metrics.ai, 0);
    const offer = (await s.db.query("SELECT id FROM public.help_offers LIMIT 1")).rows[0];
    assert.equal((await call({ ...request, entity: "help_offers", id: offer.id })).status, 400);
    await s.db.query("UPDATE public.stories SET erasure_requested_at=now() WHERE id=$1", [STORY]);
    assert.equal((await call(request)).status, 404);
  } finally { await s.close(); }
});
