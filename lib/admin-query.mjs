import { exact, restPath, supa, fail } from "./admin-server.mjs";
import { STATUSES, URGENCIES } from "./admin-model.mjs";
const fields =
  "entity,id,created_at,updated_at,full_name,email,anonymous,wants_to_help,input_type,helper_type,status,category,urgency,admin_category,admin_urgency,classified_email,classified_at,ai_summary,ai_help_type,ai_model,ai_at,ai_error,consent_publish,age_confirmed,last_contact_at,delete_at,erasure_requested_at";
export function filters(input = {}, { page = true, includeText = false } = {}) {
  const p = { select: fields + (includeText ? ",body,transcript" : "") };
  const choices = {
    entity: ["stories", "help_offers"],
    status: Object.keys(STATUSES),
    urgency: Object.keys(URGENCIES),
    anonymous: ["true", "false"],
    consent_publish: ["true", "false"],
    wants_to_help: ["true", "false"],
    input_type: ["text", "recording", "upload"],
    helper_type: ["professional", "lived_experience"],
  };
  for (const [key, values] of Object.entries(choices))
    if (input[key]) {
      if (!values.includes(input[key])) throw fail(400, "filter");
      p[key] = exact(input[key]);
    }
  if (input.category) {
    if (!/^[a-z_]{1,40}$/.test(input.category)) throw fail(400, "filter");
    p.category = exact(input.category);
  }
  if (input.ai === "yes") p.ai_at = "not.is.null";
  if (input.ai === "no") {
    p.ai_at = "is.null";
    p.ai_error = "is.null";
  }
  if (input.ai === "error") p.ai_error = "not.is.null";
  if (input.confirmed === "true") p.classified_at = "not.is.null";
  if (input.confirmed === "false") p.classified_at = "is.null";
  if (input.days && ["7", "30"].includes(input.days))
    p.created_at =
      "gte." + new Date(Date.now() - Number(input.days) * 864e5).toISOString();
  if (input.expiring === "true")
    p.delete_at = "lte." + new Date(Date.now() + 14 * 864e5).toISOString();
  if (input.q) {
    // PostgREST FTS plain query: accent normalization, no SQL or filter syntax interpolation.
    const q = String(input.q)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .trim()
      .slice(0, 200);
    if (q) p.search_document = "plfts(simple)." + q;
  }
  const sorts = {
    newest: "created_at.desc,id.desc",
    oldest: "created_at.asc,id.asc",
    status: "status.asc,created_at.desc,id.desc",
    changed: "updated_at.desc,id.desc",
    urgency: "urgency_rank.desc,created_at.desc,id.desc",
  };
  p.order = sorts[input.sort] || sorts.newest;
  if (page) {
    p.limit = "25";
    p.offset = String(
      Math.max(0, Math.min(100000, Math.floor(Number(input.page) || 0))) * 25,
    );
  }
  return p;
}
export async function listRecords(input, options = {}) {
  const p = filters(input, options);
  const r = await supa(restPath("admin_records", p), {
    raw: true,
    prefer: "count=exact",
  });
  const n = r.headers.get("content-range")?.split("/")[1];
  if (!/^\d+$/.test(n || "")) throw fail(503, "count");
  return { rows: await r.json(), total: Number(n) };
}
export async function allFiltered(input, includeText = false) {
  const base = filters(input, { page: false, includeText });
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const r = await supa(
      restPath("admin_records", {
        ...base,
        limit: "500",
        offset: String(offset),
      }),
    );
    rows.push(...r);
    if (r.length < 500) return rows;
  }
  throw fail(413, "export_too_large");
}
export async function countRecords(extra = {}) {
  const r = await supa(
    restPath("admin_records", {
      select: "id",
      erasure_requested_at: "is.null",
      limit: "0",
      ...extra,
    }),
    { raw: true, prefer: "count=exact" },
  );
  const n = r.headers.get("content-range")?.split("/")[1];
  if (!/^\d+$/.test(n || "")) throw fail(503, "count");
  return Number(n);
}
export async function dashboard(categories) {
  const counts = {};
  const specs = {
    new: { status: "eq.new" },
    in_progress: { status: "eq.in_progress" },
    acute: { urgency: "eq.acute" },
    waiting: { ai_at: "is.null", ai_error: "is.null" },
    publish: { consent_publish: "eq.true" },
    week: {
      created_at: "gte." + new Date(Date.now() - 7 * 864e5).toISOString(),
    },
    month: {
      created_at: "gte." + new Date(Date.now() - 30 * 864e5).toISOString(),
    },
  };
  await Promise.all(
    Object.entries(specs).map(async ([k, p]) => {
      counts[k] = await countRecords(p);
    }),
  );
  counts.offers = {};
  await Promise.all(
    categories.map(async (c) => {
      counts.offers[c.code] = await countRecords({
        entity: "eq.help_offers",
        category: exact(c.code),
      });
    }),
  );
  const r = await supa(
    restPath("launch_signups", { select: "id", limit: "0" }),
    { raw: true, prefer: "count=exact" },
  );
  const n = r.headers.get("content-range")?.split("/")[1];
  if (!/^\d+$/.test(n || "")) throw fail(503, "count");
  counts.signups = Number(n);
  return counts;
}
