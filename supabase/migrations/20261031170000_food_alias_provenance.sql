-- Search aliases carry their own locale and an explicit provenance class.
-- Source aliases inherit the catalogue source from their parent food and keep
-- the original source field; Steady-reviewed synonyms stay separately marked.
alter table public.catalog_food_aliases
  add column origin text not null default 'legacy'
    check (origin in ('source','steady','legacy')),
  add column source_field text;

update public.catalog_food_aliases
set locale = 'und'
where locale is null;

alter table public.catalog_food_aliases
  alter column locale set default 'und',
  alter column locale set not null;

alter table public.catalog_food_aliases
  drop constraint catalog_food_aliases_pkey,
  add constraint catalog_food_aliases_pkey primary key (food_id, alias, locale),
  add constraint catalog_food_aliases_provenance_check check (
    (origin = 'source' and source_field is not null)
    or (origin = 'steady' and source_field is null)
    or origin = 'legacy'
  );

comment on column public.catalog_food_aliases.origin is
  'Whether the alias came from the parent food source, was reviewed and authored by Steady, or predates alias provenance tracking.';
comment on column public.catalog_food_aliases.source_field is
  'Source record field supplying the alias; source identity is inherited from catalog_foods.source_id/source_record_id.';
