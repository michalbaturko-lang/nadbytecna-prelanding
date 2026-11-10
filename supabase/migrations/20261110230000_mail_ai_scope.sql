-- A mirror may contain non-project mail. Import authorization alone never
-- approves forwarding it to an AI provider. Existing threads default unmarked.
DO $scope$
DECLARE definition text; needle text;
BEGIN
 IF to_regclass('public.email_threads') IS NULL OR to_regclass('private.mail_ai_jobs') IS NULL THEN RETURN; END IF;
 ALTER TABLE public.email_threads
  ADD COLUMN IF NOT EXISTS ai_scope_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_scope_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_scope_version integer NOT NULL DEFAULT 1 CHECK(ai_scope_version>0),
  ADD COLUMN IF NOT EXISTS ai_scope_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_scope_approved_by uuid,
  ADD COLUMN IF NOT EXISTS ai_scope_approved_email text;

 -- Service-only legacy claim remains available for old migrations/tests. The
 -- live worker always uses this SQL-filtered variant, never claim-then-filter.
 SELECT pg_get_functiondef('public.mail_ai_claim()'::regprocedure) INTO definition;
 definition:=replace(definition,'public.mail_ai_claim()','public.mail_ai_claim_scoped(p_allow_unmarked boolean DEFAULT false)');
 needle:='WHERE NOT q.done AND';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'mail_scope_claim_definition_changed'; END IF;
 definition:=replace(definition,needle,'WHERE NOT x.ai_scope_blocked AND (x.ai_scope_approved OR coalesce(p_allow_unmarked,false)) AND NOT q.done AND');
 EXECUTE definition;

 EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('id',t.id,'revision',t.revision,'messages',private.mail_ai_context(t.id),
   'ai_scope_approved',t.ai_scope_approved,'ai_scope_blocked',t.ai_scope_blocked,'ai_scope_version',t.ai_scope_version)
  FROM public.email_threads t WHERE t.id=p_id
 $$ $ddl$;

 EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_set_ai_scope(p_id uuid,p_revision integer,p_approved boolean,p_actor uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE t public.email_threads;
 BEGIN
  PERFORM pg_advisory_xact_lock(84301720261107);
  IF p_revision IS NULL OR p_revision<1 OR p_approved IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=p_actor) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=p_email) OR NOT private.verified_admin_identity(p_actor,p_email) THEN RAISE EXCEPTION 'mail_scope_identity'; END IF;
  SELECT * INTO t FROM public.email_threads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','missing'); END IF;
  IF t.revision<>p_revision THEN RETURN jsonb_build_object('saved',false,'reason','changed'); END IF;
  UPDATE public.email_threads SET ai_scope_approved=p_approved,ai_scope_blocked=NOT p_approved,ai_scope_version=ai_scope_version+1,
   ai_scope_approved_at=now(),ai_scope_approved_by=p_actor,ai_scope_approved_email=p_email,updated_at=now() WHERE id=p_id;
  -- Revoke/reapprove both cancel an older lease. A request already sent cannot
  -- be recalled, but the old finish cannot persist after this transaction.
  UPDATE private.mail_ai_jobs SET attempts=greatest(0,attempts-1),lease=NULL,lease_until=NULL,available_at=now(),updated_at=now()
   WHERE thread_id=p_id AND lease IS NOT NULL;
  INSERT INTO public.admin_audit_log(user_id,email,action,entity,entity_id,diff)
   VALUES(p_actor,p_email,'mail_ai_scope','email_threads',p_id,jsonb_build_object('approved',p_approved,'blocked',NOT p_approved,'scope_version',t.ai_scope_version+1,'revision',p_revision));
  RETURN jsonb_build_object('saved',true,'ai_scope_approved',p_approved,'ai_scope_blocked',NOT p_approved,'ai_scope_version',t.ai_scope_version+1);
 END $$ $ddl$;

 EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_scope_active(p_lease uuid,p_allow_unmarked boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('active',EXISTS(SELECT 1 FROM private.mail_ai_jobs q JOIN public.email_threads t ON t.id=q.thread_id
   WHERE q.lease=p_lease AND NOT q.done AND q.lease_until>now() AND q.revision=t.revision AND t.status<>'archived' AND t.ai_at IS NULL
    AND NOT t.ai_scope_blocked AND (t.ai_scope_approved OR coalesce(p_allow_unmarked,false))))
 $$ $ddl$;

 EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_save_scoped(p_payload jsonb,p_allow_unmarked boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
 DECLARE t public.email_threads; expected_version integer;
 BEGIN
  PERFORM pg_advisory_xact_lock(84301720261107);
  SELECT * INTO t FROM public.email_threads WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','missing'); END IF;
  IF t.revision IS DISTINCT FROM (p_payload->>'revision')::integer THEN RETURN jsonb_build_object('saved',false,'reason','changed'); END IF;
  IF p_payload ? 'scope_version' THEN
   expected_version:=(p_payload->>'scope_version')::integer;
   IF expected_version IS DISTINCT FROM t.ai_scope_version THEN RETURN jsonb_build_object('saved',false,'reason','scope'); END IF;
  END IF;
  IF t.ai_scope_blocked OR NOT(t.ai_scope_approved OR coalesce(p_allow_unmarked,false)) THEN RETURN jsonb_build_object('saved',false,'reason','scope'); END IF;
  RETURN public.admin_mail('ai_save',p_payload);
 END $$ $ddl$;

 EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_status_scoped(p_allow_unmarked boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  WITH jobs AS (SELECT j.*,t.ai_at,NOT t.ai_scope_blocked AND (t.ai_scope_approved OR coalesce(p_allow_unmarked,false)) allowed
   FROM private.mail_ai_jobs j JOIN public.email_threads t ON t.id=j.thread_id)
  SELECT jsonb_build_object(
   'queued',count(*) FILTER(WHERE allowed AND NOT done AND attempts<3 AND (lease_until IS NULL OR lease_until<=now())),
   'awaitingScope',count(*) FILTER(WHERE NOT done AND NOT allowed),
   'processing',count(*) FILTER(WHERE NOT done AND lease_until>now()),
   'failed',count(*) FILTER(WHERE last_error IS NOT NULL AND (done OR attempts>=3)),
   'completed',count(*) FILTER(WHERE done AND last_error IS NULL AND ai_at IS NOT NULL)
  ) FROM jobs
 $$ $ddl$;

 REVOKE ALL ON FUNCTION public.mail_ai_claim_scoped(boolean),public.mail_set_ai_scope(uuid,integer,boolean,uuid,text),public.mail_ai_scope_active(uuid,boolean),public.mail_ai_save_scoped(jsonb,boolean),public.mail_ai_status_scoped(boolean) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.mail_ai_claim_scoped(boolean),public.mail_set_ai_scope(uuid,integer,boolean,uuid,text),public.mail_ai_scope_active(uuid,boolean),public.mail_ai_save_scoped(jsonb,boolean),public.mail_ai_status_scoped(boolean) TO service_role;
 -- Re-applying this migration must not disturb live leases or approvals.
END $scope$;
