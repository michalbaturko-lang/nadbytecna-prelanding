-- A synthetic, admin-triggered Storage probe never creates mailbox/UI records.
-- Keep its intent if any cleanup step fails, for the existing cleanup worker.
DO $migration$
DECLARE d text;
 old_branch text:=$old$ IF p_action='status' THEN$old$;
 new_branch text:=$new$ IF p_action='probe_begin' THEN
  ids:=ARRAY[gen_random_uuid()]; tids:=ARRAY[gen_random_uuid()]; l:=gen_random_uuid();
  p:='objects/'||ids[1]::text||'/'||l::text||'.eml';
  INSERT INTO private.mail_archive_objects(path,message_id,thread_id,lease,revision,delete_requested,settle_after,next_cleanup_at,probe)
   VALUES(p,ids[1],tids[1],l,1,true,now()+interval '5 minutes',now()+interval '5 minutes',true);
  RETURN jsonb_build_object('path',p);
 ELSIF p_action='probe_finish' THEN
  DELETE FROM private.mail_archive_objects WHERE path=p_payload->>'path' AND probe=true AND delete_requested=true;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN jsonb_build_object('deleted',n=1);
 ELSIF p_action='status' THEN$new$;
BEGIN
 IF to_regclass('private.mail_archive_objects') IS NULL OR to_regprocedure('public.mail_archive(text,jsonb)') IS NULL THEN RETURN; END IF;
 ALTER TABLE private.mail_archive_objects ADD COLUMN IF NOT EXISTS probe boolean NOT NULL DEFAULT false;
 SELECT pg_get_functiondef('public.mail_archive(text,jsonb)'::regprocedure) INTO d;
 IF strpos(d,new_branch)=0 THEN
  IF strpos(d,old_branch)=0 THEN RAISE EXCEPTION 'mail_archive_probe_definition_changed'; END IF;
  EXECUTE replace(d,old_branch,new_branch);
 END IF;
END $migration$;
