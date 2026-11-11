import { next, rewrite } from "@vercel/functions";
import { adminHtml } from "./lib/admin-html.mjs";
import { hostGate, requestHost, siteLive, withOrigin } from "./lib/host-gate.mjs";

const PASS = "x-nb-origin";

function isDocument(pathname) {
  return pathname === "/" || pathname.endsWith("/");
}

export const config = { runtime: "nodejs" };

export default async function middleware(request) {
  const url = new URL(request.url);
  const decision = hostGate({
    host: requestHost(request.headers),
    pathname: url.pathname,
    search: url.search,
    live: siteLive(process.env.SITE_LIVE),
  });
  if (decision.type === "redirect") return Response.redirect(decision.url, decision.status);
  if (decision.type === "missing") {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
  }

  // Serve the empty admin shell dynamically: static hosting otherwise caches its HTML.
  if (["/admin", "/admin/", "/admin/index.html"].includes(url.pathname)) {
    const headers = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "cdn-cache-control": "no-store",
      "vercel-cdn-cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "referrer-policy": "no-referrer",
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
    }
    return new Response(request.method === "HEAD" ? null : adminHtml(), { headers });
  }

  const publicHost = ["nadbytecna.cz", "www.nadbytecna.cz"].includes(requestHost(request.headers));
  const noindexHeaders = publicHost ? undefined : { "x-robots-tag": "noindex, nofollow, noarchive" };
  const pass = () => (decision.type === "rewrite" ? rewrite(new URL(decision.url, request.url), { headers: noindexHeaders }) : next({ headers: noindexHeaders }));
  if (request.method !== "GET" || request.headers.get(PASS) === "1") return pass();

  const served = decision.type === "rewrite" ? new URL(decision.url, request.url).pathname : url.pathname;
  const host = requestHost(request.headers);
  if (host === "nadbytecna.cz" || host === "www.nadbytecna.cz" || !isDocument(served)) return pass();

  const target = new URL(decision.type === "rewrite" ? decision.url : `${url.pathname}${url.search}`, request.url);
  const headers = new Headers(request.headers);
  headers.set(PASS, "1");
  let res;
  try {
    res = await fetch(target, { headers, redirect: "manual" });
  } catch {
    return pass();
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return pass();
  const html = withOrigin(await res.text(), url.origin);
  const out = new Headers(res.headers);
  out.set("x-robots-tag", "noindex, nofollow, noarchive");
  out.delete("content-length");
  out.delete("content-encoding");
  return new Response(html, { status: res.status, headers: out });
}
