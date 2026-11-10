import crypto from "node:crypto";
import { rpc, fail } from "./admin-server.mjs";

export const MAILBOX = "veryvera@nadbytecna.cz";
export function mailHashSecret() {
  const s = process.env.M365_SUPPRESSION_SECRET || process.env.GDPR_HASH_SECRET;
  if (typeof s !== "string" || s.length < 32)
    throw fail(503, "mail_hash_configuration");
  return s;
}
export async function mailRpc(action, payload = {}) {
  const data = await rpc("admin_mail", {
    p_action: action,
    p_payload: payload,
  });
  // Fail explicitly rather than silently truncate an export or exceed the hosting response limit.
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 3 * 1024 * 1024)
    throw fail(413, "mail_result_too_large");
  return data;
}
export function cronAuthorized(req) {
  const expected = process.env.CRON_SECRET || "",
    got = String(req.headers.authorization || "").replace(/^Bearer /, "");
  const a = Buffer.from(expected),
    b = Buffer.from(got);
  return (
    a.length >= 24 && a.length === b.length && crypto.timingSafeEqual(a, b)
  );
}
export async function mailRetention() {
  const days = Number(process.env.M365_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    return { skipped: true, reason: "retention_not_configured" };
  const dryRun=process.env.M365_RETENTION_ENABLED !== "true";
  const cutoff=new Date(Date.now()-days*864e5).toISOString();
  const secret=mailHashSecret();
  const archive=await import('./mail-archive.mjs');
  const prepared=!dryRun?await archive.prepareArchiveErase({cutoff}):null;
  const result=await mailRpc("retention",{dry_run:dryRun,cutoff,hash_secret:secret});
  if(!dryRun)await archive.finishArchiveErase(prepared,result);
  const {archive_scope,...safeResult}=result;
  return safeResult;
}
