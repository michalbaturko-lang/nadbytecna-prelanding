// Prohlížečová sada: dostupnost (axe), přetékání na šířkách, SEO tagy, celý průchod (přihláška → potvrzení → hlasování → odhlášení).
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(process.env.NODE_PATH + "/")("playwright");
import { startDevServer } from "./devserver.mjs";
const axeSrc = fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const S = await startDevServer({ latency: [5, 20], env: { COLLECTION_OPEN: "true" } });
const base = S.url.replace("127.0.0.1", "localhost");
const b = await chromium.launch();
const bad = [], info = [];
const PAGES = ["/", "/dekujeme/", "/potvrzeno/", "/potvrzeni/", "/odhlaseni/", "/zasady-ochrany-osobnich-udaju/"];
const WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];

for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ colorScheme: scheme, bypassCSP: true });
  const p = await ctx.newPage();
  for (const path of PAGES) {
    await p.goto(base + path, { waitUntil: "networkidle" });
    await p.addScriptTag({ content: axeSrc });
    const r = await p.evaluate(async () => await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
    for (const v of r.violations) bad.push(`axe[${scheme}] ${path}: ${v.id} (${v.impact}) ×${v.nodes.length} – ${v.help}`);
  }
  await ctx.close();
}
for (const w of WIDTHS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  const p = await ctx.newPage();
  for (const path of PAGES) {
    await p.goto(base + path, { waitUntil: "networkidle" });
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small: [...document.querySelectorAll("a,button,input,select,textarea,label[for]")].filter((e) => e.name !== "website" && !(e.type === "checkbox" && e.labels?.length && e.labels[0].getBoundingClientRect().height >= 24)).filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 24 || r.width < 24) && getComputedStyle(e).display !== "inline"; }).map((e) => e.tagName + (e.id ? "#" + e.id : "")).slice(0, 3), fs: Math.min(...[...document.querySelectorAll("p,li,label,input,button,a")].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))) }));
    if (o.sw > o.cw) bad.push(`přetékání ${path} @${w}px: scrollWidth ${o.sw} > ${o.cw}`);
    if (o.small.length && w <= 390) bad.push(`malé klikací prvky ${path} @${w}px: ${o.small.join(",")}`);
    if (w <= 390 && o.fs < 12) bad.push(`písmo ${o.fs}px < 12 ${path} @${w}px`);
  }
  await ctx.close();
}
// SEO / metadata
{
  const p = await b.newPage();
  await p.goto(base + "/", { waitUntil: "networkidle" });
  const m = await p.evaluate(() => ({ t: document.title, d: document.querySelector('meta[name=description]')?.content, c: document.querySelector('link[rel=canonical]')?.href, lang: document.documentElement.lang, og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"]')].map((e) => [e.getAttribute("property") || e.name, e.content])), h1: document.querySelectorAll("h1").length, robots: document.querySelector('meta[name=robots]')?.content, viewport: document.querySelector('meta[name=viewport]')?.content, alt: [...document.images].filter((i) => !i.hasAttribute("alt")).length, ld: [...document.querySelectorAll('script[type="application/ld+json"]')].length }));
  info.push("SEO úvodka: " + JSON.stringify(m));
  if (!m.t || m.t.length > 65) bad.push(`title: "${m.t}"`);
  if (!m.d || m.d.length < 50 || m.d.length > 170) bad.push(`description délka ${m.d?.length}`);
  if (m.lang !== "cs") bad.push("html lang není cs");
  if (m.h1 !== 1) bad.push(`počet h1: ${m.h1}`);
  if (!m.og["og:image"] || !m.og["og:title"] || !m.og["twitter:card"]) bad.push("chybí OG/Twitter tagy");
  if (m.alt) bad.push(`obrázky bez alt: ${m.alt}`);
  const og = m.og["og:image"]; if (og) { const r = await fetch(S.url + new URL(og).pathname); if (!r.ok || !/image/.test(r.headers.get("content-type"))) bad.push("og:image se nenačte lokálně"); }
}
// Klávesnice: Tab projde formulář, Enter odešle
{
  const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.goto(base + "/", { waitUntil: "networkidle" }); await p.waitForTimeout(3000);
  await p.keyboard.press("Tab"); const seen = [];
  for (let i = 0; i < 8; i++) { seen.push(await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)); await p.keyboard.press("Tab"); }
  info.push("pořadí Tab: " + seen.join(" → "));
  if (!seen.includes("email") || !seen.includes("consent")) bad.push("formulář nejde projít klávesnicí");
  const outline = await p.evaluate(() => { document.getElementById("email").focus(); const s = getComputedStyle(document.getElementById("email")); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
  if (!outline) bad.push("pole e-mailu nemá viditelný focus");
  await ctx.close();
}
// Reduced motion: efekt loga se nespustí / stránka funguje
{
  const ctx = await b.newContext({ reducedMotion: "reduce" }); const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "/", { waitUntil: "networkidle" }); await p.mouse.move(300, 200); await p.mouse.move(320, 220); await p.waitForTimeout(500);
  if (errs.length) bad.push("reduced-motion chyby: " + errs.join("; "));
  await ctx.close();
}
// Bez JavaScriptu: formulář má smysluplný fallback (neposílá citlivé do URL)
{
  const ctx = await b.newContext({ javaScriptEnabled: false }); const p = await ctx.newPage();
  await p.goto(base + "/", { waitUntil: "load" });
  const f = await p.evaluate(() => ({ method: document.getElementById("signup")?.method, action: document.getElementById("signup")?.getAttribute("action") }));
  info.push("bez JS: " + JSON.stringify(f));
  if (f.method !== "post") bad.push("formulář bez JS by posílal e-mail v URL (method != post)");
  await ctx.close();
}
// Celý průchod
{
  const ctx = await b.newContext(); const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "/", { waitUntil: "networkidle" }); await p.waitForTimeout(3000);
  await p.fill("#email", "pruchod@example.cz"); await p.check("#consent"); await p.click("#signup button[type=submit]");
  await p.waitForURL(/dekujeme/, { timeout: 8000 }).catch(() => bad.push("po odeslání nepřesměrovalo na /dekujeme/"));
  const mails = await (await fetch(S.url + "/__test/mails")).json();
  if (mails.length !== 1) bad.push(`odeslaných e-mailů: ${mails.length}`);
  else {
    const m = mails[0];
    if (!/obchodní sdělení|informac/i.test(m.text)) info.push("pozn.: text potvrzovacího e-mailu neobsahuje 'obchodní sdělení' (transakční e-mail, jen ověřit právně)");
    const link = m.text.match(/https?:\/\/\S+potvrzeni\/\?t=\S+/)[0];
    const u = new URL(link); const local = base + u.pathname + u.search;
    await p.goto(local, { waitUntil: "networkidle" });
    await p.click("button, input[type=submit]").catch(() => bad.push("na /potvrzeni/ není tlačítko"));
    await p.waitForURL(/potvrzeno/, { timeout: 8000 }).catch(() => bad.push("po potvrzení nepřesměrovalo na /potvrzeno/"));
    await p.waitForTimeout(500);
    const picks = await p.$$("#picks .pick");
    for (const bx of picks.slice(0, 4)) await bx.click().catch(() => {});
    const pressed = await p.evaluate(() => document.querySelectorAll('#picks .pick[aria-pressed="true"]').length);
    if (pressed > 3) bad.push(`lze vybrat ${pressed} výroků, limit je 3`);
    info.push(`hlasování: nabídnuto ${picks.length}, po 4 klicích vybráno ${pressed} (max 3)`);
    await p.click("#vote button[type=submit], #vote-send, #vote .btn").catch(() => info.push("tlačítko odeslání výběru nenalezeno"));
    await p.waitForTimeout(800);
    const st = await (await fetch(S.url + "/__test/state")).json();
    const r0 = st.rows[0];
    if (!r0 || r0.status !== "confirmed") bad.push("řádek není confirmed");
    info.push("claims v DB: " + JSON.stringify(r0?.claims));
    if (r0?.claims && r0.claims.length > 3) bad.push("v DB víc než 3 výroky");
    // odhlášení
    const unsub = m.headers["List-Unsubscribe"].slice(1, -1); const uu = new URL(unsub);
    await p.goto(base + uu.pathname.replace("/api/unsubscribe", "/odhlaseni") + uu.search, { waitUntil: "networkidle" }).catch(() => {});
    info.push("stránka odhlášení: " + (await p.title()));
  }
  if (errs.length) bad.push("JS chyby při průchodu: " + errs.join("; "));
  await ctx.close();
}
console.log(info.join("\n"));
console.log(bad.length ? "\nNÁLEZY (" + bad.length + "):\n - " + [...new Set(bad)].join("\n - ") : "\nBrowser suite OK");
await b.close(); await S.close(); process.exit(bad.length ? 1 : 0);
