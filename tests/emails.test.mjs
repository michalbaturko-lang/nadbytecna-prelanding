import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { from, replyTo, templates, resendPayload } = await import("../emails/resend.mjs");

test("šablony pro Resend jsou v repu a nic neposílají", async () => {
  assert.equal(from, "nadbytečná <veryvera@nadbytecna.cz>");
  assert.equal(replyTo, "veryvera@nadbytecna.cz");
  assert.equal(templates.length, 16);
  const ids = templates.map((t) => t.id);
  for (const id of [
    "share-anonymous-text-story", "share-anonymous-text-also-help",
    "share-anonymous-voice-story", "share-anonymous-voice-also-help",
    "share-named-text-story", "share-named-text-also-help",
    "share-named-voice-story", "share-named-voice-also-help",
    "help-been-through", "help-others", "launch-signup",
    "help-others-prace", "help-others-terapie", "help-others-pravni", "help-others-vyrobky", "help-others-jine",
  ]) assert.ok(ids.includes(id), id);
  const src = fs.readFileSync(path.join(root, "emails/resend.mjs"), "utf8");
  assert.doesNotMatch(src, /from ["']resend["']|fetch\(|readFileSync|node:fs/);
  const bundled = fs.readFileSync(path.join(root, "emails/templates.mjs"), "utf8");
  assert.match(bundled, /share-story\/named-text-story\.html/);
  assert.match(bundled, /Dostali jsme příběh, který jsi napsala/);
  assert.match(src, /from "\.\/templates\.mjs"/);
  for (const t of templates) {
    const text = fs.readFileSync(path.join(root, "emails", t.text), "utf8");
    const html = fs.readFileSync(path.join(root, "emails", t.html), "utf8");
    assert.match(html, /#DB0B5F/);
    assert.match(html, /https:\/\/nadbytecna\.cz\/img\/very-vera-wordmark\.png/);
    assert.match(html, /alt="VERY VERA"/);
    assert.doesNotMatch(html, /#3A0B22|#5E2A41|Georgia/);
    assert.match(text, /nadbytečná/);
    assert.doesNotMatch(text, /Nadbytečná/);
    if (t.id === "launch-signup") {
      assert.equal(t.subject, "Děkujeme, že chcete být u toho");
      assert.match(text, /děkujeme, že chcete být u otevření platformy nadbytečná\. Spouštíme ji 11\. 11\. 2026 a vám dáme vědět jako prvním\./);
      assert.match(text, /S úctou\nVěra Komárová\nnadbytečná\nVERY VERA/);
      assert.doesNotMatch(text + html, /Správce osobních údajů|\{\{jmeno\}\}|fetch\(/);
    } else {
      assert.match(text, /veryvera@nadbytecna\.cz/);
      assert.match(text, /nadbytečná\nVERY VERA/);
      assert.match(html, /alt="VERY VERA"/);
      assert.match(text, /Správce osobních údajů: Very Vera s\.r\.o\., IČO 30245354, se sídlem Dlouhá 713\/34, Staré Město, 110 00 Praha 1\./);
      assert.doesNotMatch(text + html, /Nadbytečná z\. ú\.|30254442|Lázeňská/);
      if (t.anonymous) assert.doesNotMatch(text + html, /\{\{jmeno\}\}/);
      else assert.match(text, /\{\{jmeno\}\}/);
    }
  }
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "nb-mail-"));
  fs.mkdirSync(path.join(isolated, "emails"));
  fs.copyFileSync(path.join(root, "emails/resend.mjs"), path.join(isolated, "emails/resend.mjs"));
  fs.copyFileSync(path.join(root, "emails/templates.mjs"), path.join(isolated, "emails/templates.mjs"));
  const isolatedPayload = (await import(pathToFileURL(path.join(isolated, "emails/resend.mjs")).href)).resendPayload("share-named-text-story", { to: "a@b.cz", jmeno: "Anna" });
  assert.match(isolatedPayload.html, /Dostali jsme příběh, který jsi napsala/);
  assert.match(isolatedPayload.text, /Dlouhá 713\/34, Staré Město/);
  const storyMail = resendPayload("share-named-text-story", { to: "a@b.cz", jmeno: "Anna" });
  assert.match(storyMail.html, /Dostali jsme příběh, který jsi napsala/);
  assert.match(storyMail.text, /Very Vera s\.r\.o\., IČO 30245354/);
  assert.doesNotMatch(storyMail.html + storyMail.text, /\{\{jmeno\}\}|Nadbytečná z\. ú\./);
  const named = resendPayload("share-named-text-also-help", { to: "a@b.cz", jmeno: "Anna" });
  assert.equal(named.from, from);
  assert.deepEqual(named.to, ["a@b.cz"]);
  assert.match(named.text, /Ahoj Anna/);
  assert.match(named.text, /chceš pomáhat/);
  assert.doesNotMatch(named.text, /\{\{jmeno\}\}/);
  const voice = resendPayload("share-anonymous-voice-story", { to: "a@b.cz" });
  assert.match(voice.text, /hlasovou zprávu/);
  assert.match(voice.text, /Automatický přepis nyní neprobíhá/);
  assert.doesNotMatch(voice.text + voice.html, /přepíšeme ji na text/i);
  assert.match(voice.text, /anonymně/);
  assert.doesNotMatch(voice.text, /Anna|jmeno/);
});
