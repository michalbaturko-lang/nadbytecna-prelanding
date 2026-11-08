// Regression cases for sensitive UI state; use only the offline synthetic server.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { token } from "../tests/helpers/admin-server.mjs";

function freshToken() {
  const parts = token.split(".");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
  claims.session_id = randomUUID();
  return (
    parts[0] +
    "." +
    Buffer.from(JSON.stringify(claims)).toString("base64url") +
    ".synthetic"
  );
}
async function authenticatedContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  await context.addInitScript(
    (t) =>
      sessionStorage.setItem(
        "nadbytecna-admin",
        JSON.stringify({
          access_token: t,
          expires_at: Date.now() + 24 * 3600000,
        }),
      ),
    freshToken(),
  );
  return context;
}
function longWav() {
  const rate = 8000,
    bytes = rate * 180 * 2,
    wav = Buffer.alloc(44 + bytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}
export async function runUiRegressions({
  browser,
  server,
  results,
  sourceOverride,
}) {
  // A workflow change is not a confirmation of AI classification; unchanged values stay absent.
  {
    const context = await authenticatedContext(browser),
      p = await context.newPage();
    if (sourceOverride)
      await p.route("**/admin.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: sourceOverride }),
      );
    const updates = [];
    await p.route("**/api/admin/", async (route) => {
      const data = route.request().postDataJSON();
      if (data.action === "update") updates.push(data.patch);
      await route.continue();
    });
    await p.goto(server.url + "/admin/?sort=urgency");
    await p.locator(".story-card").first().waitFor();
    await p.locator(".card-open").first().click();
    await p.locator("#edit-status").waitFor();
    await p.getByRole("button", { name: "Uložit změny", exact: true }).click();
    await p.getByText("Žádné změny k uložení.", { exact: true }).waitFor();
    assert.equal(updates.length, 0);
    const nextStatus =
      (await p.locator("#edit-status").inputValue()) === "in_progress"
        ? "contacted"
        : "in_progress";
    await p.locator("#edit-status").selectOption(nextStatus);
    await p.getByRole("button", { name: "Uložit změny", exact: true }).click();
    await p.getByText("Změny jsou uložené.", { exact: true }).waitFor();
    assert.deepEqual(updates, [{ status: nextStatus }]);
    results.push({
      label:
        "unchanged save is a no-op; workflow update excludes unchanged classification",
      pass: true,
    });
    await context.close();
  }
  // A slow earlier detail must never replace the record selected later.
  {
    const context = await authenticatedContext(browser),
      p = await context.newPage();
    if (sourceOverride)
      await p.route("**/admin.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: sourceOverride }),
      );
    await p.goto(server.url + "/admin/");
    await p.locator(".story-card").first().waitFor();
    const secondName = await p.locator(".story-card h2").nth(1).innerText();
    let release, started;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    let held = false;
    await p.route("**/api/admin/", async (route) => {
      const data = route.request().postDataJSON();
      if (data.action === "detail" && !held) {
        held = true;
        const response = await route.fetch();
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        await route.fulfill({ response }).catch(() => {});
      } else await route.continue();
    });
    await p.locator(".card-open").first().click();
    await began;
    await p.locator(".card-open").nth(1).click();
    await p
      .locator("#admin-detail h2")
      .filter({ hasText: secondName })
      .waitFor();
    release();
    await p.waitForTimeout(150);
    assert.equal(
      await p.locator("#admin-detail h2").first().innerText(),
      secondName,
    );
    results.push({
      label: "late detail response cannot replace newer selection",
      pass: true,
    });
    await context.close();
  }
  // Signing out aborts and invalidates a response even if its server work has already completed.
  {
    const context = await authenticatedContext(browser),
      p = await context.newPage();
    if (sourceOverride)
      await p.route("**/admin.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: sourceOverride }),
      );
    await p.goto(server.url + "/admin/");
    await p.locator(".story-card").first().waitFor();
    let release, started;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    await p.route("**/api/admin/", async (route) => {
      if (route.request().postDataJSON().action === "detail") {
        const response = await route.fetch();
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        await route.fulfill({ response }).catch(() => {});
      } else await route.continue();
    });
    await p.locator(".card-open").first().click();
    await began;
    await p.locator("#admin-out").click();
    release();
    await p.waitForTimeout(150);
    assert.equal(await p.locator("#admin-login").isVisible(), true);
    assert.equal(await p.locator("#admin-detail").innerText(), "");
    assert.equal(await p.locator(".story-card").count(), 0);
    results.push({
      label: "logout rejects pending protected responses",
      pass: true,
    });
    await context.close();
  }
  // Signing URL lifetime is not recording length. Closing a detail / idle logout clears audio.
  {
    const context = await authenticatedContext(browser),
      p = await context.newPage();
    if (sourceOverride)
      await p.route("**/admin.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: sourceOverride }),
      );
    await p.clock.install();
    await p.route("https://offline.supabase.invalid/storage/**", (route) =>
      route.fulfill({ contentType: "audio/wav", body: longWav() }),
    );
    await p.goto(server.url + "/admin/?sort=urgency");
    await p.locator(".story-card").first().waitFor();
    await p.locator(".card-open").first().click();
    await p.locator("#edit-status").waitFor();
    await p
      .getByRole("button", { name: "Přehrát nahrávku", exact: true })
      .click();
    await p.locator("#admin-detail audio").waitFor();
    const audio = await p.locator("#admin-detail audio").elementHandle();
    await p.waitForFunction(
      () => document.querySelector("#admin-detail audio")?.currentTime > 0,
      null,
      { timeout: 5000 },
    );
    await p.clock.fastForward(121000);
    assert.ok(
      await audio.evaluate((n) => Boolean(n.getAttribute("src"))),
      "audio must retain source after signing TTL",
    );
    await p
      .getByRole("button", { name: "Zpět na přehled", exact: true })
      .click();
    assert.deepEqual(
      await audio.evaluate((n) => ({
        paused: n.paused,
        src: n.getAttribute("src"),
      })),
      { paused: true, src: null },
    );
    await p.locator("#admin-person").click();
    await p
      .locator("#person-tools-email")
      .fill("private-person@example.invalid");
    await p.getByRole("button", { name: "Smazat osobu", exact: true }).click();
    await p.locator("#delete-confirm").waitFor();
    await p.clock.fastForward(12 * 3600000 + 60000);
    assert.equal(await p.locator("#admin-login").isVisible(), true);
    assert.equal(await p.locator("dialog").count(), 0);
    assert.equal(
      await p
        .getByText("private-person@example.invalid", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await p.evaluate(() => sessionStorage.getItem("nadbytecna-admin")),
      null,
    );
    results.push({
      label:
        "long audio survives signing TTL and closes safely; idle logout removes private dialogs",
      pass: true,
    });
    await context.close();
  }
}
