// Real local PostgreSQL + API + UI. All contacts and mail contents are synthetic.
// Run after the primary agent has built PHASE1 dist with the email UI.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { startAdminServer, token } from "../tests/helpers/admin-server.mjs";
const migration = new URL(
  "../supabase/migrations/20261109000000_admin_mail.sql",
  import.meta.url,
);
assert.ok(
  fs.existsSync(migration) && fs.statSync(migration).size > 0,
  "Email migration must be ready before integration checks",
);
const root = path.resolve(new URL("../", import.meta.url).pathname);
const screenshotDir = path.join(root, "docs/admin/screenshots");
const axe = fs.readFileSync(
  path.join(root, "node_modules/axe-core/axe.min.js"),
  "utf8",
);
const s = await startAdminServer();
const browser = await chromium.launch(
  process.env.ADMIN_BROWSER_EXECUTABLE
    ? { executablePath: process.env.ADMIN_BROWSER_EXECUTABLE }
    : { channel: process.env.ADMIN_BROWSER_CHANNEL || "chrome" },
);
const results = [];
const extended = process.env.MAIL_UI_EXTENDED === "true";
async function check(page, label) {
  const geometry = await page.evaluate(() => ({
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
  assert.ok(geometry.sw <= geometry.cw, label + " overflow");
  assert.deepEqual(geometry.small, [], label + " touch targets");
  await page.addScriptTag({ content: axe });
  const report = await page.evaluate(() =>
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
    label + " axe",
  );
  results.push({ label, overflow: false, smallTargets: 0, axeViolations: 0 });
}
const api = async (body) =>
  s.fetch(s.url + "/api/admin-mail/", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
try {
  const initial = await api({ action: "list", filters: {} });
  assert.equal(initial.status, 200);
  const initialData = await initial.json();
  assert.ok(initialData.rows.length > 0, "synthetic mailbox seed missing");
  const threadId = initialData.rows[0].id;
  if (extended) {
    const lease = (
      await s.db.query(
        "SELECT public.mail_sync_claim($1,'inbox','2026-11-01T00:00:00Z') d",
        ["veryvera@nadbytecna.cz"],
      )
    ).rows[0].d;
    const extraMessages = Array.from({ length: 21 }, (_, i) => ({
      external_id: "synthetic-email-extended-" + i,
      conversation_id: "synthetic-thread-1",
      sender_name: "Ukázková pisatelka",
      sender_email: "pisatelka@example.invalid",
      subject: "Ukázkový e-mail: starší zpráva " + i,
      body_text: "Smyšlená starší zpráva pro test stránkování " + i + ".",
      received_at: new Date(Date.UTC(2026, 10, 5, 12, i)).toISOString(),
      has_attachments: false,
    }));
    await s.db.query(
      "SELECT public.mail_sync_commit($1,$2::jsonb,'[]'::jsonb,$3,true,$4)",
      [
        lease.lease,
        JSON.stringify(extraMessages),
        "https://graph.microsoft.com/v1.0/users/veryvera%40nadbytecna.cz/mailFolders/inbox/messages/delta?$deltatoken=synthetic-extended",
        "synthetic-only-hash-secret-for-local-tests",
      ],
    );
  }
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
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(s.url + "/admin/");
    await page.locator("#admin-app").waitFor();
    await page.locator("#admin-view-mail").click();
    await page
      .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
      .first()
      .waitFor();
    await check(page, width + " email list");
    if ([375, 1440].includes(width))
      await page.screenshot({
        path: path.join(screenshotDir, width + "-mail-list.png"),
      });
    await page.locator("#mail-filters summary").click();
    await check(page, width + " email filters");
    await page.locator("#mail-filters summary").click();
    await page
      .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
      .first()
      .click();
    await page.locator("#mail-edit-status").waitFor();
    assert.equal(
      await page.locator('#mail-edit-status option[value="published"]').count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Spustit AI nad e-mailem", exact: true })
        .isDisabled(),
      true,
    );
    assert.ok(
      (await page.locator("#mail-detail").innerText()).includes(
        "Toto je smyšlený e-mail",
      ),
    );
    await check(page, width + " email detail");
    if ([375, 1440].includes(width))
      await page.screenshot({
        path: path.join(screenshotDir, width + "-mail-detail.png"),
      });
    if (width === 375) {
      if (extended) {
        assert.equal(await page.locator(".mail-message").count(), 20);
        await page
          .getByRole("button", { name: "Starší zprávy", exact: true })
          .click();
        await page.getByText(/Stránka 2 z 2/).waitFor();
        assert.equal(await page.locator(".mail-message").count(), 2);
        await page
          .getByRole("button", { name: "Novější zprávy", exact: true })
          .click();
        await page.getByText(/Stránka 1 z 2/).waitFor();
        assert.equal(await page.locator(".mail-message").count(), 20);
        results.push({
          label: "email thread pagination across 22 messages",
          pass: true,
        });
      }
      await page.locator("#mail-edit-type").selectOption("story");
      await page.locator("#mail-edit-category").selectOption("pravni");
      await page.locator("#mail-edit-urgency").selectOption("high");
      await page.locator("#mail-edit-status").selectOption("in_progress");
      await page
        .getByRole("button", { name: "Uložit zařazení e-mailu", exact: true })
        .click();
      await page
        .getByText("Zařazení místní kopie e-mailu je uložené.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#mail-edit-status").inputValue(),
        "in_progress",
      );
      assert.equal(
        await page.locator("#mail-edit-category").inputValue(),
        "pravni",
      );
      await page
        .locator("#mail-new-note")
        .fill("Syntetická integrační poznámka k e-mailu.");
      await page
        .getByRole("button", { name: "Přidat poznámku k e-mailu", exact: true })
        .click();
      await page
        .getByText("Syntetická integrační poznámka k e-mailu.", { exact: true })
        .waitFor();
      const downloadPromise = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: "Exportovat místní vlákno (JSON)",
          exact: true,
        })
        .click();
      const download = await downloadPromise;
      const location = await download.path();
      assert.ok(location);
      const exported = JSON.parse(fs.readFileSync(location, "utf8"));
      assert.ok(
        JSON.stringify(exported).includes("Syntetická integrační poznámka"),
      );
      results.push({
        label: "email manual classification, note, JSON export",
        pass: true,
      });
      if (extended) {
        await s.db.query(
          "UPDATE public.categories SET active=false WHERE code='pravni'",
        );
        await page.reload();
        await page.locator("#admin-app").waitFor();
        await page.locator("#admin-view-mail").click();
        await page
          .getByRole("button", {
            name: "Otevřít e-mailové vlákno",
            exact: true,
          })
          .first()
          .click();
        await page.locator("#mail-edit-status").waitFor();
        assert.equal(
          await page.locator("#mail-edit-category").inputValue(),
          "pravni",
        );
        assert.ok(
          (
            await page
              .locator('#mail-edit-category option[value="pravni"]')
              .innerText()
          ).includes("neaktivní"),
        );
        await page.locator("#mail-edit-status").selectOption("contacted");
        await page
          .getByRole("button", { name: "Uložit zařazení e-mailu", exact: true })
          .click();
        await page
          .getByText("Zařazení místní kopie e-mailu je uložené.", {
            exact: true,
          })
          .waitFor();
        const preserved = await (
          await api({ action: "detail", id: threadId })
        ).json();
        assert.equal(preserved.thread.admin_category, "pravni");
        assert.equal(preserved.thread.status, "contacted");
        await s.db.query(
          "UPDATE public.categories SET active=true WHERE code='pravni'",
        );
        results.push({
          label: "inactive email category preserved during status-only save",
          pass: true,
        });
      }
    }
    await page.locator("#admin-view-stories").click();
    assert.equal(await page.locator("#mail-detail").innerText(), "");
    assert.equal(await page.locator("#mail-cards").innerText(), "");
    assert.deepEqual(errors, []);
    await context.close();
  }
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
  const page = await context.newPage();
  await page.goto(s.url + "/admin/");
  await page.locator("#admin-view-mail").click();
  await page
    .getByRole("button", { name: "Otevřít e-mailové vlákno", exact: true })
    .first()
    .click();
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
  assert.equal(
    (await (await api({ action: "list", filters: {} })).json()).total,
    0,
  );
  const gone = await api({ action: "detail", id: threadId });
  assert.notEqual(gone.status, 200);
  results.push({ label: "email local-only erasure", pass: true });
  await context.close();
  assert.equal(s.metrics.external, 0);
  assert.equal(s.metrics.mail, 0);
  assert.equal(s.metrics.ai, 0);
  assert.equal(s.metrics.graph, 0);
  assert.equal(s.metrics.oauth, 0);
  console.log(
    JSON.stringify({
      environment: "offline synthetic real local PostgreSQL + API + UI",
      results,
      checks: results.length,
      externalCalls: 0,
      realEmailsSent: 0,
      realOpenAICalls: 0,
    }),
  );
} finally {
  await browser.close();
  await s.close();
}
