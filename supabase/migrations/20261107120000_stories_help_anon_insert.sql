-- Anon smí do stories a help_offers jen INSERT, a jen když consent = true.
-- Žádné SELECT/UPDATE/DELETE. Audio jen upload do story-audio/<uuid>/<název>.
-- Tabulky a bucket už v projektu jsou. Na čistém Postgresu bez nich se příkazy přeskočí.

do $$
begin
  if to_regclass('public.stories') is null or to_regclass('public.help_offers') is null then
    return;
  end if;
  execute 'revoke all on table public.stories from anon, authenticated';
  execute 'revoke all on table public.help_offers from anon, authenticated';
  execute 'grant insert on table public.stories to anon';
  execute 'grant insert on table public.help_offers to anon';
end $$;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  execute 'drop policy if exists "anon upload audio" on storage.objects';
  execute $pol$
    create policy "anon upload audio"
    on storage.objects
    for insert
    to anon
    with check (
      bucket_id = 'story-audio'
      and name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
    )
  $pol$;
end $$;
