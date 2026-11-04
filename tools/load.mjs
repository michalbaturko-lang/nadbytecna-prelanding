// Zátěžový test: N lidí přijde na stránku, vyplní e-mail, potvrdí, část hlasuje, část se odhlásí.
// Včetně nepřátelského provozu (boti, duplicity, dvojklik, útok z jedné IP, útok neplatnými vstupy).
// Použití:  node tools/load.mjs [--n 1000] [--latency 15,60] [--scenario spike|nat|attack|all]
// Proti živému webu (jen ukázkový režim, nic se neukládá):  node tools/load.mjs --live https://nadbytecna-prelanding.vercel.app --n 200
import { startDevServer } from "./devserver.mjs";
import { performance } from "node:perf_hooks";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", 1000));
const LIVE = arg("live", "");
const SCEN = arg("scenario", "all");
const latency = arg("latency", "15,60").split(",").map(Number);

const lat = {};                                    // endpoint -> [ms]
const codes = {};                                  // "endpoint status" -> count
const rec = (ep0, ms, st) => { const ep = ep0.split("?")[0]; (lat[ep] ||= []).push(ms); codes[`${ep} ${st}`] = (codes[`${ep} ${st}`] || 0) + 1; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]?.toFixed(0); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

async function main() {
  let base = LIVE, S = null;
  if (!LIVE) { S = await startDevServer({ latency, env: { RATE_PER_IP_HOUR: "30", RATE_GLOBAL_HOUR: "3000" } }); base = S.url; }
  const origin = LIVE || "https://nadbytecna.cz";
  const req = async (ep, method, ip, body) => {
    const t = performance.now();
    let st = 0, j = null;
    try {
      const r = await fetch(base + ep, { method, headers: { "Content-Type": "application/json", Origin: LIVE ? base : origin, "x-vercel-forwarded-for": ip, Connection: "keep-alive" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
      st = r.status; j = await r.json().catch(() => null);
    } catch (e) { st = "ERR"; }
    rec(ep, performance.now() - t, st);
    return { st, j };
  };
  const mailsFor = async () => (S ? await (await fetch(S.url + "/__test/mails")).json() : []);
  const state = async () => (S ? await (await fetch(S.url + "/__test/state")).json() : null);
  const CV = "2026-11-03-v3";
  const lag = []; { let last = performance.now(); setInterval(() => { const n = performance.now(); lag.push(n - last - 20); last = n; }, 20).unref(); }

  async function scenario(name, users, ipOf, opts = {}) {
    console.log(`\n=== ${name}: ${users} lidí ===`);
    const t0 = performance.now();
    const expectUnique = new Set(); const plan = [];
    for (let i = 0; i < users; i++) {
      const kind = Math.random();
      const u = { i, ip: ipOf(i), email: `host${i}.${Date.now()}@example.cz`, kind: kind < 0.03 ? "bot" : kind < 0.05 ? "invalid" : kind < 0.10 ? "dup" : kind < 0.18 ? "dbl" : "ok" };
      if (u.kind === "dup" && i > 0) u.email = plan[Math.floor(Math.random() * i)].email;
      plan.push(u);
    }
    // 1) všichni načtou stránku (token) v okně 3 s, pak „vyplňují“ 2,7–6 s
    const outcome = await Promise.all(plan.map(async (u) => {
      await sleep(rnd(0, opts.arrival ?? 3000));
      const k = (await req("/api/form/", "GET", u.ip)).j?.k;
      await sleep(rnd(2800, 6000));
      const body = { email: u.kind === "invalid" ? "nesmysl@" : u.email, consent: true, consent_version: CV, website: u.kind === "bot" ? "http://spam.example" : "", k };
      const first = await req("/api/subscribe/", "POST", u.ip, body);
      if (u.kind === "dbl") await req("/api/subscribe/", "POST", u.ip, body);      // dvojklik
      return { u, st: first.st };
    }));
    const ok = outcome.filter((o) => o.st === 200 && !["bot", "invalid"].includes(o.u.kind));
    ok.forEach((o) => expectUnique.add(o.u.email));
    const blocked = outcome.filter((o) => o.st === 429).length;
    console.log(`přihlášek přijato (200): ${ok.length}, zablokováno limitem (429): ${blocked}, neplatných (400): ${outcome.filter((o) => o.st === 400).length}, chyb 5xx/ERR: ${outcome.filter((o) => o.st >= 500 || o.st === "ERR").length}`);
    // 2) potvrzení, hlasování, odhlášení
    if (S) {
      const mails = await mailsFor();
      const tokens = mails.map((m) => ({ to: m.to, t: new URL(m.text.match(/https?:\/\/\S+potvrzeni\/\?t=\S+/)[0]).searchParams.get("t"), unsub: m.headers["List-Unsubscribe"].slice(1, -1) }));
      let confirmed = 0, voted = 0, unsub = 0;
      await Promise.all(tokens.map(async (x, idx) => {
        await sleep(rnd(0, 2500));
        if (Math.random() < 0.9) {
          const r = await req("/api/confirm/", "POST", `10.9.${idx >> 8}.${idx & 255}`, { t: x.t });
          if (r.st === 200) { confirmed++;
            if (Math.random() < 0.6) { const v = await req("/api/vote/", "POST", `10.9.${idx >> 8}.${idx & 255}`, { v: r.j.vote, claims: ["zena", "never", "nejsi"].slice(0, 1 + (idx % 3)) }); if (v.st === 200) voted++; }
            if (Math.random() < 0.05) { const path = new URL(x.unsub); const u = await req(path.pathname + path.search, "POST", "10.8.0.1", null); if (u.st === 200) unsub++; }
          }
        }
      }));
      for (let i = 0; i < 100; i++) await req("/api/vote/", "GET", `10.7.0.${i}`);
      const st = await state();
      const rows = st.rows, emails = rows.map((r) => r.email_normalized);
      const dupRows = emails.length - new Set(emails).size;
      const bad = [];
      if (rows.length !== expectUnique.size) bad.push(`řádků ${rows.length} ≠ očekávaných unikátních ${expectUnique.size}`);
      if (dupRows) bad.push(`duplicitních řádků ${dupRows}`);
      if (tokens.length !== expectUnique.size) bad.push(`odeslaných e-mailů ${tokens.length} ≠ unikátních ${expectUnique.size}`);
      if (st.violations.length) bad.push(`dotazy se změněnou strukturou: ${st.violations.length}`);
      if (st.stats.crashed) bad.push(`pády handleru: ${st.stats.crashed}`);
      if (rows.some((r) => !r.consent_text || !r.consent_version || !r.consented_at)) bad.push("řádek bez důkazu o souhlasu");
      if (rows.some((r) => r.status === "confirmed" && !r.confirmed_at)) bad.push("potvrzený bez času potvrzení");
      if (rows.some((r) => JSON.stringify(r).match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/))) bad.push("v řádku je holá IP adresa");
      const byStatus = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
      console.log(`potvrdilo ${confirmed}, hlasovalo ${voted}, odhlásilo ${unsub}; stavy v DB: ${JSON.stringify(byStatus)}`);
      console.log(bad.length ? "SELHÁNÍ INVARIANTŮ:\n - " + bad.join("\n - ") : "invarianty OK: žádné duplicity, každý unikátní e-mail má právě 1 řádek a právě 1 e-mail ven, důkaz o souhlasu u všech, žádná holá IP");
      if (bad.length) process.exitCode = 1;
      S.db.rows.length = 0;
    }
    console.log(`doba scénáře: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }

  async function attack() {
    console.log(`\n=== útok: 600 souběžných požadavků z JEDNÉ IP + 300 neplatných vstupů ===`);
    const ip = "198.51.100.9";
    const toks = await Promise.all(Array.from({ length: 600 }, () => req("/api/form/", "GET", ip)));
    await sleep(2800);
    const res = await Promise.all(toks.map((t, i) => req("/api/subscribe/", "POST", ip, { email: `atk${i}.${Date.now()}@example.cz`, consent: true, consent_version: CV, website: "", k: t.j.k })));
    const passed = res.filter((r) => r.st === 200).length, limited = res.filter((r) => r.st === 429).length;
    console.log(`z jedné IP prošlo ${passed} z 600 (limit 30/h), zamítnuto 429: ${limited}, ostatní: ${600 - passed - limited}`);
    if (S && passed > 30) { console.log("SELHÁNÍ: limit na IP byl překročen"); process.exitCode = 1; }
    const junk = await Promise.all(Array.from({ length: 300 }, (_, i) => req("/api/subscribe/", "POST", `192.0.2.${i % 250}`, i % 3 === 0 ? { email: `<script>${i}</script>@x.cz`, consent: true, consent_version: CV, k: toks[0].j.k } : i % 3 === 1 ? { email: ["a@b.cz", "c@d.cz"], consent: true } : "ne-objekt")));
    console.log(`neplatné vstupy: ${JSON.stringify(junk.reduce((a, r) => ((a[r.st] = (a[r.st] || 0) + 1), a), {}))} (žádné 5xx očekávány)`);
    if (junk.some((r) => r.st >= 500 || r.st === "ERR")) process.exitCode = 1;
    if (S) { const st = await state(); console.log(`pády handleru: ${st.stats.crashed}, dotazy se změněnou strukturou: ${st.violations.length}`); if (st.stats.crashed || st.violations.length) process.exitCode = 1; S.db.rows.length = 0; }
  }

  if (LIVE) {
    await scenario("živý web (ukázkový režim)", N, (i) => `100.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
  } else {
    if (["spike", "all"].includes(SCEN)) await scenario(`špička: ${N} lidí z ${N} různých IP během 3 s`, N, (i) => `100.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    if (["nat", "all"].includes(SCEN)) await scenario(`${N} lidí za 20 sdílenými IP (mobilní operátor / firemní síť, 50 lidí na IP)`, N, (i) => `203.0.113.${i % 20}`);
    if (["attack", "all"].includes(SCEN)) await attack();
  }

  console.log("\n--- latence (ms) a stavové kódy ---");
  for (const [ep, a] of Object.entries(lat)) console.log(`${ep.padEnd(24)} n=${String(a.length).padStart(5)}  p50=${pct(a, .5)}  p95=${pct(a, .95)}  p99=${pct(a, .99)}  max=${pct(a, 1)}`);
  console.log(Object.entries(codes).sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
  const lg = [...lag].sort((a, b) => a - b);
  console.log(`\nprůměrné zpoždění smyčky (klient+server v jednom procesu): p99 ${lg[Math.floor(lg.length * .99)]?.toFixed(0)} ms, paměť ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
  if (S) await S.close();
}
main().then(() => process.exit(process.exitCode || 0));
