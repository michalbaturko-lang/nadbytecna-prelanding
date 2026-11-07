import { next, rewrite } from "@vercel/functions";
import { hostGate, requestHost, siteLive } from "./lib/host-gate.mjs";

export const config = { runtime: "nodejs" };

export default function middleware(request) {
  const url = new URL(request.url);
  const decision = hostGate({
    host: requestHost(request.headers),
    pathname: url.pathname,
    search: url.search,
    live: siteLive(process.env.SITE_LIVE),
  });
  if (decision.type === "redirect") return Response.redirect(decision.url, decision.status);
  if (decision.type === "rewrite") return rewrite(new URL(decision.url, request.url));
  if (decision.type === "missing") return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
  return next();
}
