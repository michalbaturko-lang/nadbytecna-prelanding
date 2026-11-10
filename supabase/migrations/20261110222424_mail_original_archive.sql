DO $archive_migration$
BEGIN
 IF to_regclass('public.email_messages') IS NULL THEN RETURN; END IF;
-- Original Microsoft MIME is separate from the bounded text preview. No public
-- object policies: only server-side service_role may upload/sign/remove objects.
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS has_attachments boolean NOT NULL DEFAULT false;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS body_truncated boolean NOT NULL DEFAULT false;
ALTER TABLE public.email_messages ADD COLUMN IF NOT EXISTS source_change_key text;
CREATE TABLE IF NOT EXISTS private.mail_archive_blocks(
 thread_id uuid PRIMARY KEY REFERENCES public.email_threads(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.mail_archive_jobs(
 message_id uuid PRIMARY KEY REFERENCES public.email_messages(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1, attempts int NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','archived','failed','blocked')),
 available_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
 path text, size bigint, sha256 text, error text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Pending erasures retain only pseudonymous scope and UUIDs, so a retry can
-- rediscover late upload intents after all corresponding source rows are gone.
CREATE TABLE IF NOT EXISTS private.mail_archive_erasure_scopes(
 scope_key text PRIMARY KEY, message_ids uuid[] NOT NULL DEFAULT '{}',
 thread_ids uuid[] NOT NULL DEFAULT '{}'
);
ALTER TABLE private.mail_archive_erasure_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.mail_archive_erasure_scopes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.mail_archive_erasure_scopes TO service_role;
-- Intents deliberately have no FK: deleting the source row must not discard the
-- cleanup target of a concurrent/late Storage upload. Paths contain only UUIDs.
CREATE TABLE IF NOT EXISTS private.mail_archive_objects(
 path text PRIMARY KEY, message_id uuid NOT NULL, thread_id uuid NOT NULL,
 lease uuid NOT NULL, revision bigint NOT NULL,
 delete_requested boolean NOT NULL DEFAULT false,
 settle_after timestamptz NOT NULL, next_cleanup_at timestamptz NOT NULL DEFAULT now(),
 uploaded_at timestamptz
);
CREATE INDEX IF NOT EXISTS mail_archive_ready ON private.mail_archive_jobs(available_at,message_id) WHERE status IN('pending','processing');
CREATE UNIQUE INDEX IF NOT EXISTS mail_archive_lease ON private.mail_archive_jobs(lease) WHERE lease IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_archive_cleanup ON private.mail_archive_objects(next_cleanup_at) WHERE delete_requested;
CREATE UNIQUE INDEX IF NOT EXISTS mail_archive_object_lease ON private.mail_archive_objects(lease);
CREATE INDEX IF NOT EXISTS mail_archive_object_message ON private.mail_archive_objects(message_id);
CREATE INDEX IF NOT EXISTS mail_archive_object_thread ON private.mail_archive_objects(thread_id);
ALTER TABLE private.mail_archive_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mail_archive_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mail_archive_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.mail_archive_blocks,private.mail_archive_jobs,private.mail_archive_objects FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.mail_archive_blocks,private.mail_archive_jobs,private.mail_archive_objects TO service_role;

CREATE OR REPLACE FUNCTION private.mail_archive_lock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM pg_advisory_xact_lock(84301720261107); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS mail_archive_lock ON public.email_messages;
CREATE TRIGGER mail_archive_lock BEFORE INSERT OR UPDATE OR DELETE ON public.email_messages FOR EACH STATEMENT EXECUTE FUNCTION private.mail_archive_lock();
CREATE OR REPLACE FUNCTION private.mail_archive_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE message_id=OLD.id;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.source_change_key,NEW.has_attachments,NEW.body_truncated,NEW.body_text,NEW.subject,NEW.sender_email,NEW.sender_name,NEW.received_at)
    IS NOT DISTINCT FROM ROW(OLD.source_change_key,OLD.has_attachments,OLD.body_truncated,OLD.body_text,OLD.subject,OLD.sender_email,OLD.sender_name,OLD.received_at) THEN RETURN NEW; END IF;
 INSERT INTO private.mail_archive_jobs(message_id,status)
 VALUES(NEW.id,CASE WHEN EXISTS(SELECT 1 FROM private.mail_archive_blocks WHERE thread_id=NEW.thread_id) THEN 'blocked' ELSE 'pending' END)
 ON CONFLICT(message_id) DO UPDATE SET revision=private.mail_archive_jobs.revision+1,attempts=0,
 status=CASE WHEN EXISTS(SELECT 1 FROM private.mail_archive_blocks WHERE thread_id=NEW.thread_id) THEN 'blocked' ELSE 'pending' END,
 available_at=now(),lease=NULL,lease_until=NULL,error=NULL,updated_at=now();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mail_archive_enqueue ON public.email_messages;
CREATE TRIGGER mail_archive_enqueue AFTER INSERT OR UPDATE OR DELETE ON public.email_messages FOR EACH ROW EXECUTE FUNCTION private.mail_archive_enqueue();
-- Backfill only the already-approved mirrored Inbox scope. Network remains off
-- until the separate archive feature flag is explicitly enabled.
INSERT INTO private.mail_archive_jobs(message_id) SELECT id FROM public.email_messages ON CONFLICT(message_id) DO NOTHING;

-- Preserve the existing function/OID/ACL and incorporate the three metadata
-- fields in the same atomic message+cursor commit. Guards reject schema drift.
DO $patch$
DECLARE d text; old_update text; new_update text; old_insert text; new_insert text;
BEGIN
 IF to_regprocedure('public.mail_sync_commit(uuid,jsonb,jsonb,text,boolean,text)') IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.mail_sync_commit(uuid,jsonb,jsonb,text,boolean,text)'::regprocedure) INTO d;
 old_update:='source_removed_at=NULL,message_hash=mh,internet_hash=ih,sender_hash=sh WHERE id=old.id;';
 new_update:='source_removed_at=NULL,message_hash=mh,internet_hash=ih,sender_hash=sh,has_attachments=coalesce((m->>''has_attachments'')::boolean,false),body_truncated=coalesce((m->>''body_truncated'')::boolean,false),source_change_key=left(m->>''source_change_key'',2048) WHERE id=old.id;';
 old_insert:='body_text,received_at,message_hash,internet_hash,sender_hash)';
 new_insert:='body_text,received_at,message_hash,internet_hash,sender_hash,has_attachments,body_truncated,source_change_key)';
 IF strpos(d,new_update)=0 THEN
  IF strpos(d,old_update)=0 OR strpos(d,old_insert)=0 OR strpos(d,'received,mh,ih,sh);')=0 THEN RAISE EXCEPTION 'mail_archive_sync_definition_changed'; END IF;
  d:=replace(replace(replace(d,old_update,new_update),old_insert,new_insert),'received,mh,ih,sh);','received,mh,ih,sh,coalesce((m->>''has_attachments'')::boolean,false),coalesce((m->>''body_truncated'')::boolean,false),left(m->>''source_change_key'',2048));');
  EXECUTE d;
 END IF;
END $patch$;

-- Preserve the deletion transaction's exact scope after source rows disappear.
-- A participant can receive another message/new thread between the preparatory
-- Storage cleanup and this transaction; originals quoting them are blocked too.
DO $erase_patch$
DECLARE d text;
 old_return text:='RETURN jsonb_build_object(''ok'',true,''dry_run'',false,''messages_deleted'',n,''threads_deleted'',tn);';
 new_return text:='RETURN jsonb_build_object(''ok'',true,''dry_run'',false,''messages_deleted'',n,''threads_deleted'',tn,''archive_scope'',jsonb_build_object(''messageIds'',coalesce(to_jsonb(ids),''[]''::jsonb),''threadIds'',coalesce(to_jsonb(threads),''[]''::jsonb),''scopeKey'',CASE WHEN p_action=''erase'' THEN private.mail_hash(''archive-erasure:''||email,secret) WHEN p_action=''retention'' THEN ''retention'' ELSE ''thread:''||tid::text END));';
 old_suppress text:='PERFORM private.mail_suppress(ids);';
 new_suppress text:=$erase_scope$INSERT INTO private.mail_archive_erasure_scopes(scope_key,message_ids,thread_ids)
 VALUES(CASE WHEN p_action='erase' THEN private.mail_hash('archive-erasure:'||email,secret) WHEN p_action='retention' THEN 'retention' ELSE 'thread:'||tid::text END,coalesce(ids,'{}'::uuid[]),coalesce(threads,'{}'::uuid[]))
 ON CONFLICT(scope_key) DO UPDATE SET message_ids=ARRAY(SELECT DISTINCT unnest(private.mail_archive_erasure_scopes.message_ids||excluded.message_ids)),thread_ids=ARRAY(SELECT DISTINCT unnest(private.mail_archive_erasure_scopes.thread_ids||excluded.thread_ids));
IF p_action='erase' AND threads IS NOT NULL THEN
 INSERT INTO private.mail_archive_blocks(thread_id) SELECT id FROM public.email_threads WHERE id=ANY(threads) ON CONFLICT DO NOTHING;
 UPDATE private.mail_archive_jobs SET status='blocked',lease=NULL,lease_until=NULL,updated_at=now() WHERE message_id IN(SELECT id FROM public.email_messages WHERE thread_id=ANY(threads));
 UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE thread_id=ANY(threads);
END IF;
PERFORM private.mail_suppress(ids);$erase_scope$;
BEGIN
 IF to_regprocedure('public.admin_mail(text,jsonb)') IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.admin_mail(text,jsonb)'::regprocedure) INTO d;
 IF strpos(d,new_return)=0 THEN
  IF strpos(d,old_return)=0 THEN RAISE EXCEPTION 'mail_archive_erase_definition_changed'; END IF;
  d:=replace(d,old_return,new_return);
 END IF;
 IF strpos(d,new_suppress)=0 THEN
  IF strpos(d,old_suppress)=0 THEN RAISE EXCEPTION 'mail_archive_suppress_definition_changed'; END IF;
  d:=replace(d,old_suppress,new_suppress);
 END IF;
 EXECUTE d;
END $erase_patch$;

CREATE OR REPLACE FUNCTION public.mail_archive(p_action text,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j private.mail_archive_jobs; o private.mail_archive_objects; m public.email_messages; ids uuid[]; tids uuid[]; l uuid; p text; n int; err text; result jsonb; erasure_key text; prior private.mail_archive_erasure_scopes;
BEGIN
 PERFORM pg_advisory_xact_lock(84301720261107);
 IF p_action='status' THEN
  RETURN (SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'processing',count(*) FILTER(WHERE status='processing'),'archived',count(*) FILTER(WHERE status='archived'),'failed',count(*) FILTER(WHERE status='failed'),'blocked',count(*) FILTER(WHERE status='blocked'),'cleanupPending',(SELECT count(*) FROM private.mail_archive_objects WHERE delete_requested)) FROM private.mail_archive_jobs);
 ELSIF p_action='claim' THEN
  -- An abandoned third lease becomes visibly failed, never silently archived.
  UPDATE private.mail_archive_jobs SET status='failed',lease=NULL,lease_until=NULL,error='lease_expired',updated_at=now() WHERE status='processing' AND lease_until<=now() AND attempts>=3;
  SELECT q.* INTO j FROM private.mail_archive_jobs q JOIN public.email_messages e ON e.id=q.message_id
   WHERE (q.status='pending' OR (q.status='processing' AND q.lease_until<=now())) AND q.available_at<=now() AND q.attempts<3
   ORDER BY e.received_at DESC,q.available_at,q.message_id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.email_messages WHERE id=j.message_id;
  l:=gen_random_uuid(); p:='objects/'||m.id::text||'/'||l::text||'.eml';
  INSERT INTO private.mail_archive_objects(path,message_id,thread_id,lease,revision,settle_after) VALUES(p,m.id,m.thread_id,l,j.revision,now()+interval '10 minutes');
  UPDATE private.mail_archive_jobs SET status='processing',lease=l,lease_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() WHERE message_id=j.message_id;
  RETURN jsonb_build_object('id',m.id,'externalId',m.external_id,'revision',j.revision,'lease',l,'path',p);
 ELSIF p_action='retry' THEN
  UPDATE private.mail_archive_jobs SET status='pending',attempts=0,available_at=now(),lease=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE message_id=(p_payload->>'id')::uuid AND status='failed'; GET DIAGNOSTICS n=ROW_COUNT;
  RETURN jsonb_build_object('queued',n=1);
 ELSIF p_action='active' THEN
  RETURN jsonb_build_object('active',EXISTS(SELECT 1 FROM private.mail_archive_jobs q JOIN private.mail_archive_objects x ON x.lease=q.lease WHERE q.lease=(p_payload->>'lease')::uuid AND q.status='processing' AND q.lease_until>now() AND q.revision=x.revision AND NOT x.delete_requested));
 ELSIF p_action IN('finish','fail') THEN
  l:=(p_payload->>'lease')::uuid;
  SELECT * INTO o FROM private.mail_archive_objects WHERE lease=l;
  IF NOT FOUND THEN RETURN jsonb_build_object('saved',false); END IF;
  SELECT * INTO j FROM private.mail_archive_jobs WHERE message_id=o.message_id FOR UPDATE;
  IF NOT FOUND OR j.status<>'processing' OR j.lease IS DISTINCT FROM l OR j.lease_until<=now() OR j.revision<>o.revision OR o.delete_requested THEN
   UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE path=o.path;
   RETURN jsonb_build_object('saved',false);
  END IF;
  IF p_action='finish' THEN
   IF coalesce((p_payload->>'size')::bigint,0) NOT BETWEEN 1 AND 52428800 OR coalesce(p_payload->>'sha256','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'mail_archive_input'; END IF;
   UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE message_id=j.message_id AND path<>o.path;
   UPDATE private.mail_archive_objects SET uploaded_at=now(),settle_after=now() WHERE path=o.path;
   UPDATE private.mail_archive_jobs SET status='archived',path=o.path,size=(p_payload->>'size')::bigint,sha256=p_payload->>'sha256',lease=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE message_id=j.message_id;
  ELSE
   err:=CASE WHEN p_payload->>'error' IN('response_too_large','source_missing','authentication_failed','throttled','timeout','network_error','http_error','invalid_response','invalid_configuration','storage_failed','connection_changed') THEN p_payload->>'error' ELSE 'archive_failed' END;
   UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE path=o.path;
   UPDATE private.mail_archive_jobs SET status=CASE WHEN (attempts>=3 AND err<>'throttled') OR err='response_too_large' OR err='source_missing' THEN 'failed' ELSE 'pending' END,attempts=CASE WHEN err='throttled' THEN greatest(0,attempts-1) ELSE attempts END,
    available_at=now()+greatest(CASE WHEN attempts=1 THEN interval '5 minutes' ELSE interval '15 minutes' END,make_interval(secs=>CASE WHEN coalesce(p_payload->>'retry_after_seconds','') ~ '^[0-9]{1,5}$' THEN least(86400,(p_payload->>'retry_after_seconds')::int) ELSE 0 END)),lease=NULL,lease_until=NULL,error=err,updated_at=now() WHERE message_id=j.message_id;
  END IF;
  RETURN jsonb_build_object('saved',true);
 ELSIF p_action IN('list','prepare_delete') THEN
  IF p_payload->>'threadId' IS NOT NULL THEN
   tids:=ARRAY[(p_payload->>'threadId')::uuid];
   SELECT array_agg(id) INTO ids FROM public.email_messages WHERE thread_id=ANY(tids);
  ELSIF p_payload->>'email' IS NOT NULL THEN
   SELECT array_agg(DISTINCT thread_id) INTO tids FROM public.email_messages WHERE sender_email=lower(trim(p_payload->>'email'));
   -- Originals can quote any participant: erasure blocks the whole conversation.
   SELECT array_agg(id) INTO ids FROM public.email_messages WHERE CASE WHEN p_action='prepare_delete' THEN thread_id=ANY(tids) ELSE sender_email=lower(trim(p_payload->>'email')) END;
  ELSIF p_payload->>'cutoff' IS NOT NULL AND p_action='prepare_delete' THEN
   SELECT array_agg(id) INTO ids FROM public.email_messages WHERE received_at<(p_payload->>'cutoff')::timestamptz;
  ELSIF p_payload->>'id' IS NOT NULL AND p_action='list' THEN ids:=ARRAY[(p_payload->>'id')::uuid];
  ELSE RAISE EXCEPTION 'mail_archive_scope'; END IF;
  IF p_action='prepare_delete' THEN
   IF p_payload->>'email' IS NOT NULL THEN
    PERFORM private.mail_check_secret(p_payload->>'hash_secret');
    erasure_key:=private.mail_hash('archive-erasure:'||lower(trim(p_payload->>'email')),p_payload->>'hash_secret');
   ELSIF p_payload->>'cutoff' IS NOT NULL THEN erasure_key:='retention';
   ELSE erasure_key:='thread:'||(p_payload->>'threadId'); END IF;
   SELECT * INTO prior FROM private.mail_archive_erasure_scopes x WHERE x.scope_key=erasure_key;
   ids:=ARRAY(SELECT DISTINCT unnest(coalesce(ids,'{}'::uuid[])||coalesce(prior.message_ids,'{}'::uuid[])));
   tids:=ARRAY(SELECT DISTINCT unnest(coalesce(tids,'{}'::uuid[])||coalesce(prior.thread_ids,'{}'::uuid[])));
   INSERT INTO private.mail_archive_erasure_scopes(scope_key,message_ids,thread_ids) VALUES(erasure_key,ids,tids)
    ON CONFLICT ON CONSTRAINT mail_archive_erasure_scopes_pkey DO UPDATE SET message_ids=excluded.message_ids,thread_ids=excluded.thread_ids;
   IF tids IS NOT NULL THEN INSERT INTO private.mail_archive_blocks(thread_id) SELECT id FROM public.email_threads WHERE id=ANY(tids) ON CONFLICT DO NOTHING; END IF;
   UPDATE private.mail_archive_jobs SET status='blocked',lease=NULL,lease_until=NULL,updated_at=now() WHERE message_id=ANY(ids);
   UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE message_id=ANY(ids) OR thread_id=ANY(tids);
   RETURN jsonb_build_object('blocked',coalesce(cardinality(ids),0),'messageIds',coalesce(to_jsonb(ids),'[]'::jsonb),'threadIds',coalesce(to_jsonb(tids),'[]'::jsonb),'scopeKey',erasure_key);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'status',coalesce(q.status,'pending'),'size',q.size,'sha256',q.sha256,'path',CASE WHEN q.status='archived' THEN q.path END,'hasAttachments',e.has_attachments,'bodyTruncated',e.body_truncated,'error',q.error) ORDER BY e.received_at,e.id),'[]'::jsonb) INTO result FROM public.email_messages e LEFT JOIN private.mail_archive_jobs q ON q.message_id=e.id WHERE e.id=ANY(ids);
  RETURN jsonb_build_object('messages',result);
 ELSIF p_action='cleanup_pending' THEN
  RETURN jsonb_build_object('pending',(SELECT count(*) FROM private.mail_archive_objects x WHERE x.delete_requested AND (NOT (p_payload ? 'messageIds' OR p_payload ? 'threadIds') OR x.message_id IN(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(p_payload->'messageIds','[]'::jsonb))) OR x.thread_id IN(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(p_payload->'threadIds','[]'::jsonb))))));
 ELSIF p_action='cleanup_list' THEN
  UPDATE private.mail_archive_objects SET delete_requested=true,next_cleanup_at=now() WHERE uploaded_at IS NULL AND settle_after<=now() AND NOT delete_requested;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT path FROM private.mail_archive_objects WHERE delete_requested AND next_cleanup_at<=now() AND (NOT (p_payload ? 'messageIds' OR p_payload ? 'threadIds') OR message_id IN(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(p_payload->'messageIds','[]'::jsonb))) OR thread_id IN(SELECT value::uuid FROM jsonb_array_elements_text(coalesce(p_payload->'threadIds','[]'::jsonb)))) ORDER BY next_cleanup_at,path LIMIT 100) x),'[]'::jsonb);
 ELSIF p_action='scope_done' THEN
  DELETE FROM private.mail_archive_erasure_scopes s WHERE s.scope_key IN(SELECT value FROM jsonb_array_elements_text(coalesce(p_payload->'scopeKeys','[]'::jsonb))) AND NOT EXISTS(SELECT 1 FROM private.mail_archive_objects x WHERE x.delete_requested AND (x.message_id=ANY(s.message_ids) OR x.thread_id=ANY(s.thread_ids)));
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='cleanup_done_batch' THEN
  DELETE FROM private.mail_archive_objects WHERE path IN(SELECT value FROM jsonb_array_elements_text(p_payload->'paths')) AND delete_requested AND settle_after<=now();
  UPDATE private.mail_archive_objects SET next_cleanup_at=settle_after WHERE path IN(SELECT value FROM jsonb_array_elements_text(p_payload->'paths')) AND delete_requested;
  DELETE FROM private.mail_archive_erasure_scopes s WHERE NOT EXISTS(SELECT 1 FROM private.mail_archive_objects x WHERE x.delete_requested AND (x.message_id=ANY(s.message_ids) OR x.thread_id=ANY(s.thread_ids)));
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='cleanup_done' THEN
  p:=p_payload->>'path';
  -- First successful deletion is repeated after all possible worker uploads have
  -- expired; only then can the intent be removed without resurrecting an orphan.
  DELETE FROM private.mail_archive_objects WHERE path=p AND delete_requested AND settle_after<=now(); GET DIAGNOSTICS n=ROW_COUNT;
  UPDATE private.mail_archive_objects SET next_cleanup_at=settle_after WHERE path=p AND delete_requested;
  DELETE FROM private.mail_archive_erasure_scopes s WHERE NOT EXISTS(SELECT 1 FROM private.mail_archive_objects x WHERE x.delete_requested AND (x.message_id=ANY(s.message_ids) OR x.thread_id=ANY(s.thread_ids)));
  RETURN jsonb_build_object('settled',n=1);
 END IF;
 RAISE EXCEPTION 'mail_archive_action';
END $$;
REVOKE ALL ON FUNCTION public.mail_archive(text,jsonb),private.mail_archive_lock(),private.mail_archive_enqueue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mail_archive(text,jsonb),private.mail_archive_lock(),private.mail_archive_enqueue() TO service_role;
DO $bucket$
BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  DROP POLICY IF EXISTS mail_originals_server_only ON storage.objects;
  CREATE POLICY mail_originals_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id <> 'mail-originals') WITH CHECK(bucket_id <> 'mail-originals');
 END IF;
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('mail-originals','mail-originals',false,52428800,ARRAY['message/rfc822','application/octet-stream']) ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;
 END IF;
END $bucket$;

END $archive_migration$;
