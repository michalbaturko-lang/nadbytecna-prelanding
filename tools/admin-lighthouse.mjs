// Lighthouse accessibility snapshots of the authenticated synthetic admin.
import fs from "node:fs";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { snapshot } from "lighthouse";
import { startAdminServer, token } from "../tests/helpers/admin-server.mjs";
const s = await startAdminServer();
const browser = await puppeteer.launch({
  executablePath: process.env.ADMIN_BROWSER_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const [name, width] of [
    ["mobile", 375],
    ["desktop", 1440],
  ]) {
    const p = await browser.newPage();
    await p.setViewport({ width, height: 950 });
    await p.evaluateOnNewDocument(
      (t) =>
        sessionStorage.setItem(
          "nadbytecna-admin",
          JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 }),
        ),
      token,
    );
    await p.goto(s.url + "/admin/?sort=urgency");
    await p.waitForSelector(".story-card");
    for (const state of ["list", "detail"]) {
      if (state === "detail") {
        await p.click(".card-open");
        await p.waitForSelector("#edit-status");
      }
      const result = await snapshot(p, {
        config: {
          extends: "lighthouse:default",
          settings: {
            onlyCategories: ["accessibility"],
            formFactor: name === "mobile" ? "mobile" : "desktop",
            screenEmulation: { disabled: true },
          },
        },
      });
      const score = result.lhr.categories.accessibility.score * 100;
      assert.ok(score >= 95, name + " " + state + " " + score);
      fs.writeFileSync(
        `docs/admin/lighthouse-${name}-${state}.json`,
        JSON.stringify(
          {
            date: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" }),
            lighthouseVersion: result.lhr.lighthouseVersion,
            environment: "offline synthetic authenticated admin",
            mode: "snapshot",
            viewport: width,
            score,
            audits: Object.fromEntries(
              Object.entries(result.lhr.audits)
                .filter(([k, v]) => v.score !== null)
                .map(([k, v]) => [k, { score: v.score, title: v.title }]),
            ),
          },
          null,
          2,
        ) + "\n",
      );
      results.push({ name, state, score });
    }
    await p.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await s.close();
}
