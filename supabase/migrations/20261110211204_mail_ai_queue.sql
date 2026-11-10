-- Local mirror only. Enqueueing never calls Graph or an AI provider.
-- Claim/finish are service-role-only; application approval flags gate every worker call.
BEGIN;
DO $migration$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
CREATE TABLE IF NOT EXISTS private.mail_ai_jobs (
 thread_id uuid PRIMARY KEY REFERENCES public.email_threads(id) ON DELETE CASCADE,
 revision int NOT NULL CHECK(revision>0), attempts int NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
 done boolean NOT NULL DEFAULT false, last_error text CHECK(last_error IN('classification_failed','retries_exhausted')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((lease IS NULL)=(lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS mail_ai_jobs_ready ON private.mail_ai_jobs(available_at,thread_id) WHERE NOT done;
CREATE UNIQUE INDEX IF NOT EXISTS mail_ai_jobs_lease ON private.mail_ai_jobs(lease) WHERE lease IS NOT NULL;
REVOKE ALL ON private.mail_ai_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.mail_ai_jobs TO service_role;
ALTER TABLE private.mail_ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.mail_ai_jobs FORCE ROW LEVEL SECURITY;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_ai_context(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 WITH recent AS (
  SELECT id,received_at,left(subject,512) subject,right(body_text,20000) body_text
  FROM public.email_messages WHERE thread_id=p_id AND source_removed_at IS NULL
  ORDER BY received_at DESC,id DESC LIMIT 30
 ), budgeted AS (
  SELECT *,coalesce(sum(length(subject)+length(body_text)+8) OVER(ORDER BY received_at DESC,id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) spent FROM recent
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'subject',left(subject,greatest(0,20000-spent)::int),
  'body_text',right(body_text,greatest(0,20000-spent-length(subject)-8)::int)
 ) ORDER BY received_at,id),'[]'::jsonb) FROM budgeted WHERE spent<20000
$$ $ddl$;
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',t.id,'revision',t.revision,'messages',private.mail_ai_context(t.id))
 FROM public.email_threads t WHERE t.id=p_id
$$ $ddl$;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_ai_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.ai_at IS NOT NULL OR NEW.status='archived' THEN
  UPDATE private.mail_ai_jobs SET done=true,lease=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE thread_id=NEW.id;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision AND NOT(OLD.status='archived' AND NEW.status<>'archived') THEN RETURN NEW; END IF;
 INSERT INTO private.mail_ai_jobs(thread_id,revision) VALUES(NEW.id,NEW.revision)
 ON CONFLICT(thread_id) DO UPDATE SET revision=excluded.revision,attempts=0,available_at=now(),lease=NULL,lease_until=NULL,done=false,last_error=NULL,updated_at=now();
 RETURN NEW;
END $$ $ddl$;
DROP TRIGGER IF EXISTS mail_ai_enqueue ON public.email_threads;
CREATE TRIGGER mail_ai_enqueue AFTER INSERT OR UPDATE OF revision,status,ai_at ON public.email_threads FOR EACH ROW EXECUTE FUNCTION private.mail_ai_enqueue();

-- A statement guard obtains the advisory lock before any message row lock,
-- including direct service-role source-marker maintenance outside the import RPC.
EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_ai_source_lock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(84301720261107);
 RETURN NULL;
END $$ $ddl$;
DROP TRIGGER IF EXISTS mail_ai_source_lock ON public.email_messages;
CREATE TRIGGER mail_ai_source_lock BEFORE UPDATE OF source_removed_at ON public.email_messages FOR EACH STATEMENT EXECUTE FUNCTION private.mail_ai_source_lock();

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION private.mail_ai_source_change() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 -- Repeated tombstones do not requeue. A removal/restoration changes the exact AI snapshot.
 IF (OLD.source_removed_at IS NULL) IS DISTINCT FROM (NEW.source_removed_at IS NULL) THEN
  PERFORM pg_advisory_xact_lock(84301720261107);
  PERFORM private.mail_refresh_thread(NEW.thread_id);
 END IF;
 RETURN NEW;
END $$ $ddl$;
DROP TRIGGER IF EXISTS mail_ai_source_change ON public.email_messages;
CREATE TRIGGER mail_ai_source_change AFTER UPDATE OF source_removed_at ON public.email_messages FOR EACH ROW EXECUTE FUNCTION private.mail_ai_source_change();

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE t public.email_threads; j private.mail_ai_jobs; content jsonb; ticket uuid;
BEGIN
 -- Existing import/GDPR operations use this same order: advisory -> thread -> queue.
 -- The advisory lock spans only this short transaction, never the model request.
 PERFORM pg_advisory_xact_lock(84301720261107);
 LOOP
  SELECT x.* INTO t FROM public.email_threads x JOIN private.mail_ai_jobs q ON q.thread_id=x.id
  WHERE NOT q.done AND q.available_at<=now() AND (q.lease_until IS NULL OR q.lease_until<=now())
  ORDER BY CASE x.admin_urgency WHEN 'acute' THEN 2 WHEN 'high' THEN 1 ELSE 0 END DESC,
   x.last_received_at DESC NULLS LAST,q.available_at,q.created_at,q.thread_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO j FROM private.mail_ai_jobs WHERE thread_id=t.id FOR UPDATE;
  IF j.revision<>t.revision OR t.ai_at IS NOT NULL OR t.status='archived' THEN
   UPDATE private.mail_ai_jobs SET done=true,lease=NULL,lease_until=NULL,updated_at=now() WHERE thread_id=t.id;
   CONTINUE;
  END IF;
  content:=private.mail_ai_context(t.id);
  IF jsonb_array_length(content)=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(content) c WHERE length(trim(coalesce(c->>'subject','')||coalesce(c->>'body_text','')))>0) THEN
   UPDATE private.mail_ai_jobs SET done=true,lease=NULL,lease_until=NULL,updated_at=now() WHERE thread_id=t.id;
   CONTINUE;
  END IF;
  IF j.attempts>=3 THEN
   UPDATE public.email_threads SET ai_error='classification_failed' WHERE id=t.id;
   UPDATE private.mail_ai_jobs SET done=true,lease=NULL,lease_until=NULL,last_error='retries_exhausted',updated_at=now() WHERE thread_id=t.id;
   INSERT INTO public.admin_audit_log(action,entity,entity_id,diff) VALUES('mail_ai_automatic','email_threads',t.id,jsonb_build_object('error',true,'attempt',j.attempts));
   CONTINUE;
  END IF;
  ticket:=gen_random_uuid();
  UPDATE private.mail_ai_jobs SET attempts=attempts+1,lease=ticket,lease_until=now()+interval '3 minutes',updated_at=now() WHERE thread_id=t.id;
  RETURN jsonb_build_object('id',t.id,'revision',t.revision,'lease',ticket,'messages',content);
 END LOOP;
END $$ $ddl$;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_finish(p_lease uuid,p_output jsonb,p_error boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE tid uuid; t public.email_threads; j private.mail_ai_jobs;
BEGIN
 PERFORM pg_advisory_xact_lock(84301720261107);
 SELECT thread_id INTO tid FROM private.mail_ai_jobs WHERE lease=p_lease;
 IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','lease'); END IF;
 SELECT * INTO t FROM public.email_threads WHERE id=tid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','missing'); END IF;
 SELECT * INTO j FROM private.mail_ai_jobs WHERE thread_id=tid AND lease=p_lease FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','lease'); END IF;
 IF j.lease_until<=now() THEN
  UPDATE private.mail_ai_jobs SET lease=NULL,lease_until=NULL,available_at=now(),updated_at=now() WHERE thread_id=tid;
  RETURN jsonb_build_object('saved',false,'reason','expired');
 END IF;
 IF j.revision<>t.revision OR t.ai_at IS NOT NULL OR t.status='archived' THEN
  UPDATE private.mail_ai_jobs SET done=true,lease=NULL,lease_until=NULL,updated_at=now() WHERE thread_id=tid;
  RETURN jsonb_build_object('saved',false,'reason','changed');
 END IF;
 IF p_error IS TRUE THEN
  UPDATE public.email_threads SET ai_error='classification_failed' WHERE id=tid;
  UPDATE private.mail_ai_jobs SET done=attempts>=3,available_at=now()+CASE WHEN attempts=1 THEN interval '5 minutes' ELSE interval '15 minutes' END,
   lease=NULL,lease_until=NULL,last_error=CASE WHEN attempts>=3 THEN 'retries_exhausted' ELSE 'classification_failed' END,updated_at=now() WHERE thread_id=tid;
 ELSE
  IF p_error IS NULL OR jsonb_typeof(p_output) IS DISTINCT FROM 'object' OR jsonb_typeof(p_output->'summary') IS DISTINCT FROM 'string' OR
   nullif(trim(p_output->>'summary'),'') IS NULL OR length(p_output->>'summary')>1000 OR jsonb_typeof(p_output->'help_type') IS DISTINCT FROM 'string' OR
   length(p_output->>'help_type')>500 OR p_output->>'email_type' IS NULL OR p_output->>'email_type' NOT IN('story','help','other') OR
   p_output->>'urgency' IS NULL OR p_output->>'urgency' NOT IN('low','medium','high','acute') OR jsonb_typeof(p_output->'model') IS DISTINCT FROM 'string' OR
   length(p_output->>'model') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'mail_ai'; END IF;
  IF p_output->>'category' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE code=p_output->>'category' AND active) THEN RAISE EXCEPTION 'mail_category'; END IF;
  UPDATE public.email_threads SET ai_summary=p_output->>'summary',ai_category=p_output->>'category',ai_urgency=p_output->>'urgency',
   ai_email_type=p_output->>'email_type',ai_help_type=p_output->>'help_type',ai_model=p_output->>'model',ai_at=now(),ai_error=NULL WHERE id=tid;
  UPDATE private.mail_ai_jobs SET done=true,lease=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE thread_id=tid;
 END IF;
 INSERT INTO public.admin_audit_log(action,entity,entity_id,diff) VALUES('mail_ai_automatic','email_threads',tid,jsonb_build_object('error',p_error,'attempt',j.attempts));
 RETURN jsonb_build_object('saved',true);
END $$ $ddl$;

EXECUTE $ddl$ CREATE OR REPLACE FUNCTION public.mail_ai_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'queued',count(*) FILTER(WHERE NOT j.done AND j.attempts<3 AND (j.lease_until IS NULL OR j.lease_until<=now())),
  'processing',count(*) FILTER(WHERE NOT j.done AND j.lease_until>now()),
  'failed',count(*) FILTER(WHERE j.last_error IS NOT NULL AND (j.done OR j.attempts>=3)),
  'completed',count(*) FILTER(WHERE j.done AND j.last_error IS NULL AND t.ai_at IS NOT NULL)
 ) FROM private.mail_ai_jobs j JOIN public.email_threads t ON t.id=j.thread_id
$$ $ddl$;

REVOKE ALL ON FUNCTION private.mail_ai_context(uuid),private.mail_ai_enqueue(),private.mail_ai_source_lock(),private.mail_ai_source_change(),public.mail_ai_snapshot(uuid),public.mail_ai_claim(),public.mail_ai_finish(uuid,jsonb,boolean),public.mail_ai_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mail_ai_context(uuid),private.mail_ai_enqueue(),private.mail_ai_source_lock(),private.mail_ai_source_change(),public.mail_ai_snapshot(uuid),public.mail_ai_claim(),public.mail_ai_finish(uuid,jsonb,boolean),public.mail_ai_status() TO service_role;
-- Existing unclassified local mirrors join the same bounded queue; no external processing is enabled.
INSERT INTO private.mail_ai_jobs(thread_id,revision) SELECT id,revision FROM public.email_threads WHERE ai_at IS NULL AND status<>'archived' ON CONFLICT DO NOTHING;
END $migration$;
COMMIT;
