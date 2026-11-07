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
const pages = ["index.html", "sdilet-pribeh/index.html", "mohu-pomoci/index.html", "potrebuji-pomoc/index.html", "verin-pribeh/index.html", "o-nas/index.html", "cookies/index.html", "ochrana-osobnich-udaju/index.html", "pravidla-zverejnovani/index.html", "kontakt/index.html"];
const home = read("index.html");
const visible = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");

test("noindex v HTML, robots.txt zakazuje vše, stránky nemají kanonický odkaz na produkci", () => {
  for (const p of pages) {
    assert.match(read(p), /<meta name="robots" content="noindex, nofollow, noarchive">/, p);
    assert.match(read(p), /<html lang="cs">/, p);
  }
  assert.equal(read("robots.txt"), "User-agent: *\nDisallow: /\n");
  assert.match(home, /rel="canonical" href="https:\/\/nadbytecna\.cz\/"/);
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

test("homepage má dvě volby, osm karet a formuláře nic neodesílají", () => {
  assert.match(home, /<a class="choice" href="\/sdilet-pribeh\/"><span class="choice-title">Sdílej svůj příběh<\/span><\/a>/);
  assert.match(home, /<a class="choice" href="\/mohu-pomoci\/"><span class="choice-title">Mohu pomoci<\/span><\/a>/);
  assert.equal(visible(home).match(/class="choice"/g).length, 2);
  assert.doesNotMatch(home, /class="cat"|Jak se přidat|Prověřené kontakty|proverene-kontakty/);
  assert.match(home, /class="top-cta" href="\/potrebuji-pomoc\/"/);
  assert.match(home, /Okamžitá pomoc/);
  assert.match(home, /href="tel:155"/);
  assert.match(home, /href="tel:158"/);
  assert.doesNotMatch(visible(home), /Hlavní cíl -|Cíl, jak ho napsala Věra/);
  assert.match(home, /<footer[\s\S]*href="\/ochrana-osobnich-udaju\/">Ochrana osobních údajů<\/a>/);
  assert.match(home, /href="\/cookies\/"/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/nadbytecna\.cz\/verin-pribeh\/<\/loc>/);
  assert.doesNotMatch(read("sitemap.xml"), /\/admin\/|\/coming-soon\/|proverene-kontakty/);
  assert.equal(fs.existsSync(path.join(OUT, "proverene-kontakty/index.html")), false);
  assert.match(read("robots.txt"), /Disallow: \//);
  const choices = [...home.matchAll(/<a class="choice"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
  assert.equal(choices.length, 2);
  assert.ok(choices.every((c) => !c.includes("Potřebuji pomoc")));
  const pribeh = home.slice(home.indexOf('id="pribeh"'), home.indexOf("</section>"));
  assert.match(pribeh, /Tady bude osobní výpověď Věry Komárové\. Čekáme na její text\./);
  assert.equal(pribeh.includes("<img"), false);
  assert.doesNotMatch(visible(home), /Spouštíme|Pracovní náhled|neběží|zatím není/);
  assert.match(home, /Žádná žena není nadbytečná\./);
  assert.match(home, /Místo pro ženy, které si prošly něčím podobným, a pro ty, kdo jim chtějí pomoci\./);
  assert.match(home, /Více ochrany našimi zákony pro ženy, manželky, partnerky, matky a podnikatelky\./);
  assert.match(home, /Podpořte platformu Nadbytečná\.cz předobjednáním parfému!/);
  assert.match(home, /Dodání do Vánoc!/);
  assert.match(home, /Předobjednat parfém/);
  assert.match(home, /loading="lazy"/);
  assert.match(home, /src="\/img\/parfem-nadbytecna\.jpg"/);
  assert.doesNotMatch(home, /E-shop Věry Komárové/);
  assert.match(home, /class="vera-cta" href="https:\/\/veryvera\.cz" rel="noopener noreferrer"/);
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
  assert.match(story, /<button type="button" class="send" id="sdilet-send">Odeslat<\/button>/);
  assert.match(story, /src="\/config.js"/);
  assert.match(story, /src="\/submit.js"/);
  const submitJs = fs.readFileSync(path.join(ROOT, "src/submit.js"), "utf8");
  assert.match(submitJs, /return=minimal/);
  assert.match(submitJs, /\/api\/transcribe\//);
  assert.match(submitJs, /\/api\/notify\//);
  assert.match(submitJs, /audio\/webm/);
  assert.doesNotMatch(submitJs, /return=representation/);
  assert.doesNotMatch(submitJs, /\.select\s*\(/);
  assert.doesNotMatch(visible(story), /Připravujeme|Spouštíme|zatím není|neodesílá/);
  assert.match(story, /Chci sdílet anonymně/);
  assert.match(story, /Chci sdílet se jménem/);
  assert.match(story, /Už jsem si tím prošla a chci i pomáhat/);
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
  assert.match(help, /Nabídni svůj potenciál \(hledám práci\)/);
  assert.match(help, /Nabídni pomoc – přidej se k nám/);
  assert.equal(visible(help).match(/type="radio"/g).length, 6);
  assert.doesNotMatch(help, /Už jsem si tím prošla/);
  assert.doesNotMatch(read("potrebuji-pomoc/index.html"), /Instagram|Facebook|e-shop|Odkaz na web/);
  assert.doesNotMatch(visible(home), /50 %|Dermacol|Kateřina|Maruška|Miklíková|Golden Line|Malé nám|Dlouhá 34|Lázeňská|Supabase|Resend/i);
  const soon = read("coming-soon/index.html");
  assert.match(soon, /<img class="logo"[^>]*data-split="0\.5385"/);
  assert.match(soon, /src="\/fluid\.js"/);
  assert.match(soon, /Spouštíme 11\. 11\. 2026/);
  assert.match(soon, /Zanechte nám e-mail a o spuštění se dozvíte jako první\./);
  assert.match(soon, /placeholder="Váš e-mail"/);
  assert.match(soon, /Chci být u toho/);
  assert.match(soon, /Děkujeme\. 11\. 11\. se vám ozveme jako prvním\./);
  assert.match(soon, /Souhlasím se zasláním zprávy o spuštění platformy/);
  assert.match(soon, /alt="VERY VERA – Nadbytečná\.cz"/);
  assert.match(soon, /id="brzy-gdpr" type="checkbox"/);
  assert.doesNotMatch(soon, /id="brzy-gdpr"[^>]*checked/);
  assert.match(soon, /href="\/zasady\/"/);
  assert.doesNotMatch(soon, /Správce osobních údajů|Věra Komárová|Nech e-mail/);
  assert.match(read("zasady/index.html"), /<h1>Ochrana osobních údajů<\/h1>/);
  assert.match(soon, /mailto:veryvera@nadbytecna\.cz/);
  assert.match(soon, /noindex, nofollow, noarchive/);
  assert.match(soon, /src="\/cookies\.js"/);
  assert.match(soon, /<title>Nadbytečná\.cz — spouštíme 11\. 11\. 2026<\/title>/);
  const soonDesc = soon.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.equal(soonDesc, "11. 11. 2026 spouštíme Nadbytečná.cz. Zanechte e-mail a o spuštění se dozvíte jako první.");
  assert.equal(soonDesc.length, 89);
  assert.match(soon, /property="og:image" content="https:\/\/nadbytecna\.cz\/og-v2\.jpg"/);
  assert.match(soon, /og:image:width" content="1200"/);
  assert.match(soon, /og:image:height" content="630"/);
  assert.match(soon, /og:image:alt" content="Nadbytečná\.cz\. Žádná žena není nadbytečná\."/);
  assert.match(soon, /twitter:image" content="https:\/\/nadbytecna\.cz\/og-v2\.jpg"/);
  assert.doesNotMatch(soon, /submit\.js|story-form\.js/);
  const launchJs = fs.readFileSync(path.join(ROOT, "src/launch-form.js"), "utf8");
  assert.match(launchJs, /return=minimal/);
  assert.match(launchJs, /launch_signups/);
  assert.doesNotMatch(launchJs, /\.select\s*\(|innerHTML|\/api\/notify|\/api\/transcribe/);
});

test("právní stránky mluví o souhlasu a kontakt není krizová linka", () => {
  assert.match(read("pravidla-zverejnovani/index.html"), /Souhlas se zpracováním údajů a souhlas se zveřejněním příběhu jsou dvě různé věci/);
  assert.match(read("pravidla-zverejnovani/index.html"), /Příběh zveřejníme jen tehdy/);
  assert.match(read("o-nas/index.html"), /Není to krizová linka/);
  assert.match(read("kontakt/index.html"), /Není to krizová linka/);
  assert.match(read("cookies/index.html"), /jen po souhlasu/);
  assert.match(read("verin-pribeh/index.html"), /Čekáme na její text/);
  const policy = read("ochrana-osobnich-udaju/index.html");
  assert.match(policy, /<p class="draft">Návrh<\/p>/);
  assert.match(policy, /\[DOPLNIT\]/);
  assert.match(policy, /\[ROZHODNOUT\]/);
  assert.match(policy, /\[OVĚŘIT formulaci\]/);
  assert.match(policy, /\[OVĚŘIT předání mimo EU\]/);
  assert.match(policy, /zvláštní kategorie/);
  assert.match(policy, /Vercel Inc\./);
  assert.match(policy, /Supabase \(EU, Frankfurt\)/);
  assert.match(policy, /OpenAI \(přepis hlasu, USA/);
  assert.match(policy, /Resend \(e-maily\)/);
  assert.match(policy, /30 dní po přepisu/);
  assert.match(policy, /12 měsíců/);
  assert.match(policy, /24 měsíců/);
  assert.match(policy, /od 18 let/);
  assert.match(policy, /Web po souhlasu používá analytické a marketingové cookies \(GA4, Google Ads, Meta Pixel, TikTok Pixel\), bez souhlasu ne\./);
  assert.doesNotMatch(policy + read("pravidla-zverejnovani/index.html") + read("sdilet-pribeh/index.html"), /Dermacol/);
  assert.match(home, /src="\/cookies.js"/);
  const homeDesc = home.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.equal(homeDesc, "Žádná žena není nadbytečná. Místo pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci. Sdílejte příběh, nebo nabídněte pomoc.");
  assert.equal(homeDesc.length, 135);
  assert.match(home, /property="og:image" content="https:\/\/nadbytecna\.cz\/og-v2\.jpg"/);
  assert.match(home, /og:image:width" content="1200"/);
  assert.match(home, /og:image:height" content="630"/);
  assert.match(home, /og:image:alt" content="Nadbytečná\.cz\. Žádná žena není nadbytečná\."/);
  assert.match(home, /twitter:image" content="https:\/\/nadbytecna\.cz\/og-v2\.jpg"/);
  assert.match(home, /href="\/ochrana-osobnich-udaju\/"/);
  assert.doesNotMatch(home, /googletagmanager|connect\.facebook|analytics\.tiktok/);
  const admin = read("admin/index.html");
  assert.match(admin, /noindex, nofollow, noarchive/);
  assert.match(admin, /src="\/admin.js"/);
  assert.doesNotMatch(admin, /cookies\.js/);
  const story = read("sdilet-pribeh/index.html");
  assert.match(story, /id="sdilet-consent-transcript" hidden/);
  assert.match(story, /id="sdilet-zverejneni"/);
  assert.match(story, /Chci svůj příběh zveřejnit/);
  assert.doesNotMatch(story, /Souhlasím se zveřejněním příběhu|Není povinné\./);
  assert.doesNotMatch(story, /id="sdilet-gdpr"[^>]*checked/);
  const helpPage = read("mohu-pomoci/index.html");
  assert.match(helpPage, /Chci svou nabídku zveřejnit/);
  assert.match(helpPage, /Souhlasím se zpracováním nabídky pomoci/);
  assert.match(helpPage, /id="pomoc-consent-publish" hidden/);
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
