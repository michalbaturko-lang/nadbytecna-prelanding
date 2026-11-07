// Pracovní náhled fáze 1: žádné odeslání, noindex, osm formulářů, stejný padající nápis.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "nadbytecna-faze1-"));
execFileSync(process.execPath, ["build.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PHASE1: "1", OUT_DIR: OUT },
  stdio: "pipe",
});

const read = (p) => fs.readFileSync(path.join(OUT, p), "utf8");
const pages = ["index.html", "ochrana-osobnich-udaju/index.html", "pravidla-zverejnovani/index.html", "kontakt/index.html"];
const home = read("index.html");
const visible = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");

test("noindex v HTML, robots.txt zakazuje vše, stránky nemají kanonický odkaz na produkci", () => {
  for (const p of pages) {
    assert.match(read(p), /<meta name="robots" content="noindex, nofollow, noarchive">/, p);
    assert.match(read(p), /<html lang="cs">/, p);
  }
  assert.equal(read("robots.txt"), "User-agent: *\nDisallow: /\n");
  assert.doesNotMatch(home, /rel="canonical"/);
  assert.doesNotMatch(home, /nadbytecna-prelanding\.vercel\.app/);
});

test("hero má stejný lockup a stejné fluid.js, app.js se nenačítá", () => {
  const logo = home.match(/<img class="logo"[^>]*>/)[0];
  assert.match(logo, /src="\/img\/nadbytecna-lockup\.svg"/);
  assert.match(logo, /data-split="0\.5385"/);
  assert.match(logo, /data-base="0\.8403"/);
  assert.match(logo, /data-na0="0\.6444"/);
  assert.match(logo, /data-na1="0\.8065"/);
  assert.match(logo, /data-hat="0\.6589"/);
  assert.match(logo, /data-haty="0\.7048"/);
  assert.match(logo, /alt="VERY VERA – Nadbytečná\.cz"/);
  assert.equal(home.match(/data-split="/g).length, 1);
  assert.match(home, /<script src="\/fluid\.js" defer><\/script>/);
  assert.doesNotMatch(home, /app\.js/);
  assert.equal(fs.existsSync(path.join(OUT, "app.js")), false);
  const fluid = read("fluid.js");
  assert.doesNotMatch(fluid, /\/\*LETTERS\*\/null/);
  assert.match(fluid, /img\.logo\[data-split\]/);
  assert.match(fluid, /s nic nezlomí!/);
  assert.equal(fs.readFileSync(path.join(ROOT, "src/fluid.js"), "utf8").includes("/*LETTERS*/null"), true);
});

test("osm kategorií, vypnutá pole, nikde formulář ani sběr", () => {
  const titles = [
    "Sdílej svůj příběh",
    "Nabídni svůj potenciál — hledám novou práci",
    "Nabídni práci — hledáme někoho do týmu",
    "Nabídni terapii — psychoterapeuti, psychologové, psychiatři, fyzioterapeuti apod.",
    "Nabídni právní pomoc — právní zástupci, vyjednavači, mediátoři",
    "Nabídni pomoc — přidej se k nám",
    "Nabídni své výrobky a služby",
    "Potřebuji pomoc",
  ];
  for (const t of titles) {
    assert.ok(home.includes(`<summary>${t}</summary>`), t);
    assert.ok(home.includes(`Formulář: ${t}`), t);
  }
  assert.equal(home.match(/<fieldset disabled/g).length, 8);
  assert.equal(home.match(/<button type="button" class="send" disabled/g).length, 8);
  assert.equal(home.match(/Spouštíme 11\. 11\./g).length, 8);
  assert.equal(home.match(/Odesílání zatím není spuštěné\./g).length, 8);
  assert.equal(home.match(/type="checkbox"/g).length, 8);
  assert.doesNotMatch(visible(home), /<form\b|<\/form>|method=|action=|\brequired\b|\bchecked\b|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|\/api\//i);
  assert.match(home, /Pracovní náhled — formuláře zatím nic neodesílají\./);
  assert.match(home, /Tady bude osobní výpověď Věry Komárové\. Čekáme na její text\./);
  assert.match(home, /Žádná žena není nadbytečná\./);
  assert.match(home, /Připravujeme místo pro ženy, které si prošly něčím podobným\./);
  assert.match(home, /Hlavní cíl - změnit systém - více ochrany našimi zákony pro ženy, manželky, partnerky, matky, podnikatelky\./);
  assert.match(home, /Právní i jinou pomoc připravujeme\./);
  assert.match(home, /href="https:\/\/veryvera\.cz" rel="noopener noreferrer"/);
  assert.match(home, /Zapsaný ústav — název, IČO, sídlo a zápis v rejstříku doplníme po založení\./);
  assert.match(home, /mailto:veryvera@nadbytecna\.cz/);
  assert.doesNotMatch(visible(home), /50 %|Dermacol|Kateřina|Maruška|Miklíková|Golden Line|Malé nám|Dlouhá 34|Lázeňská|Supabase|Resend/i);
  assert.doesNotMatch(home, /<img[^>]+pribeh|osobní fot/i);
  const story = home.slice(home.indexOf('id="pribeh"'), home.indexOf('id="zapoj-se"'));
  assert.equal(story.includes("<img"), false);
});

test("kontakty a chat jsou připravované, právní texty jsou návrhy", () => {
  assert.match(home, /Prověřené kontakty/);
  assert.match(home, /Žádný kontakt tu není a nic tu není prověřené\./);
  assert.match(home, /Chat neběží/);
  for (const p of pages.slice(1)) assert.match(read(p), /Pracovní návrh/);
  assert.match(read("ochrana-osobnich-udaju/index.html"), /Souhlas se zpracováním údajů a souhlas se zveřejněním jsou dvě různé věci/);
  assert.match(read("kontakt/index.html"), /Tohle není krizová linka/);
});

test("preview API požadavek odmítne dřív, než přečte tělo", () => {
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    const handlers = await Promise.all(["subscribe","confirm","unsubscribe","vote","form"].map((n) => import("./api/" + n + ".js").then((m) => m.default)));
    let fetches = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (...a) => { fetches++; return orig(...a); };
    const body = new Proxy({}, { get() { throw new Error("body read"); } });
    for (const handler of handlers) {
      const res = await new Promise((resolve) => {
        const r = { statusCode: 0, setHeader() {}, end(s) { resolve({ status: r.statusCode, body: s }); } };
        Promise.resolve(handler({ method: "POST", url: "/api/x?t=1", headers: { host: "x.vercel.app", origin: "https://x.vercel.app", "content-type": "application/json" }, body }, r)).catch((e) => resolve({ crash: String(e) }));
      });
      if (res.crash) throw new Error(res.crash);
      if (res.status !== 503) throw new Error("status " + res.status + " " + res.body);
    }
    if (fetches) throw new Error("fetch " + fetches);
  `], { cwd: ROOT, env: { ...process.env, PHASE1: "1", VERCEL_ENV: "preview" }, stdio: "pipe" });
});
