import test from "node:test";
import assert from "node:assert/strict";
import { hostGate, requestHost, siteLive, withOrigin } from "../lib/host-gate.mjs";

test("SITE_LIVE je zapnuté jen pro true a 1", () => {
  assert.equal(siteLive(undefined), false);
  assert.equal(siteLive(""), false);
  assert.equal(siteLive("false"), false);
  assert.equal(siteLive("true"), true);
  assert.equal(siteLive("1"), true);
});

test("www jde na apex, vercel.app zůstává plný web", () => {
  assert.deepEqual(hostGate({ host: "www.nadbytecna.cz", pathname: "/", search: "?a=1" }), {
    type: "redirect", status: 301, url: "https://nadbytecna.cz/?a=1",
  });
  assert.deepEqual(hostGate({ host: "www.nadbytecna.cz", pathname: "/zasady/" }), {
    type: "redirect", status: 301, url: "https://nadbytecna.cz/zasady/",
  });
  assert.equal(hostGate({ host: "nadbytecna-prelanding.vercel.app", pathname: "/admin/" }).type, "next");
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/sdilet-pribeh/", live: true }).type, "next");
  assert.deepEqual(hostGate({ host: "www.nadbytecna.cz", pathname: "/admin/", live: true }), {
    type: "redirect", status: 301, url: "https://nadbytecna.cz/admin/",
  });
});

test("coming soon pustí jen úvod, zásady a soubory", () => {
  for (const host of ["nadbytecna.cz", "www.nadbytecna.cz"]) {
    assert.equal(hostGate({ host, pathname: "/api/transcribe/" }).type, "missing");
    assert.equal(hostGate({ host, pathname: "/api/notify/" }).type, "missing");
    assert.equal(hostGate({ host, pathname: "/fluid.js" }).type, host === "www.nadbytecna.cz" ? "redirect" : "next");
  }
  assert.deepEqual(hostGate({ host: "nadbytecna.cz", pathname: "/" }), { type: "rewrite", url: "/coming-soon/" });
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/zasady/" }).type, "next");
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/coming-soon/" }).type, "next");
  for (const path of ["/pribeh", "/sdilet-pribeh/", "/mohu-pomoci/", "/ochrana-osobnich-udaju/", "/kontakt/"]) {
    assert.deepEqual(hostGate({ host: "nadbytecna.cz", pathname: path }), { type: "redirect", status: 302, url: "https://nadbytecna.cz/" }, path);
    assert.deepEqual(hostGate({ host: "www.nadbytecna.cz", pathname: path }), { type: "redirect", status: 302, url: "https://nadbytecna.cz/" }, path);
  }
});

test("og adresa se přepíše podle hostitele", () => {
  const html = '<meta property="og:image" content="https://nadbytecna.cz/og-v2.jpg"><link rel="canonical" href="https://nadbytecna.cz/">';
  const out = withOrigin(html, "https://nadbytecna-prelanding.vercel.app");
  assert.match(out, /https:\/\/nadbytecna-prelanding\.vercel\.app\/og-v2\.jpg/);
  assert.match(out, /href="https:\/\/nadbytecna-prelanding\.vercel\.app\/"/);
});

test("Host i x-forwarded-host poznají veřejnou doménu", () => {
  const headers = new Headers({ host: "nadbytecna-prelanding.vercel.app", "x-forwarded-host": "nadbytecna.cz" });
  assert.equal(requestHost(headers), "nadbytecna.cz");
  assert.equal(requestHost(new Headers({ host: "www.nadbytecna.cz" })), "www.nadbytecna.cz");
});

test("admin a jeho chráněná API fungují i při SITE_LIVE=false",()=>{for(const path of ['/admin','/admin/','/api/admin/','/api/triage/','/api/retention/','/api/ai-worker/','/api/admin-mail/','/api/mail-sync/']) assert.equal(hostGate({host:'nadbytecna.cz',pathname:path,live:false}).type,'next');});
