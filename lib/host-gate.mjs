// Coming soon jen na veřejné doméně. Adresa na vercel.app zůstává plný web.
const APEX = "nadbytecna.cz";
const WWW = "www.nadbytecna.cz";

export function normalizeHost(host) {
  return String(host || "").trim().toLowerCase().replace(/\.$/, "").split(":")[0];
}

export function siteLive(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export function requestHost(header) {
  const list = [header?.get?.("x-forwarded-host"), header?.get?.("host")]
    .flatMap((v) => String(v || "").split(","))
    .map(normalizeHost)
    .filter(Boolean);
  return list.find((h) => h === APEX || h === WWW) || list[0] || "";
}

export function isAsset(pathname) {
  return /\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?|txt|xml|webmanifest)$/i.test(pathname || "");
}

export function isPolicy(pathname) {
  return pathname === "/zasady" || pathname.startsWith("/zasady/")
    || pathname === "/ochrana-osobnich-udaju" || pathname.startsWith("/ochrana-osobnich-udaju/");
}

export function isSoonPage(pathname) {
  return pathname === "/coming-soon" || pathname === "/coming-soon/" || pathname === "/coming-soon/index.html";
}

export function isApi(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function withOrigin(html, origin) {
  const base = String(origin || "https://nadbytecna.cz").replace(/\/$/, "");
  return String(html)
    .replaceAll("https://nadbytecna.cz/og-v4.jpg", base + "/og-v4.jpg")
    .replaceAll('href="https://nadbytecna.cz/', 'href="' + base + "/")
    .replaceAll('content="https://nadbytecna.cz', 'content="' + base);
}

export function hostGate({ host, pathname = "/", search = "", live = false }) {
  const h = normalizeHost(host);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const onPublic = h === APEX || h === WWW;
  if (!onPublic) return { type: "next" };
  const admin = path === "/admin" || path.startsWith("/admin/") || /^\/api\/(?:admin|admin-mail|mail-sync|mail-ai-worker|mail-archive-worker|mail-connect|retention|triage)\/?$/.test(path);
  if (path === "/api/ai-worker" || path === "/api/ai-worker/") return { type: "next" };
  if (admin) return h === WWW ? { type: "redirect", status: 301, url: `https://${APEX}${path}${search}` } : { type: "next" };
  if (!live && isApi(path)) return { type: "missing" };
  if (path === "/zasady" || path === "/zasady/") {
    return { type: "redirect", status: 301, url: `https://${APEX}/ochrana-osobnich-udaju/${search}` };
  }
  if (h === WWW) {
    if (!live && path !== "/" && !isPolicy(path) && !isAsset(path) && !isSoonPage(path)) {
      return { type: "redirect", status: 302, url: `https://${APEX}/` };
    }
    const target = !live && isSoonPage(path) ? "/" : path;
    return { type: "redirect", status: 301, url: `https://${APEX}${target}${search}` };
  }
  if (live) return { type: "next" };
  if (path === "/") return { type: "rewrite", url: "/coming-soon/" };
  if (isPolicy(path) || isAsset(path) || isSoonPage(path)) return { type: "next" };
  return { type: "redirect", status: 302, url: `https://${APEX}/` };
}
