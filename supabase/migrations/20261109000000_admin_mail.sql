-- Dedicated Microsoft 365 mailbox: local read-only mirror, not publication consent.
-- No Graph calls, tenant grants or production sync are performed by this migration.
BEGIN;
DO $mail$
BEGIN
IF to_regclass('public.admin_audit_log') IS NULL THEN RETURN; END IF;
CREATE TABLE IF NOT EXISTS public.email_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mailbox text NOT NULL CHECK(mailbox='veryvera@nadbytecna.cz'),
 conversation_id text NOT NULL, subject text NOT NULL DEFAULT '', sender_name text, sender_email text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_received_at timestamptz,
 revision int NOT NULL DEFAULT 1 CHECK(revision>0), status text NOT NULL DEFAULT 'new' CHECK(status IN('new','in_progress','contacted','archived')),
 admin_category text REFERENCES public.categories(code), admin_urgency text CHECK(admin_urgency IN('low','medium','high','acute')),
 admin_email_type text CHECK(admin_email_type IN('story','help','other')), classified_by uuid, classified_email text, classified_at timestamptz,
 ai_summary text, ai_category text REFERENCES public.categories(code), ai_urgency text CHECK(ai_urgency IN('low','medium','high','acute')),
 ai_email_type text CHECK(ai_email_type IN('story','help','other')), ai_help_type text, ai_model text, ai_at timestamptz, ai_error text,
 consent_state text NOT NULL DEFAULT 'unknown' CHECK(consent_state='unknown'),
 UNIQUE(mailbox,conversation_id)
);
CREATE TABLE IF NOT EXISTS public.email_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES public.email_threads(id) ON DELETE CASCADE,
 mailbox text NOT NULL CHECK(mailbox='veryvera@nadbytecna.cz'), external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 2048),
 internet_message_id text, sender_email text NOT NULL CHECK(sender_email=lower(sender_email) AND length(sender_email) BETWEEN 3 AND 254),
 sender_name text, subject text NOT NULL DEFAULT '', body_text text NOT NULL DEFAULT '' CHECK(length(body_text)<=100000),
 received_at timestamptz NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(), source_removed_at timestamptz,
 message_hash text NOT NULL, internet_hash text, sender_hash text NOT NULL,
 UNIQUE(mailbox,external_id)
);
CREATE INDEX IF NOT EXISTS email_messages_thread ON public.email_messages(thread_id,received_at,id);
CREATE INDEX IF NOT EXISTS email_messages_sender ON public.email_messages(sender_email,received_at);
CREATE TABLE IF NOT EXISTS public.email_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES public.email_threads(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, author text NOT NULL, body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000), at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.mail_sync_state (
 mailbox text NOT NULL CHECK(mailbox='veryvera@nadbytecna.cz'), folder text NOT NULL CHECK(length(folder) BETWEEN 1 AND 256),
 cursor text, not_before timestamptz NOT NULL, lease uuid, lease_until timestamptz,
 last_sync_at timestamptz, last_error text, retry_after timestamptz, initial_complete boolean NOT NULL DEFAULT false,
 PRIMARY KEY(mailbox,folder)
);
CREATE TABLE IF NOT EXISTS private.mail_hash_settings(mailbox text PRIMARY KEY CHECK(mailbox='veryvera@nadbytecna.cz'), fingerprint text NOT NULL, retained_not_before timestamptz);
CREATE TABLE IF NOT EXISTS private.mail_import_suppressions (
 mailbox text NOT NULL CHECK(mailbox='veryvera@nadbytecna.cz'), kind text NOT NULL CHECK(kind IN('message','internet','sender_before')),
 hash_key text NOT NULL, through_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(mailbox,kind,hash_key)
);
REVOKE ALL ON public.email_threads,public.email_messages,public.email_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.email_threads,public.email_messages,public.email_notes TO authenticated;
GRANT ALL ON public.email_threads,public.email_messages,public.email_notes TO service_role;
REVOKE ALL ON private.mail_sync_state,private.mail_hash_settings,private.mail_import_suppressions FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.mail_sync_state,private.mail_hash_settings,private.mail_import_suppressions TO service_role;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY; ALTER TABLE public.email_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY; ALTER TABLE public.email_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_notes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.email_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mail_admin_read ON public.email_threads;
DROP POLICY IF EXISTS mail_admin_read ON public.email_messages;
DROP POLICY IF EXISTS mail_admin_read ON public.email_notes;
CREATE POLICY mail_admin_read ON public.email_threads FOR SELECT TO authenticated USING(private.is_admin());
CREATE POLICY mail_admin_read ON public.email_messages FOR SELECT TO authenticated USING(private.is_admin());
CREATE POLICY mail_admin_read ON public.email_notes FOR SELECT TO authenticated USING(private.is_admin());
END $mail$;

DO $mail$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
-- HMAC-SHA256 using PostgreSQL's built-in sha256(bytea); secret is supplied by server env, never persisted.
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.mail_hash(p_value text,p_secret text) RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE key_bytes bytea; ipad bytea:=decode(repeat('00',64),'hex'); opad bytea:=decode(repeat('00',64),'hex'); i int; b int;
BEGIN
IF p_secret IS NULL OR length(p_secret)<32 THEN RAISE EXCEPTION 'mail_hash_configuration'; END IF;
key_bytes:=convert_to(p_secret,'UTF8'); IF length(key_bytes)>64 THEN key_bytes:=sha256(key_bytes); END IF;
FOR i IN 0..63 LOOP b:=CASE WHEN i<length(key_bytes) THEN get_byte(key_bytes,i) ELSE 0 END; ipad:=set_byte(ipad,i,b # 54); opad:=set_byte(opad,i,b # 92); END LOOP;
RETURN encode(sha256(opad || sha256(ipad || convert_to(coalesce(p_value,''),'UTF8'))),'hex');
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.mail_check_secret(p_secret text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE fp text; old_fp text;
BEGIN
IF p_secret IS NULL OR length(p_secret)<32 THEN RAISE EXCEPTION 'mail_hash_configuration'; END IF;
fp:=encode(sha256(convert_to(p_secret,'UTF8')),'hex');
INSERT INTO private.mail_hash_settings(mailbox,fingerprint) VALUES('veryvera@nadbytecna.cz',fp) ON CONFLICT DO NOTHING;
SELECT fingerprint INTO old_fp FROM private.mail_hash_settings WHERE mailbox='veryvera@nadbytecna.cz';
IF old_fp<>fp THEN RAISE EXCEPTION 'mail_hash_changed'; END IF;
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.mail_refresh_thread(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE latest public.email_messages;
BEGIN
SELECT * INTO latest FROM public.email_messages WHERE thread_id=p_id ORDER BY received_at DESC,id DESC LIMIT 1;
IF NOT FOUND THEN DELETE FROM public.email_threads WHERE id=p_id; RETURN; END IF;
UPDATE public.email_threads SET subject=latest.subject,sender_email=latest.sender_email,sender_name=latest.sender_name,last_received_at=latest.received_at,
 revision=revision+1,updated_at=now(),ai_summary=NULL,ai_category=NULL,ai_urgency=NULL,ai_email_type=NULL,ai_help_type=NULL,ai_model=NULL,ai_at=NULL,ai_error=NULL WHERE id=p_id;
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION private.mail_suppress(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
INSERT INTO private.mail_import_suppressions(mailbox,kind,hash_key) SELECT mailbox,'message',message_hash FROM public.email_messages WHERE id=ANY(p_ids) ON CONFLICT DO NOTHING;
INSERT INTO private.mail_import_suppressions(mailbox,kind,hash_key) SELECT mailbox,'internet',internet_hash FROM public.email_messages WHERE id=ANY(p_ids) AND internet_hash IS NOT NULL ON CONFLICT DO NOTHING;
END $$ $sql$;
END $mail$;

DO $mail$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.mail_sync_claim(p_mailbox text,p_folder text,p_since timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE s private.mail_sync_state; token uuid:=gen_random_uuid();
BEGIN
IF p_mailbox<>'veryvera@nadbytecna.cz' OR p_since IS NULL OR p_since>now() OR p_folder IS NULL OR length(p_folder) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'mail_sync_configuration'; END IF;
INSERT INTO private.mail_sync_state(mailbox,folder,not_before) VALUES(p_mailbox,p_folder,p_since) ON CONFLICT DO NOTHING;
SELECT * INTO s FROM private.mail_sync_state WHERE mailbox=p_mailbox AND folder=p_folder FOR UPDATE;
IF (s.lease IS NOT NULL AND s.lease_until>now()) OR s.retry_after>now() THEN RETURN NULL; END IF;
UPDATE private.mail_sync_state SET lease=token,lease_until=now()+interval '5 minutes',not_before=greatest(not_before,p_since) WHERE mailbox=p_mailbox AND folder=p_folder;
RETURN jsonb_build_object('lease',token,'cursor',s.cursor,'since',greatest(s.not_before,p_since));
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.mail_sync_commit(p_lease uuid,p_messages jsonb,p_removed jsonb,p_next_cursor text,p_complete boolean,p_hash_secret text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE s private.mail_sync_state; m jsonb; old public.email_messages; tid uuid; msg_id uuid; ext text; conv text; sender text; received timestamptz; mh text; ih text; sh text; changed boolean; imported int:=0; skipped int:=0; removed int:=0;
BEGIN
PERFORM pg_advisory_xact_lock(84301720261107);
PERFORM private.mail_check_secret(p_hash_secret);
SELECT * INTO s FROM private.mail_sync_state WHERE lease=p_lease AND lease_until>now() FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'mail_lease'; END IF;
IF p_messages IS NULL OR p_removed IS NULL OR jsonb_typeof(p_messages)<>'array' OR jsonb_array_length(p_messages)>100 OR jsonb_typeof(p_removed)<>'array' OR jsonb_array_length(p_removed)>500 OR p_next_cursor IS NULL OR length(p_next_cursor) NOT BETWEEN 1 AND 16000 OR p_complete IS NULL THEN RAISE EXCEPTION 'mail_sync_input'; END IF;
FOR m IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
 ext:=m->>'external_id'; conv:=coalesce(nullif(m->>'conversation_id',''),ext); sender:=lower(trim(m->>'sender_email'));
 IF ext IS NULL OR length(ext) NOT BETWEEN 1 AND 2048 OR conv IS NULL OR length(conv)>2048 OR sender IS NULL OR length(sender) NOT BETWEEN 3 AND 254 OR position('@' IN sender)<2 OR m->>'received_at' IS NULL OR length(coalesce(m->>'body_text',''))>100000 THEN RAISE EXCEPTION 'mail_message_input'; END IF;
 BEGIN received:=(m->>'received_at')::timestamptz; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'mail_message_date'; END;
 IF received>now()+interval '5 minutes' THEN RAISE EXCEPTION 'mail_message_date'; END IF;
 mh:=private.mail_hash('message:'||s.mailbox||':'||ext,p_hash_secret);
 ih:=CASE WHEN nullif(m->>'internet_message_id','') IS NOT NULL THEN private.mail_hash('internet:'||s.mailbox||':'||(m->>'internet_message_id'),p_hash_secret) END;
 sh:=private.mail_hash('sender:'||s.mailbox||':'||sender,p_hash_secret);
 IF received<greatest(s.not_before,(SELECT retained_not_before FROM private.mail_hash_settings WHERE mailbox=s.mailbox)) OR EXISTS(SELECT 1 FROM private.mail_import_suppressions x WHERE x.mailbox=s.mailbox AND ((x.kind='message' AND x.hash_key=mh) OR (x.kind='internet' AND x.hash_key=ih) OR (x.kind='sender_before' AND x.hash_key=sh AND received<=x.through_at))) THEN skipped:=skipped+1; CONTINUE; END IF;
 SELECT * INTO old FROM public.email_messages WHERE mailbox=s.mailbox AND external_id=ext FOR UPDATE;
 IF FOUND THEN
  tid:=old.thread_id;
  changed:=(old.subject IS DISTINCT FROM coalesce(m->>'subject','') OR old.sender_email IS DISTINCT FROM sender OR old.sender_name IS DISTINCT FROM m->>'sender_name' OR old.body_text IS DISTINCT FROM coalesce(m->>'body_text','') OR old.received_at IS DISTINCT FROM received);
  UPDATE public.email_messages SET internet_message_id=m->>'internet_message_id',sender_email=sender,sender_name=m->>'sender_name',subject=coalesce(m->>'subject',''),body_text=coalesce(m->>'body_text',''),received_at=received,source_removed_at=NULL,message_hash=mh,internet_hash=ih,sender_hash=sh WHERE id=old.id;
 ELSE
  INSERT INTO public.email_threads(mailbox,conversation_id) VALUES(s.mailbox,conv) ON CONFLICT(mailbox,conversation_id) DO NOTHING;
  SELECT id INTO tid FROM public.email_threads WHERE mailbox=s.mailbox AND conversation_id=conv FOR UPDATE;
  INSERT INTO public.email_messages(thread_id,mailbox,external_id,internet_message_id,sender_email,sender_name,subject,body_text,received_at,message_hash,internet_hash,sender_hash)
   VALUES(tid,s.mailbox,ext,m->>'internet_message_id',sender,m->>'sender_name',coalesce(m->>'subject',''),coalesce(m->>'body_text',''),received,mh,ih,sh);
  changed:=true;
 END IF;
 IF changed THEN PERFORM private.mail_refresh_thread(tid); imported:=imported+1; END IF;
END LOOP;
FOR m IN SELECT value FROM jsonb_array_elements(p_removed) LOOP
 ext:=CASE WHEN jsonb_typeof(m)='string' THEN m#>>'{}' ELSE m->>'external_id' END;
 UPDATE public.email_messages SET source_removed_at=now() WHERE mailbox=s.mailbox AND external_id=ext;
 IF FOUND THEN removed:=removed+1; END IF;
END LOOP;
UPDATE private.mail_sync_state SET cursor=p_next_cursor,lease=NULL,lease_until=NULL,last_sync_at=now(),last_error=NULL,initial_complete=initial_complete OR p_complete WHERE mailbox=s.mailbox AND folder=s.folder;
INSERT INTO public.admin_audit_log(action,diff) VALUES('mail_sync',jsonb_build_object('imported',imported,'suppressed',skipped,'source_removed',removed,'complete',p_complete));
RETURN jsonb_build_object('imported',imported,'skipped',skipped,'removed',removed);
END $$ $sql$;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.mail_sync_release(p_lease uuid,p_error text,p_retry_after_seconds int DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
UPDATE private.mail_sync_state SET lease=NULL,lease_until=NULL,retry_after=CASE WHEN p_retry_after_seconds IS NOT NULL THEN now()+make_interval(secs=>greatest(1,least(86400,p_retry_after_seconds))) END,last_error=CASE WHEN p_error IN('graph_auth','graph_fetch','invalid_response','lease_lost','cursor_expired','throttled','authentication_failed','token_request_failed','timeout','graph_error','forbidden','configuration') THEN p_error ELSE 'sync_failed' END WHERE lease=p_lease;
END $$ $sql$;
END $mail$;

DO $mail$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.admin_mail(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb; actor uuid; actor_email text; tid uuid; ids uuid[]; threads uuid[]; t uuid; n int:=0; tn int:=0; email text; secret text; cutoff timestamptz; patch jsonb; f jsonb; q text; pg int; total int; old public.email_threads; k text; note_id uuid;
BEGIN
actor:=nullif(p_payload->>'actor_id','')::uuid; actor_email:=p_payload->>'actor_email';
IF p_action IN('erase','thread_erase','retention') THEN PERFORM pg_advisory_xact_lock(84301720261107); END IF;
IF p_action='status' THEN
 RETURN jsonb_build_object('threads',(SELECT count(*) FROM public.email_threads),'messages',(SELECT count(*) FROM public.email_messages),'lastSyncAt',(SELECT max(last_sync_at) FROM private.mail_sync_state),'sync_active',EXISTS(SELECT 1 FROM private.mail_sync_state WHERE lease_until>now()),'retryAfter',(SELECT max(retry_after) FROM private.mail_sync_state),'initial_complete',EXISTS(SELECT 1 FROM private.mail_sync_state WHERE initial_complete),'lastError',(SELECT last_error FROM private.mail_sync_state ORDER BY last_sync_at DESC NULLS LAST LIMIT 1));
ELSIF p_action='list' THEN
 f:=coalesce(p_payload->'filters','{}'::jsonb); q:=left(trim(coalesce(f->>'q','')),200); pg:=greatest(0,least(100000,coalesce((f->>'page')::int,0)));
 SELECT count(*) INTO total FROM public.email_threads x WHERE
  (nullif(f->>'status','') IS NULL OR x.status=f->>'status') AND (nullif(f->>'category','') IS NULL OR coalesce(x.admin_category,x.ai_category)=f->>'category') AND (nullif(f->>'urgency','') IS NULL OR coalesce(x.admin_urgency,x.ai_urgency)=f->>'urgency') AND (nullif(f->>'email_type','') IS NULL OR coalesce(x.admin_email_type,x.ai_email_type)=f->>'email_type') AND (q='' OR strpos(lower(x.subject||' '||coalesce(x.sender_email,'')||' '||coalesce(x.ai_summary,'')),lower(q))>0 OR EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=x.id AND strpos(lower(m.body_text||' '||m.sender_email),lower(q))>0));
 SELECT coalesce(jsonb_agg(r),'[]'::jsonb) INTO result FROM (SELECT to_jsonb(x)||jsonb_build_object('category',coalesce(x.admin_category,x.ai_category),'urgency',coalesce(x.admin_urgency,x.ai_urgency),'email_type',coalesce(x.admin_email_type,x.ai_email_type)) r FROM public.email_threads x WHERE
  (nullif(f->>'status','') IS NULL OR x.status=f->>'status') AND (nullif(f->>'category','') IS NULL OR coalesce(x.admin_category,x.ai_category)=f->>'category') AND (nullif(f->>'urgency','') IS NULL OR coalesce(x.admin_urgency,x.ai_urgency)=f->>'urgency') AND (nullif(f->>'email_type','') IS NULL OR coalesce(x.admin_email_type,x.ai_email_type)=f->>'email_type') AND (q='' OR strpos(lower(x.subject||' '||coalesce(x.sender_email,'')||' '||coalesce(x.ai_summary,'')),lower(q))>0 OR EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=x.id AND strpos(lower(m.body_text||' '||m.sender_email),lower(q))>0)) ORDER BY x.last_received_at DESC NULLS LAST,x.id LIMIT 25 OFFSET pg*25) page;
 RETURN jsonb_build_object('rows',result,'total',total);
ELSIF p_action IN('export','erase') THEN
 email:=lower(trim(p_payload->>'email')); IF email IS NULL OR length(email) NOT BETWEEN 3 AND 254 OR position('@' IN email)<2 THEN RAISE EXCEPTION 'mail_email'; END IF;
 SELECT array_agg(id),array_agg(DISTINCT thread_id) INTO ids,threads FROM public.email_messages WHERE sender_email=email;
ELSIF p_action='retention' THEN
 IF p_payload->>'cutoff' IS NULL THEN RAISE EXCEPTION 'mail_retention_configuration'; END IF;
 cutoff:=(p_payload->>'cutoff')::timestamptz; IF cutoff>now() THEN RAISE EXCEPTION 'mail_retention_configuration'; END IF;
 SELECT array_agg(id),array_agg(DISTINCT thread_id) INTO ids,threads FROM (SELECT id,thread_id FROM public.email_messages WHERE received_at<cutoff ORDER BY received_at,id LIMIT 100 FOR UPDATE) candidates;
 IF coalesce((p_payload->>'dry_run')::boolean,true) THEN RETURN jsonb_build_object('dry_run',true,'messages',coalesce(array_length(ids,1),0),'threads',coalesce(array_length(threads,1),0)); END IF;
ELSE
 tid:=nullif(p_payload->>'id','')::uuid;
 SELECT * INTO old FROM public.email_threads WHERE id=tid FOR UPDATE;
 IF NOT FOUND THEN IF p_action='ai_save' THEN RETURN jsonb_build_object('saved',false,'reason','missing'); END IF; RAISE EXCEPTION 'mail_missing'; END IF;
 IF p_action='detail' THEN
  pg:=greatest(0,least(50000,coalesce((p_payload->>'message_page')::int,0)));
  INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id) VALUES(actor,actor_email,'mail_view','email_threads',tid);
  RETURN jsonb_build_object('thread',to_jsonb(old)||jsonb_build_object('category',coalesce(old.admin_category,old.ai_category),'urgency',coalesce(old.admin_urgency,old.ai_urgency),'email_type',coalesce(old.admin_email_type,old.ai_email_type)),'messages',coalesce((SELECT jsonb_agg(to_jsonb(m)-ARRAY['message_hash','internet_hash','sender_hash','external_id','mailbox','internet_message_id'] ORDER BY received_at,id) FROM (SELECT * FROM public.email_messages WHERE thread_id=tid ORDER BY received_at DESC,id DESC LIMIT 20 OFFSET pg*20) m),'[]'::jsonb),'message_page',pg,'message_count',(SELECT count(*) FROM public.email_messages WHERE thread_id=tid),'messages_truncated',(SELECT count(*)>20 FROM public.email_messages WHERE thread_id=tid),'notes',coalesce((SELECT jsonb_agg(to_jsonb(z) ORDER BY at,id) FROM public.email_notes z WHERE thread_id=tid),'[]'::jsonb));
 ELSIF p_action='mutate' THEN
  patch:=coalesce(p_payload->'patch','{}');
  FOR k IN SELECT jsonb_object_keys(patch) LOOP IF k NOT IN('status','admin_category','admin_urgency','email_type') THEN RAISE EXCEPTION 'mail_field'; END IF; END LOOP;
  IF patch?'admin_category' AND patch->>'admin_category' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE code=patch->>'admin_category' AND active) THEN RAISE EXCEPTION 'mail_category'; END IF;
  UPDATE public.email_threads SET status=CASE WHEN patch?'status' THEN patch->>'status' ELSE status END,admin_category=CASE WHEN patch?'admin_category' THEN patch->>'admin_category' ELSE admin_category END,admin_urgency=CASE WHEN patch?'admin_urgency' THEN patch->>'admin_urgency' ELSE admin_urgency END,admin_email_type=CASE WHEN patch?'email_type' THEN patch->>'email_type' ELSE admin_email_type END,updated_at=now(),classified_by=CASE WHEN patch?'admin_category' OR patch?'admin_urgency' OR patch?'email_type' THEN actor ELSE classified_by END,classified_email=CASE WHEN patch?'admin_category' OR patch?'admin_urgency' OR patch?'email_type' THEN actor_email ELSE classified_email END,classified_at=CASE WHEN patch?'admin_category' OR patch?'admin_urgency' OR patch?'email_type' THEN now() ELSE classified_at END WHERE id=tid;
  INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(actor,actor_email,'mail_update','email_threads',tid,jsonb_build_object('fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(patch) key)));
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='note' THEN
  IF actor IS NULL OR actor_email IS NULL OR length(trim(coalesce(p_payload->>'body',''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'mail_note'; END IF;
  note_id:=nullif(p_payload->>'note_id','')::uuid;
  IF note_id IS NULL THEN INSERT INTO public.email_notes(thread_id,user_id,author,body) VALUES(tid,actor,actor_email,trim(p_payload->>'body'));
  ELSE UPDATE public.email_notes SET body=trim(p_payload->>'body') WHERE id=note_id AND thread_id=tid AND user_id=actor; IF NOT FOUND THEN RAISE EXCEPTION 'mail_own_note'; END IF; END IF;
  INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id) VALUES(actor,actor_email,'mail_note','email_threads',tid); RETURN jsonb_build_object('ok',true);
 ELSIF p_action='ai_save' THEN
  IF (p_payload->>'revision')::int IS DISTINCT FROM old.revision THEN RETURN jsonb_build_object('saved',false,'reason','changed'); END IF;
  IF coalesce((p_payload->>'error')::boolean,false) THEN UPDATE public.email_threads SET ai_error='classification_failed' WHERE id=tid;
  ELSE
   IF p_payload->>'email_type' IS NULL OR p_payload->>'urgency' IS NULL OR p_payload->>'email_type' NOT IN('story','help','other') OR p_payload->>'urgency' NOT IN('low','medium','high','acute') OR nullif(trim(p_payload->>'summary'),'') IS NULL OR length(p_payload->>'summary')>1000 OR length(coalesce(p_payload->>'help_type',''))>500 THEN RAISE EXCEPTION 'mail_ai'; END IF;
   IF p_payload->>'category' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE code=p_payload->>'category' AND active) THEN RAISE EXCEPTION 'mail_category'; END IF;
   UPDATE public.email_threads SET ai_summary=p_payload->>'summary',ai_category=p_payload->>'category',ai_urgency=p_payload->>'urgency',ai_email_type=p_payload->>'email_type',ai_help_type=p_payload->>'help_type',ai_model=p_payload->>'model',ai_at=now(),ai_error=NULL WHERE id=tid;
  END IF;
  INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(actor,actor_email,'mail_ai','email_threads',tid,jsonb_build_object('error',coalesce((p_payload->>'error')::boolean,false))); RETURN jsonb_build_object('saved',true);
 ELSIF p_action IN('thread_export','thread_erase') THEN
  SELECT array_agg(id) INTO ids FROM public.email_messages WHERE thread_id=tid; threads:=ARRAY[tid];
 ELSE RAISE EXCEPTION 'mail_action'; END IF;
END IF;
IF p_action IN('export','thread_export') THEN
 -- Bound the payload before jsonb_agg builds it. Per-row JSON sizing is conservative
 -- (it includes internal fields later removed), and handles UTF-8 and escaping.
 IF coalesce((SELECT sum(octet_length(to_jsonb(m)::text)) FROM public.email_messages m WHERE id=ANY(ids)),0)
   +coalesce((SELECT sum(octet_length(to_jsonb(z)::text)) FROM public.email_notes z WHERE thread_id=ANY(threads)),0)
   +coalesce((SELECT sum(octet_length(to_jsonb(x)::text)) FROM public.email_threads x WHERE id=ANY(threads)),0)
   +1024>2621440 THEN RAISE EXCEPTION 'mail_export_too_large' USING ERRCODE='54000'; END IF;
 INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff) VALUES(actor,actor_email,'mail_export','email_threads',tid,jsonb_build_object('messages',coalesce(array_length(ids,1),0)));
 RETURN jsonb_build_object('messages',coalesce((SELECT jsonb_agg(to_jsonb(m)-ARRAY['message_hash','internet_hash','sender_hash']) FROM public.email_messages m WHERE id=ANY(ids)),'[]'::jsonb),'threads',coalesce((SELECT jsonb_agg(CASE WHEN p_action='export' THEN jsonb_build_object('id',x.id,'status',x.status,'admin_category',x.admin_category,'admin_urgency',x.admin_urgency,'admin_email_type',x.admin_email_type) ELSE to_jsonb(x) END) FROM public.email_threads x WHERE id=ANY(threads)),'[]'::jsonb),'notes',CASE WHEN p_action='thread_export' THEN coalesce((SELECT jsonb_agg(to_jsonb(z)) FROM public.email_notes z WHERE thread_id=tid),'[]'::jsonb) ELSE coalesce((SELECT jsonb_agg(to_jsonb(z)) FROM public.email_notes z WHERE thread_id=ANY(threads)),'[]'::jsonb) END,'requires_review',p_action='export');
END IF;
secret:=p_payload->>'hash_secret'; PERFORM private.mail_check_secret(secret);
IF p_action='erase' THEN
 IF p_payload->>'email_hash' IS NOT NULL AND (p_payload->>'email_hash') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'mail_hash_input'; END IF;
 INSERT INTO private.mail_import_suppressions(mailbox,kind,hash_key,through_at) VALUES('veryvera@nadbytecna.cz','sender_before',private.mail_hash('sender:veryvera@nadbytecna.cz:'||email,secret),now()) ON CONFLICT(mailbox,kind,hash_key) DO UPDATE SET through_at=greatest(private.mail_import_suppressions.through_at,excluded.through_at);
END IF;
PERFORM private.mail_suppress(ids);
DELETE FROM public.email_messages WHERE id=ANY(ids); GET DIAGNOSTICS n=ROW_COUNT;
IF threads IS NOT NULL THEN FOREACH t IN ARRAY threads LOOP
 DELETE FROM public.email_notes WHERE thread_id=t;
 DELETE FROM public.admin_audit_log WHERE entity='email_threads' AND entity_id=t;
 PERFORM private.mail_refresh_thread(t);
 IF NOT EXISTS(SELECT 1 FROM public.email_threads WHERE id=t) THEN tn:=tn+1; END IF;
END LOOP; END IF;
IF p_action='retention' THEN UPDATE private.mail_sync_state SET not_before=greatest(not_before,cutoff); UPDATE private.mail_hash_settings SET retained_not_before=greatest(retained_not_before,cutoff) WHERE mailbox='veryvera@nadbytecna.cz'; END IF;
INSERT INTO public.admin_audit_log(user_id,email,action,diff) VALUES(actor,actor_email,CASE WHEN p_action='retention' THEN 'mail_retention' ELSE 'mail_erase_copy' END,jsonb_build_object('messages_deleted',n,'threads_deleted',tn,'email_hash',CASE WHEN p_action='erase' THEN coalesce(p_payload->>'email_hash',private.mail_hash('audit:veryvera@nadbytecna.cz:'||email,secret)) END));
RETURN jsonb_build_object('ok',true,'dry_run',false,'messages_deleted',n,'threads_deleted',tn);
END $$ $sql$;
END $mail$;

DO $mail$
DECLARE f record;
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE (pronamespace='public'::regnamespace AND proname IN('admin_mail','mail_sync_claim','mail_sync_commit','mail_sync_release')) OR (pronamespace='private'::regnamespace AND proname IN('mail_hash','mail_check_secret','mail_refresh_thread','mail_suppress')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
END LOOP;
END $mail$;

COMMIT;
