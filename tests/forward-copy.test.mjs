import test from "node:test";
import assert from "node:assert/strict";
import { buildCopy } from "../lib/forward-copy.mjs";

test("kopie příběhu obsahuje kontakt a celý text", () => {
  const m = buildCopy("stories", { full_name: "Jana <X>", email: "j@x.cz", anonymous: false, wants_to_help: true, consent_publish: true, input_type: "text", story_text: "Text & příběh", created_at: "2026-11-20T23:46:00Z" }, "");
  assert.match(m.subject, /nový příběh: Jana <X>/);
  assert.match(m.text, /E-mail: j@x\.cz/);
  assert.match(m.text, /Text & příběh/);
  assert.match(m.html, /Jana &lt;X&gt;/);
});
test("anonymní autorka je v předmětu anonymně, kontakt zůstává v těle", () => {
  const m = buildCopy("stories", { full_name: "Eva", email: "e@x.cz", anonymous: true, input_type: "text", story_text: "a", created_at: "2026-11-20T10:00:00Z" }, "");
  assert.match(m.subject, /anonymně/);
  assert.doesNotMatch(m.subject, /Eva/);
  assert.match(m.text, /E-mail: e@x\.cz/);
});
test("nabídka má telefon a odkaz na nahrávku se přidá jen u audia", () => {
  const o = buildCopy("help_offers", { full_name: "K", email: "k@x.cz", phone: "603", helper_type: "professional", help_kinds: ["pridej"], links: { web: "x.cz", instagram: "" }, message: "m", created_at: "2026-11-21T06:40:00Z" }, "");
  assert.match(o.text, /Telefon: 603/);
  assert.match(o.text, /web: x\.cz/);
  const a = buildCopy("stories", { full_name: "A", email: "a@x.cz", input_type: "recording", created_at: "2026-11-20T10:00:00Z" }, "https://s/sign?t=1");
  assert.match(a.text, /odkaz platí 7 dní\): https:\/\/s\/sign/);
});
