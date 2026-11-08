// Offline integration server: real handlers + local PostgreSQL/RLS + synthetic storage/Auth.
// No credentials and no external network; never use against production.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  freshAdminDb,
  seed,
  ADMIN,
  OTHER,
  SESSION,
  STORY,
  OFFER,
} from "./admin-db.mjs";
export const token =
  Buffer.from("{}").toString("base64url") +
  "." +
  Buffer.from(JSON.stringify({ sub: ADMIN, session_id: SESSION })).toString(
    "base64url",
  ) +
  ".synthetic";
export const otherToken =
  Buffer.from("{}").toString("base64url") +
  "." +
  Buffer.from(JSON.stringify({ sub: OTHER, session_id: SESSION })).toString(
    "base64url",
  ) +
  ".synthetic";
const root = path.resolve(new URL("../../", import.meta.url).pathname);
const ident = (s) => {
  if (!/^[a-z_][a-z_0-9]*$/i.test(s)) throw new Error("identifier");
  return '"' + s + '"';
};
export async function startAdminServer({
  port = 0,
  autoLogin = false,
  mailConnectClient,
} = {}) {
  const db = await freshAdminDb();
  await db.exec(
    fs.readFileSync(
      new URL(
        "../../supabase/migrations/20261109000000_admin_mail.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      new URL(
        "../../supabase/migrations/20261110000000_mail_oauth.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await seed(db);
  const mailLease = (
    await db.query(
      "SELECT public.mail_sync_claim($1,'inbox','2026-11-01T00:00:00Z') d",
      ["veryvera@nadbytecna.cz"],
    )
  ).rows[0].d;
  await db.query(
    "SELECT public.mail_sync_commit($1,$2::jsonb,'[]'::jsonb,$3,true,$4)",
    [
      mailLease.lease,
      JSON.stringify([
        {
          external_id: "synthetic-email-1",
          conversation_id: "synthetic-thread-1",
          sender_name: "Ukázková pisatelka",
          sender_email: "pisatelka@example.invalid",
          subject: "Ukázkový e-mail: prosba o podporu",
          body_text:
            "Toto je smyšlený e-mail pro místní ukázku. Potřebuji poradit s hledáním práce.",
          received_at: "2026-11-06T12:00:00Z",
          has_attachments: false,
        },
      ]),
      "https://graph.microsoft.com/v1.0/users/veryvera%40nadbytecna.cz/mailFolders/inbox/messages/delta?$deltatoken=synthetic",
      "synthetic-only-hash-secret-for-local-tests",
    ],
  );
  await db.query(
    `UPDATE stories SET admin_category='pravni',admin_urgency='acute',ai_summary='Ukázková osoba potřebuje podporu při řešení rodinné situace. Vhodný je bezpečný kontakt a právní konzultace.',ai_help_type='Ověřit bezpečný kontakt a nabídnout právní konzultaci.',ai_model='ukázková data',ai_at=now(),audio_path=$2 WHERE id=$1`,
    [STORY, STORY + "/ukazka.wav"],
  );
  await db.query(
    `UPDATE help_offers SET admin_category='pravni',ai_summary='Syntetická nabídka právní konzultace v rodinných věcech.',ai_help_type='Domluvit rozsah konzultace.',ai_at=now() WHERE id=$1`,
    [OFFER],
  );
  for (let i = 0; i < 28; i++)
    await db.query(
      `INSERT INTO stories(full_name,email,anonymous,input_type,story_text,consent,status) VALUES($1,$2,$3,'text','Pouze syntetická zpráva pro testování adminu.',true,$4)`,
      [
        "Ukázková osoba " + (i + 2),
        "sample" + i + "@example.invalid",
        i % 3 === 0,
        i % 4 === 0 ? "in_progress" : "new",
      ],
    );
  const originalFetch = globalThis.fetch;
  const metrics = {
    external: 0,
    mail: 0,
    ai: 0,
    signed: 0,
    graph: 0,
    oauth: 0,
  };
  let aiMode = null;
  let mailMode = null;
  const wav = Buffer.alloc(44 + 22050 * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 22050; i++)
    wav.writeInt16LE(
      Math.round(500 * Math.sin((2 * Math.PI * 440 * i) / 22050)),
      44 + i * 2,
    );
  const storage = new Map([[STORY + "/ukazka.wav", wav]]);
  async function adapter(input, opts = {}) {
    const u = new URL(String(input));
    if (mailMode && u.hostname === "login.microsoftonline.com") {
      metrics.oauth++;
      return Response.json({
        access_token: "synthetic-graph-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (mailMode && u.hostname === "graph.microsoft.com") {
      metrics.graph++;
      if (mailMode === "throttled")
        return Response.json(
          { error: "synthetic" },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      if (mailMode === "expired")
        return Response.json({ error: "synthetic" }, { status: 410 });
      return Response.json({
        value: [
          {
            id: "synthetic-email-1",
            conversationId: "synthetic-thread-1",
            from: {
              emailAddress: {
                name: "Ukázková pisatelka",
                address: "pisatelka@example.invalid",
              },
            },
            subject: "Smyšlený e-mail",
            body: {
              contentType: "text",
              content: "Smyšlený obsah pro test opakovaného importu.",
            },
            receivedDateTime: "2026-11-06T12:00:00Z",
            hasAttachments: false,
          },
        ],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/users/veryvera%40nadbytecna.cz/mailFolders/inbox/messages/delta?$deltatoken=synthetic2",
      });
    }
    if (u.hostname === "api.openai.com" && aiMode) {
      metrics.ai++;
      if (aiMode === "timeout")
        throw new DOMException("synthetic timeout", "TimeoutError");
      if (aiMode === "error") return new Response("{}", { status: 500 });
      const output = {
        summary: "Syntetické shrnutí pro test fallbacku.",
        category: aiMode === "invalid" ? "invalid" : "pravni",
        urgency: "medium",
        help_type: "Osobně ověřit potřeby.",
      };
      if (
        JSON.parse(opts.body).response_format?.json_schema?.name ===
        "mail_classification"
      )
        output.email_type = "story";
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
      );
    }
    if (
      u.hostname !== "offline.supabase.invalid" &&
      !(autoLogin && u.hostname === "127.0.0.1")
    ) {
      metrics.external++;
      throw new Error("external_network_blocked");
    }
    const method = opts.method || "GET",
      body = opts.body ? JSON.parse(opts.body) : undefined;
    const respond = (d, status = 200, headers = {}) =>
      new Response(d == null ? null : JSON.stringify(d), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      });
    if (u.pathname === "/auth/v1/user") {
      const outside = opts.headers.Authorization === "Bearer " + otherToken;
      return respond({
        id: outside ? OTHER : ADMIN,
        email: outside ? "other@example.invalid" : "admin@example.invalid",
        email_confirmed_at: "2026-11-01T00:00:00Z",
      });
    }
    if (u.pathname.startsWith("/storage/v1/")) {
      const name = u.pathname.split("/story-audio/")[1];
      if (method === "POST" && u.pathname.includes("/object/sign/")) {
        metrics.signed++;
        return respond({
          signedURL: "/object/sign/story-audio/" + name + "?token=offline",
        });
      }
      if (method === "DELETE") {
        for (const p of body.prefixes) storage.delete(p);
        return respond([]);
      }
      return new Response(storage.get(decodeURIComponent(name)) || null, {
        status: storage.has(decodeURIComponent(name)) ? 200 : 404,
        headers: { "Content-Type": "audio/wav" },
      });
    }
    try {
      return await db.transaction(async (tx) => {
        await tx.exec(
          opts.headers?.Authorization === "Bearer synthetic-public"
            ? "SET LOCAL ROLE anon"
            : "SET LOCAL ROLE service_role",
        );
        if (u.pathname.includes("/rpc/")) {
          const name = u.pathname.split("/rpc/")[1];
          const keys = Object.keys(body || {});
          const args = keys.map((k, i) => ident(k) + "=> $" + (i + 1));
          const r = await tx.query(
            "SELECT public." + ident(name) + "(" + args.join(",") + ") result",
            keys.map((k) =>
              typeof body[k] === "object" && body[k] !== null
                ? JSON.stringify(body[k])
                : body[k],
            ),
          );
          return respond(r.rows[0]?.result ?? null);
        }
        const table = u.pathname.split("/rest/v1/")[1];
        if (!table) throw new Error("table");
        const values = [],
          where = [];
        function condition(k, v) {
          let col = ident(k);
          let n;
          const pos = v.indexOf("."),
            op = v.slice(0, pos),
            val = v.slice(pos + 1);
          const arg = (x) => {
            values.push(x);
            return "$" + values.length;
          };
          if (v === "is.null") return col + " IS NULL";
          if (v === "not.is.null") return col + " IS NOT NULL";
          if (v.startsWith("not.in.")) {
            const vals = v.slice(8, -1).split(",");
            return col + " NOT IN (" + vals.map(arg).join(",") + ")";
          }
          if (v.startsWith("plfts(simple)."))
            return (
              col + " @@ plainto_tsquery('simple'," + arg(v.slice(14)) + ")"
            );
          let value = val;
          if (value.startsWith('"'))
            value = value
              .slice(1, -1)
              .replaceAll('\\"', '"')
              .replaceAll("\\\\", "\\");
          const ops = { eq: "=", gte: ">=", lte: "<=", gt: ">", lt: "<" };
          if (!ops[op]) throw new Error("operator " + op);
          return col + ops[op] + arg(value);
        }
        for (const [k, v] of u.searchParams) {
          if (["select", "order", "limit", "offset", "or"].includes(k))
            continue;
          where.push(condition(k, v));
        }
        if (u.searchParams.has("or")) {
          const raw = u.searchParams.get("or");
          where.push(
            "(" +
              raw
                .slice(1, -1)
                .split(",")
                .map((c) => {
                  const pos = c.indexOf(".");
                  return condition(c.slice(0, pos), c.slice(pos + 1));
                })
                .join(" OR ") +
              ")",
          );
        }
        const w = where.length ? " WHERE " + where.join(" AND ") : "";
        if (method === "POST") {
          const keys = Object.keys(body);
          const cols = keys.map(ident).join(",");
          const params = keys.map((k) => {
            values.push(
              Array.isArray(body[k])
                ? "{" +
                    body[k]
                      .map(
                        (x) =>
                          '"' +
                          String(x)
                            .replaceAll("\\", "\\\\")
                            .replaceAll('"', '\\"') +
                          '"',
                      )
                      .join(",") +
                    "}"
                : typeof body[k] === "object" && body[k] !== null
                  ? JSON.stringify(body[k])
                  : body[k],
            );
            return "$" + values.length;
          });
          await tx.query(
            "INSERT INTO public." +
              ident(table) +
              "(" +
              cols +
              ") VALUES(" +
              params +
              ")",
            values,
          );
          return respond(null, 201);
        }
        if (method === "PATCH") {
          const updates = Object.keys(body).map((k) => {
            values.push(body[k]);
            return ident(k) + "=$" + values.length;
          });
          await tx.query(
            "UPDATE public." + ident(table) + " SET " + updates.join(",") + w,
            values,
          );
          return respond(null, 204);
        }
        const select = u.searchParams.get("select") || "*";
        const cols =
          select === "*" ? "*" : select.split(",").map(ident).join(",");
        const total = (
          await tx.query(
            "SELECT count(*)::int n FROM public." + ident(table) + w,
            values,
          )
        ).rows[0].n;
        const order = u.searchParams.get("order");
        const sort = order
          ? " ORDER BY " +
            order
              .split(",")
              .map((s) => {
                const [c, dir, nulls] = s.split(".");
                return (
                  ident(c) +
                  (dir === "desc" ? " DESC" : " ASC") +
                  (nulls === "nullslast" ? " NULLS LAST" : "")
                );
              })
              .join(",")
          : "";
        const limit = Math.min(
            100000,
            Number(u.searchParams.get("limit") || 1000),
          ),
          offset = Number(u.searchParams.get("offset") || 0);
        const rows = (
          await tx.query(
            "SELECT " +
              cols +
              " FROM public." +
              ident(table) +
              w +
              sort +
              " LIMIT " +
              limit +
              " OFFSET " +
              offset,
            values,
          )
        ).rows;
        return respond(rows, 200, {
          "content-range": `${offset}-${offset + rows.length - 1}/${total}`,
        });
      });
    } catch (e) {
      console.error("offline-adapter", u.pathname, e.code || "", e.message);
      return respond({ error: "offline_database" }, 400);
    }
  }
  globalThis.fetch = adapter;
  Object.assign(process.env, {
    SUPABASE_URL: "https://offline.supabase.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only",
    NEXT_PUBLIC_SUPABASE_URL: "https://offline.supabase.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
    AI_TRIAGE_ENABLED: "false",
    AI_TRANSCRIPTION_ENABLED: "false",
    GDPR_HASH_SECRET: "synthetic-only-hash-secret-for-local-tests",
    CRON_SECRET: "synthetic-only-cron-secret-for-local-tests",
    RETENTION_ENABLED: "false",
    M365_INGEST_ENABLED: "false",
    M365_AUTH_MODE: autoLogin ? "delegated" : "certificate",
    M365_CONNECT_ENABLED: "false",
    AI_EMAIL_CLASSIFICATION_ENABLED: "false",
    AI_EMAIL_PROCESSING_APPROVED: "false",
    M365_RETENTION_ENABLED: "false",
  });
  const admin = (await import("../../api/admin.js")).default;
  const triage = (await import("../../api/triage.js")).default;
  const retention = (await import("../../api/retention.js")).default;
  const worker = (await import("../../api/ai-worker.js")).default;
  const adminMail = (await import("../../api/admin-mail.js")).default;
  const mailSync = (await import("../../api/mail-sync.js")).default;
  const connectModule = await import("../../api/mail-connect.js");
  const mailConnect = mailConnectClient
    ? connectModule.createMailConnectHandler(mailConnectClient)
    : connectModule.default;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    res.setHeader("Cache-Control", "no-store");
    if (
      autoLogin &&
      u.pathname.startsWith("/storage/v1/object/sign/story-audio/")
    ) {
      const response = await adapter(
        "https://offline.supabase.invalid" + u.pathname + u.search,
      );
      res.statusCode = response.status;
      res.setHeader("Content-Type", "audio/wav");
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if (u.pathname === "/config.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        'window.NADBYTECNA_SUPABASE={url:"https://offline.supabase.invalid",key:"synthetic-public"};' +
          (autoLogin
            ? 'sessionStorage.setItem("nadbytecna-admin",' +
              JSON.stringify(
                JSON.stringify({
                  access_token: token,
                  expires_at: Date.now() + 3600000,
                }),
              ) +
              ");"
            : ""),
      );
    }
    const routes = {
      "/api/admin/": admin,
      "/api/triage/": triage,
      "/api/retention/": retention,
      "/api/ai-worker/": worker,
      "/api/admin-mail/": adminMail,
      "/api/mail-sync/": mailSync,
      "/api/mail-connect/": mailConnect,
    };
    if (routes[u.pathname]) {
      try {
        return await routes[u.pathname](req, res);
      } catch {
        res.statusCode = 500;
        return res.end("{}");
      }
    }
    let p = path.join(root, "dist", decodeURIComponent(u.pathname));
    if (u.pathname.endsWith("/")) p = path.join(p, "index.html");
    if (
      !p.startsWith(path.join(root, "dist") + path.sep) ||
      !fs.existsSync(p) ||
      fs.statSync(p).isDirectory()
    ) {
      res.statusCode = 404;
      return res.end("404");
    }
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    res.setHeader(
      "Content-Type",
      types[path.extname(p)] || "application/octet-stream",
    );
    if (autoLogin && u.pathname === "/admin/")
      return res.end(
        fs
          .readFileSync(p, "utf8")
          .replace(
            '<main id="admin">',
            '<main id="admin"><p class="panel">Syntetický lokální náhled. Veškeré osoby a zprávy jsou smyšlené; žádné propojení s produkcí.</p>',
          ),
      );
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  if (autoLogin)
    process.env.SUPABASE_URL = "http://127.0.0.1:" + server.address().port;
  return {
    setAIResponse: (mode) => {
      aiMode = mode;
    },
    setMailResponse: (mode) => {
      mailMode = mode;
    },
    adapter,
    url: "http://127.0.0.1:" + server.address().port,
    db,
    metrics,
    storage,
    fetch: originalFetch,
    close: async () => {
      globalThis.fetch = originalFetch;
      await new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      });
      await db.close();
    },
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startAdminServer({ port: 4477 });
  console.log(s.url);
}
