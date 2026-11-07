-- Přihlášky k upozornění na spuštění. Anon smí jen INSERT, a jen když consent = true.
-- Číst smí jen administrátor. Na čistém Postgresu bez is_admin() se politika pro čtení přeskočí.

create table if not exists public.launch_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  consent boolean not null,
  constraint launch_signups_consent_true check (consent = true),
  constraint launch_signups_email_lower check (email = lower(email)),
  constraint launch_signups_email_len check (char_length(email) between 3 and 254)
);

create unique index if not exists launch_signups_email_key on public.launch_signups (email);

alter table public.launch_signups enable row level security;
alter table public.launch_signups force row level security;

revoke all on table public.launch_signups from public, anon, authenticated;
grant insert on table public.launch_signups to anon;
grant select on table public.launch_signups to authenticated;

drop policy if exists "anon insert launch signup" on public.launch_signups;
create policy "anon insert launch signup"
  on public.launch_signups
  for insert
  to anon
  with check (consent = true);

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    return;
  end if;
  execute 'drop policy if exists "admin read launch signups" on public.launch_signups';
  execute $pol$
    create policy "admin read launch signups"
    on public.launch_signups
    for select
    to authenticated
    using (public.is_admin())
  $pol$;
end $$;
