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
const pages = ["index.html", "sdilet-pribeh/index.html", "mohu-pomoci/index.html", "potrebuji-pomoc/index.html", "ochrana-osobnich-udaju/index.html", "pravidla-zverejnovani/index.html", "kontakt/index.html"];
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
  const fluidSrc = fs.readFileSync(path.join(ROOT, "src/fluid.js"), "utf8");
  assert.match(fluidSrc, /pointer: coarse/);
  assert.match(fluidSrc, /prefers-reduced-motion/);
  assert.match(fluidSrc, /autoT = setTimeout\(function \(\) \{[\s\S]*?\}, 1000\)/);
  assert.equal(fluidSrc.includes("/*LETTERS*/null"), true);
});

test("homepage má dvě volby, ne mřížku osmi kategorií, a formuláře nic neodesílají", () => {
  assert.match(home, /<a class="choice" href="\/sdilet-pribeh\/"><span class="choice-title">Sdílej svůj příběh<\/span><\/a>/);
  assert.match(home, /<a class="choice" href="\/mohu-pomoci\/"><span class="choice-title">Mohu pomoci<\/span><\/a>/);
  assert.equal(visible(home).match(/class="choice"/g).length, 2);
  assert.doesNotMatch(visible(home), /<summary>|Nabídni terapii|Nabídni právní pomoc|Chci pomoci|chci-pomoci/);
  assert.match(home, /<footer[\s\S]*href="\/potrebuji-pomoc\/">Potřebuji pomoc<\/a>/);
  const choices = [...home.matchAll(/<a class="choice"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
  assert.equal(choices.length, 2);
  assert.ok(choices.every((c) => !c.includes("Potřebuji pomoc")));
  const pribeh = home.slice(home.indexOf('id="pribeh"'), home.indexOf("</section>"));
  assert.match(pribeh, /Tady bude osobní výpověď Věry Komárové\. Čekáme na její text\./);
  assert.equal(pribeh.includes("<img"), false);
  assert.doesNotMatch(visible(home), /Připravujeme|připravujeme|Spouštíme|Pracovní náhled|neběží|zatím není/);
  assert.match(home, /Žádná žena není nadbytečná\./);
  assert.match(home, /Místo pro ženy, které si prošly něčím podobným\./);
  assert.match(home, /Hlavní cíl - změnit systém - více ochrany našimi zákony pro ženy, manželky, partnerky, matky, podnikatelky\./);
  assert.match(home, /href="https:\/\/veryvera\.cz" rel="noopener noreferrer"/);
  assert.match(home, /Správce osobních údajů: Věra Komárová, fyzická osoba\. Adresa: doplníme\. IČ: doplníme\./);
  assert.doesNotMatch(visible(home), /Zapsaný ústav/);
  assert.match(read("ochrana-osobnich-udaju/index.html"), /Správce osobních údajů je Věra Komárová, fyzická osoba/);
  assert.doesNotMatch(read("ochrana-osobnich-udaju/index.html"), /Zapsaný ústav/);
  assert.doesNotMatch(read("kontakt/index.html"), /Zapsaný ústav/);
  assert.match(home, /mailto:veryvera@nadbytecna\.cz/);
  for (const p of ["index.html", "sdilet-pribeh/index.html", "mohu-pomoci/index.html", "potrebuji-pomoc/index.html"]) {
    assert.doesNotMatch(visible(read(p)), /<form\b|<\/form>|method=|action=|\brequired\b|\bchecked\b|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|\/api\//i, p);
  }
  const story = read("sdilet-pribeh/index.html");
  assert.equal(story.match(/<button type="button" class="send" disabled/g).length, 1);
  assert.match(story, />Odeslat</);
  assert.doesNotMatch(visible(story), /Připravujeme|Spouštíme|zatím není|neodesílá/);
  assert.match(story, /Chci sdílet anonymně/);
  assert.match(story, /Chci sdílet se jménem/);
  assert.match(story, /Chci i pomáhat \(být aktivní a podílet se na platformě\)/);
  assert.match(story, /Hlasové zprávy přepisujeme na text/);
  assert.match(story, /accept="audio\/\*,\.m4a/);
  assert.match(story, /<script src="\/story-form\.js" defer><\/script>/);
  const storyJs = fs.readFileSync(path.join(ROOT, "src/story-form.js"), "utf8");
  assert.match(storyJs, /MediaRecorder/);
  assert.match(storyJs, /audio\/mp4/);
  assert.match(storyJs, /50 \* 1024 \* 1024/);
  assert.match(storyJs, /story-audio/);
  assert.doesNotMatch(storyJs, /fetch\(|localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|supabase\.|innerHTML/);
  const help = read("mohu-pomoci/index.html");
  assert.match(help, /<h1>Mohu pomoci<\/h1>/);
  assert.match(help, /Už jsem si tím prošla \/ prošel/);
  assert.match(help, /Pomáhám takovým lidem/);
  assert.equal(visible(help).match(/type="radio"/g).length, 2);
  for (const typ of ["práce", "terapie", "právní pomoc", "výrobky a služby", "jiné"]) assert.match(help, new RegExp(`<span>${typ}</span>`));
  assert.match(help, /Není povinné/);
  assert.doesNotMatch(visible(home), /50 %|Dermacol|Kateřina|Maruška|Miklíková|Golden Line|Malé nám|Dlouhá 34|Lázeňská|Supabase|Resend/i);
});

test("právní stránky mluví o souhlasu a kontakt není krizová linka", () => {
  assert.match(read("ochrana-osobnich-udaju/index.html"), /Souhlas se zpracováním údajů a souhlas se zveřejněním příběhu jsou dvě různé věci/);
  assert.match(read("pravidla-zverejnovani/index.html"), /Příběh zveřejníme jen tehdy/);
  assert.match(read("kontakt/index.html"), /Není to krizová linka/);
  assert.match(read("potrebuji-pomoc/index.html"), /Není to krizová linka/);
  assert.equal(fs.existsSync(path.join(OUT, "pripravujeme/index.html")), false);
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
