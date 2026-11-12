-- The removed weeks relation used to provide the account reference for dates.
-- Retain that integrity directly now that calendar dates are independent of weeks.
alter table public.days
  add constraint days_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
