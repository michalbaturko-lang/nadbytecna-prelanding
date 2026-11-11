-- Local mail labels only. No source messages, workflow statuses or Microsoft data are changed.
DO $migration$
DECLARE definition text; needle text;
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
ALTER TABLE public.email_threads
 ADD COLUMN IF NOT EXISTS rules_revision integer,
 ADD COLUMN IF NOT EXISTS rules_version text CHECK(length(rules_version)<=100),
 ADD COLUMN IF NOT EXISTS rules_at timestamptz,
 ADD COLUMN IF NOT EXISTS rules_disposition text CHECK(rules_disposition IN('normal','suspect','review')),
 ADD COLUMN IF NOT EXISTS rules_reason text CHECK(length(rules_reason)<=300),
 ADD COLUMN IF NOT EXISTS manual_disposition text CHECK(manual_disposition IN('normal','suspect','review'));
CREATE TABLE IF NOT EXISTS private.mail_thread_labels(
 thread_id uuid NOT NULL REFERENCES public.email_threads(id) ON DELETE CASCADE,
 code text NOT NULL,
 source text NOT NULL CHECK(source IN('rule','manual')),
 active boolean NOT NULL DEFAULT true,
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=240),
 version text CHECK(length(version)<=100),
 revision integer,
 actor uuid,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(thread_id,code,source)
);
CREATE INDEX IF NOT EXISTS mail_thread_labels_code ON private.mail_thread_labels(code,thread_id) WHERE active;
ALTER TABLE private.mail_thread_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mail_thread_labels FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.mail_thread_labels FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.mail_thread_labels TO service_role;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_label_valid(p_code text) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_code IN('personal_story','request_help','offer_help','press','partnership','operational','newsletter','automated','work','legal','psychological_support','payment_change','verify','review','attachment','spam','suspected_fraud','other')
$$ $ddl$;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_disposition(p_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT coalesce(t.manual_disposition,CASE WHEN t.rules_revision=t.revision THEN t.rules_disposition END,'normal') FROM public.email_threads t WHERE t.id=p_id
$$ $ddl$;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_rules_fields(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'labels',coalesce((SELECT jsonb_agg(jsonb_build_object('code',x.code,'source',x.source,'reason',x.reason) ORDER BY x.code)
   FROM (SELECT DISTINCT ON(l.code) l.code,l.source,l.reason,l.active
    FROM private.mail_thread_labels l WHERE l.thread_id=t.id AND (l.source='manual' OR (l.source='rule' AND t.rules_revision=t.revision AND l.revision=t.revision))
    ORDER BY l.code,CASE l.source WHEN 'manual' THEN 0 ELSE 1 END) x WHERE x.active),'[]'::jsonb),
  'disposition',private.mail_disposition(t.id),
  'disposition_source',CASE WHEN t.manual_disposition IS NOT NULL THEN 'manual' WHEN t.rules_revision=t.revision AND t.rules_disposition IS NOT NULL THEN 'rule' ELSE 'default' END,
  'rule_reason',CASE WHEN t.rules_revision=t.revision THEN coalesce(t.rules_reason,'') ELSE '' END,
  'rules_version',t.rules_version,'rules_revision',t.rules_revision)
 FROM public.email_threads t WHERE t.id=p_id
$$ $ddl$;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_rules_pending(p_limit integer,p_version text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 OR p_version IS NULL OR p_version!~'^[A-Za-z0-9_.:-]{1,100}$' THEN RAISE EXCEPTION 'mail_rules_invalid'; END IF;
 WITH pending AS (
  SELECT t.id,t.revision,t.last_received_at,CASE WHEN t.rules_revision IS DISTINCT FROM t.revision THEN 0 ELSE 1 END rules_priority FROM public.email_threads t WHERE (t.rules_revision IS DISTINCT FROM t.revision OR t.rules_version IS DISTINCT FROM p_version)
   AND EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=t.id AND m.source_removed_at IS NULL)
  ORDER BY CASE WHEN t.rules_revision IS DISTINCT FROM t.revision THEN 0 ELSE 1 END,t.last_received_at DESC NULLS LAST,t.id LIMIT p_limit
 ), snapshots AS (
  SELECT t.*,context.messages,(SELECT count(*) FROM public.email_messages m WHERE m.thread_id=t.id AND m.source_removed_at IS NULL) message_count
  FROM pending t CROSS JOIN LATERAL (
   WITH recent AS (
    SELECT m.id,m.received_at,left(m.subject,512) subject,length(m.subject)>512 subject_cut,
     left(m.body_text,20000) body_text,length(m.body_text)>20000 OR coalesce(m.body_truncated,false) body_cut,
     m.sender_email,m.sender_name,m.has_attachments
    FROM public.email_messages m WHERE m.thread_id=t.id AND m.source_removed_at IS NULL ORDER BY m.received_at DESC,m.id DESC LIMIT 10
   ), budgeted AS (
    SELECT *,coalesce(sum(length(subject)+length(body_text)+8) OVER(ORDER BY received_at DESC,id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) spent FROM recent
   ) SELECT coalesce(jsonb_agg(jsonb_build_object('subject',left(subject,greatest(0,20000-spent)::int),
    'body_text',left(body_text,greatest(0,20000-spent-length(subject)-8)::int),
    'sender_email',sender_email,'sender_name',sender_name,'has_attachments',has_attachments,
    'body_truncated',body_cut OR subject_cut OR length(body_text)>greatest(0,20000-spent-length(subject)-8),
    'received_at',received_at) ORDER BY received_at,id),'[]'::jsonb) messages FROM budgeted WHERE spent<20000
  ) context
 ) SELECT jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'messages',messages,
   'message_count',message_count,'context_truncated',message_count>jsonb_array_length(messages) OR EXISTS(SELECT 1 FROM jsonb_array_elements(messages) m WHERE (m->>'body_truncated')::boolean)) ORDER BY rules_priority,last_received_at DESC NULLS LAST,id),'[]'::jsonb)) INTO result FROM snapshots;
 RETURN result;
END $$ $ddl$;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_rules_apply(p_thread uuid,p_revision integer,p_version text,p_labels jsonb,p_disposition text,p_reason text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE t public.email_threads; label jsonb; n integer;
BEGIN
 IF p_revision IS NULL OR p_revision<1 OR p_version IS NULL OR p_version!~'^[A-Za-z0-9_.:-]{1,100}$' OR p_disposition IS NULL OR p_disposition NOT IN('normal','suspect','review') OR p_reason IS NULL OR length(p_reason)>300 OR jsonb_typeof(p_labels) IS DISTINCT FROM 'array' OR jsonb_array_length(p_labels)>18 THEN RAISE EXCEPTION 'mail_rules_invalid'; END IF;
 FOR label IN SELECT value FROM jsonb_array_elements(p_labels) LOOP
  IF jsonb_typeof(label) IS DISTINCT FROM 'object' OR jsonb_typeof(label->'code') IS DISTINCT FROM 'string' OR NOT private.mail_label_valid(label->>'code') OR jsonb_typeof(label->'reason') IS DISTINCT FROM 'string' OR length(label->>'reason')>240 OR EXISTS(SELECT 1 FROM jsonb_object_keys(label) k WHERE k NOT IN('code','reason')) THEN RAISE EXCEPTION 'mail_rules_label'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(p_labels))<>(SELECT count(DISTINCT value->>'code') FROM jsonb_array_elements(p_labels)) THEN RAISE EXCEPTION 'mail_rules_label'; END IF;
 PERFORM pg_advisory_xact_lock(84301720261107);
 SELECT * INTO t FROM public.email_threads WHERE id=p_thread FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'reason','missing'); END IF;
 IF t.revision<>p_revision THEN RETURN jsonb_build_object('applied',false,'reason','changed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=t.id AND m.source_removed_at IS NULL) THEN RETURN jsonb_build_object('applied',false,'reason','inactive'); END IF;
 IF t.rules_revision=t.revision AND t.rules_version=p_version THEN RETURN jsonb_build_object('applied',false,'reason','unchanged'); END IF;
 -- A thread can only be automatically hidden with complete context; partial/mixed threads are reviewed.
 IF p_disposition='suspect' AND ((SELECT count(*) FROM public.email_messages m WHERE m.thread_id=t.id AND m.source_removed_at IS NULL)<>1 OR EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=t.id AND m.source_removed_at IS NULL AND (coalesce(m.body_truncated,false) OR length(m.body_text)>20000 OR length(m.subject)>512))) THEN p_disposition:='review'; END IF;
 DELETE FROM private.mail_thread_labels WHERE thread_id=t.id AND source='rule';
 INSERT INTO private.mail_thread_labels(thread_id,code,source,reason,version,revision)
  SELECT t.id,value->>'code','rule',value->>'reason',p_version,t.revision FROM jsonb_array_elements(p_labels);
 UPDATE public.email_threads SET rules_revision=revision,rules_version=p_version,rules_at=now(),rules_disposition=p_disposition,rules_reason=p_reason WHERE id=t.id;
 INSERT INTO public.admin_audit_log(action,entity,entity_id,diff) VALUES('mail_rules','email_threads',t.id,jsonb_build_object('version',p_version,'revision',t.revision,'labels',jsonb_array_length(p_labels),'disposition',p_disposition));
 RETURN jsonb_build_object('applied',true)||private.mail_rules_fields(t.id);
END $$ $ddl$;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_labels_manual(p_id uuid,p_revision integer,p_add text[] DEFAULT '{}',p_remove text[] DEFAULT '{}',p_disposition text DEFAULT NULL,p_actor uuid DEFAULT NULL,p_email text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE t public.email_threads; label_code text;
BEGIN
 IF p_revision IS NULL OR p_revision<1 OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_actor) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=p_email) OR NOT private.verified_admin_identity(p_actor,p_email) THEN RAISE EXCEPTION 'mail_labels_identity'; END IF;
 IF cardinality(coalesce(p_add,'{}'))>18 OR cardinality(coalesce(p_remove,'{}'))>18 OR (p_disposition IS NOT NULL AND p_disposition NOT IN('normal','suspect','review','auto')) OR EXISTS(SELECT 1 FROM unnest(coalesce(p_add,'{}')||coalesce(p_remove,'{}')) c WHERE c IS NULL OR NOT private.mail_label_valid(c)) OR coalesce(p_add,'{}')&&coalesce(p_remove,'{}') THEN RAISE EXCEPTION 'mail_rules_label'; END IF;
 PERFORM pg_advisory_xact_lock(84301720261107);
 SELECT * INTO t FROM public.email_threads WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','missing'); END IF;
 IF t.revision<>p_revision THEN RETURN jsonb_build_object('saved',false,'reason','changed'); END IF;
 FOREACH label_code IN ARRAY coalesce(p_add,'{}') LOOP
  INSERT INTO private.mail_thread_labels(thread_id,code,source,active,reason,actor) VALUES(t.id,label_code,'manual',true,'Ruční zařazení.',p_actor)
  ON CONFLICT(thread_id,code,source) DO UPDATE SET active=true,actor=p_actor,updated_at=now();
 END LOOP;
 FOREACH label_code IN ARRAY coalesce(p_remove,'{}') LOOP
  INSERT INTO private.mail_thread_labels(thread_id,code,source,active,reason,actor) VALUES(t.id,label_code,'manual',false,'Ruční odebrání štítku.',p_actor)
  ON CONFLICT(thread_id,code,source) DO UPDATE SET active=false,actor=p_actor,updated_at=now();
 END LOOP;
 IF p_disposition IS NOT NULL THEN UPDATE public.email_threads SET manual_disposition=nullif(p_disposition,'auto') WHERE id=t.id; END IF;
 INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(p_actor,p_email,'mail_labels_manual','email_threads',t.id,jsonb_build_object('added',coalesce(p_add,'{}'),'removed',coalesce(p_remove,'{}'),'disposition',p_disposition));
 RETURN jsonb_build_object('saved',true)||private.mail_rules_fields(t.id);
END $$ $ddl$;

-- Forget derived labels/inferences when any source message is actually erased.
-- Normal new replies and source-removed markers keep explicit human choices.
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_rules_delete_lock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(84301720261107);
 RETURN NULL;
END $$ $ddl$;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_rules_forget_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM private.mail_thread_labels WHERE thread_id=OLD.thread_id;
 UPDATE public.email_threads SET rules_revision=NULL,rules_version=NULL,rules_at=NULL,rules_disposition=NULL,rules_reason=NULL,manual_disposition=NULL WHERE id=OLD.thread_id;
 DELETE FROM public.admin_audit_log WHERE entity='email_threads' AND entity_id=OLD.thread_id AND action IN('mail_rules','mail_labels_manual');
 -- Refresh increments the revision, so a pending pre-erasure result cannot restore an inference.
 -- A parent-thread cascade is already absent and must never be recreated.
 IF EXISTS(SELECT 1 FROM public.email_threads WHERE id=OLD.thread_id) THEN PERFORM private.mail_refresh_thread(OLD.thread_id); END IF;
 RETURN OLD;
END $$ $ddl$;
DROP TRIGGER IF EXISTS mail_rules_delete_lock ON public.email_messages;
CREATE TRIGGER mail_rules_delete_lock BEFORE DELETE ON public.email_messages FOR EACH STATEMENT EXECUTE FUNCTION private.mail_rules_delete_lock();
DROP TRIGGER IF EXISTS mail_rules_forget_source ON public.email_messages;
CREATE TRIGGER mail_rules_forget_source AFTER DELETE ON public.email_messages FOR EACH ROW EXECUTE FUNCTION private.mail_rules_forget_source();
REVOKE ALL ON FUNCTION private.mail_rules_delete_lock(),private.mail_rules_forget_source() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mail_rules_delete_lock(),private.mail_rules_forget_source() TO service_role;

REVOKE ALL ON FUNCTION private.mail_label_valid(text),private.mail_disposition(uuid),private.mail_rules_fields(uuid),public.mail_rules_pending(integer,text),public.mail_rules_apply(uuid,integer,text,jsonb,text,text),public.mail_labels_manual(uuid,integer,text[],text[],text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mail_label_valid(text),private.mail_disposition(uuid),private.mail_rules_fields(uuid),public.mail_rules_pending(integer,text),public.mail_rules_apply(uuid,integer,text,jsonb,text,text),public.mail_labels_manual(uuid,integer,text[],text[],text,uuid,text) TO service_role;

IF to_regprocedure('public.mail_list_sorted(jsonb)') IS NOT NULL THEN
 SELECT pg_get_functiondef('public.mail_list_sorted(jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,'mail_rules_fields')=0 THEN
  needle:='FROM public.email_threads x WHERE';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'mail_rules_list_changed'; END IF;
  definition:=replace(definition,needle,$new$FROM public.email_threads x WHERE
   (nullif(f->>'label','') IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(private.mail_rules_fields(x.id)->'labels') l WHERE l->>'code'=f->>'label')) AND
   (coalesce(nullif(f->>'disposition',''),'all')='all' OR (f->>'disposition'='normal' AND private.mail_disposition(x.id) IN('normal','review')) OR (f->>'disposition' IN('suspect','review') AND private.mail_disposition(x.id)=f->>'disposition')) AND$new$);
  needle:='jsonb_build_object(''preview'',';
  IF strpos(definition,needle)=0 THEN needle:='jsonb_build_object(''category'',effective_category,'; END IF;
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_rules_list_fields_changed'; END IF;
  definition:=replace(definition,needle,'private.mail_rules_fields(page.id)||'||needle);
  needle:='sorting:=coalesce';
  definition:=replace(definition,needle,$new$IF nullif(f->>'label','') IS NOT NULL AND NOT private.mail_label_valid(f->>'label') THEN RAISE EXCEPTION 'mail_filter'; END IF;
 IF nullif(f->>'disposition','') IS NOT NULL AND f->>'disposition' NOT IN('all','normal','suspect','review') THEN RAISE EXCEPTION 'mail_filter'; END IF;
 sorting:=coalesce$new$);
  EXECUTE definition;
 END IF;
END IF;
IF to_regprocedure('public.admin_mail(text,jsonb)') IS NOT NULL THEN
 SELECT pg_get_functiondef('public.admin_mail(text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,'private.mail_rules_fields(old.id)')=0 THEN
  needle:='to_jsonb(old)||jsonb_build_object(''category'',';
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_rules_detail_changed'; END IF;
  definition:=replace(definition,needle,'to_jsonb(old)||private.mail_rules_fields(old.id)||jsonb_build_object(''category'',');
 END IF;
 IF strpos(definition,'private.mail_rules_fields(x.id)')=0 THEN
  needle:='ELSE to_jsonb(x) END) FROM public.email_threads x WHERE id=ANY(threads))';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'mail_rules_export_changed'; END IF;
  definition:=replace(definition,needle,'ELSE to_jsonb(x) END||private.mail_rules_fields(x.id)) FROM public.email_threads x WHERE id=ANY(threads))');
 END IF;
 EXECUTE definition;
END IF;
END $migration$;
