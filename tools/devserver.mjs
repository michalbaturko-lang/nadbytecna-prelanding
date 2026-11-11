// Lokální server: statický dist/ + /api/* přes skutečné handlery a maketu Supabase. Jen pro testy (zátěž, E2E, HTTP).
// Spuštění: node tools/devserver.mjs [port]        Testy ho volají jako modul: startDevServer({ port, latency })
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseEnv, captureMails, installMockSupabase } from "../tests/helpers/mock-supabase.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };

export async function startDevServer({ port = 0, latency = [0, 0], env = {}, dist = path.join(ROOT, "dist") } = {}) {
  baseEnv({ RATE_PER_IP_HOUR: "30", RATE_GLOBAL_HOUR: "3000", ...env });
  const db = installMockSupabase({ latency });
  const { mails } = captureMails();
  const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const globalHeaders = Object.fromEntries(vercelJson.headers[0].headers.map((h) => [h.key, h.value]));
  const handlers = {};
  for (const n of ["subscribe", "confirm", "unsubscribe", "vote", "form"]) handlers[`/api/${n}/`] = (await import(`../api/${n}.js?${Math.random()}`)).default;
  const stats = { api: 0, crashed: 0 };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    for (const [k, v] of Object.entries(globalHeaders)) res.setHeader(k, v);
    if (u.pathname === "/__test/mails") { res.setHeader("Content-Type", "application/json"); const out = mails.splice(0, mails.length); return res.end(JSON.stringify(out)); }
    if (u.pathname === "/__test/state") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ rows: db.rows, violations: db.violations, requests: db.requests.length, stats })); }
    const redirect = (vercelJson.redirects || []).find((rule) => rule.source === u.pathname);
    if (redirect && (req.method === "GET" || req.method === "HEAD")) {
      res.statusCode = redirect.permanent ? 301 : 302;
      res.setHeader("Location", redirect.destination);
      return res.end();
    }
    const h = handlers[u.pathname];
    if (h) {
      stats.api++;
      try { await h(req, res); } catch (e) { stats.crashed++; if (!res.headersSent) { res.statusCode = 500; res.end("{}"); } }
      return;
    }
    let p = decodeURIComponent(u.pathname);
    let f = path.join(dist, p);
    if (p.endsWith("/")) f = path.join(f, "index.html");
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("404"); }
    const stat = fs.statSync(f);
    res.setHeader("Content-Type", types[path.extname(f)] || "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    const range = req.headers.range;
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && stat.size) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      const whole = start === 0 && end >= stat.size - 1;
      if (!whole && start <= end && end < stat.size) {
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        fs.createReadStream(f, { start, end }).pipe(res);
        return;
      }
    }
    res.setHeader("Content-Length", String(stat.size));
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address();
  return { server, db, mails, stats, url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startDevServer({ port: Number(process.argv[2]) || 4400 });
  console.log("devserver", s.url);
}
