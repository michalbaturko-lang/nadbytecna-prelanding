-- Přidání administrátora. Nejdřív se ten člověk na /admin přihlásí magic linkem,
-- tím vznikne řádek v auth.users. Pak v SQL editoru Supabase:

insert into public.admins (user_id)
select id
from auth.users
where lower(email) = lower('SEM-EMAIL')
on conflict (user_id) do nothing;

-- Odebrání:
-- delete from public.admins
-- where user_id = (select id from auth.users where lower(email) = lower('SEM-EMAIL'));
