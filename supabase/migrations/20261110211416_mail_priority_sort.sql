-- Read-only, service-role-only listing with stable priority ordering across pages.
DO $migration$
BEGIN
IF to_regclass('public.email_threads') IS NULL THEN RETURN; END IF;
CREATE INDEX IF NOT EXISTS email_threads_received_order ON public.email_threads(last_received_at DESC NULLS LAST,id);
EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.mail_list_sorted(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE f jsonb:=coalesce(p_filters,'{}'::jsonb); q text; pg int; sorting text; result jsonb;
BEGIN
IF jsonb_typeof(f)<>'object' THEN RAISE EXCEPTION 'mail_filter'; END IF;
sorting:=coalesce(nullif(f->>'sort',''),'urgency');
IF sorting NOT IN('urgency','newest','oldest') THEN RAISE EXCEPTION 'mail_sort'; END IF;
IF nullif(f->>'status','') IS NOT NULL AND f->>'status' NOT IN('new','in_progress','contacted','archived') THEN RAISE EXCEPTION 'mail_filter'; END IF;
IF nullif(f->>'email_type','') IS NOT NULL AND f->>'email_type' NOT IN('story','help','other') THEN RAISE EXCEPTION 'mail_filter'; END IF;
IF nullif(f->>'urgency','') IS NOT NULL AND f->>'urgency' NOT IN('low','medium','high','acute') THEN RAISE EXCEPTION 'mail_filter'; END IF;
IF nullif(f->>'category','') IS NOT NULL AND (f->>'category')!~'^[a-z_]{1,40}$' THEN RAISE EXCEPTION 'mail_filter'; END IF;
q:=left(trim(coalesce(f->>'q','')),200);
pg:=greatest(0,least(4000,coalesce((f->>'page')::int,0)));
WITH matched AS MATERIALIZED (
 SELECT x.*,coalesce(x.admin_category,x.ai_category) effective_category,
  coalesce(x.admin_urgency,x.ai_urgency) effective_urgency,
  coalesce(x.admin_email_type,x.ai_email_type) effective_type,
  CASE coalesce(x.admin_urgency,x.ai_urgency) WHEN 'acute' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END priority_rank
 FROM public.email_threads x WHERE
  (nullif(f->>'status','') IS NULL OR x.status=f->>'status') AND
  (nullif(f->>'category','') IS NULL OR coalesce(x.admin_category,x.ai_category)=f->>'category') AND
  (nullif(f->>'urgency','') IS NULL OR coalesce(x.admin_urgency,x.ai_urgency)=f->>'urgency') AND
  (nullif(f->>'email_type','') IS NULL OR coalesce(x.admin_email_type,x.ai_email_type)=f->>'email_type') AND
  (q='' OR strpos(lower(x.subject||' '||coalesce(x.sender_email,'')||' '||coalesce(x.ai_summary,'')),lower(q))>0 OR
   EXISTS(SELECT 1 FROM public.email_messages m WHERE m.thread_id=x.id AND strpos(lower(m.body_text||' '||m.sender_email),lower(q))>0))
), ranked AS (
 SELECT matched.*,row_number() OVER(ORDER BY
  CASE WHEN sorting='urgency' THEN priority_rank END DESC NULLS LAST,
  CASE WHEN sorting='oldest' THEN last_received_at END ASC NULLS LAST,
  CASE WHEN sorting<>'oldest' THEN last_received_at END DESC NULLS LAST,id) listing_position
 FROM matched
), page AS (SELECT * FROM ranked ORDER BY listing_position LIMIT 25 OFFSET pg*25)
SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),'rows',
 coalesce(jsonb_agg((to_jsonb(page)-ARRAY['mailbox','conversation_id','effective_category','effective_urgency','effective_type','priority_rank','listing_position'])||
  jsonb_build_object('category',effective_category,'urgency',effective_urgency,'email_type',effective_type) ORDER BY listing_position),'[]'::jsonb))
INTO result FROM page;
RETURN result;
END $$
$ddl$;
REVOKE ALL ON FUNCTION public.mail_list_sorted(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mail_list_sorted(jsonb) TO service_role;
END $migration$;
