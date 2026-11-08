import { json } from "../lib/http.js";
import { rpc } from "../lib/admin-server.mjs";
import { cronAuthorized, mailHashSecret } from "../lib/mail-service.mjs";
import {
  getM365AccessToken,
  validateM365AuthConfig,
} from "../lib/m365-auth.mjs";
import { readM365DeltaPage } from "../lib/m365-readonly.mjs";
import {
  delegatedMode,
  getDelegatedMailToken,
} from "../lib/mail-oauth-service.mjs";
import { readM365OAuthConfig } from "../lib/m365-oauth-client.mjs";

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (!["GET", "POST"].includes(req.method))
    return json(res, 405, { error: "method" });
  if (!cronAuthorized(req)) return json(res, 401, { error: "auth" });
  // Off means no credential parsing, database access, OAuth or Graph request.
  if (process.env.M365_INGEST_ENABLED !== "true")
    return json(res, 200, { skipped: true });
  let lease;
  try {
    const secret = mailHashSecret();
    if (delegatedMode()) readM365OAuthConfig(process.env);
    else validateM365AuthConfig(process.env);
    const state = await rpc("mail_sync_claim", {
      p_mailbox: process.env.M365_MAILBOX,
      p_folder: process.env.M365_FOLDER_ID,
      p_since: process.env.M365_SINCE,
    });
    if (!state) return json(res, 200, { busy: true });
    lease = state.lease;
    const auth = delegatedMode()
      ? await getDelegatedMailToken()
      : await getM365AccessToken({});
    const page = await readM365DeltaPage({
      env: { ...process.env, M365_SINCE: new Date(state.since).toISOString() },
      accessToken: auth.accessToken,
      cursor: state.cursor || null,
    });
    const messages = page.messages.map((m) => ({
      external_id: m.externalId,
      conversation_id: m.conversationId,
      internet_message_id: m.internetMessageId,
      sender_name: m.senderName,
      sender_email: m.senderEmail,
      subject: m.subject,
      body_text: m.text,
      received_at: m.receivedAt,
      has_attachments: m.hasAttachments,
    }));
    const result = await rpc("mail_sync_commit", {
      p_lease: lease,
      p_messages: messages,
      p_removed: page.removals.map((m) => m.externalId),
      p_next_cursor: page.nextLink || page.deltaLink,
      p_complete: !page.nextLink,
      p_hash_secret: secret,
    });
    lease = null;
    return json(res, 200, {
      ok: true,
      ...result,
      more: Boolean(page.nextLink),
    });
  } catch (e) {
    // Fixed error vocabulary; never persist Graph bodies, URLs, tokens or private keys.
    const code = [
      "cursor_expired",
      "throttled",
      "authentication_failed",
      "invalid_configuration",
      "token_request_failed",
      "timeout",
      "mail_reconnect_required",
      "mail_connection_changed",
      "oauth_interaction_required",
    ].includes(e.code)
      ? e.code
      : "mail_sync_failed";
    if (lease)
      try {
        await rpc("mail_sync_release", {
          p_lease: lease,
          p_error: code,
          ...(e.code === "throttled" && Number.isInteger(e.retryAfterSeconds)
            ? { p_retry_after_seconds: e.retryAfterSeconds }
            : {}),
        });
      } catch {}
    return json(res, 503, { error: code });
  }
}
