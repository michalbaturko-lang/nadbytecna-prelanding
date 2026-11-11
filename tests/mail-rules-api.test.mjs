import test from "node:test";
import assert from "node:assert/strict";
import { startAdminServer, token, otherToken } from "./helpers/admin-server.mjs";

let s, id, revision;
test.before(async () => { s = await startAdminServer(); });
test.after(async () => { await s?.close(); });
const call = (body, bearer = token, path = "/api/admin-mail/") => s.fetch(s.url + path, { method: "POST", headers: {
  "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
}, body: JSON.stringify(body) });

test("rule labels use the existing admin boundary and validate labels, dispositions and revision", async () => {
  assert.equal((await call({ action: "labels", id: "bad" }, "")).status, 401);
  assert.equal((await call({ action: "labels", id: "bad" }, otherToken)).status, 403);
  const status = await (await call({ action: "status" })).json();
  assert.equal(status.rulesEnabled, true);
  assert.equal(status.labelCatalog.length, 18);
  assert.ok(status.labelCatalog.every(label => Object.keys(label).sort().join(",") === "code,name"));
  const list = await (await call({ action: "list", filters: {} })).json();
  id = list.rows[0].id; revision = list.rows[0].revision;
  for (const patch of [
    { revision: 0 }, { revision: 2147483648 }, { add: ["constructor"] }, { remove: ["unknown"] },
    { add: ["legal"], remove: ["legal"] }, { disposition: "delete" }, { add: "legal" },
  ]) assert.equal((await call({ action: "labels", id, revision, add: [], remove: [], ...patch })).status, 400);
  assert.equal((await call({ action: "list", filters: { label: "unknown" } })).status, 400);
  assert.equal((await call({ action: "list", filters: { disposition: "delete" } })).status, 400);
});

test("existing minute cron backfills local labels while import is disabled, without Microsoft or AI calls", async () => {
  const before = { external: s.metrics.external, ai: s.metrics.ai };
  const response = await call({}, process.env.CRON_SECRET, "/api/mail-sync/");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.skipped, true);
  assert.equal(data.rules.saved, 1);
  assert.equal(s.metrics.external, before.external);
  assert.equal(s.metrics.ai, before.ai);
  const second = await (await call({}, process.env.CRON_SECRET, "/api/mail-sync/")).json();
  assert.equal(second.rules.saved, 0);
  assert.equal(second.rules.empty, true);
  const detail = await (await call({ action: "detail", id })).json();
  assert.ok(detail.thread.labels.length > 0);
  assert.ok(detail.thread.labels.every(label => label.source === "rule"));
});

test("manual label and restoration persist, list filters reflect them, and stale decisions reject", async () => {
  let r = await call({ action: "labels", id, revision, add: ["legal"], remove: [], disposition: "suspect" });
  assert.equal(r.status, 200);
  let list = await (await call({ action: "list", filters: { label: "legal", disposition: "suspect" } })).json();
  assert.equal(list.total, 1);
  let row = list.rows[0];
  assert.equal(row.disposition, "suspect");
  assert.ok(row.labels.some(label => label.code === "legal" && label.source === "manual"));
  assert.equal((await (await call({ action: "list", filters: { disposition: "normal" } })).json()).total, 0);
  r = await call({ action: "labels", id, revision, add: [], remove: ["legal"], disposition: "normal" });
  assert.equal(r.status, 200);
  list = await (await call({ action: "list", filters: { disposition: "normal" } })).json();
  assert.equal(list.total, 1);
  assert.ok(!list.rows[0].labels.some(label => label.code === "legal"));
  await s.db.query("UPDATE public.email_threads SET revision=revision+1 WHERE id=$1", [id]);
  r = await call({ action: "labels", id, revision, add: [], remove: [], disposition: "suspect" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "mail_changed");
  const detail = await (await call({ action: "detail", id })).json();
  assert.equal(detail.thread.disposition, "normal");
  assert.equal(detail.thread.disposition_source, "manual");
});
