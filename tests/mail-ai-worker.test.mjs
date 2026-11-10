import test from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_AI_BATCH_SIZE,
  mailAiAutomationEnabled,
  runMailAiWorker,
  createMailAiWorkerHandler,
} from "../lib/mail-ai-worker.mjs";
import { classifyMail } from "../lib/mail-ai.mjs";

const env = () => ({
  AI_TRIAGE_ENABLED: "true",
  AI_EMAIL_CLASSIFICATION_ENABLED: "true",
  AI_EMAIL_PROCESSING_APPROVED: "true",
  AI_EMAIL_AUTOMATION_ENABLED: "true",
  CRON_SECRET: "synthetic-cron-secret-at-least-24-characters",
  OPENAI_API_KEY: "synthetic-test-only",
});
const valid = {
  email_type: "story", category: "pravni", urgency: "high",
  summary: "Pisatel uvádí problém vyžadující osobní ověření.",
  help_type: "Prověřit potřebu právní pomoci.", model: "gpt-4o-mini",
};
const job = (number = 1) => ({
  id: "10000000-0000-4000-8000-" + String(number).padStart(12, "0"),
  lease: "20000000-0000-4000-8000-" + String(number).padStart(12, "0"),
  revision: number,
  messages: [{ subject: "Syntetický test", body_text: "Pouze vymyšlená zpráva." }],
});
function fixture(jobs = [job()], changes = {}) {
  const metrics = { categories: 0, model: 0, calls: [] };
  const queue = [...jobs];
  return {
    metrics,
    options: {
      env: env(),
      loadCategories: async () => { metrics.categories++; return ["pravni", "prace"]; },
      classify: async () => { metrics.model++; return valid; },
      rpc: async (name, payload) => {
        metrics.calls.push({ name, payload });
        if (name === "mail_ai_claim") return queue.shift() || null;
        assert.equal(name, "mail_ai_finish");
        return { saved: true };
      },
      ...changes,
    },
  };
}
async function httpCall(handler, { method = "GET", authorization = "Bearer " + env().CRON_SECRET } = {}) {
  const headers = {};
  let body;
  const res = {
    statusCode: 200,
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    end: (text) => { body = JSON.parse(text); },
  };
  await handler({ method, headers: { authorization } }, res);
  return { status: res.statusCode, headers, body };
}

test("automatic mail AI requires every independent approval and the automation switch", async () => {
  for (const key of ["AI_TRIAGE_ENABLED", "AI_EMAIL_CLASSIFICATION_ENABLED", "AI_EMAIL_PROCESSING_APPROVED", "AI_EMAIL_AUTOMATION_ENABLED"]) {
    for (const disabled of [undefined, "false", "TRUE", "yes", ""]) {
      // Global AI intentionally shares the existing normalisation rules.
      if (key === "AI_TRIAGE_ENABLED" && disabled === "TRUE") continue;
      const state = { ...env(), [key]: disabled };
      Object.defineProperty(state, "OPENAI_API_KEY", { get() { throw new Error("key touched while disabled"); } });
      const f = fixture([job()], { env: state });
      assert.equal(mailAiAutomationEnabled(state), false);
      assert.deepEqual(await runMailAiWorker(f.options), { skipped: true });
      assert.deepEqual(f.metrics, { categories: 0, model: 0, calls: [] });
    }
  }
});

test("missing key or categories does not consume a queue attempt", async () => {
  for (const key of [undefined, "", "   ", 42]) {
    const missingKey = fixture([job()], { env: { ...env(), OPENAI_API_KEY: key } });
    await assert.rejects(runMailAiWorker(missingKey.options), /configuration/);
    assert.deepEqual(missingKey.metrics, { categories: 0, model: 0, calls: [] });
  }
  for (const categories of [[], null, ["injected)"], [null]]) {
    const f = fixture([job()], { loadCategories: async () => categories });
    await assert.rejects(runMailAiWorker(f.options), /configuration/);
    assert.equal(f.metrics.calls.length, 0);
    assert.equal(f.metrics.model, 0);
  }
});

test("empty mail queue reads no messages or model and returns only counters", async () => {
  const f = fixture([]);
  assert.deepEqual(await runMailAiWorker(f.options), { processed: 0, saved: 0, failed: 0, discarded: 0, empty: true });
  assert.equal(f.metrics.model, 0);
  assert.deepEqual(f.metrics.calls, [{ name: "mail_ai_claim", payload: {} }]);
});

test("three sequential threads maximum; accepted output excludes any extra provider fields", async () => {
  let active = 0;
  const f = fixture([job(1), job(2), job(3), job(4)], {
    classify: async ({ categories, messages, env: config }) => {
      assert.equal(active++, 0);
      assert.deepEqual(categories, ["pravni", "prace"]);
      assert.equal(config.OPENAI_API_KEY, "synthetic-test-only");
      assert.equal(messages.length, 1);
      await Promise.resolve();
      active--;
      return { ...valid, private_provider_debug: "must not persist" };
    },
  });
  assert.deepEqual(await runMailAiWorker(f.options), { processed: 3, saved: 3, failed: 0, discarded: 0 });
  const finishes = f.metrics.calls.filter((c) => c.name === "mail_ai_finish");
  assert.equal(finishes.length, MAIL_AI_BATCH_SIZE);
  assert.deepEqual(finishes.map((c) => c.payload.p_lease), [job(1).lease, job(2).lease, job(3).lease]);
  for (const c of finishes) assert.deepEqual(c.payload.p_output, valid);
});

test("slow run stops before claiming another minute of work near the hosting deadline", async () => {
  let milliseconds = 0;
  const f = fixture([job(1), job(2), job(3)], {
    now: () => milliseconds,
    classify: async () => { milliseconds += 46000; return valid; },
  });
  const result = await runMailAiWorker(f.options);
  assert.equal(result.processed, 1);
  assert.equal(result.deadline, true);
  assert.equal(f.metrics.calls.filter((c) => c.name === "mail_ai_claim").length, 1);
});

test("timeout and malformed classifications finish one error attempt with no private exception", async () => {
  for (const classify of [
    async () => { throw new DOMException("PRIVATE CONTENT / credential", "TimeoutError"); },
    async () => ({ ...valid, category: "invalid" }),
    async () => ({ ...valid, model: "untrusted model with whitespace" }),
  ]) {
    const f = fixture([job()], { classify });
    const result = await runMailAiWorker(f.options);
    assert.equal(result.failed, 1);
    assert.equal(result.saved, 0);
    const finishes = f.metrics.calls.filter((c) => c.name === "mail_ai_finish");
    assert.deepEqual(finishes, [{ name: "mail_ai_finish", payload: { p_lease: job().lease, p_output: {}, p_error: true } }]);
    assert.ok(!JSON.stringify({ result, finishes }).includes("PRIVATE"));
  }
});

test("stale revision, deleted thread or manual winner is discarded according to SQL guard", async () => {
  for (const reason of ["changed", "missing", "classified"]) {
    let claimed = false;
    const f = fixture([job()], {
      rpc: async (name) => {
        if (name !== "mail_ai_claim") return { saved: false, reason };
        if (claimed) return null;
        claimed = true;
        return job();
      },
    });
    const result = await runMailAiWorker(f.options);
    assert.equal(result.saved, 0);
    assert.equal(result.discarded, 1);
  }
});

test("successful model followed by failed finish never calls failure finish or model again", async () => {
  const calls = [];
  const f = fixture([job()], {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      if (name === "mail_ai_claim") return job();
      throw new Error("PRIVATE FINISH ERROR / secret");
    },
  });
  await assert.rejects(runMailAiWorker(f.options), /^Error: mail_ai_worker_failed$/);
  assert.equal(f.metrics.model, 1);
  assert.deepEqual(calls.map((c) => c.name), ["mail_ai_claim", "mail_ai_finish"]);
  assert.equal(calls[1].payload.p_error, false);
});

test("model failure followed by failed error persistence also stops immediately", async () => {
  const calls = [];
  const f = fixture([job()], {
    classify: async () => { throw new Error("synthetic timeout"); },
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      if (name === "mail_ai_claim") return job();
      throw new Error("storage unavailable");
    },
  });
  await assert.rejects(runMailAiWorker(f.options), /^Error: mail_ai_worker_failed$/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].payload.p_error, true);
});

test("malformed claimed content fails closed without using a model or fabricated lease", async () => {
  for (const invalid of [
    { ...job(), lease: "invalid" }, { ...job(), revision: 0 },
    { ...job(), messages: [] }, { ...job(), messages: Array(31).fill(job().messages[0]) },
    { ...job(), messages: [{ subject: "x", body_text: "x".repeat(20001) }] },
  ]) {
    const f = fixture([invalid]);
    await assert.rejects(runMailAiWorker(f.options), /configuration/);
    assert.equal(f.metrics.model, 0);
    assert.equal(f.metrics.calls.length, 1);
  }
});

test("HTTP rejects unauthorized access before touching flags or worker dependencies", async () => {
  const config = new Proxy({ CRON_SECRET: env().CRON_SECRET }, {
    get(target, key) { if (key !== "CRON_SECRET") throw new Error("flags accessed before auth"); return target[key]; },
  });
  let runs = 0;
  const handler = createMailAiWorkerHandler({ env: config, run: async () => { runs++; } });
  for (const authorization of [undefined, "", "Bearer wrong", "Bearer " + "€".repeat(50)]) {
    const r = await httpCall(handler, { authorization: authorization === undefined ? null : authorization });
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: "auth" });
  }
  const put = await httpCall(handler, { method: "PUT" });
  assert.equal(put.status, 405);
  assert.equal(put.headers.allow, "GET, POST");
  assert.equal(runs, 0);
});

test("authorized disabled HTTP worker returns skipped without invoking its core", async () => {
  let runs = 0;
  const handler = createMailAiWorkerHandler({ env: { ...env(), AI_EMAIL_PROCESSING_APPROVED: "false" }, run: async () => { runs++; } });
  for (const method of ["GET", "POST"]) {
    const r = await httpCall(handler, { method });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { skipped: true });
    assert.equal(r.headers["cache-control"], "no-store");
    assert.match(r.headers["x-robots-tag"], /noindex/);
  }
  assert.equal(runs, 0);
});

test("enabled HTTP exposes only bounded counters, and provider or database errors remain private", async () => {
  const handler = createMailAiWorkerHandler({ env: env(), run: async () => ({ processed: 1, saved: 1, failed: 0, discarded: 0, private_text: "SECRET MESSAGE" }) });
  const r = await httpCall(handler);
  assert.deepEqual(r.body, { processed: 1, saved: 1, failed: 0, discarded: 0 });
  for (const run of [
    async () => { throw new Error("PRIVATE TOKEN AND CONTENT"); },
    async () => ({ processed: 1000, saved: 1000, failed: 0, discarded: 0 }),
    async () => { throw Object.assign(new Error("PRIVATE"), { code: "mail_ai_worker_configuration" }); },
  ]) {
    const result = await httpCall(createMailAiWorkerHandler({ env: env(), run }));
    assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  }
});

test("worker's explicit approved environment reaches the guarded real classifier with a fake transport", async () => {
  let modelCalls = 0;
  const f = fixture([job()], {
    classify: (options) => classifyMail({
      ...options,
      fetcher: async (url, init) => {
        modelCalls++;
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        assert.equal(JSON.parse(init.body).store, false);
        return Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] });
      },
    }),
  });
  const result = await runMailAiWorker(f.options);
  assert.equal(modelCalls, 1);
  assert.equal(result.saved, 1);
});

test("PostgreSQL-sized emoji snapshot reaches the real classifier unchanged at the codepoint boundary", async () => {
  const subject = "🙂".repeat(512);
  const body = "🙂".repeat(19480);
  assert.ok(body.length > 20000, "UTF-16 length reproduces the old rejection");
  let modelCalls = 0;
  const f = fixture([{ ...job(), messages: [{ subject, body_text: body }] }], {
    classify: (options) => classifyMail({
      ...options,
      fetcher: async (url, init) => {
        modelCalls++;
        const sent = JSON.parse(init.body).messages[1].content;
        assert.equal(sent, subject + "\n" + body);
        assert.equal([...sent].length, 19993);
        assert.ok(Buffer.byteLength(sent, "utf8") <= 80000);
        return Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] });
      },
    }),
  });
  assert.equal((await runMailAiWorker(f.options)).saved, 1);
  assert.equal(modelCalls, 1);
});

test("oversized Unicode subject, body or combined snapshot is rejected before model transport", async () => {
  for (const messages of [
    [{ subject: "🙂".repeat(513), body_text: "test" }],
    [{ subject: "", body_text: "🙂".repeat(20001) }],
    [{ subject: "x", body_text: "🙂".repeat(19999) }],
    [{ subject: "", body_text: "🙂".repeat(10000) }, { subject: "", body_text: "🙂".repeat(10000) }],
  ]) {
    const f = fixture([{ ...job(), messages }]);
    await assert.rejects(runMailAiWorker(f.options), /configuration/);
    assert.equal(f.metrics.model, 0);
    assert.equal(f.metrics.calls.length, 1);
  }
});

test("direct classifier Unicode truncation retains complete newest codepoints", async () => {
  await classifyMail({
    env: env(), categories: ["pravni"],
    messages: [{ subject: "", body_text: "🙂".repeat(20000) + "尾" }],
    fetcher: async (url, init) => {
      const sent = JSON.parse(init.body).messages[1].content;
      assert.equal(sent, "🙂".repeat(19999) + "尾");
      assert.equal([...sent].length, 20000);
      return Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] });
    },
  });
});
