-- A day entry can be left without a meal label. Keep the existing enum/RPC
-- contract while storing the deliberate absence of a label explicitly.
alter type public.meal_section add value if not exists 'unlabelled';
