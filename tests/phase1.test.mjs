// Pracovní náhled fáze 1: žádné odeslání, noindex, osm formulářů, stejný padající nápis.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { webAnalyticsHtml, webAnalyticsScript } from "../lib/web-analytics.js";

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

test("canonical a og:url míří na vlastní absolutní adresu stránky", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  const htmls = walk(OUT).filter((f) => f.endsWith(".html"));
  const seen = new Set();
  for (const file of htmls) {
    const rel = path.relative(OUT, file).split(path.sep).join("/");
    if (rel === "admin/index.html") continue;
    const route = rel === "index.html" ? "/" : `/${rel.slice(0, -"index.html".length)}`;
    const url = `https://nadbytecna.cz${route}`;
    const html = read(rel);
    assert.equal(html.match(/<link rel="canonical" href="([^"]*)">/)?.[1], url, `${rel} canonical`);
    assert.equal(html.match(/<meta property="og:url" content="([^"]*)">/)?.[1], url, `${rel} og:url`);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1, rel);
    assert.equal((html.match(/property="og:url"/g) || []).length, 1, rel);
    assert.doesNotMatch(html, /nadbytecna-prelanding\.vercel\.app/, rel);
    seen.add(route);
  }
  for (const route of ["/", "/tiskova-zprava/", "/ochrana-osobnich-udaju/", "/zasady/", "/o-nas/", "/kontakt/", "/cookies/", "/coming-soon/", "/sdilet-pribeh/", "/mohu-pomoci/", "/verin-pribeh/", "/pravidla-zverejnovani/", "/potrebuji-pomoc/"]) {
    assert.ok(seen.has(route), route);
  }
  assert.equal(read("tiskova-zprava/index.html").match(/<a href="(https:\/\/nadbytecna\.cz\/)">www\.nadbytecna\.cz<\/a>/)[1], "https://nadbytecna.cz/");
});

test("hero má psací nápis a stejné fluid.js, app.js se nenačítá", () => {
  assert.match(home, /<img class="wordmark" src="\/img\/nadbytecna-script-v2\.svg"/);
  const logo = home.match(/<img class="logo"[^>]*>/)[0];
  assert.match(logo, /src="\/img\/nadbytecna-script-v2\.svg"/);
  assert.match(logo, /data-split="0"/);
  assert.match(logo, /data-base="0\.6333"/);
  assert.match(logo, /alt="nadbytečná"/);
  // Věřin schválený příběh (blok .pribeh-text) smí zmiňovat VERY VERA; jinde na úvodu ne.
  assert.doesNotMatch(home.replace(/<div class="pribeh-text">[\s\S]*?<\/div>/, ""), /nadbytecna-lockup|VERY VERA|very-vera\.cz/);
  assert.equal(home.match(/data-split="/g).length, 1);
  assert.match(home, /<script src="\/fluid\.js" defer><\/script>/);
  assert.doesNotMatch(home, /app\.js/);
  assert.equal(fs.existsSync(path.join(OUT, "app.js")), false);
  const fluid = read("fluid.js");
  assert.doesNotMatch(fluid, /\/\*LETTERS\*\/null/);
  assert.match(fluid, /img\.logo\[data-split\]/);
  assert.match(fluid, /Zlomil mi srdce\. Ne křídla\./);
  const fluidSrc = fs.readFileSync(path.join(ROOT, "src/fluid.js"), "utf8");
  assert.match(fluidSrc, /pointer: coarse/);
  assert.match(fluidSrc, /prefers-reduced-motion/);
  assert.match(fluidSrc, /autoT = setTimeout\(function \(\) \{[\s\S]*?\}, 450\)/);
  assert.equal(fluidSrc.includes("/*LETTERS*/null"), true);
});

test("homepage má dvě volby, osm karet a formuláře nic neodesílají", () => {
  assert.match(home, /<a class="choice" href="\/sdilet-pribeh\/"><span class="choice-title">Sdílej svůj příběh<\/span><span class="choice-note">Napiš ho, nebo nahraj hlas\.<\/span><\/a>/);
  assert.match(home, /<a class="choice" href="\/mohu-pomoci\/"><span class="choice-title">Mohu pomoci<\/span><span class="choice-note">Nabídni práci, péči, nebo se přidej\.<\/span><\/a>/);
  assert.match(home, /O nás/);
  assert.equal(visible(home).match(/class="choice"/g).length, 2);
  assert.doesNotMatch(home, /class="cat"|Jak se přidat|Prověřené kontakty|proverene-kontakty/);
  assert.match(home, /class="top-cta" href="\/sdilet-pribeh\/">Chci sdílet svůj příběh</);
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
  assert.doesNotMatch(pribeh, /Čekáme na její text/);
  assert.match(pribeh, /<a class="vid" href="\/verin-pribeh\/" data-video-open /);
  assert.equal(pribeh.match(/<img /g).length, 1);
  assert.match(pribeh, /src="\/video\/vera-pribeh-poster-v16\.jpg"[^>]*alt="Věra Komárová na plese"/);
  assert.doesNotMatch(pribeh, /<video/);
  assert.match(home, /<script src="\/video\.js" defer><\/script>/);
  assert.doesNotMatch(visible(home), /Spouštíme|Pracovní náhled|neběží|zatím není/);
  assert.match(home, /Žádná žena není nadbytečná\./);
  assert.doesNotMatch(home, /class="lead"/)  // úvod bez doplňujícího textu, Příběh Věry navazuje hned
  assert.match(home, /<a class="choice choice-shop" id="cil" href="#parfem"><span class="choice-title">Předprodej parfému</);
  assert.match(home, /Podpořte platformu nadbytečná předobjednáním parfému!/);
  assert.match(home, /Dodání do Vánoc!/);
  assert.match(home, /Expedujeme v týdnu od 14\. 12\./);
  assert.match(home, /Předobjednat parfém/);
  assert.match(home, /loading="lazy"/);
  assert.match(home, /src="\/img\/parfem-nadbytecna\.jpg"/);
  assert.doesNotMatch(home, /E-shop Věry Komárové/);
  assert.match(home, /class="vera-cta" href="https:\/\/veryvera22\.cz" rel="noopener noreferrer"/);
  assert.match(home, /href="#parfem">Předprodej parfému<\/a>/);
  assert.match(home, /class="claim-lead">Nejsi</);
  assert.match(home, /class="claim-lead">Krása není</);
  assert.match(home, /class="claim-lead">Žádná žena není</);
  assert.match(home, /class="claim-lead">Žádná práce není</);
  assert.match(home, /class="claim-lead">Žádná láska není</);
  assert.match(home, /class="claim-lead">Never</);
  assert.equal(home.match(/class="claim-word" src="\/img\/nadbytecna-word-lc-v2\.svg"/g).length, 6);
  assert.match(home, /class="rule claim-rule"/);
  assert.ok(home.indexOf('id="pribeh"') < home.indexOf('class="claims"'))  // video je hned za úvodní obrazovkou, před hesly;
  assert.ok(home.indexOf('id="pribeh"') < home.indexOf('class="choices"'));
  assert.ok(home.indexOf('class="choices"') < home.indexOf('id="cil"'));
  const stripAt = home.indexOf('class="vera-strip"');
  const goalAt = home.indexOf('id="cil"');
  assert.ok(goalAt > 0 && stripAt > goalAt);
  assert.match(home, /Správce osobních údajů: Nadbytečná z\. ú\. Adresa: Lázeňská 9, Praha 1\. IČ: 30254442\./);
  assert.doesNotMatch(visible(home), /Zapsaný ústav/);
  assert.match(read("ochrana-osobnich-udaju/index.html"), /Správce osobních údajů je Nadbytečná z\. ú\./);
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
  assert.match(story, /Automatický přepis nyní neprobíhá/);
  assert.match(story, /Souhlasím s případným budoucím přepisem/);
  assert.doesNotMatch(story, /Hlasové zprávy přepisujeme na text|Přepíšeme ji na text/);
  assert.match(story, /accept="audio\/\*,\.m4a/);
  assert.match(story, /Spustit nahrávání/);
  assert.match(story, /Zastavit nahrávání/);
  assert.match(story, /Přetáhněte soubor sem nebo vyberte v počítači/);
  assert.match(story, /id="file-clear">Odebrat/);
  assert.match(story, /<script src="\/story-form\.js" defer><\/script>/);
  const storyJs = fs.readFileSync(path.join(ROOT, "src/story-form.js"), "utf8");
  assert.match(storyJs, /MediaRecorder/);
  assert.doesNotMatch(storyJs, /Hlasové zprávy přepisujeme na text|Přepíšeme ji na text/);
  assert.match(storyJs, /audio\/mp4/);
  assert.match(storyJs, /50 \* 1024 \* 1024/);
  assert.match(storyJs, /story-audio/);
  assert.doesNotMatch(storyJs, /fetch\(|localStorage|sessionStorage|indexedDB|sendBeacon|XMLHttpRequest|supabase\.|innerHTML/);
  const help = read("mohu-pomoci/index.html");
  assert.match(help, /<h1>Mohu pomoci<\/h1>/);
  assert.match(help, /Nabídni svůj potenciál \(hledám práci\)/);
  assert.match(help, /Nabídni pomoc – přidej se k nám/);
  assert.equal(visible(help).match(/type="radio"/g).length, 6);
  const helpJs = fs.readFileSync(path.join(ROOT, "src/help-form.js"), "utf8");
  assert.match(helpJs, /pomoc-osloveni/);
  assert.match(helpJs, /greeting:/);
  assert.doesNotMatch(help, /Už jsem si tím prošla/);
  assert.doesNotMatch(read("potrebuji-pomoc/index.html"), /Instagram|Facebook|e-shop|Odkaz na web/);
  assert.doesNotMatch(visible(home.replace(/<div class="pribeh-text">[\s\S]*?<\/div>/, "")), /50 %|Dermacol|Kateřina|Maruška|Miklíková|Golden Line|Malé nám|Dlouhá 34|Supabase|Resend/i);
  const soon = read("coming-soon/index.html");
  assert.match(soon, /<img class="logo"[^>]*src="\/img\/nadbytecna-script-v2\.svg"[^>]*data-split="0"/);
  assert.match(soon, /src="\/fluid\.js"/);
  assert.match(soon, /Spouštíme 11\. 11\. 2026/);
  assert.match(soon, /Zanechte nám e-mail a o spuštění se dozvíte jako první\./);
  assert.match(soon, /placeholder="Váš e-mail"/);
  assert.match(soon, /Chci být u toho/);
  assert.match(soon, /Děkujeme\. 11\. 11\. se vám ozveme jako prvním\./);
  assert.match(soon, /Souhlasím se zasláním zprávy o spuštění platformy/);
  assert.match(soon, /alt="nadbytečná"/);
  assert.doesNotMatch(soon, /VERY VERA|nadbytecna-lockup|very-vera\.cz/);
  assert.match(soon, /id="brzy-gdpr" type="checkbox"/);
  assert.doesNotMatch(soon, /id="brzy-gdpr"[^>]*checked/);
  assert.match(soon, /href="\/zasady\/"/);
  assert.doesNotMatch(soon, /Správce osobních údajů|Věra Komárová|Nech e-mail/);
  assert.match(read("zasady/index.html"), /<h1>Ochrana osobních údajů<\/h1>/);
  assert.match(soon, /mailto:veryvera@nadbytecna\.cz/);
  assert.match(soon, /noindex, nofollow, noarchive/);
  assert.match(soon, /src="\/cookies\.js"/);
  assert.match(soon, /<title>nadbytečná — spouštíme 11\. 11\. 2026<\/title>/);
  const soonDesc = soon.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.equal(soonDesc, "11. 11. 2026 spouštíme nadbytečnou. Zanechte e-mail a o spuštění se dozvíte jako první.");
  assert.equal(soonDesc.length, 87);
  assert.match(soon, /property="og:image" content="https:\/\/nadbytecna\.cz\/og-v4\.jpg"/);
  assert.match(soon, /og:image:width" content="1200"/);
  assert.match(soon, /og:image:height" content="630"/);
  assert.match(soon, /og:image:alt" content="nadbytečná\. Pro všechny ženy, které poznaly zradu\. Společně najdeme sílu znovu vzlétnout\."/);
  assert.match(soon, /twitter:image" content="https:\/\/nadbytecna\.cz\/og-v4\.jpg"/);
  assert.doesNotMatch(soon, /submit\.js|story-form\.js/);
  const launchJs = fs.readFileSync(path.join(ROOT, "src/launch-form.js"), "utf8");
  assert.match(launchJs, /return=minimal/);
  assert.match(launchJs, /launch_signups/);
  assert.doesNotMatch(launchJs, /\.select\s*\(|innerHTML|\/api\/notify|\/api\/transcribe/);
});

test("právní stránky mluví o souhlasu a kontakt není krizová linka", () => {
  assert.match(read("pravidla-zverejnovani/index.html"), /Souhlas se zpracováním údajů a souhlas se zveřejněním příběhu jsou dvě různé věci/);
  assert.match(read("pravidla-zverejnovani/index.html"), /Příběh zveřejníme jen tehdy/);
  assert.match(read("o-nas/index.html"), /<h1>O nás<\/h1>/);
  assert.match(read("o-nas/index.html"), /Není to krizová linka/);
  assert.match(read("o-nas/index.html"), /<h2>Proč jsme vznikli\?<\/h2>/);
  assert.match(read("o-nas/index.html"), /Spousta žen si prošly, prochází u nás podobným dramatem\. Ponížení, nedůstojnost, strach, zoufalství, bezmoc, frustrace nás spojuje\. Vím, jak dlouho jsem sama bála, jestli to můžu vůbec udělat\. Mám vůbec šanci\? Co se stane, když\? A pak jsem to udělala a dostala stovky zpráv o podobných příbězích\. Nejsem sama a vy nejste samy\. Pojďme si pomoct\./);
  assert.match(read("kontakt/index.html"), /Není to krizová linka/);
  assert.match(read("cookies/index.html"), /jen po souhlasu/);
  const verin = read("verin-pribeh/index.html");
  assert.doesNotMatch(verin, /Čekáme na její text/);
  assert.match(verin, /<video controls playsinline preload="none"[^>]*poster="\/video\/vera-pribeh-poster-v16\.jpg"/);
  assert.match(verin, /<source src="\/video\/vera-pribeh-v16\.mp4" type="video\/mp4">/);
  assert.equal(verin.match(/class="choice"/g).length, 2);
  const policy = read("ochrana-osobnich-udaju/index.html");
  assert.match(policy, /<p class="draft">Návrh<\/p>/);
  assert.doesNotMatch(policy, /Adresa: \[DOPLNIT\]|IČ: \[DOPLNIT\]/);
  assert.match(policy, /\[ROZHODNOUT\]/);
  assert.match(policy, /\[OVĚŘIT formulaci\]/);
  assert.match(policy, /\[OVĚŘIT předání mimo EU\]/);
  assert.match(policy, /zvláštní kategorie/);
  assert.match(policy, /Vercel Inc\./);
  assert.match(policy, /Supabase \(EU, Frankfurt\)/);
  assert.match(policy, /OpenAI \(případný budoucí přepis hlasu, nyní vypnutý/);
  assert.match(policy, /Resend \(e-maily\)/);
  assert.match(policy, /30 dní po případném přepisu/);
  assert.match(policy, /přepis a automatické mazání nyní neprobíhají/);
  assert.match(policy, /12 měsíců/);
  assert.match(policy, /24 měsíců/);
  assert.match(policy, /od 18 let/);
  assert.match(policy, /Web po souhlasu používá analytické a marketingové cookies \(GA4, Google Ads, Meta Pixel, TikTok Pixel\), bez souhlasu ne\./);
  assert.doesNotMatch(policy + read("pravidla-zverejnovani/index.html") + read("sdilet-pribeh/index.html"), /Dermacol/);
  assert.match(home, /src="\/cookies.js"/);
  const homeDesc = home.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.equal(homeDesc, "Žádná žena není nadbytečná. Místo pro ženy v nerovném postavení a pro ty, kdo jim chtějí pomoci. Sdílejte příběh, nebo nabídněte pomoc.");
  assert.equal(homeDesc.length, 135);
  assert.match(home, /property="og:image" content="https:\/\/nadbytecna\.cz\/og-v4\.jpg"/);
  assert.match(home, /og:image:width" content="1200"/);
  assert.match(home, /og:image:height" content="630"/);
  assert.match(home, /og:image:alt" content="nadbytečná\. Pro všechny ženy, které poznaly zradu\. Společně najdeme sílu znovu vzlétnout\."/);
  assert.match(home, /twitter:image" content="https:\/\/nadbytecna\.cz\/og-v4\.jpg"/);
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

test("indexace se zapne jen při ostrém buildu (index: true)", async () => {
  const { renderPhase1 } = await import("../lib/phase1-html.js");
  const args = { css: "", preload: "", heart: "", logoAttrs: "" };
  const off = renderPhase1({ ...args, draft: false });
  assert.match(off.pages["/"], /content="noindex, nofollow, noarchive"/);
  assert.equal(off.robots, "User-agent: *\nDisallow: /\n");
  const on = renderPhase1({ ...args, draft: false, index: true });
  assert.match(on.pages["/"], /name="robots" content="index, follow, max-image-preview:large"/);
  assert.doesNotMatch(on.pages["/"], /noindex/);
  assert.doesNotMatch(on.pages["/o-nas/"], /noindex/);
  assert.match(on.robots, /Allow: \/\nDisallow: \/api\//);
  assert.match(on.pages["/coming-soon/"], /noindex/);
  renderPhase1({ ...args, draft: false });
});

test("Vercel Web Analytics je na veřejných stránkách právě jednou", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  const htmls = walk(OUT).filter((f) => f.endsWith(".html"));
  assert.ok(htmls.some((f) => f.endsWith(`${path.sep}coming-soon${path.sep}index.html`)));
  for (const f of htmls) {
    const rel = path.relative(OUT, f);
    const html = fs.readFileSync(f, "utf8");
    const count = html.split(webAnalyticsHtml).length - 1;
    if (rel === path.join("admin", "index.html")) {
      assert.equal(count, 0, rel);
      assert.doesNotMatch(html, /_vercel\/insights|speed-insights/);
    } else {
      assert.equal(count, 1, rel);
      assert.doesNotMatch(html, /speed-insights/);
    }
  }
  const hash = "sha256-" + crypto.createHash("sha256").update(webAnalyticsScript).digest("base64");
  const csp = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.ok(csp.includes(`'${hash}'`), hash);
  assert.doesNotMatch(csp, /unsafe-inline/);
});

test("tisková zpráva: podstránka s logem, odkaz v hlavičce i patičce, text doslova", () => {
  const tz = read("tiskova-zprava/index.html");
  assert.match(tz, /<title>Tisková zpráva — nadbytečná<\/title>/);
  assert.match(tz, /class="press-logo"[^>]*><a[^>]*><img src="\/img\/nadbytecna-script-v2\.svg"/);
  assert.match(tz, /Věra Komárová zakládá neziskovou organizaci Nadbytečná a uvádí také stejnojmenný parfém v rámci nové značky Very Vera/);
  assert.match(tz, /Tedy vše, čím si prochází její zakladatelka\./);
  assert.match(tz, /www\.nadbytecna\.cz<\/a> byl právě spuštěn\./);
  assert.match(tz, /témata, která nás spojují/);
  assert.match(tz, /Na trh by měl vstoupit 14\. prosince letošního roku\./);
  assert.match(tz, /„Jsem šťastná, že k mému novému projektu se připojila značka Triola a parfém se bude prodávat i prostřednictvím 35 kamenných obchodů\.“/);
  assert.match(tz, /šancí pro další ženu a silou pro naši novou společnost\.“ dodává Věra Komárová/);
  assert.match(tz, /michal\.uryc@taktiq\.com/);
  for (const f of ["index.html", "o-nas/index.html", "tiskova-zprava/index.html"]) {
    const h = read(f);
    assert.match(h, /<nav class="site-nav"[\s\S]*?<a href="\/tiskova-zprava\/">Tisková zpráva<\/a>[\s\S]*?<\/nav>/, `${f}: hlavička`);
    assert.match(h, /<ul class="foot-links">[\s\S]*?<a href="\/tiskova-zprava\/">Tisková zpráva<\/a>[\s\S]*?<\/ul>/, `${f}: patička`);
  }
  assert.match(read("sitemap.xml"), /\/tiskova-zprava\//);
});

test("Věřin příběh je na úvodu vedle videa, text doslova, na mobilu pod videem", () => {
  const home = read("index.html");
  const block = home.match(/<div class="pribeh-text">([\s\S]*?)<\/div>/)[1];
  assert.equal((block.match(/<p>/g) || []).length, 5);
  assert.match(block, /^\s*<p>Pouze 11 minut stačilo mému manželovi, aby mě označil za nadbytečnou ve firmě, kterou jsme spolu 24 let budovali\./);
  assert.match(block, /Proto uvádím na trh novou vůni VERY VERA nadbytečná\. Vzdor\? Možná\./);
  assert.match(block, /označit ženu za pár minut za nadbytečnou\.<\/p>\s*$/);
  assert.doesNotMatch(block, /Vaše Věra Komárová|tvář/);
  const css = fs.readFileSync(path.join(ROOT, "src", "scroll.css"), "utf8");
  assert.match(css, /grid-template-areas:"h v" "t v"/);
  assert.match(css, /grid-template-areas:"h" "v" "t"/);
});
