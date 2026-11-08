-- Record the exact current audio-consent wording. Legacy clients without
-- the explicit v2 marker retain v1; historical rows are never rewritten.
DO $migration$
BEGIN
IF to_regprocedure('private.record_guard()') IS NULL THEN RETURN; END IF;
EXECUTE $record_guard_ddl$
CREATE OR REPLACE FUNCTION private.record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE n jsonb; note_text text;
BEGIN
n := to_jsonb(NEW);
IF TG_TABLE_NAME='stories' THEN
  -- Legacy invalid paths remain readable as metadata, but no new binding or change may target another story's audio.
  IF NEW.audio_path IS NOT NULL AND (TG_OP='INSERT' OR NEW.audio_path IS DISTINCT FROM OLD.audio_path) AND NOT private.valid_audio_path(NEW.audio_path,NEW.id) THEN RAISE EXCEPTION 'audio_path'; END IF;
END IF;
IF TG_OP='INSERT' THEN
  NEW.status := 'new'; NEW.updated_at := now();
  IF current_user='anon' THEN
    -- Keep only public submission fields; clients cannot inject triage or internal metadata.
    n := n - ARRAY['ai_summary','ai_category','ai_category_confirmed','ai_urgency','ai_help_type','ai_model','ai_at','ai_matches','ai_error','admin_note','admin_category','admin_urgency','classified_by','classified_email','classified_at','opened_at','last_contact_at','erasure_requested_at','transcript','mail_sent_at'];
    NEW := jsonb_populate_record(NEW, (SELECT jsonb_object_agg(k,NULL) FROM unnest(ARRAY['ai_summary','ai_category','ai_category_confirmed','ai_urgency','ai_help_type','ai_model','ai_at','ai_matches','ai_error','admin_note','admin_category','admin_urgency','classified_by','classified_email','classified_at','opened_at','last_contact_at','erasure_requested_at','transcript','mail_sent_at']) k));
    NEW.created_at := now(); NEW.updated_at := now();
    NEW.consent_at := CASE WHEN NEW.consent THEN now() END;
    NEW.consent_publish_at := CASE WHEN NEW.consent_publish THEN now() END;
    NEW.age_confirmed_at := CASE WHEN NEW.age_confirmed THEN now() END;
    NEW.consent_version := CASE WHEN TG_TABLE_NAME='stories' AND NEW.consent_version='2026-11-08-audio-v2' THEN '2026-11-08-audio-v2' ELSE '2026-11-07-v1' END;
    NEW.consent_texts := jsonb_build_object('processing', CASE WHEN TG_TABLE_NAME='stories' THEN 'Souhlasím se zpracováním příběhu včetně citlivých údajů o zdraví nebo násilí, pokud je v příběhu uvedu. Povinné.' ELSE 'Souhlasím se zpracováním nabídky pomoci. Povinné.' END, 'publish', CASE WHEN TG_TABLE_NAME='stories' THEN 'Chci svůj příběh zveřejnit' ELSE 'Chci svou nabídku zveřejnit' END,'age','Je mi 18 let');
    IF TG_TABLE_NAME='stories' THEN
      NEW.consent_transcript_at := CASE WHEN NEW.consent_transcript THEN now() END;
      NEW.consent_texts := NEW.consent_texts || jsonb_build_object('transcript',CASE WHEN NEW.consent_version='2026-11-08-audio-v2' THEN 'Souhlasím s případným budoucím přepisem hlasové zprávy na text. Přepis nyní neprobíhá. U audia povinné.' ELSE 'Souhlasím s přepisem hlasové zprávy na text. U audia povinné.' END);
    END IF;
  END IF;
ELSE
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.admin_category IS DISTINCT FROM OLD.admin_category OR NEW.admin_urgency IS DISTINCT FROM OLD.admin_urgency THEN NEW.updated_at := now(); END IF;
END IF;
IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published') AND (NEW.consent_publish IS NOT TRUE OR NEW.age_confirmed IS NOT TRUE) THEN RAISE EXCEPTION 'publish_consent_required'; END IF;
IF TG_OP='UPDATE' AND (NEW.consent IS DISTINCT FROM OLD.consent OR NEW.consent_publish IS DISTINCT FROM OLD.consent_publish OR NEW.age_confirmed IS DISTINCT FROM OLD.age_confirmed OR NEW.consent_at IS DISTINCT FROM OLD.consent_at OR NEW.consent_publish_at IS DISTINCT FROM OLD.consent_publish_at OR NEW.age_confirmed_at IS DISTINCT FROM OLD.age_confirmed_at OR NEW.consent_version IS DISTINCT FROM OLD.consent_version OR NEW.consent_texts IS DISTINCT FROM OLD.consent_texts) THEN RAISE EXCEPTION 'consent_immutable'; END IF;
IF current_user <> 'anon' THEN SELECT string_agg(body,' ') INTO note_text FROM public.admin_notes WHERE entity=TG_TABLE_NAME AND entity_id=NEW.id; END IF;
n := to_jsonb(NEW);
NEW.search_document := private.search_text(concat_ws(' ',n->>'full_name',n->>'email',n->>'story_text',n->>'message',n->>'transcript',n->>'ai_summary',n->>'admin_note',note_text));
RETURN NEW;
END $$
$record_guard_ddl$;
END $migration$;
