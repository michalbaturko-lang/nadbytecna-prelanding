import fs from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { startAdminServer, token } from "../tests/helpers/admin-server.mjs";
import { STORY } from "../tests/helpers/admin-db.mjs";

const output = process.env.PDF_BROWSER_OUTPUT || "/tmp/nadbytecna-story-pdf-browser";
fs.mkdirSync(output, { recursive: true });
const s = await startAdminServer();
const browser = await chromium.launch(process.env.ADMIN_BROWSER_EXECUTABLE
  ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE } : { channel: "chrome" });
const axe = fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const results = [];
try {
  await s.db.query("UPDATE public.stories SET full_name='PDF ukázka',anonymous=false,input_type='text',audio_path=null,story_text=$2 WHERE id=$1", [STORY,
    "I nový začátek má smysl. Mám co nabídnout.\n\nToto je pouze smyšlený příběh pro ověření exportu. Česká diakritika: příliš žluťoučký kůň.\n\nZkušenosti mají svou hodnotu."]);
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, acceptDownloads: true });
    await context.route("https://**/*", route => route.abort());
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    claims.session_id = randomUUID();
    const sessionToken = token.split(".")[0] + "." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".synthetic";
    await context.addInitScript(t => localStorage.setItem("nadbytecna-admin", JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000, remember_until: Date.now() + 30 * 86400000 })), sessionToken);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(s.url + "/admin/");
    await page.locator("#filter-q").fill("PDF ukázka");
    await expect(page.locator("#admin-cards article")).toHaveCount(1);
    if (width < 1024) await page.locator("#admin-cards .card-open").click();
    const button = page.getByRole("button", { name: "Stáhnout PDF", exact: true });
    await button.waitFor();
    const pending = page.waitForEvent("download");
    await button.click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), "pribeh-" + STORY.slice(0, 8) + ".pdf");
    const bytes = fs.readFileSync(await download.path());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    await expect(button).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.addScriptTag({ content: axe });
    const report = await page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
    assert.deepEqual(report.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    assert.deepEqual(errors, []);
    if ([375, 1440].includes(width)) await page.screenshot({ path: output + "/" + width + "-pdf-button.png" });
    if (width === 1440) {
      // A completed response from a session that has since signed out must never download.
      let release, started;
      const held = new Promise(r => release = r), requested = new Promise(r => started = r);
      await page.route("**/api/admin/", async route => {
        if (route.request().postDataJSON().action !== "story_pdf") return route.continue();
        started(); await held;
        await route.fulfill({ status: 200, contentType: "application/pdf", body: bytes }).catch(() => {});
      });
      let lateDownloads = 0;
      page.on("download", () => lateDownloads++);
      await button.click(); await requested;
      await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
      release(); await page.waitForTimeout(200);
      assert.equal(lateDownloads, 0);
      await expect(page.locator("#admin-login")).toBeVisible();
      assert.equal(await page.locator("#admin-detail").innerText(), "");
      results.push({ logoutDuringExport: "PASS" });
    }
    results.push({ width, download: true, overflow: false, axeViolations: 0 });
    await context.close();
  }
  console.log(JSON.stringify({ environment: "isolated synthetic API/database/browser", results, realEmails: 0, realAiCalls: 0 }));
} finally { await browser.close(); await s.close(); }
