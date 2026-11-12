-- Retry temporary provider/storage failures durably; do not resurrect blocked/deleted sources.
DO $patch$
DECLARE d text; old text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.mail_archive(text,jsonb)'::regprocedure) INTO d;
 IF strpos(d,'mail_transient_retry_v2')>0 THEN RETURN; END IF;
 old:='UPDATE private.mail_archive_jobs SET status=''failed'',lease=NULL,lease_until=NULL,error=''lease_expired'',updated_at=now() WHERE status=''processing'' AND lease_until<=now() AND attempts>=3;';
 replacement:='-- mail_transient_retry_v2: an interrupted worker remains retryable.'||chr(10)||'UPDATE private.mail_archive_jobs SET status=''pending'',lease=NULL,lease_until=NULL,error=''lease_expired'',available_at=now()+interval ''5 minutes'',updated_at=now() WHERE status=''processing'' AND lease_until<=now() AND attempts>=3;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'archive_recovery_definition_changed'; END IF; d:=replace(d,old,replacement);
 old:='AND q.attempts<3';
 replacement:='AND (q.attempts<3 OR q.error IN(''throttled'',''timeout'',''network_error'',''http_error'',''storage_failed'',''connection_changed'',''lease_expired''))';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'archive_claim_definition_changed'; END IF; d:=replace(d,old,replacement);
 old:='lease_until=now()+interval ''3 minutes''';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'archive_lease_definition_changed'; END IF; d:=replace(d,old,'lease_until=now()+interval ''5 minutes''');
 old:='status=CASE WHEN (attempts>=3 AND err<>''throttled'') OR err=''response_too_large'' OR err=''source_missing'' THEN ''failed'' ELSE ''pending'' END';
 replacement:='status=CASE WHEN err IN(''timeout'',''network_error'',''http_error'',''storage_failed'',''connection_changed'') THEN ''pending'' WHEN (attempts>=3 AND err<>''throttled'') OR err=''response_too_large'' OR err=''source_missing'' THEN ''failed'' ELSE ''pending'' END';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'archive_failure_definition_changed'; END IF; d:=replace(d,old,replacement);
 old:='CASE WHEN attempts=1 THEN interval ''5 minutes'' ELSE interval ''15 minutes'' END';
 replacement:='CASE WHEN err IN(''timeout'',''network_error'',''http_error'',''storage_failed'',''connection_changed'') THEN make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::int) WHEN attempts=1 THEN interval ''5 minutes'' ELSE interval ''15 minutes'' END';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'archive_backoff_definition_changed'; END IF; d:=replace(d,old,replacement);
 EXECUTE d;
END $patch$;
UPDATE private.mail_archive_jobs q SET status='pending',attempts=0,available_at=now(),lease=NULL,lease_until=NULL,error=NULL,updated_at=now()
FROM public.email_messages m WHERE m.id=q.message_id AND q.status IN('failed','pending') AND q.error IN('timeout','network_error','http_error','storage_failed','connection_changed','lease_expired')
AND NOT EXISTS(SELECT 1 FROM private.mail_archive_blocks b WHERE b.thread_id=m.thread_id);
