-- Po potvrzení e-mailu si žena (nepovinně) vybere výroky, které ji nejvíc vystihují (max 3).
-- Ukládá se k řádku přihlášky; při odhlášení se vymaže. Souhrnné počty se zveřejňují bez osobních údajů.
alter table public.preregistrations
  add column if not exists claims    text[],
  add column if not exists claims_at timestamptz;

alter table public.preregistrations
  drop constraint if exists preregistrations_claims_len;
alter table public.preregistrations
  add constraint preregistrations_claims_len check (claims is null or cardinality(claims) between 1 and 3);
