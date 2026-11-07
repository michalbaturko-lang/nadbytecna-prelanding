-- Spusť v SQL editoru Supabase. Sloupce jsou nullable boolean.
-- Formuláře je začnou posílat až v nasazení, které tenhle soubor doprovází.
-- Dokud sloupce nejsou, insert z formuláře spadne.

alter table public.stories
  add column if not exists consent_transcript boolean,
  add column if not exists consent_publish boolean;

alter table public.help_offers
  add column if not exists consent_publish boolean;

comment on column public.stories.consent_transcript is 'Souhlas s přepisem hlasu. Null u textu, true u odeslaného audia.';
comment on column public.stories.consent_publish is 'Souhlas se zveřejněním příběhu. Nepovinný.';
comment on column public.help_offers.consent_publish is 'Souhlas se zveřejněním nabídky. Zatím se neptáme, zůstává null.';
