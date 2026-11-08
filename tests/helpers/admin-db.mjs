// Local PostgreSQL reconstruction from the read-only production metadata captured 2026-11-07.
// Auth and Storage runtime remain minimal stubs; this is not a hosted Supabase branch.
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
export const ADMIN = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const SESSION = "33333333-3333-4333-8333-333333333333";
export const STORY = "44444444-4444-4444-8444-444444444444";
export const OFFER = "55555555-5555-4555-8555-555555555555";
export const ADMIN_SCHEMA = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/admin-schema-2026-11-07.json", import.meta.url),
    "utf8",
  ),
);
const migrations = new URL("../../supabase/migrations/", import.meta.url);
const workspaceMigration = new URL(
  "20261108000000_admin_workspace.sql",
  migrations,
);
const ident = (value) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error("fixture_identifier");
  return '"' + value + '"';
};
export async function installOptionalPreregistrations(db) {
  // Explicit legacy fixture only. The captured production project has no such table.
  await db.exec(
    fs.readFileSync(
      new URL("20261103000000_preregistrations.sql", migrations),
      "utf8",
    ),
  );
  await db.exec(
    "GRANT SELECT,DELETE ON public.preregistrations TO service_role",
  );
}
export async function applyAdminWorkspace(db) {
  await db.exec(fs.readFileSync(workspaceMigration, "utf8"));
  await db.exec(fs.readFileSync(new URL("20261108180637_audio_consent_version.sql", migrations), "utf8"));
}
export async function freshAdminDb({
  optionalPreregistrations = false,
  applyWorkspace = true,
} = {}) {
  const db = new PGlite({ extensions: { unaccent } });
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
    GRANT SELECT,INSERT ON storage.objects TO anon,authenticated;`);
  const types = {
    text: "text",
    uuid: "uuid",
    timestamptz: "timestamptz",
    bool: "boolean",
    _text: "text[]",
  };
  const tables = [...new Set(ADMIN_SCHEMA.columns.map((c) => c.table))];
  for (const table of tables) {
    const columns = ADMIN_SCHEMA.columns
      .filter((c) => c.table === table)
      .map((c) => {
        if (!types[c.udt]) throw new Error("fixture_type");
        return (
          ident(c.column) +
          " " +
          types[c.udt] +
          (c.default !== null ? " DEFAULT " + c.default : "") +
          (c.nullable === "NO" ? " NOT NULL" : "")
        );
      });
    await db.exec(
      "CREATE TABLE public." + ident(table) + "(" + columns.join(",") + ")",
    );
  }
  for (const c of ADMIN_SCHEMA.constraints)
    await db.exec(
      "ALTER TABLE public." +
        ident(c.table) +
        " ADD CONSTRAINT " +
        ident(c.name) +
        " " +
        c.definition,
    );
  for (const f of ADMIN_SCHEMA.functions) await db.exec(f.definition);
  for (const table of tables)
    await db.exec(
      "ALTER TABLE public." +
        ident(table) +
        " ENABLE ROW LEVEL SECURITY; ALTER TABLE public." +
        ident(table) +
        " FORCE ROW LEVEL SECURITY; REVOKE ALL ON public." +
        ident(table) +
        " FROM PUBLIC,anon,authenticated",
    );
  for (const p of ADMIN_SCHEMA.policies) {
    const roles = p.roles.map(ident).join(",");
    await db.exec(
      "GRANT " +
        p.cmd +
        " ON " +
        ident(p.schemaname) +
        "." +
        ident(p.tablename) +
        " TO " +
        roles,
    );
    await db.exec(
      "CREATE POLICY " +
        ident(p.policyname.replaceAll(" ", "_")) +
        " ON " +
        ident(p.schemaname) +
        "." +
        ident(p.tablename) +
        " AS " +
        p.permissive +
        " FOR " +
        p.cmd +
        " TO " +
        roles +
        (p.qual ? " USING (" + p.qual + ")" : "") +
        (p.with_check ? " WITH CHECK (" + p.with_check + ")" : ""),
    );
  }
  // Preserve original policy names: the new migration intentionally replaces known Storage policies.
  for (const p of ADMIN_SCHEMA.policies)
    if (p.policyname.includes(" "))
      await db.exec(
        "ALTER POLICY " +
          ident(p.policyname.replaceAll(" ", "_")) +
          " ON " +
          ident(p.schemaname) +
          "." +
          ident(p.tablename) +
          ' RENAME TO "' +
          p.policyname +
          '"',
      );
  const triggers = new Map();
  for (const t of ADMIN_SCHEMA.triggers) {
    const key = t.event_object_table + ":" + t.trigger_name;
    const group = triggers.get(key) || { ...t, events: [] };
    group.events.push(t.event_manipulation);
    triggers.set(key, group);
  }
  for (const t of triggers.values())
    await db.exec(
      "CREATE TRIGGER " +
        ident(t.trigger_name) +
        " " +
        t.action_timing +
        " " +
        t.events.join(" OR ") +
        " ON public." +
        ident(t.event_object_table) +
        " FOR EACH ROW " +
        t.action_statement,
    );
  for (const bucket of ADMIN_SCHEMA.bucket)
    await db.query("INSERT INTO storage.buckets VALUES($1,$2,$3,$4)", [
      bucket.id,
      bucket.public,
      bucket.file_size_limit,
      "{" + bucket.allowed_mime_types.join(",") + "}",
    ]);
  // No SELECT grant on auth.users: matches can_verify_user=false in the captured metadata.
  await db.exec(
    "REVOKE ALL ON auth.users FROM PUBLIC,anon,authenticated,service_role",
  );
  if (optionalPreregistrations) await installOptionalPreregistrations(db);
  if (applyWorkspace) await applyAdminWorkspace(db);
  await db.query(
    `INSERT INTO auth.users VALUES($1,'admin@example.invalid',now()),($2,'other@example.invalid',now())`,
    [ADMIN, OTHER],
  );
  await db.exec(
    `INSERT INTO public.admin_emails(email) VALUES('admin@example.invalid')`,
  );
  return db;
}
export async function seed(db) {
  await db.query(
    `INSERT INTO public.stories(id,full_name,email,input_type,story_text,consent,consent_publish,age_confirmed,consent_at,consent_publish_at,consent_version) VALUES($1,'Ukázková osoba','osoba@example.invalid','text','Výhradně syntetický příběh o hledání práce.',true,true,true,now(),now(),'2026-11-07-v1')`,
    [STORY],
  );
  await db.query(
    `INSERT INTO public.help_offers(id,full_name,email,message,consent,helper_type,help_kinds) VALUES($1,'Ukázkový pomocník','pomoc@example.invalid','Syntetická nabídka práce.',true,'professional',ARRAY['prace'])`,
    [OFFER],
  );
}
