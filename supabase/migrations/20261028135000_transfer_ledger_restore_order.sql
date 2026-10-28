-- The reversal relation is validated by the definer-only RPC and partial unique
-- index. Removing the self-FK lets a data-only backup restore rows in one pass.
alter table public.calendar_target_transfers
  drop constraint if exists calendar_target_transfers_user_id_reversal_of_fkey;
