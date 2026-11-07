// Testy přes skutečný HTTP server (surový protokol): zkomolená těla, chunked, obří hlavičky, pomalé čtení,
// přesměrování, bezpečnostní hlavičky na API i na stránkách.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startDevServer } from "../tools/devserver.mjs";

let S;
before(async () => { S = await startDevServer({ env: { RATE_PER_IP_HOUR: "100000" } }); });
after(async () => { await S.close(); });

const raw = (payload, { wait = 300 } = {}) => new Promise((resolve) => {
  const u = new URL(S.url); const c = net.connect(Number(u.port), u.hostname); let data = "";
  c.on("data", (d) => (data += d)); c.on("error", () => resolve(data)); c.on("close", () => resolve(data));
  c.write(payload); setTimeout(() => { c.destroy(); resolve(data); }, wait);
});
const status = (r) => Number((r.match(/^HTTP\/1\.1 (\d+)/) || [])[1] || 0);

test("surový HTTP: smuggling a rozbité požadavky nevyvolají pád serveru ani úspěšný zápis", async () => {
  const before = S.db.rows.length;
  const body = '{"email":"smug@example.cz"}';
  const cases = [
    `POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
    `POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nContent-Length: -1\r\n\r\n${body}`,
    `POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nContent-Length: 99999999\r\n\r\n${body}`,
    `POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\n${body}`,
    `POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nContent-Length: 4\r\n\r\n\u0000\u0000\u0000\u0000`,
    `GET /api/subscribe/%00 HTTP/1.1\r\nHost: x\r\n\r\n`,
    `GET /../../../../etc/passwd HTTP/1.1\r\nHost: x\r\n\r\n`,
    `GET /%2e%2e/%2e%2e/etc/passwd HTTP/1.1\r\nHost: x\r\n\r\n`,
    `GET /api/subscribe/ HTTP/1.1\r\nHost: x\r\nX: ${"a".repeat(70000)}\r\n\r\n`,
  ];
  for (const c of cases) { const r = await raw(c); assert.ok(!/^HTTP\/1\.1 200/.test(r) || !r.includes("smug"), c.slice(0, 60)); }
  assert.equal(S.db.rows.length, before);
  assert.equal(S.stats.crashed, 0, "handler spadl");
  const alive = await fetch(S.url + "/api/form/"); assert.equal(alive.status, 200);
});

test("chunked JSON a pomalé čtení těla jdou, přílišná velikost se odmítne i bez Content-Length", async () => {
  const k = (await (await fetch(S.url + "/api/form/")).json()).k;
  const { issueFormToken } = await import("../lib/form.js");
  const good = JSON.stringify({ email: "chunk@example.cz", consent: true, consent_version: "2026-11-03-v3", website: "", k: issueFormToken(Date.now() - 6000) });
  const half = Math.floor(good.length / 2);
  const r = await raw(`POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${half.toString(16)}\r\n${good.slice(0, half)}\r\n${(good.length - half).toString(16)}\r\n${good.slice(half)}\r\n0\r\n\r\n`, { wait: 600 });
  assert.equal(status(r), 200, r.slice(0, 200));
  const big = "x".repeat(20000);
  const r2 = await raw(`POST /api/subscribe/ HTTP/1.1\r\nHost: x\r\nOrigin: https://nadbytecna.cz\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${big.length.toString(16)}\r\n${big}\r\n0\r\n\r\n`, { wait: 600 });
  assert.equal(status(r2), 413, r2.slice(0, 200));
  assert.ok(k);
});

test("bezpečnostní hlavičky: na stránkách i v API, CSP bez unsafe-inline a bez cizích zdrojů", async () => {
  for (const p of ["/", "/dekujeme/", "/potvrzeni/", "/api/form/"]) {
    const r = await fetch(S.url + p);
    const h = r.headers;
    assert.ok(h.get("content-security-policy"), p);
    assert.ok(!/unsafe-inline|unsafe-eval|\*|http:/.test(h.get("content-security-policy").replace("upgrade-insecure-requests", "")), "CSP " + p);
    assert.match(h.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(h.get("content-security-policy"), /script-src 'self'/);
    assert.match(h.get("content-security-policy"), /style-src 'self' 'sha256-[A-Za-z0-9+/=]+';/);
    assert.equal(h.get("x-content-type-options"), "nosniff");
    assert.equal(h.get("x-frame-options"), "DENY");
    assert.equal(h.get("referrer-policy"), "no-referrer");
    assert.match(h.get("strict-transport-security"), /max-age=\d{8,}/);
    assert.equal(h.get("cross-origin-opener-policy"), "same-origin");
    assert.ok(h.get("permissions-policy").includes("camera=()"));
  }
});

test("CORS: z cizího původu není povolen žádný přístup (žádné Access-Control-Allow-*)", async () => {
  for (const method of ["GET", "POST", "OPTIONS"]) {
    const r = await fetch(S.url + "/api/subscribe/", { method, headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.ok(![...r.headers.keys()].some((k) => k.startsWith("access-control-")), method);
    assert.ok(r.status >= 400);
  }
});

test("vercel.json: otisk inline CSS v CSP odpovídá skutečnému CSS ve stránkách", async () => {
  const html = await (await fetch(S.url + "/")).text();
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const crypto = await import("node:crypto");
  const hash = "sha256-" + crypto.createHash("sha256").update(css).digest("base64");
  const csp = (await fetch(S.url + "/")).headers.get("content-security-policy");
  assert.ok(csp.includes(`'${hash}'`), "otisk CSS nesedí; spusť node build.mjs a commitni vercel.json");
});
