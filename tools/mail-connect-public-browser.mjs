// Public connect landing regression with synthetic invitation and mocked begin endpoint.
// Never visits Microsoft: all external requests are aborted inside the test browser.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mailConnectHtml } from "../lib/mail-connect-html.mjs";
const root = path.resolve(new URL("../", import.meta.url).pathname),
  invite = "S".repeat(43),
  tenant = "11111111-1111-4111-8111-111111111111";
let ready = true,
  mode = "reject",
  begin = 0;
const httpPaths = [],
  posted = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  httpPaths.push(req.url);
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/api/mail-connect/" && req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    return res.end(mailConnectHtml({ ready }));
  }
  if (url.pathname === "/api/mail-connect/" && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    posted.push(JSON.parse(raw));
    begin++;
    res.setHeader("Content-Type", "application/json");
    if (mode === "reject") {
      res.statusCode = 400;
      return res.end('{"error":"invalid"}');
    }
    return res.end(
      JSON.stringify({
        url:
          mode === "bad-redirect"
            ? "https://evil.example/authorize"
            : "https://login.microsoftonline.com/" +
              tenant +
              "/oauth2/v2.0/authorize?client_id=synthetic&state=synthetic",
      }),
    );
  }
  const files = {
    "/mail-connect.js": "src/mail-connect.js",
    "/mail-connect.css": "src/mail-connect.css",
  };
  if (!files[url.pathname]) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader(
    "Content-Type",
    url.pathname.endsWith(".js") ? "text/javascript" : "text/css",
  );
  res.end(fs.readFileSync(path.join(root, files[url.pathname])));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(
  process.env.ADMIN_BROWSER_EXECUTABLE
    ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE }
    : { channel: process.env.ADMIN_BROWSER_CHANNEL || "chrome" },
);
const axe = fs.readFileSync(
    path.join(root, "node_modules/axe-core/axe.min.js"),
    "utf8",
  ),
  results = [];
let externalAttempts = 0;
async function pageAt(fragment, width = 375) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
  });
  await context.route("https://**/*", (route) => {
    externalAttempts++;
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(
    base + "/api/mail-connect/" + (fragment ? "#invite=" + fragment : ""),
  );
  await page
    .locator("#connect-status")
    .filter({ hasText: /(Pozvánku|Tento odkaz|Připojení Microsoftu)/ })
    .waitFor();
  return { context, page };
}
try {
  ready = false;
  let c = await pageAt(invite);
  assert.equal(await c.page.locator("#connect-microsoft").isDisabled(), true);
  assert.ok(
    (await c.page.locator("#connect-status").innerText()).includes(
      "ještě není nastavené",
    ),
  );
  assert.equal(begin, 0);
  assert.equal(new URL(c.page.url()).hash, "");
  results.push("missing Microsoft setup cannot begin");
  await c.context.close();
  ready = true;
  c = await pageAt("invalid");
  assert.equal(await c.page.locator("#connect-microsoft").isDisabled(), true);
  assert.equal(begin, 0);
  results.push("invalid invitation cannot begin");
  await c.context.close();
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    c = await pageAt(invite, width);
    assert.equal(
      await c.page.locator("#connect-microsoft").isDisabled(),
      false,
    );
    assert.equal(begin, 0);
    const privacy = await c.page.evaluate(() => ({
      url: location.href,
      session: JSON.stringify({ ...sessionStorage }),
      local: JSON.stringify({ ...localStorage }),
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    assert.ok(!privacy.url.includes("invite="));
    assert.ok(!privacy.session.includes("S".repeat(43)));
    assert.ok(!privacy.local.includes("S".repeat(43)));
    assert.ok(privacy.sw <= privacy.cw);
    await c.page.addScriptTag({ content: axe });
    const accessibility = await c.page.evaluate(() =>
      axe.run(document, {
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
      }),
    );
    assert.deepEqual(
      accessibility.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
      width + " public landing axe",
    );
    results.push(
      width + " public landing responsive/privacy/no automatic consume",
    );
    if ([375, 1440].includes(width))
      await c.page.screenshot({
        path: path.join(
          root,
          "docs/admin/screenshots/" + width + "-mail-connect-public.png",
        ),
        fullPage: true,
      });
    await c.context.close();
  }
  mode = "reject";
  c = await pageAt(invite);
  await c.page.locator("#connect-microsoft").click();
  await c.page.getByText(/Pozvánka není platná, vypršela/).waitFor();
  assert.equal(begin, 1);
  assert.equal(posted[0].invite, invite);
  assert.equal(await c.page.locator("#connect-microsoft").isDisabled(), true);
  assert.equal(externalAttempts, 0);
  results.push("expired or rejected invitation stays local with clear error");
  await c.context.close();
  mode = "bad-redirect";
  c = await pageAt(invite);
  await c.page.locator("#connect-microsoft").click();
  await c.page.getByText(/Pozvánka není platná, vypršela/).waitFor();
  assert.equal(externalAttempts, 0);
  assert.equal(new URL(c.page.url()).origin, base);
  results.push("non-Microsoft redirect rejected before navigation");
  await c.context.close();
  mode = "valid";
  c = await pageAt(invite);
  const destination = c.page.waitForRequest((r) =>
    r.url().startsWith("https://login.microsoftonline.com/"),
  );
  const blocked = c.page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().startsWith("https://login.microsoftonline.com/"),
  });
  await c.page.locator("#connect-microsoft").click();
  const request = await destination;
  assert.ok(new URL(request.url()).pathname.endsWith("/oauth2/v2.0/authorize"));
  await blocked;
  assert.equal(externalAttempts, 1);
  results.push(
    "explicit click navigates only to validated Microsoft authorization URL (aborted by test)",
  );
  await c.context.close();
  assert.ok(httpPaths.every((p) => !p.includes(invite)));
  fs.writeFileSync(
    path.join(root, "docs/admin/mail-connect-public-results.json"),
    JSON.stringify(
      {
        date: "2026-11-07",
        environment:
          "synthetic public page; Microsoft navigation intercepted and aborted",
        checks: results.length,
        results,
        realMicrosoftRequests: 0,
        automaticBeginRequests: 0,
        inviteInHttpUrls: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      environment:
        "synthetic public landing; external OAuth navigation intercepted and aborted",
      checks: results.length,
      results,
      inviteInHttpUrls: false,
      automaticBeginRequests: 0,
      realMicrosoftRequests: 0,
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => {
    server.closeAllConnections();
    server.close(r);
  });
}
