import crypto from "node:crypto";
import { json } from "./http.js";
import { UUID } from "./admin-model.mjs";
import { classifyMail, mailAiEnabled, parseMailClassification } from "./mail-ai.mjs";
import { mailAiAllowUnmarked } from "./mail-ai-scope.mjs";

export const MAIL_AI_BATCH_SIZE = 10;
// Each runtime dependency is bounded: claim <=15 s, scope <=15 s, model <=30 s,
// finish <=15 s. Reserve that full interval before another job, leaving 15 s below the
// 120 s hosting limit. Fast jobs can use the full batch; slow ones stop early.
const RUN_BUDGET_MS = 105000;
const JOB_RESERVE_MS = 75000;

export function mailAiAutomationEnabled(env = process.env) {
  return mailAiEnabled(env) && env.AI_EMAIL_AUTOMATION_ENABLED === "true";
}

const configurationError = () =>
  Object.assign(new Error("mail_ai_worker_configuration"), {
    code: "mail_ai_worker_configuration",
  });

function boundedCodePoints(text, limit) {
  // PostgreSQL length(text) counts Unicode codepoints, not JS UTF-16 units.
  // The preliminary cap also bounds iteration if a malformed RPC is oversized.
  if (typeof text !== "string" || text.length > limit * 2) return -1;
  let count = 0;
  for (const character of text) if (++count > limit) return -1;
  return count;
}

function validJob(job) {
  if (!job || !UUID.test(job.id || "") || !UUID.test(job.lease || "") ||
      !Number.isInteger(job.revision) || job.revision <= 0 ||
      !Array.isArray(job.messages) || job.messages.length === 0 || job.messages.length > 30)
    return false;
  let total = (job.messages.length - 1) * 7; // "\n\n---\n\n" between messages
  for (const message of job.messages) {
    const subject = boundedCodePoints(message?.subject, 512);
    const body = boundedCodePoints(message?.body_text, 20000);
    if (subject < 0 || body < 0) return false;
    total += subject + body + 1; // newline between subject and body
    if (total > 20000) return false;
  }
  return true;
}

/** No Graph calls, no mail sending, no raw content in the returned counters. */
export async function runMailAiWorker({
  env = process.env,
  rpc,
  loadCategories,
  classify = classifyMail,
  now = Date.now,
} = {}) {
  // This must precede reading keys or touching a database/model factory.
  if (!mailAiAutomationEnabled(env)) return { skipped: true };
  try {
    if (typeof env.OPENAI_API_KEY !== "string" || !env.OPENAI_API_KEY.trim() ||
        typeof rpc !== "function" || typeof loadCategories !== "function")
      throw configurationError();
    const started = now();
    const categories = await loadCategories();
    if (!Array.isArray(categories) || !categories.length ||
        !categories.every((c) => typeof c === "string" && /^[a-z_]{1,40}$/.test(c)))
      throw configurationError();
    const counts = { processed: 0, saved: 0, failed: 0, discarded: 0 };
    for (let index = 0; index < MAIL_AI_BATCH_SIZE; index++) {
      if (!mailAiAutomationEnabled(env)) break;
      if (now() - started > RUN_BUDGET_MS - JOB_RESERVE_MS) {
        counts.deadline = true;
        break;
      }
      const allowUnmarked = mailAiAllowUnmarked(env);
      const job = await rpc("mail_ai_claim_scoped", { p_allow_unmarked: allowUnmarked });
      if (!job) {
        counts.empty = true;
        break;
      }
      // Invalid snapshots fail closed without forwarding content or fabricating
      // a finish token. The database owns recovery of expired leases.
      if (!validJob(job)) throw configurationError();
      counts.processed++;
      const scope = await rpc("mail_ai_scope_active", { p_lease: job.lease, p_allow_unmarked: allowUnmarked });
      if (!scope || typeof scope.active !== "boolean") throw configurationError();
      if (!scope.active) { counts.discarded++; continue; }
      let output, modelFailed = false;
      try {
        if (!mailAiAutomationEnabled(env)) break;
        const result = await classify({ messages: job.messages, categories, env });
        output = parseMailClassification(result, categories);
        if (typeof result.model !== "string" || !/^[a-z0-9_.:-]{1,80}$/i.test(result.model))
          throw new Error("mail_ai_invalid_model");
        output.model = result.model;
      } catch {
        // Only the boolean error reaches SQL; exceptions may contain provider
        // payloads, message contents or credentials and must not be persisted.
        modelFailed = true;
        output = {};
      }
      // A failed/ambiguous persistence request must not be retried here or be
      // misreported as an AI error. The lease and revision guard handle recovery.
      const finished = await rpc("mail_ai_finish", {
        p_lease: job.lease,
        p_output: output,
        p_error: modelFailed,
      });
      if (!finished || typeof finished.saved !== "boolean")
        throw new Error("mail_ai_worker_persistence");
      if (!finished.saved) counts.discarded++;
      else if (modelFailed) counts.failed++;
      else counts.saved++;
    }
    return counts;
  } catch (error) {
    if (error?.code === "mail_ai_worker_configuration") throw error;
    throw new Error("mail_ai_worker_failed");
  }
}

function cronAuthorized(req, env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ""));
  const got = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer /, ""));
  return expected.length >= 24 && expected.length === got.length &&
    crypto.timingSafeEqual(expected, got);
}

export function createMailAiWorkerHandler({ env, run } = {}) {
  return async function handler(req, res) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "method" });
    }
    const currentEnv = env || process.env;
    if (!cronAuthorized(req, currentEnv)) return json(res, 401, { error: "auth" });
    if (!mailAiAutomationEnabled(currentEnv)) return json(res, 200, { skipped: true });
    try {
      const result = await run(currentEnv);
      // Response is deliberately a fixed metadata shape, never an RPC object.
      const counters = {};
      for (const field of ["processed", "saved", "failed", "discarded"]) {
        if (!Number.isInteger(result?.[field]) || result[field] < 0 || result[field] > MAIL_AI_BATCH_SIZE)
          throw new Error("mail_ai_worker_result");
        counters[field] = result[field];
      }
      for (const field of ["empty", "deadline"])
        if (result[field] === true) counters[field] = true;
      return json(res, 200, counters);
    } catch (error) {
      return json(res, 503, {
        error: error?.code === "mail_ai_worker_configuration"
          ? "mail_ai_worker_configuration" : "mail_ai_worker_failed",
      });
    }
  };
}
