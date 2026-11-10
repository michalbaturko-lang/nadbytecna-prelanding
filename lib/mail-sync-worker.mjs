const MAX_PAGES = 5;
const RUN_BUDGET_MS = 105000;
// Claim15s + connection check15s + Graph10s + commit15s + failure release15s.
const PAGE_RESERVE_MS = 75000;
export const MAIL_SYNC_ERROR_CODES = new Set([
  "cursor_expired", "throttled", "authentication_failed", "invalid_configuration",
  "token_request_failed", "timeout", "mail_reconnect_required", "mail_connection_changed",
  "oauth_interaction_required",
  "network_error", "http_error", "invalid_cursor", "invalid_response", "response_too_large",
  "database", "configuration", "mail_hash_configuration",
  "oauth_configuration", "oauth_cache_invalid", "oauth_cache_decryption_failed",
  "oauth_network_failed", "oauth_network_blocked", "oauth_refresh_failed",
  "oauth_reauth_required", "oauth_client_rejected", "oauth_identity_invalid", "oauth_scope_missing",
]);
function safeCursorShape(value) {
  if (!value || !["me", "users_path", "users_odata", "other"].includes(value.ownerStyle) ||
      !["odata", "path", "other"].includes(value.folderStyle) ||
      !["skip", "delta", "other"].includes(value.queryStyle) ||
      typeof value.sameOwner !== "boolean" || typeof value.sameFolder !== "boolean") return undefined;
  return { ownerStyle: value.ownerStyle, folderStyle: value.folderStyle,
    queryStyle: value.queryStyle, sameOwner: value.sameOwner, sameFolder: value.sameFolder };
}

export async function runMailSync({ env = process.env, prepare, rpc, getToken, readPage, getConnection, now = Date.now, reportFailure = () => {} }) {
  if (env.M365_INGEST_ENABLED !== "true") return { skipped: true };
  const started = now();
  let lease = null;
  let stage = "env_validation";
  const report = (phase, code, cursorShape) => {
    try { reportFailure({ event: "mail_sync_failed", stage: phase, code, ...(cursorShape ? { cursorShape } : {}) }); } catch {}
  };
  try {
    const secret = await prepare(env);
    let auth;
    let generation;
    const totals = { ok: true, pages: 0, imported: 0, skipped: 0, removed: 0, more: false };
    for (let index = 0; index < MAX_PAGES; index++) {
      // Later pages reuse authentication and reserve time for a failed lease release.
      if (index > 0 && now() - started >= RUN_BUDGET_MS - PAGE_RESERVE_MS)
        return { ...totals, deadline: true };
      stage = "claim";
      const state = await rpc("mail_sync_claim", {
        p_mailbox: env.M365_MAILBOX, p_folder: env.M365_FOLDER_ID, p_since: env.M365_SINCE,
      });
      if (!state) return index === 0 ? { busy: true } : { ...totals, busy: true };
      lease = state.lease;
      stage = "auth";
      if (auth && getConnection) {
        const connection = await getConnection(env);
        if (connection?.connected !== true || !Number.isSafeInteger(connection.generation) ||
            (generation !== undefined && generation !== connection.generation))
          throw Object.assign(new Error("Mail connection changed."), { code: "mail_connection_changed" });
      }
      if (!auth) {
        auth = await getToken(env);
        generation = auth.generation;
        if (getConnection && !Number.isSafeInteger(generation))
          throw Object.assign(new Error("Mail connection changed."), { code: "mail_connection_changed" });
      }
      stage = "read";
      const page = await readPage({
        env: { ...env, M365_SINCE: new Date(state.since).toISOString() },
        accessToken: auth.accessToken, cursor: state.cursor || null,
      });
      stage = "commit";
      const result = await rpc("mail_sync_commit", {
        p_lease: lease,
        p_messages: page.messages.map((m) => ({
          external_id: m.externalId, conversation_id: m.conversationId,
          internet_message_id: m.internetMessageId, sender_name: m.senderName,
          sender_email: m.senderEmail, subject: m.subject, body_text: m.text,
          received_at: m.receivedAt, has_attachments: m.hasAttachments,
        })),
        p_removed: page.removals.map((m) => m.externalId),
        p_next_cursor: page.nextLink || page.deltaLink,
        p_complete: !page.nextLink, p_hash_secret: secret,
      });
      lease = null;
      totals.pages++;
      for (const key of ["imported", "skipped", "removed"])
        if (Number.isSafeInteger(result?.[key]) && result[key] >= 0) totals[key] += result[key];
      totals.more = Boolean(page.nextLink);
      if (!totals.more) return totals;
    }
    return totals;
  } catch (error) {
    const code = MAIL_SYNC_ERROR_CODES.has(error?.code) ? error.code : "mail_sync_failed";
    report(stage, code, code === "invalid_cursor" ? safeCursorShape(error.cursorShape) : undefined);
    if (lease) {
      try {
        await rpc("mail_sync_release", {
          p_lease: lease, p_error: code,
          ...(code === "throttled" && Number.isInteger(error.retryAfterSeconds)
            ? { p_retry_after_seconds: error.retryAfterSeconds } : {}),
        });
      } catch {
        report("release", "mail_sync_failed");
      }
    }
    // Never retain original errors/causes: they may contain private Graph data.
    throw Object.assign(new Error("Mail synchronization failed."), { code });
  }
}
