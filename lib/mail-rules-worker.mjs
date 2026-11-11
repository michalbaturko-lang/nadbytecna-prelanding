import { UUID } from "./admin-model.mjs";
import { createHash } from "node:crypto";
import { blockedMailSenders, classifyMailRules, mailRulesEnabled, MAIL_RULES_VERSION } from "./mail-rules.mjs";

export const MAIL_RULES_BATCH_SIZE = 25;
const RUN_BUDGET_MS = 45000, APPLY_RESERVE_MS = 15000;
function validJob(job) {
  return job && UUID.test(job.id || "") && Number.isSafeInteger(job.revision) && job.revision > 0 &&
    Number.isSafeInteger(job.message_count) && job.message_count > 0 && typeof job.context_truncated === "boolean" &&
    Array.isArray(job.messages) && job.messages.length > 0 && job.messages.length <= 10 &&
    job.messages.every(message => typeof message.subject === "string" && message.subject.length <= 1024 &&
      typeof message.body_text === "string" && message.body_text.length <= 40000 &&
      (message.sender_email == null || typeof message.sender_email === "string" && message.sender_email.length <= 254)) &&
    job.messages.reduce((size, message) => size + Array.from(message.body_text).length + Array.from(message.subject).length, 0) <= 20512;
}

// No Graph/model calls, no sending/deleting and no source text in results or errors.
export async function runMailRules({ env = process.env, rpc, now = Date.now } = {}) {
  if (!mailRulesEnabled(env)) return { skipped: true };
  const started = now();
  const blockedSenders = blockedMailSenders(env);
  const version = blockedSenders.length ? MAIL_RULES_VERSION + "." + createHash("sha256").update([...blockedSenders].sort().join("\n")).digest("hex").slice(0, 12) : MAIL_RULES_VERSION;
  const counts = { processed: 0, saved: 0, stale: 0, failed: 0 };
  if (typeof rpc !== "function") throw new Error("mail_rules_configuration");
  const pending = await rpc("mail_rules_pending", { p_limit: MAIL_RULES_BATCH_SIZE, p_version: version });
  if (!pending || !Array.isArray(pending.jobs) || pending.jobs.length > MAIL_RULES_BATCH_SIZE)
    throw new Error("mail_rules_configuration");
  for (const job of pending.jobs) {
    if (!mailRulesEnabled(env)) break;
    if (now() - started >= RUN_BUDGET_MS - APPLY_RESERVE_MS) { counts.deadline = true; break; }
    if (!validJob(job)) { counts.failed++; continue; }
    counts.processed++;
    try {
      const result = classifyMailRules(job, { blockedSenders });
      const saved = await rpc("mail_rules_apply", {
        p_thread: job.id, p_revision: job.revision, p_version: version,
        p_labels: result.labels, p_disposition: result.disposition, p_reason: result.reason,
      });
      if (saved?.applied === true) counts.saved++;
      else if (saved?.applied === false) counts.stale++;
      else counts.failed++;
    } catch { counts.failed++; }
  }
  if (!pending.jobs.length) counts.empty = true;
  return counts;
}
