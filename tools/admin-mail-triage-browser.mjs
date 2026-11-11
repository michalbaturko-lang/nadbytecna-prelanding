import {revealControl,revealButton} from './admin-test-ui.mjs';
// Actual admin UI with synthetic HTTP fixtures. No real mailbox or AI provider.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { adminHtml } from "../lib/admin-html.mjs";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const token = "synthetic-triage-only";
const calls = [];
let race = false, globalAi = true;
const seed = () => ({
  id: "11111111-1111-4111-8111-111111111111", revision: 1,
  subject: "Syntetická prosba o pomoc", sender_email: "test@example.invalid",
  last_received_at: "2026-11-10T20:00:00Z", status: "new",
  email_type: "story", category: "potrebuji_pomoc", urgency: "high",
  ai_subtype: "request_help", ai_confidence: "low", ai_review_required: true,
  ai_review_reason: '<img src=x onerror="window.injected=true"> Nejasná aktuálnost.',
  ai_summary: "Pisatel uvádí potřebu pomoci. Aktuálnost okolností má ověřit člověk.",
  ai_help_type: "Ověřit současnou potřebu.", ai_model: "synthetic-model",
  ai_at: "2026-11-10T20:05:00Z", reviewed_revision: null,
  reviewed_at: null, reviewed_email: null,
  ai_scope_approved: false, ai_scope_blocked: false, ai_scope_version: 1,
});
let thread = seed();
const counts = { new: 0, in_progress: 0, acute: 0, waiting: 0, publish: 0, week: 0, month: 0, signups: 0, offers: {} };
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/admin/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(adminHtml());
  }
  if (url.pathname === "/config.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end("window.NADBYTECNA_SUPABASE={};");
  }
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer " + token) { res.statusCode = 401; return res.end('{}'); }
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw || "{}");
    calls.push({ path: url.pathname, ...body });
    if (url.pathname === "/api/admin/") return res.end(JSON.stringify(body.action === "init"
      ? { categories: [{ code: "potrebuji_pomoc", name: "Potřebuji pomoc" }], counts, user: { id: "synthetic", email: "admin@example.invalid" }, aiEnabled: false }
      : { rows: [], total: 0 }));
    if (url.pathname === "/api/admin-mail/") {
      if (body.action === "status") return res.end(JSON.stringify({
        mailbox: "veryvera@nadbytecna.cz", configured: true, syncEnabled: true,
        connected: true, authMode: "delegated", initial_complete: false,
        aiEnabled: globalAi, aiScopeMode: "marked", aiAutomationEnabled: false, lastSyncAt: "2026-11-10T20:00:00Z",
        aiQueue: { queued: 1, processing: 0, failed: 0 },
        triageStats: { unreviewed: thread.reviewed_revision === thread.revision ? 0 : 1, urgent: 1, subtypes: { request_help: 1 } },
      }));
      if (body.action === "list") {
        const f = body.filters || {};
        const reviewed = thread.reviewed_revision === thread.revision;
        const match = (!f.subtype || f.subtype === thread.ai_subtype) &&
          (!f.review || (f.review === "reviewed" ? reviewed : !reviewed));
        return res.end(JSON.stringify({ total: match ? 1 : 0, rows: match ? [thread] : [] }));
      }
      if (body.action === "detail") return res.end(JSON.stringify({
        thread, notes: [], messages: [{ id: "synthetic-message", body_text: "Pouze syntetický test.", sender_email: thread.sender_email, received_at: thread.last_received_at }], message_count: 1,
      }));
      if (body.action === "review") {
        assert.equal(body.id, thread.id);
        assert.equal(typeof body.reviewed, "boolean");
        if (race) { thread.revision++; race = false; }
        if (body.revision !== thread.revision) return res.end(JSON.stringify({ saved: false, reason: "changed" }));
        thread.reviewed_revision = body.reviewed ? body.revision : null;
        thread.reviewed_at = body.reviewed ? new Date().toISOString() : null;
        thread.reviewed_email = body.reviewed ? "admin@example.invalid" : null;
        return res.end(JSON.stringify({ saved: true }));
      }
      if (body.action === "ai_scope") {
        assert.equal(body.id,thread.id);assert.equal(typeof body.approved,"boolean");
        if(body.revision!==thread.revision)return res.end(JSON.stringify({saved:false,reason:"changed"}));
        thread.ai_scope_approved=body.approved;thread.ai_scope_blocked=!body.approved;thread.ai_scope_version++;
        return res.end(JSON.stringify({saved:true}));
      }
    }
    res.statusCode = 400; return res.end('{"error":"action"}');
  }
  const files = { "/admin.js": "src/admin.js", "/admin-pkce.js": "src/admin-pkce.js", "/admin.css": "src/admin.css" };
  const file = path.join(root, files[url.pathname] || "dist" + url.pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream");
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(process.env.ADMIN_BROWSER_EXECUTABLE
  ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE }
  : { channel: process.env.ADMIN_BROWSER_CHANNEL || "chrome" });
const axe = fs.readFileSync(path.join(root, "node_modules/axe-core/axe.min.js"), "utf8");
const results = [];
try {
  for (const width of [375, 1440]) {
    thread = seed(); race = false; globalAi = true;
    const context = await browser.newContext({ viewport: { width, height: 1050 } });
    await context.route("https://**/*", route => route.abort());
    await context.addInitScript(t => sessionStorage.setItem("nadbytecna-admin", JSON.stringify({ access_token: t, expires_at: Date.now() + 3600000 })), token);
    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(url + "/admin/");
    await page.getByRole("button", { name: "E-maily", exact: true }).click();
    await expect(page.locator("#mail-triage-stats")).toContainText("Ke kontrole: 1");
    await expect(page.locator("#mail-sync-status")).toContainText("Historie se ještě načítá");
    await expect(page.locator("#mail-cards")).toContainText(thread.ai_summary);

    await revealButton(page,"Ke kontrole: 1");
    await page.getByRole("button", { name: "Ke kontrole: 1", exact: true }).click();
    await expect(page.locator("#mail-sort")).toHaveValue("newest");
    assert.ok(calls.some(c => c.action === "list" && c.filters.review === "pending" && c.filters.sort === "newest"));
    await page.locator("#mail-filters summary").click();
    await page.locator("#mail-filter-subtype").selectOption("press");
    await expect(page.locator("#mail-cards article")).toHaveCount(0);
    await page.locator("#mail-filter-subtype").selectOption("request_help");
    await expect(page.locator("#mail-cards article")).toHaveCount(1);
    await page.locator("#mail-filter-review").selectOption("reviewed");
    await expect(page.locator("#mail-cards article")).toHaveCount(0);
    await page.locator("#mail-reset").click();
    await expect(page.locator("#mail-cards article")).toHaveCount(1);
    assert.ok(!page.url().includes("pending"));
    await page.getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true }).click();
    await expect(page.locator("#mail-detail .mail-review-reason")).toHaveText(thread.ai_review_reason);
    assert.equal(await page.locator("#mail-detail .mail-review-reason img").count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await revealControl(page.locator("#mail-ai-scope-approved"));
    const runAi=()=>page.getByRole("button",{name:"Spustit AI znovu",exact:true});
    await expect(page.locator("#mail-detail .mail-ai-scope")).toContainText("Rozsah AI: nenastaven");
    await revealButton(page,"Spustit AI znovu");
    await expect(runAi()).toBeDisabled();
    await page.locator("#mail-ai-scope-approved").check();
    await page.getByRole("button",{name:"Uložit rozsah AI",exact:true}).click();
    await expect(page.locator("#mail-detail .mail-ai-scope")).toContainText("Rozsah AI: povoleno");
    await expect(runAi()).toBeEnabled();
    await page.locator("#mail-ai-scope-approved").uncheck();
    await page.getByRole("button",{name:"Uložit rozsah AI",exact:true}).click();
    await expect(page.locator("#mail-detail .mail-ai-scope")).toContainText("Rozsah AI: zablokováno");
    await revealButton(page,"Spustit AI znovu");
    await expect(runAi()).toBeDisabled();
    await page.locator("#mail-ai-scope-approved").check();
    await page.getByRole("button",{name:"Uložit rozsah AI",exact:true}).click();
    await expect(runAi()).toBeEnabled();
    await page.getByRole("button", { name: "Označit jako zkontrolované", exact: true }).click();
    await expect(page.locator("#mail-msg")).toContainText("označený jako zkontrolovaný");
    await expect(page.locator("#mail-detail .mail-human-review")).toContainText("admin@example.invalid");
    await expect(page.locator("#mail-triage-stats")).toContainText("Ke kontrole: 0");
    // Human review does not erase the AI's independent uncertainty signal.
    await expect(page.locator("#mail-detail")).toContainText("AI upozorňuje na potřebu lidského posouzení.");
    await page.getByRole("button", { name: "Vrátit ke kontrole", exact: true }).click();
    await expect(page.locator("#mail-msg")).toContainText("znovu ke kontrole");
    assert.equal(thread.reviewed_revision, null);
    race = true;
    await page.getByRole("button", { name: "Označit jako zkontrolované", exact: true }).click();
    await expect(page.locator("#mail-msg")).toContainText("Mezitím se změnil obsah");
    await expect(page.getByRole("button", { name: "Označit jako zkontrolované", exact: true })).toBeEnabled();
    assert.equal(thread.ai_scope_approved,true);
    await expect(runAi()).toBeEnabled();
    globalAi=false;
    await page.locator("#mail-refresh").click();
    await page.getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true }).click();
    await expect(page.locator("#mail-detail .mail-ai-scope")).toContainText("Rozsah AI: povoleno");
    await revealButton(page,"Spustit AI znovu");
    await expect(runAi()).toBeDisabled();
    assert.equal(thread.revision, 2); assert.equal(thread.reviewed_revision, null);
    // A later reply independently invalidates an earlier human review.
    await page.getByRole("button", { name: "Označit jako zkontrolované", exact: true }).click();
    await expect(page.locator("#mail-msg")).toContainText("označený jako zkontrolovaný");
    thread.revision++;
    await page.locator("#mail-refresh").click();
    await expect(page.locator("#mail-triage-stats")).toContainText("Ke kontrole: 1");
    await expect(page.locator("#mail-cards")).toContainText("Ke kontrole");
    await page.getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true }).click();
    await expect(page.getByRole("button", { name: "Označit jako zkontrolované", exact: true })).toBeEnabled();
    await page.addScriptTag({ content: axe });
    const report = await page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
    assert.deepEqual(report.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.deepEqual(errors, []);
    results.push({ width, subtypeAndReviewFilters: true, independentHumanReview: true, staleRevisionRejected: true, newReplyNeedsReview: true, aiScopeMarkAndRevoke: true, markingNeverEnablesGlobalAi: true, aiReasonTextOnly: true, axeViolations: 0, overflow: false });
    await context.close();
  }
  console.log(JSON.stringify({ environment: "local synthetic UI only", realModelCalls: 0, realGraphCalls: 0, results }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
