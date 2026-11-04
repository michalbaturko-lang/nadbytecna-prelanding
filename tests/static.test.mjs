// Statická kontrola sestaveného webu (dist/) a repozitáře: žádné inline skripty a události, žádné cizí zdroje,
// žádná tajemství, bezpečné odkazy a formuláře.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
execFileSync("node", ["build.mjs"], { cwd: ROOT, stdio: "ignore" });
const DIST = path.join(ROOT, "dist");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(DIST);
const htmls = files.filter((f) => f.endsWith(".html"));
const text = (f) => fs.readFileSync(f, "utf8");

test("HTML: žádný inline skript, žádné onXXX události, žádné javascript: ani data: odkazy, žádné style=\"\"", () => {
  for (const f of htmls) {
    const h = text(f);
    for (const m of h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1];
      if (/type="application\/ld\+json"/.test(attrs)) { JSON.parse(m[2]); continue; }
      assert.ok(/\bsrc="\/[^"]+"/.test(attrs) && !m[2].trim(), `${f}: inline skript`);
    }
    assert.ok(!/\son[a-z]+\s*=/i.test(h.replace(/<script[\s\S]*?<\/script>/gi, "")), `${f}: inline událost`);
    assert.ok(!/(href|src|action)\s*=\s*["']\s*(javascript|data|vbscript):/i.test(h), `${f}: nebezpečné URL`);
    assert.ok(!/\sstyle\s*=/i.test(h), `${f}: style atribut`);
    assert.ok(!/<(iframe|object|embed|base|meta[^>]+http-equiv=["']?refresh)/i.test(h), `${f}: iframe/object/base/refresh`);
  }
});

test("žádné cizí zdroje: HTML, CSS ani JS nenačítá nic ze třetích stran", () => {
  const allowed = [/^https?:\/\/nadbytecna\.cz/, /^https?:\/\/nadbytecna-prelanding\.vercel\.app/, /^https:\/\/schema\.org/, /^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)/, /^https:\/\/www\.instagram\.com\/?/, /^http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9/];
  for (const f of files.filter((x) => /\.(html|js|css|svg|webmanifest|xml|txt)$/.test(x))) {
    for (const m of text(f).matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
      assert.ok(allowed.some((r) => r.test(m[0])), `${path.relative(DIST, f)}: ${m[0]}`);
    }
  }
});

test("odkazy ven mají rel=noopener noreferrer; formulář odesílá jen na stejný původ a nemá citlivé pole", () => {
  for (const f of htmls) {
    const h = text(f);
    for (const m of h.matchAll(/<a\b[^>]*href="https?:\/\/[^"]+"[^>]*>/gi)) {
      if (/nadbytecna/.test(m[0])) continue;
      assert.match(m[0], /rel="[^"]*noopener[^"]*"/, `${f}: ${m[0]}`);
    }
    for (const m of h.matchAll(/<form\b[^>]*>/gi)) {
      assert.ok(!/action="https?:/.test(m[0]), `${f}: form action ven`);
    }
  }
  const home = text(path.join(DIST, "index.html"));
  assert.ok(!/type="password"/.test(home));
  assert.match(home, /autocomplete="email"/);
});

test("zdrojové kódy: žádné eval / new Function / innerHTML / document.write v kódu prohlížeče", () => {
  for (const f of ["src/app.js", "src/fluid.js"]) {
    const t = text(path.join(ROOT, f));
    assert.ok(!/\beval\s*\(|new Function\s*\(|\.innerHTML\s*=|insertAdjacentHTML|document\.write|\.outerHTML\s*=|setTimeout\s*\(\s*["'`]/.test(t), f);
  }
});

test("žádná tajemství v sestaveném webu ani ve verzovaných souborech", () => {
  const pat = /(SUPABASE_SERVICE_ROLE_KEY\s*=|service_role|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sk_live_|re_[A-Za-z0-9]{20,}|TOKEN_SECRET\s*=|IP_HASH_SALT\s*=|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/;
  for (const f of files) {
    if (/\.(png|jpg|woff2|ico)$/.test(f)) continue;
    assert.ok(!pat.test(text(f)), `dist: ${path.relative(DIST, f)}`);
  }
  let tracked = [];
  try { tracked = execFileSync("git", ["ls-files"], { cwd: ROOT }).toString().split("\n").filter(Boolean); } catch { tracked = walk(ROOT).map((x) => path.relative(ROOT, x)).filter((x) => !/^(node_modules|dist)\//.test(x)); }
  assert.ok(!tracked.some((f) => /(^|\/)\.env(\.|$)|\.pem$|\.key$|id_rsa/.test(f)), "verzovaný soubor s tajemstvím");
  for (const f of tracked.filter((x) => /\.(js|mjs|json|md|sql|html|css)$/.test(x) && !/^(tests\/|package-lock|dist\/|node_modules)/.test(x))) {
    const t = text(path.join(ROOT, f));
    assert.ok(!/(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sk_live_|re_[A-Za-z0-9]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,})/.test(t), f);
  }
  assert.ok(!files.some((f) => /\.map$/.test(f)), "source mapy v dist");
});

test("API soubory: nikde se neskládá SQL ani dotaz z neošetřeného vstupu", () => {
  const db = text(path.join(ROOT, "lib/db.js"));
  for (const m of db.matchAll(/\$\{([^}]+)\}/g)) {
    const e = m[1].trim();
    assert.ok(/^(T|url|pathAndQuery|enc\(.+\)|pathAndQuery\.split\("\?"\)\[0\]|method|key|res\.status)$/.test(e), `db.js: neošetřená interpolace ${e}`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, "api"))) assert.ok(!/\bquery\s*\(|\.rpc\(|exec\(|child_process|require\(/.test(text(path.join(ROOT, "api", f))), f);
});

test("noindex na všech stránkách s tokenem a v ukázkovém režimu", () => {
  for (const p of ["potvrzeni", "odhlaseni", "dekujeme", "potvrzeno"]) assert.match(text(path.join(DIST, p, "index.html")), /<meta name="robots" content="noindex/i, p);
  const v = JSON.parse(text(path.join(ROOT, "vercel.json")));
  const x = v.headers.filter((h) => /potvrzeni|odhlaseni|dekujeme|potvrzeno|api/.test(h.source)).flatMap((h) => h.headers.map((y) => y.key));
  assert.ok(x.includes("X-Robots-Tag"));
});
