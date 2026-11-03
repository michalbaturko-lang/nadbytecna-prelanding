// Jednoduchý statický server pro lokální náhled: node tools/serve.mjs <dir> <port>
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const [dir, port] = [path.resolve(process.argv[2]), Number(process.argv[3])];
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(dir, p); if (f.endsWith("/") || (fs.existsSync(f) && fs.statSync(f).isDirectory())) f = path.join(f, "index.html");
  if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(port);
