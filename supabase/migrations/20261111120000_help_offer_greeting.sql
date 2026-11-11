-- Formulář Mohu pomoci sbírá nepovinné „Anonymní oslovení“. Sloupec ho uloží.
-- Pohled admin_records a fulltext ho vezmou s sebou. Stávající řádky zůstanou prázdné.
-- Na čistém Postgresu bez help_offers (jen staré preregistrace) se nic nemění.

do $$
begin
  if to_regclass('public.help_offers') is null then
    return;
  end if;
  execute 'alter table public.help_offers add column if not exists greeting text';
end $$;

do $$
begin
  if to_regclass('public.admin_records') is null or to_regclass('public.help_offers') is null then
    return;
  end if;
  execute $sql$ CREATE OR REPLACE VIEW public.admin_records WITH(security_invoker=true) AS
SELECT 'stories'::text entity,id,created_at,updated_at,full_name,email,NULL::text phone,anonymous,wants_to_help,input_type,NULL::text helper_type,status,coalesce(admin_category,ai_category) category,coalesce(admin_urgency,ai_urgency) urgency,admin_category,admin_urgency,classified_by,classified_email,classified_at,ai_summary,ai_category,ai_urgency,ai_help_type,ai_model,ai_at,ai_error,consent,consent_publish,consent_at,consent_transcript_at,consent_publish_at,consent_version,consent_texts,age_confirmed,age_confirmed_at,last_contact_at,opened_at,story_text body,transcript,audio_path,NULL::text links,admin_note,search_document,erasure_requested_at,
CASE WHEN status='published' THEN NULL ELSE created_at+interval '12 months' END delete_at, CASE coalesce(admin_urgency,ai_urgency) WHEN 'acute' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END urgency_rank, consent_transcript, NULL::text greeting FROM public.stories
UNION ALL
SELECT 'help_offers',id,created_at,updated_at,full_name,email,phone,false,true,'text',helper_type,status,coalesce(admin_category,ai_category),coalesce(admin_urgency,ai_urgency),admin_category,admin_urgency,classified_by,classified_email,classified_at,ai_summary,ai_category,ai_urgency,ai_help_type,ai_model,ai_at,ai_error,consent,consent_publish,consent_at,consent_transcript_at,consent_publish_at,consent_version,consent_texts,age_confirmed,age_confirmed_at,last_contact_at,opened_at,message,NULL,NULL,links::text,admin_note,search_document,erasure_requested_at,coalesce(last_contact_at,created_at)+interval '24 months', CASE coalesce(admin_urgency,ai_urgency) WHEN 'acute' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END, NULL::boolean, greeting FROM public.help_offers $sql$;
  execute 'revoke all on public.admin_records from public, anon';
  execute 'grant select on public.admin_records to authenticated, service_role';
end $$;

do $$
declare src text;
begin
  if to_regprocedure('private.record_guard()') is null then
    return;
  end if;
  src := pg_get_functiondef('private.record_guard()'::regprocedure);
  if position('n->>''greeting''' in src) > 0 then
    return;
  end if;
  if position('n->>''message'',n->>''transcript''' in src) = 0 then
    raise exception 'record_guard search clause missing';
  end if;
  src := replace(src, 'n->>''message'',n->>''transcript''', 'n->>''message'',n->>''greeting'',n->>''transcript''');
  execute src;
end $$;
