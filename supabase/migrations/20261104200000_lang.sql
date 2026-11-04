-- Jazyk stránky, ze které přihláška přišla (cs / sk). Určuje jazyk potvrzovacího e-mailu a znění uloženého souhlasu.
alter table public.preregistrations
  add column if not exists lang text not null default 'cs';

alter table public.preregistrations
  drop constraint if exists preregistrations_lang_check;
alter table public.preregistrations
  add constraint preregistrations_lang_check check (lang in ('cs', 'sk'));
