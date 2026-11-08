import { json } from "../lib/http.js";
import {
  authorize,
  audit,
  supa,
  rpc,
  restPath,
  exact,
  readBody,
  checkOrigin,
  identity,
  record,
  mutate,
  fail,
  emailHash,
  removeAudio,
  assertAudioPath,
} from "../lib/admin-server.mjs";
import { listRecords, allFiltered, dashboard } from "../lib/admin-query.mjs";
import { STATUSES, URGENCIES, UUID, toCsv } from "../lib/admin-model.mjs";
import { triageEnabled, triageText } from "../lib/triage.mjs";
import { zipSync, strToU8 } from "fflate";
import { mailRpc, mailHashSecret } from "../lib/mail-service.mjs";
import { streamDownload } from "../lib/admin-download.mjs";

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method" });
  }
  try {
    checkOrigin(req);
    const user = await authorize(req);
    const b = await readBody(req);
    if (b.action === "logout") {
      await rpc("admin_logout", { p_session_id: user.sessionId });
      return json(res, 200, { ok: true });
    }
    if (b.action === "init") {
      const categories = await supa(
        restPath("categories", {
          select: "code,name,position",
          active: "eq.true",
          order: "position.asc",
        }),
      );
      return json(res, 200, {
        categories,
        counts: await dashboard(categories),
        user: { id: user.id, email: user.email },
        aiEnabled: triageEnabled(),
      });
    }
    if (b.action === "list")
      return json(res, 200, await listRecords(b.filters || {}));
    if (b.action === "csv") {
      const rows = await allFiltered(b.filters || {}, b.includeText === true);
      await audit(user, "export_csv", null, null, {
        count: rows.length,
        include_text: b.includeText === true,
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="nadbytecna.csv"',
      );
      return await streamDownload(res, toCsv(rows, b.includeText === true));
    }
    if (["person_export", "person_erase"].includes(b.action)) {
      // GDPR requests can start from a selected record or an exact email supplied by an admin.
      let entity = null,
        id = null,
        row;
      if (typeof b.email === "string") {
        const email = b.email.trim().toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw fail(400, "email");
        row = { email };
      } else {
        ({ entity, id } = identity(b));
        row = await record(entity, id, b.action === "person_erase");
      }
      const person = await rpc("admin_person", { p_email: row.email });
      if (b.action === "person_export") {
        person.email_source = await mailRpc("export", {
          email: row.email,
          actor_id: user.id,
          actor_email: user.email,
        });
        const files = { "data.json": strToU8(JSON.stringify(person, null, 2)) };
        let size = 0;
        for (const r of person.records)
          if (r.audio_path) {
            assertAudioPath(r.audio_path, r.id);
            const response = await supa(
              "/storage/v1/object/story-audio/" +
                r.audio_path.split("/").map(encodeURIComponent).join("/"),
              { raw: true },
            );
            const bytes = new Uint8Array(await response.arrayBuffer());
            size += bytes.length;
            if (size > 100 * 1024 * 1024) throw fail(413, "export_too_large");
            files["audio/" + r.audio_path] = bytes;
          }
        const zip = zipSync(files, { level: 1 });
        await audit(user, "export_person", entity, id, {
          records: person.records.length,
        });
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="osobni-udaje.zip"',
        );
        return await streamDownload(res, zip);
      }
      if (b.confirm !== "SMAZAT") throw fail(400, "confirmation");
      const args = {
        p_email: row.email,
        p_hash: emailHash(row.email),
        p_actor: user.id,
        p_actor_email: user.email,
      };
      // Local e-mail copies only. Suppression is committed before the web/audio erasure;
      // repeating a partly completed cross-source request is safe.
      await mailRpc("erase", {
        email: row.email,
        email_hash: emailHash(row.email),
        hash_secret: mailHashSecret(),
        actor_id: user.id,
        actor_email: user.email,
      });
      const locked = await rpc("admin_erase", { ...args, p_mark_only: true });
      for (const r of locked.records)
        if (r.audio_path) await removeAudio(r.audio_path, r.id);
      await rpc("admin_erase", { ...args, p_mark_only: false });
      return json(res, 200, { ok: true });
    }
    const { entity, id } = identity(b);
    const row = await record(entity, id, b.action === "detail");
    if (b.action === "detail") {
      await audit(user, "view_detail", entity, id);
      if (!row.opened_at && !row.erasure_requested_at)
        await mutate(user, entity, id, { opened_at: new Date().toISOString() });
      const [notes, history, matches, duplicates] = await Promise.all([
        supa(
          restPath("admin_notes", {
            entity: exact(entity),
            entity_id: exact(id),
            order: "created_at.asc",
          }),
        ),
        supa(
          restPath("status_history", {
            entity: exact(entity),
            entity_id: exact(id),
            order: "at.desc",
          }),
        ),
        supa(
          restPath("matches", {
            [entity === "stories" ? "story_id" : "offer_id"]: exact(id),
          }),
        ),
        supa(
          restPath("admin_records", {
            email: exact(row.email),
            select: "entity,id,created_at,status",
            erasure_requested_at: "is.null",
            limit: "20",
          }),
        ),
      ]);
      const other = entity === "stories" ? "help_offers" : "stories";
      const p = {
        entity: exact(other),
        erasure_requested_at: "is.null",
        status: "not.in.(archived,published)",
        select: "entity,id,ai_summary,category,urgency,status",
        limit: "3",
        order: "created_at.desc",
      };
      // Deterministic proposals only; never display unrelated records as a match.
      const proposals = row.category
        ? await supa(
            restPath("admin_records", { ...p, category: exact(row.category) }),
          )
        : [];
      return json(res, 200, {
        row,
        notes,
        history,
        matches,
        proposals,
        duplicates: duplicates.filter((r) => r.id !== id),
      });
    }
    if (b.action === "update") {
      const patch = {};
      if (b.patch?.status !== undefined) {
        if (!Object.hasOwn(STATUSES, b.patch.status)) throw fail(400, "status");
        patch.status = b.patch.status;
      }
      if (b.patch?.admin_category !== undefined) {
        if (
          b.patch.admin_category !== null &&
          !/^[a-z_]{1,40}$/.test(b.patch.admin_category)
        )
          throw fail(400, "category");
        patch.admin_category = b.patch.admin_category;
      }
      if (b.patch?.admin_urgency !== undefined) {
        if (
          b.patch.admin_urgency !== null &&
          !Object.hasOwn(URGENCIES, b.patch.admin_urgency)
        )
          throw fail(400, "urgency");
        patch.admin_urgency = b.patch.admin_urgency;
      }
      if (!Object.keys(patch).length) throw fail(400, "patch");
      if (
        patch.status === "published" &&
        (row.consent_publish !== true || row.age_confirmed !== true)
      )
        throw fail(409, "publish_consent");
      await mutate(user, entity, id, patch);
      return json(res, 200, { ok: true });
    }
    if (b.action === "note") {
      if (
        typeof b.body !== "string" ||
        !b.body.trim() ||
        b.body.length > 5000 ||
        (b.noteId && !UUID.test(b.noteId))
      )
        throw fail(400, "note");
      await rpc("admin_note_save", {
        p_entity: entity,
        p_id: id,
        p_actor: user.id,
        p_email: user.email,
        p_body: b.body,
        p_note_id: b.noteId || null,
      });
      return json(res, 200, { ok: true });
    }
    if (b.action === "match") {
      if (
        !UUID.test(b.otherId || "") ||
        !["confirmed", "rejected", "suggested"].includes(b.status)
      )
        throw fail(400, "match");
      await rpc("admin_match_save", {
        p_story: entity === "stories" ? id : b.otherId,
        p_offer: entity === "help_offers" ? id : b.otherId,
        p_status: b.status,
        p_actor: user.id,
        p_email: user.email,
      });
      return json(res, 200, { ok: true });
    }
    if (b.action === "audio") {
      if (!row.audio_path) throw fail(404, "audio");
      assertAudioPath(row.audio_path, row.id);
      const r = await supa(
        "/storage/v1/object/sign/story-audio/" +
          row.audio_path.split("/").map(encodeURIComponent).join("/"),
        { method: "POST", body: { expiresIn: 120 } },
      );
      await audit(user, "play_audio", entity, id);
      const base = String(
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      ).replace(/\/$/, "");
      return json(res, 200, {
        url: base + "/storage/v1" + r.signedURL,
        expiresIn: 120,
      });
    }
    if (b.action === "ai") {
      if (!triageEnabled()) return json(res, 423, { error: "ai_disabled" });
      if (
        row.consent !== true ||
        (!row.body && row.transcript && row.consent_transcript !== true)
      )
        throw fail(409, "processing_consent");
      const categories = await supa(
        restPath("categories", { select: "code", active: "eq.true" }),
      );
      await audit(user, "run_ai", entity, id);
      try {
        const out = await triageText({
          kind: entity === "stories" ? "story" : "help",
          text: row.body || row.transcript || "",
          key: process.env.OPENAI_API_KEY,
          categories: categories.map((c) => c.code),
        });
        await mutate(user, entity, id, {
          ai_summary: out.summary,
          ai_category: out.category,
          ai_urgency: out.urgency,
          ai_help_type: out.help_type,
          ai_model: out.model,
          ai_at: new Date().toISOString(),
          ai_error: null,
        });
        return json(res, 200, { ok: true });
      } catch {
        await mutate(user, entity, id, { ai_error: "triage_failed" });
        return json(res, 502, { error: "ai_failed" });
      }
    }
    throw fail(400, "action");
  } catch (e) {
    // Deliberately never log requests, database errors or sensitive payloads.
    // A failed download must terminate, never append JSON to a partial ZIP/CSV.
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    return json(res, e.status || 503, { error: e.code || "unavailable" });
  }
}
