import { json } from "../lib/http.js";
import {
  authorize,
  checkOrigin,
  readBody,
  fail,
  supa,
  restPath,
  rpc,
} from "../lib/admin-server.mjs";
import { UUID, STATUSES, URGENCIES } from "../lib/admin-model.mjs";
import { MAILBOX, mailRpc, mailHashSecret } from "../lib/mail-service.mjs";
import { mailAiEnabled, classifyMail } from "../lib/mail-ai.mjs";
import { mailAiAutomationEnabled } from "../lib/mail-ai-worker.mjs";
import { validateM365AuthConfig } from "../lib/m365-auth.mjs";
import {
  delegatedMode,
  oauthReadiness,
  oauthRpc,
  issueMailInvitation,
  disconnectMail,
} from "../lib/mail-oauth-service.mjs";

const idOf = (b) => {
  if (!UUID.test(b.id || "")) throw fail(400, "identity");
  return b.id;
};
export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  try {
    checkOrigin(req);
    const user = await authorize(req),
      b = await readBody(req);
    const actor = { actor_id: user.id, actor_email: user.email };
    if (b.action === "status") {
      let configured = false;
      const readiness = oauthReadiness();
      if (delegatedMode()) configured = readiness.connectConfigured;
      else
        try {
          validateM365AuthConfig(process.env);
          configured = true;
        } catch {}
      const state = await mailRpc("status");
      const connection = delegatedMode() ? await oauthRpc("status") : null;
      const aiQueue = await rpc("mail_ai_status", {});
      return json(res, 200, {
        ...state,
        mailbox: MAILBOX,
        configured,
        syncEnabled: process.env.M365_INGEST_ENABLED === "true",
        aiEnabled: mailAiEnabled(),
        aiAutomationEnabled: mailAiAutomationEnabled(),
        aiQueue,
        needsSetup: !configured,
        ...readiness,
        connected: connection?.connected === true,
        connectionUpdatedAt: connection?.connected_at || null,
      });
    }
    if (b.action === "connect_invite")
      return json(res, 200, await issueMailInvitation(user));
    if (b.action === "disconnect") {
      if (b.confirm !== "ODPOJIT") throw fail(400, "confirmation");
      return json(res, 200, await disconnectMail(user));
    }
    if (b.action === "list") {
      const f = b.filters || {};
      if (typeof f !== "object" || Array.isArray(f)) throw fail(400, "filter");
      for (const [k, values] of Object.entries({
        status: Object.keys(STATUSES).filter((x) => x !== "published"),
        email_type: ["story", "help", "other"],
        urgency: Object.keys(URGENCIES),
      }))
        if (f[k] && !values.includes(f[k])) throw fail(400, "filter");
      if (f.category && !/^[a-z_]{1,40}$/.test(f.category))
        throw fail(400, "filter");
      if (f.sort && !["urgency", "newest", "oldest"].includes(f.sort))
        throw fail(400, "filter");
      return json(
        res,
        200,
        await rpc("mail_list_sorted", {
          p_filters: {
            ...f,
            q: String(f.q || "").slice(0, 200),
            page: Math.max(0, Math.min(4000, Math.floor(Number(f.page) || 0))),
          },
        }),
      );
    }
    const id = idOf(b);
    if (b.action === "detail")
      return json(
        res,
        200,
        await mailRpc("detail", {
          ...actor,
          id,
          message_page: Math.max(
            0,
            Math.min(50000, Math.floor(Number(b.message_page) || 0)),
          ),
        }),
      );
    if (b.action === "update") {
      const p = b.patch;
      if (!p || typeof p !== "object" || Array.isArray(p))
        throw fail(400, "patch");
      for (const k of Object.keys(p))
        if (
          !["status", "email_type", "admin_category", "admin_urgency"].includes(
            k,
          )
        )
          throw fail(400, "patch");
      if (
        Object.hasOwn(p, "status") &&
        (!Object.hasOwn(STATUSES, p.status) || p.status === "published")
      )
        throw fail(400, "status");
      if (
        Object.hasOwn(p, "email_type") &&
        !["story", "help", "other"].includes(p.email_type)
      )
        throw fail(400, "email_type");
      if (
        p.admin_urgency !== undefined &&
        p.admin_urgency !== null &&
        !Object.hasOwn(URGENCIES, p.admin_urgency)
      )
        throw fail(400, "urgency");
      if (
        p.admin_category !== undefined &&
        p.admin_category !== null &&
        !/^[a-z_]{1,40}$/.test(p.admin_category)
      )
        throw fail(400, "category");
      return json(
        res,
        200,
        await mailRpc("mutate", { ...actor, id, patch: p }),
      );
    }
    if (b.action === "note") {
      if (typeof b.text !== "string" || !b.text.trim() || b.text.length > 5000)
        throw fail(400, "note");
      return json(
        res,
        200,
        await mailRpc("note", { ...actor, id, body: b.text.trim() }),
      );
    }
    if (b.action === "export") {
      const d = await mailRpc("thread_export", { ...actor, id });
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="emailove-vlakno.json"',
      );
      return json(res, 200, d);
    }
    if (b.action === "erase") {
      if (b.confirm !== "SMAZAT") throw fail(400, "confirmation");
      return json(
        res,
        200,
        await mailRpc("thread_erase", {
          ...actor,
          id,
          hash_secret: mailHashSecret(),
        }),
      );
    }
    if (b.action === "ai") {
      if (!mailAiEnabled()) throw fail(423, "mail_ai_disabled");
      const d = await rpc("mail_ai_snapshot", { p_id: id });
      if (!d || !d.messages?.length) throw fail(404, "mail_ai_empty");
      const revision = d.revision;
      const c = await supa(
        restPath("categories", { select: "code", active: "eq.true" }),
      );
      let output;
      try {
        output = await classifyMail({
          messages: d.messages,
          categories: c.map((x) => x.code),
        });
      } catch {
        await mailRpc("ai_save", { ...actor, id, revision, error: true });
        throw fail(502, "mail_ai_failed");
      }
      const result = await mailRpc("ai_save", {
        ...actor,
        id,
        revision,
        ...output,
        error: false,
      });
      if (result.saved === false) throw fail(409, "mail_changed");
      return json(res, 200, { ok: true });
    }
    throw fail(400, "action");
  } catch (e) {
    return json(res, e.status || 503, { error: e.code || "mail_unavailable" });
  }
}
