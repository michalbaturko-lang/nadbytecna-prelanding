-- Seznam e-mailů administrátorů je prázdný. Doplní se později, nic se sem neseje.
-- AI sloupce a poznámka. Anonymní vklad je nesmí vyplnit.

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_emails_lower check (email = lower(email)),
  constraint admin_emails_len check (char_length(email) between 3 and 254)
);

alter table public.admin_emails enable row level security;
alter table public.admin_emails force row level security;
revoke all on table public.admin_emails from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    return;
  end if;
  execute 'grant select on table public.admin_emails to authenticated';
  execute 'drop policy if exists "admin read emails" on public.admin_emails';
  execute 'create policy "admin read emails" on public.admin_emails for select to authenticated using (public.is_admin())';
end $$;

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    return;
  end if;
  execute $fn$
    create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select exists (select 1 from public.admins where user_id = auth.uid())
      or exists (
        select 1 from public.admin_emails
        where email = lower(coalesce(auth.jwt() ->> 'email', ''))
      );
    $body$
  $fn$;
end $$;

do $$
begin
  if to_regclass('public.stories') is null or to_regclass('public.help_offers') is null then
    return;
  end if;
  execute 'alter table public.stories
    add column if not exists ai_summary text,
    add column if not exists ai_category text,
    add column if not exists ai_category_confirmed boolean,
    add column if not exists ai_urgency text,
    add column if not exists ai_help_type text,
    add column if not exists ai_model text,
    add column if not exists ai_at timestamptz,
    add column if not exists admin_note text';
  execute 'alter table public.help_offers
    add column if not exists ai_summary text,
    add column if not exists ai_category text,
    add column if not exists ai_category_confirmed boolean,
    add column if not exists ai_urgency text,
    add column if not exists ai_help_type text,
    add column if not exists ai_model text,
    add column if not exists ai_at timestamptz,
    add column if not exists ai_matches text,
    add column if not exists admin_note text';
  execute 'alter table public.stories drop constraint if exists stories_status_check';
  execute 'alter table public.stories add constraint stories_status_check check (status in (''new'',''read'',''contacted'',''archived'',''in_progress'',''resolved'',''published''))';
  execute 'alter table public.help_offers drop constraint if exists help_offers_status_check';
  execute 'alter table public.help_offers add constraint help_offers_status_check check (status in (''new'',''read'',''contacted'',''archived'',''in_progress'',''resolved'',''published''))';
  execute $fn$
    create or replace function public.clear_private_on_insert()
    returns trigger
    language plpgsql
    set search_path = public
    as $body$
    begin
      if tg_op = 'INSERT' and current_user = 'anon' then
        new.ai_summary := null;
        new.ai_category := null;
        new.ai_category_confirmed := null;
        new.ai_urgency := null;
        new.ai_help_type := null;
        new.ai_model := null;
        new.ai_at := null;
        new.admin_note := null;
        if tg_table_name = 'help_offers' then
          new.ai_matches := null;
        end if;
      end if;
      return new;
    end;
    $body$
  $fn$;
  execute 'drop trigger if exists stories_clear_private on public.stories';
  execute 'create trigger stories_clear_private before insert on public.stories for each row execute function public.clear_private_on_insert()';
  execute 'drop trigger if exists help_clear_private on public.help_offers';
  execute 'create trigger help_clear_private before insert on public.help_offers for each row execute function public.clear_private_on_insert()';
end $$;
