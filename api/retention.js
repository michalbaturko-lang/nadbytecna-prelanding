import crypto from "node:crypto";
import { json } from "../lib/http.js";
import { mailRetention } from "../lib/mail-service.mjs";
import {
  supa,
  rpc,
  restPath,
  removeAudio,
  assertAudioPath,
  audit,
} from "../lib/admin-server.mjs";
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return json(res, 405, { error: "method" });
  const expected = process.env.CRON_SECRET || "";
  const got = String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (
    expected.length < 24 ||
    got.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  )
    return json(res, 401, { error: "auth" });
  try {
    const dryRun = process.env.RETENTION_ENABLED !== "true";
    // Separate candidates by record, not person: an old story must never erase a newer offer.
    const now = new Date().toISOString();
    const expired = await supa(
      restPath("admin_records", {
        select: "entity,id,audio_path",
        delete_at: "lte." + now,
        limit: "100",
        order: "delete_at.asc",
      }),
    );
    const audio = await supa(
      restPath("stories", {
        select: "id,audio_path",
        audio_path: "not.is.null",
        or:
          "(transcript.not.is.null,created_at.lte." +
          new Date(Date.now() - 30 * 864e5).toISOString() +
          ")",
        limit: "100",
        order: "created_at.asc",
      }),
    );
    if (!dryRun) {
      for (const row of expired) {
        if (row.audio_path) assertAudioPath(row.audio_path, row.id);
        // DB locks the record in pending state before any storage deletion.
        const locked = await rpc("admin_retention_mark", {
          p_entity: row.entity,
          p_id: row.id,
        });
        if (!locked) continue;
        if (locked.audio_path) await removeAudio(locked.audio_path, row.id);
        await rpc("admin_retention_finish", {
          p_entity: row.entity,
          p_id: row.id,
        });
      }
      for (const row of audio) {
        if (!row.audio_path) continue;
        assertAudioPath(row.audio_path, row.id);
        const claimed = await rpc("admin_audio_retention_claim", {
          p_id: row.id,
          p_path: row.audio_path,
        });
        if (!claimed) continue;
        await removeAudio(row.audio_path, row.id);
        await rpc("admin_audio_retention_finish", {
          p_id: row.id,
          p_path: row.audio_path,
        });
      }
    }
    await audit(null, "retention_run", null, null, {
      dry_run: dryRun,
      records: expired.length,
      audio: audio.length,
    });
    const email = await mailRetention();
    return json(res, 200, {
      ok: true,
      dryRun,
      records: expired.length,
      audio: audio.length,
      email,
    });
  } catch {
    return json(res, 503, { error: "retention_failed" });
  }
}
