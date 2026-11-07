-- Admin smí číst a měnit stav. Anon dál jen vkládá.
-- save_transcript doplní prázdný přepis u čerstvého příběhu s audiem.
-- Na čistém Postgresu bez tabulek se příkazy přeskočí.

do $outer$
begin
  if to_regclass('public.stories') is null
     or to_regclass('public.help_offers') is null
     or to_regclass('public.admins') is null then
    return;
  end if;

  execute 'revoke all on table public.admins from anon';
  execute 'revoke insert, update, delete, truncate, references, trigger on table public.admins from authenticated';
  execute 'grant select on table public.admins to authenticated';
  execute 'grant select, update on table public.stories to authenticated';
  execute 'grant select, update on table public.help_offers to authenticated';
  execute 'alter table public.stories add column if not exists mail_sent_at timestamptz';
  execute 'alter table public.help_offers add column if not exists mail_sent_at timestamptz';
  execute 'alter table public.stories drop constraint if exists stories_status_check';
  execute 'alter table public.stories add constraint stories_status_check check (status in (''new'',''read'',''contacted'',''archived''))';
  execute 'alter table public.help_offers drop constraint if exists help_offers_status_check';
  execute 'alter table public.help_offers add constraint help_offers_status_check check (status in (''new'',''read'',''contacted'',''archived''))';

  execute $fn$
    create or replace function public.stories_guard()
    returns trigger
    language plpgsql
    set search_path = public
    as $body$
    begin
      if tg_op = 'INSERT' then
        new.transcript := null;
        new.mail_sent_at := null;
        new.status := 'new';
        return new;
      end if;
      if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then
        if current_user = 'authenticated' and public.is_admin() then
          new.id := old.id;
          new.created_at := old.created_at;
          new.full_name := old.full_name;
          new.email := old.email;
          new.anonymous := old.anonymous;
          new.wants_to_help := old.wants_to_help;
          new.input_type := old.input_type;
          new.story_text := old.story_text;
          new.audio_path := old.audio_path;
          new.transcript := old.transcript;
          new.consent := old.consent;
          new.mail_sent_at := old.mail_sent_at;
          return new;
        end if;
        return old;
      end if;
      return new;
    end;
    $body$
  $fn$;

  execute 'drop trigger if exists stories_guard on public.stories';
  execute 'create trigger stories_guard before insert or update on public.stories for each row execute function public.stories_guard()';

  execute $fn$
    create or replace function public.help_guard()
    returns trigger
    language plpgsql
    set search_path = public
    as $body$
    begin
      if tg_op = 'INSERT' then
        new.mail_sent_at := null;
        new.status := 'new';
        return new;
      end if;
      if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then
        if current_user = 'authenticated' and public.is_admin() then
          new.id := old.id;
          new.created_at := old.created_at;
          new.full_name := old.full_name;
          new.email := old.email;
          new.phone := old.phone;
          new.helper_type := old.helper_type;
          new.help_kinds := old.help_kinds;
          new.message := old.message;
          new.links := old.links;
          new.consent := old.consent;
          new.mail_sent_at := old.mail_sent_at;
          return new;
        end if;
        return old;
      end if;
      return new;
    end;
    $body$
  $fn$;

  execute 'drop trigger if exists help_guard on public.help_offers';
  execute 'create trigger help_guard before insert or update on public.help_offers for each row execute function public.help_guard()';

  execute $fn$
    create or replace function public.save_transcript(p_id uuid, p_text text)
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      n int;
    begin
      if p_id is null or p_text is null or char_length(btrim(p_text)) < 1 or char_length(p_text) > 20000 then
        return false;
      end if;
      update public.stories
        set transcript = btrim(p_text)
        where id = p_id
          and transcript is null
          and audio_path is not null
          and consent is true
          and created_at > now() - interval '30 minutes';
      get diagnostics n = row_count;
      return n = 1;
    end;
    $body$
  $fn$;

  execute 'revoke all on function public.save_transcript(uuid, text) from public, authenticated';
  execute 'grant execute on function public.save_transcript(uuid, text) to anon, service_role';
end
$outer$;
