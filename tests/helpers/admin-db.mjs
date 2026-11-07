// Local reconstruction from the brief, not a production schema dump.
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
export const ADMIN = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const SESSION = "33333333-3333-4333-8333-333333333333";
export const STORY = "44444444-4444-4444-8444-444444444444";
export const OFFER = "55555555-5555-4555-8555-555555555555";
export async function freshAdminDb() {
  const db = new PGlite({ extensions: { unaccent } });
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE TABLE public.admins(user_id uuid PRIMARY KEY REFERENCES auth.users(id));
 CREATE TABLE public.stories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now(),full_name text,email text,anonymous boolean DEFAULT false,wants_to_help boolean DEFAULT false,input_type text DEFAULT 'text',story_text text,audio_path text,transcript text,consent boolean,consent_transcript boolean,consent_publish boolean,status text DEFAULT 'new',mail_sent_at timestamptz);
 CREATE TABLE public.help_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now(),full_name text,email text,phone text,helper_type text,help_kinds text[],message text,links text,consent boolean,consent_publish boolean,status text DEFAULT 'new',mail_sent_at timestamptz);
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean); INSERT INTO storage.buckets VALUES('story-audio',false);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT SELECT,INSERT ON storage.objects TO anon,authenticated;
 GRANT SELECT ON auth.users TO service_role;
 CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  await db
    .query(
      `INSERT INTO auth.users VALUES ($1,'admin@example.invalid',now()),($2,'other@example.invalid',now()); INSERT INTO public.admin_emails(email) VALUES('admin@example.invalid');`,
      [ADMIN, OTHER],
    )
    .catch(async () => {
      await db.query(
        `INSERT INTO auth.users VALUES ($1,'admin@example.invalid',now()),($2,'other@example.invalid',now())`,
        [ADMIN, OTHER],
      );
      await db.exec(
        `INSERT INTO public.admin_emails(email) VALUES('admin@example.invalid')`,
      );
    });
  return db;
}
export async function seed(db) {
  await db.query(
    `INSERT INTO public.stories(id,full_name,email,story_text,consent,consent_publish,age_confirmed,consent_at,consent_publish_at,consent_version) VALUES($1,'Ukázková osoba','osoba@example.invalid','Výhradně syntetický příběh o hledání práce.',true,true,true,now(),now(),'2026-11-07-v1')`,
    [STORY],
  );
  await db.query(
    `INSERT INTO public.help_offers(id,full_name,email,message,consent,helper_type,help_kinds) VALUES($1,'Ukázkový pomocník','pomoc@example.invalid','Syntetická nabídka práce.',true,'professional',ARRAY['prace'])`,
    [OFFER],
  );
}
