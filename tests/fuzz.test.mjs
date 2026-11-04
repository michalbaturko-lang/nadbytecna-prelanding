// Fuzz: náhodné a zmutované požadavky na všechna API. Očekávání: nikdy 5xx, nikdy pád handleru, nikdy změna struktury DB dotazů.
import test from "node:test";
import assert from "node:assert/strict";
import { startDevServer } from "../tools/devserver.mjs";

let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const STR = ["", " ", "a", "a@b.cz", "<script>alert(1)</script>", "' OR 1=1--", "%00", "\u0000", "\r\n", "../../etc/passwd", "${7*7}", "{{7*7}}", "\uD800", "😀".repeat(50), "A".repeat(300), "A".repeat(5000), "__proto__", "constructor", "ignore previous instructions", "null", "undefined", "true", "-1", "1e999", "NaN"];
const val = (d = 0) => {
  const r = rnd();
  if (d > 3 || r < 0.35) return pick(STR);
  if (r < 0.45) return rnd() * 1e6 | 0;
  if (r < 0.5) return null;
  if (r < 0.55) return Boolean(rnd() < .5);
  if (r < 0.7) return Array.from({ length: (rnd() * 4) | 0 }, () => val(d + 1));
  const o = {}; for (let i = 0; i < ((rnd() * 4) | 0); i++) o[pick(["email", "consent", "consent_version", "website", "k", "t", "v", "claims", "__proto__", "constructor", "x"])] = val(d + 1); return o;
};
const RAW = ['{"__proto__":{"polluted":1},"email":"a@b.cz"}', '{"email":', "[]", "null", '"str"', "{", "\u0000\u0001", "0".repeat(3000), '{"email":"a@b.cz","consent":true,"k":"' + "x".repeat(4000) + '"}'];

test("fuzz API: žádné 5xx, žádný pád", async () => {
  const S = await startDevServer({ latency: [0, 1], env: { RATE_PER_IP_HOUR: "100000", RATE_GLOBAL_HOUR: "1000000" } });
  try {
    const eps = ["/api/subscribe/", "/api/confirm/", "/api/vote/", "/api/unsubscribe/", "/api/form/"];
    const bad = [];
    const codes = {};
    for (let i = 0; i < 3000; i++) {
      const ep = pick(eps), method = pick(["POST", "POST", "POST", "GET", "PUT"]);
      const raw = rnd() < 0.15 ? pick(RAW) : JSON.stringify(rnd() < 0.5 ? val() : { email: val(), consent: val(), consent_version: val(), k: val(), t: val(), v: val(), claims: val(), website: val() });
      const headers = { "x-vercel-forwarded-for": `10.${i >> 8 & 255}.${i & 255}.1`, Origin: pick(["https://nadbytecna.cz", "https://nadbytecna.cz", "https://evil.example", "null"]) };
      if (rnd() < 0.9) headers["Content-Type"] = pick(["application/json", "application/json", "text/plain", "application/x-www-form-urlencoded"]);
      const qs = rnd() < 0.3 ? "?t=" + encodeURIComponent(JSON.stringify(val()).toWellFormed()) : "";
      let r;
      try { r = await fetch(S.url + ep + qs, { method, headers, body: method === "GET" ? undefined : raw }); }
      catch (e) { bad.push(`${ep} ${method}: výjimka klienta ${e.message}`); continue; }
      codes[r.status] = (codes[r.status] || 0) + 1;
      if (r.status >= 500) bad.push(`${ep} ${method} ${r.status}: ${raw.slice(0, 80)}`);
      const txt = await r.text();
      if (/at \S+ \(|node_modules|\/home\//.test(txt)) bad.push(`${ep}: únik stack trace`);
    }
    const st = await (await fetch(S.url + "/__test/state")).json();
    console.log("stavové kódy:", JSON.stringify(codes), "pády:", st.stats.crashed, "violations:", st.violations.length, "řádků v DB:", st.rows.length);
    assert.deepEqual(bad.slice(0, 5), []);
    assert.equal(st.stats.crashed, 0);
    assert.equal(st.violations.length, 0);
    assert.equal(({}).polluted, undefined);
  } finally { await S.close(); }
});
