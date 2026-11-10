-- Scope cursor/lease resets to the one authorized mailbox. PostgREST sessions
-- preload safeupdate and reject UPDATE without a WHERE condition.
DO $migration$
DECLARE definition text;
 old_save text:='UPDATE private.mail_sync_state SET cursor=NULL,initial_complete=false,lease=NULL,lease_until=NULL,retry_after=NULL;';
 new_save text:='UPDATE private.mail_sync_state SET cursor=NULL,initial_complete=false,lease=NULL,lease_until=NULL,retry_after=NULL WHERE mail_sync_state.mailbox=c.mailbox;';
 old_clear text:='UPDATE private.mail_sync_state SET lease=NULL,lease_until=NULL;';
 new_clear text:='UPDATE private.mail_sync_state SET lease=NULL,lease_until=NULL WHERE mail_sync_state.mailbox=c.mailbox;';
BEGIN
 IF to_regprocedure('public.mail_oauth(text,jsonb)') IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.mail_oauth(text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,old_save)=0 AND strpos(definition,new_save)=0 THEN RAISE EXCEPTION 'mail_oauth_save_definition_changed'; END IF;
 IF strpos(definition,old_clear)=0 AND strpos(definition,new_clear)=0 THEN RAISE EXCEPTION 'mail_oauth_clear_definition_changed'; END IF;
 definition:=replace(replace(definition,old_save,new_save),old_clear,new_clear);
 EXECUTE definition;
END $migration$;

-- Apply the same mailbox boundary to the (separately disabled) retention path.
DO $migration$
DECLARE definition text;
 old_reset text:='UPDATE private.mail_sync_state SET not_before=greatest(not_before,cutoff);';
 new_reset text:='UPDATE private.mail_sync_state SET not_before=greatest(not_before,cutoff) WHERE mail_sync_state.mailbox=''veryvera@nadbytecna.cz'';';
BEGIN
 IF to_regprocedure('public.admin_mail(text,jsonb)') IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.admin_mail(text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,old_reset)=0 AND strpos(definition,new_reset)=0 THEN RAISE EXCEPTION 'admin_mail_retention_definition_changed'; END IF;
 definition:=replace(definition,old_reset,new_reset);
 EXECUTE definition;
END $migration$;
