import { json } from "../lib/http.js";
import { rpc } from "../lib/admin-server.mjs";
import { cronAuthorized, mailHashSecret } from "../lib/mail-service.mjs";
import { getM365AccessToken, validateM365AuthConfig } from "../lib/m365-auth.mjs";
import { readM365DeltaPage } from "../lib/m365-readonly.mjs";
import { delegatedMode, getDelegatedMailToken, oauthRpc } from "../lib/mail-oauth-service.mjs";
import { readM365OAuthConfig } from "../lib/m365-oauth-client.mjs";
import { runMailSync, MAIL_SYNC_ERROR_CODES } from "../lib/mail-sync-worker.mjs";

export function createMailSyncHandler({
  authorized = cronAuthorized,
  run = () => runMailSync({
    rpc,
    prepare: (env) => {
      const secret = mailHashSecret();
      if (delegatedMode(env)) readM365OAuthConfig(env);
      else validateM365AuthConfig(env);
      return secret;
    },
    getToken: (env) => delegatedMode(env)
      ? getDelegatedMailToken({ env })
      : getM365AccessToken({ env }),
    readPage: readM365DeltaPage,
    // Check after every lease claim; disconnect/reconnect invalidates an in-flight lease.
    getConnection: delegatedMode() ? () => oauthRpc("status") : undefined,
    reportFailure: (record) => console.warn(JSON.stringify(record)),
  }),
} = {}) {
  return async function handler(req, res) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "method" });
    }
    if (!authorized(req)) return json(res, 401, { error: "auth" });
    try {
      return json(res, 200, await run());
    } catch (error) {
      const code = MAIL_SYNC_ERROR_CODES.has(error?.code) ? error.code : "mail_sync_failed";
      return json(res, 503, { error: code });
    }
  };
}
export default createMailSyncHandler();
