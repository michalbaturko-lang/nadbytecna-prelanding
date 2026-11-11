import {revealControl,revealButton} from './admin-test-ui.mjs';
// Synthetic UI contract checks. No mailbox, Supabase or other external network is used.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { adminHtml } from "../lib/admin-html.mjs";
const root = path.resolve(new URL("../", import.meta.url).pathname);
const token = "synthetic-mail-ui";
let noteCount = 0,
  erased = false,
  delayDetail = false;
const calls = [],
  pending = [];
const thread = {
  id: "11111111-1111-4111-8111-111111111111",
  subject: "Syntetická žádost o právní pomoc",
  sender_name: "Ukázková osoba",
  sender_email: "synthetic@example.invalid",
  last_received_at: "2026-11-07T10:00:00Z",
  status: "new",
  email_type: "story",
  category: "pravni",
  urgency: "high",
  admin_category: null,
  admin_urgency: null,
  ai_summary: null,
};
const messages = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    sender_name: thread.sender_name,
    sender_email: thread.sender_email,
    received_at: thread.last_received_at,
    body_text:
      "SYNTHETIC_MAIL_SECRET\nPouze testovací příběh. <script>window.injected=true</script>",
  },
];
const counts = {
  new: 0,
  in_progress: 0,
  acute: 0,
  waiting: 0,
  publish: 0,
  week: 0,
  month: 0,
  signups: 0,
  offers: { pravni: 0, pribeh: 0 },
};
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  if (u.pathname === "/admin/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(adminHtml());
  }
  if (u.pathname === "/config.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end("window.NADBYTECNA_SUPABASE={};");
  }
  if (u.pathname.startsWith("/api/")) {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    calls.push({ path: u.pathname, ...body });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer " + token) {
      res.statusCode = 401;
      return res.end('{"error":"auth"}');
    }
    if (u.pathname === "/api/admin/") {
      if (body.action === "init")
        return res.end(
          JSON.stringify({
            categories: [
              { code: "pravni", name: "Právní pomoc" },
              { code: "pribeh", name: "Příběh" },
            ],
            counts,
            user: { id: "admin", email: "admin@example.invalid" },
            aiEnabled: false,
          }),
        );
      return res.end(
        JSON.stringify(
          body.action === "list" ? { rows: [], total: 0 } : { ok: true },
        ),
      );
    }
    if (u.pathname === "/api/admin-mail/") {
      if (body.action === "status")
        return res.end(
          JSON.stringify({
            mailbox: "veryvera@nadbytecna.cz",
            configured: false,
            syncEnabled: false,
            needsSetup: true,
            aiEnabled: false,
            lastSyncAt: null,
            lastError: null,
          }),
        );
      if (body.action === "list")
        return res.end(
          JSON.stringify({
            rows: erased ? [] : [thread],
            total: erased ? 0 : 1,
          }),
        );
      if (body.action === "detail") {
        const reply = () =>
          res.end(
            JSON.stringify({
              thread,
              messages,
              notes: noteCount
                ? [
                    {
                      id: "note",
                      author: "admin@example.invalid",
                      body: "Syntetická poznámka k e-mailu.",
                      created_at: thread.last_received_at,
                    },
                  ]
                : [],
            }),
          );
        if (delayDetail) {
          pending.push(reply);
          return;
        }
        return reply();
      }
      if (body.action === "update") {
        assert.notEqual(body.patch.status, "published");
        Object.assign(thread, body.patch);
        return res.end('{"ok":true}');
      }
      if (body.action === "note") {
        assert.equal(typeof body.text, "string");
        noteCount++;
        return res.end('{"ok":true}');
      }
      if (body.action === "export") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="emailove-vlakno.json"',
        );
        return res.end(JSON.stringify({ thread, messages }));
      }
      if (body.action === "erase") {
        assert.equal(body.confirm, "SMAZAT");
        erased = true;
        return res.end('{"ok":true}');
      }
      if (body.action === "ai") {
        res.statusCode = 423;
        return res.end('{"error":"ai_disabled"}');
      }
    }
    res.statusCode = 400;
    return res.end('{"error":"action"}');
  }
  const files = { "/admin.js": "src/admin.js", "/admin-pkce.js": "src/admin-pkce.js", "/admin.css": "src/admin.css" };
  const relative = files[u.pathname] || "dist" + u.pathname;
  const target = path.join(root, relative);
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
const url = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(
  process.env.ADMIN_BROWSER_EXECUTABLE
    ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE }
    : { channel: process.env.ADMIN_BROWSER_CHANNEL || "chrome" },
);
const results = [];
const screenshotDir = process.env.MAIL_UI_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
const axe = fs.readFileSync(
  path.join(root, "node_modules/axe-core/axe.min.js"),
  "utf8",
);
try {
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
    });
    await context.route("https://**/*", (route) => route.abort());
    await context.addInitScript(
      (t) =>
        sessionStorage.setItem(
          "nadbytecna-admin",
          JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 }),
        ),
      token,
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "/admin/");
    await page.locator("#admin-app").waitFor();
    await page.locator("#admin-view-mail").click();
    await page
      .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
      .waitFor();
    await revealControl(page.locator("#mail-sync-status"));
    assert.ok(
      (await page.locator("#mail-sync-status").innerText()).includes("čeká"),
    );
    await page.locator("#mail-settings > summary").click();
    if (screenshotDir && [375, 1440].includes(width))
      await page.screenshot({
        path: path.join(screenshotDir, width + "-mail-list.png"),
      });
    if (width === 375) {
      await page.locator("#mail-filters summary").click();
      await page.locator("#mail-search").fill("SYNTHETIC_SEARCH_PRIVATE");
      await page.waitForTimeout(400);
      assert.ok(!page.url().includes("SYNTHETIC_SEARCH_PRIVATE"));
      await page.locator("#mail-reset").click();
    }
    await page
      .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
      .click();
    await page.locator("#mail-edit-status").waitFor();
    assert.equal(
      await page.locator('#mail-edit-status option[value="published"]').count(),
      0,
    );
    await revealButton(page,"Spustit AI nad e-mailem");
    assert.equal(
      await page
        .getByRole("button", { name: "Spustit AI nad e-mailem", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .locator("script")
        .filter({ hasText: "window.injected=true" })
        .count(),
      0,
    );
    if (screenshotDir && [375, 1440].includes(width))
      await page.screenshot({
        path: path.join(screenshotDir, width + "-mail-detail.png"),
      });
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(geometry.scroll <= geometry.width, width + " mail overflow");
    await page.addScriptTag({ content: axe });
    const accessibility = await page.evaluate(() =>
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
      width + " mail axe",
    );
    results.push({ width, detail: true, overflow: false, axeViolations: 0 });
    if (width === 375) {
      await page.locator("#mail-edit-status").selectOption("in_progress");
      await page
        .getByRole("button", { name: "Uložit zařazení e-mailu", exact: true })
        .click();
      await page
        .getByText("Zařazení místní kopie e-mailu je uložené.", { exact: true })
        .waitFor();
      assert.equal(thread.status, "in_progress");
      await revealControl(page.locator("#mail-new-note"));
      await page
        .locator("#mail-new-note")
        .fill("Syntetická poznámka k e-mailu.");
      await page
        .getByRole("button", { name: "Přidat poznámku k e-mailu", exact: true })
        .click();
      await page
        .getByText("Syntetická poznámka k e-mailu.", { exact: true })
        .waitFor();
      await revealButton(page,"Exportovat místní vlákno (JSON)");
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: "Exportovat místní vlákno (JSON)",
          exact: true,
        })
        .click();
      await download;
    }
    await page.locator("#admin-view-stories").click();
    assert.equal(await page.locator("#admin-mail").isVisible(), false);
    assert.equal(await page.locator("#mail-detail").innerText(), "");
    await page.locator("#admin-view-mail").click();
    await page
      .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
      .waitFor();
    if (width === 1920) {
      delayDetail = true;
      await page
        .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
        .click();
      await page.locator("#admin-out").click();
      for (const reply of pending.splice(0)) reply();
      await page.waitForTimeout(150);
      assert.equal(await page.locator("#admin-login").isVisible(), true);
      assert.equal(await page.locator("#mail-detail").innerText(), "");
      assert.equal(await page.locator("#mail-cards").innerText(), "");
      delayDetail = false;
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const context = await browser.newContext();
  await context.addInitScript(
    (t) =>
      sessionStorage.setItem(
        "nadbytecna-admin",
        JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 }),
      ),
    token,
  );
  const page = await context.newPage();
  await page.goto(url + "/admin/");
  await page.locator("#admin-view-mail").click();
  await page
    .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
    .click();
  await revealButton(page,"Smazat místní kopii vlákna");
  await page
    .getByRole("button", { name: "Smazat místní kopii vlákna", exact: true })
    .click();
  await page.locator("#mail-erase-confirm").fill("SMAZAT");
  await page
    .getByRole("button", { name: "Smazat místní kopii", exact: true })
    .click();
  await page
    .getByText(
      "Místní kopie vlákna byla smazána. Zprávy ve schránce Microsoft 365 zůstaly beze změny.",
      { exact: true },
    )
    .waitFor();
  assert.equal(erased, true);
  await context.close();
  assert.equal(
    calls.filter((c) => c.path === "/api/admin-mail/" && c.action === "ai")
      .length,
    0,
  );
  console.log(
    JSON.stringify({
      mailUiChecks: results,
      mutations: ["update", "note", "export", "erase"],
      logoutRace: "PASS",
      aiCalls: 0,
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => {
    server.closeAllConnections();
    server.close(r);
  });
}
