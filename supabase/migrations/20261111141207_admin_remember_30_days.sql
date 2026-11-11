-- Server-enforced absolute deadline; refresh/last_seen never extend it.
DO $migration$
DECLARE d text; old_rule text; new_rule text;
BEGIN
 IF to_regclass('private.admin_sessions') IS NULL THEN RETURN; END IF;
 ALTER TABLE private.admin_sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 days');
 SELECT pg_get_functiondef('public.admin_access(uuid,text,text)'::regprocedure) INTO d;
 old_rule:='OR s.last_seen <= now()-interval ''12 hours''';
 new_rule:='OR s.last_seen <= now()-interval ''30 days'' OR s.expires_at <= now()';
 IF strpos(d,new_rule)=0 THEN
  IF strpos(d,old_rule)=0 THEN RAISE EXCEPTION 'admin_session_access_definition_changed'; END IF;
  EXECUTE replace(d,old_rule,new_rule);
 END IF;
 SELECT pg_get_functiondef('private.is_admin()'::regprocedure) INTO d;
 old_rule:='AND s.last_seen > now()-interval ''12 hours''';
 new_rule:='AND s.last_seen > now()-interval ''30 days'' AND s.expires_at > now()';
 IF strpos(d,new_rule)=0 THEN
  IF strpos(d,old_rule)=0 THEN RAISE EXCEPTION 'admin_session_rls_definition_changed'; END IF;
  EXECUTE replace(d,old_rule,new_rule);
 END IF;
END $migration$;
