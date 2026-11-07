-- Read-only. Run before approving migration; contains no user story/contact rows.
select version();
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
 where table_schema='public' and table_name in('stories','help_offers','admins','admin_emails','launch_signups') order by table_name,ordinal_position;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
 where (schemaname='public' and tablename in('stories','help_offers','admins','admin_emails','launch_signups')) or (schemaname='storage' and tablename='objects');
select event_object_table,trigger_name,action_timing,event_manipulation,action_statement from information_schema.triggers
 where event_object_schema='public' and event_object_table in('stories','help_offers');
select conrelid::regclass,conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in('public.stories'::regclass,'public.help_offers'::regclass,'public.admins'::regclass);
select extname,extversion,extnamespace::regnamespace from pg_extension where extname in('unaccent','pg_cron');
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='story-audio';
select has_table_privilege('service_role','auth.users','SELECT') as can_verify_user;
