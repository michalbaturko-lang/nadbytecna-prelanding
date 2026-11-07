import test from "node:test";
import assert from "node:assert/strict";

const HTML = '<meta property="og:image" content="https://nadbytecna.cz/og-v2.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Nadbytečná.cz. Žádná žena není nadbytečná."><link rel="canonical" href="https://nadbytecna.cz/">';
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

    const asset = await middleware(req("https://nadbytecna.cz/og-v2.jpg"));
    assert.equal(asset.headers.get("x-middleware-next"), "1");
    assert.equal(calls.length, 0);

    const blocked = await middleware(req("https://nadbytecna.cz/admin/"));
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get("location"), "https://nadbytecna.cz/");

    const home = await middleware(req("https://nadbytecna-prelanding.vercel.app/"));
    const text = await home.text();
    assert.match(text, /property="og:image" content="https:\/\/nadbytecna-prelanding\.vercel\.app\/og-v2\.jpg"/);
    assert.match(text, /og:image:width" content="1200"/);
    assert.match(text, /og:image:height" content="630"/);
    assert.match(text, /og:image:alt" content="Nadbytečná\.cz\. Žádná žena není nadbytečná\."/);
    assert.match(text, /href="https:\/\/nadbytecna-prelanding\.vercel\.app\/"/);
    assert.deepEqual(calls, ["https://nadbytecna-prelanding.vercel.app/"]);

    const soon = await middleware(req("https://nadbytecna-prelanding.vercel.app/coming-soon/"));
    assert.match(await soon.text(), /https:\/\/nadbytecna-prelanding\.vercel\.app\/og-v2\.jpg/);
  } finally {
    globalThis.fetch = orig;
    if (prev === undefined) delete process.env.SITE_LIVE;
    else process.env.SITE_LIVE = prev;
  }
});
