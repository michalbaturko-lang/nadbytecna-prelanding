-- Bounded list previews; all access remains behind existing admin authorization.
DO $migration$
DECLARE d text; needle text; replacement text;
BEGIN
 IF to_regclass('public.admin_records') IS NOT NULL THEN
  SELECT regexp_replace(pg_get_viewdef('public.admin_records'::regclass,true),'[;[:space:]]+$','') INTO d;
  EXECUTE format($view$ CREATE OR REPLACE VIEW public.admin_inbox_records WITH (security_invoker=true) AS
   SELECT r.entity,r.id,r.created_at,r.updated_at,r.full_name,r.email,r.anonymous,r.wants_to_help,r.input_type,r.helper_type,r.status,r.category,r.urgency,r.admin_category,r.admin_urgency,r.classified_email,r.classified_at,r.ai_summary,r.ai_help_type,r.ai_model,r.ai_at,r.ai_error,r.consent_publish,r.age_confirmed,r.last_contact_at,r.delete_at,r.erasure_requested_at,r.body,r.transcript,r.search_document,r.urgency_rank,left(regexp_replace(coalesce(nullif(body,''),nullif(transcript,''),CASE WHEN input_type='recording' THEN 'Hlasová zpráva · přehrání v detailu' WHEN input_type='upload' THEN 'Nahraný zvukový soubor' ELSE '' END),'[[:space:]]+',' ','g'),180) AS preview
   FROM (%s) r $view$,d);
  REVOKE ALL ON public.admin_inbox_records FROM PUBLIC,anon,authenticated,service_role;
  GRANT SELECT ON public.admin_inbox_records TO service_role;
 END IF;
 IF to_regprocedure('public.mail_list_sorted(jsonb)') IS NULL THEN RETURN; END IF;
 SELECT pg_get_functiondef('public.mail_list_sorted(jsonb)'::regprocedure) INTO d;
 IF strpos(d,'''preview''')>0 THEN RETURN; END IF;
 needle:='jsonb_build_object(''category'',effective_category,';
 replacement:=$new$jsonb_build_object('preview',coalesce((SELECT left(trim(regexp_replace(regexp_replace(left(m.body_text,3000),'https?://[^[:space:]<>]+','','g'),'[[:space:]]+',' ','g')),180) FROM public.email_messages m WHERE m.thread_id=page.id ORDER BY m.received_at DESC,m.id DESC LIMIT 1),''),'has_attachments',EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=page.id AND m.has_attachments),'message_count',(SELECT count(*) FROM public.email_messages m WHERE m.thread_id=page.id),'category',effective_category,$new$;
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'inbox_preview_function_changed'; END IF;
 EXECUTE replace(d,needle,replacement);
END $migration$;
