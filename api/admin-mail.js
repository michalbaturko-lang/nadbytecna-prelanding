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
import { mailAiScopeAllows,mailAiAllowUnmarked } from "../lib/mail-ai-scope.mjs";
import { MAIL_LABEL_CATALOG, MAIL_LABEL_CODES, mailRulesEnabled } from "../lib/mail-rules.mjs";
import { checkArchiveStorage } from "../lib/mail-archive-probe.mjs";
import { archiveStatus,archiveThread,archiveDownload,archiveExport,prepareArchiveErase,finishArchiveErase,retryArchive } from "../lib/mail-archive.mjs";
import { validateM365AuthConfig,getM365AccessToken } from "../lib/m365-auth.mjs";
import { readM365Json } from "../lib/m365-readonly.mjs";
import {
  delegatedMode,
  oauthReadiness,
  oauthRpc,
  issueMailInvitation,
  disconnectMail,
  getDelegatedMailToken,
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
      const aiQueue = await rpc("mail_ai_status_scoped", {p_allow_unmarked:mailAiAllowUnmarked()});
      const triageStats = await rpc("mail_triage_status", {});
      const originals = await archiveStatus();
      return json(res, 200, {
        ...state,
        mailbox: MAILBOX,
        configured,
        syncEnabled: process.env.M365_INGEST_ENABLED === "true",
        aiEnabled: mailAiEnabled(),
        aiScopeMode: mailAiAllowUnmarked() ? "all" : "marked",
        aiAutomationEnabled: mailAiAutomationEnabled(),
        rulesEnabled: mailRulesEnabled(),
        labelCatalog: MAIL_LABEL_CATALOG,
        aiQueue,
        triageStats,
        originals,
        archiveEnabled: process.env.M365_MAIL_ARCHIVE_ENABLED === "true",
        needsSetup: !configured,
        ...readiness,
        connected: connection?.connected === true,
        connectionUpdatedAt: connection?.connected_at || null,
      });
    }
    if (b.action === "archive_integrity_check") return json(res,200,await checkArchiveStorage());
    if (b.action === "source_check") {
      if (process.env.M365_INGEST_ENABLED !== "true") throw fail(423,"mail_sync_disabled");
      const auth = delegatedMode() ? await getDelegatedMailToken() : await getM365AccessToken();
      const resource=delegatedMode() ? "/me" : "/users/"+encodeURIComponent(MAILBOX);
      const response=await fetch("https://graph.microsoft.com/v1.0"+resource+"/mailFolders/inbox?$select=totalItemCount,unreadItemCount",{method:"GET",redirect:"error",cache:"no-store",headers:{Authorization:"Bearer "+auth.accessToken,Accept:"application/json"},signal:AbortSignal.timeout(10000)});
      if(!response.ok||response.redirected) throw fail(503,"mail_source_unavailable");
      const source=await readM365Json(response,16384);
      if(!Number.isSafeInteger(source.totalItemCount)||source.totalItemCount<0||!Number.isSafeInteger(source.unreadItemCount)||source.unreadItemCount<0) throw fail(503,"mail_source_unavailable");
      const local=await rpc("mail_source_counts",{});
      return json(res,200,{scope:"Inbox",sourceMessages:source.totalItemCount,sourceUnread:source.unreadItemCount,...local,matches:source.totalItemCount===local.activeMessages,checkedAt:new Date().toISOString()});
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
        review: ["pending", "reviewed"],
        subtype: ["personal_story", "request_help", "offer_help", "press", "partnership", "operational", "automated", "spam", "other"],
        disposition: ["all", "normal", "suspect", "review"],
      }))
        if (f[k] && !values.includes(f[k])) throw fail(400, "filter");
      if (f.label && !MAIL_LABEL_CODES.has(f.label)) throw fail(400, "filter");
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
    if (b.action === "labels") {
      if (!Number.isSafeInteger(b.revision) || b.revision < 1 || b.revision > 2147483647) throw fail(400, "labels");
      const add = b.add === undefined ? [] : b.add, remove = b.remove === undefined ? [] : b.remove;
      if (![add, remove].every(values => Array.isArray(values) && values.length <= 24 && values.every(value => MAIL_LABEL_CODES.has(value))) ||
          add.some(value => remove.includes(value)) ||
          !(b.disposition == null || ["normal", "suspect", "review", "auto"].includes(b.disposition)))
        throw fail(400, "labels");
      const result = await rpc("mail_labels_manual", { p_id: id, p_revision: b.revision,
        p_add: [...new Set(add)], p_remove: [...new Set(remove)], p_disposition: b.disposition ?? null,
        p_actor: user.id, p_email: user.email });
      if (!result || typeof result.saved !== "boolean") throw fail(503, "mail_unavailable");
      if (result?.saved === false) throw fail(result.reason === "missing" ? 404 : 409, result.reason === "missing" ? "mail_missing" : "mail_changed");
      return json(res, 200, result);
    }
    if (b.action === "ai_scope") {
      if (!Number.isSafeInteger(b.revision) || b.revision < 1 || typeof b.approved !== "boolean") throw fail(400,"scope");
      return json(res,200,await rpc("mail_set_ai_scope",{p_id:id,p_revision:b.revision,p_approved:b.approved,p_actor:user.id,p_email:user.email}));
    }
    if (b.action === "review") {
      if (!Number.isSafeInteger(b.revision) || b.revision < 1 || typeof b.reviewed !== "boolean") throw fail(400, "review");
      return json(res, 200, await rpc("mail_mark_reviewed", { p_id: id, p_revision: b.revision, p_reviewed: b.reviewed, p_actor: user.id, p_email: user.email }));
    }
    if (b.action === "archive_download") return json(res, 200, await archiveDownload(id));
    if (b.action === "archive_retry") return json(res, 200, await retryArchive(id));
    if (b.action === "detail") {
      const detail = await mailRpc("detail", { ...actor,id,message_page: Math.max(0,Math.min(50000,Math.floor(Number(b.message_page)||0))) });
      detail.originals = await archiveThread(id);
      return json(res,200,detail);
    }
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
      d.originals = await archiveExport({threadId:id});
      if (Buffer.byteLength(JSON.stringify(d),"utf8") > 3*1024*1024) throw fail(413,"mail_result_too_large");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="emailove-vlakno.json"',
      );
      return json(res, 200, d);
    }
    if (b.action === "erase") {
      if (b.confirm !== "SMAZAT") throw fail(400,"confirmation");
      const prepared=await prepareArchiveErase({threadId:id});
      const erased=await mailRpc("thread_erase",{...actor,id,hash_secret:mailHashSecret()});
      await finishArchiveErase(prepared,erased);
      const {archive_scope,...result}=erased;
      return json(res,200,result);
    }
    if (b.action === "ai") {
      if (!mailAiEnabled()) throw fail(423, "mail_ai_disabled");
      const d = await rpc("mail_ai_snapshot", { p_id: id });
      if (!d || !d.messages?.length) throw fail(404, "mail_ai_empty");
      if (!mailAiScopeAllows(d)) throw fail(423,"mail_ai_scope_required");
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
        await rpc("mail_ai_save_scoped", {p_payload:{...actor,id,revision,scope_version:d.ai_scope_version,error:true},p_allow_unmarked:mailAiAllowUnmarked()});
        throw fail(502, "mail_ai_failed");
      }
      const result = await rpc("mail_ai_save_scoped", {p_payload:{...actor,id,revision,scope_version:d.ai_scope_version,...output,error:false},p_allow_unmarked:mailAiAllowUnmarked()});
      if (result.saved === false) throw fail(409, "mail_changed");
      return json(res, 200, { ok: true });
    }
    throw fail(400, "action");
  } catch (e) {
    return json(res, e.status || 503, { error: e.code || "mail_unavailable" });
  }
}
