import crypto from "node:crypto";
import { json } from "../lib/http.js";
import {
  supa,
  rpc,
  restPath,
  exact,
  audit,
  assertAudioPath,
} from "../lib/admin-server.mjs";
import { triageEnabled, triageText } from "../lib/triage.mjs";
import { transcriptionEnabled, transcribeCzech } from "../lib/transcribe.mjs";
export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET || "",
    got = String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (
    expected.length < 24 ||
    got.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  )
    return json(res, 401, { error: "auth" });
  if (!triageEnabled()) return json(res, 200, { skipped: true });
  try {
    const job = await rpc("admin_ai_claim", {});
    if (!job) return json(res, 200, { empty: true });
    try {
      const rows = await supa(
        restPath(job.entity, {
          id: exact(job.id),
          erasure_requested_at: "is.null",
          select: "*",
          limit: "1",
        }),
      );
      const row = rows[0];
      if (!row || row.consent !== true)
        throw new Error("missing_or_no_consent");
      if (!row.story_text && row.transcript && row.consent_transcript !== true)
        throw new Error("transcript_consent");
      let text =
        job.entity === "stories"
          ? row.story_text || row.transcript
          : row.message;
      if (
        !text &&
        row.audio_path &&
        row.consent_transcript === true &&
        transcriptionEnabled()
      ) {
        assertAudioPath(row.audio_path, row.id);
        const response = await supa(
          "/storage/v1/object/story-audio/" +
            row.audio_path.split("/").map(encodeURIComponent).join("/"),
          { raw: true },
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 25 * 1024 * 1024) throw new Error("size");
        const out = await transcribeCzech(bytes, {
          filename: row.audio_path.split("/").pop(),
          mime: response.headers.get("content-type"),
          key: process.env.OPENAI_API_KEY,
        });
        await supa(
          restPath("stories", {
            id: exact(job.id),
            erasure_requested_at: "is.null",
          }),
          { method: "PATCH", body: { transcript: out.text } },
        );
        await audit(null, "transcribe", "stories", job.id);
        text = out.text;
      }
      const categories = await supa(
        restPath("categories", { select: "code", active: "eq.true" }),
      );
      const output = await triageText({
        kind: job.entity === "stories" ? "story" : "help",
        text,
        key: process.env.OPENAI_API_KEY,
        categories: categories.map((c) => c.code),
      });
      await rpc("admin_ai_finish", {
        p_entity: job.entity,
        p_id: job.id,
        p_output: output,
        p_error: false,
      });
      return json(res, 200, { ok: true });
    } catch {
      await rpc("admin_ai_finish", {
        p_entity: job.entity,
        p_id: job.id,
        p_output: {},
        p_error: true,
      });
      return json(res, 200, { ok: false });
    }
  } catch {
    return json(res, 503, { error: "worker_failed" });
  }
}
