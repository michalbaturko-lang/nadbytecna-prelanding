import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { from, replyTo, templates, resendPayload } = await import("../emails/resend.mjs");

test("šablony pro Resend jsou v repu a nic neposílají", () => {
  assert.equal(from, "Nadbytečná <veryvera@nadbytecna.cz>");
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
  assert.doesNotMatch(src, /from ["']resend["']|fetch\(/);
  for (const t of templates) {
    const text = fs.readFileSync(path.join(root, "emails", t.text), "utf8");
    const html = fs.readFileSync(path.join(root, "emails", t.html), "utf8");
    if (t.id === "launch-signup") {
      assert.equal(t.subject, "Děkujeme, že chcete být u toho");
      assert.match(text, /děkujeme, že chcete být u otevření platformy Nadbytečná\. Spouštíme ji 11\. 11\. 2026 a vám dáme vědět jako prvním\./);
      assert.match(text, /S úctou\nVěra Komárová\nNadbytečná\.cz\nVERY VERA/);
      assert.doesNotMatch(text + html, /Správce osobních údajů|\{\{jmeno\}\}|fetch\(/);
    } else {
      assert.match(text, /veryvera@nadbytecna\.cz/);
      assert.match(text, /Nadbytečná\.cz\nVERY VERA/);
      assert.match(html, /Nadbytečná\.cz<br>VERY VERA/);
      assert.match(text, /Věra Komárová/);
      if (t.anonymous) assert.doesNotMatch(text + html, /\{\{jmeno\}\}/);
      else assert.match(text, /\{\{jmeno\}\}/);
    }
  }
  const named = resendPayload("share-named-text-also-help", { to: "a@b.cz", jmeno: "Anna" });
  assert.equal(named.from, from);
  assert.deepEqual(named.to, ["a@b.cz"]);
  assert.match(named.text, /Ahoj Anna/);
  assert.match(named.text, /chceš pomáhat/);
  assert.doesNotMatch(named.text, /\{\{jmeno\}\}/);
  const voice = resendPayload("share-anonymous-voice-story", { to: "a@b.cz" });
  assert.match(voice.text, /hlasovou zprávu/);
  assert.match(voice.text, /Poslechneme si ji a v případě potřeby přepíšeme/);
  assert.doesNotMatch(voice.text + voice.html, /přepíšeme ji na text/i);
  assert.match(voice.text, /anonymně/);
  assert.doesNotMatch(voice.text, /Anna|jmeno/);
});
