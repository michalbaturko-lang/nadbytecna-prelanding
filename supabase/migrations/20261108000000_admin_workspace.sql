-- Prepared locally only. Compare owning production schema before approving application.
-- Original tables are external prerequisites; old clean-Postgres tests intentionally skip this migration.
DO $migration$
BEGIN
IF to_regclass('public.stories') IS NULL OR to_regclass('public.help_offers') IS NULL THEN RETURN; END IF;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS public.categories(code text PRIMARY KEY, name text NOT NULL, position int NOT NULL, active boolean NOT NULL DEFAULT true);
INSERT INTO public.categories(code,name,position) VALUES
('pribeh','Sdílej svůj příběh',1),('potencial','Nabídni svůj potenciál (hledám práci)',2),('prace','Nabídni práci',3),
('terapie','Nabídni terapii (psychoterapeuti, psychologové, psychiatři, fyzioterapeuti)',4),
('pravni','Nabídni právní pomoc (zástupci, vyjednávači, mediátoři)',5),('pridej_se','Nabídni pomoc – přidej se k nám',6),
('vyrobky','Nabídni své výrobky a služby',7),('potrebuji_pomoc','Potřebuji pomoc',8) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS private.admin_sessions(session_id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, last_seen timestamptz NOT NULL DEFAULT now(), revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS public.admin_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), at timestamptz NOT NULL DEFAULT now(), user_id uuid, email text, action text NOT NULL, entity text, entity_id uuid, diff jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.admin_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity text NOT NULL CHECK(entity IN ('stories','help_offers')), entity_id uuid NOT NULL, user_id uuid NOT NULL, author text NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS admin_notes_entity ON public.admin_notes(entity,entity_id);
CREATE TABLE IF NOT EXISTS public.status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity text NOT NULL, entity_id uuid NOT NULL, user_id uuid, author text, old_status text, new_status text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS status_history_entity ON public.status_history(entity,entity_id);
CREATE TABLE IF NOT EXISTS public.matches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE, offer_id uuid NOT NULL REFERENCES public.help_offers(id) ON DELETE CASCADE, source text NOT NULL DEFAULT 'manual' CHECK(source IN ('ai','manual')), score numeric CHECK(score BETWEEN 0 AND 1), status text NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','confirmed','rejected')), user_id uuid, at timestamptz NOT NULL DEFAULT now(), UNIQUE(story_id,offer_id));
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS consent_transcript boolean, ADD COLUMN IF NOT EXISTS consent_publish boolean;
ALTER TABLE public.help_offers ADD COLUMN IF NOT EXISTS consent_publish boolean;
END $migration$;

DO $migration$
DECLARE t text; p record;
BEGIN
IF to_regclass('public.stories') IS NULL OR to_regclass('public.help_offers') IS NULL THEN RETURN; END IF;
FOREACH t IN ARRAY ARRAY['stories','help_offers'] LOOP
EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS admin_category text REFERENCES public.categories(code), ADD COLUMN IF NOT EXISTS admin_urgency text CHECK(admin_urgency IN (''low'',''medium'',''high'',''acute'')), ADD COLUMN IF NOT EXISTS classified_by uuid, ADD COLUMN IF NOT EXISTS classified_email text, ADD COLUMN IF NOT EXISTS classified_at timestamptz, ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS opened_at timestamptz, ADD COLUMN IF NOT EXISTS last_contact_at timestamptz, ADD COLUMN IF NOT EXISTS consent_at timestamptz, ADD COLUMN IF NOT EXISTS consent_transcript_at timestamptz, ADD COLUMN IF NOT EXISTS consent_publish_at timestamptz, ADD COLUMN IF NOT EXISTS consent_version text, ADD COLUMN IF NOT EXISTS consent_texts jsonb, ADD COLUMN IF NOT EXISTS age_confirmed boolean, ADD COLUMN IF NOT EXISTS age_confirmed_at timestamptz, ADD COLUMN IF NOT EXISTS ai_error text, ADD COLUMN IF NOT EXISTS erasure_requested_at timestamptz, ADD COLUMN IF NOT EXISTS search_document tsvector',t);
EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',t,t||'_status_check');
EXECUTE format('UPDATE public.%I SET status = CASE status WHEN ''read'' THEN ''new'' WHEN ''resolved'' THEN ''archived'' ELSE status END WHERE status IN (''read'',''resolved'')',t);
EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK(status IN (''new'',''in_progress'',''contacted'',''published'',''archived''))',t,t||'_status_check');
-- Revoke broad legacy write policies. All writes through audited, server-only functions.
FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t); END LOOP;
EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
EXECUTE format('GRANT INSERT ON public.%I TO anon',t);
EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
EXECUTE format('CREATE POLICY public_submit ON public.%I FOR INSERT TO anon WITH CHECK(consent IS TRUE AND age_confirmed IS TRUE)',t);
END LOOP;
END $migration$;

DO $migration$
DECLARE t text; p record;
BEGIN
IF to_regclass('public.stories') IS NULL THEN RETURN; END IF;
-- Use unaccent/simple tokenization: Postgres does not ship a Czech stemmer.
CREATE EXTENSION IF NOT EXISTS unaccent;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.search_text(v text) RETURNS tsvector LANGUAGE sql STABLE SET search_path=public,extensions,pg_catalog AS $$ SELECT to_tsvector('simple', unaccent(coalesce(v,''))) $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
SELECT EXISTS(SELECT 1 FROM public.admins a JOIN auth.users u ON u.id=a.user_id JOIN public.admin_emails e ON e.email=lower(u.email) JOIN private.admin_sessions s ON s.user_id=u.id WHERE u.id=auth.uid() AND s.session_id=auth.jwt()->>'session_id' AND NOT s.revoked AND s.last_seen > now()-interval '12 hours')
$$ $sql$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT private.is_admin() $$ $sql$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
FOREACH t IN ARRAY ARRAY['stories','help_offers'] LOOP
EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING(private.is_admin())',t);
END LOOP;
FOREACH t IN ARRAY ARRAY['categories','admin_audit_log','admin_notes','status_history','matches','admins','admin_emails'] LOOP
FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t); END LOOP;
EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING(private.is_admin())',t);
END LOOP;
-- No public transcript-writing RPC.
IF to_regprocedure('public.save_transcript(uuid,text)') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.save_transcript(uuid,text) FROM PUBLIC, anon, authenticated; END IF;
IF to_regclass('storage.buckets') IS NOT NULL THEN
DROP POLICY IF EXISTS workspace_audio_server_only ON storage.objects;
CREATE POLICY workspace_audio_server_only ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id <> 'story-audio');
UPDATE storage.buckets SET public=false WHERE id='story-audio';
FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd='SELECT' LOOP
-- Review legacy storage policies before applying: only known story-audio policies removed here.
IF p.policyname IN ('admin read audio','admin read story audio','public read audio') THEN EXECUTE format('DROP POLICY %I ON storage.objects',p.policyname); END IF;
END LOOP;
END IF;
END $migration$;

DO $migration$
BEGIN
IF to_regclass('public.stories') IS NULL THEN RETURN; END IF;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.valid_audio_path(p_path text,p_id uuid) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
SELECT coalesce(p_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$' AND lower(split_part(p_path,'/',1))=p_id::text,false)
$$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE n jsonb; note_text text;
BEGIN
n := to_jsonb(NEW);
IF TG_TABLE_NAME='stories' THEN
  -- Legacy invalid paths remain readable as metadata, but no new binding or change may target another story's audio.
  IF NEW.audio_path IS NOT NULL AND (TG_OP='INSERT' OR NEW.audio_path IS DISTINCT FROM OLD.audio_path) AND NOT private.valid_audio_path(NEW.audio_path,NEW.id) THEN RAISE EXCEPTION 'audio_path'; END IF;
END IF;
IF TG_OP='INSERT' THEN
  NEW.status := 'new'; NEW.updated_at := now();
  IF current_user='anon' THEN
    -- Keep only public submission fields; clients cannot inject triage or internal metadata.
    n := n - ARRAY['ai_summary','ai_category','ai_category_confirmed','ai_urgency','ai_help_type','ai_model','ai_at','ai_matches','ai_error','admin_note','admin_category','admin_urgency','classified_by','classified_email','classified_at','opened_at','last_contact_at','erasure_requested_at','transcript','mail_sent_at'];
    NEW := jsonb_populate_record(NEW, (SELECT jsonb_object_agg(k,NULL) FROM unnest(ARRAY['ai_summary','ai_category','ai_category_confirmed','ai_urgency','ai_help_type','ai_model','ai_at','ai_matches','ai_error','admin_note','admin_category','admin_urgency','classified_by','classified_email','classified_at','opened_at','last_contact_at','erasure_requested_at','transcript','mail_sent_at']) k));
    NEW.created_at := now(); NEW.updated_at := now();
    NEW.consent_at := CASE WHEN NEW.consent THEN now() END;
    NEW.consent_publish_at := CASE WHEN NEW.consent_publish THEN now() END;
    NEW.age_confirmed_at := CASE WHEN NEW.age_confirmed THEN now() END;
    NEW.consent_version := '2026-11-07-v1';
    NEW.consent_texts := jsonb_build_object('processing', CASE WHEN TG_TABLE_NAME='stories' THEN 'Souhlasím se zpracováním příběhu včetně citlivých údajů o zdraví nebo násilí, pokud je v příběhu uvedu. Povinné.' ELSE 'Souhlasím se zpracováním nabídky pomoci. Povinné.' END, 'publish', CASE WHEN TG_TABLE_NAME='stories' THEN 'Chci svůj příběh zveřejnit' ELSE 'Chci svou nabídku zveřejnit' END,'age','Je mi 18 let');
    IF TG_TABLE_NAME='stories' THEN
      NEW.consent_transcript_at := CASE WHEN NEW.consent_transcript THEN now() END;
      NEW.consent_texts := NEW.consent_texts || jsonb_build_object('transcript','Souhlasím s přepisem hlasové zprávy na text. U audia povinné.');
    END IF;
  END IF;
ELSE
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.admin_category IS DISTINCT FROM OLD.admin_category OR NEW.admin_urgency IS DISTINCT FROM OLD.admin_urgency THEN NEW.updated_at := now(); END IF;
END IF;
IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') AND (NEW.consent_publish IS NOT TRUE OR NEW.age_confirmed IS NOT TRUE) THEN RAISE EXCEPTION 'publish_consent_required'; END IF;
IF TG_OP='UPDATE' AND (NEW.consent IS DISTINCT FROM OLD.consent OR NEW.consent_publish IS DISTINCT FROM OLD.consent_publish OR NEW.age_confirmed IS DISTINCT FROM OLD.age_confirmed OR NEW.consent_at IS DISTINCT FROM OLD.consent_at OR NEW.consent_publish_at IS DISTINCT FROM OLD.consent_publish_at OR NEW.age_confirmed_at IS DISTINCT FROM OLD.age_confirmed_at OR NEW.consent_version IS DISTINCT FROM OLD.consent_version OR NEW.consent_texts IS DISTINCT FROM OLD.consent_texts) THEN RAISE EXCEPTION 'consent_immutable'; END IF;
IF current_user <> 'anon' THEN SELECT string_agg(body,' ') INTO note_text FROM public.admin_notes WHERE entity=TG_TABLE_NAME AND entity_id=NEW.id; END IF;
n := to_jsonb(NEW);
NEW.search_document := private.search_text(concat_ws(' ',n->>'full_name',n->>'email',n->>'story_text',n->>'message',n->>'transcript',n->>'ai_summary',n->>'admin_note',note_text));
RETURN NEW;
END $$ $sql$;
DROP TRIGGER IF EXISTS stories_guard ON public.stories;
DROP TRIGGER IF EXISTS help_guard ON public.help_offers;
DROP TRIGGER IF EXISTS stories_clear_private ON public.stories;
DROP TRIGGER IF EXISTS help_clear_private ON public.help_offers;
DROP TRIGGER IF EXISTS workspace_guard ON public.stories;
DROP TRIGGER IF EXISTS workspace_guard ON public.help_offers;
CREATE TRIGGER workspace_guard BEFORE INSERT OR UPDATE ON public.stories FOR EACH ROW EXECUTE FUNCTION private.record_guard();
CREATE TRIGGER workspace_guard BEFORE INSERT OR UPDATE ON public.help_offers FOR EACH ROW EXECUTE FUNCTION private.record_guard();
UPDATE public.stories SET search_document=search_document;
UPDATE public.help_offers SET search_document=search_document;
CREATE INDEX IF NOT EXISTS stories_search ON public.stories USING gin(search_document);
CREATE INDEX IF NOT EXISTS help_offers_search ON public.help_offers USING gin(search_document);
END $migration$;

DO $migration$
BEGIN
IF to_regclass('public.stories') IS NULL THEN RETURN; END IF;
-- The service role deliberately has no broad read access to auth.users.
-- Expose only the verified identity predicate needed for allowlist enrollment.
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.verified_admin_identity(p_user_id uuid,p_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND lower(email)=lower(p_email) AND email_confirmed_at IS NOT NULL)
$$ $sql$;
REVOKE ALL ON FUNCTION private.verified_admin_identity(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.verified_admin_identity(uuid,text) TO service_role;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_access(p_user_id uuid,p_email text,p_session_id text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE s private.admin_sessions;
BEGIN
IF NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=lower(p_email)) OR NOT private.verified_admin_identity(p_user_id,p_email) THEN RETURN false; END IF;
SELECT * INTO s FROM private.admin_sessions WHERE session_id=p_session_id FOR UPDATE;
IF FOUND AND (s.revoked OR s.user_id<>p_user_id OR s.last_seen <= now()-interval '12 hours') THEN UPDATE private.admin_sessions SET revoked=true WHERE session_id=p_session_id; RETURN false; END IF;
INSERT INTO public.admins(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
IF s.session_id IS NULL THEN INSERT INTO public.admin_audit_log(user_id,email,action) VALUES(p_user_id,lower(p_email),'login'); END IF;
INSERT INTO private.admin_sessions(session_id,user_id) VALUES(p_session_id,p_user_id) ON CONFLICT(session_id) DO UPDATE SET last_seen=now();
RETURN true;
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_logout(p_session_id text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ UPDATE private.admin_sessions SET revoked=true WHERE session_id=p_session_id $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_mutate(p_entity text,p_id uuid,p_actor uuid,p_email text,p_patch jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE oldrow jsonb; newrow jsonb; k text;
BEGIN
IF p_entity NOT IN ('stories','help_offers') THEN RAISE EXCEPTION 'entity'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=lower(p_email)) THEN RAISE EXCEPTION 'admin'; END IF;
FOR k IN SELECT jsonb_object_keys(p_patch) LOOP IF k NOT IN ('status','admin_category','admin_urgency','opened_at','ai_summary','ai_category','ai_urgency','ai_help_type','ai_model','ai_at','ai_error') THEN RAISE EXCEPTION 'field'; END IF; END LOOP;
EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND erasure_requested_at IS NULL FOR UPDATE',p_entity) INTO oldrow USING p_id;
IF oldrow IS NULL THEN RAISE EXCEPTION 'missing'; END IF;
IF p_patch ? 'admin_category' AND (p_patch->>'admin_category') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE code=p_patch->>'admin_category' AND active) THEN RAISE EXCEPTION 'category'; END IF;
IF p_patch ? 'ai_category' AND NOT EXISTS(SELECT 1 FROM public.categories WHERE code=p_patch->>'ai_category' AND active) THEN RAISE EXCEPTION 'category'; END IF;
IF p_patch ? 'ai_urgency' AND p_patch->>'ai_urgency' NOT IN ('low','medium','high','acute') THEN RAISE EXCEPTION 'urgency'; END IF;
IF (oldrow||p_patch)->>'admin_category' IS DISTINCT FROM oldrow->>'admin_category' OR (oldrow||p_patch)->>'admin_urgency' IS DISTINCT FROM oldrow->>'admin_urgency' THEN
  IF (oldrow||p_patch)->>'admin_category' IS NULL AND (oldrow||p_patch)->>'admin_urgency' IS NULL THEN
    p_patch:=p_patch||jsonb_build_object('classified_by',NULL,'classified_email',NULL,'classified_at',NULL);
  ELSE p_patch:=p_patch||jsonb_build_object('classified_by',p_actor,'classified_email',p_email,'classified_at',now()); END IF;
END IF;
IF p_patch->>'status'='contacted' AND oldrow->>'status' IS DISTINCT FROM 'contacted' THEN p_patch:=p_patch||jsonb_build_object('last_contact_at',now()); END IF;
newrow := oldrow || p_patch;
EXECUTE format('UPDATE public.%I SET (status,admin_category,admin_urgency,classified_by,classified_email,classified_at,opened_at,last_contact_at,ai_summary,ai_category,ai_urgency,ai_help_type,ai_model,ai_at,ai_error)=(SELECT status,admin_category,admin_urgency,classified_by,classified_email,classified_at,opened_at,last_contact_at,ai_summary,ai_category,ai_urgency,ai_help_type,ai_model,ai_at,ai_error FROM jsonb_populate_record(NULL::public.%I,$2)) WHERE id=$1 RETURNING to_jsonb(%I)',p_entity,p_entity,p_entity) INTO newrow USING p_id,newrow;
IF oldrow->>'status' IS DISTINCT FROM newrow->>'status' THEN INSERT INTO public.status_history(entity,entity_id,user_id,author,old_status,new_status) VALUES(p_entity,p_id,p_actor,p_email,oldrow->>'status',newrow->>'status'); END IF;
-- No untrusted text in audit. Presence of AI fields is enough, never their content.
INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(p_actor,p_email,'update',p_entity,p_id,jsonb_build_object('status',newrow->>'status','category',newrow->>'admin_category','urgency',newrow->>'admin_urgency','ai_changed',p_patch?'ai_at'));
RETURN newrow - 'search_document';
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_note_save(p_entity text,p_id uuid,p_actor uuid,p_email text,p_body text,p_note_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE found_id uuid;
BEGIN
IF p_entity NOT IN ('stories','help_offers') OR length(trim(p_body)) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'note'; END IF;
EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND erasure_requested_at IS NULL FOR UPDATE',p_entity) INTO found_id USING p_id;
IF found_id IS NULL THEN RAISE EXCEPTION 'missing'; END IF;
IF p_note_id IS NULL THEN INSERT INTO public.admin_notes(entity,entity_id,user_id,author,body) VALUES(p_entity,p_id,p_actor,p_email,trim(p_body));
ELSE UPDATE public.admin_notes SET body=trim(p_body),updated_at=now() WHERE id=p_note_id AND entity=p_entity AND entity_id=p_id AND user_id=p_actor; IF NOT FOUND THEN RAISE EXCEPTION 'own_note_only'; END IF; END IF;
EXECUTE format('UPDATE public.%I SET updated_at=now() WHERE id=$1',p_entity) USING p_id;
INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id) VALUES(p_actor,p_email,'note',p_entity,p_id);
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_match_save(p_story uuid,p_offer uuid,p_status text,p_actor uuid,p_email text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
IF p_status NOT IN ('suggested','confirmed','rejected') THEN RAISE EXCEPTION 'status'; END IF;
PERFORM 1 FROM public.stories WHERE id=p_story AND erasure_requested_at IS NULL FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'missing'; END IF;
PERFORM 1 FROM public.help_offers WHERE id=p_offer AND erasure_requested_at IS NULL FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'missing'; END IF;
INSERT INTO public.matches(story_id,offer_id,status,user_id) VALUES(p_story,p_offer,p_status,p_actor) ON CONFLICT(story_id,offer_id) DO UPDATE SET status=p_status,user_id=p_actor,at=now();
INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(p_actor,p_email,'match','stories',p_story,jsonb_build_object('offer_id',p_offer,'status',p_status));
END $$ $sql$;
END $migration$;

DO $migration$
DECLARE f record;
BEGIN
IF to_regclass('public.stories') IS NULL THEN RETURN; END IF;
-- Drop first so a later column (greeting) does not make this file fail when it is applied again.
EXECUTE 'DROP VIEW IF EXISTS public.admin_records';
EXECUTE $sql$ CREATE VIEW public.admin_records WITH(security_invoker=true) AS
SELECT 'stories'::text entity,id,created_at,updated_at,full_name,email,NULL::text phone,anonymous,wants_to_help,input_type,NULL::text helper_type,status,coalesce(admin_category,ai_category) category,coalesce(admin_urgency,ai_urgency) urgency,admin_category,admin_urgency,classified_by,classified_email,classified_at,ai_summary,ai_category,ai_urgency,ai_help_type,ai_model,ai_at,ai_error,consent,consent_publish,consent_at,consent_transcript_at,consent_publish_at,consent_version,consent_texts,age_confirmed,age_confirmed_at,last_contact_at,opened_at,story_text body,transcript,audio_path,NULL::text links,admin_note,search_document,erasure_requested_at,
CASE WHEN status='published' THEN NULL ELSE created_at+interval '12 months' END delete_at, CASE coalesce(admin_urgency,ai_urgency) WHEN 'acute' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END urgency_rank, consent_transcript FROM public.stories
UNION ALL
SELECT 'help_offers',id,created_at,updated_at,full_name,email,phone,false,true,'text',helper_type,status,coalesce(admin_category,ai_category),coalesce(admin_urgency,ai_urgency),admin_category,admin_urgency,classified_by,classified_email,classified_at,ai_summary,ai_category,ai_urgency,ai_help_type,ai_model,ai_at,ai_error,consent,consent_publish,consent_at,consent_transcript_at,consent_publish_at,consent_version,consent_texts,age_confirmed,age_confirmed_at,last_contact_at,opened_at,message,NULL,NULL,links::text,admin_note,search_document,erasure_requested_at,coalesce(last_contact_at,created_at)+interval '24 months', CASE coalesce(admin_urgency,ai_urgency) WHEN 'acute' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END, NULL::boolean FROM public.help_offers $sql$;
REVOKE ALL ON public.admin_records FROM PUBLIC,anon;
GRANT SELECT ON public.admin_records TO authenticated,service_role;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_person(p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE result jsonb; legacy jsonb := '[]'::jsonb;
BEGIN
IF to_regclass('public.preregistrations') IS NOT NULL THEN
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(p)-''confirm_token_hash''),''[]''::jsonb) FROM public.preregistrations p WHERE p.email_normalized=lower(trim($1))' INTO legacy USING p_email;
END IF;
SELECT jsonb_build_object('records',coalesce(jsonb_agg(to_jsonb(r)-'search_document'),'[]'::jsonb),'notes',coalesce((SELECT jsonb_agg(to_jsonb(n)) FROM public.admin_notes n WHERE EXISTS(SELECT 1 FROM public.admin_records x WHERE lower(x.email)=lower(trim(p_email)) AND x.id=n.entity_id AND x.entity=n.entity)),'[]'::jsonb),'history',coalesce((SELECT jsonb_agg(to_jsonb(h)) FROM public.status_history h WHERE EXISTS(SELECT 1 FROM public.admin_records x WHERE lower(x.email)=lower(trim(p_email)) AND x.id=h.entity_id AND x.entity=h.entity)),'[]'::jsonb),'matches',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM public.matches m WHERE m.story_id IN(SELECT id FROM public.stories WHERE lower(email)=lower(trim(p_email))) OR m.offer_id IN(SELECT id FROM public.help_offers WHERE lower(email)=lower(trim(p_email)))),'[]'::jsonb),'signups',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.launch_signups l WHERE lower(l.email)=lower(trim(p_email))),'[]'::jsonb)) INTO result FROM public.admin_records r WHERE lower(r.email)=lower(trim(p_email));
RETURN result || jsonb_build_object('preregistrations',legacy);
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_erase(p_email text,p_hash text,p_actor uuid,p_actor_email text,p_mark_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
IF length(trim(p_email))<3 OR length(p_hash)<>64 THEN RAISE EXCEPTION 'email'; END IF;
IF p_mark_only THEN
UPDATE public.stories SET erasure_requested_at=now() WHERE lower(email)=lower(trim(p_email));
UPDATE public.help_offers SET erasure_requested_at=now() WHERE lower(email)=lower(trim(p_email));
RETURN jsonb_build_object('records',coalesce((SELECT jsonb_agg(to_jsonb(r)-'search_document') FROM public.admin_records r WHERE lower(r.email)=lower(trim(p_email)) AND r.erasure_requested_at IS NOT NULL),'[]'::jsonb));
END IF;
DELETE FROM public.admin_audit_log WHERE diff->>'offer_id' IN(SELECT id::text FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL);
DELETE FROM public.admin_audit_log WHERE (entity='stories' AND entity_id IN(SELECT id FROM public.stories WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL)) OR (entity='help_offers' AND entity_id IN(SELECT id FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL));
DELETE FROM public.admin_notes WHERE (entity='stories' AND entity_id IN(SELECT id FROM public.stories WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL)) OR (entity='help_offers' AND entity_id IN(SELECT id FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL));
DELETE FROM public.status_history WHERE (entity='stories' AND entity_id IN(SELECT id FROM public.stories WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL)) OR (entity='help_offers' AND entity_id IN(SELECT id FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL));
DELETE FROM public.matches WHERE story_id IN(SELECT id FROM public.stories WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL) OR offer_id IN(SELECT id FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL);
DELETE FROM private.ai_jobs WHERE (entity='stories' AND entity_id IN(SELECT id FROM public.stories WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL)) OR (entity='help_offers' AND entity_id IN(SELECT id FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL));
DELETE FROM public.stories WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL;
DELETE FROM public.help_offers WHERE lower(email)=lower(trim(p_email)) AND erasure_requested_at IS NOT NULL;
DELETE FROM public.launch_signups WHERE lower(email)=lower(trim(p_email));
IF to_regclass('public.preregistrations') IS NOT NULL THEN EXECUTE 'DELETE FROM public.preregistrations WHERE email_normalized=lower(trim($1))' USING p_email; END IF;
INSERT INTO public.admin_audit_log(user_id,email,action,diff) VALUES(p_actor,p_actor_email,'erase_person',jsonb_build_object('email_hash',p_hash));
RETURN jsonb_build_object('ok',true);
END $$ $sql$;
-- Restrict every privileged RPC (PUBLIC receives EXECUTE by default).
FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('admin_access','admin_logout','admin_mutate','admin_note_save','admin_match_save','admin_person','admin_erase') LOOP
EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
END LOOP;
GRANT ALL ON private.admin_sessions TO service_role;
GRANT SELECT,DELETE ON public.launch_signups TO service_role;
IF to_regclass('public.preregistrations') IS NOT NULL THEN GRANT SELECT,DELETE ON public.preregistrations TO service_role; END IF;
END $migration$;

DO $migration$
DECLARE f record;
BEGIN
IF to_regclass('public.stories') IS NULL THEN RETURN; END IF;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS audio_delete_pending boolean NOT NULL DEFAULT false;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_retention_mark(p_entity text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE r jsonb;
BEGIN
IF p_entity='stories' THEN
 UPDATE public.stories SET erasure_requested_at=now() WHERE id=p_id AND status<>'published' AND created_at<=now()-interval '12 months' RETURNING jsonb_build_object('audio_path',audio_path) INTO r;
ELSIF p_entity='help_offers' THEN
 UPDATE public.help_offers SET erasure_requested_at=now() WHERE id=p_id AND coalesce(last_contact_at,created_at)<=now()-interval '24 months' RETURNING '{}'::jsonb INTO r;
ELSE RAISE EXCEPTION 'entity'; END IF;
RETURN r;
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_retention_finish(p_entity text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE r uuid;
BEGIN
IF p_entity='stories' THEN
 DELETE FROM public.stories WHERE id=p_id AND erasure_requested_at IS NOT NULL AND status<>'published' AND created_at<=now()-interval '12 months' RETURNING id INTO r;
ELSIF p_entity='help_offers' THEN
 DELETE FROM public.help_offers WHERE id=p_id AND erasure_requested_at IS NOT NULL AND coalesce(last_contact_at,created_at)<=now()-interval '24 months' RETURNING id INTO r;
ELSE RAISE EXCEPTION 'entity'; END IF;
IF r IS NULL THEN RETURN false; END IF;
DELETE FROM private.ai_jobs WHERE entity=p_entity AND entity_id=p_id;
DELETE FROM public.admin_notes WHERE entity=p_entity AND entity_id=p_id;
DELETE FROM public.status_history WHERE entity=p_entity AND entity_id=p_id;
DELETE FROM public.admin_audit_log WHERE entity=p_entity AND entity_id=p_id;
INSERT INTO public.admin_audit_log(action,diff) VALUES('retention_delete',jsonb_build_object('entity',p_entity));
RETURN true;
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_audio_retention_claim(p_id uuid,p_path text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
IF NOT private.valid_audio_path(p_path,p_id) THEN RAISE EXCEPTION 'audio_path'; END IF;
UPDATE public.stories SET audio_delete_pending=true WHERE id=p_id AND audio_path=p_path AND (transcript IS NOT NULL OR created_at<=now()-interval '30 days');
RETURN FOUND;
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_audio_retention_finish(p_id uuid,p_path text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
UPDATE public.stories SET audio_path=NULL,audio_delete_pending=false WHERE id=p_id AND audio_path=p_path AND audio_delete_pending;
IF FOUND THEN INSERT INTO public.admin_audit_log(action,entity,entity_id) VALUES('retention_audio','stories',p_id); END IF;
END $$ $sql$;
FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('admin_retention_mark','admin_retention_finish','admin_audio_retention_claim','admin_audio_retention_finish') LOOP
EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
END LOOP;
END $migration$;

DO $migration$
DECLARE f record;
BEGIN
IF to_regclass('public.stories') IS NULL THEN RETURN; END IF;
CREATE TABLE IF NOT EXISTS private.ai_jobs(entity text NOT NULL CHECK(entity IN('stories','help_offers')),entity_id uuid NOT NULL,attempts int NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,done boolean NOT NULL DEFAULT false,PRIMARY KEY(entity,entity_id));
GRANT ALL ON private.ai_jobs TO service_role;
-- Definer narrowly enqueues identifiers, does not process or expose any story content.
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.enqueue_ai() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN INSERT INTO private.ai_jobs(entity,entity_id) VALUES(TG_TABLE_NAME,NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$ $sql$;
REVOKE ALL ON FUNCTION private.enqueue_ai() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS workspace_ai_enqueue ON public.stories;
DROP TRIGGER IF EXISTS workspace_ai_enqueue ON public.help_offers;
CREATE TRIGGER workspace_ai_enqueue AFTER INSERT ON public.stories FOR EACH ROW EXECUTE FUNCTION private.enqueue_ai();
CREATE TRIGGER workspace_ai_enqueue AFTER INSERT ON public.help_offers FOR EACH ROW EXECUTE FUNCTION private.enqueue_ai();
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_ai_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE j private.ai_jobs;
BEGIN
SELECT * INTO j FROM private.ai_jobs WHERE NOT done AND attempts<3 AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED;
IF NOT FOUND THEN RETURN NULL; END IF;
UPDATE private.ai_jobs SET attempts=attempts+1,lease_until=now()+interval '5 minutes' WHERE entity=j.entity AND entity_id=j.entity_id;
RETURN jsonb_build_object('entity',j.entity,'id',j.entity_id,'attempt',j.attempts+1);
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_ai_finish(p_entity text,p_id uuid,p_output jsonb,p_error boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
IF p_entity NOT IN('stories','help_offers') THEN RAISE EXCEPTION 'entity'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.admin_records WHERE entity=p_entity AND id=p_id AND erasure_requested_at IS NULL) THEN DELETE FROM private.ai_jobs WHERE entity=p_entity AND entity_id=p_id; RETURN; END IF;
IF p_error THEN
EXECUTE format('UPDATE public.%I SET ai_error=''triage_failed'' WHERE id=$1 AND erasure_requested_at IS NULL',p_entity) USING p_id;
UPDATE private.ai_jobs SET done=attempts>=3,lease_until=NULL,available_at=now()+interval '5 minutes' WHERE entity=p_entity AND entity_id=p_id;
ELSE
IF p_output->>'category' IS NULL OR NOT EXISTS(SELECT 1 FROM public.categories WHERE code=p_output->>'category' AND active) OR p_output->>'urgency' NOT IN('low','medium','high','acute') THEN RAISE EXCEPTION 'triage'; END IF;
EXECUTE format('UPDATE public.%I SET ai_summary=$2,ai_category=$3,ai_urgency=$4,ai_help_type=$5,ai_model=$6,ai_at=now(),ai_error=NULL WHERE id=$1 AND erasure_requested_at IS NULL',p_entity) USING p_id,p_output->>'summary',p_output->>'category',p_output->>'urgency',p_output->>'help_type',p_output->>'model';
UPDATE private.ai_jobs SET done=true,lease_until=NULL WHERE entity=p_entity AND entity_id=p_id;
END IF;
INSERT INTO public.admin_audit_log(action,entity,entity_id,diff) VALUES('automatic_ai',p_entity,p_id,jsonb_build_object('error',p_error));
END $$ $sql$;
FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('admin_ai_claim','admin_ai_finish') LOOP
EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
END LOOP;
END $migration$;
