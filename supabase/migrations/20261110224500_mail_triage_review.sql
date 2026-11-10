-- AI proposals and human review are separate, revision-bound records.
DO $migration$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
ALTER TABLE public.email_threads ADD COLUMN IF NOT EXISTS ai_subtype text CHECK(ai_subtype IN('personal_story','request_help','offer_help','press','partnership','operational','automated','spam','other')),
 ADD COLUMN IF NOT EXISTS ai_review_required boolean,
 ADD COLUMN IF NOT EXISTS ai_review_reason text CHECK(length(ai_review_reason)<=300),
 ADD COLUMN IF NOT EXISTS ai_confidence text CHECK(ai_confidence IN('low','medium','high')),
 ADD COLUMN IF NOT EXISTS reviewed_revision integer CHECK(reviewed_revision>0),
 ADD COLUMN IF NOT EXISTS reviewed_by uuid, ADD COLUMN IF NOT EXISTS reviewed_email text,
 ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
CREATE INDEX IF NOT EXISTS email_threads_review_pending ON public.email_threads(last_received_at DESC,id) WHERE reviewed_revision IS DISTINCT FROM revision AND status<>'archived';
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_triage_fields(p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE subtype text; confidence text; reason text; review boolean;
BEGIN
 IF NOT(p ?| ARRAY['subtype','review_required','review_reason','confidence']) THEN
  RETURN jsonb_build_object('subtype','other','review_required',true,'review_reason','Starší výsledek bez rozšířeného posouzení.','confidence','low');
 END IF;
 IF jsonb_typeof(p->'subtype') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'confidence') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'review_reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'review_required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'mail_triage'; END IF;
 subtype:=p->>'subtype'; confidence:=p->>'confidence'; reason:=trim(p->>'review_reason'); review:=(p->>'review_required')::boolean;
 IF subtype NOT IN('personal_story','request_help','offer_help','press','partnership','operational','automated','spam','other') OR confidence NOT IN('low','medium','high') OR length(reason)>300 THEN RAISE EXCEPTION 'mail_triage'; END IF;
 IF (subtype IN('personal_story','request_help') AND p->>'email_type' IS DISTINCT FROM 'story') OR (subtype='offer_help' AND p->>'email_type' IS DISTINCT FROM 'help') OR (subtype IN('press','partnership','operational','automated','spam') AND p->>'email_type' IS DISTINCT FROM 'other') THEN RAISE EXCEPTION 'mail_triage_type'; END IF;
 IF subtype='request_help' AND p->>'category' IS NOT NULL AND p->>'category'<>'potrebuji_pomoc' THEN RAISE EXCEPTION 'mail_triage_category'; END IF;
 review:=review OR confidence='low' OR coalesce(p->>'urgency'='acute',false);
 IF review AND reason='' THEN reason:='Vyžaduje lidskou kontrolu kontextu a navrženého zařazení.'; END IF;
 RETURN jsonb_build_object('subtype',subtype,'review_required',review,'review_reason',reason,'confidence',confidence);
END $$ $ddl$;
REVOKE ALL ON FUNCTION private.mail_triage_fields(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mail_triage_fields(jsonb) TO service_role;
END $migration$;

DO $migration$
DECLARE definition text; signature text; input text; needle text; replacement text;
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
FOREACH signature IN ARRAY ARRAY['public.admin_mail(text,jsonb)','public.mail_ai_finish(uuid,jsonb,boolean)'] LOOP
 IF to_regprocedure(signature) IS NULL THEN CONTINUE; END IF;
 SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
 input:=CASE WHEN signature LIKE 'public.admin_mail%' THEN 'p_payload' ELSE 'p_output' END;
 needle:='ai_model='||input||'->>''model'',ai_at=now(),ai_error=NULL WHERE id=';
 replacement:='ai_model='||input||'->>''model'',ai_subtype=(private.mail_triage_fields('||input||'))->>''subtype'',ai_review_required=((private.mail_triage_fields('||input||'))->>''review_required'')::boolean,ai_review_reason=(private.mail_triage_fields('||input||'))->>''review_reason'',ai_confidence=(private.mail_triage_fields('||input||'))->>''confidence'',ai_at=now(),ai_error=NULL WHERE id=';
 IF strpos(definition,needle)=0 AND strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'mail_triage_save_definition_changed'; END IF;
 EXECUTE replace(definition,needle,replacement);
END LOOP;
IF to_regprocedure('private.mail_refresh_thread(uuid)') IS NOT NULL THEN
 SELECT pg_get_functiondef('private.mail_refresh_thread(uuid)'::regprocedure) INTO definition;
 needle:='ai_model=NULL,ai_at=NULL,ai_error=NULL WHERE id=p_id;';
 replacement:='ai_model=NULL,ai_subtype=NULL,ai_review_required=NULL,ai_review_reason=NULL,ai_confidence=NULL,ai_at=NULL,ai_error=NULL WHERE id=p_id;';
 IF strpos(definition,needle)=0 AND strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'mail_triage_refresh_definition_changed'; END IF;
 EXECUTE replace(definition,needle,replacement);
END IF;
IF to_regprocedure('private.mail_ai_context(uuid)') IS NOT NULL THEN
 SELECT pg_get_functiondef('private.mail_ai_context(uuid)'::regprocedure) INTO definition;
 needle:='''body_text'',right(body_text,greatest(0,20000-spent-length(subject)-8)::int)';
 replacement:=needle||',''received_at'',to_char(received_at AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')';
 IF strpos(definition,'''received_at''')=0 THEN
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_triage_context_definition_changed'; END IF;
  EXECUTE replace(definition,needle,replacement);
 END IF;
END IF;
IF to_regprocedure('public.mail_list_sorted(jsonb)') IS NOT NULL THEN
 SELECT pg_get_functiondef('public.mail_list_sorted(jsonb)'::regprocedure) INTO definition;
 needle:='q:=left(trim(coalesce(f->>''q'','''')),200);';
 replacement:='IF nullif(f->>''review'','''') IS NOT NULL AND f->>''review'' NOT IN(''pending'',''reviewed'') THEN RAISE EXCEPTION ''mail_filter''; END IF; IF nullif(f->>''subtype'','''') IS NOT NULL AND f->>''subtype'' NOT IN(''personal_story'',''request_help'',''offer_help'',''press'',''partnership'',''operational'',''automated'',''spam'',''other'') THEN RAISE EXCEPTION ''mail_filter''; END IF; '||needle;
 IF strpos(definition,'nullif(f->>''review''')=0 THEN
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_triage_list_definition_changed'; END IF;
  definition:=replace(definition,needle,replacement);
  needle:='FROM public.email_threads x WHERE';
  replacement:='FROM public.email_threads x WHERE (nullif(f->>''review'','''') IS NULL OR (f->>''review''=''pending'' AND x.reviewed_revision IS DISTINCT FROM x.revision AND (nullif(f->>''status'','''') IS NOT NULL OR x.status<>''archived'')) OR (f->>''review''=''reviewed'' AND x.reviewed_revision IS NOT DISTINCT FROM x.revision)) AND (nullif(f->>''subtype'','''') IS NULL OR coalesce(x.ai_subtype,''other'')=f->>''subtype'') AND';
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_triage_list_scope_changed'; END IF;
  definition:=replace(definition,needle,replacement);
  EXECUTE definition;
 END IF;
END IF;
END $migration$;

DO $migration$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_mark_reviewed(p_id uuid,p_revision integer,p_reviewed boolean,p_actor uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE t public.email_threads;
BEGIN
 IF p_revision IS NULL OR p_revision<1 OR p_reviewed IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_actor) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=p_email) OR NOT private.verified_admin_identity(p_actor,p_email) THEN RAISE EXCEPTION 'mail_review'; END IF;
 SELECT * INTO t FROM public.email_threads WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','missing'); END IF;
 IF t.revision<>p_revision THEN RETURN jsonb_build_object('saved',false,'reason','changed'); END IF;
 UPDATE public.email_threads SET reviewed_revision=CASE WHEN p_reviewed THEN revision END,reviewed_by=CASE WHEN p_reviewed THEN p_actor END,reviewed_email=CASE WHEN p_reviewed THEN p_email END,reviewed_at=CASE WHEN p_reviewed THEN now() END,updated_at=now() WHERE id=p_id;
 INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(p_actor,p_email,'mail_review','email_threads',p_id,jsonb_build_object('revision',p_revision,'reviewed',p_reviewed));
 RETURN jsonb_build_object('saved',true);
END $$ $ddl$;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_triage_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('unreviewed',(SELECT count(*) FROM public.email_threads WHERE status<>'archived' AND reviewed_revision IS DISTINCT FROM revision),'urgent',(SELECT count(*) FROM public.email_threads WHERE status<>'archived' AND coalesce(admin_urgency,ai_urgency) IN('high','acute')),'subtypes',(SELECT coalesce(jsonb_object_agg(subtype,n),'{}'::jsonb) FROM (SELECT coalesce(ai_subtype,'other') subtype,count(*) n FROM public.email_threads WHERE status<>'archived' GROUP BY coalesce(ai_subtype,'other')) s))
$$ $ddl$;
REVOKE ALL ON FUNCTION public.mail_mark_reviewed(uuid,integer,boolean,uuid,text),public.mail_triage_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mail_mark_reviewed(uuid,integer,boolean,uuid,text),public.mail_triage_status() TO service_role;
END $migration$;

DO $migration$
BEGIN
IF to_regclass('public.email_messages') IS NULL THEN RETURN; END IF;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_source_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('allMessages',count(*),'activeMessages',count(*) FILTER(WHERE source_removed_at IS NULL),'removedMessages',count(*) FILTER(WHERE source_removed_at IS NOT NULL)) FROM public.email_messages
$$ $ddl$;
REVOKE ALL ON FUNCTION public.mail_source_counts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mail_source_counts() TO service_role;
END $migration$;
