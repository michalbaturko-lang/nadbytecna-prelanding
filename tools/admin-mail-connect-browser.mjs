// UI-only invitation contract regression. Uses synthetic responses and never opens OAuth.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { adminHtml } from "../lib/admin-html.mjs";
const root = path.resolve(new URL("../", import.meta.url).pathname),
  token = "synthetic-invitation-admin";
let status = {
  mailbox: "veryvera@nadbytecna.cz",
  authMode: "delegated",
  configured: false,
  connected: false,
  connectConfigured: false,
  connectInviteEnabled: false,
  connectionUpdatedAt: null,
  syncEnabled: false,
  aiEnabled: false,
  needsSetup: true,
  lastSyncAt: null,
};
let inviteOrigin = null;
let inviteMode = "valid",
  invites = 0,
  disconnects = 0,
  publicVisits = 0;
const delayed = [];
const counts = {
  new: 0,
  in_progress: 0,
  acute: 0,
  waiting: 0,
  publish: 0,
  week: 0,
  month: 0,
  signups: 0,
  offers: { pravni: 0 },
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/admin/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(adminHtml());
  }
  if (url.pathname === "/config.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end("window.NADBYTECNA_SUPABASE={};");
  }
  if (url.pathname === "/api/mail-connect/") {
    publicVisits++;
    res.statusCode = 400;
    return res.end("never navigate to synthetic invitation");
  }
  if (url.pathname.startsWith("/api/")) {
    let raw = "";
    for await (const c of req) raw += c;
    const b = JSON.parse(raw || "{}");
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer " + token) {
      res.statusCode = 401;
      return res.end('{"error":"auth"}');
    }
    if (url.pathname === "/api/admin/")
      return res.end(
        JSON.stringify(
          b.action === "init"
            ? {
                categories: [{ code: "pravni", name: "Právní pomoc" }],
                counts,
                user: { id: "admin", email: "admin@example.invalid" },
                aiEnabled: false,
              }
            : b.action === "list"
              ? { rows: [], total: 0 }
              : { ok: true },
        ),
      );
    if (url.pathname === "/api/admin-mail/") {
      if (b.action === "status") return res.end(JSON.stringify(status));
      if (b.action === "list") return res.end('{"rows":[],"total":0}');
      if (b.action === "connect_invite") {
        invites++;
        const reply = () =>
          res.end(
            JSON.stringify({
              url:
                (inviteOrigin || "http://" + req.headers.host) +
                "/api/mail-connect/#invite=" +
                ("SYNTHETIC_PRIVATE_INVITATION_" + invites).padEnd(43, "A"),
              expiresAt:
                inviteMode === "invalid"
                  ? "not-a-date"
                  : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            }),
          );
        if (inviteMode === "delayed") {
          delayed.push(reply);
          return;
        }
        return reply();
      }
      if (b.action === "disconnect") {
        assert.equal(b.confirm, "ODPOJIT");
        disconnects++;
        status = {
          ...status,
          connected: false,
          connectionUpdatedAt: new Date().toISOString(),
        };
        return res.end('{"ok":true}');
      }
    }
    res.statusCode = 400;
    return res.end('{"error":"action"}');
  }
  const target = path.join(
    root,
    { "/admin.js": "src/admin.js", "/admin-pkce.js": "src/admin-pkce.js", "/admin.css": "src/admin.css" }[
      url.pathname
    ] || "dist" + url.pathname,
  );
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader(
    "Content-Type",
    target.endsWith(".js")
      ? "text/javascript"
      : target.endsWith(".css")
        ? "text/css"
        : target.endsWith(".svg")
          ? "image/svg+xml"
          : "application/octet-stream",
  );
  res.end(fs.readFileSync(target));
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
async function pageAt(width = 375) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
  });
  await context.route("https://**/*", (r) => r.abort());
  await context.addInitScript((t) => {
    sessionStorage.setItem(
      "nadbytecna-admin",
      JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 }),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value) => {
          window.syntheticCopied = value;
        },
      },
    });
  }, token);
  const page = await context.newPage();
  await page.goto(base + "/admin/");
  await page.locator("#admin-app").waitFor();
  await page.locator("#admin-view-mail").click();
  await page.locator("#mail-sync-status").filter({ hasText: /.+/ }).waitFor();
  return { context, page };
}
async function refresh(page) {
  await page.locator("#mail-refresh").click();
  await page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin-mail/") &&
      r.request().postDataJSON()?.action === "list",
  );
}
try {
  let c = await pageAt();
  assert.equal(await c.page.locator("#mail-connect-invite").isDisabled(), true);
  assert.ok(
    (await c.page.locator("#mail-connection-status").innerText()).includes(
      "Čeká na nastavení Microsoft aplikace",
    ),
  );
  results.push("missing application config remains disabled");
  await c.context.close();
  status = {
    ...status,
    configured: true,
    needsSetup: false,
    connectConfigured: true,
    connectInviteEnabled: false,
  };
  c = await pageAt();
  assert.equal(await c.page.locator("#mail-connect-invite").isDisabled(), true);
  results.push("explicit invitation gate required");
  await c.context.close();
  status.connectInviteEnabled = true;
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    c = await pageAt(width);
    await c.page.locator("#mail-connect-invite").click();
    await c.page.locator("#mail-connect-link").waitFor();
    const value = await c.page.locator("#mail-connect-url").inputValue();
    assert.ok(value.includes("SYNTHETIC_PRIVATE_INVITATION_"));
    assert.equal(
      await c.page.locator("#mail-connect-url").getAttribute("readonly"),
      "",
    );
    assert.ok(
      (await c.page.locator("#mail-connect-expiry").innerText()).includes(
        "Platnost do",
      ),
    );
    await c.page.locator("#mail-connect-copy").click();
    assert.equal(await c.page.evaluate(() => window.syntheticCopied), value);
    const saved = await c.page.evaluate(() => ({
      url: location.href,
      session: JSON.stringify({ ...sessionStorage }),
      local: JSON.stringify({ ...localStorage }),
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    }));
    assert.ok(!saved.url.includes("invite="));
    assert.ok(!saved.session.includes("SYNTHETIC_PRIVATE_INVITATION_"));
    assert.ok(!saved.local.includes("SYNTHETIC_PRIVATE_INVITATION_"));
    assert.equal(saved.overflow, false);
    await c.page.addScriptTag({ content: axe });
    const report = await c.page.evaluate(() =>
      axe.run(document, {
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
      }),
    );
    assert.deepEqual(
      report.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
      width + " invite axe",
    );
    if ([375, 1440].includes(width))
      await c.page.screenshot({
        path: path.join(
          root,
          "docs/admin/screenshots/" + width + "-mail-connect-admin.png",
        ),
        fullPage: true,
      });
    await c.page.locator("#admin-view-stories").click();
    assert.equal(await c.page.locator("#mail-connect-url").inputValue(), "");
    assert.equal(await c.page.locator("#mail-connect-link").isVisible(), false);
    results.push(
      width + " invite responsive/copy/no persistence/leave cleanup",
    );
    await c.context.close();
  }
  inviteMode = "invalid";
  c = await pageAt();
  await c.page.locator("#mail-connect-invite").click();
  await c.page
    .getByText("Připojovací odkaz se nepodařilo připravit. Zkuste to znovu.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await c.page.locator("#mail-connect-url").inputValue(), "");
  results.push("invalid expiry never produces a usable invitation");
  await c.context.close();
  inviteMode = "delayed";
  c = await pageAt();
  await c.page.locator("#mail-connect-invite").click();
  await c.page.locator("#admin-out").click();
  for (const reply of delayed.splice(0)) reply();
  await c.page.waitForTimeout(150);
  assert.equal(await c.page.locator("#mail-connect-url").inputValue(), "");
  assert.equal(await c.page.locator("#admin-login").isVisible(), true);
  results.push(
    "late invite response cannot restore sensitive DOM after logout",
  );
  await c.context.close();
  inviteMode = "valid";
  status.connected = true;
  c = await pageAt();
  await c.page.locator("#mail-connect-disconnect").click();
  await c.page.getByRole("button", { name: "Zrušit", exact: true }).click();
  assert.equal(disconnects, 0);
  await c.page.locator("#mail-connect-disconnect").click();
  await c.page
    .getByRole("dialog")
    .getByRole("button", { name: "Odpojit schránku", exact: true })
    .click();
  await c.page
    .getByText("Načítání schránky bylo odpojeno. Žádné zprávy se nesmazaly.", {
      exact: true,
    })
    .waitFor();
  assert.equal(disconnects, 1);
  assert.equal(
    await c.page.locator("#mail-connect-disconnect").isVisible(),
    false,
  );
  results.push(
    "disconnect requires confirmation and refreshes connection status",
  );
  await c.context.close();
  status = {
    ...status,
    authMode: "certificate",
    configured: true,
    connectInviteEnabled: true,
    connectConfigured: true,
  };
  c = await pageAt();
  assert.equal(await c.page.locator("#mail-connect-invite").isDisabled(), true);
  assert.ok(
    (await c.page.locator("#mail-connection-status").innerText()).includes(
      "certifikátu",
    ),
  );
  results.push(
    "certificate mode retains its setup and disables invitation flow",
  );
  await c.context.close();
  status = {
    ...status,
    authMode: "delegated",
    configured: true,
    connectConfigured: true,
    connectInviteEnabled: true,
    connected: false,
  };
  const previewOrigin = "https://nadbytecna-admin-test.vercel.app";
  async function previewPage() {
    const context = await browser.newContext({
      viewport: { width: 375, height: 950 },
    });
    await context.addInitScript(
      (t) =>
        sessionStorage.setItem(
          "nadbytecna-admin",
          JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 }),
        ),
      token,
    );
    await context.route("https://**/*", (route) => route.abort());
    await context.route(previewOrigin + "/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        headers = req.headers();
      const response = await fetch(base + u.pathname + u.search, {
        method: req.method(),
        headers: {
          ...(headers.authorization
            ? { authorization: headers.authorization }
            : {}),
          ...(headers["content-type"]
            ? { "content-type": headers["content-type"] }
            : {}),
        },
        body: ["GET", "HEAD"].includes(req.method())
          ? undefined
          : req.postData(),
      });
      await route.fulfill({
        status: response.status,
        contentType:
          response.headers.get("content-type") || "application/octet-stream",
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    const page = await context.newPage();
    await page.goto(previewOrigin + "/admin/");
    await page.locator("#admin-app").waitFor();
    await page.locator("#admin-view-mail").click();
    await page.locator("#mail-connect-invite").waitFor({ state: "visible" });
    return { context, page };
  }
  inviteOrigin = previewOrigin;
  c = await previewPage();
  await c.page.locator("#mail-connect-invite").click();
  await c.page.locator("#mail-connect-link").waitFor();
  assert.equal(
    new URL(await c.page.locator("#mail-connect-url").inputValue()).origin,
    previewOrigin,
  );
  results.push(
    "HTTPS Vercel staging accepts only a link from the same preview origin",
  );
  await c.context.close();
  inviteOrigin = "https://other-admin-test.vercel.app";
  c = await previewPage();
  await c.page.locator("#mail-connect-invite").click();
  await c.page
    .getByText("Připojovací odkaz se nepodařilo připravit. Zkuste to znovu.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await c.page.locator("#mail-connect-url").inputValue(), "");
  results.push("cross-origin Vercel preview invitation rejected");
  await c.context.close();
  inviteOrigin = null;
  assert.equal(publicVisits, 0);
  fs.writeFileSync(
    path.join(root, "docs/admin/mail-connect-admin-results.json"),
    JSON.stringify(
      {
        date: "2026-11-07",
        environment: "synthetic admin invitation UI contract; no OAuth",
        checks: results.length,
        results,
        publicInvitationVisits: 0,
        automaticEmails: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      environment: "synthetic UI contract only; no Microsoft/OAuth calls",
      checks: results.length,
      results,
      publicInvitationVisits: 0,
      automaticEmails: 0,
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => {
    server.closeAllConnections();
    server.close(r);
  });
}
