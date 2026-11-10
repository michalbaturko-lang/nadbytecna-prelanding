-- Attachment/source revisions must invalidate stale derived results even when
-- the bounded preview text happens to be identical.
DO $migration$
DECLARE definition text; needle text; replacement text;
BEGIN
 IF to_regclass('public.email_messages') IS NULL OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_messages' AND column_name='body_truncated') THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.mail_sync_commit(uuid,jsonb,jsonb,text,boolean,text)'::regprocedure) INTO definition;
 needle:='old.received_at IS DISTINCT FROM received);';
 replacement:='old.received_at IS DISTINCT FROM received OR old.has_attachments IS DISTINCT FROM coalesce((m->>''has_attachments'')::boolean,false) OR old.body_truncated IS DISTINCT FROM coalesce((m->>''body_truncated'')::boolean,false) OR old.source_change_key IS DISTINCT FROM m->>''source_change_key'');';
 IF strpos(definition,needle)=0 AND strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'mail_source_revision_definition_changed'; END IF;
 EXECUTE replace(definition,needle,replacement);
 IF to_regprocedure('private.mail_ai_context(uuid)') IS NOT NULL THEN
  SELECT pg_get_functiondef('private.mail_ai_context(uuid)'::regprocedure) INTO definition;
  needle:='SELECT id,received_at,left(subject,512)'; replacement:='SELECT id,received_at,body_truncated,left(subject,512)';
  IF strpos(definition,needle)>0 THEN definition:=replace(definition,needle,replacement);
  ELSIF strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'mail_preview_context_definition_changed'; END IF;
  needle:='''received_at'',to_char(received_at AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')';
  replacement:=needle||',''body_truncated'',body_truncated';
  IF strpos(definition,'''body_truncated''')=0 THEN
   IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_preview_context_date_changed'; END IF;
   definition:=replace(definition,needle,replacement);
  END IF;
  EXECUTE definition;
 END IF;
END $migration$;
