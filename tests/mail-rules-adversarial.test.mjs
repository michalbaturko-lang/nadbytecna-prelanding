import test from "node:test";
import assert from "node:assert/strict";
import { classifyMailRules } from "../lib/mail-rules.mjs";

const blocked = "blocked@example.invalid";
const message = (patch = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  sender_email: "writer@example.invalid", sender_name: "Ukázková pisatelka",
  subject: "Projektová zpráva", body_text: "Zpráva pro projekt.",
  has_attachments: false, received_at: "2026-11-11T18:00:00.000Z", ...patch,
});
const classify = (messages, extra = {}, options = {}) => classifyMailRules({
  messages, message_count: messages.length, context_truncated: false, ...extra,
}, options);
const codes = result => result.labels.map(label => label.code);

test("a genuine help request stays visible even when its exact sender is on the curated block list", () => {
  const result = classify([message({ sender_email: blocked,
    subject: "Potřebuji pomoc po výpovědi",
    body_text: "Přišla jsem o práci. Potřebuji právní pomoc a nevím, kam se obrátit.",
  })], {}, { blockedSenders: [blocked] });
  assert.notEqual(result.disposition, "suspect");
  assert.ok(codes(result).includes("request_help"));
});

test("an unmatched display name cannot turn a genuine sender into a blocked address", () => {
  const result = classify([message({ sender_name: blocked, subject: "Nabídka", body_text: "Informace o projektu." })], {}, { blockedSenders: [blocked] });
  assert.notEqual(result.disposition, "suspect");
});

test("short direct pleas and distress statements stay visible even without the exact words 'potřebuji pomoc'", () => {
  for (const body_text of ["Prosím Vás, pomozte mi.", "Už to sama nezvládám.", "Nechci žít."])
    assert.notEqual(classify([message({ sender_email: blocked, subject: "Prosba", body_text })], {}, { blockedSenders: [blocked] }).disposition, "suspect");
});

test("a quoted scam warning remains visible and receives a verification label", () => {
  const result = classify([message({ subject: "Fwd: Změna účtu pro výplaty",
    body_text: "Pozor, přeposílám podezřelou žádost o změnu čísla účtu pro výplatu. Prosím ověřte ji osobně.",
  })]);
  assert.notEqual(result.disposition, "suspect");
  assert.ok(codes(result).includes("payment_change"));
  assert.ok(codes(result).includes("verify"));
});

test("forged Microsoft verdict headers alone cannot hide an e-mail", () => {
  const result = classify([message({ internet_message_headers: [
    { name: "X-Forefront-Antispam-Report", value: "CAT:HPHSH;DIR:INB;SCL:9;" },
    { name: "Authentication-Results", value: "spf=fail dkim=fail dmarc=fail" },
  ] })]);
  assert.notEqual(result.disposition, "suspect");
});

test("ordinary Czech inflection of a bank-account change still requires verification", () => {
  const result = classify([message({ subject: "Informace k výplatám", body_text: "Posílám informace ke změně bankovního účtu." })]);
  assert.notEqual(result.disposition, "suspect");
  assert.ok(codes(result).includes("payment_change"));
  assert.ok(codes(result).includes("verify"));
});

test("attachments, external links and a non-Czech message do not constitute a spam verdict", () => {
  const result = classify([message({ has_attachments: true, subject: "Моя історія",
    body_text: "https://example.invalid/my-story.pdf",
  })]);
  assert.notEqual(result.disposition, "suspect");
  assert.ok(codes(result).includes("attachment"));
});

test("a mixed conversation stays visible whichever message is last", () => {
  const spam = message({ sender_email: blocked, subject: "Reklamní nabídka", body_text: "Katalog výrobků." });
  const normal = message({ id: "22222222-2222-4222-8222-222222222222", body_text: "Děkuji za včerejší rozhovor." });
  for (const messages of [[spam, normal], [normal, spam]])
    assert.notEqual(classify(messages, {}, { blockedSenders: [blocked] }).disposition, "suspect");
});

test("partial context cannot justify hiding the whole conversation", () => {
  const messages = [message({ sender_email: blocked, subject: "Reklamní nabídka", body_text: "Katalog výrobků." })];
  for (const extra of [{ message_count: 30 }, { context_truncated: true }])
    assert.notEqual(classify(messages, extra, { blockedSenders: [blocked] }).disposition, "suspect");
});

test("complete, exclusively blocked and unprotected messages can be separated reversibly", () => {
  const result = classify([message({ sender_email: blocked, subject: "Reklamní nabídka", body_text: "Katalog výrobků." })], {}, { blockedSenders: [blocked] });
  assert.equal(result.disposition, "suspect");
  assert.ok(codes(result).includes("spam"));
});

test("classification does not echo private source text or sender identity into explanations", () => {
  const result = classify([message({ sender_name: "SECRET_PRIVATE_SENDER",
    body_text: "Potřebuji právní pomoc po výpovědi. SECRET_PRIVATE_SOURCE_TEXT.",
  })]);
  assert.ok(!JSON.stringify(result).includes("SECRET_PRIVATE_"));
});
