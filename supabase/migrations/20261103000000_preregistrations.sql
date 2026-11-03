-- Nadbytečná pre-landing: přihlášky k informování o spuštění (e-mail + souhlas, double opt-in).
-- RLS zapnuté bez politik: anon/authenticated nemají k tabulce přístup. Zapisuje jen serverová funkce se service role klíčem.

create table if not exists public.preregistrations (
  id                        uuid primary key default gen_random_uuid(),
  email                     text not null,
  email_normalized          text not null,
  status                    text not null default 'pending'
                              check (status in ('pending', 'confirmed', 'unsubscribed')),
  consent_version           text not null,
  consent_text              text not null,           -- přesné znění, které žena viděla
  consented_at              timestamptz not null default now(),
  ip_hash                   text,                    -- sha256(sůl + IP), jen pro ochranu před zneužitím
  ip_hash_expires_at        timestamptz,
  confirm_token_hash        text,                    -- sha256 tokenu z e-mailu (token samotný se neukládá)
  confirm_token_expires_at  timestamptz,
  confirm_sent_at           timestamptz,
  confirmed_at              timestamptz,
  unsubscribed_at           timestamptz,
  last_attempt_at           timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  constraint preregistrations_email_normalized_lower check (email_normalized = lower(email_normalized)),
  constraint preregistrations_email_len check (char_length(email) <= 254)
);

create unique index if not exists preregistrations_email_normalized_key on public.preregistrations (email_normalized);
create index if not exists preregistrations_confirm_token_hash_idx on public.preregistrations (confirm_token_hash) where confirm_token_hash is not null;
create index if not exists preregistrations_ip_attempt_idx on public.preregistrations (ip_hash, last_attempt_at) where ip_hash is not null;

alter table public.preregistrations enable row level security;
alter table public.preregistrations force row level security;
revoke all on table public.preregistrations from anon, authenticated;

-- Retence: IP otisky po vypršení, nepotvrzené přihlášky po 7 dnech.
create or replace function public.purge_preregistrations()
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.preregistrations
     set ip_hash = null, ip_hash_expires_at = null
   where ip_hash is not null and ip_hash_expires_at < now();
  delete from public.preregistrations
   where status = 'pending' and last_attempt_at < now() - interval '7 days';
$$;
revoke all on function public.purge_preregistrations() from public, anon, authenticated;

-- Výmaz na požádání (zavolat ručně / ze serveru se service role): odstraní řádek úplně.
create or replace function public.erase_preregistration(p_email text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare n integer;
begin
  delete from public.preregistrations where email_normalized = lower(btrim(p_email));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.erase_preregistration(text) from public, anon, authenticated;

-- Plánování retence (zapnout po ověření dostupnosti pg_cron v projektu):
-- select cron.schedule('purge-preregistrations', '17 3 * * *', $$select public.purge_preregistrations()$$);
