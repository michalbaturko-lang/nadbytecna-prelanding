import test from "node:test";
import assert from "node:assert/strict";

const HTML = '<meta property="og:image" content="https://nadbytecna.cz/og-v3.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="nadbytečná. Žádná žena není nadbytečná."><link rel="canonical" href="https://nadbytecna.cz/">';
const req = (url) => new Request(url, { headers: { host: new URL(url).host } });

test("veřejná doména dál přesměruje a vercel.app přepíše og adresu", async () => {
  const prev = process.env.SITE_LIVE;
  delete process.env.SITE_LIVE;
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init.headers.get("x-nb-origin"), "1");
    return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try {
    const { default: middleware } = await import("../middleware.js");
    const apex = await middleware(req("https://nadbytecna.cz/"));
    assert.equal(apex.headers.get("x-middleware-rewrite"), "https://nadbytecna.cz/coming-soon/");
    assert.equal(calls.length, 0);

    const asset = await middleware(req("https://nadbytecna.cz/og-v3.jpg"));
    assert.equal(asset.headers.get("x-middleware-next"), "1");
    assert.equal(calls.length, 0);

    const admin = await middleware(req("https://nadbytecna.cz/admin/"));
    assert.equal(admin.status, 200);
    assert.equal(admin.headers.get("cache-control"), "no-store");
    assert.equal(admin.headers.get("cdn-cache-control"), "no-store");
    assert.match(admin.headers.get("x-robots-tag"), /noindex/);
    assert.match(await admin.text(), /id="login-form"/);
    assert.equal(calls.length, 0);
    const head = await middleware(new Request("https://nadbytecna.cz/admin/", { method: "HEAD", headers: { host: "nadbytecna.cz" } }));
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("cache-control"), "no-store");
    const post = await middleware(new Request("https://nadbytecna.cz/admin/", { method: "POST", headers: { host: "nadbytecna.cz" } }));
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("cache-control"), "no-store");

    const home = await middleware(req("https://nadbytecna-prelanding.vercel.app/"));
    const text = await home.text();
    assert.match(text, /property="og:image" content="https:\/\/nadbytecna-prelanding\.vercel\.app\/og-v3\.jpg"/);
    assert.match(text, /og:image:width" content="1200"/);
    assert.match(text, /og:image:height" content="630"/);
    assert.match(text, /og:image:alt" content="nadbytečná\. Žádná žena není nadbytečná\."/);
    assert.match(text, /href="https:\/\/nadbytecna-prelanding\.vercel\.app\/"/);
    assert.deepEqual(calls, ["https://nadbytecna-prelanding.vercel.app/"]);

    const soon = await middleware(req("https://nadbytecna-prelanding.vercel.app/coming-soon/"));
    assert.match(await soon.text(), /https:\/\/nadbytecna-prelanding\.vercel\.app\/og-v3\.jpg/);
  } finally {
    globalThis.fetch = orig;
    if (prev === undefined) delete process.env.SITE_LIVE;
    else process.env.SITE_LIVE = prev;
  }
});

test("indexace: vercel.app dostane noindex hlavičku, veřejná doména ne", async () => {
  const { default: middleware } = await import("../middleware.js");
  const prev = process.env.SITE_LIVE;
  process.env.SITE_LIVE = "true";
  try {
    const pub = await middleware(req("https://nadbytecna.cz/o-nas/"));
    assert.equal(pub.headers.get("x-robots-tag"), null);
    const alias = await middleware(req("https://nadbytecna-prelanding.vercel.app/og-v3.jpg"));
    assert.match(alias.headers.get("x-robots-tag") || "", /noindex/);
  } finally {
    if (prev === undefined) delete process.env.SITE_LIVE; else process.env.SITE_LIVE = prev;
  }
});
