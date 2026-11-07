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

export function isComingSoonPass(pathname) {
  const path = pathname || "/";
  if (path === "/coming-soon" || path === "/coming-soon/" || path === "/coming-soon/index.html") return true;
  if (path === "/ochrana-osobnich-udaju" || path.startsWith("/ochrana-osobnich-udaju/")) return true;
  return /\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?|txt|xml|webmanifest)$/i.test(path);
}

export function hostGate({ host, pathname = "/", search = "", live = false }) {
  const h = normalizeHost(host);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (h === WWW) return { type: "redirect", status: 301, url: `https://${APEX}${path}${search}` };
  if (h !== APEX || live) return { type: "next" };
  if (path === "/api" || path.startsWith("/api/")) return { type: "missing" };
  if (isComingSoonPass(path)) return { type: "next" };
  return { type: "rewrite", url: "/coming-soon/" };
}
