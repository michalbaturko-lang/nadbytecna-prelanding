import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { startAdminServer, token } from "../tests/helpers/admin-server.mjs";
import { runUiRegressions } from "./admin-ui-regressions.mjs";
const s = await startAdminServer();
const b = await chromium.launch({
  ...(process.env.ADMIN_BROWSER_EXECUTABLE
    ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE }
    : { channel: process.env.ADMIN_BROWSER_CHANNEL || "chrome" }),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const axe = fs.readFileSync(
  new URL("../node_modules/axe-core/axe.min.js", import.meta.url),
  "utf8",
);
const results = [];
const errors = [];
async function check(p, label) {
  const r = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    small: [
      ...document.querySelectorAll(
        "button,input,select,textarea,a.action,summary",
      ),
    ]
      .filter((n) => {
        const r = (
          n.type === "checkbox" && n.closest("label") ? n.closest("label") : n
        ).getBoundingClientRect();
        return (
          r.width && r.height && !n.disabled && (r.width < 44 || r.height < 44)
        );
      })
      .map((n) => n.id || n.textContent.slice(0, 50)),
  }));
  assert.ok(r.sw <= r.cw, label + " overflow " + JSON.stringify(r));
  assert.deepEqual(r.small, [], label + " targets");
  await p.addScriptTag({ content: axe });
  const a = await p.evaluate(() =>
    axe.run(document, {
      runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
    }),
  );
  assert.deepEqual(
    a.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    label + " axe",
  );
  results.push({ label, overflow: false, smallTargets: 0, axeViolations: 0 });
}
try {
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    const ctx = await b.newContext({ viewport: { width, height: 950 } });
    await ctx.addInitScript(
      (t) =>
        sessionStorage.setItem(
          "nadbytecna-admin",
          JSON.stringify({
            access_token: t,
            refresh_token: "synthetic",
            expires_at: Date.now() + 3600000,
          }),
        ),
      token,
    );
    await ctx.route(
      "https://offline.supabase.invalid/storage/**",
      async (route) => {
        const req = route.request();
        const response = await s.adapter(req.url(), {
          method: req.method(),
          headers: { Authorization: req.headers().authorization },
        });
        await route.fulfill({
          status: response.status,
          contentType: response.headers.get("content-type") || "audio/wav",
          body: Buffer.from(await response.arrayBuffer()),
        });
      },
    );
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(s.url + "/admin/?sort=urgency");
    await p
      .locator(".story-card")
      .first()
      .waitFor({ timeout: 10000 })
      .catch(async (e) => {
        console.log(
          "browser-debug",
          errors,
          await p.locator("body").innerText(),
        );
        throw e;
      });
    await check(p, width + " list");
    await p.screenshot({
      path: `docs/admin/screenshots/${width}-list.png`,
      fullPage: false,
    });
    await p.getByRole("button", { name: "Filtry", exact: true }).click();
    await p.locator("#filter-q").fill("syntetická");
    await p.waitForTimeout(500);
    assert.ok(!p.url().includes("syntet"));
    await p.locator("#filter-q").fill("");
    await p.waitForTimeout(500);
    await check(p, width + " filters");
    await p.screenshot({
      path: `docs/admin/screenshots/${width}-filters.png`,
      fullPage: false,
    });
    await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "Otevřít zprávu" }).first().click();
    await p.locator("#edit-status").waitFor();
    await check(p, width + " detail");
    assert.equal(
      await p
        .getByRole("button", { name: "Spustit znovu", exact: true })
        .isDisabled(),
      true,
    );
    await p.screenshot({
      path: `docs/admin/screenshots/${width}-detail.png`,
      fullPage: false,
    });
    if (width === 375) {
      await p.locator("#edit-status").selectOption("in_progress");
      await p.getByRole("button", { name: "Uložit změny" }).click();
      await p.waitForTimeout(300);
      assert.equal(await p.locator("#edit-status").inputValue(), "in_progress");
      await p.locator("#new-note").fill("Syntetická poznámka z telefonu.");
      await p.getByRole("button", { name: "Přidat poznámku" }).click();
      await p
        .getByText("Syntetická poznámka z telefonu.", { exact: true })
        .waitFor();
      await p.getByRole("button", { name: "Přehrát nahrávku" }).click();
      await p.locator("#admin-detail audio").waitFor();
      await p.waitForFunction(
        () => document.querySelector("#admin-detail audio")?.currentTime > 0,
        null,
        { timeout: 5000 },
      );
    }
    await ctx.close();
  }
  // Login screen, keyboard focus and no protected records without a session.
  {
    const ctx = await b.newContext({ viewport: { width: 375, height: 850 } });
    const p = await ctx.newPage();
    await p.goto(s.url + "/admin/");
    await check(p, "login");
    assert.equal(await p.locator(".story-card").count(), 0);
    await p.keyboard.press("Tab");
    assert.equal(
      await p.locator(".skip").evaluate((n) => n === document.activeElement),
      true,
    );
    await ctx.close();
  }
  // Public submission regression using real browser controls and anon SQL privileges.
  const ctx = await b.newContext({ permissions: ["microphone"] });
  await ctx.route("https://offline.supabase.invalid/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.includes("/storage/"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    const headers = req.headers();
    const r = await s.adapter(req.url(), {
      method: req.method(),
      headers: { Authorization: headers.authorization },
      body: req.postData(),
    });
    await route.fulfill({
      status: r.status,
      contentType: "application/json",
      body: await r.text(),
    });
  });
  // Side-effect endpoints mocked deliberately: no emails, no AI, no transcription.
  await ctx.route("**/api/notify/", (r) =>
    r.fulfill({ status: 200, body: '{"skipped":true}' }),
  );
  await ctx.route("**/api/triage/", (r) =>
    r.fulfill({ status: 401, body: '{"error":"auth"}' }),
  );
  await ctx.route("**/api/transcribe/", (r) =>
    r.fulfill({ status: 423, body: '{"error":"disabled"}' }),
  );
  const p = await ctx.newPage();
  const tracking = [];
  p.on("request", (r) => {
    if (/googletagmanager|facebook|tiktok|google-analytics/.test(r.url()))
      tracking.push(r.url());
  });
  for (const mode of ["text", "file", "recording"]) {
    await p.goto(s.url + "/sdilet-pribeh/");
    await p.locator("#sdilet-jmeno").fill("Syntetický E2E");
    await p.locator("#sdilet-email").fill(mode + "@example.invalid");
    await p.locator("input[name=share]").first().check();
    await p.locator("#sdilet-gdpr").check();
    await p.locator("#sdilet-age").check();
    if (mode === "text")
      await p
        .locator("#sdilet-text")
        .fill("Výhradně testovací příběh, nikoli skutečná výpověď.");
    if (mode === "file") {
      await p.locator("#tab-file").click();
      await p.locator("#audio-file").setInputFiles({
        name: "synteticky.wav",
        mimeType: "audio/wav",
        buffer: Buffer.alloc(200),
      });
      await p.locator("#sdilet-prepis").check();
    }
    if (mode === "recording") {
      await p.locator("#tab-mic").click();
      await p.locator("#mic-start").click();
      await p.locator("#mic-stop").waitFor();
      await p.waitForTimeout(700);
      await p.locator("#mic-stop").click();
      await p.locator("#mic-player").waitFor();
      await p.locator("#sdilet-prepis").check();
    }
    await p.waitForTimeout(3100);
    await p.locator("#sdilet-send").click();
    await p.locator("#sdilet-thanks").waitFor();
    results.push({ label: "public story " + mode, pass: true });
  }
  await p.goto(s.url + "/mohu-pomoci/");
  await p.locator("#pomoc-jmeno").fill("Syntetický pomocník");
  await p.locator("#pomoc-email").fill("help-e2e@example.invalid");
  await p.locator("input[name=jak]").first().check();
  await p.locator("#pomoc-gdpr").check();
  await p.locator("#pomoc-age").check();
  await p.waitForTimeout(3100);
  await p.locator("#pomoc-send").click();
  await p.locator("#pomoc-thanks").waitFor();
  results.push({ label: "public help offer", pass: true });
  await p.goto(s.url + "/coming-soon/");
  await p.locator("#brzy-email").fill("launch-e2e@example.invalid");
  await p.locator("#brzy-gdpr").check();
  await p.waitForTimeout(3100);
  await p.locator("#brzy-send").click();
  await p.locator("#brzy-thanks").waitFor();
  assert.equal(tracking.length, 0);
  results.push({
    label: "coming soon signup and no tracking before consent",
    pass: true,
  });
  await ctx.close();
  const gdprContext = await b.newContext();
  await gdprContext.addInitScript(
    (t) =>
      sessionStorage.setItem(
        "nadbytecna-admin",
        JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 }),
      ),
    token,
  );
  const gdprPage = await gdprContext.newPage();
  await gdprPage.goto(s.url + "/admin/");
  await gdprPage.locator(".story-card").first().waitFor();
  await gdprPage.locator("#admin-person").click();
  await gdprPage
    .locator("#person-tools-email")
    .fill("launch-e2e@example.invalid");
  const gdprDownload = gdprPage.waitForEvent("download");
  await gdprPage
    .getByRole("button", { name: "Exportovat ZIP", exact: true })
    .click();
  await gdprDownload;
  await gdprPage
    .getByRole("button", { name: "Smazat osobu", exact: true })
    .click();
  await gdprPage.locator("#delete-confirm").fill("SMAZAT");
  await gdprPage
    .getByRole("button", { name: "Smazat osobu", exact: true })
    .click();
  await gdprPage
    .getByText("Údaje osoby byly smazány.", { exact: true })
    .waitFor();
  assert.equal(
    (
      await s.db.query(
        "select count(*)::int n from launch_signups where email='launch-e2e@example.invalid'",
      )
    ).rows[0].n,
    0,
  );
  results.push({
    label: "global GDPR email dialog export and erasure",
    pass: true,
  });
  await gdprContext.close();
  await runUiRegressions({ browser: b, server: s, results });
  assert.deepEqual(errors, []);
  assert.equal(s.metrics.external, 0);
  fs.writeFileSync(
    "docs/admin/browser-results.json",
    JSON.stringify(
      {
        date: "2026-11-07",
        environment:
          "offline synthetic PostgreSQL fixture; not Supabase production",
        results,
        externalCalls: s.metrics.external,
        emailsSent: 0,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Browser checks passed:", results.length);
} finally {
  await b.close();
  await s.close();
}
