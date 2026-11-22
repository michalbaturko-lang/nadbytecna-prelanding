-- Interní kopie nových příběhů a nabídek (api/forward-copy). Sloupec značí, že kopie už odešla.
-- Dosavadní záznamy se označí jako vyřízené, aby se nerozeslala stará data.
alter table public.stories add column if not exists forwarded_at timestamptz;
alter table public.help_offers add column if not exists forwarded_at timestamptz;
update public.stories set forwarded_at = now() where forwarded_at is null;
update public.help_offers set forwarded_at = now() where forwarded_at is null;
