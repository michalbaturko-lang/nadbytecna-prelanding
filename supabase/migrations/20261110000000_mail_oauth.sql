-- Mailbox connection only: no application admin access and no Microsoft tenant changes.
-- Ciphertext envelopes are produced/decrypted exclusively by the trusted server.
BEGIN;
DO $oauth$
BEGIN
IF to_regclass('public.admin_audit_log') IS NULL OR to_regclass('private.mail_sync_state') IS NULL THEN RETURN; END IF;
CREATE TABLE IF NOT EXISTS private.mail_oauth_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), mailbox text NOT NULL CHECK(mailbox='veryvera@nadbytecna.cz'),
 expected_tenant uuid NOT NULL, generation bigint NOT NULL DEFAULT 1, cache_version bigint NOT NULL DEFAULT 0,
 ciphertext text CHECK(ciphertext IS NULL OR length(ciphertext) BETWEEN 1 AND 2097152), account_id text,
 connection_tenant uuid, connected_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.mail_oauth_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 mailbox text NOT NULL CHECK(mailbox='veryvera@nadbytecna.cz'), tenant_id uuid NOT NULL, generation bigint NOT NULL,
 issued_by uuid NOT NULL, issued_email text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 status text NOT NULL DEFAULT 'issued' CHECK(status IN('issued','consumed','revoked','expired'))
);
CREATE TABLE IF NOT EXISTS private.mail_oauth_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invitation_id uuid NOT NULL REFERENCES private.mail_oauth_invitations(id) ON DELETE CASCADE,
 generation bigint NOT NULL, state_hash text NOT NULL UNIQUE CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 cookie_hash text NOT NULL CHECK(cookie_hash ~ '^[0-9a-f]{64}$'), encrypted_flow text CHECK(encrypted_flow IS NULL OR length(encrypted_flow) BETWEEN 1 AND 65536),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', claimed_at timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','claimed','completed','failed','invalidated','expired'))
);
REVOKE ALL ON private.mail_oauth_control,private.mail_oauth_invitations,private.mail_oauth_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.mail_oauth_control,private.mail_oauth_invitations,private.mail_oauth_attempts TO service_role;
END $oauth$;

DO $oauth$
BEGIN
IF to_regclass('private.mail_oauth_control') IS NULL THEN RETURN; END IF;
EXECUTE $sql$ CREATE OR REPLACE FUNCTION public.mail_oauth(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c private.mail_oauth_control; inv private.mail_oauth_invitations; attempt private.mail_oauth_attempts;
 actor uuid; actor_email text; tenant uuid; v_token_hash text; v_state_hash text; v_cookie_hash text; flow text; cache text;
 new_id uuid; result jsonb; new_generation bigint; new_version bigint; account text; target_mailbox text; requested uuid;
BEGIN
-- Same ordering as mail_sync_commit: mailbox lock first, then OAuth control row.
IF p_action IN('save_connection','clear','disconnect') THEN PERFORM pg_advisory_xact_lock(84301720261107); END IF;
IF p_action IN('issue','revoke','clear','disconnect') THEN
 actor:=nullif(p_payload->>'actor_id','')::uuid; actor_email:=lower(p_payload->>'actor_email');
 IF actor IS NULL OR actor_email IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=actor_email) OR NOT private.verified_admin_identity(actor,actor_email) THEN RAISE EXCEPTION 'oauth_admin'; END IF;
END IF;
IF p_action='issue' THEN
 tenant:=nullif(p_payload->>'tenant_id','')::uuid; v_token_hash:=p_payload->>'token_hash';
 IF tenant IS NULL OR v_token_hash IS NULL OR v_token_hash !~ '^[0-9a-f]{64}$' OR (p_payload->>'mailbox' IS NOT NULL AND lower(p_payload->>'mailbox')<>'veryvera@nadbytecna.cz') THEN RAISE EXCEPTION 'oauth_invitation_input'; END IF;
 IF EXISTS(SELECT 1 FROM private.mail_oauth_invitations WHERE private.mail_oauth_invitations.token_hash=v_token_hash) THEN RAISE EXCEPTION 'oauth_duplicate_invitation'; END IF;
 INSERT INTO private.mail_oauth_control(singleton,mailbox,expected_tenant) VALUES(true,'veryvera@nadbytecna.cz',tenant) ON CONFLICT DO NOTHING;
END IF;
SELECT * INTO c FROM private.mail_oauth_control WHERE singleton FOR UPDATE;
IF NOT FOUND THEN
 IF p_action='status' THEN RETURN jsonb_build_object('connected',false,'mailbox','veryvera@nadbytecna.cz','tenant_id',NULL,'generation',0,'version',0,'connected_at',NULL,'updated_at',NULL,'active_invitations',0,'active_attempts',0); END IF;
 IF p_action IN('cache_get','begin','callback_claim') THEN RETURN NULL; END IF;
 IF p_action IN('cache_set','save_connection') THEN RETURN jsonb_build_object('saved',false,'reason','disconnected'); END IF;
 IF p_action IN('clear','disconnect','revoke') THEN RETURN jsonb_build_object('generation',0,'revoked',false); END IF;
 RAISE EXCEPTION 'oauth_configuration';
END IF;
-- Expiry is enforced at every access; erase unused encrypted PKCE flow as soon as any server operation observes expiry.
UPDATE private.mail_oauth_attempts SET encrypted_flow=NULL,status='expired' WHERE expires_at<=now() AND status IN('pending','claimed');
UPDATE private.mail_oauth_invitations SET status='expired' WHERE expires_at<=now() AND status='issued';
DELETE FROM private.mail_oauth_invitations WHERE expires_at<now()-interval '1 day';
IF p_action='status' THEN
 RETURN jsonb_build_object('connected',c.ciphertext IS NOT NULL,'mailbox',c.mailbox,'tenant_id',c.expected_tenant,'generation',c.generation,'version',c.cache_version,'connected_at',c.connected_at,'updated_at',c.updated_at,
 'active_invitations',(SELECT count(*) FROM private.mail_oauth_invitations WHERE status='issued' AND expires_at>now() AND generation=c.generation),
 'active_attempts',(SELECT count(*) FROM private.mail_oauth_attempts WHERE status IN('pending','claimed') AND expires_at>now() AND generation=c.generation));
ELSIF p_action='issue' THEN
 IF tenant<>c.expected_tenant THEN RAISE EXCEPTION 'oauth_tenant_configuration'; END IF;
 UPDATE private.mail_oauth_invitations SET status='revoked' WHERE status='issued';
 UPDATE private.mail_oauth_attempts SET status='invalidated',encrypted_flow=NULL WHERE status IN('pending','claimed');
 UPDATE private.mail_oauth_control SET generation=generation+1,cache_version=cache_version+1,updated_at=now() WHERE singleton RETURNING generation,cache_version INTO new_generation,new_version;
 INSERT INTO private.mail_oauth_invitations(token_hash,mailbox,tenant_id,generation,issued_by,issued_email) VALUES(v_token_hash,c.mailbox,c.expected_tenant,new_generation,actor,actor_email) RETURNING * INTO inv;
 INSERT INTO public.admin_audit_log(user_id,action,diff) VALUES(actor,'mail_oauth_invite',jsonb_build_object('issued',1));
 RETURN jsonb_build_object('invitation_id',inv.id,'expires_at',inv.expires_at,'generation',new_generation);
ELSIF p_action='begin' THEN
 v_token_hash:=p_payload->>'token_hash'; v_state_hash:=p_payload->>'state_hash'; v_cookie_hash:=p_payload->>'cookie_hash'; flow:=p_payload->>'encrypted_flow';
 IF v_token_hash IS NULL OR v_token_hash !~ '^[0-9a-f]{64}$' OR v_state_hash IS NULL OR v_state_hash !~ '^[0-9a-f]{64}$' OR v_cookie_hash IS NULL OR v_cookie_hash !~ '^[0-9a-f]{64}$' OR flow IS NULL OR length(flow) NOT BETWEEN 1 AND 65536 THEN RAISE EXCEPTION 'oauth_flow_input'; END IF;
 SELECT * INTO inv FROM private.mail_oauth_invitations WHERE private.mail_oauth_invitations.token_hash=v_token_hash AND status='issued' AND expires_at>now() AND generation=c.generation FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=inv.issued_by) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=inv.issued_email) OR NOT private.verified_admin_identity(inv.issued_by,inv.issued_email) THEN UPDATE private.mail_oauth_invitations SET status='revoked' WHERE id=inv.id; RETURN NULL; END IF;
 UPDATE private.mail_oauth_invitations SET status='consumed' WHERE id=inv.id;
 INSERT INTO private.mail_oauth_attempts(invitation_id,generation,state_hash,cookie_hash,encrypted_flow,expires_at) VALUES(inv.id,c.generation,v_state_hash,v_cookie_hash,flow,least(now()+interval '10 minutes',inv.expires_at)) RETURNING * INTO attempt;
 INSERT INTO public.admin_audit_log(action,diff) VALUES('mail_oauth_begin',jsonb_build_object('attempts',1));
 RETURN jsonb_build_object('attempt_id',attempt.id,'generation',c.generation,'tenant_id',c.expected_tenant,'mailbox',c.mailbox,'expires_at',attempt.expires_at);
ELSIF p_action='callback_claim' THEN
 v_state_hash:=p_payload->>'state_hash'; v_cookie_hash:=p_payload->>'cookie_hash';
 IF v_state_hash IS NULL OR v_state_hash !~ '^[0-9a-f]{64}$' OR v_cookie_hash IS NULL OR v_cookie_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO attempt FROM private.mail_oauth_attempts WHERE private.mail_oauth_attempts.state_hash=v_state_hash AND private.mail_oauth_attempts.cookie_hash=v_cookie_hash AND status='pending' AND expires_at>now() AND generation=c.generation FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO inv FROM private.mail_oauth_invitations WHERE id=attempt.invitation_id;
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=inv.issued_by) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=inv.issued_email) OR NOT private.verified_admin_identity(inv.issued_by,inv.issued_email) THEN UPDATE private.mail_oauth_attempts SET status='invalidated',encrypted_flow=NULL WHERE id=attempt.id; RETURN NULL; END IF;
 UPDATE private.mail_oauth_attempts SET status='claimed',claimed_at=now(),encrypted_flow=NULL WHERE id=attempt.id;
 RETURN jsonb_build_object('attempt_id',attempt.id,'encrypted_flow',attempt.encrypted_flow,'generation',c.generation,'tenant_id',c.expected_tenant,'mailbox',c.mailbox,'expires_at',attempt.expires_at);
ELSIF p_action='save_connection' THEN
 requested:=nullif(p_payload->>'attempt_id','')::uuid;
 SELECT * INTO attempt FROM private.mail_oauth_attempts WHERE id=requested AND status='claimed' AND expires_at>now() AND generation=c.generation FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('saved',false,'reason','attempt'); END IF;
 SELECT * INTO inv FROM private.mail_oauth_invitations WHERE id=attempt.invitation_id;
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=inv.issued_by) OR NOT EXISTS(SELECT 1 FROM public.admin_emails WHERE email=inv.issued_email) OR NOT private.verified_admin_identity(inv.issued_by,inv.issued_email) THEN UPDATE private.mail_oauth_attempts SET status='invalidated',encrypted_flow=NULL WHERE id=attempt.id; RETURN jsonb_build_object('saved',false,'reason','issuer_revoked'); END IF;
 cache:=p_payload->>'ciphertext'; account:=p_payload->>'account_id'; target_mailbox:=lower(p_payload->>'mailbox'); tenant:=nullif(p_payload->>'tenant_id','')::uuid;
 IF cache IS NULL OR length(cache) NOT BETWEEN 1 AND 2097152 OR account IS NULL OR length(account) NOT BETWEEN 1 AND 2048 THEN RAISE EXCEPTION 'oauth_cache_input'; END IF;
 IF target_mailbox IS DISTINCT FROM c.mailbox OR tenant IS DISTINCT FROM c.expected_tenant THEN
  UPDATE private.mail_oauth_attempts SET status='failed',encrypted_flow=NULL WHERE id=attempt.id;
  INSERT INTO public.admin_audit_log(action,diff) VALUES('mail_oauth_rejected',jsonb_build_object('reason','account_mismatch'));
  RETURN jsonb_build_object('saved',false,'reason','account_mismatch');
 END IF;
 UPDATE private.mail_oauth_control SET ciphertext=cache,account_id=account,connection_tenant=tenant,connected_at=now(),updated_at=now(),generation=generation+1,cache_version=cache_version+1 WHERE singleton RETURNING generation,cache_version INTO new_generation,new_version;
 UPDATE private.mail_oauth_attempts SET status='completed',encrypted_flow=NULL WHERE id=attempt.id;
 UPDATE private.mail_oauth_attempts SET status='invalidated',encrypted_flow=NULL WHERE id<>attempt.id AND status IN('pending','claimed');
 UPDATE private.mail_oauth_invitations SET status='revoked' WHERE status='issued';
 UPDATE private.mail_sync_state SET cursor=NULL,initial_complete=false,lease=NULL,lease_until=NULL,retry_after=NULL;
 INSERT INTO public.admin_audit_log(action,diff) VALUES('mail_oauth_connected',jsonb_build_object('connections',1));
 RETURN jsonb_build_object('saved',true,'version',new_version,'generation',new_generation);
ELSIF p_action='cache_get' THEN
 IF c.ciphertext IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('ciphertext',c.ciphertext,'version',c.cache_version,'generation',c.generation,'account_id',c.account_id,'tenant_id',c.connection_tenant,'mailbox',c.mailbox);
ELSIF p_action='cache_set' THEN
 IF c.ciphertext IS NULL OR (p_payload->>'expected_version')::bigint IS DISTINCT FROM c.cache_version OR (p_payload->>'expected_generation')::bigint IS DISTINCT FROM c.generation THEN RETURN jsonb_build_object('saved',false,'reason','changed'); END IF;
 cache:=p_payload->>'ciphertext'; IF cache IS NULL OR length(cache) NOT BETWEEN 1 AND 2097152 THEN RAISE EXCEPTION 'oauth_cache_input'; END IF;
 UPDATE private.mail_oauth_control SET ciphertext=cache,cache_version=cache_version+1,updated_at=now() WHERE singleton RETURNING cache_version INTO new_version;
 RETURN jsonb_build_object('saved',true,'version',new_version,'generation',c.generation);
ELSIF p_action IN('clear','disconnect','revoke') THEN
 IF p_action='revoke' AND p_payload->>'invitation_id' IS NOT NULL THEN
  requested:=(p_payload->>'invitation_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM private.mail_oauth_invitations WHERE id=requested AND generation=c.generation AND status IN('issued','consumed')) THEN RETURN jsonb_build_object('revoked',false,'generation',c.generation); END IF;
 END IF;
 UPDATE private.mail_oauth_invitations SET status='revoked' WHERE status='issued';
 UPDATE private.mail_oauth_attempts SET status='invalidated',encrypted_flow=NULL WHERE status IN('pending','claimed');
 UPDATE private.mail_oauth_control SET generation=generation+1,cache_version=cache_version+1,updated_at=now(),ciphertext=CASE WHEN p_action='revoke' THEN ciphertext ELSE NULL END,account_id=CASE WHEN p_action='revoke' THEN account_id ELSE NULL END,connection_tenant=CASE WHEN p_action='revoke' THEN connection_tenant ELSE NULL END,connected_at=CASE WHEN p_action='revoke' THEN connected_at ELSE NULL END WHERE singleton RETURNING generation,cache_version INTO new_generation,new_version;
 IF p_action IN('clear','disconnect') THEN UPDATE private.mail_sync_state SET lease=NULL,lease_until=NULL; END IF;
 INSERT INTO public.admin_audit_log(user_id,action,diff) VALUES(actor,CASE WHEN p_action='revoke' THEN 'mail_oauth_revoked' ELSE 'mail_oauth_disconnected' END,jsonb_build_object('connections',CASE WHEN p_action='revoke' THEN 0 ELSE 1 END));
 RETURN jsonb_build_object('revoked',true,'generation',new_generation,'version',new_version);
END IF;
RAISE EXCEPTION 'oauth_action';
END $$ $sql$;
REVOKE ALL ON FUNCTION public.mail_oauth(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mail_oauth(text,jsonb) TO service_role;
END $oauth$;
COMMIT;
