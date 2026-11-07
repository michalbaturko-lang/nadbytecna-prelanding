import { next, rewrite } from "@vercel/functions";
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

  const pass = () => (decision.type === "rewrite" ? rewrite(new URL(decision.url, request.url)) : next());
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
  out.delete("content-length");
  out.delete("content-encoding");
  return new Response(html, { status: res.status, headers: out });
}
