import test from "node:test";
import assert from "node:assert/strict";
import { hostGate, requestHost, siteLive } from "../lib/host-gate.mjs";

test("SITE_LIVE je zapnuté jen pro true a 1", () => {
  assert.equal(siteLive(undefined), false);
  assert.equal(siteLive(""), false);
  assert.equal(siteLive("false"), false);
  assert.equal(siteLive("true"), true);
  assert.equal(siteLive("1"), true);
});

test("www jde na apex, vercel.app zůstává plný web", () => {
  assert.deepEqual(hostGate({ host: "www.nadbytecna.cz", pathname: "/sdilet-pribeh/", search: "?a=1" }), {
    type: "redirect", status: 301, url: "https://nadbytecna.cz/sdilet-pribeh/?a=1",
  });
  assert.equal(hostGate({ host: "nadbytecna-prelanding.vercel.app", pathname: "/" }).type, "next");
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/", live: true }).type, "next");
});

test("apex bez SITE_LIVE ukáže coming soon a pustí zásady i soubory", () => {
  assert.deepEqual(hostGate({ host: "nadbytecna.cz", pathname: "/" }), { type: "rewrite", url: "/coming-soon/" });
  assert.deepEqual(hostGate({ host: "Nadbytecna.cz:443", pathname: "/sdilet-pribeh/" }), { type: "rewrite", url: "/coming-soon/" });
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/ochrana-osobnich-udaju/" }).type, "next");
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/fluid.js" }).type, "next");
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/coming-soon/" }).type, "next");
  assert.equal(hostGate({ host: "nadbytecna.cz", pathname: "/api/transcribe/" }).type, "missing");
});

test("Host i x-forwarded-host poznají veřejnou doménu", () => {
  const headers = new Headers({ host: "nadbytecna-prelanding.vercel.app", "x-forwarded-host": "nadbytecna.cz" });
  assert.equal(requestHost(headers), "nadbytecna.cz");
  assert.equal(requestHost(new Headers({ host: "www.nadbytecna.cz" })), "www.nadbytecna.cz");
});
