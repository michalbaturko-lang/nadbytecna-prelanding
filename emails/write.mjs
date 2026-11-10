// Vygeneruje soubory šablon. Nic neodesílá.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const FROM_LINE = "veryvera@nadbytecna.cz";

function fill(s, vars) {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

function letter({ hello, paragraphs }) {
  const text = [hello, "", ...paragraphs, "", "Věra", "Nadbytečná", "VERY VERA", FROM_LINE, "", "Správce osobních údajů: Věra Komárová, fyzická osoba."].join("\n");
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
  const html = `<!doctype html><html lang="cs"><body style="margin:0;background:#F4CCD8;font-family:Arial,Helvetica,sans-serif;color:#3A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4CCD8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFF8FA;border-radius:8px"><tr><td style="padding:32px 28px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.55">${hello.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>
${body}
<p style="margin:24px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:18px">Věra</p>
<p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:#5E2A41">Nadbytečná<br>VERY VERA<br><a href="mailto:${FROM_LINE}" style="color:#5E2A41">${FROM_LINE}</a><br>Správce osobních údajů: Věra Komárová, fyzická osoba.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

const also = "A ještě: chceš pomáhat a podílet se na platformě. Ozveme se ti k tomu.";
const anon = "Píšeš anonymně, jméno k příběhu nepřidáme.";
const named = "U příběhu uvedeme tvé jméno.";
const textGot = "Dostali jsme příběh, který jsi napsala.";
const voiceGot = "Dostali jsme tvou hlasovou zprávu. Zprávu si můžeme poslechnout. Automatický přepis nyní neprobíhá.";
const touch = "Ozveme se na tenhle e-mail, kdybychom potřebovali něco upřesnit.";

function share({ anonymous, voice, help }) {
  const hello = anonymous ? "Ahoj," : "Ahoj {{jmeno}},";
  const paragraphs = [voice ? voiceGot : textGot, anonymous ? anon : named, touch];
  if (help) paragraphs.push(also);
  const subject = voice ? "Dostali jsme tvou hlasovou zprávu" : "Dostali jsme tvůj příběh";
  return { subject, ...letter({ hello, paragraphs }) };
}

const types = {
  prace: "Píšeš, že pomáháš s prací.",
  terapie: "Píšeš, že nabízíš terapii.",
  pravni: "Píšeš, že nabízíš právní pomoc.",
  vyrobky: "Píšeš, že nabízíš výrobky a služby.",
  jine: "Píšeš, že pomáháš jinak, než jsou vyjmenované typy.",
};

function helpOthers(type) {
  const paragraphs = [
    "Děkujeme, že pomáháš lidem, kteří si prošli něčím podobným.",
    type ? types[type] : "Typ pomoci jsi nechala otevřený. Domluvíme se, co konkrétně nabízíš.",
    touch,
  ];
  return { subject: "Díky za nabídku pomoci", ...letter({ hello: "Ahoj {{jmeno}},", paragraphs }) };
}

const been = {
  subject: "Díky, že chceš pomoct",
  ...letter({
    hello: "Ahoj {{jmeno}},",
    paragraphs: [
      "Děkujeme, že chceš pomoct, protože sis tím prošla nebo prošel.",
      touch,
    ],
  }),
};

const jobs = [];
for (const anonymous of [true, false]) {
  for (const voice of [true, false]) {
    for (const help of [true, false]) {
      const id = ["share", anonymous ? "anonymous" : "named", voice ? "voice" : "text", help ? "also-help" : "story"].join("-");
      jobs.push({ id, dir: "share-story", file: id.replace(/^share-/, ""), ...share({ anonymous, voice, help }), anonymous });
    }
  }
}
const launchText = `Dobrý den,

děkujeme, že chcete být u otevření platformy Nadbytečná. Spouštíme ji 11. 11. 2026 a vám dáme vědět jako prvním.

Nadbytečná vzniká pro ženy, které se ocitly v nerovném postavení, a pro všechny, kdo jim chtějí pomoci. Brzy u nás budete moct sdílet svůj příběh nebo nabídnout pomoc.

Pokud zprávy dostávat nechcete, stačí odpovědět na tento e-mail a vaši adresu smažeme.

S úctou
Věra Komárová
Nadbytečná
VERY VERA
`;
const launchHtml = `<!doctype html><html lang="cs"><body style="margin:0;background:#F4CCD8;font-family:Arial,Helvetica,sans-serif;color:#3A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4CCD8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFF8FA;border-radius:8px"><tr><td style="padding:32px 28px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.55">Dobrý den,</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.55">děkujeme, že chcete být u otevření platformy Nadbytečná. Spouštíme ji 11. 11. 2026 a vám dáme vědět jako prvním.</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.55">Nadbytečná vzniká pro ženy, které se ocitly v nerovném postavení, a pro všechny, kdo jim chtějí pomoci. Brzy u nás budete moct sdílet svůj příběh nebo nabídnout pomoc.</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.55">Pokud zprávy dostávat nechcete, stačí odpovědět na tento e-mail a vaši adresu smažeme.</p>
<p style="margin:24px 0 0;font-size:16px;line-height:1.55">S úctou<br>Věra Komárová<br>Nadbytečná<br>VERY VERA</p>
</td></tr></table></td></tr></table></body></html>`;
jobs.push({ id: "launch-signup", dir: "launch", file: "signup", subject: "Děkujeme, že chcete být u toho", text: launchText, html: launchHtml, anonymous: true });
jobs.push({ id: "help-been-through", dir: "can-help", file: "been-through", ...been, anonymous: false });
jobs.push({ id: "help-others", dir: "can-help", file: "help-others", ...helpOthers(null), anonymous: false });
for (const type of Object.keys(types)) {
  jobs.push({ id: "help-others-" + type, dir: "can-help", file: "help-others-" + type, ...helpOthers(type), anonymous: false });
}

const catalog = [];
for (const job of jobs) {
  const dir = path.join(root, job.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, job.file + ".txt"), job.text);
  fs.writeFileSync(path.join(dir, job.file + ".html"), job.html);
  catalog.push({
    id: job.id,
    subject: job.subject,
    html: `${job.dir}/${job.file}.html`,
    text: `${job.dir}/${job.file}.txt`,
    anonymous: job.anonymous,
  });
}
fs.writeFileSync(path.join(root, "catalog.json"), JSON.stringify({ from: "Nadbytečná <veryvera@nadbytecna.cz>", reply_to: "veryvera@nadbytecna.cz", templates: catalog }, null, 2) + "\n");
console.log(`emails: ${catalog.length}`);
