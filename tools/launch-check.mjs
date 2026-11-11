// Kontrola po spuštění: node tools/launch-check.mjs https://nadbytecna.cz
// Ověří stránky, indexaci, sitemapu, OG, měření, texty bez zástupných značek a responzivitu. Nic neodesílá.
import { chromium } from "playwright";

const base = (process.argv[2] || "https://nadbytecna.cz").replace(/\/$/, "");
const apex = /^https:\/\/(www\.)?nadbytecna\.cz$/.test(base);
const pages = ["/", "/o-nas/", "/tiskova-zprava/", "/napsali-o-nas/", "/verin-pribeh/", "/sdilet-pribeh/", "/mohu-pomoci/", "/cookies/", "/ochrana-osobnich-udaju/", "/pravidla-zverejnovani/"];
const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440];
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const get = async (p, opts) => fetch(base + p, { redirect: "manual", ...opts });

for (const p of pages) {
  const r = await get(p);
  const html = r.status === 200 ? await r.text() : "";
  ok(`${p} vrací 200`, r.status === 200, `status ${r.status}`);
  if (r.status !== 200) continue;
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || "";
  const xr = r.headers.get("x-robots-tag") || "";
  if (apex) ok(`${p} je indexovatelná`, /index/.test(robots) && !/noindex/.test(robots + xr), `meta="${robots}" header="${xr}"`);
  else ok(`${p} není indexovatelná (náhled)`, /noindex/.test(robots + xr));
  ok(`${p} bez zástupných značek`, !/\[(DOPLNIT|ROZHODNOUT|OVĚŘIT)/.test(html) && !/class="draft"/.test(html), (html.match(/\[(DOPLNIT|ROZHODNOUT|OVĚŘIT)[^\]]*\]/g) || []).slice(0, 3).join(" "));
  ok(`${p} bez starého správce`, !/30254442|Lázeňská/.test(html));
  ok(`${p} má logo v2 a měření`, /nadbytecna-script-v2\.svg/.test(html) && /_vercel\/insights\/script\.js/.test(html));
  ok(`${p} název s malým n, bez „.cz“ v logu`, !/alt="Nadbytečná/.test(html));
}

const home = await (await get("/")).text();
ok("úvod: patička se správcem a IČ", /Very Vera s\.r\.o\. Adresa: Dlouhá 713\/34, 110 00 Praha 1\. IČO: 30245354\./.test(home));
ok("úvod: OG obrázek og-v4 a alt", /og-v4\.jpg/.test(home) && /Pro všechny ženy, které poznaly zradu/.test(home));
ok("úvod: pořadí hesel (2. Žádná žena není)", /Nejsi[\s\S]*?Žádná žena není[\s\S]*?Krása není/.test(home));
ok("úvod: příběh Věry vedle videa", /class="pribeh-text"/.test(home));
ok("úvod: odkaz Tisková zpráva v hlavičce i patičce", (home.match(/href="\/tiskova-zprava\/"/g) || []).length >= 2);
ok("úvod: žádný odkaz na vypnuté Potřebuji pomoc", !/href="\/potrebuji-pomoc\/"/.test(home));

const robotsTxt = await (await get("/robots.txt")).text();
ok("robots.txt", apex ? /Allow: \//.test(robotsTxt) && !/Disallow: \/\s*$/m.test(robotsTxt) : /Disallow: \//.test(robotsTxt), robotsTxt.replace(/\n/g, " | ").slice(0, 120));
const sm = await (await get("/sitemap.xml")).text();
ok("sitemap.xml má správnou doménu a bez /potrebuji-pomoc/", sm.includes(apex ? "https://nadbytecna.cz/" : base) && !sm.includes("potrebuji-pomoc"), (sm.match(/<loc>[^<]*/g) || []).slice(0, 2).join(" "));
const ins = await get("/_vercel/insights/script.js");
ok("měření návštěvnosti (insights script)", ins.status === 200, `status ${ins.status}`);
const og = await get("/og-v4.jpg");
ok("OG obrázek", og.status === 200 && /image\/jpeg/.test(og.headers.get("content-type") || ""));
const api = await get("/api/health");
ok("/api je dostupné na ostré doméně (jen když je SITE_LIVE)", apex ? api.status !== 404 : true, `status ${api.status}`);
const www = await get("/", { headers: {} });
ok("start", true, `HTTP ${www.status}`);

const br = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const w of widths) {
  const ctx = await br.newContext({ viewport: { width: w, height: 800 } });
  const pg = await ctx.newPage();
  for (const p of ["/", "/tiskova-zprava/", "/sdilet-pribeh/"]) {
    const errs = [];
    pg.removeAllListeners("pageerror"); pg.removeAllListeners("console");
    pg.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
    pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 100)); });
    await pg.goto(base + p, { waitUntil: "networkidle" });
    await pg.waitForTimeout(400);
    const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, cta: Math.round(document.querySelector(".top-cta")?.getBoundingClientRect().height || 0) }));
    ok(`${w}px ${p}: bez přetečení, hlavička v jednom řádku, bez chyb`, m.sw <= m.iw && m.cta <= 50 && errs.length === 0, `scrollW ${m.sw}/${m.iw}, CTA ${m.cta}px${errs.length ? ", " + errs.join(" | ") : ""}`);
  }
  await ctx.close();
}
await br.close();
const bad = results.filter((r) => !r.pass);
console.log(`\nHotovo: ${results.length - bad.length}/${results.length} v pořádku, ${bad.length} chyb.`);
if (bad.length) { console.log("CHYBY:"); for (const b of bad) console.log(" - " + b.name + (b.detail ? " — " + b.detail : "")); }
process.exit(bad.length ? 1 : 0);
